import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import pg from "pg";

/**
 * =============================================================================
 * ALCANCE CROSS-TENANT DEL SÚPER ADMIN — probado contra la base, no supuesto
 * =============================================================================
 *
 * Las migraciones 0075 y 0076 le dieron al `global_admin` la capacidad de
 * sancionar y moderar en CUALQUIER comunidad. Eso es exactamente el tipo de
 * cambio que no alcanza con leerlo: hay que verlo pasar y —sobre todo— hay que
 * ver que el `domain_admin` SIGUE sin poder hacerlo.
 *
 * CÓMO SE PRUEBA. Se abre una transacción, se falsifica el JWT con
 * `set_config('request.jwt.claims', …)` + rol `authenticated` (que es
 * literalmente lo que hace PostgREST en cada request), se ejecuta la acción, se
 * mide el efecto y se hace ROLLBACK. Nada queda escrito.
 *
 * POR QUÉ CADA LLAMADA QUE DEBE FALLAR VA EN UN SAVEPOINT. En Postgres, un
 * error aborta la transacción entera: todo lo que venga después devuelve
 * "current transaction is aborted". Y justo lo que este test necesita hacer
 * DESPUÉS del error es MEDIR (¿quedó escrita la sanción? ¿cambió el estado?).
 * Sin savepoint, la mitad interesante del test es inalcanzable.
 *
 * CUÁNDO CORRE. Sólo si hay credenciales de base en el entorno
 * (`DATABASE_URL` o `SUPABASE_DB_PASSWORD` en `.env.local`, las mismas que usa
 * `npm run check:rls`). Sin credenciales se SALTEA en vez de fallar: un test de
 * integración que rompe el build de quien clona el repo sin secretos no protege
 * nada, molesta. Si el TLS se interpone, `check:rls` documenta el opt-out de
 * dev: `RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1`.
 */

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_HOST = "db.ktmbtpuhqqofdkisqseq.supabase.co";

function connectionString(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;
  return `postgresql://postgres:${encodeURIComponent(password)}@${DB_HOST}:5432/postgres`;
}

const CONN = connectionString();
const suite = CONN ? describe : describe.skip;

interface Escenario {
  tenantA: string;
  tenantB: string;
  miembroB: string;
  actor: string;
}

suite("alcance cross-tenant del súper admin (0075, 0076)", () => {
  let client: pg.Client | null = null;
  let escenario: Escenario | null = null;

  beforeAll(async () => {
    client = new pg.Client({
      connectionString: CONN as string,
      ssl:
        process.env.RLS_ENUMERATOR_ALLOW_INSECURE_TLS === "1"
          ? { rejectUnauthorized: false }
          : undefined,
      // Sin esto, una base inalcanzable cuelga la suite entera.
      connectionTimeoutMillis: 15_000,
      statement_timeout: 20_000,
      // RED DE SEGURIDAD, aprendida a los golpes: si el proceso de test muere a
      // mitad de una transacción (un timeout de vitest, un Ctrl-C), la sesión
      // queda "idle in transaction" del lado del servidor SOSTENIENDO LOS
      // LOCKS de las filas que tocó. La corrida siguiente se cuelga esperando
      // esos locks y parece un bug del código que se está probando, cuando en
      // realidad es el cadáver de la corrida anterior. Con esto, el servidor
      // mata sola la sesión zombi a los 30 segundos.
      options: "-c idle_in_transaction_session_timeout=30000",
    });
    await client.connect();

    // Dos comunidades distintas y una persona común en la segunda. Si el
    // entorno no las tiene, los casos se saltean solos (ver los `it`).
    const { rows } = await client.query<{
      tenant_a: string;
      tenant_b: string;
      miembro_b: string | null;
      actor: string | null;
    }>(`
      with pares as (
        select a.id as tenant_a, b.id as tenant_b
          from public.tenants a
          join public.tenants b on b.id <> a.id
         order by a.created_at, b.created_at
         limit 1
      )
      select p.tenant_a, p.tenant_b,
             (select id from public.profiles
               where tenant_id = p.tenant_b and role = 'member'
               order by created_at limit 1) as miembro_b,
             (select id from public.profiles
               where tenant_id = p.tenant_a order by created_at limit 1) as actor
        from pares p
    `);

    const row = rows[0];
    if (row?.tenant_a && row.tenant_b && row.miembro_b && row.actor) {
      escenario = {
        tenantA: row.tenant_a,
        tenantB: row.tenant_b,
        miembroB: row.miembro_b,
        actor: row.actor,
      };
    }
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  /** Corre `fn` con el JWT falsificado y hace ROLLBACK pase lo que pase. */
  async function comoRol<T>(
    role: string,
    tenantId: string | null,
    actor: string,
    fn: (db: pg.Client) => Promise<T>,
  ): Promise<T> {
    const db = client as pg.Client;
    await db.query("begin");
    try {
      const claims = JSON.stringify({
        sub: actor,
        role: "authenticated",
        app_metadata: tenantId ? { tenant_id: tenantId, role } : { role },
      });
      await db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await comoAuthenticated(db);
      return await fn(db);
    } finally {
      // El rollback tiene que salir sí o sí: si esta transacción quedara
      // abierta, TODOS los tests siguientes verían una base sucia.
      try {
        await db.query("rollback");
      } catch {
        /* la conexión ya se cayó: no hay nada que revertir */
      }
    }
  }

  /** Vuelve al rol que usa PostgREST para un usuario con sesión. */
  function comoAuthenticated(db: pg.Client) {
    return db.query("select set_config('role', 'authenticated', true)");
  }

  /** Vuelve al rol dueño para MEDIR sin que la RLS esconda el resultado. */
  function comoDueño(db: pg.Client) {
    return db.query("select set_config('role', 'postgres', true)");
  }

  /**
   * Ejecuta algo que se ESPERA que falle, sin envenenar la transacción.
   * Devuelve el mensaje de error, o `null` si no falló.
   */
  async function intentar(
    db: pg.Client,
    sql: string,
    params: unknown[] = [],
  ): Promise<string | null> {
    await db.query("savepoint intento");
    try {
      await db.query(sql, params);
      await db.query("release savepoint intento");
      return null;
    } catch (error) {
      await db.query("rollback to savepoint intento");
      return error instanceof Error ? error.message : String(error);
    }
  }

  it("un domain_admin NO puede sancionar en otra comunidad", async () => {
    if (!escenario) return; // entorno sin dos comunidades: nada que probar
    const { tenantA, miembroB, actor } = escenario;

    const resultado = await comoRol("domain_admin", tenantA, actor, async (db) => {
      const error = await intentar(
        db,
        "select public.admin_suspend_user($1, 5, 'prueba de aislamiento')",
        [miembroB],
      );
      await comoDueño(db);
      const estado = await db.query<{ account_status: string }>(
        "select account_status from public.profiles where id = $1",
        [miembroB],
      );
      const sanciones = await db.query<{ n: string }>(
        "select count(*)::text as n from public.account_sanctions where profile_id = $1",
        [miembroB],
      );
      return { error, estado: estado.rows[0]?.account_status, sanciones: sanciones.rows[0]?.n };
    });

    // Rebota, y rebota con el mismo mensaje que "no existe": el error no puede
    // servir para averiguar quién es miembro de otra comunidad.
    expect(resultado.error).toContain("PROFILE_NOT_FOUND");
    // Y la base ni se toca.
    expect(resultado.estado).not.toBe("suspended");
    expect(resultado.sanciones).toBe("0");
  }, 60_000);

  it("un global_admin SÍ puede sancionar en otra comunidad", async () => {
    if (!escenario) return;
    const { tenantA, tenantB, miembroB, actor } = escenario;

    const resultado = await comoRol("global_admin", tenantA, actor, async (db) => {
      const error = await intentar(
        db,
        "select public.admin_suspend_user($1, 5, 'prueba de alcance global')",
        [miembroB],
      );
      await comoDueño(db);
      const estado = await db.query<{ account_status: string }>(
        "select account_status from public.profiles where id = $1",
        [miembroB],
      );
      const sancion = await db.query<{ tenant_id: string }>(
        `select tenant_id from public.account_sanctions
          where profile_id = $1 order by created_at desc limit 1`,
        [miembroB],
      );
      return {
        error,
        estado: estado.rows[0]?.account_status,
        sancionTenant: sancion.rows[0]?.tenant_id,
      };
    });

    expect(resultado.error).toBeNull();
    expect(resultado.estado).toBe("suspended");
    // La sanción se archiva en la comunidad DEL SANCIONADO, no en la del que
    // sanciona: si no, la comunidad afectada no podría auditarla.
    expect(resultado.sancionTenant).toBe(tenantB);
  }, 60_000);

  it("admin_lift_restriction cross-tenant falla y NO deja rastro escrito (0076)", async () => {
    if (!escenario) return;
    const { tenantA, miembroB, actor } = escenario;

    // El bug de 0033: la función filtraba el UPDATE por tenant (así que no
    // levantaba nada ajeno) pero insertaba la sanción igual y devolvía 204. El
    // registro quedaba afirmando una acción que nunca pasó. Lo que se mide acá
    // no es sólo el error: es que NO haya filas nuevas en ninguna de las dos
    // tablas donde queda constancia de una acción administrativa.
    const resultado = await comoRol("domain_admin", tenantA, actor, async (db) => {
      await comoDueño(db);
      const antes = await db.query<{ sanciones: string; auditoria: string }>(
        `select (select count(*)::text from public.account_sanctions) as sanciones,
                (select count(*)::text from public.audit_log)          as auditoria`,
      );

      await comoAuthenticated(db);
      const error = await intentar(
        db,
        "select public.admin_lift_restriction($1, 'marketplace')",
        [miembroB],
      );

      await comoDueño(db);
      const despues = await db.query<{ sanciones: string; auditoria: string }>(
        `select (select count(*)::text from public.account_sanctions) as sanciones,
                (select count(*)::text from public.audit_log)          as auditoria`,
      );

      return { error, antes: antes.rows[0], despues: despues.rows[0] };
    });

    expect(resultado.error).toContain("PROFILE_NOT_FOUND");
    expect(resultado.despues?.sanciones).toBe(resultado.antes?.sanciones);
    expect(resultado.despues?.auditoria).toBe(resultado.antes?.auditoria);
  }, 60_000);

  it("un global_admin puede restringir y levantar en otra comunidad (0076)", async () => {
    if (!escenario) return;
    const { tenantA, tenantB, miembroB, actor } = escenario;

    const resultado = await comoRol("global_admin", tenantA, actor, async (db) => {
      const errorRestringir = await intentar(
        db,
        "select public.admin_restrict_user($1, 'marketplace', 7, 'prueba de alcance global')",
        [miembroB],
      );
      const errorLevantar = await intentar(
        db,
        "select public.admin_lift_restriction($1, 'marketplace')",
        [miembroB],
      );
      await comoDueño(db);
      const levantadas = await db.query<{ n: string }>(
        `select count(*)::text as n from public.account_restrictions
          where profile_id = $1 and lifted_at is not null`,
        [miembroB],
      );
      const restriccion = await db.query<{ tenant_id: string }>(
        `select tenant_id from public.account_restrictions
          where profile_id = $1 order by created_at desc limit 1`,
        [miembroB],
      );
      return {
        errorRestringir,
        errorLevantar,
        levantadas: levantadas.rows[0]?.n,
        tenant: restriccion.rows[0]?.tenant_id,
      };
    });

    expect(resultado.errorRestringir).toBeNull();
    expect(resultado.errorLevantar).toBeNull();
    expect(Number(resultado.levantadas)).toBeGreaterThanOrEqual(1);
    // Archivada en la comunidad de la persona, no en la del súper admin.
    expect(resultado.tenant).toBe(tenantB);
  }, 60_000);

  it("un domain_admin NO puede editar un aviso de otra comunidad, y el súper admin sí", async () => {
    if (!escenario) return;
    const { tenantA, tenantB, actor } = escenario;

    const db = client as pg.Client;
    const aviso = await db.query<{ id: string }>(
      "select id from public.listings where tenant_id = $1 limit 1",
      [tenantB],
    );
    const listingId = aviso.rows[0]?.id;
    if (!listingId) return; // sin avisos en la otra comunidad no hay nada que probar

    const ajeno = await comoRol("domain_admin", tenantA, actor, async (conn) => {
      const res = await conn.query("update public.listings set status = status where id = $1", [
        listingId,
      ]);
      return res.rowCount;
    });
    // La RLS no lanza: filtra. Cero filas es el "no" de la base.
    expect(ajeno).toBe(0);

    const global = await comoRol("global_admin", tenantA, actor, async (conn) => {
      const res = await conn.query("update public.listings set status = status where id = $1", [
        listingId,
      ]);
      return res.rowCount;
    });
    expect(global).toBe(1);
  }, 60_000);

  it("un precio guardado se lee de vuelta exacto, y solo lo escribe quien corresponde", async () => {
    if (!escenario) return;
    const { tenantA, tenantB, actor } = escenario;

    const resultado = await comoRol("global_admin", tenantA, actor, async (db) => {
      const escrituraAjena = await db.query(
        `update public.tenant_prices set amount_cents = 12345, currency = 'USD', updated_by = $2
          where tenant_id = $1 and product = 'presencia' and variant = 'basico'
            and billing_interval = 'mensual'`,
        [tenantB, actor],
      );
      const leido = await db.query<{ amount_cents: number; currency: string }>(
        `select amount_cents, currency from public.tenant_prices
          where tenant_id = $1 and product = 'presencia' and variant = 'basico'
            and billing_interval = 'mensual'`,
        [tenantB],
      );
      await comoDueño(db);
      const historial = await db.query<{
        old_amount_cents: number | null;
        new_amount_cents: number;
      }>(
        `select old_amount_cents, new_amount_cents from public.tenant_price_history
          where tenant_id = $1 and product = 'presencia' and variant = 'basico'
            and billing_interval = 'mensual'
          order by changed_at desc limit 1`,
        [tenantB],
      );
      return { filas: escrituraAjena.rowCount, leido: leido.rows[0], historial: historial.rows[0] };
    });

    if (resultado.filas === 0) return; // la comunidad todavía no tiene semilla

    // Centavo por centavo: lo que se guardó es lo que se lee.
    expect(resultado.leido?.amount_cents).toBe(12345);
    expect(resultado.leido?.currency).toBe("USD");
    // Y el precio anterior quedó anotado: sin eso no se puede explicar un cobro viejo.
    expect(resultado.historial?.new_amount_cents).toBe(12345);
    expect(resultado.historial?.old_amount_cents).not.toBeNull();

    // Un miembro común no escribe precios ni en su propia comunidad.
    const comoMiembro = await comoRol("member", tenantA, actor, async (db) => {
      const res = await db.query(
        `update public.tenant_prices set amount_cents = 1
          where tenant_id = $1 and product = 'presencia'`,
        [tenantA],
      );
      return res.rowCount;
    });
    expect(comoMiembro).toBe(0);
  }, 60_000);

  it("los ingresos son solo para administradores, y un domain_admin no elige comunidad", async () => {
    if (!escenario) return;
    const { tenantA, tenantB, actor } = escenario;

    const comoMiembro = await comoRol("member", tenantA, actor, (db) =>
      intentar(
        db,
        "select * from public.admin_revenue_summary(null, now() - interval '30 days', now())",
      ),
    );
    expect(comoMiembro).toContain("FORBIDDEN");

    // Un domain_admin puede pedir OTRA comunidad sin recibir un error: el
    // parámetro se ignora y el alcance sigue siendo el suyo. Que no explote es
    // parte del contrato — el aislamiento se aplica callado, no a los gritos.
    const comoAdmin = await comoRol("domain_admin", tenantA, actor, async (db) => {
      const res = await db.query<{ tenant_id: string }>(
        "select * from public.admin_revenue_summary($1, now() - interval '30 days', now())",
        [tenantB],
      );
      return res.rows.every((row) => row.tenant_id === tenantA);
    });
    expect(comoAdmin).toBe(true);
  }, 60_000);
});

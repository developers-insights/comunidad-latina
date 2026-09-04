import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CATEGORIAS_DE_GRUPO,
  COPY_VETO,
  ETIQUETA_DE_CATEGORIA,
  administra,
  esCategoriaDeGrupo,
  esFotoDeGrupoValida,
  esUrlDeAvatarsPublico,
  miembrosLabel,
} from "./grupos";

/**
 * Estos tests leen el SQL de la migración a propósito.
 *
 * Una policy no se puede ejecutar desde vitest —haría falta una base con dos
 * sesiones— pero SÍ se puede dejar escrito qué tiene que decir, y que rompa el
 * día que alguien la afloje sin querer. Es lo mismo que ya hacen
 * `notifications/categories.test.ts` y `profile/privacy.test.ts` con sus
 * migraciones: la base es la fuente de verdad y el test impide que la app y el
 * SQL se separen en silencio.
 *
 * Lo que NO reemplaza: probar de verdad contra la base que un no-miembro no lee
 * un grupo privado. Eso se verifica en vivo (ver `npm run check:rls` y la nota
 * del informe de esta rama).
 */
const SQL_0133 = readFileSync(
  new URL("../../../supabase/migrations/0133_grupos_de_chat.sql", import.meta.url),
  "utf8",
);

const SQL_0134 = readFileSync(
  new URL("../../../supabase/migrations/0134_bandeja_por_persona.sql", import.meta.url),
  "utf8",
);

const SQL_0135 = readFileSync(
  new URL(
    "../../../supabase/migrations/0135_grupos_moderables_y_cierres.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Aísla el cuerpo de una policy para no matchear contra el archivo entero. */
function policy(sql: string, nombre: string): string {
  return aislar(sql, `create policy ${nombre} on`, nombre);
}

/**
 * Lo mismo para una policy que se REESCRIBE. La 0135 no crea las de la 0133:
 * las cambia con `alter policy`, que es la única forma de tocar una policy sin
 * borrarla y volver a crearla dejando una ventana sin ella en el medio.
 */
function alterPolicy(sql: string, nombre: string): string {
  return aislar(sql, `alter policy ${nombre} on`, nombre);
}

function aislar(sql: string, encabezado: string, nombre: string): string {
  const inicio = sql.indexOf(encabezado);
  expect(inicio, `no existe la policy ${nombre}`).toBeGreaterThan(-1);
  const resto = sql.slice(inicio);
  const fin = resto.indexOf(";\n");
  return resto.slice(0, fin === -1 ? undefined : fin);
}

describe("catálogo de categorías", () => {
  it("dice exactamente lo mismo que el CHECK de la 0133", () => {
    const check = SQL_0133.slice(
      SQL_0133.indexOf("category      text not null check (category in ("),
    ).slice(0, 300);

    for (const categoria of CATEGORIAS_DE_GRUPO) {
      expect(check).toContain(`'${categoria}'`);
    }
    // Y al revés: ninguna categoría del SQL falta en la app.
    const enSql = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...enSql].sort()).toEqual([...CATEGORIAS_DE_GRUPO].sort());
  });

  it("cada categoría tiene etiqueta visible", () => {
    for (const categoria of CATEGORIAS_DE_GRUPO) {
      expect(ETIQUETA_DE_CATEGORIA[categoria]).toBeTruthy();
    }
  });

  it("esCategoriaDeGrupo rechaza lo que la base rechazaría", () => {
    expect(esCategoriaDeGrupo("deportes")).toBe(true);
    expect(esCategoriaDeGrupo("bicicleta")).toBe(false);
    expect(esCategoriaDeGrupo(null)).toBe(false);
  });
});

describe("helpers de presentación", () => {
  it("no escribe '1 miembros'", () => {
    expect(miembrosLabel(1)).toBe("1 miembro");
    expect(miembrosLabel(0)).toBe("0 miembros");
    expect(miembrosLabel(12)).toBe("12 miembros");
  });

  it("administra() sólo para owner y admin", () => {
    expect(administra("owner")).toBe(true);
    expect(administra("admin")).toBe(true);
    expect(administra("member")).toBe(false);
    expect(administra(null)).toBe(false);
  });
});

describe("las policies de la 0133, escritas", () => {
  it("un grupo PRIVADO no lo ve quien no es miembro", () => {
    const select = policy(SQL_0133, "chat_groups_select");
    // La única forma de ver algo que no sea público es ser miembro.
    expect(select).toContain("visibility = 'public'");
    expect(select).toContain("app.es_miembro_de_grupo(id)");
    expect(select).toContain("tenant_id = (select app.current_tenant_id())");
  });

  it("los mensajes de un grupo los lee SÓLO un miembro, y sin vencidos", () => {
    const select = policy(SQL_0133, "chat_group_messages_select");
    expect(select).toContain("app.es_miembro_de_grupo(group_id)");
    expect(select).toContain("expires_at > now()");
    // El `deleted_at is null` que esta policy tenía acá lo REEMPLAZA la 0135:
    // era lo que hacía imposible bajar un mensaje (H-1). Ver el bloque de
    // tests de la 0135 más abajo.
  });

  it("quien fue expulsado no escribe: escribir exige membresía y grupo abierto", () => {
    const insert = policy(SQL_0133, "chat_group_messages_insert");
    expect(insert).toContain("sender_id = (select auth.uid())");
    expect(insert).toContain("app.es_miembro_de_grupo(group_id)");
    expect(insert).toContain("app.grupo_abierto(group_id)");
  });

  it("un mensaje no se edita: el with check sólo deja marcarlo borrado", () => {
    const update = policy(SQL_0133, "chat_group_messages_update");
    expect(update).toContain("deleted_at is not null");
  });

  it("nadie se auto-asciende a admin al entrar, y no se invita a quien te bloqueó", () => {
    const insert = policy(SQL_0133, "chat_group_members_insert");
    expect(insert).toContain("role = 'member'");
    expect(insert).toContain("app.pair_blocked");
    expect(insert).toContain("g.status = 'active'");
    expect(insert).toContain("g.visibility = 'public'");
  });

  it("el owner no se puede ir ni lo pueden expulsar", () => {
    const del = policy(SQL_0133, "chat_group_members_delete");
    expect(del).toContain("role <> 'owner'");
  });

  it("editar y cerrar el grupo es sólo de quien administra", () => {
    const update = policy(SQL_0133, "chat_groups_update");
    expect(update).toContain("app.rol_en_grupo(id) in ('owner', 'admin')");
  });

  it("las tres tablas tienen RLS forzada y su GRANT explícito", () => {
    // Los `alter table` van alineados en columnas en el SQL: se normalizan los
    // espacios antes de comparar para que el test no dependa del formato.
    const plano = SQL_0133.replace(/\s+/g, " ");
    for (const tabla of ["chat_groups", "chat_group_members", "chat_group_messages"]) {
      expect(plano).toContain(`alter table public.${tabla} enable row level security`);
      expect(plano).toContain(`alter table public.${tabla} force row level security`);
      // Sin GRANT la policy ni se evalúa y la app se ve vacía sin un error.
      expect(plano).toContain(`on table public.${tabla} to authenticated`);
    }
    // `anon` no recibe nada: un grupo no es contenido público de SEO.
    expect(SQL_0133).not.toMatch(/grant[^;]*on table public\.chat_group[^;]*to[^;]*anon/);
  });

  it("los mensajes de grupo se purgan como los directos (TTL 90 días)", () => {
    expect(SQL_0133).toContain("purge-expired-group-messages");
    expect(SQL_0133).toContain("interval '90 days'");
    expect(SQL_0133).toContain("app.forzar_ttl_de_mensaje_de_grupo");
  });
});

describe("las reglas de la 0134, escritas", () => {
  it("el buscador de personas no devuelve a quien bloqueaste ni a vos mismo", () => {
    expect(SQL_0134).toContain("not app.pair_blocked(v_uid, p.id)");
    expect(SQL_0134).toContain("p.id <> v_uid");
    expect(SQL_0134).toContain("p.tenant_id = v_tenant");
  });

  it("'Ignorar' sigue valiendo: no se abre un directo nuevo con quien te bloqueó", () => {
    expect(SQL_0134).toContain("c.status = 'blocked'");
    expect(SQL_0134).toContain("USER_BLOCKED");
  });

  it("el contacto directo nace pendiente, como todo el contacto protegido", () => {
    expect(SQL_0134).toContain("'pending'");
    expect(SQL_0134).toContain("CANNOT_CONTACT_SELF");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS CIERRES DE LA 0135
 *
 * Lo que se pudo probar CONTRA LA BASE está probado ahí y no acá: la 0135 se
 * corrió con `node scripts/dryrun-migraciones.mjs` y sesiones simuladas
 * (`set role authenticated` + claims del JWT), con rollback. Estos tests son la
 * otra mitad —que la app y el SQL no se separen en silencio— y son los que
 * rompen el día que alguien afloje una policy sin querer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("las policies de la 0135, escritas", () => {
  it("bajar un mensaje ya es posible: lo borrado lo ven su autor y quien administra", () => {
    const select = alterPolicy(SQL_0135, "chat_group_messages_select");
    // La razón del bug: el USING de un SELECT también manda sobre la fila nueva
    // de un UPDATE. Si volviera a exigir `deleted_at is null` a secas, borrar
    // volvería a dar 42501 para todos.
    expect(select).toContain("deleted_at is null");
    expect(select).toContain("or sender_id = (select auth.uid())");
    expect(select).toContain("or app.rol_en_grupo(group_id) in ('owner', 'admin')");
    // Y lo que NO se aflojó: sigue haciendo falta ser miembro y no estar vencido.
    expect(select).toContain("app.es_miembro_de_grupo(group_id)");
    expect(select).toContain("expires_at > now()");
  });

  it("el equipo llega SÓLO al mensaje que alguien reportó, nunca al grupo entero", () => {
    const select = alterPolicy(SQL_0135, "chat_group_messages_select");
    expect(select).toContain("app.current_user_role()) in ('domain_admin', 'global_admin')");
    // Sin este EXISTS la rama de staff sería lectura libre de toda conversación
    // de grupo de la comunidad, que es exactamente lo que la 0133 no quiso.
    expect(select).toContain("r.target_kind = 'group_message'");
    expect(select).toContain("r.target_id   = chat_group_messages.id");
    expect(select).toContain("r.tenant_id   = chat_group_messages.tenant_id");
  });

  it("el UPDATE del staff exige lo mismo en el using y en el with check", () => {
    const update = alterPolicy(SQL_0135, "chat_group_messages_update");
    const ramas = update.match(
      /app\.current_user_role\(\)\) in \('domain_admin', 'global_admin'\)/g,
    );
    expect(ramas).toHaveLength(2);
    // Y sigue sin poder hacer otra cosa que bajarlo.
    expect(update).toContain("deleted_at is not null");
  });

  it("de un mensaje sólo se puede cambiar deleted_at (el resto lo pisa el trigger)", () => {
    for (const columna of [
      "new.id",
      "new.tenant_id",
      "new.group_id",
      "new.sender_id",
      "new.body",
      "new.created_at",
      "new.expires_at",
    ]) {
      expect(SQL_0135).toContain(columna);
    }
    expect(SQL_0135).toContain("app.proteger_columnas_del_mensaje_de_grupo");
    expect(SQL_0135).toContain("before update on public.chat_group_messages");
    // `deleted_at` NO se pisa: es lo único que el UPDATE existe para cambiar.
    expect(SQL_0135).not.toContain("new.deleted_at := old.deleted_at");
  });

  it("expulsar veta: la rama de auto-alta mira chat_group_bans", () => {
    const insert = alterPolicy(SQL_0135, "chat_group_members_insert");
    expect(insert).toContain("from public.chat_group_bans b");
    expect(insert).toContain("b.profile_id = (select auth.uid())");
    // La rama de la invitación NO mira el veto: invitar es traer de vuelta.
    expect(insert).toContain("app.rol_en_grupo(g.id) in ('owner', 'admin')");
    expect(insert).toContain("app.pair_blocked");
  });

  it("un veto lo pone quien administra, firmado, y nunca sobre el dueño", () => {
    const insert = policy(SQL_0135, "chat_group_bans_insert");
    expect(insert).toContain("banned_by  = (select auth.uid())");
    expect(insert).toContain("app.rol_en_grupo(group_id) in ('owner', 'admin')");
    expect(insert).toContain("not app.es_dueno_del_grupo(group_id, profile_id)");
    expect(insert).toContain("profile_id <> (select auth.uid())");
  });

  it("la persona vetada puede ver SU veto, y nadie ve los ajenos", () => {
    const select = policy(SQL_0135, "chat_group_bans_select");
    expect(select).toContain("profile_id = (select auth.uid())");
    expect(select).toContain("app.rol_en_grupo(group_id) in ('owner', 'admin')");
    expect(select).toContain("tenant_id = (select app.current_tenant_id())");
  });

  it("un veto no se edita: la policy de UPDATE es false y el permiso no se otorga", () => {
    const update = policy(SQL_0135, "chat_group_bans_update");
    expect(update).toContain("using (false)");
    expect(update).toContain("with check (false)");
    // El candado de afuera: `update` no está en el GRANT.
    expect(SQL_0135).toContain(
      "grant select, insert, delete on table public.chat_group_bans to authenticated;",
    );
  });

  it("la tabla nueva cumple el contrato de scripts/rls-enumerator.mjs", () => {
    const plano = SQL_0135.replace(/\s+/g, " ");
    expect(plano).toContain("alter table public.chat_group_bans enable row level security");
    expect(plano).toContain("alter table public.chat_group_bans force row level security");
    for (const cmd of ["select", "insert", "update", "delete"]) {
      expect(plano).toContain(`create policy chat_group_bans_${cmd} on public.chat_group_bans`);
    }
    // `anon` no recibe nada, igual que con las tres tablas de la 0133.
    expect(SQL_0135).not.toMatch(/grant[^;]*on table public\.chat_group_bans[^;]*to[^;]*anon/);
  });

  it("expulsar es una RPC: las dos escrituras van juntas o no va ninguna", () => {
    expect(SQL_0135).toContain("create or replace function public.expulsar_de_grupo");
    // El rol se re-verifica ADENTRO: es definer, así que sin esto cualquiera
    // podría vaciar cualquier grupo.
    expect(SQL_0135).toContain("v_mi_rol not in ('owner', 'admin')");
    expect(SQL_0135).toContain("if v_su_rol = 'owner' then");
    expect(SQL_0135).toContain("insert into public.chat_group_bans");
    expect(SQL_0135).toContain("delete from public.chat_group_members m");
    expect(SQL_0135).toContain(
      "revoke all    on function public.expulsar_de_grupo(uuid, uuid) from public, anon;",
    );
  });

  it("las funciones nuevas van con search_path vacío", () => {
    for (const fn of [
      "app.proteger_columnas_del_mensaje_de_grupo",
      "app.es_dueno_del_grupo",
      "public.expulsar_de_grupo",
    ]) {
      expect(SQL_0135).toContain(fn);
    }
    // Ninguna definer de este archivo declara un search_path que no sea vacío.
    // Se mira sólo el CÓDIGO: la cabecera cita el `public, app` de la 0134 al
    // explicar por qué se cambia, y esa cita no es una declaración.
    const codigo = SQL_0135.split("\n")
      .filter((linea) => !linea.trimStart().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/set search_path = (?!'')/);
    // Y el cierre de H-6: la única que lo tenía queda como el resto.
    expect(SQL_0135).toContain(
      "alter function public.solicitar_contacto_directo(uuid) set search_path = '';",
    );
  });

  it("guardar_fotos_de_negocio ya no acepta un `..` en el path", () => {
    expect(SQL_0135).toContain("v_logo like '%..%'");
    expect(SQL_0135).toContain("v_cover like '%..%'");
    // Sin perder el chequeo de prefijo que ya tenía la 0127.
    expect(SQL_0135).toContain("pg_catalog.strpos(v_logo, v_prefijo) <> 1");
    expect(SQL_0135).toContain("pg_catalog.strpos(v_cover, v_prefijo) <> 1");
  });

  it("el bucket post-media queda en el mismo número que MAX_VIDEO_BYTES", () => {
    expect(SQL_0135).toContain("set file_size_limit = 209715200");
    expect(209715200).toBe(200 * 1024 * 1024);
  });
});

describe("la foto de un grupo tiene que ser una foto de esta comunidad (H-9)", () => {
  const SUPA = "https://proyecto.supabase.co";
  const TENANT = "019f39cf-5115-70bf-8a9e-8db074bf07d6";
  const OTRO_TENANT = "019f39cf-55e8-7bcc-a66a-2737ff672b16";
  const UID = "de5520a5-2701-4617-a24d-0ecaeb5c0629";
  const propia = `${SUPA}/storage/v1/object/public/avatars/${TENANT}/${UID}/grupo-1.jpg`;

  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  it("acepta la ruta que arma group-form al subir", () => {
    expect(esUrlDeAvatarsPublico(propia)).toBe(true);
    expect(esFotoDeGrupoValida(propia, TENANT)).toBe(true);
  });

  it("rechaza un host de terceros — es lo que recolectaría IPs desde Descubrir", () => {
    expect(
      esUrlDeAvatarsPublico(
        `https://rastreador.example/storage/v1/object/public/avatars/${TENANT}/${UID}/x.jpg`,
      ),
    ).toBe(false);
  });

  it("rechaza otro bucket del mismo proyecto", () => {
    expect(
      esUrlDeAvatarsPublico(
        `${SUPA}/storage/v1/object/public/job-cvs/${TENANT}/${UID}/cv.pdf`,
      ),
    ).toBe(false);
  });

  it("rechaza http cuando el proyecto es https", () => {
    expect(
      esUrlDeAvatarsPublico(
        `http://proyecto.supabase.co/storage/v1/object/public/avatars/${TENANT}/${UID}/x.jpg`,
      ),
    ).toBe(false);
  });

  it("rechaza la foto de OTRA comunidad del mismo proyecto", () => {
    const ajena = `${SUPA}/storage/v1/object/public/avatars/${OTRO_TENANT}/${UID}/x.jpg`;
    // Pasa el chequeo de host y bucket…
    expect(esUrlDeAvatarsPublico(ajena)).toBe(true);
    // …y no el del prefijo de la comunidad, que corre con el tenant del guard.
    // Por eso son dos funciones y no una.
    expect(esFotoDeGrupoValida(ajena, TENANT)).toBe(false);
  });

  it("un tenant que es PREFIJO de otro no cuela: el separador va en la comparación", () => {
    const url = `${SUPA}/storage/v1/object/public/avatars/${TENANT}-bis/${UID}/x.jpg`;
    expect(esFotoDeGrupoValida(url, TENANT)).toBe(false);
  });

  it("lo que no es una URL, y la cadena vacía, no rompen nada", () => {
    expect(esUrlDeAvatarsPublico("javascript:alert(1)")).toBe(false);
    expect(esUrlDeAvatarsPublico("no soy una url")).toBe(false);
    expect(esUrlDeAvatarsPublico("")).toBe(false);
    expect(esFotoDeGrupoValida("", TENANT)).toBe(false);
  });

  it("sin NEXT_PUBLIC_SUPABASE_URL no se acepta nada: falla cerrado", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(esUrlDeAvatarsPublico(propia)).toBe(false);
    expect(esFotoDeGrupoValida(propia, TENANT)).toBe(false);
  });
});

describe("el copy del veto", () => {
  it("no manda a reintentar algo que no va a funcionar", () => {
    expect(COPY_VETO.joinBanned).not.toMatch(/prob[áa] de nuevo|intent/i);
    expect(COPY_VETO.joinBanned.length).toBeLessThan(120);
  });

  it("la confirmación de expulsar ya no promete que puede volver", () => {
    expect(COPY_VETO.removeConfirmBody).not.toContain("puede volver a entrar");
    expect(COPY_VETO.removeConfirmBody).toContain("invitarlo de nuevo");
  });
});

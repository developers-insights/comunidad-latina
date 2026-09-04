import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_DE_GRUPO,
  ETIQUETA_DE_CATEGORIA,
  administra,
  esCategoriaDeGrupo,
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

/** Aísla el cuerpo de una policy para no matchear contra el archivo entero. */
function policy(sql: string, nombre: string): string {
  const inicio = sql.indexOf(`create policy ${nombre} on`);
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

  it("los mensajes de un grupo los lee SÓLO un miembro, y sin vencidos ni borrados", () => {
    const select = policy(SQL_0133, "chat_group_messages_select");
    expect(select).toContain("app.es_miembro_de_grupo(group_id)");
    expect(select).toContain("expires_at > now()");
    expect(select).toContain("deleted_at is null");
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

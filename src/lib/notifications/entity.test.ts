import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVISO_PARAM,
  NOTIFICATION_ENTITY_TYPES,
  isNotificationEntityType,
  listingAvisoHref,
  parseEntityKind,
} from "./entity";

const MIGRACION = readFileSync(
  join(process.cwd(), "supabase/migrations/0151_notificaciones_con_entidad.sql"),
  "utf8",
);

describe("entity types", () => {
  /**
   * El mismo modo de falla que ya tuvo `category` (0045): si el array de TS y el
   * CHECK de la base se separan, la base gana y el INSERT explota en producción,
   * no en el test. Por eso esto lee la migración en vez de repetir la lista.
   */
  it("espeja el CHECK de la base, literal por literal", () => {
    const check = MIGRACION.match(
      /notifications_entity_type_check[\s\S]*?entity_type in \(([^)]+)\)/,
    );
    expect(check).not.toBeNull();
    const enLaBase = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enLaBase).toEqual([...NOTIFICATION_ENTITY_TYPES]);
  });

  it("acepta sólo los tipos conocidos", () => {
    expect(isNotificationEntityType("listing")).toBe(true);
    expect(isNotificationEntityType("store")).toBe(false);
    expect(isNotificationEntityType(null)).toBe(false);
  });
});

describe("parseEntityKind", () => {
  it("acepta los verticales reales de listings.kind", () => {
    for (const kind of ["property", "job", "event", "business", "product", "creator_gig"]) {
      expect(parseEntityKind(kind)).toBe(kind);
    }
  });

  /**
   * La columna es `text` libre (su vocabulario depende de `entity_type`), así que
   * lo que llega se usa como CLAVE de un mapa de íconos en el cliente. Se valida
   * la misma forma que el CHECK `notifications_entity_kind_check`.
   */
  it("descarta lo que no tiene la forma del CHECK", () => {
    expect(parseEntityKind("Property")).toBeNull();
    expect(parseEntityKind("2fast")).toBeNull();
    expect(parseEntityKind("con-guion")).toBeNull();
    expect(parseEntityKind("a".repeat(33))).toBeNull();
    expect(parseEntityKind("")).toBeNull();
    expect(parseEntityKind(42)).toBeNull();
    expect(parseEntityKind(undefined)).toBeNull();
  });

  it("la forma que valida coincide con la del CHECK", () => {
    expect(MIGRACION).toContain("entity_kind ~ '^[a-z][a-z0-9_]{0,31}$'");
  });
});

describe("listingAvisoHref", () => {
  it("lleva a Mis publicaciones con la publicación señalada", () => {
    expect(listingAvisoHref("019f7d1d-633e-7ac6-9622-cde02ff09d8b")).toBe(
      "/publicaciones?aviso=019f7d1d-633e-7ac6-9622-cde02ff09d8b",
    );
  });

  it("usa el mismo parámetro que emite la base", () => {
    expect(MIGRACION).toContain("'/publicaciones?aviso=' ||");
    expect(AVISO_PARAM).toBe("aviso");
  });

  /**
   * ANCLA DEL BUG: los dos emisores de 0098 escribían el href fijo
   * '/publicaciones' para TODAS las notificaciones de vencimiento. Si alguien
   * vuelve a poner un literal sin el id, veinte avisos vuelven a aterrizar en la
   * misma lista y nadie sabe de cuál publicación le están hablando.
   */
  it("ningún emisor de vencimiento vuelve al destino genérico", () => {
    expect(MIGRACION).not.toMatch(/^\s*'\/publicaciones',\s*$/m);
  });
});

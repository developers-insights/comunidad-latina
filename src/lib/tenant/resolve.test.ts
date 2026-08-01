import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MODULE_KEYS } from "@/app/admin/dominio/modules";
import {
  resolveTenantSlug,
  isActiveCommunitySlug,
  RESERVED_BRAND_SLUGS,
  DEFAULT_TENANT_SLUG,
} from "./resolve";

/**
 * Alta de tenant SIN reprogramar (2026-08-01, cierra el lock de d293119):
 * cualquier slug resuelve dinámicamente salvo los reservados de marca/legal
 * (`RESERVED_BRAND_SLUGS`, hoy solo `comunidadlatina`). Antes este mismo
 * describe fijaba el comportamiento inverso (allowlist de un único slug
 * activo) — ese contrato viejo clampeaba a la comunidad por defecto a
 * CUALQUIER tenant nuevo, no solo a la marca. Ver el comentario de
 * `RESERVED_BRAND_SLUGS` en `./resolve` para el porqué completo.
 */
describe("resolveTenantSlug — comunidades nuevas resuelven sin tocar código", () => {
  it("el dominio real de la comunidad activa resuelve a esa comunidad", () => {
    expect(resolveTenantSlug("dominicanos.com", null, null)).toBe("dominicanos");
    expect(resolveTenantSlug("www.dominicanos.com", null, null)).toBe("dominicanos");
  });

  it("?t=comunidadlatina NO cruza: sigue reservado, cae a dominicanos", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "comunidadlatina", null),
    ).toBe("dominicanos");
  });

  it("una cookie cl-tenant=comunidadlatina vieja NO cruza: cae a dominicanos", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", null, "comunidadlatina"),
    ).toBe("dominicanos");
  });

  it("el dominio de la MARCA comunidadlatina.com cae a dominicanos (decisión de marca, no técnica)", () => {
    expect(resolveTenantSlug("comunidadlatina.com", null, null)).toBe("dominicanos");
    expect(resolveTenantSlug("www.comunidadlatina.com", null, null)).toBe("dominicanos");
  });

  it("sin host/param/cookie → comunidad por defecto", () => {
    expect(resolveTenantSlug(null, null, null)).toBe(DEFAULT_TENANT_SLUG);
    expect(DEFAULT_TENANT_SLUG).toBe("dominicanos");
  });

  it("?t=dominicanos (comunidad activa) sí se respeta", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "dominicanos", null),
    ).toBe("dominicanos");
  });

  it("una comunidad NUEVA (no reservada) resuelve tal cual, sin editar este archivo", () => {
    // Este es el caso que scripts/new-tenant.mjs necesita: un slug que recién
    // nace no está en ningún mapa hardcodeado, y aun así pasa — getTenant()
    // decide después, contra la DB, si existe de verdad.
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "colombianos-miami", null),
    ).toBe("colombianos-miami");
  });

  it("un slug con formato inválido (mayúsculas, símbolos, vacío) sigue cayendo al default", () => {
    // sanitizeSlug es el único filtro de FORMATO en esta capa — no de existencia.
    expect(resolveTenantSlug("comunidad-latina.vercel.app", "Con Espacios", null)).toBe(
      "dominicanos",
    );
    expect(resolveTenantSlug("comunidad-latina.vercel.app", "", null)).toBe("dominicanos");
  });

  it("isActiveCommunitySlug distingue reservado de marca vs. cualquier otro", () => {
    expect(isActiveCommunitySlug("dominicanos")).toBe(true);
    expect(isActiveCommunitySlug("comunidadlatina")).toBe(false);
    expect(isActiveCommunitySlug("colombianos-miami")).toBe(true);
    expect(isActiveCommunitySlug(null)).toBe(false);
    expect(isActiveCommunitySlug(undefined)).toBe(false);
  });
});

/**
 * Sincronía JS↔TS (mismo patrón que scripts/seed-modules.test.ts): scripts/
 * new-tenant.mjs no puede importar RESERVED_BRAND_SLUGS (es TS, el script es
 * .mjs plano — mismo problema que documenta seed.mjs con MODULE_KEYS), así que
 * duplica la lista a mano. Este test es la única defensa contra que diverjan:
 * si alguien suma un slug reservado acá y no allá (o al revés), un script de
 * alta podría crear silenciosamente una comunidad que nunca va a ser alcanzable.
 */
describe("RESERVED_BRAND_SLUGS — sincronía con scripts/new-tenant.mjs", () => {
  it("la lista hardcodeada en el script coincide exactamente", () => {
    const scriptPath = fileURLToPath(
      new URL("../../../scripts/new-tenant.mjs", import.meta.url),
    );
    const source = readFileSync(scriptPath, "utf8");
    const match = source.match(/RESERVED_BRAND_SLUGS\s*=\s*\[([^\]]*)\]/);
    expect(match, "scripts/new-tenant.mjs debe declarar RESERVED_BRAND_SLUGS = [...]").toBeTruthy();
    const fromScript = new Set(
      (match![1].match(/["'`]([a-z0-9-]+)["'`]/g) ?? []).map((s) => s.slice(1, -1)),
    );
    expect(fromScript).toEqual(RESERVED_BRAND_SLUGS);
  });

  it("la lista de módulos por defecto del script coincide con MODULE_KEYS (canon)", () => {
    // Mismo problema que scripts/seed.mjs documenta para su propio MODULE_KEYS:
    // new-tenant.mjs es .mjs plano y no puede `import` un módulo que arrastra
    // zod + @/components/shell/module-access, así que duplica la lista. Si
    // modules.ts suma/saca una clave y el script no se entera, una comunidad
    // nacida por el script queda con un módulo de menos (o uno fantasma) sin
    // que nadie lo note hasta que alguien mira /admin/dominio.
    const scriptPath = fileURLToPath(
      new URL("../../../scripts/new-tenant.mjs", import.meta.url),
    );
    const source = readFileSync(scriptPath, "utf8");
    const match = source.match(/const MODULE_KEYS = \[([^\]]*)\]/);
    expect(match, "scripts/new-tenant.mjs debe declarar MODULE_KEYS = [...]").toBeTruthy();
    const fromScript = (match![1].match(/["'`]([a-z0-9-]+)["'`]/g) ?? []).map((s) => s.slice(1, -1));
    expect(fromScript).toEqual([...MODULE_KEYS]);
  });
});

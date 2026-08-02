import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { MODULE_KEYS } from "@/app/admin/dominio/modules";
import {
  resolveTenantSlug,
  isActiveCommunitySlug,
  clientTenantHintsAllowed,
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
    //
    // OJO: esto vale en DEV/PREVIEW (4º argumento en true). En producción `?t=`
    // se ignora — ver el describe "producción ignora las pistas del cliente".
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "colombianos-miami", null, true),
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
 * FUGA CROSS-TENANT DEL ASISTENTE (auditoría 2026-08-02, ronda 2).
 *
 * Reproducida en vivo antes de arreglarla, contra la base real y simulando
 * producción: parado en el host de producción (`comunidad-latina-sigma.vercel.app`,
 * el ÚNICO dominio del proyecto en Vercel y que NO está en `DOMAIN_TENANTS`),
 * agregar `?t=<otra-comunidad>` movía el tenant del request, y el Asistente
 * —que atiende ANÓNIMOS y busca en el RAG con `service_role`, o sea con la RLS
 * salteada— devolvía los `rag_chunks` de esa otra comunidad. La RPC
 * `match_chunks_fts` es SECURITY DEFINER y filtra SOLO por su argumento
 * `p_tenant_id`: no hay nada debajo que lo frene, y un anónimo no tiene JWT.
 *
 * El contrato que fijan estos tests: en producción el HOST es la única fuente
 * del tenant. Si estos tests se ponen en rojo porque "hay que poder pasar ?t=
 * en prod", la respuesta correcta es sumar el dominio de esa comunidad a
 * `DOMAIN_TENANTS`, no aflojar esto.
 */
describe("producción ignora las pistas del cliente (?t= y cookie cl-tenant)", () => {
  // `vi.stubEnv` y no asignación directa: @types/node declara NODE_ENV como
  // read-only, y stubEnv además restaura solo con unstubAllEnvs.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("EL ATAQUE: ?t=<otra-comunidad> desde el host de producción NO mueve el tenant", () => {
    expect(
      resolveTenantSlug("comunidad-latina-sigma.vercel.app", "barrio-vecino", null, false),
    ).toBe(DEFAULT_TENANT_SLUG);
  });

  it("la cookie cl-tenant tampoco mueve el tenant en producción", () => {
    expect(
      resolveTenantSlug("comunidad-latina-sigma.vercel.app", null, "barrio-vecino", false),
    ).toBe(DEFAULT_TENANT_SLUG);
  });

  it("en producción el dominio mapeado sigue mandando, y ?t= no lo puede pisar", () => {
    expect(resolveTenantSlug("dominicanos.com", null, null, false)).toBe("dominicanos");
    // Aunque el atacante insista con el param, gana el host:
    expect(resolveTenantSlug("dominicanos.com", "barrio-vecino", null, false)).toBe(
      "dominicanos",
    );
  });

  it("en dev/preview la MISMA petición sí resuelve — el ayudante de desarrollo sigue vivo", () => {
    expect(
      resolveTenantSlug("comunidad-latina-sigma.vercel.app", "barrio-vecino", null, true),
    ).toBe("barrio-vecino");
  });

  it("clientTenantHintsAllowed: false en producción (por NODE_ENV o por VERCEL_ENV)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(clientTenantHintsAllowed()).toBe(false);

    // Vercel corre el build con NODE_ENV=production igual, pero el discriminante
    // entre preview y producción es VERCEL_ENV: un preview NO es producción.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(clientTenantHintsAllowed()).toBe(false);
  });

  it("clientTenantHintsAllowed: true en dev y en previews de Vercel", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(clientTenantHintsAllowed()).toBe(true);

    vi.stubEnv("VERCEL_ENV", "preview");
    expect(clientTenantHintsAllowed()).toBe(true);
  });

  it("por defecto (sin 4º argumento) la decisión la toma el entorno", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(resolveTenantSlug("comunidad-latina-sigma.vercel.app", "barrio-vecino")).toBe(
      DEFAULT_TENANT_SLUG,
    );

    vi.stubEnv("VERCEL_ENV", "preview");
    expect(resolveTenantSlug("comunidad-latina-sigma.vercel.app", "barrio-vecino")).toBe(
      "barrio-vecino",
    );
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

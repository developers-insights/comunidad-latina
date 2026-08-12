import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { scanContentAsset, type ScanThresholds } from "./scan";

/**
 * =============================================================================
 * EL ESCANEO — dos mitades, probadas donde cada una vive
 * =============================================================================
 *
 * Desde que la 0070 expuso `public.scan_content_asset`, la lógica de matching
 * dejó de tener un espejo en TypeScript: vive SÓLO en SQL. Eso parte la prueba
 * en dos, y las dos están acá:
 *
 *   1. LA DELEGACIÓN (mocks) — que la app llame a la función con los argumentos
 *      correctos, no reimplemente nada, y degrade bien cuando el escaneo falla.
 *   2. EL CONTRATO CON LA BASE (leyendo la migración) — que las invariantes que
 *      antes probaba el espejo sigan escritas donde ahora viven. Es el mismo
 *      patrón que `lib/notifications/categories.test.ts`, que lee la 0045 para
 *      que la app y el CHECK de la base no se separen en silencio.
 *
 * La tercera pata —que una imagen recomprimida realmente quede cerca y una
 * distinta lejos— la prueban `phash.test.ts` e `image.test.ts` con archivos de
 * verdad: esa parte es de la app y no se movió a SQL.
 */

const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type OpResult = { data?: unknown; error?: unknown; count?: number };

/** Stub encadenable del cliente admin (patrón del repo). */
function createAdminStub(plan: Record<string, OpResult> = {}) {
  const calls: Array<{ key: string; args: unknown[] }> = [];

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      then: (resolve: (value: OpResult) => unknown) =>
        Promise.resolve(plan[`${table}.select`] ?? { count: 0, error: null }).then(resolve),
      maybeSingle: async () => plan[`${table}.select`] ?? { data: null, error: null },
    };
    for (const method of ["select", "eq", "in", "limit"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ key: `${table}.${method}`, args });
        return builder;
      });
    }
    return builder;
  });

  const rpc = vi.fn(async (name: string, args: unknown) => {
    calls.push({ key: `rpc.${name}`, args: [args] });
    return plan[`rpc.${name}`] ?? { data: null, error: null };
  });

  return { client: { from, rpc }, from, rpc, calls };
}

function run(stub: ReturnType<typeof createAdminStub>, thresholds?: ScanThresholds) {
  return scanContentAsset(
    stub.client as unknown as SupabaseClient<Database>,
    ASSET,
    thresholds,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ========================================================================== */
/* 1. DELEGACIÓN                                                              */
/* ========================================================================== */

describe("la app delega en la función de la base y no reimplementa nada", () => {
  it("llama a public.scan_content_asset con el asset y el umbral", async () => {
    const stub = createAdminStub({
      "rpc.scan_content_asset": { data: 1, error: null },
      "content_integrity_alerts.select": { count: 1, error: null },
    });

    const result = await run(stub);

    expect(stub.rpc).toHaveBeenCalledTimes(1);
    // Los tres en null = "usá los umbrales de esta comunidad" (0088). Que la
    // app NO mande un número es la propiedad que se prueba acá.
    expect(stub.rpc).toHaveBeenCalledWith("scan_content_asset", {
      p_asset_id: ASSET,
      p_max_distance: null,
      p_max_distance_video: null,
      p_max_distance_audio: null,
    });
    expect(result).toEqual({ ok: true, openAlerts: 1 });
  });

  it("respeta el umbral que le pasa quien llama (depende del medio)", async () => {
    const stub = createAdminStub({
      "rpc.scan_content_asset": { data: 0, error: null },
      "content_integrity_alerts.select": { count: 0, error: null },
    });

    await run(stub, { image: 4 });

    expect(stub.rpc).toHaveBeenCalledWith("scan_content_asset", {
      p_asset_id: ASSET,
      p_max_distance: 4,
      p_max_distance_video: null,
      p_max_distance_audio: null,
    });
  });

  it("NO escribe matches ni alertas por su cuenta: sólo cuenta las abiertas", async () => {
    const stub = createAdminStub({
      "rpc.scan_content_asset": { data: 3, error: null },
      "content_integrity_alerts.select": { count: 2, error: null },
    });

    await run(stub);

    // Una sola tabla tocada, y sólo para leer.
    expect(stub.from.mock.calls.map(([table]) => table)).toEqual([
      "content_integrity_alerts",
    ]);
    expect(stub.calls).toContainEqual({
      key: "content_integrity_alerts.eq",
      args: ["status", "abierta"],
    });
  });

  it("las alertas abiertas NO se deducen del valor que devolvió la función", async () => {
    // La función devuelve 0 matches exactos nuevos, pero hay una alerta abierta
    // (una coincidencia similar, o una licencia faltante). El contenido tiene
    // que ir a revisión igual.
    const stub = createAdminStub({
      "rpc.scan_content_asset": { data: 0, error: null },
      "content_integrity_alerts.select": { count: 1, error: null },
    });

    await expect(run(stub)).resolves.toEqual({ ok: true, openAlerts: 1 });
  });
});

describe("degradación — nunca lanza", () => {
  it("si la RPC falla, devuelve ok:false con el motivo", async () => {
    const stub = createAdminStub({
      "rpc.scan_content_asset": {
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      },
    });

    await expect(run(stub)).resolves.toEqual({
      ok: false,
      error: "canceling statement due to statement timeout",
    });
  });

  it("si el conteo de alertas falla, tampoco se reporta un éxito falso", async () => {
    const stub = createAdminStub({
      "rpc.scan_content_asset": { data: 1, error: null },
      "content_integrity_alerts.select": { error: { message: "sin conexión" } },
    });

    await expect(run(stub)).resolves.toEqual({ ok: false, error: "sin conexión" });
  });

  it("una excepción inesperada del cliente sale como resultado, no como throw", async () => {
    const broken = {
      rpc: () => {
        throw new Error("cliente roto");
      },
      from: () => {
        throw new Error("cliente roto");
      },
    };

    await expect(
      scanContentAsset(broken as unknown as SupabaseClient<Database>, ASSET),
    ).resolves.toEqual({ ok: false, error: "cliente roto" });
  });
});

/* ========================================================================== */
/* 2. CONTRATO CON LA BASE                                                    */
/* ========================================================================== */

/**
 * Las invariantes que antes probaba el espejo en TypeScript. Ahora viven en SQL
 * y se anclan leyendo la migración: si alguien las afloja, este test lo dice.
 */
const MIGRATION_0061 = readFileSync(
  fileURLToPath(
    new URL("../../../supabase/migrations/0061_content_integrity.sql", import.meta.url),
  ),
  "utf8",
);

const MIGRATION_0070 = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/0070_envoltorios_public_para_la_app.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("contrato con la base — duplicado EXACTO", () => {
  it("se detecta por sha256, que es determinístico", () => {
    expect(MIGRATION_0061).toContain("and a.sha256 = v_asset.sha256");
    expect(MIGRATION_0061).toContain("'exacto', 'sha256', 0");
  });

  it("abre una alerta `duplicado_exacto` con severidad alta", () => {
    expect(MIGRATION_0061).toContain("then 'duplicado_exacto'");
    expect(MIGRATION_0061).toContain("when m.match_type = 'exacto' then 'alta'");
  });
});

describe("contrato con la base — coincidencia SIMILAR", () => {
  it("usa la distancia de Hamming de pgvector, no una métrica inventada", () => {
    expect(MIGRATION_0061).toContain("OPERATOR(extensions.<~>)");
    expect(MIGRATION_0061).toContain("bit_hamming_ops");
  });

  it("sólo cuenta como similar si la distancia es mayor a cero", () => {
    // Distancia 0 es un duplicado exacto y ya tiene su propio camino: contarlo
    // dos veces sería abrirle dos alertas al mismo archivo.
    expect(MIGRATION_0061).toContain("and s.distance > 0");
  });

  it("abre una alerta `coincidencia_similar`, distinta de la de duplicado", () => {
    expect(MIGRATION_0061).toContain("else 'coincidencia_similar'");
  });
});

describe("contrato con la base — el matching NO cruza tenants", () => {
  it("el duplicado exacto filtra por el tenant del asset sonda", () => {
    expect(MIGRATION_0061).toContain("where a.tenant_id = v_asset.tenant_id");
  });

  it("las TRES ramas de búsqueda perceptual filtran por tenant (imagen, video, audio)", () => {
    const matches = MIGRATION_0061.match(/a\.tenant_id = v_probe\.tenant_id/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("y la RLS lo vuelve a exigir al leer matches y alertas", () => {
    expect(MIGRATION_0061).toContain("tenant_id = (select app.current_tenant_id())");
  });
});

describe("contrato con la base — no se acusa a quien subió primero", () => {
  it("el duplicado exacto sólo mira assets anteriores", () => {
    expect(MIGRATION_0061).toContain("and a.first_uploaded_at <= v_asset.first_uploaded_at");
  });

  it("la coincidencia similar también", () => {
    expect(MIGRATION_0061).toContain("where a2.first_uploaded_at <= v_asset.first_uploaded_at");
  });
});

describe("contrato con la base — el envoltorio no agranda la superficie pública", () => {
  it("EXECUTE de scan_content_asset es sólo para service_role", () => {
    expect(MIGRATION_0070).toContain(
      "grant execute on function public.scan_content_asset(uuid, integer) to service_role;",
    );
    expect(MIGRATION_0070).toContain(
      "revoke all on function public.scan_content_asset(uuid, integer) from anon;",
    );
    expect(MIGRATION_0070).toContain(
      "revoke all on function public.scan_content_asset(uuid, integer) from authenticated;",
    );
  });

  it("el envoltorio no eleva privilegios: es SECURITY INVOKER", () => {
    // El cuerpo interno de `app` ya es definer. Declararlo definer también acá
    // sería privilegio de más y un advisory nuevo sin ninguna ganancia.
    expect(MIGRATION_0070).toContain("security invoker");
    expect(MIGRATION_0070).not.toContain("security definer");
  });
});

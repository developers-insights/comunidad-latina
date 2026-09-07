import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEMS_POR_TANDA } from "@/lib/messaging/galeria";

/**
 * ═══ LO QUE ESTA CONSULTA NO PUEDE ROMPER ══════════════════════════════════
 *
 *  1. UN MENSAJE BAJADO NO APARECE. La 0135 abrió `chat_group_messages_select`
 *     para que su autor y quien administra sigan viendo la fila borrada —hacía
 *     falta para que el UPDATE del borrado no muriera— así que la base SÍ se la
 *     devuelve a esas dos personas. Sin el `deleted_at is null` explícito, la
 *     galería les mostraría lo que alguien decidió bajar.
 *  2. CADA SOLAPA PIDE LO SUYO, y Enlaces junta las tarjetas de la comunidad
 *     con los mensajes de texto que traen una URL.
 *  3. LA PAGINACIÓN NO SALTEA NADA. El cursor sale de la última fila que vino
 *     de la BASE, no del último ítem que sobrevivió al refinado.
 */

const espia = vi.hoisted(() => ({
  llamadas: [] as { metodo: string; args: unknown[] }[],
  filas: [] as unknown[],
  error: null as unknown,
}));

function builder() {
  const registrar = (metodo: string) => (...args: unknown[]) => {
    espia.llamadas.push({ metodo, args });
    return api;
  };
  const api: Record<string, unknown> = {
    select: registrar("select"),
    eq: registrar("eq"),
    is: registrar("is"),
    in: registrar("in"),
    or: registrar("or"),
    order: registrar("order"),
    limit: (...args: unknown[]) => {
      espia.llamadas.push({ metodo: "limit", args });
      return Promise.resolve({ data: espia.filas, error: espia.error });
    },
  };
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      espia.llamadas.push({ metodo: "from", args: [tabla] });
      return builder();
    },
  }),
}));

import { leerGaleriaDelGrupo } from "./queries";

const GRUPO = "11111111-2222-4333-8444-555555555555";
const AUTOR = "99999999-9999-4999-8999-999999999999";

function mensaje(overrides: Record<string, unknown> = {}) {
  return {
    id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(overrides.n ?? 1).padStart(12, "0")}`,
    sender_id: AUTOR,
    body: "",
    created_at: "2026-09-07T12:00:00+00:00",
    kind: "imagen",
    deleted_at: null,
    adjunto: { path: "t/u/a.jpg", mime: "image/jpeg", bytes: 100 },
    ...overrides,
  };
}

const usados = (metodo: string) =>
  espia.llamadas.filter((llamada) => llamada.metodo === metodo).map((llamada) => llamada.args);

beforeEach(() => {
  espia.llamadas = [];
  espia.filas = [];
  espia.error = null;
});

describe("los borrados no aparecen", () => {
  it("filtra por deleted_at is null en las tres solapas, siempre", async () => {
    for (const solapa of ["multimedia", "archivos", "enlaces"] as const) {
      espia.llamadas = [];
      await leerGaleriaDelGrupo({ groupId: GRUPO, solapa });
      expect(usados("is")).toContainEqual(["deleted_at", null]);
    }
  });
});

describe("cada solapa pide lo suyo", () => {
  it("multimedia trae fotos y videos", async () => {
    await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "multimedia" });
    expect(usados("in")).toContainEqual(["kind", ["imagen", "video"]]);
  });

  it("archivos trae sólo kind = archivo", async () => {
    await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "archivos" });
    expect(usados("eq")).toContainEqual(["kind", "archivo"]);
  });

  it("enlaces junta las tarjetas de la comunidad con el texto que trae una URL", async () => {
    await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "enlaces" });
    const filtro = usados("or").map(String).join(" ");
    expect(filtro).toContain("kind.eq.contenido");
    expect(filtro).toContain("kind.eq.texto");
    expect(filtro).toContain("body.ilike");
  });

  it("siempre se limita al grupo pedido y se ordena de lo nuevo a lo viejo", async () => {
    await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "multimedia" });
    expect(usados("eq")).toContainEqual(["group_id", GRUPO]);
    expect(usados("order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });
});

describe("la paginación", () => {
  it("pide una fila de más para saber si hay otra tanda", async () => {
    await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "multimedia" });
    expect(usados("limit")).toEqual([[ITEMS_POR_TANDA + 1]]);
  });

  it("sin fila de más, no hay cursor siguiente", async () => {
    espia.filas = [mensaje({ n: 1 })];
    const tanda = await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "multimedia" });
    expect(tanda.mensajes).toHaveLength(1);
    expect(tanda.siguiente).toBeNull();
  });

  it("con fila de más, devuelve la tanda justa y el cursor de la última", async () => {
    espia.filas = Array.from({ length: ITEMS_POR_TANDA + 1 }, (_, i) =>
      mensaje({ n: i + 1, created_at: `2026-09-07T12:00:${String(i).padStart(2, "0")}+00:00` }),
    );
    const tanda = await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "multimedia" });
    expect(tanda.mensajes).toHaveLength(ITEMS_POR_TANDA);
    expect(tanda.siguiente).toEqual({
      createdAt: tanda.mensajes[ITEMS_POR_TANDA - 1].created_at,
      id: tanda.mensajes[ITEMS_POR_TANDA - 1].id,
    });
  });

  it("el keyset desempata por id — dos fotos del mismo instante no se saltean", async () => {
    await leerGaleriaDelGrupo({
      groupId: GRUPO,
      solapa: "multimedia",
      cursor: { createdAt: "2026-09-07T12:00:00+00:00", id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001" },
    });
    const filtro = usados("or").map(String).join(" ");
    expect(filtro).toContain("created_at.lt.2026-09-07T12:00:00+00:00");
    expect(filtro).toContain("and(created_at.eq.2026-09-07T12:00:00+00:00,id.lt.");
  });

  /**
   * En Enlaces el prefiltro `ilike '%http%'` trae filas que después se
   * descartan. Si el cursor saliera del último ítem SOBREVIVIENTE, la tanda
   * siguiente volvería a traer —y a descartar— las mismas filas, y en el peor
   * caso el "Ver más" no avanzaría nunca.
   */
  it("en enlaces, el cursor sale de la última fila de la BASE, no del último ítem", async () => {
    espia.filas = [
      ...Array.from({ length: ITEMS_POR_TANDA - 1 }, (_, i) =>
        mensaje({ n: i + 1, kind: "texto", body: "https://ejemplo.com/a", adjunto: null }),
      ),
      // Sobrevive al prefiltro de SQL pero no es un enlace: se descarta.
      mensaje({ n: 90, kind: "texto", body: "instalé httpd en el server", adjunto: null }),
      mensaje({ n: 91, kind: "texto", body: "https://ejemplo.com/z", adjunto: null }),
    ];

    const tanda = await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "enlaces" });

    expect(tanda.mensajes).toHaveLength(ITEMS_POR_TANDA - 1);
    expect(tanda.mensajes.some((m) => m.body.includes("httpd"))).toBe(false);
    expect(tanda.siguiente?.id).toBe(mensaje({ n: 90 }).id);
  });
});

describe("cuando la base falla", () => {
  it("devuelve vacío en vez de tirar la pantalla abajo", async () => {
    espia.error = { code: "42501" };
    const tanda = await leerGaleriaDelGrupo({ groupId: GRUPO, solapa: "archivos" });
    expect(tanda).toEqual({ mensajes: [], siguiente: null });
  });
});

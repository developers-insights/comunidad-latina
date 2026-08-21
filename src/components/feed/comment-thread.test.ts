import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  fetchCommentThreadPage,
  filterBlockedComments,
} from "./comment-thread";

/**
 * El keyset del hilo vive UNA sola vez y lo usan tres lugares: el detalle SSR,
 * la server action de "ver anteriores" y la hoja de comentarios del feed. Estas
 * pruebas fijan el contrato que los tres comparten — sobre todo las dos cosas
 * que un refactor rompe sin que nada más se ponga en rojo:
 *
 *  · se pide UNA fila de más para saber si hay tanda anterior sin pagar una
 *    segunda consulta (y esa fila NO se entrega);
 *  · el cursor sale de la última fila LEÍDA, que después el filtro de
 *    bloqueados puede sacar de la vista sin que la paginación se saltee nada.
 */

interface FilaFalsa {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  status: string;
}

function fila(n: number): FilaFalsa {
  return {
    id: `0000000${n}-2222-3333-4444-555555555555`,
    body: `comentario ${n}`,
    // Descendente, como los devuelve la query: el 1 es el MÁS NUEVO.
    created_at: `2026-08-2${9 - n}T10:00:00Z`,
    author_id: `autor-${n}`,
    status: "published",
  };
}

function supabaseFalso(filas: FilaFalsa[], error: { code: string } | null = null) {
  const registro = { eq: [] as [string, unknown][], or: [] as string[], limit: 0 };
  const builder = {
    select: () => builder,
    eq: (columna: string, valor: unknown) => {
      registro.eq.push([columna, valor]);
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      registro.limit = n;
      return builder;
    },
    or: (filtro: string) => {
      registro.or.push(filtro);
      return builder;
    },
    then: (resolver: (valor: unknown) => unknown) =>
      resolver({ data: error ? null : filas, error }),
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient<Database>,
    registro,
  };
}

describe("fetchCommentThreadPage", () => {
  it("pide una fila de más y no la entrega: es sólo para saber si hay tanda anterior", async () => {
    const { client, registro } = supabaseFalso([fila(1), fila(2), fila(3)]);

    const resultado = await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: null,
      pageSize: 2,
    });

    expect(registro.limit).toBe(3);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.page.rows).toHaveLength(2);
    expect(resultado.page.hasOlder).toBe(true);
  });

  it("entrega la tanda en orden de lectura: el más viejo arriba", async () => {
    const { client } = supabaseFalso([fila(1), fila(2)]);

    const resultado = await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: null,
      pageSize: 10,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.page.rows.map((row) => row.body)).toEqual([
      "comentario 2",
      "comentario 1",
    ]);
    expect(resultado.page.hasOlder).toBe(false);
  });

  it("el cursor sale de la última fila LEÍDA, no de la que sobrevive al filtro", async () => {
    const { client } = supabaseFalso([fila(1), fila(2), fila(3)]);

    const resultado = await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: null,
      pageSize: 2,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // fila(2) es la más vieja de las DOS que entran en la tanda.
    expect(resultado.page.olderCursor).toEqual({
      createdAt: fila(2).created_at,
      id: fila(2).id,
    });

    // Y aunque el bloqueo se lleve justo esa fila de la vista, el cursor sigue
    // apuntando ahí: la tanda siguiente arranca donde terminó ésta.
    const visibles = filterBlockedComments(
      resultado.page.rows,
      new Set(["autor-2"]),
    );
    expect(visibles.map((row) => row.body)).toEqual(["comentario 1"]);
  });

  it("filtra por tenant (columna líder del índice del hilo) y por post publicado", async () => {
    const { client, registro } = supabaseFalso([]);

    await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: null,
      pageSize: 10,
    });

    expect(registro.eq).toEqual([
      ["post_id", "post-1"],
      ["status", "published"],
      ["tenant_id", "tenant-1"],
    ]);
  });

  it("sin tenant conocido pide igual: es plan de query, no frontera de seguridad", async () => {
    const { client, registro } = supabaseFalso([]);

    await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: null,
      olderThan: null,
      pageSize: 10,
    });

    expect(registro.eq.map(([columna]) => columna)).not.toContain("tenant_id");
  });

  it("el cursor entra como keyset (fecha, y el id sólo para desempatar)", async () => {
    const { client, registro } = supabaseFalso([]);

    await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: { createdAt: "2026-08-20T10:00:00Z", id: "abc" },
      pageSize: 10,
    });

    expect(registro.or).toEqual([
      'created_at.lt."2026-08-20T10:00:00Z",and(created_at.eq."2026-08-20T10:00:00Z",id.lt."abc")',
    ]);
  });

  it("si la lectura falla devuelve ok:false, nunca una tanda vacía que mienta", async () => {
    const { client } = supabaseFalso([], { code: "PGRST301" });

    const resultado = await fetchCommentThreadPage(client, {
      postId: "post-1",
      tenantId: "tenant-1",
      olderThan: null,
      pageSize: 10,
    });

    expect(resultado.ok).toBe(false);
  });
});

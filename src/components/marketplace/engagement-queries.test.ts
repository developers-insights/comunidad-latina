import { describe, expect, it } from "vitest";
import { fetchListingSavedBatch } from "./engagement-queries";

type Filters = Record<string, unknown>;

/**
 * Cliente Supabase de mentira que REGISTRA cuántas consultas se hicieron. El
 * punto de `fetchListingSavedBatch` es que sea UNA sola para toda la página, así
 * que el contador es la aserción que importa: si alguien la reescribe como un
 * loop por id, el test cae aunque el resultado siga siendo correcto.
 */
function fakeSupabase(rows: { subject_id: string }[], opts: { error?: boolean } = {}) {
  const queries: Filters[] = [];
  const client = {
    from(table: string) {
      const filters: Filters = { table };
      queries.push(filters);
      const builder = {
        select(cols: string) {
          filters.select = cols;
          return builder;
        },
        eq(col: string, value: unknown) {
          filters[col] = value;
          return builder;
        },
        in(col: string, values: readonly string[]) {
          filters[`${col}__in`] = [...values];
          return Promise.resolve(
            opts.error ? { data: null, error: { code: "42501" } } : { data: rows, error: null },
          );
        },
      };
      return builder;
    },
  };
  return { client: client as never, queries };
}

const IDS = ["a1", "b2", "c3"];

describe("fetchListingSavedBatch", () => {
  it("resuelve toda la página con UNA sola consulta", async () => {
    const { client, queries } = fakeSupabase([{ subject_id: "a1" }, { subject_id: "c3" }]);

    const saved = await fetchListingSavedBatch(client, "tenant-1", IDS, "user-1");

    expect(queries).toHaveLength(1);
    expect(saved).toEqual(new Set(["a1", "c3"]));
  });

  it("filtra por tenant, por tipo de sujeto y por el perfil de quien mira", async () => {
    const { client, queries } = fakeSupabase([]);

    await fetchListingSavedBatch(client, "tenant-1", IDS, "user-1");

    expect(queries[0]).toMatchObject({
      table: "saves",
      tenant_id: "tenant-1",
      subject_kind: "listing",
      profile_id: "user-1",
      subject_id__in: IDS,
    });
  });

  it("sin sesión no consulta nada", async () => {
    const { client, queries } = fakeSupabase([{ subject_id: "a1" }]);

    const saved = await fetchListingSavedBatch(client, "tenant-1", IDS, null);

    expect(queries).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it("con la página vacía no consulta nada", async () => {
    const { client, queries } = fakeSupabase([]);

    const saved = await fetchListingSavedBatch(client, "tenant-1", [], "user-1");

    expect(queries).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it("ante un error devuelve vacío en vez de romper la grilla", async () => {
    const { client } = fakeSupabase([], { error: true });

    const saved = await fetchListingSavedBatch(client, "tenant-1", IDS, "user-1");

    expect(saved.size).toBe(0);
  });
});

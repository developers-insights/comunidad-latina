import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_POST_TAGS,
  addTagged,
  diffTagIds,
  fetchPostTags,
  fetchTagsForPost,
  isTagged,
  removeTagged,
  summarizeTagged,
  type TaggedProfile,
} from "./post-tags";

/**
 * Contrato compartido de las ETIQUETAS (0089).
 *
 * Lo que se cubre y por qué:
 *  - `summarizeTagged` es la aritmética de "con Ana y 2 más": si se equivoca,
 *    la card miente sobre cuánta gente hay etiquetada.
 *  - `addTagged` devuelve la MISMA referencia cuando no hay cambio — de eso
 *    depende que el selector sepa distinguir "llegaste al tope" de "listo".
 *  - `diffTagIds` es lo que evita que guardar dos veces vuelva a notificar a
 *    quien ya estaba etiquetado.
 *  - `fetchPostTags` NO PUEDE LANZAR: sin la migración aplicada el feed tiene
 *    que seguir cargando.
 */

const ANA: TaggedProfile = { id: "a", displayName: "Ana", avatarUrl: null };
const JULIAN: TaggedProfile = { id: "j", displayName: "Julián", avatarUrl: null };
const PEDRO: TaggedProfile = { id: "p", displayName: "Pedro", avatarUrl: "p.jpg" };

describe("summarizeTagged", () => {
  it("con una sola persona no hay resto", () => {
    expect(summarizeTagged([ANA])).toEqual({ names: ["Ana"], extraCount: 0 });
  });

  it("muestra dos nombres y cuenta el resto", () => {
    expect(summarizeTagged([ANA, JULIAN, PEDRO])).toEqual({
      names: ["Ana", "Julián"],
      extraCount: 1,
    });
  });

  it("respeta cuántos nombres se piden", () => {
    expect(summarizeTagged([ANA, JULIAN, PEDRO], 1)).toEqual({
      names: ["Ana"],
      extraCount: 2,
    });
  });

  it("lista vacía → nada que escribir", () => {
    expect(summarizeTagged([])).toEqual({ names: [], extraCount: 0 });
  });
});

describe("addTagged / removeTagged", () => {
  it("suma a alguien nuevo", () => {
    expect(addTagged([ANA], JULIAN)).toEqual([ANA, JULIAN]);
  });

  it("no duplica y devuelve la MISMA referencia", () => {
    const value = [ANA];
    expect(addTagged(value, ANA)).toBe(value);
  });

  it("en el tope devuelve la MISMA referencia (así el selector lo detecta)", () => {
    const value = [ANA, JULIAN];
    expect(addTagged(value, PEDRO, 2)).toBe(value);
  });

  it("el tope por default es el que impone la base", () => {
    const full = Array.from({ length: MAX_POST_TAGS }, (_, index) => ({
      id: `id-${index}`,
      displayName: `Persona ${index}`,
      avatarUrl: null,
    }));
    expect(addTagged(full, ANA)).toBe(full);
  });

  it("quitar a alguien que no está no crea un array nuevo", () => {
    const value = [ANA];
    expect(removeTagged(value, "no-existe")).toBe(value);
    expect(removeTagged(value, "a")).toEqual([]);
  });

  it("isTagged compara por id, no por nombre", () => {
    expect(isTagged([ANA], "a")).toBe(true);
    expect(isTagged([{ ...ANA, id: "otro" }], "a")).toBe(false);
  });
});

describe("diffTagIds", () => {
  it("separa lo que entra de lo que sale", () => {
    expect(diffTagIds(["a", "j"], ["j", "p"])).toEqual({
      toAdd: ["p"],
      toRemove: ["a"],
    });
  });

  it("misma lista → nada que escribir (esto es lo que evita renotificar)", () => {
    expect(diffTagIds(["a", "j"], ["j", "a"])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("vaciar la lista saca todo", () => {
    expect(diffTagIds(["a"], [])).toEqual({ toAdd: [], toRemove: ["a"] });
  });
});

/* ------------------------------ fetchPostTags ------------------------------ */

type QueryResult = { data?: unknown; error?: unknown };

/** Builder falso, encadenable y thenable (patrón de los tests de actions). */
function createStub(result: QueryResult) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  const builder = {
    select: record("select"),
    in: record("in"),
    order: record("order"),
    then: (resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

describe("fetchPostTags", () => {
  it("agrupa por post y aplana el perfil", async () => {
    const stub = createStub({
      data: [
        { post_id: "post-1", profile_id: "a", profiles: { id: "a", display_name: "Ana", avatar_url: null } },
        { post_id: "post-1", profile_id: "p", profiles: { id: "p", display_name: "Pedro", avatar_url: "p.jpg" } },
        { post_id: "post-2", profile_id: "j", profiles: { id: "j", display_name: "Julián", avatar_url: null } },
      ],
    });

    const byPost = await fetchPostTags(stub.client, ["post-1", "post-2"]);

    expect(byPost.get("post-1")).toEqual([
      { id: "a", displayName: "Ana", avatarUrl: null },
      { id: "p", displayName: "Pedro", avatarUrl: "p.jpg" },
    ]);
    expect(byPost.get("post-2")).toEqual([
      { id: "j", displayName: "Julián", avatarUrl: null },
    ]);
  });

  it("sin ids no consulta nada", async () => {
    const stub = createStub({ data: [] });
    expect((await fetchPostTags(stub.client, [])).size).toBe(0);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("si la tabla todavía no existe devuelve vacío en vez de romper el feed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = createStub({ error: { code: "42P01" } });
    expect((await fetchPostTags(stub.client, ["post-1"])).size).toBe(0);
  });

  it("ignora la fila cuyo perfil se borró a mitad de la lectura", async () => {
    const stub = createStub({
      data: [{ post_id: "post-1", profile_id: "a", profiles: null }],
    });
    expect((await fetchPostTags(stub.client, ["post-1"])).size).toBe(0);
  });

  it("fetchTagsForPost devuelve lista vacía cuando el post no tiene etiquetas", async () => {
    const stub = createStub({ data: [] });
    expect(await fetchTagsForPost(stub.client, "post-1")).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claveCompartido, resolverCompartidos } from "./shared-card";
import type { EnlaceInterno } from "@/components/share/enlace-interno";

/**
 * Tests de `resolverCompartidos`.
 *
 * Lo que se verifica es la PROMESA DE COSTO —un hilo con veinte tarjetas cuesta
 * lo mismo que uno con dos— y la de privacidad: una fila que la RLS no devuelve
 * es una tarjeta "ya no está disponible", nunca un dato inventado.
 *
 * El stub registra qué tablas se consultaron y con qué ids, que es exactamente
 * la afirmación que hay que poder hacer sobre un N+1.
 */

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

type Consulta = { tabla: string; ids: string[] };

function crearSupabase(filas: Record<string, unknown[]>) {
  const consultas: Consulta[] = [];

  const from = vi.fn((tabla: string) => {
    const builder = {
      select: vi.fn(() => builder),
      in: vi.fn((_columna: string, ids: string[]) => {
        consultas.push({ tabla, ids: [...ids] });
        return Promise.resolve({ data: filas[tabla] ?? [], error: null });
      }),
    };
    return builder;
  });

  return { supabase: { from } as unknown as SupabaseClient, consultas };
}

const OPCIONES = { locale: "es-US" };

describe("resolverCompartidos — costo", () => {
  it("sin items no consulta nada", async () => {
    const { supabase, consultas } = crearSupabase({});
    const mapa = await resolverCompartidos(supabase, [], OPCIONES);
    expect(mapa.size).toBe(0);
    expect(consultas).toHaveLength(0);
  });

  it("veinte tarjetas del mismo tipo son UNA consulta, no veinte", async () => {
    const items: EnlaceInterno[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "listing",
      id: uuid(i),
    }));
    const { supabase, consultas } = crearSupabase({
      listings: items.map((item) => ({
        id: item.id,
        kind: "property",
        title: `Aviso ${item.id}`,
        photos: [],
        price_amount: null,
        price_currency: "usd",
        price_period: null,
        attrs: null,
        area_label: "Queens",
      })),
    });

    const mapa = await resolverCompartidos(supabase, items, OPCIONES);

    expect(mapa.size).toBe(20);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].tabla).toBe("listings");
    expect(consultas[0].ids).toHaveLength(20);
  });

  it("listing, job y business comparten UNA sola consulta a `listings`", async () => {
    const items: EnlaceInterno[] = [
      { kind: "listing", id: uuid(1) },
      { kind: "job", id: uuid(2) },
      { kind: "business", id: uuid(3) },
    ];
    const { supabase, consultas } = crearSupabase({ listings: [] });

    await resolverCompartidos(supabase, items, OPCIONES);

    const aListings = consultas.filter((c) => c.tabla === "listings");
    expect(aListings).toHaveLength(1);
    expect(aListings[0].ids.sort()).toEqual([uuid(1), uuid(2), uuid(3)].sort());
  });

  it("post y video comparten UNA sola consulta a `posts`", async () => {
    const items: EnlaceInterno[] = [
      { kind: "post", id: uuid(1) },
      { kind: "video", id: uuid(2) },
    ];
    const { supabase, consultas } = crearSupabase({ posts: [], profiles: [] });

    await resolverCompartidos(supabase, items, OPCIONES);

    expect(consultas.filter((c) => c.tabla === "posts")).toHaveLength(1);
  });

  it("los AUTORES de los posts entran en la misma tanda de `profiles`", async () => {
    const items: EnlaceInterno[] = [
      { kind: "post", id: uuid(1) },
      { kind: "post", id: uuid(2) },
      { kind: "profile", id: uuid(9) },
    ];
    const { supabase, consultas } = crearSupabase({
      posts: [
        { id: uuid(1), body: "hola", media: [], video_poster_path: null, author_id: uuid(7) },
        { id: uuid(2), body: "chau", media: [], video_poster_path: null, author_id: uuid(8) },
      ],
      profiles: [],
    });

    await resolverCompartidos(supabase, items, OPCIONES);

    const aPerfiles = consultas.filter((c) => c.tabla === "profiles");
    expect(aPerfiles).toHaveLength(1);
    // El perfil compartido Y los dos autores, todos juntos.
    expect(aPerfiles[0].ids.sort()).toEqual([uuid(7), uuid(8), uuid(9)].sort());
  });

  it("con los siete tipos mezclados el techo son CUATRO consultas", async () => {
    const items: EnlaceInterno[] = [
      { kind: "post", id: uuid(1) },
      { kind: "video", id: uuid(2) },
      { kind: "listing", id: uuid(3) },
      { kind: "job", id: uuid(4) },
      { kind: "business", id: uuid(5) },
      { kind: "profile", id: uuid(6) },
      { kind: "group", id: uuid(7) },
    ];
    const { supabase, consultas } = crearSupabase({});

    await resolverCompartidos(supabase, items, OPCIONES);

    expect(consultas).toHaveLength(4);
    expect(consultas.map((c) => c.tabla).sort()).toEqual([
      "chat_groups",
      "listings",
      "posts",
      "profiles",
    ]);
  });

  it("el mismo contenido repetido se pide UNA vez", async () => {
    const items: EnlaceInterno[] = [
      { kind: "listing", id: uuid(1) },
      { kind: "listing", id: uuid(1) },
      { kind: "listing", id: uuid(1) },
    ];
    const { supabase, consultas } = crearSupabase({ listings: [] });

    await resolverCompartidos(supabase, items, OPCIONES);

    expect(consultas[0].ids).toEqual([uuid(1)]);
  });
});

describe("resolverCompartidos — lo que devuelve", () => {
  it("un aviso trae título, precio y la ruta de SU vertical", async () => {
    const item: EnlaceInterno = { kind: "listing", id: uuid(1) };
    const { supabase } = crearSupabase({
      listings: [
        {
          id: uuid(1),
          kind: "property",
          title: "Departamento en Corona",
          photos: ["tenant/user/foto.webp"],
          price_amount: 1800,
          price_currency: "usd",
          price_period: "month",
          attrs: null,
          area_label: "Queens",
        },
      ],
    });

    const mapa = await resolverCompartidos(supabase, [item], OPCIONES);
    const tarjeta = mapa.get(claveCompartido(item));

    expect(tarjeta?.titulo).toBe("Departamento en Corona");
    expect(tarjeta?.detalle).toContain("1,800");
    // El vertical sale de la fila, no del kind guardado.
    expect(tarjeta?.href).toBe(`/propiedades/${uuid(1)}`);
    expect(tarjeta?.imagenUrl).toContain("foto.webp");
  });

  it("un evento muestra la FECHA en vez del precio", async () => {
    const item: EnlaceInterno = { kind: "listing", id: uuid(2) };
    const { supabase } = crearSupabase({
      listings: [
        {
          id: uuid(2),
          kind: "event",
          title: "Fiesta de la comunidad",
          photos: [],
          price_amount: null,
          price_currency: "usd",
          price_period: null,
          attrs: { starts_at: "2026-10-12" },
          area_label: "Queens",
        },
      ],
    });

    const mapa = await resolverCompartidos(supabase, [item], OPCIONES);
    const tarjeta = mapa.get(claveCompartido(item));

    expect(tarjeta?.href).toBe(`/eventos/${uuid(2)}`);
    expect(tarjeta?.detalle).toMatch(/2026/);
  });

  it("un post sin texto se firma con el nombre de quien lo publicó", async () => {
    const item: EnlaceInterno = { kind: "post", id: uuid(1) };
    const { supabase } = crearSupabase({
      posts: [
        {
          id: uuid(1),
          body: "",
          media: ["t/u/foto.webp"],
          video_poster_path: null,
          author_id: uuid(7),
        },
      ],
      profiles: [
        { id: uuid(7), display_name: "Ramón Pérez", avatar_url: null, area_label: null },
      ],
    });

    const mapa = await resolverCompartidos(supabase, [item], OPCIONES);
    const tarjeta = mapa.get(claveCompartido(item));

    expect(tarjeta?.titulo).toBe("Ramón Pérez");
    expect(tarjeta?.href).toBe(`/feed/${uuid(1)}`);
  });

  it("un video largo abre en la sección de videos, no en el feed", async () => {
    const item: EnlaceInterno = { kind: "video", id: uuid(1) };
    const { supabase } = crearSupabase({
      posts: [
        {
          id: uuid(1),
          body: "Recorrida por el local",
          media: ["t/u/clip.mp4"],
          video_poster_path: "t/u/poster.webp",
          author_id: null,
        },
      ],
      profiles: [],
    });

    const mapa = await resolverCompartidos(supabase, [item], OPCIONES);
    const tarjeta = mapa.get(claveCompartido(item));

    expect(tarjeta?.href).toBe(`/videos/largos/${uuid(1)}`);
    // La portada de un video es su póster, no el .mp4.
    expect(tarjeta?.imagenUrl).toContain("poster.webp");
  });

  /* ------------------------------ privacidad ------------------------------ */

  it("una fila que la RLS no devuelve NO entra en el mapa", async () => {
    const items: EnlaceInterno[] = [
      { kind: "listing", id: uuid(1) },
      { kind: "listing", id: uuid(2) },
    ];
    const { supabase } = crearSupabase({
      listings: [
        {
          id: uuid(1),
          kind: "product",
          title: "Sí lo puedo ver",
          photos: [],
          price_amount: null,
          price_currency: "usd",
          price_period: null,
          attrs: null,
          area_label: null,
        },
      ],
    });

    const mapa = await resolverCompartidos(supabase, items, OPCIONES);

    expect(mapa.has(claveCompartido(items[0]))).toBe(true);
    // Quien pinta la tarjeta recibe `undefined` y muestra "ya no está
    // disponible" — el mismo estado para "lo borraron" y para "no es para vos".
    expect(mapa.has(claveCompartido(items[1]))).toBe(false);
  });

  it("un error de la base no rompe el hilo: devuelve el mapa sin esa tanda", async () => {
    const from = vi.fn(() => {
      const builder = {
        select: vi.fn(() => builder),
        in: vi.fn(() => Promise.resolve({ data: null, error: { code: "42501" } })),
      };
      return builder;
    });
    const supabase = { from } as unknown as SupabaseClient;

    const mapa = await resolverCompartidos(
      supabase,
      [{ kind: "listing", id: uuid(1) }],
      OPCIONES,
    );

    expect(mapa.size).toBe(0);
  });
});

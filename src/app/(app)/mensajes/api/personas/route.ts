import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIpFromHeaders, limit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";

/**
 * GET /mensajes/api/personas?q=… — el buscador de la bandeja de Mensajes.
 *
 * POR QUÉ UN ROUTE HANDLER Y NO UNA SERVER ACTION
 * -----------------------------------------------
 * Idéntico razonamiento que `/buscar/api` (ver su cabecera, que es la fuente):
 * esto es una LECTURA que se dispara con cada tecla y que hay que poder
 * CANCELAR. Las server actions no se abortan y Next las serializa por router,
 * así que un tecleo rápido encolaría peticiones que ya no le importan a nadie.
 * Un GET con `AbortController` corta la anterior en el acto.
 *
 * POR QUÉ NO REUSA /buscar/api
 * ----------------------------
 * Esa ruta llama a `global_search`, que además de personas escanea las seis
 * verticales de `listings` con dos tsquery. Acá se buscan PERSONAS y nada más:
 * pagar seis escaneos por tecla para tirar el 85% del resultado es trabajo que
 * no se hace. La RPC `buscar_personas_de_la_comunidad` (0134) es la rama de
 * personas de aquella, más el filtro que allá no tiene sentido — sacarme a mí
 * de mis propios resultados.
 *
 * SEGURIDAD — lo que este archivo NO hace: no hay un solo `.eq('tenant_id', …)`.
 * La RPC es SECURITY INVOKER y filtra por el tenant del JWT y por bloqueo mutuo
 * (`app.pair_blocked`, en las dos direcciones). El día que se agregue un filtro
 * acá, la barrera real deja de ser la única y empiezan a existir dos verdades.
 */

export const runtime = "nodejs";

/** Lo que entra en un panel de tipo-ahead sin volverse una página de resultados. */
const LIMITE = 8;

/** Ventana generosa: corta scripts, no a alguien escribiendo rápido. */
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;

const QuerySchema = z.object({
  // Se RECORTA en vez de rechazar, igual que en /buscar/api: quien pega un
  // párrafo en el buscador cometió un accidente, no un ataque.
  q: z.string().max(4000).default(""),
});

export type PersonaEncontrada = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  areaLabel: string | null;
  identityVerified: boolean;
};

export type BusquedaDePersonas = {
  query: string;
  personas: PersonaEncontrada[];
};

const VACIO: BusquedaDePersonas = { query: "", personas: [] };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  // Un `q` inválido devuelve VACÍO, no 400: la barra dispara sola mientras se
  // escribe y un error acá se leería como "la búsqueda se rompió".
  if (!parsed.success) return NextResponse.json(VACIO);

  const query = parsed.data.q.trim().slice(0, 80);
  if (query.length < 2) return NextResponse.json({ ...VACIO, query });

  const gate = limit(
    `mensajes-personas:${clientIpFromHeaders(request.headers)}`,
    RATE_MAX,
    RATE_WINDOW_MS,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limit" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) },
      },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabaseSinTiparGrupos(supabase).rpc(
    "buscar_personas_de_la_comunidad",
    { q: query, limite: LIMITE },
  );

  if (error) {
    // Sin el término en el log: lo que alguien busca es dato sensible y no se
    // persiste en claro (§5.4). Sólo el código técnico.
    console.warn("[mensajes] buscar_personas_de_la_comunidad falló", { code: error.code });
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }

  const filas = (data ?? []) as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    area_label: string | null;
    identity_verified: boolean | null;
  }[];

  return NextResponse.json({
    query,
    personas: filas.map((fila) => ({
      id: fila.id,
      displayName: fila.display_name ?? "Miembro de la comunidad",
      avatarUrl: fila.avatar_url,
      areaLabel: fila.area_label,
      identityVerified: fila.identity_verified === true,
    })),
  } satisfies BusquedaDePersonas);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIpFromHeaders, limit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";

/**
 * GET /mensajes/api/destinos — a quién le puedo mandar esto.
 *
 * Es el buscador del panel de Compartir. Devuelve PERSONAS y GRUPOS en una sola
 * respuesta, y con `?q=` vacío devuelve los RECIENTES (con quién vengo
 * hablando + mis grupos), que es lo que se ve al abrir el panel sin escribir
 * nada.
 *
 * ── POR QUÉ UN ROUTE HANDLER Y NO UNA SERVER ACTION ─────────────────────────
 * El mismo motivo que `api/personas/route.ts`, que es la fuente de este patrón:
 * es una LECTURA que se dispara con cada tecla y hay que poder CANCELARLA. Las
 * server actions no se abortan y Next las serializa por router, así que escribir
 * rápido encolaría peticiones que ya no le importan a nadie.
 *
 * ── POR QUÉ NO REUSA /mensajes/api/personas ─────────────────────────────────
 * Aquella devuelve personas y nada más. Acá hacen falta las dos listas a la vez
 * —y sobre todo los RECIENTES, que allá no existen— y partirlo en dos fetch
 * significaría dos round-trips por tecla y dos abortos que coordinar. Es la
 * misma pregunta ("¿a quién?") con una respuesta más ancha.
 *
 * ── SEGURIDAD ───────────────────────────────────────────────────────────────
 * Ni un `.eq('tenant_id', …)` en todo el archivo, igual que en su hermana. La
 * RPC de personas es SECURITY INVOKER y filtra por el tenant del JWT y por
 * bloqueo mutuo; las policies de la 0133 hacen lo propio con los grupos y
 * además resuelven la visibilidad. Los grupos que se devuelven son SÓLO
 * aquellos donde soy miembro: no por un filtro de cortesía, sino porque
 * `chat_group_members` no me deja leer membresías ajenas — mandarle algo a un
 * grupo del que no formo parte lo rechaza la policy de insert de todos modos, y
 * ofrecerlo acá sería prometer algo que la base va a negar.
 */

export const runtime = "nodejs";

/** Lo que entra en un panel sin volverse una pantalla de resultados. */
const LIMITE_PERSONAS = 8;
const LIMITE_GRUPOS = 6;
/** Conversaciones que se leen para armar los recientes (se deduplican por persona). */
const LIMITE_CONVERSACIONES = 40;

/** Ventana generosa: corta scripts, no a alguien escribiendo rápido. */
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;

const QuerySchema = z.object({
  // Se RECORTA en vez de rechazar, igual que en `api/personas`: quien pega un
  // párrafo en el buscador cometió un accidente, no un ataque.
  q: z.string().max(4000).default(""),
});

export type DestinoPersona = {
  tipo: "persona";
  id: string;
  nombre: string;
  avatarUrl: string | null;
  detalle: string | null;
  verificado: boolean;
};

export type DestinoGrupo = {
  tipo: "grupo";
  id: string;
  nombre: string;
  avatarUrl: string | null;
  /** Cantidad de integrantes; la UI la convierte en texto. */
  miembros: number;
};

export type Destino = DestinoPersona | DestinoGrupo;

export type BusquedaDeDestinos = {
  query: string;
  /** `true` cuando no se buscó nada y esto es la lista de siempre. */
  recientes: boolean;
  destinos: Destino[];
};

const VACIO: BusquedaDeDestinos = { query: "", recientes: true, destinos: [] };

type PerfilLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  identity_verified: boolean | null;
};

type ConversacionLite = {
  created_at: string;
  created_by: string;
  counterpart_id: string;
  creator: PerfilLite | null;
  counterpart: PerfilLite | null;
};

type GrupoLite = {
  role: string;
  grupo: {
    id: string;
    name: string;
    avatar_url: string | null;
    member_count: number | null;
    status: string;
  } | null;
};

function aPersona(perfil: PerfilLite, detalle: string | null = null): DestinoPersona {
  return {
    tipo: "persona",
    id: perfil.id,
    nombre: perfil.display_name ?? "Miembro de la comunidad",
    avatarUrl: perfil.avatar_url,
    detalle,
    verificado: perfil.identity_verified === true,
  };
}

/**
 * Mis grupos, opcionalmente filtrados por nombre.
 *
 * El filtro va con `ilike` sobre el nombre y no con búsqueda de texto completo:
 * son como mucho unas decenas de filas por persona (`chat_group_members` de
 * uno mismo), así que un tsquery acá sería pagar un índice y una normalización
 * para ordenar una lista que entra en una pantalla.
 */
async function misGrupos(
  supabase: ReturnType<typeof supabaseSinTiparGrupos>,
  perfilId: string,
  termino: string | null,
): Promise<DestinoGrupo[]> {
  const { data, error } = await supabase
    .from("chat_group_members")
    .select("role, grupo:chat_groups(id, name, avatar_url, member_count, status)")
    .eq("profile_id", perfilId)
    .order("joined_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[compartir] no se pudieron leer mis grupos", { code: error.code });
    return [];
  }

  const normalizado = termino?.toLocaleLowerCase("es") ?? null;

  return ((data ?? []) as unknown as GrupoLite[])
    .map((fila) => fila.grupo)
    .filter((grupo): grupo is NonNullable<GrupoLite["grupo"]> => grupo !== null)
    // Un grupo cerrado no acepta mensajes: ofrecerlo sería un envío que la base
    // va a rechazar después de que la persona ya lo dio por hecho.
    .filter((grupo) => grupo.status === "active")
    .filter((grupo) =>
      normalizado ? grupo.name.toLocaleLowerCase("es").includes(normalizado) : true,
    )
    .slice(0, LIMITE_GRUPOS)
    .map((grupo) => ({
      tipo: "grupo" as const,
      id: grupo.id,
      nombre: grupo.name,
      avatarUrl: grupo.avatar_url,
      miembros: grupo.member_count ?? 0,
    }));
}

/**
 * Las personas con las que ya vengo hablando, de la conversación más nueva a la
 * más vieja y sin repetir a nadie: con la misma persona puede haber varios
 * hilos (uno por aviso) y en una lista de destinos eso sería el mismo nombre
 * tres veces.
 */
async function personasRecientes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<DestinoPersona[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      `created_at, created_by, counterpart_id,
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url, identity_verified),
       counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url, identity_verified)`,
    )
    .neq("status", "blocked")
    .order("created_at", { ascending: false })
    .limit(LIMITE_CONVERSACIONES);

  if (error) {
    console.warn("[compartir] no se pudieron leer los recientes", { code: error.code });
    return [];
  }

  const vistos = new Set<string>();
  const personas: DestinoPersona[] = [];

  for (const fila of (data ?? []) as unknown as ConversacionLite[]) {
    const otro = fila.created_by === userId ? fila.counterpart : fila.creator;
    if (!otro || otro.id === userId || vistos.has(otro.id)) continue;
    vistos.add(otro.id);
    personas.push(aPersona(otro));
    if (personas.length >= LIMITE_PERSONAS) break;
  }

  return personas;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  // Un `q` inválido devuelve VACÍO, no 400: el panel dispara solo mientras se
  // escribe y un error acá se leería como "compartir se rompió".
  if (!parsed.success) return NextResponse.json(VACIO);

  const query = parsed.data.q.trim().slice(0, 80);
  // Con una sola letra todavía no se busca (mismo piso que `api/personas`), pero
  // sí se devuelven los recientes: el panel nunca se queda en blanco.
  const buscando = query.length >= 2;

  const gate = limit(
    `compartir-destinos:${clientIpFromHeaders(request.headers)}`,
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sin sesión no hay a quién mandarle nada. 200 con lista vacía y no 401: el
  // panel de compartir se puede abrir sin cuenta —el bloque de "compartir
  // afuera" funciona igual— y un 401 acá lo pintaría como un error.
  if (!user) return NextResponse.json({ ...VACIO, query });

  const sinTipar = supabaseSinTiparGrupos(supabase);

  // Las dos listas son independientes: van juntas, no encadenadas.
  const [personas, grupos] = await Promise.all([
    buscando
      ? sinTipar
          .rpc("buscar_personas_de_la_comunidad", { q: query, limite: LIMITE_PERSONAS })
          .then(({ data, error }) => {
            if (error) {
              // Sin el término en el log: lo que alguien busca es dato sensible
              // y no se persiste en claro (§5.4). Sólo el código técnico.
              console.warn("[compartir] búsqueda de personas falló", {
                code: error.code,
              });
              return [] as DestinoPersona[];
            }
            return ((data ?? []) as (PerfilLite & { area_label: string | null })[]).map(
              (fila) => aPersona(fila, fila.area_label),
            );
          })
      : personasRecientes(supabase, user.id),
    misGrupos(sinTipar, user.id, buscando ? query : null),
  ]);

  return NextResponse.json({
    query,
    recientes: !buscando,
    // Personas primero: compartir con una persona es el caso que el panel viene
    // a resolver, y los grupos son la variante. Cada lista ya viene acotada.
    destinos: [...personas, ...grupos],
  } satisfies BusquedaDeDestinos);
}

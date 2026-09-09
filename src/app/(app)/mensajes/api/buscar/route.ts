import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIpFromHeaders, limit } from "@/lib/rate-limit";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { describirLlamada } from "@/lib/messaging/bandeja";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";

/**
 * GET /mensajes/api/buscar?q=… — UNA barra para todo lo que vive en Mensajes.
 *
 * Pedido del cliente, textual: «una barra de búsqueda que encuentre chats
 * individuales, grupales y llamadas en un solo lugar». Buscar por persona ya
 * existía (`api/personas`), pero era otra cosa: servía para EMPEZAR una
 * conversación, no para encontrar una que ya tenés.
 *
 * POR QUÉ UN ROUTE HANDLER Y NO UNA SERVER ACTION
 * -----------------------------------------------
 * Mismo razonamiento que `api/personas` (ver su cabecera, que es la fuente):
 * es una LECTURA que se dispara con cada tecla y que hay que poder CANCELAR.
 * Las server actions no se abortan y Next las serializa por router.
 *
 * DÓNDE SE BUSCA
 * --------------
 *  · Chats 1:1 — por el nombre de la otra persona y por el TEXTO de lo que se
 *    dijeron. Buscar "presupuesto" y encontrar la charla es la mitad del pedido.
 *  · Grupos — los MÍOS, por nombre. Los que no son míos ya se descubren en la
 *    pestaña Grupos; repetirlos acá sería confundir "buscar en mis mensajes"
 *    con "buscar en la comunidad".
 *  · Personas — para escribirle a alguien con quien todavía no hablaste.
 *  · Llamadas — el `tipo` está en el contrato y la pantalla ya sabe pintarlo,
 *    PERO hoy no hay llamadas en este producto: no existe tabla, ni pantalla,
 *    ni botón. Sólo aparecen si la RPC las devuelve.
 *
 * SEGURIDAD — no hay un solo `.eq('tenant_id', …)`. La RLS de `conversations`,
 * `messages` y `chat_group_members` ya exige ser participante y del tenant del
 * JWT. Agregar el filtro acá crearía una segunda verdad (regla de la 0044).
 *
 * PRIVACIDAD — el término NUNCA se loguea, ni siquiera al fallar: lo que
 * alguien busca dentro de sus mensajes privados es tan sensible como los
 * mensajes (§5.4). De los errores sólo viaja el código técnico.
 */

export const runtime = "nodejs";

/** Lo que entra en un panel de tipo-ahead sin volverse una página de resultados. */
const LIMITE_POR_SECCION = 5;
const LIMITE_MENSAJES = 10;

/** Ventana generosa: corta scripts, no a alguien escribiendo rápido. */
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;

const QuerySchema = z.object({
  // Se RECORTA en vez de rechazar, igual que en `api/personas`: quien pega un
  // párrafo en el buscador cometió un accidente, no un ataque.
  q: z.string().max(4000).default(""),
});

export type TipoDeResultado = "chat" | "grupo" | "llamada" | "persona";

/** Los nombres que usa la RPC (0140) son los de las TABLAS, no los de la UI. */
const TIPO_DESDE_RPC: Record<string, TipoDeResultado | undefined> = {
  conversacion: "chat",
  grupo: "grupo",
  llamada: "llamada",
  persona: "persona",
};

export type ResultadoDeMensajeria = {
  tipo: TipoDeResultado;
  /** Conversación, grupo, llamada o perfil, según el tipo. */
  id: string;
  titulo: string;
  /** La línea de abajo: el mensaje que coincidió, el tema del grupo, la zona. */
  fragmento: string | null;
  /** ISO de la última señal de vida, cuando el resultado tiene una. */
  cuando: string | null;
  /** `null` en las llamadas: no hay a dónde ir. Ver `hrefDe`. */
  href: string | null;
  avatarUrl: string | null;
};

export type BusquedaEnMensajeria = {
  query: string;
  resultados: ResultadoDeMensajeria[];
};

const VACIO: BusquedaEnMensajeria = { query: "", resultados: [] };

/**
 * `%` y `_` son comodines de `ilike`: sin sacarlos, escribir `%` devuelve la
 * bandeja entera y `_` machea cualquier letra. `\` es el escape de Postgres y
 * dejarlo pasar permite construir patrones que no vienen al caso.
 */
function patronIlike(termino: string): string {
  return `%${termino.replace(/[\\%_]/g, "")}%`;
}

type PerfilLite = { id: string; display_name: string | null; avatar_url: string | null };

type ConversacionEncontrada = {
  id: string;
  created_at: string;
  created_by: string;
  counterpart_id: string;
  creator: PerfilLite | null;
  counterpart: PerfilLite | null;
};

const CONVERSACION_SELECT = (lado: "creator" | "counterpart") =>
  lado === "counterpart"
    ? `id, created_at, created_by, counterpart_id,
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url),
       counterpart:profiles!conversations_counterpart_id_fkey!inner(id, display_name, avatar_url)`
    : `id, created_at, created_by, counterpart_id,
       creator:profiles!conversations_created_by_fkey!inner(id, display_name, avatar_url),
       counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url)`;

function otroLado(fila: ConversacionEncontrada, miId: string): PerfilLite | null {
  return fila.created_by === miId ? fila.counterpart : fila.creator;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  // Un `q` inválido devuelve VACÍO, no 400: la barra dispara sola mientras se
  // escribe y un error acá se leería como "la búsqueda se rompió".
  if (!parsed.success) return NextResponse.json(VACIO);

  const query = parsed.data.q.trim().slice(0, 80);
  if (query.length < 2) return NextResponse.json({ ...VACIO, query });

  const gate = limit(
    `mensajes-buscar:${clientIpFromHeaders(request.headers)}`,
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

  const miId = await getAuthUserId();
  if (!miId) return NextResponse.json({ ...VACIO, query });

  const supabase = await createClient();
  const suelto = supabaseSinTiparGrupos(supabase);
  const patron = patronIlike(query);

  /**
   * El camino corto: una RPC que ya cruza las tres cosas del lado de Postgres.
   * Si todavía no existe (`PGRST202`/`42883`), se arma lo mismo desde acá con
   * consultas en paralelo. No es un `try` defensivo por las dudas: la RPC llega
   * en otra migración y esta pantalla tiene que andar en los dos mundos.
   */
  const { data: rpcData, error: rpcError } = await suelto.rpc("buscar_en_mensajeria", {
    termino: query,
    limite: LIMITE_POR_SECCION * 3,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    const filas = rpcData as {
      tipo: string;
      id: string;
      titulo: string | null;
      fragmento: string | null;
      cuando: string | null;
    }[];
    const resultadosRpc: ResultadoDeMensajeria[] = [];
    for (const fila of filas) {
      // La RPC dice `conversacion`, que es el nombre de la TABLA; la pantalla
      // habla de chats. Traducir acá y no allá: el nombre del esquema no tiene
      // por qué filtrarse hasta el componente.
      const tipo = TIPO_DESDE_RPC[fila.tipo];
      if (!tipo) continue;
      resultadosRpc.push({
        tipo,
        id: fila.id,
        titulo: fila.titulo ?? "Miembro de la comunidad",
        // Una llamada llega como "video · perdida" —literales del esquema—, no
        // como algo que se le pueda mostrar a alguien.
        fragmento: tipo === "llamada" ? describirLlamada(fila.fragmento) : fila.fragmento,
        cuando: fila.cuando,
        href: hrefDe(tipo, fila.id),
        avatarUrl: null,
      });
    }
    return NextResponse.json({
      query,
      resultados: resultadosRpc,
    } satisfies BusquedaEnMensajeria);
  }

  // Cinco lecturas independientes: van juntas o el buscador tarda cinco veces
  // lo que tiene que tardar.
  const [porContraparte, porCreador, porTexto, misGrupos, personas] = await Promise.all([
    supabase
      .from("conversations")
      .select(CONVERSACION_SELECT("counterpart"))
      .eq("created_by", miId)
      .neq("status", "blocked")
      .ilike("counterpart.display_name", patron)
      .order("created_at", { ascending: false })
      .limit(LIMITE_POR_SECCION),
    supabase
      .from("conversations")
      .select(CONVERSACION_SELECT("creator"))
      .eq("counterpart_id", miId)
      .neq("status", "blocked")
      .ilike("creator.display_name", patron)
      .order("created_at", { ascending: false })
      .limit(LIMITE_POR_SECCION),
    supabase
      .from("messages")
      .select(
        `conversation_id, body, created_at,
         conversation:conversations!inner(id, created_by, counterpart_id,
           creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url),
           counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url))`,
      )
      .ilike("body", patron)
      .order("created_at", { ascending: false })
      .limit(LIMITE_MENSAJES),
    suelto
      .from("chat_group_members")
      .select("grupo:chat_groups!inner(id, name, description, avatar_url, category)")
      .eq("profile_id", miId)
      .ilike("grupo.name", patron)
      .limit(LIMITE_POR_SECCION),
    suelto.rpc("buscar_personas_de_la_comunidad", {
      q: query,
      limite: LIMITE_POR_SECCION,
    }),
  ]);

  const resultados: ResultadoDeMensajeria[] = [];
  const chatsVistos = new Set<string>();

  // Arrow y no `function`: una declaración de función se hoistea, y TypeScript
  // deja de ver que `miId` ya está descartado como null arriba.
  const sumarChat = (
    fila: ConversacionEncontrada,
    fragmento: string | null,
    cuando: string,
  ) => {
    if (chatsVistos.has(fila.id)) return;
    chatsVistos.add(fila.id);
    const persona = otroLado(fila, miId);
    resultados.push({
      tipo: "chat",
      id: fila.id,
      titulo: persona?.display_name ?? "Miembro de la comunidad",
      fragmento,
      cuando,
      href: `/mensajes/${fila.id}`,
      avatarUrl: persona?.avatar_url ?? null,
    });
  };

  // El texto va PRIMERO: si la charla apareció por lo que se dijo adentro, ese
  // fragmento es más útil que volver a mostrar el nombre que ya se está
  // escribiendo en la barra.
  for (const fila of (porTexto.data ?? []) as unknown as {
    body: string;
    created_at: string;
    conversation: ConversacionEncontrada | null;
  }[]) {
    if (fila.conversation) sumarChat(fila.conversation, fila.body, fila.created_at);
  }

  for (const grupo of [porContraparte, porCreador]) {
    for (const fila of (grupo.data ?? []) as unknown as ConversacionEncontrada[]) {
      sumarChat(fila, null, fila.created_at);
    }
  }

  for (const fila of (misGrupos.data ?? []) as unknown as {
    grupo: { id: string; name: string; description: string | null; avatar_url: string | null } | null;
  }[]) {
    if (!fila.grupo) continue;
    resultados.push({
      tipo: "grupo",
      id: fila.grupo.id,
      titulo: fila.grupo.name,
      fragmento: fila.grupo.description,
      cuando: null,
      href: `/mensajes/grupos/${fila.grupo.id}`,
      avatarUrl: fila.grupo.avatar_url,
    });
  }

  // Las personas van al final y sin las que ya tienen un chat abierto: ofrecer
  // "escribirle" a alguien con quien ya estás hablando es una fila que no lleva
  // a ningún lado nuevo.
  const yaHablo = new Set(
    resultados
      .filter((resultado) => resultado.tipo === "chat")
      .map((resultado) => resultado.titulo),
  );
  for (const fila of ((personas.data ?? []) as unknown as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    area_label: string | null;
    numero_cl: string;
  }[])) {
    const nombre = fila.display_name ?? "Miembro de la comunidad";
    if (yaHablo.has(nombre)) continue;
    resultados.push({
      tipo: "persona",
      id: fila.id,
      titulo: nombre,
      fragmento: [fila.numero_cl, fila.area_label].filter(Boolean).join(" · "),
      cuando: null,
      href: `/perfil/${fila.id}`,
      avatarUrl: fila.avatar_url,
    });
  }

  const falloTodo =
    porContraparte.error && porCreador.error && porTexto.error && misGrupos.error;
  if (falloTodo) {
    console.warn("[mensajes] la búsqueda en mensajería falló", {
      code: porTexto.error?.code,
    });
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }

  return NextResponse.json({ query, resultados } satisfies BusquedaEnMensajeria);
}

/**
 * A dónde lleva cada resultado.
 *
 * `llamada` devuelve `null` A PROPÓSITO, y no es un olvido: `calls` (0139) no
 * guarda `conversation_id` —una llamada 1-a-1 se define por sus participantes—
 * y `buscar_en_mensajeria` devuelve el id de la LLAMADA. O sea que no hay, con
 * lo que la RPC entrega, ninguna dirección a la que mandar a alguien; y tampoco
 * existe todavía una pantalla de historial de llamadas. La fila se muestra como
 * lo que es —un registro de algo que pasó— en vez de fingir un enlace que
 * llevaría a la conversación equivocada.
 */
function hrefDe(tipo: TipoDeResultado, id: string): string | null {
  switch (tipo) {
    case "grupo":
      return `/mensajes/grupos/${id}`;
    case "persona":
      return `/perfil/${id}`;
    case "llamada":
      return null;
    default:
      return `/mensajes/${id}`;
  }
}

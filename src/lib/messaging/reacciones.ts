import type { SupabaseClient } from "@supabase/supabase-js";
import { emojiShortcode } from "@/lib/emojis/catalog";

/**
 * =============================================================================
 * REACCIONAR A UN MENSAJE (0138) — contrato compartido
 * =============================================================================
 *
 * Lo importan por igual la burbuja (servidor), la barra de reacciones
 * (navegador) y la server action. Un solo lugar decide qué es una reacción
 * válida, cómo se agrupan y cuánto dura la ventana de edición: si cada
 * superficie lo resolviera por su cuenta, la UI ofrecería cosas que la base
 * rechaza y el "no" llegaría como un error genérico.
 *
 * ─── LA REACCIÓN ES UNA SOLA POR PERSONA ────────────────────────────────────
 * `reactions_one_per_subject unique (subject_kind, subject_id, profile_id)`
 * viene de la 0007 y la 0138 lo dejó explícito: cambiar de reacción no agrega
 * una fila, la reemplaza. Toda la UI de este módulo asume eso — una persona
 * aparece en UNA sola pastilla de conteo, nunca en dos.
 *
 * ─── CÓMO SE GUARDA CADA REACCIÓN ───────────────────────────────────────────
 * En `reactions.kind`, texto, con las tres formas que ya conviven en producción
 * (ver `src/lib/emojis/catalog.ts` y §1 de la 0138):
 *   · `like`   → el corazón histórico del feed
 *   · `❤️`     → un emoji unicode tal cual
 *   · `:klk:`  → un emoji de la comunidad, por su slug
 * NO hay columna `emoji_slug`: sería una segunda forma de decir lo mismo.
 */

export type AmbitoDeMensaje = "directo" | "grupo";

export const MENSAJE_SUBJECT_KINDS = ["message", "group_message"] as const;
export type MensajeSubjectKind = (typeof MENSAJE_SUBJECT_KINDS)[number];

export const SUBJECT_KIND_POR_AMBITO: Record<AmbitoDeMensaje, MensajeSubjectKind> = {
  directo: "message",
  grupo: "group_message",
};

export const TABLA_POR_AMBITO: Record<AmbitoDeMensaje, string> = {
  directo: "messages",
  grupo: "chat_group_messages",
};

/**
 * Las seis de la lámina del cliente, en su orden. Se muestran SIEMPRE, sin
 * "las que más usaste": una fila que cambia de contenido obliga a leerla cada
 * vez, y el gesto rápido deja de ser rápido.
 */
export const REACCIONES_RAPIDAS = ["❤️", "👍", "😂", "😮", "😢", "🙏"] as const;

/**
 * Espeja `reactions_kind_check` de la 0138. Si acá fuera más permisivo, la
 * pantalla dejaría poner una reacción que la base rechaza con un 23514 que
 * nadie sabe traducir.
 */
export const MAX_REACTION_KIND_LEN = 64;

/** El corazón que el feed guarda desde la 0007. Se pinta como ❤️. */
export const REACCION_LEGADA = "like";

export function esReaccionValida(kind: string): boolean {
  const limpio = kind.trim();
  return limpio.length >= 1 && limpio.length <= MAX_REACTION_KIND_LEN;
}

/** `:klk:` → `klk`. Devuelve null si no es un código corto de la comunidad. */
export function slugDeReaccion(kind: string): string | null {
  const match = /^:([a-z0-9]+(?:-[a-z0-9]+)*):$/.exec(kind.trim());
  return match?.[1] ?? null;
}

export function reaccionDeEmojiDeComunidad(slug: string): string {
  return emojiShortcode(slug);
}

/**
 * Qué se pinta cuando la reacción NO es un emoji de la comunidad. `like` es la
 * forma vieja del corazón y tiene que seguir viéndose como un corazón: hay 60
 * filas así en producción y ninguna se migró.
 */
export function emojiUnicodeDeReaccion(kind: string): string {
  return kind === REACCION_LEGADA ? "❤️" : kind;
}

// ---------------------------------------------------------------------------
// La ventana de edición
// ---------------------------------------------------------------------------

/**
 * 15 minutos, y la MIDE LA BASE contra `created_at`
 * (`app.proteger_columnas_del_mensaje_*`, 0136 §5). Este número existe acá sólo
 * para no ofrecer "Editar" en un mensaje que la base va a rechazar: descubrir
 * el límite con un error es una mala forma de enterarse. La verdad sigue siendo
 * el trigger — un reloj de navegador se cambia desde Configuración.
 */
export const VENTANA_DE_EDICION_MS = 15 * 60 * 1000;

/** Milisegundos que faltan para que se cierre la ventana. 0 = ya cerró. */
export function msRestantesDeEdicion(createdAt: string, ahora: number = Date.now()): number {
  const nacido = new Date(createdAt).getTime();
  if (!Number.isFinite(nacido)) return 0;
  return Math.max(0, nacido + VENTANA_DE_EDICION_MS - ahora);
}

export interface PermisosDelMensaje {
  esAutor: boolean;
  /** Administro el grupo (o soy del equipo). Sólo habilita ELIMINAR. */
  administro?: boolean;
  kind: string;
  createdAt: string;
  deletedAt?: string | null;
  /** Cuerpo ya renderizado a texto plano. Vacío = no hay nada que copiar. */
  body: string;
}

/**
 * QUÉ SE PUEDE HACER CON ESTE MENSAJE, decidido en un solo lugar.
 *
 * Esto es EXPERIENCIA, no autorización: apagar "Eliminar" acá evita ofrecer un
 * botón que la base va a rechazar, pero quien decide sigue siendo la policy.
 * La server action vuelve a preguntar todo y rechaza igual (ver
 * `mensaje-actions.ts`).
 */
export function accionesDisponibles(
  permisos: PermisosDelMensaje,
  ahora: number = Date.now(),
): {
  responder: boolean;
  copiar: boolean;
  reenviar: boolean;
  editar: boolean;
  eliminar: boolean;
  reportar: boolean;
  reaccionar: boolean;
} {
  const bajado = Boolean(permisos.deletedAt);
  const hayTexto = permisos.body.trim().length > 0;

  return {
    responder: !bajado,
    copiar: !bajado && hayTexto,
    reenviar: !bajado,
    // El trigger sólo deja cambiar `body`, así que editar es para mensajes de
    // texto: una foto no se convierte en otra foto ni un audio se re-graba.
    editar:
      !bajado &&
      permisos.esAutor &&
      permisos.kind === "texto" &&
      msRestantesDeEdicion(permisos.createdAt, ahora) > 0,
    eliminar: !bajado && (permisos.esAutor || permisos.administro === true),
    // Reportar el mensaje propio no significa nada y confunde la lista.
    reportar: !bajado && !permisos.esAutor,
    reaccionar: !bajado,
  };
}

// ---------------------------------------------------------------------------
// Traer y agrupar las reacciones de UN hilo
// ---------------------------------------------------------------------------

export const REACCION_COLUMNS = "subject_id, profile_id, kind";

export type ReaccionRow = {
  subject_id: string;
  profile_id: string;
  kind: string;
  autor?: { display_name: string | null } | null;
};

export interface ReaccionAgrupada {
  kind: string;
  total: number;
  /** La puse yo. Con la unicidad de la 0007, como mucho una lo tiene en true. */
  mia: boolean;
  /** Nombres para el "quién reaccionó", recortados a `MAX_NOMBRES_POR_REACCION`. */
  nombres: string[];
}

/**
 * Cuántos nombres se guardan por reacción. Diez alcanza para escribir "Ana,
 * Beto y 8 más" sin arrastrar doscientos strings hasta el navegador.
 */
export const MAX_NOMBRES_POR_REACCION = 10;

/**
 * Filas planas → reacciones por mensaje, EN UNA SOLA PASADA.
 *
 * El orden es por cantidad y, a igualdad, por el orden en que apareció la
 * primera: sin el segundo criterio dos reacciones empatadas se intercambian de
 * lugar entre renders y la fila "parpadea" sola.
 */
export function agruparReacciones(
  filas: readonly ReaccionRow[],
  viewerId: string | null,
): Map<string, ReaccionAgrupada[]> {
  const porMensaje = new Map<string, Map<string, ReaccionAgrupada>>();
  const orden = new Map<string, number>();

  for (const fila of filas) {
    let porKind = porMensaje.get(fila.subject_id);
    if (!porKind) {
      porKind = new Map();
      porMensaje.set(fila.subject_id, porKind);
    }

    let grupo = porKind.get(fila.kind);
    if (!grupo) {
      grupo = { kind: fila.kind, total: 0, mia: false, nombres: [] };
      porKind.set(fila.kind, grupo);
      orden.set(`${fila.subject_id} ${fila.kind}`, orden.size);
    }

    grupo.total += 1;
    if (viewerId !== null && fila.profile_id === viewerId) grupo.mia = true;

    const nombre = fila.autor?.display_name;
    if (nombre && grupo.nombres.length < MAX_NOMBRES_POR_REACCION) {
      grupo.nombres.push(nombre);
    }
  }

  const resultado = new Map<string, ReaccionAgrupada[]>();
  for (const [mensajeId, porKind] of porMensaje) {
    const lista = [...porKind.values()].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const ia = orden.get(`${mensajeId} ${a.kind}`) ?? 0;
      const ib = orden.get(`${mensajeId} ${b.kind}`) ?? 0;
      return ia - ib;
    });
    resultado.set(mensajeId, lista);
  }
  return resultado;
}

/** Cuál puse yo, si puse alguna. */
export function miReaccion(reacciones: readonly ReaccionAgrupada[]): string | null {
  return reacciones.find((r) => r.mia)?.kind ?? null;
}

/**
 * EL MISMO CAMBIO QUE VA A HACER EL SERVIDOR, HECHO EN MEMORIA.
 *
 * Es lo que pinta la pastilla en el mismo frame del toque y lo que se revierte
 * si la base dice que no. Está acá y no adentro del componente porque es la
 * única parte del optimismo que se puede testear sin montar nada — y porque la
 * regla que hace cumplir (UNA reacción por persona: sacar la vieja antes de
 * poner la nueva) es la misma que la 0007 escribió como constraint.
 *
 * `kind === null` = sacar la mía y no poner ninguna.
 */
export function aplicarReaccion(
  actuales: readonly ReaccionAgrupada[],
  kind: string | null,
  nombrePropio: string,
): ReaccionAgrupada[] {
  const siguiente: ReaccionAgrupada[] = [];

  for (const grupo of actuales) {
    if (!grupo.mia) {
      siguiente.push(grupo);
      continue;
    }
    // Saco mi voto de donde estuviera. Si era el único, la pastilla se va.
    if (grupo.total <= 1) continue;
    siguiente.push({
      ...grupo,
      total: grupo.total - 1,
      mia: false,
      nombres: grupo.nombres.filter((nombre) => nombre !== nombrePropio),
    });
  }

  if (kind === null) return siguiente;

  const indice = siguiente.findIndex((grupo) => grupo.kind === kind);
  if (indice === -1) {
    siguiente.push({ kind, total: 1, mia: true, nombres: [nombrePropio] });
    return siguiente;
  }

  const existente = siguiente[indice];
  siguiente[indice] = {
    ...existente,
    total: existente.total + 1,
    mia: true,
    // Adelante: quien está mirando se busca a sí mismo primero en la lista.
    nombres: [nombrePropio, ...existente.nombres].slice(0, MAX_NOMBRES_POR_REACCION),
  };
  return siguiente;
}

/**
 * LAS REACCIONES DE TODO EL HILO EN UNA CONSULTA.
 *
 * `.in("subject_id", ids)` y un embed de `profiles` por la FK
 * `reactions.profile_id`: PostgREST resuelve el join del lado del servidor, así
 * que doscientos mensajes con reacciones siguen siendo UN viaje. Pedirlas por
 * mensaje sería el N+1 clásico de esta pantalla.
 *
 * No filtra por `tenant_id` a propósito: `reactions_select` (0138 §3) ya exige
 * el tenant Y que el mensaje sea visible para quien pregunta. Repetirlo acá
 * crearía una segunda verdad que puede desincronizarse de la policy.
 */
export async function leerReaccionesDeMensajes(
  client: SupabaseClient,
  ambito: AmbitoDeMensaje,
  mensajeIds: readonly string[],
  viewerId: string | null,
): Promise<Map<string, ReaccionAgrupada[]>> {
  if (mensajeIds.length === 0) return new Map();

  const { data, error } = await client
    .from("reactions")
    .select(`${REACCION_COLUMNS}, autor:profiles(display_name)`)
    .eq("subject_kind", SUBJECT_KIND_POR_AMBITO[ambito])
    .in("subject_id", [...mensajeIds]);

  if (error) {
    // Sin reacciones el hilo se lee igual. Un error acá no puede vaciar la
    // conversación: se registra el código y la pantalla sigue.
    console.warn("[mensajes] no se pudieron leer las reacciones", { code: error.code });
    return new Map();
  }

  return agruparReacciones((data ?? []) as unknown as ReaccionRow[], viewerId);
}

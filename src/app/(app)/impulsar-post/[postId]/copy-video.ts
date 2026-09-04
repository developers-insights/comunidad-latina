import {
  ADVERTISING_VIDEO_MAX_SECONDS,
  FEED_PREVIEW_MAX_SECONDS,
  formatDuration,
} from "@/lib/media/video-policy";
import { MAX_VIDEO_BYTES } from "@/lib/media/video-upload-limits";

/**
 * Copy del VIDEO LARGO DE LA CAMPAÑA. Local al módulo, como el resto de
 * `/impulsar-post` — no toca `src/lib/i18n`, que es compartido.
 *
 * Vive en su propio archivo (y no dentro del panel) porque lo leen los DOS
 * lados: el panel del navegador y la server action. Que el rechazo del cliente y
 * el del servidor digan lo mismo, palabra por palabra, es el mismo principio que
 * sostiene `SHORT_VIDEO_LIMIT_MESSAGE` en `video-policy.ts`.
 *
 * NINGÚN NÚMERO SE ESCRIBE A MANO ACÁ. Los minutos salen del tope real del tipo
 * publicitario, los segundos de la vista previa salen del feed y los megas del
 * tope del bucket. Un número copiado en una frase es un número que el día que
 * cambie va a seguir diciendo lo viejo — y la frase es justamente lo que la
 * persona va a creer.
 */

const MINUTOS_MAX = Math.floor(ADVERTISING_VIDEO_MAX_SECONDS / 60);
const MEGAS_MAX = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));

export const COPY_VIDEO_PUBLICITARIO = {
  titulo: "El video de tu campaña",
  bajada: `Tu campaña está activa, así que tu publicación puede llevar un video de hasta ${MINUTOS_MAX} minutos. Con cinco te alcanza para recorrer una propiedad entera.`,
  comoSeVe: `En el feed y en Videos Cortos se ven los primeros ${FEED_PREVIEW_MAX_SECONDS} segundos, con un botón para verlo completo en la sección de Videos largos.`,
  ayudaArchivo: `Hasta ${MEGAS_MAX} MB. Si grabaste con el teléfono, mandá el archivo tal cual: no hace falta que lo edites.`,

  elegir: "Elegir un video",
  cambiar: "Cambiar el video",
  quitar: "Elegir otro",
  guardar: "Guardar el video",
  guardando: "Guardando…",
  midiendo: "Leyendo el video…",
  subiendo: "Subiendo tu video…",
  verLargos: "Ver cómo quedó",

  yaTiene: (segundos: number | null | undefined) => {
    const duracion = formatDuration(segundos);
    return duracion
      ? `Tu publicación ya muestra un video de ${duracion}. Podés cambiarlo por otro cuando quieras.`
      : "Tu publicación ya muestra el video de la campaña. Podés cambiarlo por otro cuando quieras.";
  },

  listoTitulo: "¡Listo! Tu video ya está en la publicación",
  listoCuerpo:
    "La comunidad lo ve completo en Videos largos, y en el feed aparece con el botón para abrirlo.",

  // ---- Rechazos -----------------------------------------------------------
  //
  // Todos dicen QUÉ pasó y QUÉ hacer, y ninguno culpa a la persona. Los de
  // formato y peso no están acá a propósito: los escribe
  // `video-upload-limits.ts` (`videoWrongTypeMessageFor`,
  // `formatVideoTooBigMessage`), que es el módulo que conoce los números.
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorMuyLargo: `Este video dura más de ${MINUTOS_MAX} minutos. Recortalo un poquito y volvé a subirlo.`,
  errorDuracion:
    "No pudimos leer cuánto dura este video. Probá exportarlo de nuevo desde tu teléfono, o elegí otro archivo.",
  errorNoEsTuyo:
    "Esta publicación no es tuya, así que no podés cambiarle el video. Si es tuya, entrá con tu cuenta.",
  errorNoPublicado:
    "Tu publicación todavía no está en línea. Apenas el equipo de tu comunidad la apruebe, volvé por acá.",
  errorSinCampana:
    "El video largo es parte de la campaña. Activá tu campaña y volvé por acá para subirlo.",
  errorMuchosIntentos:
    "Subiste varios videos seguidos. Esperá un rato y probá de nuevo — tu campaña sigue en su lugar.",
  errorYaTieneMux:
    "Esta publicación ya tiene un video en camino. Esperá a que termine de procesarse y volvé a intentarlo.",
  errorSubidaTitulo: "No pudimos subir el video",
  errorSubidaCuerpo:
    "Puede haber sido la conexión. Fijate que tengas señal y probá de nuevo — no se perdió nada.",
} as const;

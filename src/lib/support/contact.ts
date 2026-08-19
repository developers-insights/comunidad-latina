/**
 * =============================================================================
 * SOPORTE — la dirección real y cómo se arma el correo
 * =============================================================================
 *
 * NO es `server-only` a propósito: el composer de /ajustes/soporte corre en el
 * cliente y necesita armar el `mailto:` ahí mismo. Acá no hay ningún secreto —
 * la dirección de soporte es pública por definición, está para que la usen.
 *
 * ── POR QUÉ `mailto:` Y NO UN FORMULARIO QUE ENVÍA ───────────────────────────
 * Un formulario propio necesita un proveedor de correo del lado del servidor.
 * `RESEND_API_KEY` hoy NO está en producción (verificado con `vercel env ls`
 * el 2026-08-19), y `sendEmail()` degrada devolviendo `{ ok: true, skipped }`
 * cuando falta — o sea que un formulario mostraría "listo, te vamos a
 * responder" y el mensaje no llegaría a ninguna parte. Un canal de soporte que
 * traga mensajes en silencio es peor que no tener canal.
 *
 * El `mailto:` además le deja a la persona una copia en SUS enviados y la
 * respuesta le llega al hilo que ya conoce. Cuando Resend esté en producción se
 * puede sumar el envío in-app arriba de esto, sin sacar el camino de correo:
 * es el único que funciona sin depender de nada nuestro.
 */

/** La casilla que atiende soporte. Único lugar donde vive el string. */
export const SUPPORT_EMAIL = "comunidadlatinallc@gmail.com";

export type SupportTopic = {
  id: string;
  /** Lo que se lee en el chip. */
  label: string;
  /** Va al asunto para que soporte triée sin abrir el correo. */
  subject: string;
  /** Guía dentro del textarea — distinta por motivo, no una genérica. */
  placeholder: string;
};

/**
 * Los motivos son los que llegan de verdad a una comunidad como esta, en el
 * orden en que se piden. "Otra cosa" existe para que nadie quede sin casilla:
 * obligar a elegir mal una categoría es una forma de perder el mensaje.
 */
export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  {
    id: "cuenta",
    label: "Mi cuenta",
    subject: "Cuenta",
    placeholder: "No puedo entrar, quiero cambiar mi correo, no me llega el mensaje de confirmación…",
  },
  {
    id: "problema",
    label: "Algo no funciona",
    subject: "Algo no funciona",
    placeholder: "Contanos qué estabas haciendo, qué esperabas que pasara y qué pasó en su lugar.",
  },
  {
    id: "seguridad",
    label: "Reportar a alguien",
    subject: "Reporte de conducta",
    placeholder: "Contanos qué pasó y con quién. Si podés, pegá el enlace de la publicación o del perfil.",
  },
  {
    id: "pagos",
    label: "Pagos y membresía",
    subject: "Pagos y membresía",
    placeholder: "Un cobro que no reconocés, una membresía que no se activó, una factura que necesitás…",
  },
  {
    id: "idea",
    label: "Una idea",
    subject: "Sugerencia",
    placeholder: "¿Qué te gustaría que la app hiciera y hoy no hace?",
  },
  {
    id: "otro",
    label: "Otra cosa",
    subject: "Consulta",
    placeholder: "Contanos en qué te podemos ayudar.",
  },
] as const;

export const DEFAULT_TOPIC_ID = "problema";

export function findTopic(id: string): SupportTopic {
  return SUPPORT_TOPICS.find((topic) => topic.id === id) ?? SUPPORT_TOPICS[SUPPORT_TOPICS.length - 1];
}

/** Tope del mensaje. Los clientes de correo cortan `mailto:` largos sin avisar. */
export const MESSAGE_MAX = 1500;

export type SupportContext = {
  /** Nombre para mostrar de quien escribe, si hay sesión. */
  displayName?: string | null;
  /** Correo de la cuenta — sirve para encontrarla sin preguntar de nuevo. */
  accountEmail?: string | null;
  /** id del perfil: lo que de verdad identifica la cuenta en la base. */
  accountId?: string | null;
  /** Nombre de la comunidad desde la que escribe. */
  community?: string | null;
};

/**
 * Pie técnico del correo. Va SIEMPRE visible dentro del borrador, nunca
 * escondido: es el correo de la persona y tiene derecho a ver —y borrar— todo
 * lo que manda. Sin esto, la primera respuesta de soporte siempre es "¿con qué
 * correo entrás?", y esa ida y vuelta cuesta un día.
 */
export function buildSupportFooter(context: SupportContext): string {
  const lines: string[] = [];
  if (context.accountEmail) lines.push(`Cuenta: ${context.accountEmail}`);
  if (context.displayName) lines.push(`Nombre en la app: ${context.displayName}`);
  if (context.community) lines.push(`Comunidad: ${context.community}`);
  if (context.accountId) lines.push(`ID: ${context.accountId}`);
  if (lines.length === 0) return "";
  return ["—", "Datos que nos ayudan a encontrar tu cuenta:", ...lines].join("\n");
}

export function buildSupportSubject(topicId: string): string {
  return `[Soporte] ${findTopic(topicId).subject}`;
}

/** El cuerpo completo del correo, tal cual se va a ver en el borrador. */
export function buildSupportBody(message: string, context: SupportContext): string {
  const footer = buildSupportFooter(context);
  const body = message.trim();
  return footer ? `${body}\n\n${footer}\n` : `${body}\n`;
}

/**
 * `mailto:` con destinatario, asunto y cuerpo ya escritos.
 *
 * `encodeURIComponent` y no `URLSearchParams`: el segundo codifica los espacios
 * como `+`, y en el cuerpo de un correo los `+` se ven como `+` literales —
 * un mensaje lleno de signos de suma en vez de espacios.
 */
export function buildSupportMailto(
  topicId: string,
  message: string,
  context: SupportContext,
): string {
  const subject = encodeURIComponent(buildSupportSubject(topicId));
  const body = encodeURIComponent(buildSupportBody(message, context));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

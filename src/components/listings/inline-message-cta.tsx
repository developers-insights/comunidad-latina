"use client";

import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr";
import { InlineContact, listingMessageOutcome } from "@/components/messaging";
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";

/**
 * MENSAJE INLINE (call con el cliente 2026-07-24: "quiero escribirle sin salir
 * de la publicación").
 *
 * Un botón que, en vez de navegar, ABRE ahí mismo un mini-composer con la misma
 * gramática visual que el hilo de Mensajes. Al enviar, el bloque se colapsa a
 * la confirmación y la conversación sigue viva donde corresponde, pero la
 * persona nunca perdió la publicación que estaba mirando.
 *
 * El contacto NO se abarata: por debajo sigue siendo `request_contact` (la
 * conversación nace pendiente y el receptor decide si acepta). Esto sólo cambia
 * DÓNDE se escribe el primer mensaje.
 *
 * ── QUÉ CAMBIÓ EL 2026-08-20 ────────────────────────────────────────────────
 * Este archivo era el ÚNICO que hacía las cosas bien, y por eso ahora es el que
 * menos código tiene: la interacción se mudó a `messaging/inline-contact` para
 * que las otras tres pantallas de contacto (aviso, profesional, candidato)
 * dejen de contradecirlo. Acá quedan sólo dos cosas que sí son de este módulo:
 * el copy y la traducción de los códigos del action a frases humanas.
 *
 * Además se cayó el último muro: sin sesión ya NO se navega a `/entrar`. Se
 * abre la hoja de `auth-sheet` encima de la publicación y, al volver, el
 * composer se abre solo. El pedido del cliente era "sin sacarte del feed", y
 * mandarlo a una pantalla de login lo sacaba igual que mandarlo a la bandeja.
 *
 * El COPY vive acá, local al componente, y no en `./copy.ts`: el copy compartido
 * de este módulo lo toca otro agente en paralelo. Un solo dueño por archivo.
 */

export const INLINE_MESSAGE_COPY = {
  cta: "Mensaje",
  fieldLabel: "Escribí tu mensaje",
  placeholder: "Hola, me interesa. ¿Sigue disponible?",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  hint: "Se abre un chat privado. Nunca compartas datos bancarios ni contraseñas.",
  successTitle: "Mensaje enviado",
  successBody: "Te avisamos acá apenas te respondan.",
  // Ya venían hablando: se dice, no se disfraza de contacto nuevo.
  reusedTitle: "Lo sumamos al chat que ya tenían",
  reusedBody: "No abrimos nada nuevo: tu mensaje quedó en esa misma conversación.",
  sentLink: "Abrir el chat",
  loginCta: "Entrar a mi cuenta",
  errors: {
    self: "Es tu propia publicación — no podés escribirte a vos.",
    blocked: "No podemos entregar este mensaje.",
    unauthenticated: "Se cerró tu sesión. Entrá de nuevo y lo mandamos.",
    "tenant-mismatch": "Algo no cuadra con tu sesión. Salí y volvé a entrar.",
    invalid: "Escribí un poquito más antes de enviarlo.",
    error: "No pudimos enviarlo — no es tu culpa. Probá de nuevo en un ratito.",
  },
} as const;

/** Alias interno: el nombre exportado es largo a propósito (lo leen los tests). */
const COPY = INLINE_MESSAGE_COPY;

export interface InlineMessageCtaProps {
  /** Aviso al que se le escribe (producto, tienda o evento). */
  listingId: string;
  isLoggedIn: boolean;
  /**
   * Ruta de vuelta tras entrar. Ya no decide nada —la hoja de sesión resuelve
   * en el lugar y no navega— pero se mantiene declarada para no romper los
   * call sites que la siguen pasando.
   */
  nextPath?: string;
  /** Texto del botón colapsado. Default: "Mensaje". */
  label?: string;
  /** Placeholder contextual del mini-composer. */
  placeholder?: string;
  className?: string;
}

export function InlineMessageCta({
  listingId,
  isLoggedIn,
  label = COPY.cta,
  placeholder = COPY.placeholder,
  className,
}: InlineMessageCtaProps) {
  return (
    <InlineContact
      className={className}
      isLoggedIn={isLoggedIn}
      triggerIcon={<ChatTeardropText size={20} aria-hidden="true" />}
      copy={{
        trigger: label,
        fieldLabel: COPY.fieldLabel,
        placeholder,
        send: COPY.send,
        cancel: COPY.cancel,
        hint: COPY.hint,
        sentTitle: COPY.successTitle,
        sentBody: COPY.successBody,
        reusedTitle: COPY.reusedTitle,
        reusedBody: COPY.reusedBody,
        threadLink: COPY.sentLink,
        retryLogin: COPY.loginCta,
      }}
      onSend={async (body) =>
        listingMessageOutcome(
          await sendListingMessageAction({ listingId, body }),
          COPY.errors,
        )
      }
    />
  );
}

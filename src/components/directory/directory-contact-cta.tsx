"use client";

import { useState } from "react";
import { ChatCircleDots, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { InlineContact, listingMessageOutcome } from "@/components/messaging";
import { cn } from "@/lib/utils";
// Contacto protegido §9.2: por debajo sigue siendo el MISMO RPC request_contact
// que vivienda — `sendListingMessageAction` lo llama y le adjunta el primer
// mensaje. No duplicamos la escritura ni inventamos queries nuevas.
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";

const COPY = {
  // Ver nota en listings/copy.ts: una sola mención, y concreta.
  cta: "Contactar",
  hint: "Tu teléfono no se comparte",
  fieldLabel: "Escribí tu mensaje",
  placeholder: "Hola, quería consultarte por tu servicio.",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  sentTitle: "Mensaje enviado",
  sentBody: "Te avisamos acá apenas te responda.",
  // Honestidad, no cortesía: si ya venían hablando, no hubo ningún alta nueva.
  reusedTitle: "Lo sumamos al chat que ya tenían",
  reusedBody: "No abrimos nada nuevo: tu mensaje quedó en esa misma conversación.",
  threadLink: "Abrir el chat",
  retryLogin: "Entrar a mi cuenta",
  errors: {
    self: "Este perfil es tuyo — no hace falta que te escribas.",
    blocked: "No podemos entregar este mensaje.",
    unauthenticated: "Se cerró tu sesión. Entrá de nuevo y lo mandamos.",
    "tenant-mismatch": "Algo no cuadra con tu sesión. Salí y volvé a entrar.",
    invalid: "Escribí un poquito más antes de enviarlo.",
    error: "No pudimos enviarlo — no es tu culpa. Probá de nuevo en un ratito.",
  },
  externalSheetTitle: "Este perfil vino de una fuente externa",
  externalSheetBody: (name: string) =>
    `Lo publicó ${name} fuera de la app, con su permiso. El contacto se hace por los datos que esa fuente publicó — no podemos protegerlo desde acá.`,
  externalReminder:
    "Recordá: acordá el precio por escrito y nunca pagues todo por adelantado.",
  externalClose: "Entendido",
} as const;

export interface DirectoryContactCtaProps {
  listingId: string;
  /**
   * Ruta de vuelta tras entrar. Ya no decide nada —la hoja de sesión resuelve
   * en el lugar y no navega— pero se mantiene declarada para no romper el call
   * site que la sigue pasando.
   */
  returnPath?: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  externalName?: string | null;
}

/**
 * CTA sticky de contacto protegido para el detalle de un profesional.
 *
 * Mismo comportamiento que vivienda, y ahora también la misma FORMA: el
 * mensaje se escribe y se confirma en esta pantalla (cliente 2026-08-20,
 * "mientras menos pasos mejor"). Antes hacía `router.push('/mensajes')` y la
 * persona perdía el perfil que estaba evaluando —reseñas, verificación, precios—
 * justo en el momento en que decidía contratarlo.
 *
 * Sin sesión tampoco se navega: la hoja de `auth-sheet` se abre encima del
 * perfil y al volver el composer se abre solo.
 */
export function DirectoryContactCta({
  listingId,
  isLoggedIn,
  isExternal,
  externalName,
}: DirectoryContactCtaProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div
        // Barra sólida como el bottom nav (ver nota en listings/contact-cta):
        // el degradado dejaba ver la card de abajo y parecía un solapamiento.
        className={cn(
          "fixed inset-x-0 z-30",
          "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
          "border-t border-border bg-surface/92 backdrop-blur-md pb-3 pt-3",
        )}
      >
        <div className="mx-auto w-full max-w-lg px-4">
          {isExternal ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => setSheetOpen(true)}
              >
                <ChatCircleDots size={20} aria-hidden="true" />
                {COPY.cta}
              </Button>
              <p className="mt-1.5 text-center text-xs text-foreground-muted">
                {COPY.hint}
              </p>
            </>
          ) : (
            <InlineContact
              isLoggedIn={isLoggedIn}
              triggerIcon={<ChatCircleDots size={20} aria-hidden="true" />}
              copy={{
                trigger: COPY.cta,
                fieldLabel: COPY.fieldLabel,
                placeholder: COPY.placeholder,
                send: COPY.send,
                cancel: COPY.cancel,
                hint: COPY.hint,
                sentTitle: COPY.sentTitle,
                sentBody: COPY.sentBody,
                reusedTitle: COPY.reusedTitle,
                reusedBody: COPY.reusedBody,
                threadLink: COPY.threadLink,
                retryLogin: COPY.retryLogin,
              }}
              onSend={async (body) =>
                listingMessageOutcome(
                  await sendListingMessageAction({ listingId, body }),
                  COPY.errors,
                )
              }
            />
          )}
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={COPY.externalSheetTitle}
      >
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-sm text-foreground-secondary">
            {COPY.externalSheetBody(externalName ?? "una fuente comunitaria")}
          </p>
          <div
            role="note"
            aria-label="Aviso de seguridad"
            className="flex items-start gap-3 rounded-lg bg-warning-bg p-4"
          >
            <ShieldWarning size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <p className="text-sm text-foreground">{COPY.externalReminder}</p>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setSheetOpen(false)}>
            {COPY.externalClose}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

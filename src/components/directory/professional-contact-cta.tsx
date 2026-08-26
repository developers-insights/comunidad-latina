"use client";

import { useState } from "react";
import { ChatCircleDots, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { InlineContact, listingMessageOutcome } from "@/components/messaging";
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";
import { cn } from "@/lib/utils";

/**
 * "Contactar" en la CARD del directorio (spec cliente: cada perfil muestra los
 * botones "Ver perfil" Y "Contactar" — hoy sólo estaba el primero).
 *
 * El copy vive ACÁ, local al componente, y no en `./copy.ts`: mismo criterio
 * que `listings/inline-message-cta.tsx` — el copy compartido de este módulo lo
 * puede tocar otro agente en paralelo, y "un solo dueño por archivo" evita el
 * choque.
 *
 * ── POR QUÉ NO ES `<DirectoryContactCta>` REUTILIZADO TAL CUAL ───────────────
 * Ese componente es la barra `fixed` del DETALLE — un solo `Contactar` por
 * pantalla, pegado abajo. Acá el mismo listado tiene 12 cards a la vez: 12
 * barras `fixed` se pisarían en el mismo lugar de la pantalla. Este componente
 * es la MISMA lógica (composer inline para fichas con cuenta; hoja de aviso de
 * seguridad para fuente externa), en línea dentro de la card en vez de fija.
 *
 * ── LAS DOS RAMAS, IGUAL QUE EN EL DETALLE ───────────────────────────────────
 * Ficha con cuenta (`isExternal=false`): `InlineContact` de verdad — el primer
 * mensaje sigue siendo `request_contact` por debajo (vía
 * `sendListingMessageAction`), la conversación nace pendiente y el composer se
 * abre ACÁ MISMO, sin salir de la lista.
 * Ficha externa (`isExternal=true`, seed/API sin `created_by`): no hay cuenta a
 * la que mandarle un mensaje interno — se explica de dónde salió el perfil y el
 * aviso de seguridad de siempre, en una hoja, no en el composer.
 */

const COPY = {
  cta: "Contactar",
  hint: "Tu teléfono no se comparte",
  fieldLabel: "Escribí tu mensaje",
  placeholder: (title: string) => `Hola, quería consultarte por "${title}".`,
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

export interface ProfessionalContactCtaProps {
  listingId: string;
  /** Nombre del profesional/estudio — sólo para personalizar el placeholder del mensaje. */
  title: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  externalName?: string | null;
  className?: string;
}

export function ProfessionalContactCta({
  listingId,
  title,
  isLoggedIn,
  isExternal,
  externalName,
  className,
}: ProfessionalContactCtaProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isExternal) {
    return (
      <>
        <Button
          variant="outline"
          size="md"
          className={cn("w-full", className)}
          onClick={() => setSheetOpen(true)}
        >
          <ChatCircleDots size={18} aria-hidden="true" />
          {COPY.cta}
        </Button>

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
              <ShieldWarning
                size={22}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
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

  return (
    <InlineContact
      className={className}
      isLoggedIn={isLoggedIn}
      triggerSize="md"
      triggerIcon={<ChatCircleDots size={18} aria-hidden="true" />}
      copy={{
        trigger: COPY.cta,
        fieldLabel: COPY.fieldLabel,
        placeholder: COPY.placeholder(title),
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
  );
}

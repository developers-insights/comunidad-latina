"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Info, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Field, Input, Textarea } from "@/components/ui";
import { applyToGig } from "@/app/(app)/creadores/actions";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { ContactBlockNotice, hasContactInfo } from "./contact-block-notice";
import { COPY } from "./copy";

/**
 * Aplicar a un aviso (bottom-sheet): mensaje + monto propuesto opcional.
 * Optimista en la navegación: al enviar refresca la página para que el estado
 * "ya aplicaste" aparezca sin recargar.
 *
 * Bloqueo de datos de contacto (§6): el aviso aparece mientras se escribe y el
 * botón queda inhabilitado. La decisión real la toma el servidor —`applyToGig`
 * corre el mismo detector antes de escribir— así que este control es para que
 * nadie escriba de más, no para autorizar.
 *
 * ── LA MISMA HOJA, DOS SUPERFICIES (cliente 2026-08-20) ────────────────────
 * "Mientras menos pasos mejor": esta hoja también se monta desde la CARD del
 * listado, para que postularse no obligue a pasar antes por `/creadores/[id]`.
 * Es el mismo componente, la misma action y las mismas validaciones — lo único
 * que cambia es el disparador (`surface`) y qué pasa después de enviar. Ver
 * `GigCard`.
 */

/** Copy propio de la superficie "card": `copy.ts` lo comparten varios flujos. */
const COPY_CARD = {
  cta: "Postularme",
  ctaAria: (title: string) => `Postularme a ${title}`,
  applied: "Ya te postulaste",
} as const;

/**
 * EL FINAL QUE NO ES UN ALTA (revisión 2026-08-20).
 *
 * `applyToGig` devuelve `{ ok: true, alreadyApplied: true }` cuando la unique de
 * `gig_applications` rebota: esta persona ya se había postulado y lo que acaba
 * de escribir NO se guardó. Hasta hoy esa respuesta caía en el mismo
 * `setDone(true)` que un envío de verdad, así que la pantalla decía "¡Propuesta
 * enviada!" sobre un mensaje que se descartó en silencio. En `/creadores/[id]`
 * el `router.refresh()` tapaba la mentira; desde la card del listado —que no
 * refresca a propósito— quedaba en pantalla tal cual.
 *
 * Se elige CONTARLO y no pre-chequear (como hace empleos con
 * `loadJobApplyContextAction`) porque acá el pre-chequeo no alcanzaría: entre
 * abrir la hoja y enviar puede haber otra pestaña, y el servidor sigue siendo el
 * único que sabe. Un pre-chequeo ahorra escritura perdida en el caso común, pero
 * no puede evitar este final — y si este final miente, el pre-chequeo tapa el
 * bug en vez de arreglarlo. Primero que diga la verdad; el pre-chequeo, si algún
 * día se agrega, es una mejora encima de esto y no un reemplazo.
 */
const COPY_ALREADY = {
  title: "Ya te habías postulado",
  body: "Lo que escribiste ahora no se envió: tu primera propuesta sigue en pie y el negocio la puede ver.",
} as const;

/** Cómo terminó el envío. `null` = todavía no terminó. Ver `COPY_ALREADY`. */
type ApplyOutcome = "sent" | "already";

export interface ApplySheetProps {
  gigId: string;
  /**
   * Dónde vive el disparador.
   *
   * · `"detail"` (default, comportamiento histórico): botón ancho con el label
   *   largo del módulo, y al enviar se refresca la página para que el server
   *   vuelva a pintar el bloque "ya te postulaste".
   * · `"card"`: botón corto dentro de una card del listado. Al enviar NO se
   *   refresca —traer las 12 cards y perder el scroll para cambiar un botón es
   *   caro y se nota— así que el propio disparador se convierte en el estado.
   */
  surface?: "detail" | "card";
  /** Título del aviso: nombra al botón para el lector de pantalla en `"card"`. */
  gigTitle?: string;
}

export function ApplySheet({ gigId, surface = "detail", gigTitle }: ApplySheetProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const inCard = surface === "card";
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<ApplyOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mismo detector que corre el servidor: si avisara con otra regla, habría
  // textos que pasan el aviso y rebotan igual al enviar.
  const contactBlocked = hasContactInfo(message);

  async function handleSubmit() {
    if (message.trim().length < 20) {
      setError(COPY.apply.errors.messageShort);
      return;
    }
    // Cinturón: el botón ya está inhabilitado, pero un Enter en el textarea o
    // un doble evento no pueden saltearse la regla.
    if (contactBlocked) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await applyToGig({
        gigId,
        message: message.trim(),
        proposedAmount: amount ? Number(amount) : null,
      });
      if (!result.ok) {
        if (result.needsAuth) {
          /**
           * Sin sesión tampoco se navega (2026-08-20): la hoja de
           * autenticación se abre encima y al volver se reintenta el envío
           * SOLO. Lo importante es lo que NO pasa: el formulario no se
           * desmonta, así que lo que la persona escribió sigue ahí. Antes esto
           * era un `router.push` a /entrar y el texto se perdía entero.
           */
          requireAuth({
            reason: AUTH_REASON.apply,
            onAuthenticated: () => void handleSubmit(),
          });
          return;
        }
        setError(result.error);
        return;
      }
      setDone(result.alreadyApplied ? "already" : "sent");
      // Desde la card el estado nuevo ya vive acá: refrescar sería recargar el
      // listado entero (y su scroll) para cambiar un solo botón.
      if (!inCard) router.refresh();
    } catch {
      setError(COPY.apply.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {inCard && done ? (
        <p
          role="status"
          className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-full border border-success/25 bg-success-bg px-4 text-sm font-semibold text-success-ink"
        >
          <CheckCircle size={17} weight="fill" aria-hidden="true" className="shrink-0" />
          {COPY_CARD.applied}
        </p>
      ) : (
        <Button
          variant="primary"
          size={inCard ? "md" : "lg"}
          className={inCard ? "mt-1 w-full" : "w-full"}
          aria-label={inCard && gigTitle ? COPY_CARD.ctaAria(gigTitle) : undefined}
          onClick={() => setOpen(true)}
        >
          <PaperPlaneTilt size={inCard ? 18 : 20} weight="fill" aria-hidden="true" />
          {inCard ? COPY_CARD.cta : COPY.apply.title}
        </Button>
      )}

      <BottomSheet
        open={open}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        title={done ? undefined : COPY.apply.title}
        ariaLabel={COPY.apply.title}
      >
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            {/* Ícono neutro y no el tilde verde cuando no hubo alta: el color de
                éxito es la mitad del mensaje, y acá no hay nada que festejar. */}
            {done === "already" ? (
              <Info size={52} weight="fill" aria-hidden="true" className="text-foreground-muted" />
            ) : (
              <CheckCircle size={52} weight="fill" aria-hidden="true" className="text-success" />
            )}
            <h3 className="font-display text-lg font-bold text-foreground">
              {done === "already" ? COPY_ALREADY.title : COPY.apply.successTitle}
            </h3>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">
              {done === "already" ? COPY_ALREADY.body : COPY.apply.successBody}
            </p>
            <Button variant="primary" className="mt-2 w-full" onClick={() => setOpen(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-sm text-foreground-secondary">{COPY.apply.intro}</p>

            <Field htmlFor="apply-message" label={COPY.apply.messageLabel} help={COPY.apply.messageHelp}>
              <Textarea
                id="apply-message"
                rows={5}
                value={message}
                maxLength={1000}
                placeholder={COPY.apply.messagePlaceholder}
                onChange={(event) => setMessage(event.target.value)}
              />
            </Field>

            <Field htmlFor="apply-amount" label={COPY.apply.amountLabel} help={COPY.apply.amountHelp} optional>
              <Input
                id="apply-amount"
                type="number"
                inputMode="decimal"
                min={0}
                value={amount}
                placeholder={COPY.apply.amountPlaceholder}
                onChange={(event) => setAmount(event.target.value)}
                className="numeric"
              />
            </Field>

            <ContactBlockNotice text={message} />

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={submitting}
              disabled={contactBlocked}
              onClick={handleSubmit}
            >
              {submitting ? COPY.apply.submitting : COPY.apply.submit}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

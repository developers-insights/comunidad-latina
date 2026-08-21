"use client";

import { useState } from "react";
import {
  ArrowSquareOut,
  CalendarCheck,
  ChatCircleDots,
  Globe,
  NavigationArrow,
  Phone,
  ShieldWarning,
  ShoppingBag,
  Ticket,
  WhatsappLogo,
} from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { InlineContact, listingMessageOutcome } from "@/components/messaging";
import { cn } from "@/lib/utils";
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";
import { recordCtaClickAction } from "@/lib/monetization/actions";
import { ctaHref } from "@/lib/monetization/href";
import {
  MONETIZATION_COPY,
  externalCtasFor,
  canUseActionButtons,
  type CtaKind,
  type ExternalCtaKind,
} from "@/lib/monetization";
import { COPY } from "./copy";

const M = MONETIZATION_COPY;

/**
 * Copy del composer, local al componente: `./copy.ts` lo comparten varios
 * flujos y lo toca otro agente en paralelo. Un solo dueño por archivo.
 *
 * Los textos de "ya sos quien lo publica" y compañía sí salen de `copy.ts`
 * porque ya estaban escritos y revisados para exactamente ese caso.
 */
const INLINE = {
  fieldLabel: "Escribí tu mensaje",
  /**
   * Neutro a propósito: esta barra la monta Propiedades y también
   * `comunidad/perdidos`. "¿Sigue disponible?" sobre un perro perdido se lee
   * espantoso, así que el default sirve para los dos y quien quiera afinarlo
   * pasa `placeholder`.
   */
  placeholder: "Hola, quería consultarte por este aviso.",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  sentTitle: "Mensaje enviado",
  sentBody: "Te avisamos acá apenas te respondan.",
  reusedTitle: "Lo sumamos al chat que ya tenían",
  reusedBody: "No abrimos nada nuevo: tu mensaje quedó en esa misma conversación.",
  threadLink: "Abrir el chat",
  retryLogin: "Entrar a mi cuenta",
  errors: {
    self: COPY.detail.contactOwnBody,
    blocked: "No podemos entregar este mensaje.",
    unauthenticated: "Se cerró tu sesión. Entrá de nuevo y lo mandamos.",
    "tenant-mismatch": "Algo no cuadra con tu sesión. Salí y volvé a entrar.",
    invalid: "Escribí un poquito más antes de enviarlo.",
    error: "No pudimos enviarlo — no es tu culpa. Probá de nuevo en un ratito.",
  },
} as const;

export interface ContactCtaProps {
  listingId: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  /** Nombre visible de la fuente externa (publisher_name). */
  externalName?: string | null;
  /** Primera línea sugerida del mensaje, si el vertical la quiere afinar. */
  placeholder?: string;
}

/**
 * CTA sticky "Contactar" (§4.d) — el CTA primario de la pantalla de detalle, y
 * el ÚNICO contacto de una publicación gratuita.
 *
 * - Sin sesión → hoja de `auth-sheet` ENCIMA del aviso; al volver, el composer
 *   se abre solo.
 * - Con sesión → mini-composer en la misma barra: se escribe y se confirma sin
 *   cambiar de ruta.
 * - Aviso externo (seed) → BottomSheet honesto: la fuente + recordatorio
 *   anti-estafa.
 *
 * ── POR QUÉ YA NO SE VA A /mensajes (cliente 2026-08-20) ────────────────────
 * "Ahí nomás dentro de pantalla se tiene que fluir sin sacarte del feed; si no
 * es como que te corta el mambo." Hasta hoy este botón hacía
 * `router.push('/mensajes')` — a la bandeja GENÉRICA, ni siquiera al hilo — y
 * la persona perdía el aviso, las fotos y el scroll del listado del que venía.
 * Ahora el hilo es una opción al final de la confirmación, no un peaje.
 *
 * ── POR QUÉ AHORA SE ESCRIBE UN MENSAJE Y NO SÓLO SE "PIDE CONTACTO" ────────
 * `sendListingMessageAction` llama por debajo al MISMO `request_contact`, así
 * que el contacto protegido §9.2 queda igual: la conversación nace pending y el
 * receptor acepta o ignora. Lo que cambia es que del otro lado llega una
 * pregunta concreta en vez de un aviso vacío, y que la confirmación puede ser
 * honesta: cuando ya había conversación, lo dice — no la pinta como alta nueva.
 *
 * El clic se registra como `chat` en `cta_clicks` al ABRIR el composer, que es
 * el momento equivalente al clic de siempre. Ese kind existe en la 0048
 * justamente para esto: sin él, el panel del dueño podría decir "23 llamadas" y
 * nada sobre los mensajes.
 */
export function ContactCta({
  listingId,
  isLoggedIn,
  isExternal,
  externalName,
  placeholder = INLINE.placeholder,
}: ContactCtaProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  // Barra de acción sólida, no un degradado: el degradado dejaba ver la card
  // de abajo a través suyo y se leía como un solapamiento sucio (pedido
  // cliente 2026-07-20). Mismo tratamiento que el bottom nav —superficie
  // translúcida con blur y hairline arriba— para que se lean como un sistema.
  const wrapperClass = cn(
    "fixed inset-x-0 z-30",
    "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
    "border-t border-border bg-surface/92 backdrop-blur-md pb-3 pt-3",
  );

  return (
    <>
      <div className={wrapperClass}>
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
                {COPY.detail.contactCta}
              </Button>
              <p className="mt-1.5 text-center text-xs text-foreground-muted">
                {COPY.detail.contactHint}
              </p>
            </>
          ) : (
            <InlineContact
              isLoggedIn={isLoggedIn}
              triggerIcon={<ChatCircleDots size={20} aria-hidden="true" />}
              onOpen={() => {
                // Sin `await`: el contacto no espera al contador (ver
                // recordCtaClickAction).
                void recordCtaClickAction({ listingId, kind: "chat" });
              }}
              copy={{
                trigger: COPY.detail.contactCta,
                fieldLabel: INLINE.fieldLabel,
                placeholder,
                send: INLINE.send,
                cancel: INLINE.cancel,
                hint: COPY.detail.contactHint,
                sentTitle: INLINE.sentTitle,
                sentBody: INLINE.sentBody,
                reusedTitle: INLINE.reusedTitle,
                reusedBody: INLINE.reusedBody,
                threadLink: INLINE.threadLink,
                retryLogin: INLINE.retryLogin,
              }}
              onSend={async (body) =>
                listingMessageOutcome(
                  await sendListingMessageAction({ listingId, body }),
                  INLINE.errors,
                )
              }
            />
          )}
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={COPY.detail.seedSheetTitle}
      >
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-sm text-foreground-secondary">
            {COPY.detail.seedSheetBody(externalName ?? "una fuente comunitaria")}
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
            <p className="text-sm text-foreground">{COPY.detail.seedSheetReminder}</p>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setSheetOpen(false)}>
            {COPY.detail.seedSheetClose}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Botones de acción (premium) — los de la spec, por módulo
// ---------------------------------------------------------------------------

const ICON: Record<CtaKind, typeof Phone> = {
  phone: Phone,
  whatsapp: WhatsappLogo,
  website: Globe,
  purchase: ShoppingBag,
  tickets: Ticket,
  booking: CalendarCheck,
  directions: NavigationArrow,
  chat: ChatCircleDots,
};

interface ResolvedCta {
  kind: ExternalCtaKind;
  href: string;
  external: boolean;
  display: string;
}

/**
 * Nombre accesible del botón: la ACCIÓN y el DESTINO. Los cuatro botones de
 * link no dicen la URL (leerla en voz alta es ilegible); los de teléfono y
 * dirección sí, porque ahí el dato ES el destino.
 */
function accessibleNameFor(button: ResolvedCta, subject: string): string {
  switch (button.kind) {
    case "phone":
      return M.cta.accessible.phone(subject, button.display);
    case "whatsapp":
      return M.cta.accessible.whatsapp(subject, button.display);
    case "directions":
      return M.cta.accessible.directions(subject, button.display);
    case "website":
      return M.cta.accessible.website(subject);
    case "purchase":
      return M.cta.accessible.purchase(subject);
    case "tickets":
      return M.cta.accessible.tickets(subject);
    case "booking":
      return M.cta.accessible.booking(subject);
  }
}

export interface ListingActionsProps {
  listingId: string;
  /** listings.kind — decide QUÉ botones existen (MODULE_CTAS). */
  kind: string;
  /** listings.tier — decide SI existen. Se lee de la fila, nunca del cliente. */
  tier: unknown;
  /** Los valores que trae la fila, botón por botón. */
  values: Partial<Record<ExternalCtaKind, string | null>>;
  /** Nombre del aviso: entra en el nombre accesible de cada botón. */
  subject: string;
  /**
   * ¿Renderizar también el chat acá? En Propiedades va en `false` porque la
   * barra sticky de arriba YA es el chat y está visible al mismo tiempo — dos
   * botones idénticos en la misma pantalla no son "el chat al lado", son ruido.
   * En los verticales sin barra sticky (Eventos, Profesionales) va en `true`.
   */
  showChat?: boolean;
  isLoggedIn?: boolean;
  className?: string;
}

/**
 * Fila de botones de acción de un aviso PREMIUM, con el chat de Comunidad
 * Latina siempre al lado.
 *
 * Tres decisiones que no se ven pero se notan:
 *
 *  1. Cada `href` sale de `ctaHref`, que pasa los links por `safeExternalHref`.
 *     Un botón firmado con el nombre de un comercio de la comunidad que lleva a
 *     un login clonado no es un bug de UX; para este público es robo de
 *     credenciales.
 *  2. El nombre accesible dice la ACCIÓN y el DESTINO ("Llamar a Doña Rosa al
 *     +1 305 555 0134"), no "enlace". Un lector de pantalla que anuncia cinco
 *     veces "botón" no dijo nada.
 *  3. Si el tier no es premium, esto no renderiza NADA — ni un candado, ni un
 *     botón gris que al tocarlo vende. El aviso gratuito se contacta por el
 *     chat y punto; la venta va en el panel del dueño, no en la cara de quien
 *     vino a preguntar por un alquiler.
 *
 * El chat de esta fila también dejó de navegar (cliente 2026-08-20): el
 * composer se abre en la misma celda de la grilla y la fila de botones sigue
 * ahí abajo. Antes mandaba a `/mensajes` y la persona perdía los otros cinco
 * botones que estaba comparando.
 */
export function ListingActions({
  listingId,
  kind,
  tier,
  values,
  subject,
  showChat = true,
  isLoggedIn = true,
  className,
}: ListingActionsProps) {
  if (!canUseActionButtons(tier)) return null;

  const buttons: ResolvedCta[] = [];
  for (const ctaKind of externalCtasFor(kind)) {
    const resolved = ctaHref(ctaKind, values[ctaKind]);
    if (resolved) buttons.push({ kind: ctaKind, ...resolved });
  }

  if (buttons.length === 0) return null;

  return (
    <section className={cn("flex flex-col gap-2.5", className)} aria-label={M.cta.formTitle}>
      {/* Grilla de 2 columnas en móvil: un botón de ancho completo por acción
          desperdicia la pantalla, y tres por fila deja etiquetas cortadas. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buttons.map((button) => {
          const Icon = ICON[button.kind];
          const label = M.cta.label[button.kind];
          const accessible = accessibleNameFor(button, subject);

          return (
            <a
              key={button.kind}
              href={button.href}
              aria-label={accessible}
              {...(button.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              onClick={() => void recordCtaClickAction({ listingId, kind: button.kind })}
              className={cn(
                // min-h-11 = 44px: el mínimo táctil, no una sugerencia.
                "group relative flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5",
                "border-border-subtle bg-surface text-sm font-semibold text-foreground",
                "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:border-brand hover:bg-brand-tint hover:text-brand-ink active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <Icon
                size={18}
                weight="regular"
                aria-hidden="true"
                className="shrink-0 text-brand"
              />
              <span className="truncate">{label}</span>
              {button.external && (
                <ArrowSquareOut
                  size={12}
                  aria-hidden="true"
                  className="absolute right-2 top-2 text-foreground-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100"
                />
              )}
            </a>
          );
        })}

        {showChat && (
          <InlineContact
            className="col-span-2 sm:col-span-3"
            isLoggedIn={isLoggedIn}
            triggerSize="md"
            triggerAriaLabel={M.cta.accessible.chat(subject)}
            triggerIcon={<ChatCircleDots size={18} aria-hidden="true" />}
            onOpen={() => {
              void recordCtaClickAction({ listingId, kind: "chat" });
            }}
            copy={{
              trigger: M.cta.label.chat,
              fieldLabel: INLINE.fieldLabel,
              // Genérico a propósito: esta fila la montan Eventos,
              // Profesionales, Negocios y Marketplace además de Propiedades.
              placeholder: "Hola, quería hacerte una consulta.",
              send: INLINE.send,
              cancel: INLINE.cancel,
              // Corta: la nota de seguridad larga ya vive al pie de la fila y
              // repetirla acá era decir dos veces lo mismo en 40px.
              hint: "Se abre un chat privado.",
              sentTitle: INLINE.sentTitle,
              sentBody: INLINE.sentBody,
              reusedTitle: INLINE.reusedTitle,
              reusedBody: INLINE.reusedBody,
              threadLink: INLINE.threadLink,
              retryLogin: INLINE.retryLogin,
            }}
            onSend={async (body) =>
              listingMessageOutcome(
                await sendListingMessageAction({ listingId, body }),
                INLINE.errors,
              )
            }
          />
        )}
      </div>

      <p className="text-xs leading-relaxed text-foreground-muted">{M.cta.safetyNote}</p>
    </section>
  );
}

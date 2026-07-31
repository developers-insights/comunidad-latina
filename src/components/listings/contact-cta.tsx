"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { BottomSheet, Button, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { requestContactAction } from "@/app/(app)/propiedades/actions";
import { recordCtaClickAction } from "@/lib/monetization/actions";
import { ctaHref, listingViewHref } from "@/lib/monetization/href";
import {
  MONETIZATION_COPY,
  externalCtasFor,
  canUseActionButtons,
  type CtaKind,
  type ExternalCtaKind,
} from "@/lib/monetization";
import { COPY } from "./copy";

const M = MONETIZATION_COPY;

export interface ContactCtaProps {
  listingId: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  /** Nombre visible de la fuente externa (publisher_name). */
  externalName?: string | null;
}

/**
 * CTA sticky "Contactar (protegido)" (§4.d) — el CTA primario de la pantalla de
 * detalle, y el ÚNICO contacto de una publicación gratuita.
 *
 * - Sin sesión → /entrar con redirect de vuelta al aviso.
 * - Con sesión → RPC request_contact (conversación pending, contacto protegido).
 * - Aviso externo (seed) → BottomSheet honesto: la fuente + recordatorio anti-estafa.
 *
 * El clic se registra como `chat` en `cta_clicks`. Ese kind existe en la 0048
 * justamente para esto: sin él, el panel del dueño podría decir "23 llamadas" y
 * nada sobre los mensajes, y "cuántos me escribieron" contra "cuántos me
 * llamaron" es la comparación que decide si conviene pagar los botones.
 */
export function ContactCta({
  listingId,
  isLoggedIn,
  isExternal,
  externalName,
}: ContactCtaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleContact() {
    startTransition(async () => {
      // La métrica va primero y sin `await` bloqueante del resultado: el
      // contacto no espera al contador (ver recordCtaClickAction).
      void recordCtaClickAction({ listingId, kind: "chat" });
      const result = await requestContactAction(listingId);
      if (result.ok) {
        toast({
          title: COPY.detail.contactSuccessTitle,
          description: COPY.detail.contactSuccessBody,
          variant: "success",
        });
        router.push("/mensajes");
        return;
      }
      // El tono lo decide la action: "info" para aclaraciones amables (aviso
      // propio, sin cuenta, sesión vencida) → variante neutra; "error" para
      // fallas reales → warning. Nunca "danger": ningún caso acá amerita alarma.
      toast({
        title: result.title,
        description: result.error,
        variant: result.tone === "info" ? "info" : "warning",
      });
    });
  }

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
          {!isLoggedIn ? (
            <Link
              href={`/entrar?next=${encodeURIComponent(`/propiedades/${listingId}`)}`}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              <ChatCircleDots size={20} aria-hidden="true" />
              {COPY.detail.contactCta}
            </Link>
          ) : isExternal ? (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => setSheetOpen(true)}
            >
              <ChatCircleDots size={20} aria-hidden="true" />
              {COPY.detail.contactCta}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={isPending}
              onClick={handleContact}
            >
              <ChatCircleDots size={20} aria-hidden="true" />
              {COPY.detail.contactCta}
            </Button>
          )}
          <p className="mt-1.5 text-center text-xs text-foreground-muted">
            {COPY.detail.contactHint}
          </p>
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
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  if (!canUseActionButtons(tier)) return null;

  const buttons: ResolvedCta[] = [];
  for (const ctaKind of externalCtasFor(kind)) {
    const resolved = ctaHref(ctaKind, values[ctaKind]);
    if (resolved) buttons.push({ kind: ctaKind, ...resolved });
  }

  if (buttons.length === 0) return null;

  function handleChat() {
    if (!isLoggedIn) {
      // El destino sale del `kind` del aviso, no de una ruta fija: esta fila la
      // montan Eventos, Profesionales, Negocios y Marketplace además de
      // Propiedades, y mandar a todos a /propiedades/<id> devolvía un 404
      // JUSTO después de que la persona se tomara el trabajo de entrar.
      router.push(`/entrar?next=${encodeURIComponent(listingViewHref(kind, listingId))}`);
      return;
    }
    startTransition(async () => {
      void recordCtaClickAction({ listingId, kind: "chat" });
      const result = await requestContactAction(listingId);
      toast(
        result.ok
          ? {
              title: COPY.detail.contactSuccessTitle,
              description: COPY.detail.contactSuccessBody,
              variant: "success",
            }
          : {
              title: result.title,
              description: result.error,
              variant: result.tone === "info" ? "info" : "warning",
            },
      );
      if (result.ok) router.push("/mensajes");
    });
  }

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
          <Button
            variant="primary"
            className="col-span-2 min-h-11 sm:col-span-3"
            loading={isPending}
            aria-label={M.cta.accessible.chat(subject)}
            onClick={handleChat}
          >
            <ChatCircleDots size={18} aria-hidden="true" />
            {M.cta.label.chat}
          </Button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-foreground-muted">{M.cta.safetyNote}</p>
    </section>
  );
}

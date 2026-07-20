"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatCircleDots, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { requestContactAction } from "@/app/(app)/propiedades/actions";
import { COPY } from "./copy";

export interface ContactCtaProps {
  listingId: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  /** Nombre visible de la fuente externa (publisher_name). */
  externalName?: string | null;
}

/**
 * CTA sticky "Contactar (protegido)" (§4.d) — el único CTA primario de la
 * pantalla de detalle.
 *
 * - Sin sesión → /entrar con redirect de vuelta al aviso.
 * - Con sesión → RPC request_contact (conversación pending, contacto protegido).
 * - Aviso externo (seed) → BottomSheet honesto: la fuente + recordatorio anti-estafa.
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

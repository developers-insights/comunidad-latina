"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatCircleDots, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
// Contacto protegido §9.2: MISMO RPC request_contact que vivienda —
// reutilizamos la server action pública del módulo, no la duplicamos.
import { requestContactAction } from "@/app/(app)/propiedades/actions";

const COPY = {
  // Ver nota en listings/copy.ts: una sola mención, y concreta.
  cta: "Contactar",
  hint: "Tu teléfono no se comparte",
  successTitle: "¡Listo! Le avisamos",
  successBody: "Cuando acepte tu contacto, van a poder hablar por acá.",
  errorTitle: "No pudimos enviar tu solicitud",
  errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
  externalSheetTitle: "Este perfil vino de una fuente externa",
  externalSheetBody: (name: string) =>
    `Lo publicó ${name} fuera de la app, con su permiso. El contacto se hace por los datos que esa fuente publicó — no podemos protegerlo desde acá.`,
  externalReminder:
    "Recordá: acordá el precio por escrito y nunca pagues todo por adelantado.",
  externalClose: "Entendido",
} as const;

export interface DirectoryContactCtaProps {
  listingId: string;
  /** Ruta de vuelta tras el login (ej. /profesionales/abc). */
  returnPath: string;
  isLoggedIn: boolean;
  /** true si es un aviso de seed/API sin cuenta (created_by null). */
  isExternal: boolean;
  externalName?: string | null;
}

/**
 * CTA sticky de contacto protegido para detalles del directorio — mismo
 * comportamiento que vivienda (RPC request_contact), con redirect de login
 * correcto para estas rutas.
 */
export function DirectoryContactCta({
  listingId,
  returnPath,
  isLoggedIn,
  isExternal,
  externalName,
}: DirectoryContactCtaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleContact() {
    startTransition(async () => {
      const result = await requestContactAction(listingId);
      if (result.ok) {
        toast({ title: COPY.successTitle, description: COPY.successBody, variant: "success" });
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
          {!isLoggedIn ? (
            <Link
              href={`/entrar?next=${encodeURIComponent(returnPath)}`}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              <ChatCircleDots size={20} aria-hidden="true" />
              {COPY.cta}
            </Link>
          ) : isExternal ? (
            <Button variant="primary" size="lg" className="w-full" onClick={() => setSheetOpen(true)}>
              <ChatCircleDots size={20} aria-hidden="true" />
              {COPY.cta}
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
              {COPY.cta}
            </Button>
          )}
          <p className="mt-1.5 text-center text-xs text-foreground-muted">{COPY.hint}</p>
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

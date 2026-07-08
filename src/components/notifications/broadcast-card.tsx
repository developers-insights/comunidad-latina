"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, useToast } from "@/components/ui";
import { dismissBroadcastAction } from "@/app/(app)/notificaciones/actions";

const COPY = {
  eyebrow: "Mensaje de Comunidad Latina",
  cta: "Ver más",
  dismiss: "Entendido",
  errorTitle: "No pudimos guardar eso",
  errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
} as const;

export type BroadcastCardData = {
  id: string;
  title: string;
  body: string;
  ctaUrl: string | null;
};

/**
 * Anuncio global vigente (pull §12) como BezelCard destacada. Verlo/descartarlo
 * inserta el receipt del usuario y el anuncio no se vuelve a mostrar.
 */
export function BroadcastCard({ broadcast }: { broadcast: BroadcastCardData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const acknowledge = (after?: () => void) => {
    startTransition(async () => {
      const result = await dismissBroadcastAction(broadcast.id);
      if (!result.ok) {
        toast({ title: COPY.errorTitle, description: COPY.errorBody });
        return;
      }
      setHidden(true);
      after?.();
    });
  };

  const openCta = () => {
    const url = broadcast.ctaUrl;
    if (!url) return;
    acknowledge(() => {
      if (url.startsWith("/")) {
        router.push(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  };

  return (
    <BezelCard variant="featured" coreClassName="p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <Megaphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
            {COPY.eyebrow}
          </p>
          <h2 className="mt-1 font-display text-base font-semibold text-foreground">
            {broadcast.title}
          </h2>
          <p className="mt-1 whitespace-pre-line text-sm text-foreground-secondary">
            {broadcast.body}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {broadcast.ctaUrl && (
              <Button size="sm" variant="primary" loading={pending} onClick={openCta}>
                {COPY.cta}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={pending && !broadcast.ctaUrl}
              disabled={pending}
              onClick={() => acknowledge()}
            >
              {COPY.dismiss}
            </Button>
          </div>
        </div>
      </div>
    </BezelCard>
  );
}

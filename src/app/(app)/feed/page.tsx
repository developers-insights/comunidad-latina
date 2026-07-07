import Link from "next/link";
import { EmptyState, buttonVariants } from "@/components/ui";
import { t } from "@/lib/i18n";

// Placeholder — el agente SOCIAL (R2) reemplaza esta página con el feed real.
// Mientras tanto es el home post-login: estado vacío con acción concreta (§3.5).

export const metadata = { title: "Inicio" };

const COPY = {
  emptyTitle: "Todavía no hay movimiento en tu zona",
  emptyMessage:
    "Sé de los primeros: publicá un aviso o mirá lo que tu comunidad ya compartió.",
  emptyCta: "Publicar un aviso",
} as const;

export default function FeedPage() {
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight text-foreground">
        {t("nav", "feed")}
      </h1>
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.emptyTitle}
        message={COPY.emptyMessage}
        action={
          <Link
            href="/publicar"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.emptyCta}
          </Link>
        }
      />
    </>
  );
}

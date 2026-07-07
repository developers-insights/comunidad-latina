import Link from "next/link";
import { UsersThree } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { t } from "@/lib/i18n";

// Placeholder premium — el agente SOCIAL (R2) reemplaza esta página con el
// espacio real de la comunidad. Mientras tanto: estado vacío con guía y
// acción concreta (§3.5 — ningún destino de la navegación puede dar 404).

export const metadata = { title: "Comunidad" };

const COPY = {
  emptyTitle: "Tu comunidad se está preparando",
  emptyMessage:
    "Muy pronto vas a poder compartir novedades, hacer preguntas y encontrarte con tu gente acá. Mientras terminamos esta parte, mirá lo que ya está publicado.",
  emptyCta: "Ver propiedades",
} as const;

export default function ComunidadPage() {
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight text-foreground">
        {t("nav", "community")}
      </h1>
      <EmptyState
        icon={<UsersThree weight="light" />}
        title={COPY.emptyTitle}
        message={COPY.emptyMessage}
        action={
          <Link
            href="/propiedades"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.emptyCta}
          </Link>
        }
      />
    </>
  );
}

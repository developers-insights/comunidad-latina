import Link from "next/link";
import { Compass } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";

/**
 * 404 global en español cálido (§3.5): nunca la pantalla genérica de Next
 * en inglés — para nuestro público, "esto parece roto" lee como otra trampa.
 */

const COPY = {
  title: "Esta página no existe",
  message:
    "Puede que el link esté vencido o mal escrito. No pasa nada — volvé al inicio y seguí desde ahí.",
  cta: "Volver al inicio",
} as const;

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={<Compass weight="light" />}
        title={COPY.title}
        message={COPY.message}
        action={
          <Link
            href="/"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.cta}
          </Link>
        }
      />
    </div>
  );
}

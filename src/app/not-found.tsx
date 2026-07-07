import Link from "next/link";
import { Compass, Buildings, ShieldCheck, BookOpen } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";

/**
 * 404 global en español cálido (§3.5): nunca la pantalla genérica de Next
 * en inglés — para nuestro público, "esto parece roto" lee como otra trampa.
 * Además del CTA principal, links útiles a lo que la gente busca de verdad.
 */

const COPY = {
  title: "Esta página no existe — pero tu comunidad sí",
  message:
    "Puede que el link esté vencido o mal escrito. No pasa nada — volvé al inicio o seguí por acá:",
  cta: "Volver al inicio",
  links: [
    { href: "/propiedades", label: "Buscar vivienda", icon: Buildings },
    { href: "/escudo", label: "Escudo Anti-Estafa", icon: ShieldCheck },
    { href: "/guias", label: "Guías para recién llegados", icon: BookOpen },
  ],
} as const;

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md">
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
        <nav aria-label="Enlaces útiles" className="mt-6">
          <ul className="flex flex-wrap justify-center gap-2">
            {COPY.links.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Icon weight="regular" aria-hidden className="size-4" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

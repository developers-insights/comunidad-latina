import Link from "next/link";
import { Compass, Buildings, ShieldCheck, BookOpen } from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/components/theme";
import { EmptyState, buttonVariants } from "@/components/ui";

/**
 * 404 global en español cálido (§3.5): nunca la pantalla genérica de Next
 * en inglés — para nuestro público, "esto parece roto" lee como otra trampa.
 * Además del CTA principal, links útiles a lo que la gente busca de verdad.
 *
 * El toggle de tema va acá por lo mismo que en error.tsx: este `not-found` es el
 * de la raíz, así que renderiza dentro del root layout —el único que no monta
 * toggle— y reemplaza a los layouts de grupo con su header. Sin esto, entrar a
 * un link vencido apagaba el único control de tema de la pantalla.
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
    <div className="relative flex min-h-dvh items-center justify-center px-4">
      {/* Primero en el DOM porque es lo primero que se lee arriba a la derecha;
          `top` respeta el notch (el root layout usa viewportFit: cover). */}
      <ThemeToggle className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10" />
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

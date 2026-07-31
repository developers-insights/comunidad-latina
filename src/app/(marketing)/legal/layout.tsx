import type { ReactNode } from "react";
import Link from "next/link";
import { COPY } from "@/components/marketing/copy";

/**
 * Shell de prosa legal reutilizable para /legal/terminos, /legal/privacidad
 * y /legal/normas: ancho máximo de lectura + cross-links a los otros 2
 * documentos al pie, para que ninguno se sienta un callejón sin salida.
 * El título, la fecha y el contenido los pone cada page.tsx.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      {children}

      <nav
        aria-label="Otros documentos legales"
        className="mt-16 border-t border-border-subtle pt-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          También podés leer
        </p>
        {/* `mt-2` + el alto del propio target: sin `min-h-11` estos enlaces
            medían entre 18 y 42px según si el texto envolvía a dos líneas —
            "Privacidad" era el peor, 18px de alto, en el pie de un documento
            que se lee en el teléfono. */}
        <ul className="mt-2 flex flex-wrap gap-x-6">
          {COPY.footer.legal.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 transition-colors hover:decoration-brand-ink"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

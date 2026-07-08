import Link from "next/link";
import { Banner } from "@/components/ui";
import { getTenantMismatch } from "@/lib/tenant/guard";
import { tenantMismatchBanner } from "@/lib/tenant/match";

/**
 * Aviso de "estás mirando otra comunidad" — informa, no bloquea (§3.4).
 *
 * La lectura cross-tenant de contenido publicado es intencional (SEO), así que
 * acá NO se redirige ni se cierra sesión: solo se explica por qué las acciones
 * de escritura no van a andar, y se ofrece la vuelta en un click.
 *
 * El link usa `?t=<slug>`, que el middleware persiste a la cookie `cl-tenant`.
 * En producción los dominios son distintos (las cookies no cruzan) y esta
 * divergencia es inalcanzable: esto es una red de seguridad para dev y previews.
 */
export async function TenantMismatchBanner() {
  const mismatch = await getTenantMismatch();
  if (!mismatch) return null;

  const copy = tenantMismatchBanner(mismatch.current.name, mismatch.home?.name ?? null);

  return (
    <Banner variant="warning" className="border-b border-border">
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-0.5 text-foreground-secondary">{copy.body}</p>
      {mismatch.home && (
        <Link
          href={`/feed?t=${mismatch.home.slug}`}
          className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
        >
          {copy.action}
        </Link>
      )}
    </Banner>
  );
}

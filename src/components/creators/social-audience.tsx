import { Users } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * AUDIENCIA — número, sin enlace y sin clic (spec §6, explícito).
 *
 * La spec dice que desde acá NO se abre Instagram ni TikTok. Por eso este
 * componente renderiza `<p>` y `<span>`, nunca un `<a>` ni un `<button>`: no
 * es que el enlace esté "desactivado" —eso se puede reactivar por accidente en
 * un refactor— es que no existe ningún elemento interactivo en el árbol.
 *
 * El motivo del pedido es el mismo que el del bloqueo de contacto: el acuerdo
 * se cierra adentro. Un enlace a la red del creador es la salida más cómoda
 * hacia una negociación por DM, donde no hay contrato ni historial.
 *
 * -----------------------------------------------------------------------------
 * DATO EXTERNO: NO SE INVENTA
 *
 * Hoy no existe en la base ninguna columna donde un creador declare su
 * audiencia de Instagram/TikTok, ni una integración que la traiga. Mostrar un
 * número ahí sería fabricarlo. Se muestra "todavía no lo medimos" y el
 * componente ya acepta `externalFollowers` para el día que ese dato exista.
 * -----------------------------------------------------------------------------
 */
export function SocialAudience({
  communityFollowers,
  externalFollowers,
  locale = "es-US",
  className,
}: {
  /** Seguidores dentro de la comunidad (`follows`). Dato real. */
  communityFollowers: number;
  /** Audiencia en redes externas. `null` ⇒ todavía no se mide. */
  externalFollowers?: number | null;
  locale?: string;
  className?: string;
}) {
  const community = Math.max(0, Math.floor(communityFollowers || 0));
  const external =
    typeof externalFollowers === "number" && Number.isFinite(externalFollowers)
      ? Math.max(0, Math.floor(externalFollowers))
      : null;

  return (
    <section className={cn("rounded-lg border border-border-subtle p-4", className)}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Users size={16} aria-hidden="true" className="text-foreground-muted" />
        {COPY.audience.title}
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-foreground-muted">{COPY.audience.community}</dt>
          {/* `numeric` = tabular-nums del design system: los números no bailan
              al cambiar de valor ni al comparar dos creadores. */}
          <dd className="numeric mt-0.5 font-display text-2xl font-bold text-foreground">
            {community.toLocaleString(locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground-muted">{COPY.audience.external}</dt>
          <dd
            className={cn(
              "mt-0.5 font-display font-bold",
              external === null
                ? "text-sm text-foreground-muted"
                : "numeric text-2xl text-foreground",
            )}
          >
            {external === null
              ? COPY.audience.externalUnmeasured
              : external.toLocaleString(locale)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
        {COPY.audience.note}
      </p>
    </section>
  );
}

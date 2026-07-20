import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { COPY } from "./copy";

/**
 * Nota sutil para dueños de tienda en /marketplace (§ feedback cliente
 * 2026-07-19): lo orgánico llega a seguidores; para llegar a todos existe
 * "Impulsar" en cada producto (item del dueño, no un CTA genérico acá — la
 * promoción real vive en /impulsar/[id] de cada producto).
 */
export function MarketplaceOwnerBanner() {
  return (
    <BezelCard variant="featured" coreClassName="flex items-start gap-3 p-4">
      {/* cl-print-fill: text-on-media es clara por definición — sin forzar el
          relleno a imprimirse (print-color-adjust: exact) el ícono queda
          blanco sobre papel blanco. Mismo hook que IdentityBadge. */}
      <span
        aria-hidden="true"
        className="cl-print-fill flex size-10 shrink-0 items-center justify-center rounded-full text-on-media"
        style={{ backgroundColor: "var(--accent-marketplace)" }}
      >
        <Megaphone size={20} weight="fill" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-foreground">
          {COPY.list.ownerBanner.title}
        </p>
        <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.list.ownerBanner.body}</p>
      </div>
    </BezelCard>
  );
}

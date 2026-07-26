import Link from "next/link";
import { SealCheck, Storefront, User } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/** Acento verde del módulo — decorativo (borde + tinte + ícono), nunca como color de texto. */
const ACCENT = "var(--accent-marketplace)";

const C = COPY.seller;

export interface SellerView {
  /** 'store' = attrs.store_listing_id apunta a un negocio; 'private' = lo vende una persona. */
  kind: "store" | "private";
  /** Título de la tienda o display_name de quien publicó. null → texto de reserva. */
  name: string | null;
  /** listing kind='business' dueño — sólo cuando kind === 'store' (linkea a su vidriera). */
  storeId?: string | null;
  /** business_accounts.verified_presence de esa tienda (plan "Presencia Verificada"). */
  verified?: boolean;
}

const PILL = cn(
  "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
  "text-xs font-medium",
);

/**
 * Quién vende, dicho de frente (call con el cliente 2026-07-24: "hay que
 * distinguir tiendas de particulares"). Una TIENDA lleva el acento del módulo y
 * es tappable —va a su vidriera—; un PARTICULAR es neutro y no linkea a ningún
 * lado. Cuando la tienda tiene el plan Presencia Verificada, al lado va el
 * badge "Verificada" (ícono + texto, nunca sólo color — §3.2).
 *
 * Server-safe: sólo <Link> y spans, sin estado ni handlers.
 */
export function SellerChip({
  seller,
  className,
}: {
  seller: SellerView;
  className?: string;
}) {
  const isStore = seller.kind === "store";
  const name = seller.name ?? (isStore ? C.fallbackStoreName : C.fallbackPrivateName);
  const label = `${isStore ? C.storeLabel : C.privateLabel} · ${name}`;

  const inner = (
    <>
      {isStore ? (
        <Storefront
          size={13}
          weight="fill"
          aria-hidden="true"
          className="shrink-0"
          style={{ color: ACCENT }}
        />
      ) : (
        <User size={13} aria-hidden="true" className="shrink-0" />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {isStore && seller.storeId ? (
        <Link
          href={`/marketplace/tienda/${seller.storeId}`}
          aria-label={C.storeAriaLabel(name)}
          style={{
            borderColor: `color-mix(in oklab, ${ACCENT} 45%, transparent)`,
            backgroundColor: `color-mix(in oklab, ${ACCENT} 12%, transparent)`,
          }}
          className={cn(
            PILL,
            "text-foreground",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {inner}
        </Link>
      ) : (
        <span
          aria-label={isStore ? C.storeAriaLabel(name) : C.privateAriaLabel(name)}
          className={cn(
            PILL,
            isStore
              ? "border-border-subtle bg-surface-subtle text-foreground"
              : "border-border-subtle bg-surface-subtle text-foreground-secondary",
          )}
        >
          {inner}
        </span>
      )}

      {/* "Verificada" es de TIENDAS (business_accounts): un particular nunca lo
          muestra, aunque le llegue el flag por error — el badge perdería sentido. */}
      {isStore && seller.verified && <SellerVerifiedBadge />}
    </div>
  );
}

/**
 * "Verificada" — el plan Presencia Verificada, visible por primera vez.
 * `label` largo ("Tienda verificada") para la cabecera de la vidriera, corto
 * para la card, donde compite por ancho con el nombre.
 */
export function SellerVerifiedBadge({
  label = C.verifiedLabel,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="success" aria-label={C.verifiedAriaLabel} className={cn("shrink-0", className)}>
      <SealCheck size={13} weight="fill" aria-hidden="true" />
      {label}
    </Badge>
  );
}

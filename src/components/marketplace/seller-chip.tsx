import Link from "next/link";
import { SealCheck, ShieldCheck, Storefront, User } from "@phosphor-icons/react/dist/ssr";
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
  /**
   * `business_accounts.verified_presence` de la tienda — el plan PAGO
   * "Presencia Verificada". Sólo tiene sentido con `kind === "store"`.
   *
   * ⚠️ ESTO NO ES IDENTIDAD. Ver `identityVerified` más abajo — son dos hechos
   * distintos y la UI los pinta con nombre, color e ícono distintos a
   * propósito (fix 2026-08-24, ver el comentario grande en ./copy.ts).
   */
  verified?: boolean;
  /**
   * `profiles.identity_verified` de QUIEN VENDE — el dueño/administrador de la
   * tienda si `kind === "store"`, la propia persona si `kind === "private"`.
   * GRATIS (Stripe Identity), y a diferencia de `verified` puede ser `true`
   * para un particular: la identidad no la vende un plan, se confirma con
   * documento y le corresponde a cualquiera que la haga.
   */
  identityVerified?: boolean;
}

const PILL = cn(
  "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
  "text-xs font-medium",
);

/**
 * Quién vende, dicho de frente (call con el cliente 2026-07-24: "hay que
 * distinguir tiendas de particulares"). Una TIENDA lleva el acento del módulo y
 * es tappable —va a su vidriera—; un PARTICULAR es neutro y no linkea a ningún
 * lado.
 *
 * Después del chip pueden ir HASTA DOS insignias, cada una con su propio
 * hecho: `SellerIdentityBadge` (identidad con documento, gratis, cualquier
 * vendedor) y `PresenciaVerificadaBadge` (plan pago, solo tiendas). Nunca se
 * fusionan en una sola ni comparten color — ver el porqué en ./copy.ts.
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

      {/* Identidad: CUALQUIER vendedor —tienda o particular— que confirmó su
          documento. Es la insignia que antes no existía para un particular
          (el bug reportado): ahora la ve quien se la ganó, tenga tienda o no. */}
      {seller.identityVerified && <SellerIdentityBadge />}

      {/* Presencia Verificada: el plan PAGO. Sólo tiendas — un particular
          nunca lo muestra, aunque le llegue el flag por error (no podría: el
          plan es de negocios, pero la guarda queda igual por las dudas). */}
      {isStore && seller.verified && <PresenciaVerificadaBadge />}
    </div>
  );
}

/**
 * IDENTIDAD VERIFICADA — escudo verde, gratis, de cualquier vendedor.
 *
 * Mismo hecho y misma gramática visual que `IdentityBadge`
 * (src/components/auth/identity-badge.tsx): éxito/verde + ícono de escudo.
 * Acá en forma de píldora (icono + texto) porque conviven en una fila con el
 * chip de vendedor, no en la esquina de un avatar.
 */
export function SellerIdentityBadge({
  label = C.identityLabel,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="success" aria-label={C.identityAriaLabel} className={cn("shrink-0", className)}>
      <ShieldCheck size={13} weight="fill" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/**
 * PRESENCIA VERIFICADA — sello azul, plan pago, solo tiendas.
 *
 * A propósito NO usa verde ni ícono de escudo: ese lenguaje visual quedó
 * reservado para `SellerIdentityBadge`, arriba. Azul + sello es la misma
 * gramática que el Check Azul del perfil (`CheckAzul`,
 * src/components/verificacion/check-azul.tsx) para la misma idea — "esto se
 * compra, no se comprueba".
 *
 * `label` largo para la cabecera de la vidriera, corto para la card, donde
 * compite por ancho con el nombre — hoy los dos usan el mismo texto porque
 * "Presencia verificada" ya es corto, pero el parámetro queda para no atar el
 * componente a un solo largo.
 */
export function PresenciaVerificadaBadge({
  label = C.presenceVerifiedLabel,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="info"
      aria-label={C.presenceVerifiedAriaLabel}
      className={cn("shrink-0", className)}
    >
      <SealCheck size={13} weight="fill" aria-hidden="true" />
      {label}
    </Badge>
  );
}

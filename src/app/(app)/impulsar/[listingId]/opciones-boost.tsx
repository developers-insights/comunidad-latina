"use client";

import { useState } from "react";
import { Buildings, GlobeHemisphereWest, MapPin, Star } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  BezelCard,
  BottomSheet,
  Button,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import { BOOST_SCOPE_COPY, BOOST_SCOPE_IDS, type BoostScope } from "@/lib/boosts";
import { combineBoostPrice, type BoostScopeSurcharges } from "@/lib/boosts/price";
import { formatCents, type ResolvedPrice } from "@/lib/pricing";
import type { BoostId, BoostPackage } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { crearBoostCheckout } from "./actions";

/** Copy local del módulo BOOST — no toca src/lib/i18n (compartido). */
const COPY = {
  pagoUnico: "pago único",
  recomendado: "El más elegido",
  elegir: (nombre: string) => `Impulsar por ${nombre}`,
  ariaProximamente: "Impulsos disponibles muy pronto",
  proximamenteFeature: "los impulsos",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",

  // Alcance geográfico (0092)
  alcanceTitulo: "¿Hasta dónde querés llegar?",
  alcanceAyuda:
    "Cuanto más lejos llega tu aviso, más cuesta. El precio de abajo ya incluye el alcance que elijas.",
  sinRecargo: "Sin recargo",
  recargo: (monto: string) => `+${monto}`,
  // "Tu zona" necesita que el aviso TENGA zona. Si no la tiene, la opción no se
  // ofrece rota: se explica qué falta, con la misma palabra que usa el editor
  // del aviso ("zona").
  sinZonaTitulo: "Tu aviso todavía no tiene zona",
  sinZonaAyuda:
    "Agregá la zona al editar el aviso y vas a poder impulsarlo solo para tu barrio, que es la opción más económica.",
  incluyeAlcance: (alcance: string) => `incluye ${alcance.toLowerCase()}`,
} as const;

const SCOPE_ICON: Record<BoostScope, React.ReactNode> = {
  local: <MapPin size={20} weight="fill" aria-hidden="true" />,
  nacional: <Buildings size={20} weight="fill" aria-hidden="true" />,
  global: <GlobeHemisphereWest size={20} weight="fill" aria-hidden="true" />,
};

export function OpcionesBoost({
  listingId,
  paquetes,
  precios,
  recargosAlcance,
  zonaDelAviso,
  paisDeLaComunidad,
  stripeConfigured,
}: {
  listingId: string;
  paquetes: BoostPackage[];
  /**
   * Precio vigente de cada paquete en esta comunidad. Sale de la misma lectura
   * (`getTenantPrices`) que después usa `crearBoostCheckout` para cobrar: si la
   * tarjeta y el Checkout leyeran por separado, un cambio de precio a mitad de
   * camino dejaría a alguien pagando un número que nunca vio.
   */
  precios: Partial<Record<BoostId, ResolvedPrice>>;
  /**
   * Recargo de cada alcance, de la MISMA lectura. El total se arma con
   * `combineBoostPrice`, la función que también usa la server action: el
   * número que se ve acá es, por construcción, el número que se cobra.
   */
  recargosAlcance: BoostScopeSurcharges;
  /** `listings.area_label`: sin zona no hay alcance local que ofrecer. */
  zonaDelAviso: string | null;
  /** `tenants.country_focus`, sólo para nombrar el alcance nacional. */
  paisDeLaComunidad: string | null;
  stripeConfigured: boolean;
}) {
  const { toast } = useToast();
  const [loadingPaquete, setLoadingPaquete] = useState<BoostId | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

  const hayZona = Boolean(zonaDelAviso?.trim());
  /**
   * El alcance inicial es el más chico QUE SE PUEDA comprar. Preseleccionar el
   * más caro sería empujar a gastar de más a quien toca el botón sin leer; y el
   * más barato preseleccionado es también el más honesto, porque es el que
   * describe lo que la mayoría quiere: su propio barrio.
   */
  const [alcance, setAlcance] = useState<BoostScope>(hayZona ? "local" : "nacional");

  async function elegir(paquete: BoostId) {
    if (loadingPaquete) return;
    if (!stripeConfigured) {
      // HOY: Stripe no está → feedback premium inmediato; el intento se
      // registra en server (console.info) en paralelo, ahora con el alcance
      // elegido, que es la señal que sirve para fijar el precio real.
      void crearBoostCheckout({ listingId, paquete, alcance });
      setProximamenteOpen(true);
      return;
    }
    setLoadingPaquete(paquete);
    try {
      const result = await crearBoostCheckout({ listingId, paquete, alcance });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega
      }
      if (result.status === "sin_sesion") {
        window.location.assign(`/entrar?next=/impulsar/${listingId}`);
        return;
      }
      if (result.status === "no_configurado") {
        setProximamenteOpen(true);
      } else {
        toast({ title: result.message, variant: "danger" });
      }
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setLoadingPaquete(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------------------
          1 · ALCANCE. Va ARRIBA de las duraciones a propósito: es la decisión
          que cambia los tres precios de abajo, así que elegirla después
          obligaría a volver a leer toda la pantalla.
         ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">
            {COPY.alcanceTitulo}
          </h2>
          <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.alcanceAyuda}</p>
        </div>

        <div
          role="radiogroup"
          aria-label={COPY.alcanceTitulo}
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
        >
          {BOOST_SCOPE_IDS.map((id) => {
            const recargo = recargosAlcance[id] ?? null;
            const disabled = id === "local" && !hayZona;
            return (
              <OpcionAlcance
                key={id}
                active={alcance === id}
                disabled={disabled}
                icon={SCOPE_ICON[id]}
                title={
                  id === "nacional" && paisDeLaComunidad
                    ? `${BOOST_SCOPE_COPY[id].label} · ${paisDeLaComunidad}`
                    : BOOST_SCOPE_COPY[id].label
                }
                hint={
                  disabled
                    ? COPY.sinZonaAyuda
                    : id === "local" && zonaDelAviso
                      ? `Solo para quien está en ${zonaDelAviso}.`
                      : BOOST_SCOPE_COPY[id].hint
                }
                extra={
                  recargo === null || recargo.amountCents === 0
                    ? COPY.sinRecargo
                    : COPY.recargo(formatCents(recargo.amountCents, recargo.currency))
                }
                onClick={() => setAlcance(id)}
              />
            );
          })}
        </div>

        {!hayZona && (
          <p className="rounded-lg bg-surface-subtle px-3.5 py-2.5 text-xs leading-relaxed text-foreground-secondary">
            <span className="font-semibold text-foreground">{COPY.sinZonaTitulo}.</span>{" "}
            {COPY.sinZonaAyuda}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------
          2 · DURACIÓN, ya con el total del alcance elegido.
         ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-4">
        {paquetes.map((paquete) => {
          const precio = precios[paquete.id] ?? null;
          const total = precio
            ? combineBoostPrice(
                { amountCents: precio.amountCents, currency: precio.currency },
                recargosAlcance[alcance] ?? null,
              )
            : null;
          return (
            <BezelCard
              key={paquete.id}
              variant={paquete.recomendado ? "featured" : "default"}
              coreClassName="flex flex-col gap-4 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-bold text-foreground">
                    {paquete.nombre}
                  </h3>
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    {paquete.descripcion}
                  </p>
                </div>
                {paquete.recomendado && (
                  <Badge variant="brand" className="shrink-0">
                    <Star size={12} weight="fill" aria-hidden="true" />
                    {COPY.recomendado}
                  </Badge>
                )}
              </div>

              {total && (
                <div>
                  <p className="flex items-baseline gap-1.5">
                    {/* El número TRANSICIONA de tamaño no: transiciona el
                        contenido. `numeric` (tabular-nums) mantiene el ancho
                        estable al cambiar de alcance, así que la tarjeta no
                        salta cuando el total pasa de 25 a 65. */}
                    <span className="numeric font-display text-3xl font-bold text-foreground">
                      {formatCents(total.amountCents, total.currency)}
                    </span>
                    {/* "pago único" va pegado al número y nunca se pierde: es lo que
                        distingue un total de una tarifa por período. */}
                    <span className="text-sm text-foreground-secondary">{COPY.pagoUnico}</span>
                  </p>
                  {/* El desglose es la promesa de que el precio no es magia: se
                      dice qué alcance está incluido en ese número. */}
                  <p className="mt-0.5 text-xs text-foreground-muted">
                    {COPY.incluyeAlcance(BOOST_SCOPE_COPY[alcance].label)}
                    {total.surchargeCents > 0
                      ? ` (${COPY.recargo(formatCents(total.surchargeCents, total.currency))})`
                      : ""}
                  </p>
                </div>
              )}

              <Button
                variant={paquete.recomendado ? "primary" : "outline"}
                size="lg"
                className="w-full"
                loading={loadingPaquete === paquete.id}
                onClick={() => elegir(paquete.id)}
              >
                {COPY.elegir(paquete.nombre)}
              </Button>
            </BezelCard>
          );
        })}
      </section>

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </div>
  );
}

/**
 * Una opción de alcance.
 *
 * `role="radio"` sobre un `<button>` y no un `<input type=radio>` porque el
 * control tiene tres renglones (título, a quién llega, recargo) y un input
 * nativo no los envuelve. Se paga con `aria-checked` explícito, que es
 * exactamente lo que el lector de pantalla necesita para anunciar el estado —
 * el mismo patrón que ya usa la elección de audiencia de las campañas de post,
 * así que las dos pantallas de "promocionar" se manejan igual.
 *
 * El precio del alcance NO es un placeholder ni un tooltip: es texto visible
 * dentro de la opción, porque es la mitad de la decisión.
 */
function OpcionAlcance({
  active,
  disabled,
  icon,
  title,
  hint,
  extra,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  extra: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-11 flex-col gap-1.5 rounded-lg border p-3.5 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-brand bg-brand-tint"
          : "border-border-subtle bg-surface hover:bg-surface-subtle",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("shrink-0", active ? "text-brand" : "text-foreground-secondary")}>
          {icon}
        </span>
        <span
          className={cn(
            "min-w-0 text-sm font-semibold",
            active ? "text-brand-ink" : "text-foreground",
          )}
        >
          {title}
        </span>
      </span>
      <span className="text-xs leading-snug text-foreground-secondary">{hint}</span>
      <span
        className={cn(
          "numeric mt-0.5 text-xs font-semibold",
          active ? "text-brand-ink" : "text-foreground-muted",
        )}
      >
        {extra}
      </span>
    </button>
  );
}

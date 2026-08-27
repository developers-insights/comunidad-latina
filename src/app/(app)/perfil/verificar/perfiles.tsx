"use client";

import { useState, useTransition } from "react";
import {
  IdentificationCard,
  SealCheck,
  ShieldWarning,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import {
  Avatar,
  BottomSheet,
  Button,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import type { EstadoDeIdentidad } from "@/lib/verificacion/identidades";
import { cn } from "@/lib/utils";
import { verificarPerfilDeNegocio } from "./actions";

/**
 * =============================================================================
 * TUS PERFILES — la verificación, uno por uno (migración 0121)
 * =============================================================================
 *
 * Pedido del cliente: «según cada perfil, debería de hacerse la verificación de
 * stripe si quieren abrir negocios/empleos/creador» · «Para vender dentro de la
 * plataforma, tenés que estar verificado sí o sí».
 *
 * ── POR QUÉ ES UNA LISTA Y NO UN BOTÓN POR PANTALLA ─────────────────────────
 * Porque el orden importa y sólo se ve junto: la persona se verifica con Stripe
 * y recién después puede responder por sus negocios. Con un botón suelto en la
 * pantalla de cada negocio, quien todavía no verificó su documento se topa diez
 * veces con el mismo "primero verificá tu identidad" sin entender que es UNA
 * sola cosa la que falta. Acá se ve de una: tu fila arriba, tus negocios abajo,
 * y mientras la de arriba esté pendiente las de abajo dicen por qué.
 *
 * ── NADA DE ESTO SE DECIDE ACÁ ──────────────────────────────────────────────
 * `puedeReclamar` sólo evita dibujar un botón que va a rebotar. Quien autoriza
 * es `public.verificar_identidad_de_negocio()` (0121), que vuelve a exigir rol
 * propietario/administrador y documento validado. Un botón de más es un toque
 * perdido; un botón de menos es una función que la persona no encuentra.
 *
 * ── SIN STRIPE (HOY) ────────────────────────────────────────────────────────
 * Sin claves nadie tiene el documento validado, así que ningún negocio se puede
 * reclamar. En vez de un botón que sólo devuelve error, la lista muestra el
 * estado premium de §5.6 — el mismo `<ProximamentePremium>` que ya usa el CTA
 * de esta pantalla. La función no se rompe: todavía no está abierta, y se dice.
 */

const COPY = {
  heading: "Tus perfiles",
  hint: "Cada perfil se verifica por separado. Es lo que te habilita a vender, publicar empleos y abrir tu negocio.",
  personalLabel: "Tu perfil personal",
  verificada: "Verificado",
  pendiente: "Sin verificar",
  /** Sólo aparece cuando la persona YA está verificada: si no, sobra. */
  cta: "Verificar este perfil",
  verificando: "Verificando…",
  /** Lo que falta primero, dicho una vez y arriba de todo. */
  primeroVos:
    "Verificá tu identidad para poder responder por tus negocios. Después los activás de a uno, sin sacar otra foto.",
  ok: (nombre: string) => `Listo, ${nombre} ya está verificado.`,
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  ariaProximamente: "Verificación disponible muy pronto",
  proximamenteFeature: "la verificación de identidad",
} as const;

export function PerfilesVerificacion({
  identidades,
  stripeConfigured,
}: {
  identidades: EstadoDeIdentidad[];
  stripeConfigured: boolean;
}) {
  const { toast } = useToast();
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);
  const [, startTransition] = useTransition();

  const persona = identidades.find((identidad) => identidad.tipo === "persona");
  const negocios = identidades.filter((identidad) => identidad.tipo === "negocio");
  const personaVerificada = persona?.verificada === true;

  function reclamar(identidad: EstadoDeIdentidad) {
    if (pendiente !== null) return;
    // Sin Stripe no hay documento validado posible: se dice, no se intenta.
    if (!stripeConfigured) {
      setProximamenteOpen(true);
      return;
    }
    setPendiente(identidad.id);
    startTransition(async () => {
      const resultado = await verificarPerfilDeNegocio({ businessId: identidad.id });
      setPendiente(null);
      if (!resultado.ok) {
        toast({ title: resultado.mensaje, variant: "danger" });
        return;
      }
      toast({ title: COPY.ok(identidad.nombre), variant: "success" });
    });
  }

  return (
    <section aria-label={COPY.heading} className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.heading}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.hint}</p>
      </div>

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
        {persona && (
          <li className="flex items-center gap-3 p-3">
            <Avatar size="md" name={persona.nombre} src={persona.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {persona.nombre}
              </p>
              <p className="text-xs text-foreground-secondary">{COPY.personalLabel}</p>
            </div>
            <EstadoChip verificada={persona.verificada} />
          </li>
        )}

        {negocios.map((negocio) => (
          <li key={negocio.id} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-3">
              <Avatar size="md" name={negocio.nombre} src={negocio.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {negocio.nombre}
                </p>
                <p className="flex items-center gap-1 text-xs text-foreground-secondary">
                  <Storefront size={12} aria-hidden="true" />
                  Negocio
                </p>
              </div>
              <EstadoChip verificada={negocio.verificada} />
            </div>

            {/* El botón aparece SÓLO cuando puede terminar bien: con la persona
                ya verificada y con rol para responder por el negocio. Mientras
                falte lo primero, lo que se muestra es el aviso de arriba —una
                vez, no diez. */}
            {!negocio.verificada && negocio.puedeReclamar && personaVerificada && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                loading={pendiente === negocio.id}
                onClick={() => reclamar(negocio)}
              >
                <SealCheck size={16} aria-hidden="true" />
                {pendiente === negocio.id ? COPY.verificando : COPY.cta}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {!personaVerificada && negocios.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-subtle p-3 text-xs leading-relaxed text-foreground-secondary">
          <IdentificationCard
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-brand"
          />
          <span>{COPY.primeroVos}</span>
        </p>
      )}

      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </section>
  );
}

/**
 * Verificado / Sin verificar. Ícono + palabra, nunca sólo el color: es la regla
 * de la casa y acá pesa más que en otros lados, porque lo que se está diciendo
 * es si alguien puede o no puede vender.
 */
function EstadoChip({ verificada }: { verificada: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs font-semibold",
        verificada ? "text-success" : "text-foreground-muted",
      )}
    >
      {verificada ? (
        <SealCheck size={14} weight="fill" aria-hidden="true" />
      ) : (
        <ShieldWarning size={14} aria-hidden="true" />
      )}
      {verificada ? COPY.verificada : COPY.pendiente}
    </span>
  );
}

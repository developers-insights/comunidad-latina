"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowSquareOut, Warning } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Bubble, Button, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { safeExternalHref } from "@/lib/url/safe-href";
import { dismissBroadcastAction } from "@/app/(app)/notificaciones/actions";

/**
 * ALERTA COMUNITARIA — la voz de la plataforma arriba del feed.
 *
 * Es la cara `severity = 'urgent'` del mismo broadcast que en /notificaciones
 * se ve como <BroadcastCard>. Dos superficies, un solo dato y un solo acuse.
 *
 * TONO (decisión de diseño, no capricho): lo que se anuncia acá es una persona
 * desaparecida o un centro de acopio después de un terremoto. Nada de rojo a
 * sangre, ni sirenas, ni animación: eso convierte una tragedia en decoración y
 * enseña a la gente a ignorar el recuadro. La pieza usa el registro ÁMBAR
 * (`warning`), que es el de las alertas públicas serias —el de un cartel de
 * ruta, no el de un error de sistema—, y toda la jerarquía la hacen el tamaño,
 * el espacio y el marco. Se distingue de una publicación de un vecino por el
 * doble marco tintado, que ninguna card del feed usa.
 */

export const URGENT_BROADCAST_COPY = {
  /** Etiqueta de autoría. El cliente la llamó "global"; para la gente eso no
   *  significa nada — lo que necesita saber es QUIÉN habla. */
  eyebrow: "Alerta de Comunidad Latina",
  regionLabel: "Alerta de la comunidad",
  cta: "Ver los detalles",
  /** Se suma al nombre accesible del CTA externo (WCAG 3.2.5). */
  ctaExternalHint: "Se abre en otra pestaña",
  dismiss: "Entendido",
  errorTitle: "No pudimos cerrar la alerta",
  errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
} as const;

export type UrgentBroadcastCardData = {
  id: string;
  title: string;
  body: string;
  ctaUrl: string | null;
};

export function UrgentBroadcastCard({ broadcast }: { broadcast: UrgentBroadcastCardData }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  /**
   * REDIRECCIÓN ABIERTA, confirmada en vivo (auditoría 2026-07-27): acá vivía un
   * `safeCtaHref` propio que decidía "es interna" por el PREFIJO del string.
   * Tapaba `//evil.com`, pero no `/\evil.com`: para los esquemas especiales el
   * parser de URL trata `\` como `/`, así que `/\evil.com` se ofrecía como ruta
   * interna y se iba del sitio — desde una tarjeta firmada como mensaje oficial
   * de la plataforma, contra un público de migrantes. El escalón exacto de un
   * login clonado.
   *
   * Clasificar por string es una carrera de parches. `safeExternalHref` resuelve
   * la URL y pregunta por el ORIGEN resultante, que es la única fuente de verdad;
   * de paso trae la allowlist de protocolo que `z.url()` no aplica
   * (`javascript:`, `data:`, `vbscript:`, `file:`). Es la MISMA función que usa
   * BroadcastCard: las dos caras del mismo broadcast validan igual, o la más
   * floja marca el piso.
   *
   * `null` ⇒ no se ofrece botón: el aviso se lee igual y nadie toca un destino
   * que no validamos.
   */
  const cta = safeExternalHref(broadcast.ctaUrl);

  if (hidden) return null;

  /**
   * Acuse = la fila de `broadcast_receipts` que ya existía (0010). No se
   * inventa un "descartado en el feed" aparte: si la cerraste acá, tampoco te
   * vuelve a aparecer en notificaciones, que es lo que uno espera.
   *
   * Se esconde en el cliente y NO se llama a router.refresh(): la alerta ya no
   * tiene nada que decir y refrescar volvería a traer el feed entero para
   * borrar un recuadro. El receipt queda escrito; en la próxima carga la query
   * ya no la devuelve.
   */
  const acknowledge = (after?: () => void) => {
    startTransition(async () => {
      const result = await dismissBroadcastAction(broadcast.id);
      if (!result.ok) {
        toast({
          title: URGENT_BROADCAST_COPY.errorTitle,
          description: URGENT_BROADCAST_COPY.errorBody,
        });
        return;
      }
      setHidden(true);
      after?.();
    });
  };

  /**
   * El anillo de foco NO se declara acá: ya viene en la base de
   * `buttonVariants` (`focus-visible:ring-[3px] ring-focus-ring`), que es donde
   * corresponde — el conflicto original era del propio botón, no de esta card.
   *
   * Historia, porque el bug es sutil y puede volver: el anillo global de
   * globals.css vive en
   * `:where(a, button, …):focus-visible { box-shadow: var(--shadow-focus-ring) }`,
   * y `shadow-xs` —que llevan los variants `primary` y `danger`— es una utility
   * que escribe `box-shadow`: le ganaba y dejaba esos dos SIN indicador de foco
   * en toda la app, <Link> con pinta de botón incluidos. La solución fue poner
   * `ring-*` en la base del cva: escribe en `--tw-ring-shadow`, que COMPONE con
   * `--tw-shadow` en vez de pisarlo. Repetir esas clases acá ya no arregla nada
   * y sólo esconde si el arreglo global se rompe.
   *
   * `min-w-0` sí es de esta card: el CTA convive con "Entendido" en un
   * `flex-wrap` y sin esto no puede achicarse por debajo de su contenido.
   */
  const ctaClass = cn(buttonVariants({ variant: "primary", size: "md" }), "min-w-0");

  return (
    <section
      aria-label={URGENT_BROADCAST_COPY.regionLabel}
      // El feed se separa con gap-4; acá el margen es propio porque la alerta
      // vive fuera del contenedor keyeado por tab (no se remonta al cambiarlo).
      className="mb-4"
    >
      <BezelCard variant="warning" coreClassName="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-ink"
          >
            <Warning size={20} weight="fill" />
          </span>

          <div className="min-w-0 flex-1">
            {/* La cápsula (primitiva Bubble) es la firma: dice quién habla.
                Sin ella, un aviso de la plataforma se lee como el post de un
                vecino con un marco raro. */}
            <Bubble
              tone="accentSoft"
              accent="var(--color-warning)"
              shape="pill"
              size="sm"
              className="inline-flex max-w-full items-center py-1"
            >
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-warning-ink">
                {URGENT_BROADCAST_COPY.eyebrow}
              </span>
            </Bubble>

            <h2 className="mt-2 font-display text-base font-bold leading-snug text-foreground">
              {broadcast.title}
            </h2>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
              {broadcast.body}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {cta &&
                (cta.external ? (
                  // <a> real y no window.open(): así el `rel` correcto está en
                  // el marcado (y no depende de que se ejecute un handler), el
                  // usuario ve a dónde va al mantener apretado, y el acuse
                  // viaja en paralelo sin bloquear la navegación.
                  <a
                    href={cta.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => acknowledge()}
                    className={ctaClass}
                  >
                    {URGENT_BROADCAST_COPY.cta}
                    <ArrowSquareOut size={16} aria-hidden="true" />
                    {/* El espacio explícito NO es cosmético: sin él el nombre
                        accesible sale "Ver los detallesSe abre en otra
                        pestaña", una sola palabra pegada para el lector. */}{" "}
                    <span className="sr-only">
                      {URGENT_BROADCAST_COPY.ctaExternalHint}
                    </span>
                  </a>
                ) : (
                  <Link
                    href={cta.href}
                    onClick={() => acknowledge()}
                    className={ctaClass}
                    prefetch={false}
                  >
                    {URGENT_BROADCAST_COPY.cta}
                  </Link>
                ))}

              <Button
                size="md"
                variant="ghost"
                loading={pending}
                onClick={() => acknowledge()}
              >
                {URGENT_BROADCAST_COPY.dismiss}
              </Button>
            </div>
          </div>
        </div>
      </BezelCard>
    </section>
  );
}

import Link from "next/link";
import {
  CalendarDots,
  CaretRight,
  MapPin,
  Megaphone,
  Toolbox,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, Chip } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { workModeLabel } from "@/lib/creators/work-mode";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const C = COPY.service;

/**
 * TARJETA DE SERVICIO — deliberadamente NO es la de empleo con otro color.
 *
 * Las dos conviven en la misma grilla de /empleos, así que la diferencia tiene
 * que leerse antes que el texto. `JobCard` es un AFICHE: foto 4:5 (o el
 * gradiente que la reemplaza), el pago enorme sobre la franja de vidrio, el
 * puesto abajo. Funciona porque en un aviso de trabajo el monto es lo que frena
 * el scroll.
 *
 * Un servicio no se lee así. Lo que decide si le escribís a un jardinero no es
 * el número —casi siempre es "a convenir"— sino QUIÉN es y CUÁNDO puede. Por eso
 * esta tarjeta es horizontal y arranca por la persona: avatar con su Trust Score
 * al lado, después qué hace, después cuándo. El precio baja a una línea, con su
 * "Desde" adelante para que se lea como la referencia que es.
 *
 * Consecuencias buscadas de esa forma:
 *  · Es MÁS BAJA que la de empleo. En la pestaña "Todos" el ojo separa los dos
 *    tipos sin leer una palabra, que es exactamente lo que pidió el cliente al
 *    partir la sección en tres.
 *  · No tiene bloque de foto. El wizard del servicio no pide fotos a propósito
 *    (tres pasos, un minuto desde el teléfono), así que una caja de imagen vacía
 *    sería un hueco permanente, no un caso raro.
 *
 * Mismos tokens y mismos primitivos que el resto del módulo (`BezelCard`,
 * `Chip`, `Avatar`, el acento `--accent-empleos`): distinta composición, misma
 * familia. No hay color nuevo ni tipografía nueva.
 *
 * EL CTA ES "ESCRIBIRLE" Y RESUELVE ACÁ MISMO. Un servicio no tiene embudo de
 * postulación —no hay preguntas, ni currículum, ni bandeja de candidatos—: el
 * único camino es Mensajes, y `InlineMessageCta` ya es el que usan Marketplace y
 * Eventos para escribir sin salir de la publicación.
 */
export function ServiceCard({
  service,
  isLoggedIn,
}: {
  service: JobCardModel;
  /**
   * Lo resuelve la PÁGINA (server) y viaja como prop: `InlineMessageCta` pide un
   * booleano y no un "no sé". Sin sesión el composer abre la hoja de ingreso
   * encima del listado y vuelve solo — nadie pierde lo que escribió.
   */
  isLoggedIn: boolean;
}) {
  const modeLabel = workModeLabel(service.workMode);
  const publisherName =
    service.publisher?.type === "member"
      ? service.publisher.displayName
      : service.publisher?.type === "external"
        ? service.publisher.name
        : null;
  /**
   * Sin cuenta detrás (aviso sembrado o importado) no hay bandeja a la que
   * escribirle: `request_contact` rebotaría DESPUÉS de que la persona escriba.
   * Se muestra el aviso igual, sin el botón que no puede cumplir.
   */
  const canContact = service.publisher?.type === "member";

  const card = (
    <BezelCard coreClassName="p-4">
      <article aria-label={service.title} className="flex flex-col gap-3.5">
        <div className="flex items-start gap-3.5">
          {/* La persona primero. El halo del acento + el ícono de herramientas
              dicen "oficio" sin necesidad de una foto que casi nunca hay. */}
          <span className="relative shrink-0">
            <Avatar
              src={service.publisher?.type === "member" ? service.publisher.avatarUrl : null}
              name={publisherName ?? C.offeredByUnknown}
              size="lg"
            />
            <span
              aria-hidden="true"
              className={cn(
                "absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full",
                "border border-border bg-surface text-[var(--accent-empleos)] shadow-sm",
              )}
            >
              <Toolbox size={14} weight="fill" />
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip
                variant="neutral"
                size="sm"
                className="border-[var(--accent-empleos)]/30 bg-[var(--accent-empleos)]/10 text-foreground"
              >
                {C.badge}
              </Chip>
              {modeLabel && (
                <span className="text-xs font-semibold text-foreground-secondary">
                  {modeLabel}
                </span>
              )}
            </div>

            <h3 className="mt-1.5 font-display text-base font-bold leading-snug text-foreground line-clamp-2">
              {service.title}
            </h3>

            {publisherName && (
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
                <span className="truncate">{C.offeredBy(publisherName)}</span>
                {service.publisher?.type === "member" && (
                  <PublisherTrust
                    displayName={service.publisher.displayName}
                    firstName={firstNameOf(service.publisher.displayName)}
                    score={service.publisher.score}
                    level={service.publisher.level}
                    signals={service.publisher.signals}
                    profileId={service.publisher.profileId}
                    size="inline"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Qué hace, en las palabras del aviso. Dos renglones: alcanza para
            distinguir "corto el pasto" de "diseño de jardines", que es la
            pregunta que resuelve el scroll. */}
        {service.description && (
          <p className="text-sm leading-relaxed text-foreground-secondary line-clamp-2">
            {service.description}
          </p>
        )}

        {/* Cuándo y dónde, la información que decide si le escribís. Va en su
            propia franja tenue: no compite con el título ni con el precio. */}
        <dl className="flex flex-col gap-1.5 rounded-lg bg-surface-subtle px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <dt className="sr-only">{C.availabilityLabel}</dt>
            <CalendarDots
              size={16}
              aria-hidden="true"
              className="shrink-0 text-[var(--accent-empleos)]"
            />
            <dd
              className={cn(
                "min-w-0 truncate",
                service.availabilityLabel ? "text-foreground" : "text-foreground-muted",
              )}
            >
              {service.availabilityLabel ?? C.availabilityUnknown}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">{C.zoneLabel}</dt>
            <MapPin
              size={16}
              aria-hidden="true"
              className="shrink-0 text-[var(--accent-empleos)]"
            />
            <dd
              className={cn(
                "min-w-0 truncate",
                service.areaLabel ? "text-foreground" : "text-foreground-muted",
              )}
            >
              {service.areaLabel ?? C.zoneUnknown}
            </dd>
          </div>
        </dl>

        {/* El precio es una REFERENCIA y se dice como tal. "A convenir" no es un
            hueco: es la respuesta más honesta cuando hay que ver el trabajo
            primero, y por eso se escribe con todas las letras en vez de dejar
            la línea vacía. */}
        <p className="flex items-baseline gap-2">
          <span
            className={cn(
              "numeric font-display font-bold leading-none",
              service.fromPriceLabel ? "text-lg text-foreground" : "text-base text-foreground-secondary",
            )}
          >
            {service.fromPriceLabel ?? C.priceToAgree}
          </span>
        </p>

        <div className="flex flex-col gap-1">
          {canContact && (
            <InlineMessageCta
              listingId={service.id}
              isLoggedIn={isLoggedIn}
              label={C.contact}
              placeholder={C.contactPlaceholder}
            />
          )}

          <Link
            href={`/empleos/${service.id}`}
            aria-label={`${C.viewService}: ${service.title}`}
            className={cn(
              "flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-4",
              "text-sm font-semibold text-foreground-secondary",
              "transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-subtle hover:text-foreground active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            {C.viewService}
            <CaretRight size={15} aria-hidden="true" className="shrink-0 opacity-70" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );

  if (!service.boosted) return card;

  /**
   * Aviso IMPULSADO: mismos tokens (`--color-sponsored`) y mismo chip que
   * `JobCard` — la publicidad se divulga SIEMPRE y con una sola palabra en toda
   * la app (contrato 2026-07-30 §4). Acá el chip va arriba a la IZQUIERDA
   * porque esta tarjeta no tiene overlay de foto ocupando esa esquina.
   */
  return (
    <div className="relative rounded-xl ring-2 ring-sponsored/70 shadow-[0_0_0_1px_var(--color-sponsored),0_10px_28px_-14px_var(--color-sponsored)]">
      <Chip
        variant="neutral"
        size="sm"
        className="absolute right-3.5 top-3.5 z-10 border-[1.5px] border-sponsored bg-surface text-sponsored-ink shadow-sm"
      >
        <Megaphone size={14} weight="fill" aria-hidden="true" />
        {COPY.list.adChip}
      </Chip>
      {card}
    </div>
  );
}

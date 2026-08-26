import Link from "next/link";
import { House, MapPin, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, buttonVariants } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { Estrellas } from "@/components/resenas/estrellas";
import { RESENAS_COPY, formatearPromedio } from "@/lib/resenas";
import type { AnuncianteVista } from "@/lib/propiedades/anunciantes";
import { cn } from "@/lib/utils";

/**
 * Ficha del directorio «Agentes y propietarios» (spec §4): verificación,
 * ciudad, calificaciones y propiedades activas.
 *
 * ── LAS DOS INSIGNIAS NO SON LA MISMA, Y NO SE MEZCLAN ──────────────────────
 * `identity_verified` es la verificación de IDENTIDAD, gratis, y es la que la
 * spec pide mostrar acá: para quien busca dónde vivir, saber que del otro lado
 * hay una persona con documento comprobado es el dato. El Trust Score es la
 * reputación acumulada y vive en su propia hoja, detrás del chip — que además
 * es el único lugar de la app desde donde se abre un perfil ajeno (decisión de
 * UX ya tomada: el nombre nunca navega).
 *
 * ── SIN CUENTA NO HAY INSIGNIA NI PERFIL, Y ESO SE DICE ─────────────────────
 * Un aviso importado de un portal tiene nombre y nada más. La tarjeta lo
 * muestra igual —es un anunciante real— pero sin sello, sin puntaje y sin
 * enlace: un tilde gris o un "0" ahí serían dos formas distintas de mentir.
 */

const COPY = {
  externo: "Anuncia en la comunidad",
  identidad: "Identidad verificada",
  activosUno: "1 propiedad publicada",
  activosVarias: (n: number) => `${n} propiedades publicadas`,
  ver: "Ver propiedades",
} as const;

export interface AnuncianteCardProps {
  anunciante: AnuncianteVista;
  className?: string;
}

export function AnuncianteCard({ anunciante, className }: AnuncianteCardProps) {
  const promedio = formatearPromedio(anunciante.puntaje.promedio);

  return (
    <BezelCard
      className={className}
      coreClassName="flex flex-col gap-3 p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Avatar
          src={anunciante.avatarUrl}
          name={anunciante.nombre}
          size="lg"
          badge={
            anunciante.identityVerified ? (
              <SealCheck
                size={14}
                weight="fill"
                aria-hidden="true"
                className="text-brand"
              />
            ) : undefined
          }
        />

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-foreground">
            {anunciante.nombre}
          </p>

          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-secondary">
            {anunciante.zona && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin size={13} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{anunciante.zona}</span>
              </span>
            )}
            {anunciante.identityVerified ? (
              <span className="inline-flex items-center gap-1 text-foreground-secondary">
                <SealCheck size={13} weight="fill" aria-hidden="true" className="text-brand" />
                {COPY.identidad}
              </span>
            ) : (
              !anunciante.trust && <span>{COPY.externo}</span>
            )}
          </div>

          {/* El Trust Score va debajo del nombre y no encima de él: es la
              reputación de quien publica, no su título. */}
          {anunciante.trust && anunciante.profileId && (
            <div className="mt-1.5">
              <PublisherTrust
                displayName={anunciante.nombre}
                firstName={firstNameOf(anunciante.nombre)}
                score={anunciante.trust.score}
                level={anunciante.trust.level}
                signals={anunciante.trust.signals}
                profileId={anunciante.profileId}
                size="inline"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <House size={15} weight="fill" aria-hidden="true" className="text-foreground-muted" />
          {anunciante.activos === 1
            ? COPY.activosUno
            : COPY.activosVarias(anunciante.activos)}
        </span>

        {/* Calificación: sólo cuando hay reseñas de verdad. `cantidad = 0` no se
            pinta como "0,0" ni como cinco estrellas vacías — un anunciante
            nuevo no vale menos que uno malo. */}
        {anunciante.puntaje.cantidad > 0 && promedio ? (
          <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
            <Estrellas
              valor={anunciante.puntaje.promedio ?? 0}
              size={14}
              etiqueta={RESENAS_COPY.promedioAria(promedio, anunciante.puntaje.cantidad)}
            />
            <span className="numeric text-xs">
              {promedio} ({anunciante.puntaje.cantidad})
            </span>
          </span>
        ) : null}
      </div>

      {/* El CTA lleva al LISTADO filtrado por esta persona y no a su perfil:
          quien entra a este directorio está buscando dónde vivir, no leyendo
          biografías. El perfil sigue a un toque, dentro de la hoja del Trust
          Score. */}
      <Link
        href={
          anunciante.profileId
            ? `/propiedades?de=${encodeURIComponent(anunciante.profileId)}`
            : `/propiedades?q=${encodeURIComponent(anunciante.nombre)}`
        }
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
      >
        {COPY.ver}
      </Link>
    </BezelCard>
  );
}

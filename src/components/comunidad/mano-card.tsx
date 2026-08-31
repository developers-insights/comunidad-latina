import Link from "next/link";
import {
  Buildings,
  Clock,
  HandHeart,
  HandsClapping,
  MapPin,
  Translate,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip } from "@/components/ui";
import { COMUNIDAD_COPY, HELP_DIRECTION_COPY, HELP_TOPIC_LABEL, type HelpNotice } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { EscribirBoton } from "./escribir-boton";

const C = COMUNIDAD_COPY.ayudaMutua.card;

/**
 * Un aviso del tablón de ayuda mutua.
 *
 * ── LO QUE ESTA TARJETA NO MUESTRA ──────────────────────────────────────────
 * Ningún dato de contacto (no existe en la base), ningún puntaje de confianza
 * y ninguna foto. Los dos últimos son decisión de esta pantalla y no de la
 * migración:
 *
 *  · SIN TRUST SCORE. La `CasoCard` de Perdido y encontrado sí lo muestra,
 *    porque ahí alguien dice tener TUS documentos y la estafa clásica tiene
 *    plata adentro. Acá no se transa nada: alguien ofrece un rato. Pintarle un
 *    puntaje al lado convertiría la ayuda en una competencia de reputación, y
 *    dejaría a quien recién llega —que es justamente quien más necesita que lo
 *    dejen entrar— abajo de todo.
 *  · SIN FOTO. Una cara identificable de una persona de esta población, al lado
 *    de su barrio y del tema en el que se mueve, es exactamente el cruce que
 *    §5.4 pide no construir.
 *
 * ── LA JERARQUÍA ────────────────────────────────────────────────────────────
 * Qué es (ofrece / pide) → qué propone → DÓNDE. La zona va arriba y con ícono
 * porque es el filtro real con el que alguien decide si esto le sirve: un
 * ofrecimiento a cuarenta minutos en subte no es un ofrecimiento.
 *
 * El botón de escribir es lo único con color: es lo único que se hace acá.
 */
export function ManoCard({ aviso }: { aviso: HelpNotice }) {
  const esPedido = aviso.direction === "need";
  const direccion = HELP_DIRECTION_COPY[aviso.direction];

  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Ícono + texto SIEMPRE: la dirección del aviso no puede depender del
            color, que es lo único que distingue un chip de otro. */}
        <Chip
          size="sm"
          variant={esPedido ? "brand" : "neutral"}
          icon={
            esPedido ? (
              <HandsClapping size={14} weight="fill" aria-hidden="true" />
            ) : (
              <HandHeart size={14} weight="fill" aria-hidden="true" />
            )
          }
        >
          {direccion.badge}
        </Chip>
        <span className="text-xs text-foreground-muted">{aviso.publishedAtLabel}</span>
      </div>

      <div className="space-y-1.5">
        <h3 className="font-display text-base font-semibold leading-snug text-foreground">
          {aviso.title}
        </h3>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={16} aria-hidden="true" className="shrink-0" />
            {aviso.areaLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>{HELP_TOPIC_LABEL[aviso.topic]}</span>
        </p>

        {(aviso.orgName || aviso.resource) && (
          <p className="flex items-start gap-1.5 text-sm text-foreground-secondary">
            <Buildings size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-brand-ink" />
            {aviso.resource ? (
              <Link
                href={`/comunidad/recursos?tema=${aviso.topic}`}
                className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                {C.enLugar(aviso.resource.name)}
                <span className="sr-only"> — {C.verFicha}</span>
              </Link>
            ) : (
              <span>{C.enLugar(aviso.orgName ?? "")}</span>
            )}
          </p>
        )}
      </div>

      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
        {aviso.body}
      </p>

      {(aviso.availability || aviso.languages.length > 0) && (
        <div className="space-y-1.5 border-t border-border-subtle pt-3">
          {aviso.availability && (
            <p className="flex items-start gap-2 text-sm leading-relaxed">
              <Clock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted" />
              <span className="min-w-0">
                <span className="font-medium text-foreground-secondary">
                  {esPedido ? C.disponibilidadNeed : C.disponibilidad}:{" "}
                </span>
                <span className="text-foreground-secondary">{aviso.availability}</span>
              </span>
            </p>
          )}
          {aviso.languages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Translate size={16} aria-hidden="true" className="text-foreground-muted" />
              <span className="text-sm font-medium text-foreground-secondary">{C.idiomas}:</span>
              {aviso.languages.map((idioma) => (
                <Chip key={idioma} size="sm">
                  {idioma}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      <footer
        className={cn(
          "flex flex-col gap-2 border-t border-border-subtle pt-3",
          "sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <p className="min-w-0 text-sm text-foreground-muted">
          <span className="font-medium text-foreground-secondary">{aviso.publisherName}</span>
        </p>

        {/* El dueño no se manda mensajes a sí mismo: en su lugar, la ayuda que
            necesita es saber dónde gestionarlo — mismo criterio que la pantalla
            de detalle de Perdido y encontrado. */}
        {aviso.isOwner ? (
          <Link
            href="/comunidad/ayuda-mutua/mios"
            className="text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COMUNIDAD_COPY.ayudaMutua.misAvisosCta}
          </Link>
        ) : (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <EscribirBoton avisoId={aviso.id} esPedido={esPedido} />
            <span className="text-xs text-foreground-muted">{C.escribirHint}</span>
          </div>
        )}
      </footer>
    </BezelCard>
  );
}

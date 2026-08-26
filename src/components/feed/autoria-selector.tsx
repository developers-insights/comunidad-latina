"use client";

import { Briefcase, CaretDown, Check, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AutoriaEntidad, AutoriaKind } from "@/lib/feed/autoria";
import { COPY } from "./copy";

/**
 * =============================================================================
 * "VAS A PUBLICAR COMO …" — la firma de la publicación, antes de publicarla
 * =============================================================================
 *
 * Publicar algo tuyo y publicarlo con el nombre de tu negocio no son la misma
 * acción: cambia quién lo dice, cambia a quién le llega (una publicación de
 * entidad sale a sus seguidores, no a toda la audiencia de "Todo" — ver
 * `feedPostVisibilityFilter`) y cambia qué pestaña la muestra. Una decisión de
 * ese tamaño no puede quedar escondida en un interruptor de otra pantalla: se
 * dice acá, en la misma hoja donde se toca Publicar, y se puede cambiar acá
 * mismo.
 *
 * ── POR QUÉ UN DESPLEGABLE Y NO UNA SEGUNDA HOJA ────────────────────────────
 * El composer YA es un `BottomSheet` con trampa de foco. Abrirle otra hoja
 * encima para elegir entre dos o tres nombres son dos trampas peleándose por
 * el foco y un "atrás" que ya no se sabe qué cierra. `<details>` + radios
 * REALES resuelve lo mismo sin salir de la hoja, y es exactamente el patrón que
 * este archivo vecino ya usa dos veces: la declaración de originalidad
 * (`DeclarationDisclosure`) y la categoría de video. Con radios de verdad, las
 * flechas del teclado se mueven entre opciones sin que lo implementemos a mano.
 *
 * ── LO QUE NO SE MUESTRA ────────────────────────────────────────────────────
 * Nada, cuando la persona sólo tiene su perfil personal. Un menú con una sola
 * opción estorba — es la misma decisión que tomó el cambiador del header
 * (`identity-switcher.tsx`) y acá vale doble: para la enorme mayoría, publicar
 * tiene que seguir siendo exactamente lo que era.
 *
 * ── EL ESTADO NO VIVE ACÁ ───────────────────────────────────────────────────
 * Este componente es presentacional. Qué firma está elegida y qué se manda al
 * servidor lo decide `PostComposerHost`, igual que el resto del composer; y la
 * verdad sobre qué firmas EXISTEN la calcula el servidor
 * (`@/lib/feed/autoria`) y la vuelve a validar al publicar. Acá no hay ninguna
 * decisión de autorización, sólo de pintura.
 */

/** Insignia del vertical sobre el avatar. El anillo la despega del fondo. */
function KindBadge({ kind, small = false }: { kind: AutoriaKind; small?: boolean }) {
  const Icon = kind === "business" ? Storefront : Briefcase;
  return (
    <span
      aria-hidden="true"
      className={cn(
        // `cl-print-hide`: tinta `brand-foreground` (clara) sobre un relleno que
        // el papel no imprime — mismo tratamiento que la insignia del header.
        "cl-print-hide flex items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface",
        small ? "size-3.5" : "size-4",
      )}
    >
      <Icon size={small ? 9 : 11} weight="fill" />
    </span>
  );
}

export interface AutoriaSelectorProps {
  /** Nombre y foto de quien publica, para la opción "vos". */
  personal: { displayName: string; avatarUrl: string | null };
  /** Fichas propias publicadas. Con 0 este componente no se monta (ver el host). */
  entidades: AutoriaEntidad[];
  /** `listings.id` elegido, o null = perfil personal. */
  value: string | null;
  onChange: (listingId: string | null) => void;
  /** Mientras se publica no se cambia a nombre de quién se está publicando. */
  disabled?: boolean;
}

export function AutoriaSelector({
  personal,
  entidades,
  value,
  onChange,
  disabled = false,
}: AutoriaSelectorProps) {
  const C = COPY.composer.autoria;
  const elegida = entidades.find((item) => item.listingId === value) ?? null;
  const nombreActivo = elegida?.nombre ?? personal.displayName;
  const detalleActivo = elegida ? C.kindLabel[elegida.kind] : C.personal;

  return (
    <details className="group shrink-0 rounded-lg border border-border-subtle bg-surface-subtle">
      <summary
        aria-label={C.changeLabel(nombreActivo)}
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg p-3",
          "[&::-webkit-details-marker]:hidden",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {elegida ? (
          <Avatar size="md" name={elegida.nombre} badge={<KindBadge kind={elegida.kind} />} />
        ) : (
          <Avatar size="md" name={personal.displayName} src={personal.avatarUrl} />
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wider text-foreground-muted">
            {C.label}
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
            {nombreActivo}
          </span>
          <span className="block truncate text-xs text-foreground-secondary">
            {detalleActivo}
          </span>
        </span>

        {/* Texto Y flecha: la acción no se adivina por un ícono solo, y el
            estado abierto/cerrado no se lee sólo por color. */}
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-ink"
        >
          {C.change}
          <CaretDown
            size={14}
            weight="bold"
            className={cn(
              "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
              "group-open:rotate-180",
            )}
          />
        </span>
      </summary>

      {/* `fieldset[disabled]` apaga TODAS las opciones de una: mientras se
          publica no se puede cambiar la firma de lo que ya se está mandando. */}
      <fieldset disabled={disabled} className="m-0 border-0 px-3 pb-3 pt-0">
        <legend className="sr-only">{C.chooseLabel}</legend>
        <ul className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <li>
            <AutoriaOption
              nombre={personal.displayName}
              detalle={C.personal}
              checked={value === null}
              onSelect={() => onChange(null)}
              avatar={
                <Avatar size="md" name={personal.displayName} src={personal.avatarUrl} />
              }
            />
          </li>
          {entidades.map((entidad) => (
            <li key={entidad.listingId}>
              <AutoriaOption
                nombre={entidad.nombre}
                detalle={C.kindLabel[entidad.kind]}
                checked={value === entidad.listingId}
                onSelect={() => onChange(entidad.listingId)}
                avatar={
                  <Avatar
                    size="md"
                    name={entidad.nombre}
                    badge={<KindBadge kind={entidad.kind} />}
                  />
                }
              />
            </li>
          ))}
        </ul>
      </fieldset>
    </details>
  );
}

/**
 * Una opción. Radio REAL escondido bajo la fila (`peer sr-only`): el grupo se
 * recorre con las flechas, lo anuncia el lector de pantalla como lo que es y el
 * estado elegido se lee por relleno, por peso Y por tilde — nunca sólo por
 * color.
 */
function AutoriaOption({
  nombre,
  detalle,
  checked,
  onSelect,
  avatar,
}: {
  nombre: string;
  detalle: string;
  checked: boolean;
  onSelect: () => void;
  avatar: React.ReactNode;
}) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name="composer-autoria"
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg border p-2 text-left",
          "border-transparent bg-surface",
          "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-hover",
          "peer-checked:border-brand peer-checked:bg-brand-tint",
          "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
          "peer-disabled:opacity-45",
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm text-foreground",
              checked ? "font-semibold" : "font-medium",
            )}
          >
            {nombre}
          </span>
          <span className="block truncate text-xs text-foreground-secondary">{detalle}</span>
        </span>
        {checked && (
          <Check
            size={16}
            weight="bold"
            aria-hidden="true"
            className="shrink-0 text-brand-ink"
          />
        )}
      </span>
    </label>
  );
}

/**
 * Mientras el servidor todavía no contestó con qué firmas se puede publicar.
 *
 * Existe —en vez de no pintar nada— porque en ese ratito el botón de Publicar
 * está apagado a propósito: una publicación que sale antes de la respuesta
 * saldría a nombre de quien nadie eligió. Un botón apagado sin explicación es
 * un botón roto; esta línea es la explicación.
 */
export function AutoriaCargando() {
  return (
    <p
      role="status"
      className="flex shrink-0 items-center gap-2 text-xs font-medium text-foreground-secondary"
    >
      <Spinner size={14} />
      {COPY.composer.autoria.loading}
    </p>
  );
}

/**
 * No se pudo preguntar (sin red, servidor caído). Se dice lo único accionable
 * —va a salir con tu nombre— y NO se bloquea nada: publicar como uno mismo es
 * el comportamiento de siempre y el default seguro.
 */
export function AutoriaNoDisponible() {
  return (
    <p role="status" className="shrink-0 text-xs text-foreground-secondary">
      {COPY.composer.autoria.failed}
    </p>
  );
}

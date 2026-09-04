"use client";

import { useActionState, useState } from "react";
import {
  ArrowSquareOut,
  CheckCircle,
  Envelope,
  MapPin,
  Phone,
  Prohibit,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Chip, Field, Input, Textarea } from "@/components/ui";
import {
  REGISTRATION_KIND_LABEL,
  REGISTRATION_NOTES_MAX,
  REGISTRATION_STATUS_LABEL,
  transicionesPosiblesDeRegistro,
  type RegistrationStatus,
  type RegistrationView,
} from "@/lib/comunidad";
import { publicarLugar, resolverRegistro, type RegistroActionState } from "./actions";

const INICIAL: RegistroActionState = { status: "idle" };

/**
 * =============================================================================
 * LA FICHA DE UN REGISTRO EN EL PANEL (0131)
 * =============================================================================
 *
 * Todo lo que la persona escribió, arriba, y las decisiones abajo. Sin
 * desplegables ni "ver más": quien tiene que llamar a alguien necesita el
 * teléfono, la zona y el detalle en la misma pantalla — esconder cualquiera de
 * los tres convierte una llamada en tres clics.
 *
 * ── EL TELÉFONO ES UN ENLACE, NO UN TEXTO ───────────────────────────────────
 * `tel:` y `mailto:`. Es la acción real de esta pantalla: el panel no existe
 * para archivar registros, existe para que alguien del equipo llame.
 *
 * ── LOS BOTONES SALEN DE LA MISMA REGLA QUE EL TRIGGER ──────────────────────
 * `transicionesPosiblesDeRegistro` es la función que también espeja el SQL: no
 * hay una lista de botones escrita a mano que pueda desincronizarse del BAD_
 * TRANSITION de la base. Por eso nunca aparece un botón "volver a sin mirar".
 *
 * ── PUBLICAR UN LUGAR NO ES UN BOTÓN, ES UN FORMULARIO ──────────────────────
 * Y a propósito. La ficha del directorio no puede existir sin fuente
 * verificable (0096), así que aprobar-y-publicar pide quién publica esa
 * información y dónde se confirmó. Un botón de un solo toque habría obligado a
 * inventar esa fuente — que es exactamente la regla que el directorio existe
 * para no romper.
 */
export function RegistroAdminCard({ registro }: { registro: RegistrationView }) {
  const [estado, resolver, resolviendo] = useActionState(resolverRegistro, INICIAL);
  const [notas, setNotas] = useState("");
  const [publicando, setPublicando] = useState(false);

  const transiciones = transicionesPosiblesDeRegistro(registro.status);
  const puedePublicar = registro.kind === "place" && !registro.resourceId;

  return (
    <article className="rounded-lg border border-border-subtle bg-surface p-4">
      {/* ---- Cabecera: quién y en qué estado ---- */}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug text-foreground">
            {registro.name}
          </h3>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {REGISTRATION_KIND_LABEL[registro.kind]} · lo mandó {registro.authorName} ·{" "}
            {registro.agedDays === 0 ? "hoy" : `hace ${registro.agedDays} d`}
          </p>
        </div>
        <Chip variant={chipVariant(registro.status)} size="sm">
          {REGISTRATION_STATUS_LABEL[registro.status]}
        </Chip>
      </header>

      {/* ---- Zona y contacto: la parte accionable ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 text-foreground-secondary">
          <MapPin size={16} aria-hidden="true" />
          {registro.areaLabel}
        </span>
        {registro.contactPhone && (
          <a
            href={`tel:${registro.contactPhone.replace(/[^\d+]/g, "")}`}
            className="flex min-h-11 items-center gap-1.5 font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <Phone size={16} weight="fill" aria-hidden="true" />
            {registro.contactPhone}
          </a>
        )}
        {registro.contactEmail && (
          <a
            href={`mailto:${registro.contactEmail}`}
            className="flex min-h-11 items-center gap-1.5 font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <Envelope size={16} weight="fill" aria-hidden="true" />
            {registro.contactEmail}
          </a>
        )}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
        {registro.body}
      </p>

      {/* ---- El detalle propio del formulario ---- */}
      {registro.detalles.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {registro.detalles.map((detalle) => (
            <div key={detalle.label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                {detalle.label}
              </dt>
              <dd className="text-sm text-foreground">{detalle.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {registro.resourceId && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-success-ink">
          <CheckCircle size={16} weight="fill" aria-hidden="true" />
          Ya tiene su ficha en el directorio.
        </p>
      )}

      {registro.adminNotes && (
        <p className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-sm leading-relaxed text-foreground-secondary">
          <span className="font-semibold">Notas del equipo: </span>
          {registro.adminNotes}
        </p>
      )}

      {registro.reviewedAt && registro.reviewerName && (
        <p className="mt-2 text-xs text-foreground-muted">
          Lo resolvió {registro.reviewerName} el{" "}
          {new Date(registro.reviewedAt).toLocaleDateString("es-AR")}.
        </p>
      )}

      {/* ---- Decisiones ---- */}
      <form action={resolver} className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-3">
        <input type="hidden" name="registroId" value={registro.id} />

        <label htmlFor={`notas-${registro.id}`} className="sr-only">
          Notas internas
        </label>
        <Textarea
          id={`notas-${registro.id}`}
          name="notas"
          value={notas}
          onChange={(event) => setNotas(event.target.value)}
          placeholder="Notas internas (opcional). Sólo las ve el equipo."
          maxLength={REGISTRATION_NOTES_MAX}
          rows={2}
        />

        <div className="flex flex-wrap gap-2">
          {transiciones.map((hasta) => (
            <Button
              key={hasta}
              type="submit"
              name="hasta"
              value={hasta}
              variant={hasta === "discarded" ? "outline" : "secondary"}
              size="sm"
              disabled={resolviendo}
            >
              {hasta === "discarded" && <Prohibit size={16} aria-hidden="true" />}
              {ACCION[hasta]}
            </Button>
          ))}
        </div>

        {estado.status === "error" && (
          <p role="alert" className="text-sm text-danger">
            {estado.message}
          </p>
        )}
        {estado.status === "success" && (
          <p role="status" className="text-sm text-success-ink">
            {estado.message}
          </p>
        )}
      </form>

      {/* ---- Publicar la ficha (sólo lugares) ---- */}
      {puedePublicar && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          {publicando ? (
            <PublicarLugarForm registroId={registro.id} onCancelar={() => setPublicando(false)} />
          ) : (
            <Button variant="primary" size="sm" onClick={() => setPublicando(true)}>
              <Storefront size={16} weight="fill" aria-hidden="true" />
              Aprobar y publicar en el directorio
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * El texto de cada botón. `new` está en la tabla por completitud del tipo, pero
 * NUNCA se dibuja: `transicionesPosiblesDeRegistro` no devuelve `new` desde
 * ningún estado — es la única transición que la base prohíbe.
 */
const ACCION: Record<RegistrationStatus, string> = {
  new: "Volver a sin mirar",
  contacted: "Ya lo contacté",
  approved: "Aprobar",
  discarded: "Descartar",
};

function chipVariant(status: RegistrationStatus): "neutral" | "brand" | "success" | "warning" {
  if (status === "new") return "brand";
  if (status === "contacted") return "warning";
  if (status === "approved") return "success";
  return "neutral";
}

/**
 * El formulario de publicación de un lugar.
 *
 * Los tres campos son la fuente, y son obligatorios porque el directorio no
 * acepta una ficha sin ella (0096). El resto de la ficha —nombre, dirección,
 * horarios, teléfono, tema— sale del registro tal cual lo escribió el lugar: si
 * algo está mal, se corrige después en /admin/comunidad/recursos, que es la
 * pantalla que existe justamente para eso.
 */
function PublicarLugarForm({
  registroId,
  onCancelar,
}: {
  registroId: string;
  onCancelar: () => void;
}) {
  const [estado, publicar, publicando] = useActionState(publicarLugar, INICIAL);
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <form action={publicar} className="flex flex-col gap-3">
      <input type="hidden" name="registroId" value={registroId} />

      <p className="text-xs leading-relaxed text-foreground-muted">
        Antes de publicar, confirmá los datos en alguna fuente (la página del lugar, el listado de
        la alcaldía) y decí cuál fue. La ficha la muestra siempre, junto a la fecha.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field htmlFor={`fuente-name-${registroId}`} label="Quién publica la información">
          <Input
            id={`fuente-name-${registroId}`}
            name="fuenteName"
            required
            maxLength={160}
            placeholder="NYC Food Help"
          />
        </Field>

        <Field htmlFor={`fuente-fecha-${registroId}`} label="Día en que lo confirmaste">
          <Input
            id={`fuente-fecha-${registroId}`}
            type="date"
            name="fuenteCheckedAt"
            required
            defaultValue={hoy}
          />
        </Field>
      </div>

      <Field htmlFor={`fuente-url-${registroId}`} label="Enlace donde lo confirmaste">
        <Input
          id={`fuente-url-${registroId}`}
          type="url"
          name="fuenteUrl"
          required
          placeholder="https://…"
        />
      </Field>

      {estado.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {estado.message}
        </p>
      )}
      {estado.status === "success" && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success-ink">
          <ArrowSquareOut size={16} aria-hidden="true" />
          {estado.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={publicando} loading={publicando}>
          Publicar la ficha
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={publicando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

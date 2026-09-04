"use client";

import { useActionState, useState } from "react";
import { FloppyDisk, Plus, X } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { RESOURCE_TOPICS, RESOURCE_TOPIC_LABEL, type ResourceTopic } from "@/lib/comunidad";
import {
  actualizarRecurso,
  crearRecurso,
  type RecursoActionState,
} from "./actions";

const INICIAL: RecursoActionState = { status: "idle" };

export interface RecursoInicial {
  id: string;
  topic: string;
  name: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  area_label: string | null;
  hours_note: string | null;
  cost_note: string | null;
  requirements_note: string | null;
  source_name: string;
  source_url: string;
  source_checked_at: string;
  status: string;
}

/**
 * =============================================================================
 * ALTA Y CORRECCIÓN DE UNA FICHA DEL DIRECTORIO
 * =============================================================================
 *
 * Un solo formulario para las dos cosas: si viene `recurso`, corrige; si no,
 * crea. Son los mismos catorce campos y la misma validación — partirlo en dos
 * componentes habría garantizado que uno de los dos se quede sin un campo el día
 * que se agregue.
 *
 * ── EL BLOQUE DE LA FUENTE ESTÁ SEPARADO Y NO ES DECORACIÓN ─────────────────
 * Quien carga treinta bancos de comida seguidos necesita ver de un vistazo que
 * esos tres campos no son opcionales. Van juntos, con su propia explicación, y
 * la fecha viene con la de hoy puesta: es el día en que efectivamente se está
 * mirando la fuente.
 *
 * ── LOS CAMPOS OPCIONALES ESTÁN MARCADOS, LOS OBLIGATORIOS NO ───────────────
 * Es la convención de `<Field optional>` en todo el repo: lo requerido es el
 * default silencioso. Marcar los obligatorios con asteriscos en un formulario
 * donde nueve de catorce lo son sería marcar casi todo.
 */
export function RecursoForm({
  recurso,
  onCerrar,
}: {
  recurso?: RecursoInicial;
  onCerrar?: () => void;
}) {
  const editando = Boolean(recurso);
  const [estado, enviar, enviando] = useActionState(
    editando ? actualizarRecurso : crearRecurso,
    INICIAL,
  );
  const [topic, setTopic] = useState<ResourceTopic>(
    (RESOURCE_TOPICS as readonly string[]).includes(recurso?.topic ?? "")
      ? (recurso?.topic as ResourceTopic)
      : "comida",
  );
  const hoy = new Date().toISOString().slice(0, 10);
  const id = recurso?.id ?? "nuevo";

  return (
    <form action={enviar} className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      {recurso && <input type="hidden" name="recursoId" value={recurso.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor={`topic-${id}`} label="Tema">
          <Select
            id={`topic-${id}`}
            name="topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value as ResourceTopic)}
          >
            {RESOURCE_TOPICS.map((valor) => (
              <option key={valor} value={valor}>
                {RESOURCE_TOPIC_LABEL[valor]}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor={`status-${id}`} label="Estado">
          <Select id={`status-${id}`} name="status" defaultValue={recurso?.status ?? "published"}>
            <option value="published">Publicada (se ve en la comunidad)</option>
            <option value="draft">Borrador (sólo la ves vos)</option>
            <option value="removed">Bajada</option>
          </Select>
        </Field>
      </div>

      <Field htmlFor={`name-${id}`} label="Nombre del lugar u organización">
        <Input
          id={`name-${id}`}
          name="name"
          required
          maxLength={140}
          defaultValue={recurso?.name ?? ""}
          placeholder="Despensa Comunitaria San Rafael"
        />
      </Field>

      <Field
        htmlFor={`description-${id}`}
        label="Qué ofrece"
        help="Lo que hace ESE lugar, contado como lo cuenta su fuente. No es un instructivo nuestro."
        optional
      >
        <Textarea
          id={`description-${id}`}
          name="description"
          maxLength={600}
          rows={3}
          defaultValue={recurso?.description ?? ""}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor={`phone-${id}`} label="Teléfono" optional>
          <Input
            id={`phone-${id}`}
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={recurso?.phone ?? ""}
            placeholder="(718) 555-0110"
          />
        </Field>

        <Field htmlFor={`website-${id}`} label="Sitio web" optional>
          <Input
            id={`website-${id}`}
            name="website"
            type="url"
            maxLength={300}
            defaultValue={recurso?.website ?? ""}
            placeholder="https://…"
          />
        </Field>

        <Field htmlFor={`address-${id}`} label="Dirección" optional>
          <Input
            id={`address-${id}`}
            name="address"
            maxLength={240}
            defaultValue={recurso?.address ?? ""}
            placeholder="103-25 Roosevelt Ave, Corona, NY"
          />
        </Field>

        <Field htmlFor={`area-${id}`} label="Zona" optional>
          <Input
            id={`area-${id}`}
            name="areaLabel"
            maxLength={80}
            defaultValue={recurso?.area_label ?? ""}
            placeholder="Corona, Queens"
          />
        </Field>

        <Field htmlFor={`hours-${id}`} label="Horarios" optional>
          <Input
            id={`hours-${id}`}
            name="hoursNote"
            maxLength={240}
            defaultValue={recurso?.hours_note ?? ""}
            placeholder="Martes y jueves de 10 a 14"
          />
        </Field>

        <Field htmlFor={`cost-${id}`} label="Costo" optional>
          <Input
            id={`cost-${id}`}
            name="costNote"
            maxLength={160}
            defaultValue={recurso?.cost_note ?? ""}
            placeholder="Gratis"
          />
        </Field>
      </div>

      <Field
        htmlFor={`req-${id}`}
        label="Qué piden"
        help="Lo que alguien necesita saber antes de viajar hasta ahí."
        optional
      >
        <Input
          id={`req-${id}`}
          name="requirementsNote"
          maxLength={300}
          defaultValue={recurso?.requirements_note ?? ""}
          placeholder="No piden documentos ni turno"
        />
      </Field>

      {/* ---- La fuente: obligatoria, y por eso va en su propio bloque ---- */}
      <fieldset className="rounded-md border border-border-subtle bg-surface-subtle p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          De dónde sale este dato
        </legend>
        <p className="mb-3 text-xs leading-relaxed text-foreground-secondary">
          La ficha muestra siempre quién publica esta información y qué día la revisamos. Sin eso no
          se puede guardar: es lo que evita que un teléfono viejo parezca un consejo nuestro.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field htmlFor={`source-name-${id}`} label="Quién lo publica">
            <Input
              id={`source-name-${id}`}
              name="sourceName"
              required
              maxLength={160}
              defaultValue={recurso?.source_name ?? ""}
              placeholder="NYC Health + Hospitals"
            />
          </Field>

          <Field htmlFor={`source-date-${id}`} label="Día en que lo revisaste">
            <Input
              id={`source-date-${id}`}
              name="sourceCheckedAt"
              type="date"
              required
              defaultValue={recurso?.source_checked_at ?? hoy}
            />
          </Field>
        </div>

        <Field htmlFor={`source-url-${id}`} label="Enlace a la publicación original" className="mt-4">
          <Input
            id={`source-url-${id}`}
            name="sourceUrl"
            type="url"
            required
            defaultValue={recurso?.source_url ?? ""}
            placeholder="https://…"
          />
        </Field>
      </fieldset>

      {estado.status === "error" && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2.5 text-sm text-danger-ink">
          {estado.message}
        </p>
      )}
      {estado.status === "success" && (
        <p role="status" className="text-sm text-success-ink">
          {estado.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="md" disabled={enviando} loading={enviando}>
          {editando ? (
            <FloppyDisk size={18} weight="fill" aria-hidden="true" />
          ) : (
            <Plus size={18} weight="bold" aria-hidden="true" />
          )}
          {editando ? "Guardar cambios" : "Agregar al directorio"}
        </Button>
        {onCerrar && (
          <Button type="button" variant="ghost" size="md" onClick={onCerrar} disabled={enviando}>
            <X size={18} aria-hidden="true" />
            Cerrar
          </Button>
        )}
      </div>
    </form>
  );
}

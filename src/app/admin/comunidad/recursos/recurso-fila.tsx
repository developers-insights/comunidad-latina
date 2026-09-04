"use client";

import { useActionState, useState } from "react";
import { ArrowCounterClockwise, EyeSlash, MapPin, PencilSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, Chip } from "@/components/ui";
import { RESOURCE_TOPIC_LABEL, isResourceTopic } from "@/lib/comunidad";
import { cambiarEstadoDeRecurso, type RecursoActionState } from "./actions";
import { RecursoForm, type RecursoInicial } from "./recurso-form";

const INICIAL: RecursoActionState = { status: "idle" };

/**
 * Una ficha del directorio en la lista del panel.
 *
 * Cerrada muestra lo que hace falta para reconocerla y decidir; abierta es el
 * formulario entero. No hay pantalla de detalle: con cuarenta fichas cargadas a
 * mano, ir y volver de una lista a un detalle cuarenta veces es el trabajo, no
 * la interfaz.
 *
 * ── UNA FICHA SIN TEMA VÁLIDO SE MARCA EN ROJO ──────────────────────────────
 * No se esconde. El lado público la descarta en silencio (`toCommunityResource`
 * devuelve null), así que si el panel también la escondiera, la ficha existiría
 * en la base y en ningún lado más — invisible y sin forma de arreglarla.
 */
export function RecursoFila({
  recurso,
  topicValido,
}: {
  recurso: RecursoInicial;
  topicValido: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, cambiarEstado, cambiando] = useActionState(cambiarEstadoDeRecurso, INICIAL);

  const publicada = recurso.status === "published";

  if (abierto) {
    return <RecursoForm recurso={recurso} onCerrar={() => setAbierto(false)} />;
  }

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug text-foreground">
            {recurso.name}
          </h3>
          <p className="mt-0.5 text-xs text-foreground-muted">
            Lo publica {recurso.source_name} · revisado el {recurso.source_checked_at}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {topicValido && isResourceTopic(recurso.topic) ? (
            <Chip variant="neutral" size="sm">
              {RESOURCE_TOPIC_LABEL[recurso.topic]}
            </Chip>
          ) : (
            <Chip variant="danger" size="sm">
              Tema desconocido: {recurso.topic}
            </Chip>
          )}
          <Chip variant={publicada ? "success" : "warning"} size="sm">
            {publicada ? "Publicada" : recurso.status === "draft" ? "Borrador" : "Bajada"}
          </Chip>
        </div>
      </header>

      {(recurso.address || recurso.area_label) && (
        <p className="flex items-start gap-1.5 text-sm text-foreground-secondary">
          <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {recurso.address ?? recurso.area_label}
          {recurso.hours_note ? ` · ${recurso.hours_note}` : ""}
        </p>
      )}

      {estado.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {estado.message}
        </p>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAbierto(true)}>
          <PencilSimple size={16} aria-hidden="true" />
          Editar
        </Button>

        <form action={cambiarEstado}>
          <input type="hidden" name="recursoId" value={recurso.id} />
          <input type="hidden" name="status" value={publicada ? "removed" : "published"} />
          <Button type="submit" variant="outline" size="sm" disabled={cambiando}>
            {publicada ? (
              <>
                <EyeSlash size={16} aria-hidden="true" />
                Bajar del directorio
              </>
            ) : (
              <>
                <ArrowCounterClockwise size={16} aria-hidden="true" />
                Publicar
              </>
            )}
          </Button>
        </form>
      </div>
    </article>
  );
}

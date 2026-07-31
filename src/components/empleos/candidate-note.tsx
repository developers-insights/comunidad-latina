"use client";

import { useId, useState } from "react";
import { LockKey, NotePencil } from "@phosphor-icons/react/dist/ssr";
import { Button, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { saveApplicationNoteAction } from "@/app/(app)/empleos/actions";
import { COPY } from "./copy";

const C = COPY.candidates;

export interface CandidateNoteProps {
  applicationId: string;
  initialNote: string | null;
}

/**
 * Nota privada de quien evalúa, sobre una candidatura.
 *
 * ── QUIÉN LA VE ────────────────────────────────────────────────────────────
 * Solo su autor. Vive en `job_application_notes`, una tabla APARTE de la
 * postulación justamente porque su audiencia es distinta: el candidato tiene
 * que poder leer su propia postulación y NO tiene que poder leer lo que
 * escribieron sobre él, y la RLS filtra filas, no columnas (migración 0047 lo
 * explica en detalle). En esa tabla el candidato no es sujeto de ninguna
 * policy: no hay `using` que se la devuelva.
 *
 * El cartelito "solo la ves vos" no es tranquilizador de marketing: es el
 * contrato real, y por eso está escrito al lado del campo.
 */
export function CandidateNote({ applicationId, initialNote }: CandidateNoteProps) {
  const inputId = useId();
  const { toast } = useToast();
  const [note, setNote] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  const dirty = note.trim() !== saved.trim();

  async function save() {
    setPending(true);
    try {
      const result = await saveApplicationNoteAction({ applicationId, note });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.noteError });
        return;
      }
      const next = result.note ?? "";
      setSaved(next);
      setNote(next);
      setEditing(false);
      toast({ variant: "success", title: next ? C.noteSaved : C.noteRemoved });
    } catch {
      toast({ variant: "danger", title: C.noteError });
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        {saved ? (
          <>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground-secondary">
              <LockKey size={13} weight="fill" aria-hidden="true" />
              {C.noteTitle}
            </p>
            <p className="whitespace-pre-line rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground-secondary">
              {saved}
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "min-h-11 self-start text-sm font-semibold text-brand underline underline-offset-2",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              {C.noteSave}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              "flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-foreground-secondary",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <NotePencil size={16} aria-hidden="true" />
            {C.noteAdd}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3">
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <LockKey size={14} weight="fill" aria-hidden="true" />
        {C.noteTitle}
      </label>
      <Textarea
        id={inputId}
        rows={3}
        value={note}
        maxLength={2000}
        autoFocus
        placeholder={C.notePlaceholder}
        disabled={pending}
        aria-describedby={`${inputId}-help`}
        onChange={(event) => setNote(event.target.value)}
      />
      <p id={`${inputId}-help`} className="text-xs text-foreground-muted">
        {C.noteHelp}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setNote(saved);
            setEditing(false);
          }}
        >
          {C.noteCancel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? C.noteSaving : C.noteSave}
        </Button>
      </div>
    </div>
  );
}

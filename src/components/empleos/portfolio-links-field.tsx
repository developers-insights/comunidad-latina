"use client";

import { useId, useState } from "react";
import { LinkSimple, Plus, X } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MAX_PORTFOLIO_LINKS, PORTFOLIO_LINK_MAX_LENGTH } from "@/lib/empleos/cv";
import { COPY } from "./copy";

const C = COPY.apply.portfolio;

export interface PortfolioLinksFieldProps {
  value: string[];
  onChange: (links: string[]) => void;
  disabled?: boolean;
  error?: string | null;
}

/**
 * Hasta 5 enlaces de portafolio.
 *
 * Un input por enlace y no un textarea con renglones: cada uno tiene su propia
 * etiqueta accesible ("Enlace 2") y su propio botón de quitar de 44px, que es
 * la diferencia entre poder corregir el tercero y tener que reescribir todo.
 *
 * El tope de 5 y el formato http(s) los impone además el CHECK de la base
 * (app.portfolio_links_ok, 0047) — acá se valida para avisar antes, no para
 * reemplazarlo.
 */
export function PortfolioLinksField({
  value,
  onChange,
  disabled = false,
  error,
}: PortfolioLinksFieldProps) {
  const groupId = useId();
  // Siempre hay al menos un renglón: un campo vacío invita, un botón "agregar"
  // sobre la nada hace pensar que la función no existe.
  const rows = value.length > 0 ? value : [""];
  const canAdd = rows.length < MAX_PORTFOLIO_LINKS && rows.every((row) => row.trim().length > 0);

  /**
   * Id ESTABLE por fila, generado al agregarla — no el índice. Con el índice
   * como key, borrar la fila del medio hacía que React reutilizara el nodo
   * (mismo índice, otro enlace ahora) y el foco podía terminar sobre un input
   * que ya representa un enlace distinto al que se estaba editando. `ids`
   * vive en lockstep con `rows`: `update` no cambia el largo y no lo toca;
   * `add`/`remove` mutan los dos arreglos a la vez, en la misma posición.
   */
  const [ids, setIds] = useState<string[]>(() => rows.map(() => crypto.randomUUID()));

  function update(index: number, next: string) {
    const copy = [...rows];
    copy[index] = next;
    onChange(copy);
  }

  function remove(index: number) {
    const copy = rows.filter((_, i) => i !== index);
    setIds((current) => current.filter((_, i) => i !== index));
    onChange(copy);
  }

  function add() {
    setIds((current) => [...current, crypto.randomUUID()]);
    onChange([...rows, ""]);
  }

  const errorId = `${groupId}-error`;

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <div className="flex items-baseline justify-between gap-2">
        <legend className="text-sm font-semibold text-foreground">{C.label}</legend>
        <span className="text-xs text-foreground-muted">Opcional</span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((link, index) => (
          <div key={ids[index] ?? index} className="flex items-center gap-2">
            <Input
              id={`${groupId}-${index}`}
              type="url"
              inputMode="url"
              autoComplete="url"
              aria-label={C.inputLabel(index + 1)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : `${groupId}-help`}
              placeholder={C.placeholder}
              maxLength={PORTFOLIO_LINK_MAX_LENGTH}
              value={link}
              disabled={disabled}
              onChange={(event) => update(index, event.target.value)}
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={C.remove(index + 1)}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
                  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-danger",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  "disabled:opacity-50",
                )}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>

      {canAdd && (
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className={cn(
            "flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-brand",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:opacity-50",
          )}
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          {C.add}
        </button>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${groupId}-help`} className="flex items-start gap-1.5 text-sm text-foreground-muted">
          <LinkSimple size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
          {C.help}
        </p>
      )}
    </fieldset>
  );
}

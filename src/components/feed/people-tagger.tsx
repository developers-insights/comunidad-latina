"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CaretRight, MagnifyingGlass, UsersThree, X } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BottomSheet, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  MAX_POST_TAGS,
  MIN_TAG_QUERY_LENGTH,
  addTagged,
  isTagged,
  removeTagged,
  type TaggedProfile,
} from "@/lib/social/post-tags";
import { searchTaggableMembersAction } from "@/app/(app)/feed/tag-actions";
import { TAGGER_COPY as COPY } from "./people-tagger-copy";

/**
 * ETIQUETAR PERSONAS — el selector (migración 0089).
 *
 * FORMA: una FILA de acción, no una tarjeta. Se monta dentro de la hoja del
 * composer (prop `tagSlot`), así que no fija ancho, ni fondo, ni margen propio:
 * ocupa el ancho que le den y se apoya en el papel de quien la contiene. Todo
 * lo que necesita del sistema —bordes, radios, tinta— sale de tokens.
 *
 * CONTROLADO de punta a punta: la lista vive afuera (`value` / `onChange`) y
 * este componente no guarda nada en la base. Guardar es de `saveTagsAction`, y
 * ocurre DESPUÉS de que el post existe — por eso el composer puede montarlo sin
 * que el selector sepa siquiera que hay un post.
 *
 * TRES ESTADOS DISEÑADOS, no tres ausencias: antes de escribir se invita a
 * escribir, mientras busca se dice que está buscando, y sin resultados se
 * sugiere qué probar. El cuarto —la búsqueda que falla— también tiene su copy:
 * un buscador mudo se lee como "no existe nadie con ese nombre", que es una
 * mentira.
 *
 * ACCESIBILIDAD: cada control mide 44px de alto real; el foco se ve con el
 * anillo de 3px del sistema; los resultados son una lista con `role="status"`
 * en el mensaje de estado para que el lector de pantalla anuncie los cambios
 * sin que el foco salte del campo de búsqueda.
 */

export interface PeopleTaggerProps {
  value: TaggedProfile[];
  onChange: (next: TaggedProfile[]) => void;
  /** Tope de personas. Default: el mismo que impone la base (20). */
  max?: number;
  disabled?: boolean;
  className?: string;
}

/** Milisegundos de quietud del teclado antes de salir a buscar. */
const DEBOUNCE_MS = 250;

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; people: TaggedProfile[] }
  | { status: "error" };

/** Cara + nombre, la unidad que se repite en resultados y en elegidos. */
function PersonRow({
  person,
  selected,
  disabled,
  onToggle,
}: {
  person: TaggedProfile;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={selected ? COPY.sheet.remove(person.displayName) : COPY.sheet.add(person.displayName)}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-45",
        selected && "bg-brand-tint",
      )}
    >
      <Avatar size="sm" name={person.displayName} src={person.avatarUrl} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {person.displayName}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-brand bg-brand text-brand-foreground"
            : "border-border text-foreground-muted",
        )}
      >
        {selected ? <X size={13} weight="bold" /> : <span className="text-base leading-none">+</span>}
      </span>
    </button>
  );
}

export function PeopleTagger({
  value,
  onChange,
  max = MAX_POST_TAGS,
  disabled = false,
  className,
}: PeopleTaggerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const inputId = useId();
  /**
   * Descarta respuestas viejas: sin esto, una búsqueda lenta de "an" puede
   * pisar los resultados de "ana" y mostrar la lista equivocada. El contador se
   * incrementa en cada disparo y sólo gana la respuesta del último.
   */
  const requestRef = useRef(0);

  const full = value.length >= max;

  // --- Búsqueda con debounce ------------------------------------------------
  //
  // NINGÚN `setState` en el cuerpo del efecto: los estados que se pueden
  // DERIVAR del texto tipeado (nada escrito, escrito de menos) se resuelven en
  // el render, y los que dependen de la red se escriben dentro del temporizador
  // —o sea, fuera del cuerpo síncrono del efecto—. Es la misma regla que
  // respeta `useKeyboardInset` en BottomSheet, y acá además evita el parpadeo
  // de "Buscando…" en cada tecla.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_TAG_QUERY_LENGTH) {
      // Invalida cualquier respuesta en vuelo: si vuelve la de "ana" después de
      // haber borrado hasta "a", no tiene que pintar nada.
      requestRef.current += 1;
      return;
    }

    const ticket = (requestRef.current += 1);

    const timer = setTimeout(() => {
      setState({ status: "searching" });
      void searchTaggableMembersAction({ query: trimmed })
        .then((result) => {
          if (ticket !== requestRef.current) return;
          setState(
            result.ok ? { status: "done", people: result.people } : { status: "error" },
          );
        })
        .catch(() => {
          if (ticket !== requestRef.current) return;
          setState({ status: "error" });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [open, query]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setQuery("");
    requestRef.current += 1;
    setState({ status: "idle" });
  }, []);

  const toggle = useCallback(
    (person: TaggedProfile) => {
      if (isTagged(value, person.id)) {
        onChange(removeTagged(value, person.id));
        return;
      }
      const next = addTagged(value, person, max);
      // `addTagged` devuelve la MISMA referencia cuando no entró: eso significa
      // que se llegó al tope, y avisarlo es mejor que un toque que no hace nada.
      if (next !== value) onChange(next);
    },
    [max, onChange, value],
  );

  const trimmed = query.trim();
  /**
   * Los dos estados que salen del TEXTO y no de la red. Tienen prioridad sobre
   * `state`: si alguien borra hasta dejar una letra, no puede seguir viéndose
   * la lista de la búsqueda anterior.
   */
  const nothingTyped = trimmed.length === 0;
  const tooShort = !nothingTyped && trimmed.length < MIN_TAG_QUERY_LENGTH;
  const showRemote = !nothingTyped && !tooShort;
  const results = state.status === "done" ? state.people : [];

  return (
    <div className={cn("w-full", className)}>
      {/* --- LA FILA -------------------------------------------------------- */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={COPY.row.openAria}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left",
          "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "disabled:pointer-events-none disabled:opacity-45",
        )}
      >
        <UsersThree size={20} weight="regular" aria-hidden="true" className="shrink-0 text-brand-ink" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{COPY.row.label}</span>
          <span className="mt-0.5 block truncate text-xs text-foreground-secondary">
            {value.length === 0
              ? COPY.row.hint
              : full
                ? COPY.row.full
                : COPY.row.chosen(value.length)}
          </span>
        </span>

        {/* Las caras ya elegidas, superpuestas. Decorativas: el conteo real ya
            se dice en texto arriba, así que repetirlo en el árbol accesible
            sería ruido. */}
        {value.length > 0 && (
          <span aria-hidden="true" className="flex shrink-0 -space-x-2">
            {value.slice(0, 3).map((person) => (
              <Avatar
                key={person.id}
                size="xs"
                name={person.displayName}
                src={person.avatarUrl}
                className="ring-2 ring-surface"
              />
            ))}
          </span>
        )}

        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>

      {/* --- LA HOJA -------------------------------------------------------- */}
      <BottomSheet
        open={open}
        onClose={closeSheet}
        size="tall"
        keyboardAware
        title={COPY.sheet.title}
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-2 pt-1">
          <label htmlFor={inputId} className="sr-only">
            {COPY.sheet.searchLabel}
          </label>
          <div className="relative shrink-0">
            <MagnifyingGlass
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
            />
            <input
              id={inputId}
              type="search"
              inputMode="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={COPY.sheet.searchPlaceholder}
              className={cn(
                "min-h-11 w-full rounded-full border border-border bg-surface py-2 pl-10 pr-3",
                "text-base text-foreground placeholder:text-foreground-muted",
                "focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            />
          </div>

          {/* Elegidos: siempre a la vista, para poder sacar a alguien sin
              tener que volver a buscarlo. */}
          {value.length > 0 && (
            <div className="mt-3 shrink-0">
              <p className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                {COPY.sheet.chosenTitle}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {value.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => onChange(removeTagged(value, person.id))}
                      aria-label={COPY.sheet.remove(person.displayName)}
                      className={cn(
                        "flex min-h-11 items-center gap-1.5 rounded-full border border-brand bg-brand-tint py-1 pl-1 pr-3",
                        "text-sm font-medium text-brand-ink",
                        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.97]",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                      )}
                    >
                      <Avatar size="xs" name={person.displayName} src={person.avatarUrl} />
                      <span className="max-w-32 truncate">{person.displayName}</span>
                      <X size={13} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {full && (
            <p role="status" className="mt-3 shrink-0 text-xs font-medium text-foreground-secondary">
              {COPY.sheet.limitReached}
            </p>
          )}

          {/* Resultados / estados. Una sola región que scrollea. */}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {(nothingTyped || tooShort) && (
              <p className="px-1 py-6 text-center text-sm text-foreground-muted">
                {nothingTyped ? COPY.sheet.idle : COPY.sheet.tooShort}
              </p>
            )}

            {showRemote && (state.status === "idle" || state.status === "searching") && (
              <p
                role="status"
                className="flex items-center justify-center gap-2 px-1 py-6 text-sm text-foreground-secondary"
              >
                <Spinner />
                {COPY.sheet.searching}
              </p>
            )}

            {showRemote && state.status === "error" && (
              <div role="status" className="px-1 py-6 text-center">
                <p className="text-sm font-medium text-foreground">{COPY.sheet.error}</p>
                <p className="mt-1 text-sm text-foreground-secondary">{COPY.sheet.errorHint}</p>
              </div>
            )}

            {showRemote && state.status === "done" && results.length === 0 && (
              <div role="status" className="px-1 py-6 text-center">
                <p className="text-sm font-medium text-foreground">{COPY.sheet.empty(trimmed)}</p>
                <p className="mt-1 text-sm text-foreground-secondary">{COPY.sheet.emptyHint}</p>
              </div>
            )}

            {showRemote && state.status === "done" && results.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {results.map((person) => {
                  const selected = isTagged(value, person.id);
                  return (
                    <li key={person.id}>
                      <PersonRow
                        person={person}
                        selected={selected}
                        // Con la lista llena, lo único que queda habilitado es
                        // SACAR gente: apagar también eso dejaría a la persona
                        // encerrada en su propio tope.
                        disabled={full && !selected}
                        onToggle={() => toggle(person)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
          <p className="min-w-0 flex-1 text-xs text-foreground-muted">
            {COPY.sheet.privacyNote}
          </p>
          <Button type="button" variant="primary" size="sm" className="min-h-11" onClick={closeSheet}>
            {COPY.sheet.done}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

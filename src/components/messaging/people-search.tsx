"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, Input, Spinner } from "@/components/ui";
import { COPY } from "./copy";

export type PersonaEncontrada = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  areaLabel: string | null;
  identityVerified: boolean;
};

type Estado =
  | { fase: "vacio" }
  | { fase: "buscando" }
  | { fase: "listo"; personas: PersonaEncontrada[]; termino: string }
  | { fase: "error" };

/**
 * BUSCADOR DE PERSONAS DE LA COMUNIDAD.
 *
 * Es la pieza que el cliente pidió con estas palabras: «yo te quiero mensajear
 * a ti: busco Manuel Navarro y te mando un mensaje directo». Vive arriba de la
 * bandeja y se reusa tal cual para invitar gente a un grupo — son la misma
 * pregunta ("¿a quién?") con distinta respuesta, así que el componente recibe
 * qué hacer con la persona elegida (`onElegir`) y no la elige él.
 *
 * ── POR QUÉ NO ES UN `combobox` ARIA ────────────────────────────────────────
 * El patrón `combobox` promete navegación con flechas dentro de un popup y un
 * `aria-activedescendant` que hay que mantener sincronizado a mano. Acá los
 * resultados NO son un popup: se quedan en la página, debajo del campo, y cada
 * uno es un botón que se alcanza con Tab como cualquier otro. Prometer
 * `combobox` y no implementar el teclado que ese rol implica es peor que no
 * prometerlo: un lector de pantalla anuncia una interacción que no existe.
 * Lo que sí hay es una región `status` que dice cuántos resultados aparecieron.
 *
 * ── CANCELACIÓN ─────────────────────────────────────────────────────────────
 * Cada tecla aborta la búsqueda anterior. Sin esto, escribir rápido deja tres
 * respuestas en vuelo y gana la que vuelva última — que puede ser la de
 * "Ram" cuando en pantalla ya dice "Ramón".
 */
export function PeopleSearch({
  onElegir,
  ocupadoId,
  etiquetaAccion,
  autoFocus,
  className,
}: {
  /** Qué pasa al elegir a alguien. Lo decide quien usa el buscador. */
  onElegir: (persona: PersonaEncontrada) => void;
  /** Id de la persona sobre la que hay una acción en curso (spinner en su fila). */
  ocupadoId?: string | null;
  /** Texto del botón de cada fila ("Escribirle", "Invitar"). */
  etiquetaAccion: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const [valor, setValor] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "vacio" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const termino = valor.trim();
    if (termino.length < 2) {
      abortRef.current?.abort();
      setEstado({ fase: "vacio" });
      return;
    }

    // 200 ms: por debajo de eso se dispara una consulta por letra y por encima
    // se siente trabado. Es el mismo orden de magnitud que usa /buscar.
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setEstado({ fase: "buscando" });

      try {
        const respuesta = await fetch(
          `/mensajes/api/personas?q=${encodeURIComponent(termino)}`,
          { signal: controller.signal },
        );
        if (!respuesta.ok) {
          setEstado({ fase: "error" });
          return;
        }
        const datos = (await respuesta.json()) as { personas?: PersonaEncontrada[] };
        setEstado({ fase: "listo", personas: datos.personas ?? [], termino });
      } catch (error) {
        // Abortar es lo NORMAL acá (una tecla más), no una falla: si se pintara
        // el error, escribir rápido mostraría "no pudimos buscar" en cada letra.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEstado({ fase: "error" });
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [valor]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const hayResultados = estado.fase === "listo" && estado.personas.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {COPY.inbox.searchLabel}
        </label>
        <MagnifyingGlass
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted"
        />
        <Input
          id={inputId}
          type="search"
          inputMode="search"
          autoComplete="off"
          autoFocus={autoFocus}
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          placeholder={COPY.inbox.searchPlaceholder}
          className="h-12 rounded-full pl-11 pr-11"
        />
        {valor.length > 0 && (
          <button
            type="button"
            onClick={() => setValor("")}
            aria-label={COPY.inbox.searchClear}
            className={cn(
              "absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
              "text-foreground-muted transition-colors hover:bg-surface-subtle hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* La única promesa accesible que hacemos: cuántos resultados hay. */}
      <p role="status" aria-live="polite" className="sr-only">
        {estado.fase === "buscando"
          ? COPY.inbox.searchHint
          : estado.fase === "listo"
            ? `${estado.personas.length} ${estado.personas.length === 1 ? "persona" : "personas"}`
            : ""}
      </p>

      {estado.fase === "buscando" && (
        <p className="flex items-center gap-2 px-1 text-sm text-foreground-muted">
          <Spinner size={16} />
          {COPY.inbox.searchHint}
        </p>
      )}

      {estado.fase === "error" && (
        <p className="px-1 text-sm text-foreground-secondary">{COPY.inbox.searchError}</p>
      )}

      {estado.fase === "listo" && estado.personas.length === 0 && (
        <p className="px-1 text-sm text-foreground-secondary">
          {COPY.inbox.searchEmpty(estado.termino)}
        </p>
      )}

      {hayResultados && (
        <ul className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface">
          {estado.personas.map((persona, index) => (
            <li
              key={persona.id}
              className={index > 0 ? "border-t border-border-subtle" : undefined}
            >
              <button
                type="button"
                disabled={Boolean(ocupadoId)}
                onClick={() => onElegir(persona)}
                className={cn(
                  "flex w-full items-center gap-3 p-3 text-left",
                  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                  "disabled:opacity-60",
                )}
              >
                <Avatar src={persona.avatarUrl} name={persona.displayName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {persona.displayName}
                  </span>
                  {persona.areaLabel && (
                    <span className="block truncate text-xs text-foreground-muted">
                      {persona.areaLabel}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-medium text-brand-ink">
                  {ocupadoId === persona.id ? <Spinner size={16} /> : etiquetaAccion}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

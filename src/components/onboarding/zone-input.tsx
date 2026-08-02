"use client";

import { useId, useMemo, useRef, useState } from "react";
import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui";

/**
 * Zonas sugeridas del tenant piloto (Queens, NY). SOLO zona/barrio —
 * jamás dirección exacta (anti-honeypot, §5.4 del plan).
 */
export const QUEENS_ZONES = [
  "Corona, Queens",
  "Jackson Heights, Queens",
  "Elmhurst, Queens",
  "Flushing, Queens",
  "Woodside, Queens",
  "Astoria, Queens",
] as const;

export interface ZoneInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** Input de zona con sugerencias tocables — filtra mientras escribís. */
export function ZoneInput({
  id,
  value,
  onChange,
  placeholder = "Ej: Corona",
  ...aria
}: ZoneInputProps) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  // El ref va en el CONTENEDOR, no en el <Input>: la trampa de foco compara el
  // `relatedTarget` del blur contra este subárbol para saber si el foco salió
  // de verdad o sólo saltó a una sugerencia. Con el ref en el input eso no se
  // puede preguntar. (El primitivo ya acepta `ref`; esto es por el foco.)
  const rootRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return [...QUEENS_ZONES];
    const matches = QUEENS_ZONES.filter((zone) =>
      zone.toLowerCase().includes(query),
    );
    // Si ya eligió una sugerencia exacta, no la repetimos abajo.
    return matches.filter((zone) => zone.toLowerCase() !== query);
  }, [value]);

  const showSuggestions = focused && suggestions.length > 0;

  function pick(zone: string) {
    onChange(zone);
    setFocused(false);
    // El foco vuelve al campo ANTES de que la lista se oculte. Si se quedara en
    // el botón elegido, al pasar la lista a `display:none` el navegador tira el
    // foco al <body> y quien navega con teclado pierde el lugar.
    rootRef.current?.querySelector("input")?.focus();
  }

  return (
    /**
     * El foco se sigue a nivel del contenedor, no del input. Antes el `onBlur`
     * del input cerraba la lista con un `setTimeout` de 120 ms: al tabular del
     * campo a una sugerencia, la lista se ocultaba 120 ms después y destruía el
     * botón que acababa de recibir el foco. Con mouse no se notaba porque el
     * `onMouseDown` lo retiene; con teclado no se podía elegir ninguna zona.
     * `relatedTarget` dice a dónde fue el foco: si sigue adentro, no se cierra.
     */
    <div
      ref={rootRef}
      className="relative"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <Input
        id={id}
        type="text"
        autoComplete="off"
        aria-controls={showSuggestions ? listId : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape cierra las sugerencias sin sacar el foco del campo.
          if (e.key === "Escape" && showSuggestions) {
            e.preventDefault();
            setFocused(false);
          }
        }}
        {...aria}
      />
      {/*
       * Lista simple de botones y NO un `combobox`/`listbox`/`option`. El rol de
       * combobox le promete al lector de pantalla navegación con flechas y
       * `aria-activedescendant`, que nunca estuvieron implementados; y un
       * `role="option"` no puede contener un `<button>` adentro. Prometer menos
       * y cumplirlo se navega mejor que prometer un patrón a medias.
       */}
      <ul
        id={listId}
        aria-label="Zonas sugeridas"
        className={cn(
          "mt-2 flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface shadow-sm",
          !showSuggestions && "hidden",
        )}
      >
        {suggestions.map((zone) => (
          <li key={zone}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(zone)}
              className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
            >
              <MapPin
                size={16}
                aria-hidden="true"
                className="shrink-0 text-foreground-muted"
              />
              {zone}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

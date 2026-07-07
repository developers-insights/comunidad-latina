"use client";

import { useId, useMemo, useState } from "react";
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

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Delay para que el mousedown de una sugerencia llegue antes del blur.
          window.setTimeout(() => setFocused(false), 120);
        }}
        {...aria}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Zonas sugeridas"
        className={cn(
          "mt-2 flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface shadow-sm",
          !showSuggestions && "hidden",
        )}
      >
        {suggestions.map((zone) => (
          <li key={zone} role="option" aria-selected={false}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(zone);
                setFocused(false);
              }}
              className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-subtle"
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

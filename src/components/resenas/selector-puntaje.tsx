"use client";

import { useId, useState } from "react";
import { Star } from "@phosphor-icons/react/dist/ssr";
import { PUNTAJES, RESENAS_COPY as C } from "@/lib/resenas";
import { cn } from "@/lib/utils";

export interface SelectorPuntajeProps {
  name: string;
  /** Puntaje inicial (editar una reseña ya dejada). 0 = ninguno. */
  defaultValue?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Selector de estrellas 1–5.
 *
 * ── POR QUÉ SON RADIOS DE VERDAD Y NO BOTONES ───────────────────────────────
 * La versión de Colaboraciones usa `<button role="radio">`, y eso obliga a
 * reimplementar a mano lo que el navegador ya hace: flechas para moverse, un
 * solo tab-stop para el grupo, y el anuncio "3 estrellas, radio button, 3 de 5".
 * Reimplementarlo es fácil de hacer mal y nadie lo prueba con lector de pantalla.
 * Con `<input type="radio">` dentro de un `<fieldset>` sale gratis y correcto:
 *
 *   · Tab entra al grupo, las flechas cambian el puntaje, Espacio confirma.
 *   · El `<legend>` es la pregunta; cada label dice "3 estrellas · Más o menos".
 *   · El input está `sr-only`, NO `display:none` — si desaparece del árbol de
 *     accesibilidad, deja de ser navegable, que es justo lo que queríamos evitar.
 *   · El foco se ve sobre la estrella con `peer-focus-visible`, así que el anillo
 *     acompaña al control real.
 *
 * El estado local existe sólo para pintar el relleno; el valor que se envía es
 * el del radio, así que el formulario funciona igual si el JS no llegó a cargar.
 */
export function SelectorPuntaje({
  name,
  defaultValue = 0,
  disabled = false,
  className,
}: SelectorPuntajeProps) {
  const grupoId = useId();
  const [elegido, setElegido] = useState(defaultValue);
  // El hover pinta hacia adelante, pero sólo con mouse: en touch no existe y en
  // teclado el que manda es el foco, que ya mueve `elegido`.
  const [encima, setEncima] = useState(0);
  const activo = encima || elegido;

  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className="mb-1.5 text-sm font-semibold text-foreground">{C.puntajeLabel}</legend>

      <div className="flex items-center gap-1" onMouseLeave={() => setEncima(0)}>
        {PUNTAJES.map((valor) => {
          const id = `${grupoId}-${valor}`;
          const lleno = valor <= activo;
          return (
            <div key={valor} className="relative flex">
              <input
                type="radio"
                id={id}
                name={name}
                value={valor}
                defaultChecked={valor === defaultValue}
                onChange={() => setElegido(valor)}
                onFocus={() => setElegido(valor)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                onMouseEnter={() => setEncima(valor)}
                className={cn(
                  "touch-hitbox flex cursor-pointer items-center rounded-sm p-1",
                  "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                  "active:scale-90 hover:scale-105",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                )}
              >
                {/* El texto va oculto y no es decorativo: es lo que anuncia el
                    lector de pantalla al recorrer el grupo con las flechas. */}
                <span className="sr-only">
                  {C.puntajeAria(valor)} · {C.puntajePalabra[valor]}
                </span>
                <Star
                  size={34}
                  weight={lleno ? "fill" : "regular"}
                  aria-hidden="true"
                  className={cn(
                    "transition-colors duration-(--duration-fast)",
                    lleno ? "text-warning" : "text-border",
                  )}
                />
              </label>
            </div>
          );
        })}
      </div>

      {/* La palabra del puntaje elegido. `aria-live` en polite porque cambia con
          las flechas y no puede interrumpir la lectura del grupo. */}
      <p aria-live="polite" className="mt-1 min-h-5 text-sm font-medium text-foreground-secondary">
        {elegido > 0 ? C.puntajePalabra[elegido] : ""}
      </p>
    </fieldset>
  );
}

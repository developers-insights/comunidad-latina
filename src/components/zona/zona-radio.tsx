"use client";

import { useState, useTransition } from "react";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { elegirRadio } from "@/lib/zona/actions";
import { RADIO_DEFAULT, RADIOS_MILLAS, ZONA_COPY as C, type RadioMillas } from "@/lib/zona";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * "¿HASTA QUÉ DISTANCIA?" — el radio en millas
 * =============================================================================
 *
 * Pedido del cliente: «un botón al lado donde se puede filtrar por la cantidad
 * de millas a la redonda que la persona le gustaría ver — como standard ponemos
 * un mínimo de 25 millas a la redonda».
 *
 * ── POR QUÉ ESCALONES Y NO UN DESLIZADOR ────────────────────────────────────
 * En un teléfono, apuntar a "37 millas" con el pulgar es un ejercicio de
 * puntería, y 37 no significa nada distinto de 35 ó 40. Cinco escalones entran
 * en una fila, se tocan sin errar y se leen de un vistazo. Además un deslizador
 * necesita gesto de arrastre, que compite con el scroll de la hoja.
 *
 * ── POR QUÉ VIVE ADENTRO DE LA HOJA Y NO AL LADO DEL BOTÓN DEL HEADER ───────
 * El cliente lo pidió "al lado", y en el header no hay lado: `zona-selector`
 * documenta que a 375px ya van cuatro controles y «no entra un quinto». Meterlo
 * ahí obligaría a encoger el nombre del barrio, que es la información que la
 * persona necesita ver sin abrir nada.
 *
 * Está "al lado" en el único sentido que importa: es lo primero que aparece
 * debajo de la zona elegida, en la misma hoja, sin un toque de más. Y ahí es
 * MEJOR que en el header, porque acá se puede nombrar la zona ("a la redonda de
 * Corona") — un control suelto arriba diría "25 millas" alrededor de nada.
 *
 * ── POR QUÉ NO SE RENDERIZA SIN ZONA ────────────────────────────────────────
 * Un radio alrededor de "toda la comunidad" no quiere decir nada. Mostrarlo
 * deshabilitado sería un control muerto que hay que explicar; no mostrarlo hace
 * que la hoja tenga siempre exactamente los controles que sirven. Cuando la
 * persona elige una zona, la hoja se rerenderiza y aparece.
 */

export interface ZonaRadioProps {
  /** La zona activa. Sin zona este control no se muestra (ver el docblock). */
  zona: string;
  /** El radio guardado, o `null` si nunca lo tocó / lo apagó. */
  radioActivo: RadioMillas | null;
  /**
   * Se llama cuando el cambio YA quedó guardado.
   *
   * El valor vive en la hoja y no acá: `revalidatePath` refresca el servidor,
   * pero la hoja está abierta con su propio estado y sin este aviso el tilde
   * seguiría en la cápsula vieja hasta cerrarla y volverla a abrir.
   */
  onCambiado: (millas: RadioMillas | null) => void;
  /** `true` mientras otra parte de la hoja está escribiendo una preferencia. */
  deshabilitada: boolean;
}

/** Marca del pendiente cuando lo elegido es "solo mi zona" (no hay número). */
const PENDIENTE_SOLO = -1;

export function ZonaRadio({
  zona,
  radioActivo,
  onCambiado,
  deshabilitada,
}: ZonaRadioProps) {
  const [pendiente, setPendiente] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function elegir(millas: RadioMillas | null) {
    // Ya estás viendo eso: no se gasta un round-trip para no cambiar nada.
    if (millas === radioActivo) return;
    setPendiente(millas ?? PENDIENTE_SOLO);
    startTransition(async () => {
      const resultado = await elegirRadio({ millas });
      setPendiente(null);
      if (!resultado.ok) {
        toast({ title: resultado.mensaje, variant: "danger" });
        return;
      }
      onCambiado(resultado.millas);
      toast({
        title:
          resultado.millas === null
            ? C.toast.radioSolo(zona)
            : C.toast.radio(resultado.millas, zona),
      });
    });
  }

  const bloqueado = deshabilitada || pendiente !== null;

  return (
    <section aria-labelledby="zona-radio-titulo" className="mb-4">
      <h3 id="zona-radio-titulo" className="text-sm font-semibold text-foreground">
        {C.radio.titulo}
      </h3>
      <p className="mb-2 text-xs leading-relaxed text-foreground-secondary">
        {C.radio.ayuda(zona)}
      </p>

      {/*
        `radiogroup` y no una lista de botones sueltos: son opciones mutuamente
        excluyentes de una misma pregunta, y así el lector de pantalla anuncia
        "2 de 6" en vez de leer seis botones sin relación entre sí.

        `overflow-x-auto` con `-mx-1 px-1`: los chips scrollean dentro de SU
        fila. Sin eso, seis cápsulas a 375px empujan el ancho de la hoja y
        aparece scroll horizontal en toda la página — la regla que este repo ya
        respeta en el header.
      */}
      <div
        role="radiogroup"
        aria-labelledby="zona-radio-titulo"
        className={cn(
          "-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <ChipRadio
          etiqueta={C.radio.soloZona}
          ariaLabel={C.radio.soloZonaLabel}
          activa={radioActivo === null}
          cargando={pendiente === PENDIENTE_SOLO}
          deshabilitada={bloqueado}
          onClick={() => elegir(null)}
        />

        {RADIOS_MILLAS.map((millas) => (
          <ChipRadio
            key={millas}
            etiqueta={C.radio.millas(millas)}
            ariaLabel={C.radio.millasLabel(millas, zona)}
            activa={radioActivo === millas}
            cargando={pendiente === millas}
            deshabilitada={bloqueado}
            /*
              La marca de "recomendado" aparece SÓLO mientras nadie eligió nada.
              Una vez que la persona decidió, seguir señalando otra opción como
              la buena es discutirle su elección.
            */
            recomendada={radioActivo === null && millas === RADIO_DEFAULT}
            onClick={() => elegir(millas)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Una cápsula del grupo.
 *
 * `min-h-11` (44px) aunque el texto sea chico: es el mínimo táctil, y estos son
 * los controles más chicos de la hoja. `shrink-0` porque el contenedor
 * scrollea — sin eso, seis chips se aplastan hasta ser ilegibles en vez de
 * desbordar.
 */
function ChipRadio({
  etiqueta,
  ariaLabel,
  activa,
  cargando,
  deshabilitada,
  recomendada,
  onClick,
}: {
  etiqueta: string;
  ariaLabel: string;
  activa: boolean;
  cargando: boolean;
  deshabilitada: boolean;
  recomendada?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      aria-label={ariaLabel}
      disabled={deshabilitada}
      onClick={onClick}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap",
        "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        /*
          Tinte + tinta de marca, y NO un relleno saturado con
          `text-brand-foreground`. Dos motivos, los dos buenos:

           · es el mismo par que ya usa el estado elegido en el resto de la app
             (`community-switcher`, `global-subnav`, `metrics-filters`) y el que
             usa `FilaZona` acá abajo. Una hoja donde lo elegido se pinta de dos
             maneras distintas según el control se lee como dos features.
           · `text-brand-foreground` es tinta CLARA por definición: existe para
             leerse sobre un relleno saturado, y el navegador no imprime
             `background-color`. En papel quedaría en 1.00:1. Ver el contrato de
             `src/test/print-contract.test.ts`.
        */
        activa
          ? "border-brand-subtle bg-brand-tint font-semibold text-brand-ink"
          : "border-transparent bg-surface-subtle text-foreground-secondary hover:bg-surface-hover",
        cargando && "opacity-70",
      )}
    >
      {/*
        El tilde aparece ADEMÁS del relleno, no en vez de él: el color solo no
        puede ser lo único que dice cuál está elegida (regla del sistema, y de
        cualquiera que mire la pantalla al sol).
      */}
      {activa && <Check size={14} weight="bold" aria-hidden="true" />}
      {etiqueta}
      {recomendada && (
        <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-ink uppercase">
          {C.radio.recomendado}
        </span>
      )}
    </button>
  );
}

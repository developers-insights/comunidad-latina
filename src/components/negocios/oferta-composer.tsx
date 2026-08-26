"use client";

import { CaretDown, Check, Ticket } from "@phosphor-icons/react/dist/ssr";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  MAX_CUPON,
  MAX_TERMINOS_OFERTA,
  MAX_TITULO_OFERTA,
  OFERTA_TIPOS,
  OFERTA_TIPO_AYUDA,
  type OfertaBorrador,
  type OfertaTipo,
  type OfertaValorTipo,
} from "@/lib/negocios/oferta-alta";
import { OFERTA_TIPO_LABEL } from "@/lib/negocios/ofertas-modelo";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * "ESTO ES UNA OFERTA" — el bloque que enciende la pestaña Ofertas
 * =============================================================================
 *
 * Spec del cliente, tabla de distribución: «Descuento o promoción comercial →
 * Negocios → Ofertas». Hasta acá `post_offers` (0106) existía con su RLS, su
 * índice de vigencia y su panel de lectura, y NADA la escribía: la pestaña
 * nacía vacía por construcción.
 *
 * ── POR QUÉ VIVE DENTRO DEL COMPOSER Y NO EN UN FORMULARIO APARTE ───────────
 * Porque la oferta NO es una publicación paralela — es la misma publicación con
 * condiciones comerciales colgadas (el encabezado de la 0106 explica por qué se
 * eligió una tabla satélite en vez de una tabla `offers` propia). Un formulario
 * "Publicar oferta" separado obligaría a elegir entre que la promo esté en el
 * feed o que esté en Ofertas, que es exactamente lo que el cliente pidió que no
 * pasara: «una sola publicación dentro de la base de datos».
 *
 * ── SÓLO APARECE PUBLICANDO COMO NEGOCIO ────────────────────────────────────
 * Y no es una decisión de pintura: la policy `post_offers_insert` exige
 * `app.can_manage_listing` sobre la ficha del post, así que una oferta firmada
 * con el perfil personal la rechazaría la base. Quien decide si montar este
 * bloque es el composer, que es el único que sabe qué firma está elegida.
 *
 * ── CERRADO POR DEFECTO ─────────────────────────────────────────────────────
 * La enorme mayoría de las publicaciones de un negocio no son ofertas. El
 * `<details>` cerrado deja el composer igual que siempre para quien sólo quiere
 * publicar una foto del local, y es el mismo patrón que ya usan la declaración
 * de originalidad y la categoría de video en esta misma hoja.
 */

const COPY = {
  titulo: "Es una oferta",
  ayuda: "Descuentos, cupones, promos, menús y paquetes con fecha de vencimiento",
  activa: "Va a aparecer en Negocios › Ofertas",
  tipoLabel: "Qué tipo de oferta es",
  tituloLabel: "Título de la oferta",
  tituloPlaceholder: "Ej.: 2x1 en empanadas",
  tituloHelp: "Es lo que se lee grande en la tarjeta.",
  valorLegend: "Descuento",
  valorNinguno: "Sin número",
  valorNingunoHint: "Un menú o paquete puede no tener porcentaje",
  valorPorcentaje: "Porcentaje",
  valorMonto: "Monto fijo",
  valorLabel: "Cuánto",
  valorPlaceholderPorcentaje: "Ej.: 20",
  valorPlaceholderMonto: "Ej.: 5",
  cuponLabel: "Código del cupón",
  cuponPlaceholder: "Ej.: VERANO26",
  cuponHelp: "Dejalo vacío si no hace falta código.",
  venceLabel: "Vale hasta el",
  venceHelp: "La oferta vale todo ese día.",
  terminosLabel: "Condiciones",
  terminosPlaceholder: "Ej.: no acumulable, hasta agotar stock, sólo para llevar",
} as const;

export interface OfertaComposerProps {
  /** `null` = esta publicación no es una oferta (el bloque está apagado). */
  value: OfertaBorrador | null;
  onChange: (next: OfertaBorrador | null) => void;
  /** El primer día que se puede elegir, `YYYY-MM-DD` en la zona de la comunidad. */
  hoy: string;
  /** Mensaje del último intento de publicar, si esta parte fue la que falló. */
  error?: string;
  disabled?: boolean;
}

export function OfertaComposer({
  value,
  onChange,
  hoy,
  error,
  disabled = false,
}: OfertaComposerProps) {
  const activa = value !== null;

  const set = (cambios: Partial<OfertaBorrador>) => {
    if (!value) return;
    onChange({ ...value, ...cambios });
  };

  /**
   * El interruptor de "sin número / porcentaje / monto". Apagarlo borra TAMBIÉN
   * el valor: dejar el número escondido detrás de un radio apagado es la forma
   * de que la base reciba un `valor` sin `valor_tipo` y rebote el CHECK.
   */
  const setValorTipo = (siguiente: OfertaValorTipo | null) => {
    if (!value) return;
    onChange(
      siguiente === null
        ? { ...value, valorTipo: null, valor: null }
        : { ...value, valorTipo: siguiente },
    );
  };

  return (
    <details
      className="group mt-3 shrink-0 rounded-lg border border-border-subtle bg-surface-subtle"
      open={activa}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-lg p-4",
          "[&::-webkit-details-marker]:hidden",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <Ticket
          size={18}
          weight="fill"
          aria-hidden="true"
          className={cn("mt-0.5 shrink-0", activa ? "text-brand" : "text-foreground-muted")}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{COPY.titulo}</span>
          <span
            className={cn(
              "mt-0.5 flex items-start gap-1.5 text-xs leading-relaxed",
              activa ? "text-foreground-secondary" : "text-foreground-muted",
            )}
          >
            {activa && (
              <Check
                size={14}
                weight="bold"
                aria-hidden="true"
                className="mt-px shrink-0 text-success"
              />
            )}
            {activa ? COPY.activa : COPY.ayuda}
          </span>
        </span>
        <CaretDown
          size={16}
          aria-hidden="true"
          className={cn(
            "mt-1 shrink-0 text-foreground-muted",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-open:rotate-180",
          )}
        />
      </summary>

      <fieldset disabled={disabled} className="m-0 border-0 px-4 pb-4 pt-0">
        {/* El interruptor real. Un `role="switch"` de 44px, como el de la
            encuesta: prender "es una oferta" y desplegar el bloque son dos
            gestos distintos, y confundirlos haría que abrir el acordeón para
            mirar convierta la publicación en oferta sin que nadie lo pidiera. */}
        <button
          type="button"
          role="switch"
          aria-checked={activa}
          onClick={() => onChange(activa ? null : ofertaConFecha(hoy))}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-lg border p-3 text-left",
            "transition-[background-color,border-color] duration-(--duration-fast)",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-45",
            activa ? "border-brand bg-brand/8" : "border-border bg-surface",
          )}
        >
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
            {COPY.titulo}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5",
              "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
              activa ? "bg-brand" : "bg-border",
            )}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full bg-surface shadow-xs",
                "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                activa ? "translate-x-5" : "translate-x-0",
              )}
            >
              {activa && <Check size={13} weight="bold" className="text-brand" />}
            </span>
          </span>
        </button>

        {value && (
          <div className="mt-3 flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-xs font-medium text-danger">
                {error}
              </p>
            )}

            <Field htmlFor="oferta-tipo" label={COPY.tipoLabel}>
              <Select
                id="oferta-tipo"
                value={value.tipo}
                onChange={(event) => set({ tipo: event.target.value as OfertaTipo })}
              >
                {OFERTA_TIPOS.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {OFERTA_TIPO_LABEL[tipo]} — {OFERTA_TIPO_AYUDA[tipo]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field htmlFor="oferta-titulo" label={COPY.tituloLabel} help={COPY.tituloHelp}>
              <Input
                id="oferta-titulo"
                value={value.titulo}
                maxLength={MAX_TITULO_OFERTA}
                placeholder={COPY.tituloPlaceholder}
                onChange={(event) => set({ titulo: event.target.value })}
              />
            </Field>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1.5 text-sm font-medium text-foreground">
                {COPY.valorLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    [null, COPY.valorNinguno],
                    ["porcentaje", COPY.valorPorcentaje],
                    ["monto", COPY.valorMonto],
                  ] as const
                ).map(([opcion, etiqueta]) => {
                  const elegida = value.valorTipo === opcion;
                  return (
                    <label
                      key={etiqueta}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm",
                        "transition-colors duration-(--duration-fast)",
                        "focus-within:ring-[3px] focus-within:ring-focus-ring",
                        elegida
                          ? "border-brand bg-brand/8 font-semibold text-foreground"
                          : "border-border bg-surface text-foreground-secondary",
                      )}
                    >
                      <input
                        type="radio"
                        name="oferta-valor-tipo"
                        className="sr-only"
                        checked={elegida}
                        onChange={() => setValorTipo(opcion)}
                      />
                      {etiqueta}
                    </label>
                  );
                })}
              </div>
              {value.valorTipo === null && (
                <p className="mt-1.5 text-xs text-foreground-muted">{COPY.valorNingunoHint}</p>
              )}
            </fieldset>

            {value.valorTipo !== null && (
              <Field htmlFor="oferta-valor" label={COPY.valorLabel}>
                <Input
                  id="oferta-valor"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  max={value.valorTipo === "porcentaje" ? 100 : undefined}
                  value={value.valor ?? ""}
                  placeholder={
                    value.valorTipo === "porcentaje"
                      ? COPY.valorPlaceholderPorcentaje
                      : COPY.valorPlaceholderMonto
                  }
                  onChange={(event) => {
                    const crudo = event.target.value;
                    set({ valor: crudo === "" ? null : Number(crudo) });
                  }}
                />
              </Field>
            )}

            <Field
              htmlFor="oferta-cupon"
              label={COPY.cuponLabel}
              help={COPY.cuponHelp}
              optional
            >
              <Input
                id="oferta-cupon"
                value={value.codigoCupon ?? ""}
                maxLength={MAX_CUPON}
                placeholder={COPY.cuponPlaceholder}
                autoCapitalize="characters"
                onChange={(event) => set({ codigoCupon: event.target.value })}
              />
            </Field>

            <Field htmlFor="oferta-vence" label={COPY.venceLabel} help={COPY.venceHelp}>
              <Input
                id="oferta-vence"
                type="date"
                min={hoy}
                value={value.vence}
                onChange={(event) => set({ vence: event.target.value })}
              />
            </Field>

            <Field
              htmlFor="oferta-terminos"
              label={COPY.terminosLabel}
              optional
            >
              <Textarea
                id="oferta-terminos"
                rows={2}
                maxLength={MAX_TERMINOS_OFERTA}
                value={value.terminos ?? ""}
                placeholder={COPY.terminosPlaceholder}
                onChange={(event) => set({ terminos: event.target.value })}
              />
            </Field>
          </div>
        )}
      </fieldset>
    </details>
  );
}

/**
 * El borrador con el que arranca alguien que recién prende el interruptor: una
 * semana de vigencia, que es el plazo más común de una promo de barrio y el que
 * evita que la fecha nazca vacía y bloquee Publicar sin decir por qué.
 */
export function ofertaConFecha(hoy: string): OfertaBorrador {
  const enUnaSemana = new Date(Date.parse(`${hoy}T00:00:00Z`) + 7 * 86_400_000);
  const vence = Number.isFinite(enUnaSemana.getTime())
    ? enUnaSemana.toISOString().slice(0, 10)
    : hoy;
  return {
    tipo: "descuento",
    titulo: "",
    valorTipo: null,
    valor: null,
    codigoCupon: null,
    vence,
    terminos: null,
  };
}

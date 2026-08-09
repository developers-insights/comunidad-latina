"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DECLARATION_COPY,
  LICENSE_OPTIONS,
  type LicenseKind,
} from "@/lib/integrity/declarations";

/**
 * =============================================================================
 * DECLARACIÓN DE ORIGINALIDAD Y LICENCIAS — el bloque del formulario
 * =============================================================================
 *
 * VA DENTRO DEL FORMULARIO, NO EN UN MODAL. Un modal de "aceptá los términos"
 * se cierra sin leer; una casilla al lado de las fotos se lee porque está donde
 * la persona ya está mirando. Además un modal separado obligaría a decidir qué
 * pasa si lo cancelás, y la respuesta honesta ("publicás igual, pero sin
 * declarar") es peor experiencia que no tener modal.
 *
 * NADA ACÁ ES OBLIGATORIO. No declarar es una opción legítima y con salida
 * digna ("Prefiero no aclararlo ahora"): lo único que cambia es que el equipo
 * de moderación ve una alerta suave de licencia faltante. Bloquear la
 * publicación por no marcar un tilde convertiría la declaración en un trámite
 * que todo el mundo miente para pasar — y una declaración mentida vale menos
 * que ninguna.
 *
 * IMPORTA: `@/lib/integrity/declarations` se importa por RUTA DIRECTA y no
 * desde el barril `@/lib/integrity`, que re-exporta módulos `server-only`. Un
 * client component que importe el barril rompe el build.
 *
 * ⚠️ El copy dice "esto es lo que nos contás vos: no lo verificamos". Esa línea
 * NO es opcional ni suavizable: es el mismo criterio legal que el verificador
 * (§11 del plan). Una declaración del usuario jamás puede mostrarse como algo
 * que la plataforma comprobó.
 */

export interface DeclarationValue {
  originalityDeclared: boolean;
  licenseKind: LicenseKind;
  licenseStatement: string;
  licenseUrl: string;
}

/** Estado inicial: nadie declaró nada, y `desconocido` NO significa "es propio". */
export const EMPTY_DECLARATION_VALUE: DeclarationValue = {
  originalityDeclared: false,
  licenseKind: "desconocido",
  licenseStatement: "",
  licenseUrl: "",
};

export interface OriginalityFieldsProps {
  value: DeclarationValue;
  onChange: (next: DeclarationValue) => void;
  /** Prefijo de los `id` — dos formularios en la misma página no chocan. */
  idPrefix?: string;
  /**
   * Encabezado propio del bloque. `null` lo apaga: en el composer del feed el
   * bloque vive dentro de un `<details>` y el `<summary>` YA lo nombra. Repetir
   * el título ahí adentro sería anunciarlo dos veces al lector de pantalla y
   * meter un `<h2>` dentro de otro `<h2>` (el de la hoja).
   */
  title?: string | null;
  /** Línea de contexto bajo el encabezado. Sirve también sin encabezado. */
  intro?: string;
  className?: string;
}

export function OriginalityFields({
  value,
  onChange,
  idPrefix = "declaracion",
  title = DECLARATION_COPY.sectionTitle,
  intro = DECLARATION_COPY.sectionIntro,
  className,
}: OriginalityFieldsProps) {
  const checkboxId = `${idPrefix}-originalidad`;
  const licenseId = `${idPrefix}-licencia`;
  const statementId = `${idPrefix}-aclaracion`;
  const urlId = `${idPrefix}-link`;

  function patch(next: Partial<DeclarationValue>) {
    onChange({ ...value, ...next });
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-subtle p-4",
        className,
      )}
      aria-labelledby={title ? `${idPrefix}-title` : undefined}
    >
      <div>
        {title && (
          <h2 id={`${idPrefix}-title`} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
        )}
        {intro && (
          <p className={cn("text-sm text-foreground-secondary", title && "mt-0.5")}>{intro}</p>
        )}
      </div>

      {/* Casilla nativa: el área táctil llega a 44px por el padding de la label
          entera, no agrandando el cuadradito (que se vería mal alineado). */}
      <label
        htmlFor={checkboxId}
        className="flex min-h-11 cursor-pointer items-start gap-3 py-1"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={value.originalityDeclared}
          onChange={(event) => {
            const checked = event.target.checked;
            // Marcar la casilla mueve la licencia a "es material mío" sólo si
            // todavía estaba en el default. Si la persona ya eligió algo
            // (ej.: "tengo permiso"), su elección manda — el tilde no la pisa.
            patch({
              originalityDeclared: checked,
              licenseKind:
                checked && value.licenseKind === "desconocido" ? "propio" : value.licenseKind,
            });
          }}
          className={cn(
            "mt-0.5 size-5 shrink-0 rounded-[6px] border border-border accent-brand",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {DECLARATION_COPY.originalityLabel}
          </span>
          <span className="text-sm text-foreground-muted">
            {DECLARATION_COPY.originalityHint}
          </span>
        </span>
      </label>

      <Field htmlFor={licenseId} label={DECLARATION_COPY.licenseLabel}>
        <Select
          id={licenseId}
          value={value.licenseKind}
          onChange={(event) => patch({ licenseKind: event.target.value as LicenseKind })}
        >
          {LICENSE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor={statementId} label={DECLARATION_COPY.licenseStatementLabel} optional>
        <Textarea
          id={statementId}
          rows={2}
          maxLength={500}
          value={value.licenseStatement}
          placeholder={DECLARATION_COPY.licenseStatementPlaceholder}
          onChange={(event) => patch({ licenseStatement: event.target.value })}
        />
      </Field>

      <Field htmlFor={urlId} label={DECLARATION_COPY.licenseUrlLabel} optional>
        <Input
          id={urlId}
          type="url"
          inputMode="url"
          maxLength={500}
          value={value.licenseUrl}
          placeholder={DECLARATION_COPY.licenseUrlPlaceholder}
          onChange={(event) => patch({ licenseUrl: event.target.value })}
        />
      </Field>

      <p className="text-xs leading-relaxed text-foreground-muted">
        {DECLARATION_COPY.disclaimer}
      </p>
    </section>
  );
}

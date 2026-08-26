import type { Icon } from "@phosphor-icons/react";
import { BezelCard } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * FICHA DE DATOS DE UN AVISO — "esto es lo que declaró quien publicó"
 * =============================================================================
 *
 * Nació de una costura concreta: los formularios de Propiedades, Eventos y
 * Empleos ya capturan un montón de datos —depósito, servicios incluidos,
 * requisitos, capacidad, público, días de trabajo, experiencia— y ninguna de
 * las tres pantallas de detalle mostraba NADA de eso. Datos que la gente carga
 * y nadie ve son peor que datos que no existen: quien publica cree que ya lo
 * dijo y deja de contestarlo por chat.
 *
 * Los tres verticales necesitaban exactamente el mismo bloque, así que en vez
 * de tres listas de definiciones parecidas-pero-no-iguales hay una sola acá.
 *
 * ── POR QUÉ `<dl>` Y NO UNA GRILLA DE `<div>` ───────────────────────────────
 * Es literalmente una lista de definiciones: "Depósito → US$ 800". Con
 * `dl/dt/dd` un lector de pantalla anuncia el par completo; con divs anuncia
 * dos textos sueltos y la persona tiene que adivinar cuál explica a cuál.
 *
 * ── EL ÍCONO NUNCA ES EL DATO ───────────────────────────────────────────────
 * Va `aria-hidden` y siempre acompañado del rótulo escrito. Un ícono de llave
 * al lado de un número no dice "depósito" para nadie que no lo esté mirando —
 * y tampoco para quien lo mira y no conoce la convención.
 *
 * Componente PRESENTACIONAL y de servidor: sin estado, sin `"use client"`.
 * Quien lo monta decide qué filas existen; acá no se inventa ninguna. Una
 * ficha sin filas no renderiza la sección entera (ver el `return null`): una
 * cabecera "Condiciones" sobre una card vacía es peor que no tener la sección.
 */

export interface DetailFact {
  /** Clave estable de React — el slug del dato, no el índice del array. */
  id: string;
  icon: Icon;
  /** Rótulo corto, en español y sin dos puntos: "Depósito", "Cupo". */
  label: string;
  /** El dato ya formateado. Acepta nodos para poder listar chips. */
  value: React.ReactNode;
  /** Aclaración opcional bajo el dato ("US$ 0 = no pide depósito"). */
  hint?: string;
}

export interface DetailFactsProps {
  /** Título de la sección. Mismo tratamiento que el resto de los detalles. */
  title: string;
  facts: readonly DetailFact[];
  /** Nota al pie de la card, para lo que aplica a TODAS las filas. */
  footnote?: string;
  className?: string;
}

export function DetailFacts({ title, facts, footnote, className }: DetailFactsProps) {
  if (facts.length === 0) return null;

  return (
    <section className={cn("mt-6", className)}>
      <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">{title}</h2>
      <BezelCard coreClassName="p-4">
        <dl className="flex flex-col gap-3.5">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div key={fact.id} className="flex items-start gap-3">
                <Icon
                  size={20}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-foreground-muted"
                />
                <div className="min-w-0 flex-1">
                  <dt className="text-xs font-medium text-foreground-secondary">{fact.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-foreground">{fact.value}</dd>
                  {fact.hint && (
                    <p className="mt-0.5 text-xs text-foreground-muted">{fact.hint}</p>
                  )}
                </div>
              </div>
            );
          })}
        </dl>
        {footnote && <p className="mt-3.5 text-xs text-foreground-muted">{footnote}</p>}
      </BezelCard>
    </section>
  );
}

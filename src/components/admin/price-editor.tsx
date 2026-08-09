"use client";

import { useActionState, useId, useState } from "react";
import { CheckCircle, Info } from "@phosphor-icons/react/dist/ssr";
import { Badge, Field, Input } from "@/components/ui";
import {
  PRODUCT_COPY,
  PRODUCT_ORDER,
  centsToInput,
  formatCents,
  slotKey,
  type PriceProduct,
  type ResolvedPrice,
} from "@/lib/pricing";
import {
  saveTenantPrice,
  type PriceActionState,
} from "@/app/admin/global/precios/actions";
import { PendingButton } from "./pending-button";

/**
 * EDITOR DE PRECIOS POR COMUNIDAD.
 *
 * Una fila = un precio = un formulario propio. Podría ser un solo form con las
 * 14 casillas y un único "Guardar", y sería peor: un guardado masivo hace que
 * un error de tipeo en una casilla ponga en duda las otras trece, y obliga a
 * decidir qué hacer si tres se guardan y una falla. Acá cada precio se confirma
 * solo, con su propio mensaje, y lo que no se tocó no se toca.
 *
 * QUÉ SE DICE EN VOZ ALTA, Y POR QUÉ
 *  · Un precio que todavía sale de las constantes del código lleva la etiqueta
 *    "Por defecto". No es decoración: "nadie lo decidió todavía" y "alguien lo
 *    fijó en este número" son dos cosas distintas, y en una pantalla de dinero
 *    confundirlas es caro.
 *  · La moneda es un campo, no un supuesto. Se ve y se edita.
 *  · Los montos van en `tabular-nums` para que las columnas de números no
 *    bailen al cambiar de fila (§5 del design system).
 *
 * ACCESIBILIDAD: cada input tiene su `<label>` visible (nunca sólo
 * placeholder), el error sale DEBAJO del campo y en `role="alert"`, el éxito en
 * `role="status"`, y el estado "Por defecto" se distingue por texto y por ícono
 * además de por color.
 */

const COPY = {
  amountLabel: "Precio",
  amountHelp: "Sin símbolo. Usá coma para los centavos: 19,99.",
  currencyLabel: "Moneda",
  save: "Guardar",
  fallbackBadge: "Por defecto",
  fallbackTitle: "Sale de los valores de fábrica",
  configuredTitle: "Fijado para esta comunidad",
  hint: "Los precios se guardan de a uno. Lo que no toques queda como está.",
} as const;

const initialState: PriceActionState = { status: "idle" };

export interface PriceEditorProps {
  tenantId: string;
  tenantName: string;
  prices: readonly ResolvedPrice[];
}

export function PriceEditor({ tenantId, tenantName, prices }: PriceEditorProps) {
  const byProduct = new Map<PriceProduct, ResolvedPrice[]>();
  for (const price of prices) {
    const list = byProduct.get(price.product) ?? [];
    list.push(price);
    byProduct.set(price.product, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs leading-relaxed text-foreground-muted">{COPY.hint}</p>

      {PRODUCT_ORDER.map((product) => {
        const rows = byProduct.get(product);
        if (!rows || rows.length === 0) return null;
        const copy = PRODUCT_COPY[product];

        return (
          <section key={product} className="flex flex-col gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">{copy.label}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
                {copy.blurb}
              </p>
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((price) => (
                <PriceRow
                  key={slotKey(price)}
                  tenantId={tenantId}
                  tenantName={tenantName}
                  price={price}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PriceRow({
  tenantId,
  tenantName,
  price,
}: {
  tenantId: string;
  tenantName: string;
  price: ResolvedPrice;
}) {
  const [state, formAction, pending] = useActionState(saveTenantPrice, initialState);
  const baseId = useId();
  const amountId = `${baseId}-monto`;
  const currencyId = `${baseId}-moneda`;

  // El input arranca con el valor vigente y a partir de ahí lo maneja la
  // persona. No se re-sincroniza con `price` en cada render a propósito: si el
  // servidor revalida mientras alguien está tipeando, pisarle el campo sería
  // borrarle el trabajo a mitad de camino.
  const [amount, setAmount] = useState(() => centsToInput(price.amountCents));
  const [currency, setCurrency] = useState(price.currency);

  const isFallback = price.source === "fallback";
  const invalid = state.status === "invalid";

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{price.label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground-muted">
          {formatCents(price.amountCents, price.currency)}
        </span>
        {isFallback ? (
          <Badge variant="neutral">
            <Info size={12} aria-hidden="true" />
            {COPY.fallbackBadge}
          </Badge>
        ) : (
          <span className="sr-only">{COPY.configuredTitle}</span>
        )}
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="product" value={price.product} />
        <input type="hidden" name="variant" value={price.variant} />
        <input type="hidden" name="interval" value={price.interval} />

        <Field
          htmlFor={amountId}
          label={`${COPY.amountLabel} — ${price.label}`}
          help={COPY.amountHelp}
          className="min-w-40 flex-1"
        >
          <Input
            id={amountId}
            name="amount"
            required
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${amountId}-error` : undefined}
            className="tabular-nums"
          />
        </Field>

        <Field htmlFor={currencyId} label={COPY.currencyLabel} className="w-24">
          <Input
            id={currencyId}
            name="currency"
            required
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            className="uppercase"
          />
        </Field>

        <PendingButton type="submit" variant="secondary" size="sm" loading={pending}>
          {COPY.save}
        </PendingButton>
      </form>

      {(state.status === "invalid" || state.status === "error") && (
        <p id={`${amountId}-error`} role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          <span>
            {state.message} <span className="text-foreground-muted">({tenantName})</span>
          </span>
        </p>
      )}
    </li>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react/dist/ssr";
import {
  BottomSheet,
  Button,
  Field,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DELIVERY_DAYS_MAX,
  DELIVERY_DAYS_MIN,
  DESCRIPTION_MAX,
  MAX_INCLUDES,
  MAX_INCLUDE_LENGTH,
  MAX_PACKAGES,
  TITLE_MAX,
  normalizeIncludes,
  parsePackagePrice,
  type ServicePackage,
} from "@/lib/creators/service-packages";
import { centsToInput } from "@/lib/pricing/money";
import {
  deleteServicePackage,
  reorderServicePackages,
  saveServicePackage,
  setServicePackageActive,
} from "@/app/(app)/creadores/actions";
import { ContactBlockNotice, hasContactInfo } from "./contact-block-notice";
import { contractBreakdown, formatCents } from "./money";
import { COPY } from "./copy";

/**
 * =============================================================================
 * EDITOR DE PAQUETES DE SERVICIO (0102)
 * =============================================================================
 *
 * QUÉ RESUELVE. Hasta acá el creador sólo podía escribir UNA pista de precio en
 * texto libre ("Desde $150 por reel"). Con esto arma ofertas cerradas —nombre,
 * qué se entrega, precio, plazo— que un negocio puede contratar de un toque.
 *
 * LA PLATA SE MUESTRA MIENTRAS SE ESCRIBE, NO AL FINAL. El desglose (precio,
 * comisión, "te queda") se actualiza en vivo debajo del campo de precio. Es la
 * regla que más pesa en esta pantalla: quien pone un precio tiene que ver el
 * neto ANTES de guardarlo, no descubrirlo cuando le liberan el pago. La
 * comisión llega por prop desde el servidor (`getCreatorCommission`, 0087), o
 * sea que es la de ESTA comunidad y no un 20% escrito acá.
 *
 * EL CÁLCULO NO SE REIMPLEMENTA: sale de `contractBreakdown` (./money), que es
 * el mismo módulo que pinta el desglose del contrato ya creado. Si alguna vez
 * difieren el preview y el contrato, es porque alguien tocó dos archivos — no
 * porque haya dos fórmulas.
 *
 * REORDENAR ES CON BOTONES, NO CON DRAG. La lista tiene seis elementos como
 * mucho y la pantalla base es de 375px: arrastrar en un contenedor que ya
 * scrollea es incómodo con el pulgar e inaccesible con teclado o lector de
 * pantalla. Subir/bajar funciona igual en las tres formas de manejar la app.
 *
 * VALIDACIÓN. Lo de acá es cortesía para no hacer escribir de más; la frontera
 * está en las server actions (que reparsean el precio con el único parser de
 * plata del repo) y en los CHECK de la 0102.
 */

export interface ServicePackagesEditorProps {
  initial: ServicePackage[];
  /** Comisión vigente de la comunidad (0087), leída en el servidor. */
  feePct: number;
  currency: string;
  className?: string;
}

interface Draft {
  id: string | null;
  title: string;
  description: string;
  includes: string[];
  price: string;
  deliveryDays: string;
  active: boolean;
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: "",
    description: "",
    includes: [],
    price: "",
    deliveryDays: "7",
    active: true,
  };
}

function draftFrom(pkg: ServicePackage): Draft {
  return {
    id: pkg.id,
    title: pkg.title,
    description: pkg.description,
    includes: [...pkg.includes],
    price: centsToInput(pkg.priceCents),
    deliveryDays: String(pkg.deliveryDays),
    active: pkg.active,
  };
}

export function ServicePackagesEditor({
  initial,
  feePct,
  currency,
  className,
}: ServicePackagesEditorProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [packages, setPackages] = useState<ServicePackage[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [includeDraft, setIncludeDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const atLimit = packages.length >= MAX_PACKAGES;
  const contactBlocked = draft
    ? hasContactInfo(draft.title, draft.description, ...draft.includes)
    : false;

  /** Vista previa del neto: sólo cuando el precio ya es un número válido. */
  const preview = (() => {
    if (!draft) return null;
    const parsed = parsePackagePrice(draft.price);
    if (!parsed.ok) return null;
    return contractBreakdown({
      amountCents: parsed.cents,
      platformFeeCents: null,
      creatorNetCents: null,
      feePct,
      currency,
    });
  })();

  function openNew() {
    if (atLimit) {
      toast({ variant: "warning", title: COPY.packages.limitReached(MAX_PACKAGES) });
      return;
    }
    setError(null);
    setIncludeDraft("");
    setDraft(emptyDraft());
  }

  function openEdit(pkg: ServicePackage) {
    setError(null);
    setIncludeDraft("");
    setDraft(draftFrom(pkg));
  }

  function closeSheet() {
    if (submitting) return;
    setDraft(null);
    setIncludeDraft("");
    setError(null);
  }

  /** Acepta varios renglones de una: pegar una lista separada por comas o saltos. */
  function addIncludes(raw: string) {
    setIncludeDraft("");
    const parts = raw.split(/[,\n]+/);
    setDraft((current) => {
      if (!current) return current;
      const next = normalizeIncludes([...current.includes, ...parts]);
      if (next.length === current.includes.length && parts.some((p) => p.trim())) {
        toast({ variant: "warning", title: `Podés agregar hasta ${MAX_INCLUDES} renglones.` });
      }
      return { ...current, includes: next };
    });
  }

  async function handleSave() {
    if (!draft || contactBlocked) return;

    if (draft.title.trim().length < 3) return setError(COPY.packages.errors.titleShort);
    if (draft.description.trim().length < 10) {
      return setError(COPY.packages.errors.descriptionShort);
    }
    const price = parsePackagePrice(draft.price);
    if (!price.ok) {
      const map = {
        vacio: COPY.packages.errors.priceRequired,
        formato: COPY.packages.errors.priceFormat,
        cero: COPY.packages.errors.priceZero,
        demasiado_grande: COPY.packages.errors.priceTooBig,
      } as const;
      return setError(map[price.reason]);
    }
    const days = Number(draft.deliveryDays);
    if (!Number.isInteger(days) || days < DELIVERY_DAYS_MIN || days > DELIVERY_DAYS_MAX) {
      return setError(COPY.packages.errors.deliveryRequired);
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await saveServicePackage({
        id: draft.id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        includes: draft.includes,
        // El precio viaja como TEXTO: el servidor lo reparsea con el único
        // parser de plata del repo. Mandar centavos ya calculados desde el
        // cliente sería confiar en el cliente para un número que es plata.
        price: draft.price,
        deliveryDays: days,
        active: draft.active,
      });

      if (!result.ok) {
        if (result.needsAuth) {
          router.push("/entrar?next=/creadores/perfil");
          return;
        }
        setError(result.error);
        return;
      }

      const saved: ServicePackage = {
        id: result.id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        includes: normalizeIncludes(draft.includes),
        priceCents: price.cents,
        currency,
        deliveryDays: days,
        active: draft.active,
        sortOrder: draft.id
          ? (packages.find((p) => p.id === draft.id)?.sortOrder ?? packages.length)
          : packages.length,
      };

      setPackages((current) =>
        draft.id
          ? current.map((p) => (p.id === draft.id ? saved : p))
          : [...current, saved],
      );
      setDraft(null);
      setIncludeDraft("");
      toast({ variant: "success", title: COPY.packages.saved });
      router.refresh();
    } catch {
      setError(COPY.packages.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(pkg: ServicePackage) {
    setBusyId(pkg.id);
    // Optimista: el switch se mueve al toque y se revierte si el servidor dice
    // que no. Un toggle que espera al round-trip se siente roto.
    const nextActive = !pkg.active;
    setPackages((current) =>
      current.map((p) => (p.id === pkg.id ? { ...p, active: nextActive } : p)),
    );
    try {
      const result = await setServicePackageActive({ id: pkg.id, active: nextActive });
      if (!result.ok) {
        setPackages((current) =>
          current.map((p) => (p.id === pkg.id ? { ...p, active: pkg.active } : p)),
        );
        toast({ variant: "warning", title: result.error });
      }
    } catch {
      setPackages((current) =>
        current.map((p) => (p.id === pkg.id ? { ...p, active: pkg.active } : p)),
      );
      toast({ variant: "warning", title: COPY.packages.errors.generic });
    } finally {
      setBusyId(null);
      router.refresh();
    }
  }

  async function handleDelete(pkg: ServicePackage) {
    if (!window.confirm(COPY.packages.removeConfirm)) return;
    setBusyId(pkg.id);
    const before = packages;
    setPackages((current) => current.filter((p) => p.id !== pkg.id));
    try {
      const result = await deleteServicePackage({ id: pkg.id });
      if (!result.ok) {
        setPackages(before);
        toast({ variant: "warning", title: result.error });
        return;
      }
      toast({ variant: "success", title: COPY.packages.removed });
      router.refresh();
    } catch {
      setPackages(before);
      toast({ variant: "warning", title: COPY.packages.errors.generic });
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= packages.length) return;

    const before = packages;
    const next = [...packages];
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((p, i) => ({ ...p, sortOrder: i }));
    setPackages(renumbered);

    try {
      const result = await reorderServicePackages({ ids: renumbered.map((p) => p.id) });
      if (!result.ok) {
        setPackages(before);
        toast({ variant: "warning", title: result.error });
        return;
      }
      router.refresh();
    } catch {
      setPackages(before);
      toast({ variant: "warning", title: COPY.packages.errors.generic });
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.packages.editorTitle}
        </h2>
        {packages.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              atLimit ? "font-semibold text-brand-ink" : "text-foreground-muted",
            )}
          >
            {COPY.packages.count(packages.length, MAX_PACKAGES)}
          </span>
        )}
      </div>
      <p className="-mt-2 text-sm text-foreground-muted">{COPY.packages.editorHelp}</p>

      {packages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center">
          <p className="max-w-[36ch] text-sm text-foreground-muted">{COPY.packages.empty}</p>
          <Button variant="secondary" size="md" onClick={openNew}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            {COPY.packages.addFirst}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {packages.map((pkg, index) => (
            <li
              key={pkg.id}
              className={cn(
                "rounded-lg border border-border-subtle bg-surface p-3.5 transition-opacity",
                !pkg.active && "opacity-70",
                busyId === pkg.id && "opacity-50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="font-display text-sm font-bold leading-snug text-foreground">
                      {pkg.title}
                    </h3>
                    {!pkg.active && (
                      <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary">
                        {COPY.packages.inactiveBadge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted">
                    <Clock size={12} aria-hidden="true" />
                    {COPY.packages.deliveryDays(pkg.deliveryDays)}
                  </p>
                </div>
                <p className="numeric shrink-0 font-display text-base font-bold tabular-nums text-brand">
                  {formatCents(pkg.priceCents, pkg.currency)}
                </p>
              </div>

              {pkg.includes.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {pkg.includes.map((item) => (
                    <li
                      key={item}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-foreground-secondary"
                    >
                      <Check size={10} weight="bold" aria-hidden="true" className="text-success" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {/*
                Acciones. Se mantienen a 44px de área táctil con `touch-hitbox`
                del sistema de diseño; en 375px la fila envuelve en vez de
                comprimir los botones a un tamaño que se falla al tocar.
              */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(pkg)}
                  disabled={busyId === pkg.id}
                >
                  <PencilSimple size={14} aria-hidden="true" />
                  {COPY.packages.edit}
                </Button>

                <IconAction
                  label={COPY.packages.moveUp}
                  disabled={index === 0 || busyId !== null}
                  onClick={() => handleMove(index, -1)}
                >
                  <ArrowUp size={14} weight="bold" aria-hidden="true" />
                </IconAction>
                <IconAction
                  label={COPY.packages.moveDown}
                  disabled={index === packages.length - 1 || busyId !== null}
                  onClick={() => handleMove(index, 1)}
                >
                  <ArrowDown size={14} weight="bold" aria-hidden="true" />
                </IconAction>

                <button
                  type="button"
                  role="switch"
                  aria-checked={pkg.active}
                  aria-label={COPY.packages.activeLabel}
                  disabled={busyId === pkg.id}
                  onClick={() => handleToggle(pkg)}
                  className="ml-auto flex items-center gap-2 rounded-full px-1 py-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring disabled:opacity-50"
                >
                  <span className="text-xs font-medium text-foreground-secondary">
                    {COPY.packages.activeLabel}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                      pkg.active ? "bg-brand" : "bg-border",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4 rounded-full bg-surface shadow-xs transition-[left]",
                        pkg.active ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </span>
                </button>

                <IconAction
                  label={COPY.packages.remove}
                  danger
                  disabled={busyId === pkg.id}
                  onClick={() => handleDelete(pkg)}
                >
                  <Trash size={14} aria-hidden="true" />
                </IconAction>
              </div>

              {!pkg.active && (
                <p className="mt-2 text-xs text-foreground-muted">{COPY.packages.inactiveNote}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {packages.length > 0 && (
        <>
          <Button variant="secondary" size="md" className="w-full" onClick={openNew} disabled={atLimit}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            {COPY.packages.add}
          </Button>
          {atLimit && (
            <p className="text-xs text-foreground-muted">
              {COPY.packages.limitReached(MAX_PACKAGES)}
            </p>
          )}
        </>
      )}

      {/* ------------------------------- Formulario ------------------------------ */}
      <BottomSheet
        open={draft !== null}
        onClose={closeSheet}
        title={draft?.id ? COPY.packages.form.editTitle : COPY.packages.form.newTitle}
      >
        {draft && (
          <div className="flex flex-col gap-4 pb-2">
            <Field
              htmlFor="pkg-title"
              label={COPY.packages.form.titleLabel}
              help={COPY.packages.form.titleHelp}
            >
              <Input
                id="pkg-title"
                value={draft.title}
                maxLength={TITLE_MAX}
                placeholder={COPY.packages.form.titlePlaceholder}
                onChange={(event) =>
                  setDraft((current) => current && { ...current, title: event.target.value })
                }
              />
            </Field>

            <Field
              htmlFor="pkg-description"
              label={COPY.packages.form.descriptionLabel}
              help={COPY.packages.form.descriptionHelp}
            >
              <Textarea
                id="pkg-description"
                rows={4}
                value={draft.description}
                maxLength={DESCRIPTION_MAX}
                placeholder={COPY.packages.form.descriptionPlaceholder}
                onChange={(event) =>
                  setDraft((current) => current && { ...current, description: event.target.value })
                }
              />
            </Field>

            <Field
              htmlFor="pkg-includes"
              label={COPY.packages.form.includesLabel}
              help={COPY.packages.form.includesHelp}
              optional
            >
              <div className="flex flex-col gap-2">
                {draft.includes.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {draft.includes.map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 rounded-md bg-surface-subtle px-2.5 py-1.5 text-sm text-foreground-secondary"
                      >
                        <Check size={13} weight="bold" aria-hidden="true" className="shrink-0 text-success" />
                        <span className="min-w-0 flex-1">{item}</span>
                        <button
                          type="button"
                          aria-label={COPY.packages.form.includesRemove(item)}
                          onClick={() =>
                            setDraft(
                              (current) =>
                                current && {
                                  ...current,
                                  includes: current.includes.filter((i) => i !== item),
                                },
                            )
                          }
                          className="touch-hitbox shrink-0 rounded-full text-foreground-muted"
                        >
                          <X size={12} weight="bold" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {draft.includes.length < MAX_INCLUDES && (
                  <Input
                    id="pkg-includes"
                    value={includeDraft}
                    maxLength={MAX_INCLUDE_LENGTH}
                    placeholder={COPY.packages.form.includesPlaceholder}
                    onChange={(event) => setIncludeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addIncludes(includeDraft);
                      } else if (event.key === "Backspace" && includeDraft === "") {
                        setDraft(
                          (current) =>
                            current && { ...current, includes: current.includes.slice(0, -1) },
                        );
                      }
                    }}
                    onBlur={() => addIncludes(includeDraft)}
                  />
                )}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="pkg-price" label={COPY.packages.form.priceLabel}>
                <Input
                  id="pkg-price"
                  inputMode="decimal"
                  value={draft.price}
                  maxLength={12}
                  placeholder={COPY.packages.form.pricePlaceholder}
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, price: event.target.value })
                  }
                  className="numeric"
                />
              </Field>
              <Field htmlFor="pkg-days" label={COPY.packages.form.deliveryLabel}>
                <Input
                  id="pkg-days"
                  type="number"
                  inputMode="numeric"
                  min={DELIVERY_DAYS_MIN}
                  max={DELIVERY_DAYS_MAX}
                  value={draft.deliveryDays}
                  onChange={(event) =>
                    setDraft(
                      (current) => current && { ...current, deliveryDays: event.target.value },
                    )
                  }
                  className="numeric"
                />
              </Field>
            </div>

            {/*
              EL NETO, EN VIVO. Aparece apenas el precio es un número válido y
              se actualiza con cada tecla: es la única forma de que nadie
              publique un precio sin saber cuánto le queda.
            */}
            {preview && (
              <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {COPY.packages.breakdown.title}
                </h3>
                <dl className="flex flex-col gap-1.5">
                  <BreakdownRow label={COPY.packages.breakdown.price} value={preview.amountLabel} />
                  <BreakdownRow
                    label={COPY.packages.breakdown.fee(preview.feePct)}
                    value={`− ${preview.feeLabel}`}
                    muted
                  />
                  <div className="mt-0.5 border-t border-border-subtle pt-2">
                    <BreakdownRow
                      label={COPY.packages.breakdown.net}
                      value={preview.netLabel}
                      strong
                    />
                  </div>
                </dl>
                <p className="text-[11px] leading-relaxed text-foreground-muted">
                  {COPY.packages.breakdown.note}
                </p>
              </div>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={draft.active}
              onClick={() =>
                setDraft((current) => current && { ...current, active: !current.active })
              }
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-foreground">
                {COPY.packages.activeLabel}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                  draft.active ? "bg-brand" : "bg-border",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-surface shadow-xs transition-[left]",
                    draft.active ? "left-[22px]" : "left-0.5",
                  )}
                />
              </span>
            </button>

            <ContactBlockNotice
              text={[draft.title, draft.description, ...draft.includes].join("\n")}
            />

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={submitting}
                disabled={contactBlocked}
                onClick={handleSave}
              >
                {submitting ? COPY.packages.form.saving : COPY.packages.form.save}
              </Button>
              <Button variant="ghost" size="md" className="w-full" onClick={closeSheet}>
                {COPY.packages.form.cancel}
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function IconAction({
  label,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "touch-hitbox flex size-8 items-center justify-center rounded-md border border-border-subtle bg-surface",
        "transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:opacity-40",
        danger
          ? "text-danger hover:border-danger/30 hover:bg-danger-bg"
          : "text-foreground-secondary hover:border-border hover:bg-surface-subtle",
      )}
    >
      {children}
    </button>
  );
}

function BreakdownRow({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className={cn(
          "text-xs",
          strong ? "font-semibold text-foreground" : "text-foreground-secondary",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "numeric shrink-0 tabular-nums",
          strong
            ? "font-display text-lg font-bold text-brand"
            : muted
              ? "text-xs font-medium text-foreground-secondary"
              : "text-sm font-semibold text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

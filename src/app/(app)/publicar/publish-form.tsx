"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CheckCircle,
  Eye,
  House,
  ImageSquare,
  MapPin,
  Megaphone,
  PencilSimple,
  RocketLaunch,
  Storefront,
  Wrench,
  X,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Select,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { cn, DEFAULT_CURRENCY } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Celebration, useCelebration } from "@/components/motion";
import { COPY, formatListingPrice } from "@/components/listings";
import { MONETIZATION_COPY, FREE_MAX_PHOTOS } from "@/lib/monetization";
import { listingViewHref } from "@/lib/monetization/href";
import {
  EMPTY_DECLARATION_VALUE,
  OriginalityFields,
  type DeclarationValue,
} from "@/components/integrity/originality-fields";
import { createListingDraft, finalizeListing } from "./actions";

const C = COPY.publish;
const M = MONETIZATION_COPY;

// Campos específicos de professional/event (módulo DIRECTORIOS) — copy local
// para no tocar el COPY de vivienda.
const DIR_COPY = {
  professional: {
    categoryLabel: "Rubro",
    categoryError: "Elegí un rubro para tu perfil.",
    credentialsLabel: "Credenciales",
    credentialsPlaceholder: "Ej.: Matrícula NY #12345, CPA",
    credentialsHelp:
      "Separalas con comas. Si sos abogado o notario, después podés verificar tu matrícula en el centro de seguridad.",
  },
  event: {
    dateLabel: "Fecha y hora del evento",
    dateError: "Decinos cuándo es el evento.",
  },
  // Preselect por query param (menú crear-post del feed, ?kind=): link discreto
  // para volver al selector sin perder el resto del wizard. Copy local — no
  // toca COPY.publish (vivienda).
  changeType: "Cambiar tipo",
} as const;

const PROFESSIONAL_CATEGORY_OPTIONS = [
  { value: "abogado", label: "Abogado" },
  { value: "contador", label: "Contador" },
  { value: "notario", label: "Notario" },
  { value: "salud", label: "Salud" },
  { value: "educacion", label: "Educación" },
  { value: "otro", label: "Otro" },
] as const;

type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORY_OPTIONS)[number]["value"];

function isProfessionalCategory(value: string): value is ProfessionalCategory {
  return PROFESSIONAL_CATEGORY_OPTIONS.some((option) => option.value === value);
}

export type Kind = "property" | "business" | "professional" | "event" | "job";

const KIND_OPTIONS: Array<{ value: Kind; label: string; Icon: typeof House }> = [
  { value: "property", label: "Vivienda", Icon: House },
  { value: "business", label: "Negocio", Icon: Storefront },
  { value: "professional", label: "Profesional", Icon: Briefcase },
  { value: "event", label: "Evento", Icon: Calendar },
  { value: "job", label: "Trabajo", Icon: Wrench },
];

/**
 * Un aviso NACE gratuito — la policy `listings_insert` (0048) lo exige, y el
 * tier lo mueve el pago, no el formulario. Así que el tope de este wizard es
 * SIEMPRE el de gratis, y sale del módulo de monetización en vez de ser un 6
 * suelto que nadie sabe de dónde salió.
 *
 * El servidor vuelve a contar en `finalizeListing`: acá el número es UX (avisar
 * antes de que alguien elija 12 fotos), allá es el tope de verdad.
 */
const MAX_PHOTOS = FREE_MAX_PHOTOS;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** 0 tipo · 1 texto · 2 precio · 3 zona · 4 fotos · 5 vista previa. */
const STEP_PREVIEW = 5;
const TOTAL_STEPS = 6;

interface PhotoItem {
  file: File;
  previewUrl: string;
}

/** Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original. */
async function preparePhoto(file: File): Promise<{ blob: Blob; ext: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (blob) return { blob, ext: "webp" };
  } catch {
    // Caemos al original.
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  return { blob: file, ext: ["webp", "jpg", "jpeg", "png"].includes(ext) ? ext : "jpg" };
}

export interface PublishFormProps {
  tenantId: string;
  /**
   * Preselect por query param (?kind=, menú crear-post del feed — page.tsx ya
   * lo validó). Con un kind fijado, el wizard arranca en el paso 1 (el
   * selector del paso 0 queda salteado); "Cambiar tipo" vuelve a mostrarlo.
   * Sin param (uso de siempre desde /publicar a mano), todo igual que antes.
   */
  initialKind?: Kind | null;
}

export function PublishForm({ tenantId, initialKind = null }: PublishFormProps) {
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(initialKind ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    status: "published" | "pending_review";
    kind: Kind;
    listingId: string;
  } | null>(null);

  const [kind, setKind] = useState<Kind | null>(initialKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [period, setPeriod] = useState("month");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [sqft, setSqft] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [exactAddress, setExactAddress] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  // Declaración de originalidad y licencia (pliego / Content Integrity).
  const [declaration, setDeclaration] = useState<DeclarationValue>(EMPTY_DECLARATION_VALUE);
  // Campos específicos de professional/event
  const [category, setCategory] = useState("");
  const [credentials, setCredentials] = useState("");
  const [eventStartsAt, setEventStartsAt] = useState("");

  // El borrador se crea una sola vez — reintentos no duplican avisos.
  const [draftId, setDraftId] = useState<string | null>(null);

  const isProperty = kind === "property";
  // La frecuencia (por mes/semana/día) es lenguaje de alquileres y sueldos.
  // Para negocio/profesional/evento se oculta y el precio queda como único —
  // el cliente eligió "Negocio" y le apareció "Por mes" como si fuera una
  // propiedad (feedback 2026-07-21).
  const hasPriceFrequency = isProperty || kind === "job";

  /**
   * La frecuencia que se va a guardar. Una sola fuente para el borrador y para
   * la vista previa: si se calculaban por separado, la vista previa podía decir
   * una cosa y el aviso publicado otra.
   */
  const savedPeriod: "month" | "week" | "day" | "one_time" = hasPriceFrequency
    ? (period as "month" | "week" | "day" | "one_time")
    : "one_time";

  /**
   * Se arma con el MISMO helper que pinta la tarjeta ya publicada
   * (`formatListingPrice`), no a mano. Cuando se armaba acá con
   * `"$" + toLocaleString` pasaban dos cosas: un precio con un decimal salía
   * "$950.9" en vez de "$950.90", y el sufijo estaba clavado en "/mes", así que
   * quien alquilaba "por semana" o "por día" veía sólo "$200" — el número suelto
   * se lee como el total, no como lo que se paga por semana.
   */
  const priceAmount = price ? Number(price) : Number.NaN;
  const pricePreview = Number.isFinite(priceAmount)
    ? formatListingPrice(priceAmount, DEFAULT_CURRENCY, savedPeriod)
    : null;

  function validateStep(current: number): string | null {
    if (current === 0 && !kind) return C.errors.kindRequired;
    if (current === 1) {
      if (title.trim().length < 8) return C.errors.titleShort;
      if (description.trim().length < 30) return C.errors.descriptionShort;
    }
    if (current === 2 && isProperty) {
      const amount = Number(price);
      if (!Number.isFinite(amount) || amount <= 0) return C.errors.priceRequired;
    }
    if (current === 2 && kind === "professional" && !category) {
      return DIR_COPY.professional.categoryError;
    }
    if (current === 2 && kind === "event" && !eventStartsAt) {
      return DIR_COPY.event.dateError;
    }
    if (current === 3 && areaLabel.trim().length < 3) return C.errors.zoneShort;
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function goBack() {
    setError(null);
    setStep((value) => Math.max(0, value - 1));
  }

  /** "Cambiar tipo" (solo visible si arrancamos con un kind preseleccionado). */
  function changeType() {
    setError(null);
    setStep(0);
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    setPhotos((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_PHOTOS) {
          // Copy del módulo de monetización: dice el número real Y qué se gana
          // con premium, en vez del "hasta 6 fotos" hardcodeado de antes.
          toast({ title: M.tier.photoLimitReached(MAX_PHOTOS), variant: "warning" });
          break;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          toast({ title: C.steps.photos.tooBig, variant: "warning" });
          continue;
        }
        next.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  function resetForm() {
    photos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setStep(0);
    setError(null);
    setDone(null);
    setKind(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setPeriod("month");
    setBedrooms("");
    setBathrooms("");
    setSqft("");
    setAreaLabel("");
    setExactAddress("");
    setPhotos([]);
    setCategory("");
    setCredentials("");
    setEventStartsAt("");
    setDraftId(null);
  }

  async function handleSubmit() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // 1) Borrador (idempotente dentro de la sesión del formulario)
      let listingId = draftId;
      if (!listingId) {
        const result = await createListingDraft({
          kind: kind as Kind,
          title: title.trim(),
          description: description.trim(),
          priceAmount: price ? Number(price) : null,
          pricePeriod: price
            ? hasPriceFrequency
              ? (period as "month" | "week" | "day" | "one_time")
              : "one_time"
            : null,
          bedrooms: isProperty && bedrooms ? Number(bedrooms) : null,
          bathrooms: isProperty && bathrooms ? Number(bathrooms) : null,
          sqft: isProperty && sqft ? Number(sqft) : null,
          areaLabel: areaLabel.trim(),
          exactAddress: exactAddress.trim() || null,
          category:
            kind === "professional" && isProfessionalCategory(category) ? category : null,
          credentials: kind === "professional" ? credentials.trim() || null : null,
          eventStartsAt: kind === "event" && eventStartsAt ? eventStartsAt : null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        listingId = result.listingId;
        setDraftId(result.listingId);
      }

      // 2) Fotos → bucket listing-photos, path {tenant_id}/{listing_id}/{uuid}.{ext}
      const supabase = createClient();
      const photoPaths: string[] = [];
      for (const item of photos) {
        const { blob, ext } = await preparePhoto(item.file);
        const path = `${tenantId}/${listingId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          setError(C.errors.uploadFailed);
          return;
        }
        photoPaths.push(path);
      }

      // 3) Cierre: estado final según moderación/degradación elegante
      const finalized = await finalizeListing({ listingId, photoPaths, declaration });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setDone({
        status: finalized.status,
        kind: (finalized.kind as Kind) ?? (kind as Kind),
        listingId,
      });
      // Celebración sutil solo cuando el aviso quedó publicado de verdad (no en
      // "queda en revisión", que es un estado de espera, no un logro cerrado).
      if (finalized.status === "published") celebrate();
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Pantalla de éxito
  // -------------------------------------------------------------------------
  if (done) {
    const published = done.status === "published";
    const viewHref = listingViewHref(done.kind, done.listingId);
    return (
      <>
        {published && (
          <Celebration active={celebrating} message={C.success.publishedTitle} />
        )}
        <div className="flex flex-col gap-4">
          <BezelCard
            variant={published ? "success" : "default"}
            coreClassName="flex flex-col items-center gap-3 px-6 py-9 text-center"
          >
            <CheckCircle
              size={56}
              weight="fill"
              aria-hidden="true"
              className={published ? "text-success" : "text-brand"}
            />
            <h2 className="font-display text-xl font-bold text-foreground">
              {published ? C.success.publishedTitle : C.success.reviewTitle}
            </h2>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">
              {published ? C.success.publishedBody : C.success.reviewBody}
            </p>
            <Link
              href={viewHref}
              className={cn(
                buttonVariants({ variant: "primary", size: "md" }),
                "mt-2 w-full",
              )}
            >
              <Eye size={18} aria-hidden="true" />
              {M.success.viewCta}
            </Link>
          </BezelCard>

          {/* Pedido literal de la call (1:00:07): "cuando dice publicar aviso,
              debería haber un botón acá y otro acá… crear campaña o impulsar
              este anuncio". Aplica a los 5 verticales del wizard.

              Sólo si el aviso YA está publicado: las dos rutas exigen
              status='published' (la RLS de campaigns_insert y el gate de
              /impulsar), así que ofrecerlas en revisión sería mandar a alguien
              a una pantalla que le dice que no. Cuando está en revisión se lo
              decimos con una línea, que es más honesto que un botón muerto. */}
          {published ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <PromoteCard
                href={`/impulsar/${done.listingId}`}
                icon={<RocketLaunch size={20} weight="fill" aria-hidden="true" />}
                title={M.success.boostCta}
                hint={M.success.boostHint}
              />
              <PromoteCard
                href={`/impulsar/${done.listingId}?modo=campana`}
                icon={<Megaphone size={20} weight="fill" aria-hidden="true" />}
                title={M.success.campaignCta}
                hint={M.success.campaignHint}
              />
            </div>
          ) : (
            <p className="text-center text-xs leading-relaxed text-foreground-muted">
              {M.success.laterNote}
            </p>
          )}

          <Button variant="ghost" className="w-full" onClick={resetForm}>
            {C.success.publishAnother}
          </Button>
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Formulario multi-paso
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <ProgressDots total={TOTAL_STEPS} current={step + 1} />
        <p className="text-xs text-foreground-muted">{C.stepLabel(step + 1, TOTAL_STEPS)}</p>
      </div>

      {step === 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-display text-xl font-bold text-foreground">
            {C.steps.kind.title}
          </legend>
          <p className="-mt-1 text-sm text-foreground-secondary">{C.steps.kind.help}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {KIND_OPTIONS.map(({ value, label, Icon }) => {
              const selected = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKind(value)}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-3",
                    "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                    "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    selected
                      ? "border-brand bg-brand-tint text-brand-ink"
                      : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                  )}
                >
                  <Icon size={26} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                  <span className="text-sm font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold text-foreground">
              {C.steps.text.title(kind)}
            </h2>
            {/* Solo con preselect (?kind= del menú crear-post): el paso 0 quedó
                salteado, así que ofrecemos volver a él sin usar "Atrás". */}
            {initialKind && (
              <button
                type="button"
                onClick={changeType}
                className={cn(
                  "shrink-0 text-xs font-semibold text-foreground-muted underline-offset-2",
                  "transition-colors duration-(--duration-fast) hover:text-brand-ink hover:underline",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                {DIR_COPY.changeType}
              </button>
            )}
          </div>
          <Field htmlFor="pub-title" label={C.steps.text.titleLabel} help={C.steps.text.titleHelp}>
            <Input
              id="pub-title"
              value={title}
              maxLength={120}
              placeholder={C.steps.text.titlePlaceholder(kind)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field
            htmlFor="pub-description"
            label={C.steps.text.descriptionLabel}
            help={C.steps.text.descriptionHelp}
          >
            <Textarea
              id="pub-description"
              rows={6}
              value={description}
              maxLength={4000}
              placeholder={C.steps.text.descriptionPlaceholder(kind)}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.price.title}</h2>
          <div className={cn("grid gap-3", hasPriceFrequency ? "grid-cols-2" : "grid-cols-1")}>
            <Field htmlFor="pub-price" label={C.steps.price.priceLabel} optional={!isProperty}>
              <Input
                id="pub-price"
                type="number"
                inputMode="decimal"
                min={0}
                value={price}
                placeholder={C.steps.price.pricePlaceholder}
                onChange={(event) => setPrice(event.target.value)}
                className="numeric"
              />
            </Field>
            {hasPriceFrequency && (
              <Field htmlFor="pub-period" label={C.steps.price.periodLabel}>
                <Select
                  id="pub-period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option value="month">Por mes</option>
                  <option value="week">Por semana</option>
                  <option value="day">Por día</option>
                  <option value="one_time">Precio único</option>
                </Select>
              </Field>
            )}
          </div>

          {isProperty && (
            <div className="grid grid-cols-3 gap-3">
              <Field htmlFor="pub-bedrooms" label={C.steps.price.bedroomsLabel} optional>
                <Input
                  id="pub-bedrooms"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  value={bedrooms}
                  onChange={(event) => setBedrooms(event.target.value)}
                  className="numeric"
                />
              </Field>
              <Field htmlFor="pub-bathrooms" label={C.steps.price.bathroomsLabel} optional>
                <Input
                  id="pub-bathrooms"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  value={bathrooms}
                  onChange={(event) => setBathrooms(event.target.value)}
                  className="numeric"
                />
              </Field>
              <Field htmlFor="pub-sqft" label={C.steps.price.sqftLabel} optional>
                <Input
                  id="pub-sqft"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sqft}
                  onChange={(event) => setSqft(event.target.value)}
                  className="numeric"
                />
              </Field>
            </div>
          )}

          {kind === "professional" && (
            <>
              <Field htmlFor="pub-category" label={DIR_COPY.professional.categoryLabel}>
                <Select
                  id="pub-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="" disabled>
                    Elegí un rubro…
                  </option>
                  {PROFESSIONAL_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                htmlFor="pub-credentials"
                label={DIR_COPY.professional.credentialsLabel}
                help={DIR_COPY.professional.credentialsHelp}
                optional
              >
                <Input
                  id="pub-credentials"
                  value={credentials}
                  maxLength={200}
                  placeholder={DIR_COPY.professional.credentialsPlaceholder}
                  onChange={(event) => setCredentials(event.target.value)}
                />
              </Field>
            </>
          )}

          {kind === "event" && (
            <Field htmlFor="pub-event-date" label={DIR_COPY.event.dateLabel}>
              <Input
                id="pub-event-date"
                type="datetime-local"
                value={eventStartsAt}
                onChange={(event) => setEventStartsAt(event.target.value)}
                className="numeric"
              />
            </Field>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.zone.title}</h2>
          <Field htmlFor="pub-zone" label={C.steps.zone.zoneLabel} help={C.steps.zone.zoneHelp}>
            <Input
              id="pub-zone"
              value={areaLabel}
              maxLength={80}
              placeholder={C.steps.zone.zonePlaceholder}
              onChange={(event) => setAreaLabel(event.target.value)}
            />
          </Field>
          <Field
            htmlFor="pub-address"
            label={C.steps.zone.addressLabel}
            help={C.steps.zone.addressHelp}
            optional
          >
            <Input
              id="pub-address"
              value={exactAddress}
              maxLength={200}
              placeholder={C.steps.zone.addressPlaceholder}
              onChange={(event) => setExactAddress(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">
            {C.steps.photos.title}
          </h2>
          {/* El número sale del módulo de monetización, no de un string fijo:
              C.steps.photos.help sigue diciendo "6" y lo comparte con otros
              wizards que todavía tienen ese tope. */}
          <p className="-mt-2 text-sm text-foreground-secondary">
            {M.tier.photoStepHelp(MAX_PHOTOS)}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {photos.map((item, index) => (
              <div key={item.previewUrl} className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL) */}
                <img
                  src={item.previewUrl}
                  alt={`Foto ${index + 1}`}
                  className="size-full rounded-md object-cover"
                />
                <button
                  type="button"
                  aria-label={`${C.steps.photos.removeLabel} ${index + 1}`}
                  onClick={() => removePhoto(index)}
                  // Área táctil a 44px con ::after y no agrandando el botón: acá
                  // taparía la miniatura. `touch-hitbox` no sirve porque fuerza
                  // `position: relative` y este botón es `absolute`.
                  className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-media-scrim text-on-media after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md",
                  "border border-dashed border-border text-foreground-muted",
                  "transition-colors duration-(--duration-fast) hover:border-brand hover:text-brand-ink",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <ImageSquare size={24} aria-hidden="true" />
                <span className="text-xs font-semibold">{C.steps.photos.addLabel}</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label={C.steps.photos.addLabel}
            onChange={(event) => addPhotos(event.target.files)}
          />

          {photos.length > 0 && (
            <p className="text-xs text-foreground-muted">{C.steps.photos.reviewNote}</p>
          )}

          {/* Declaración de originalidad y licencia. Va en el paso de FOTOS, no
              en el de vista previa: es de las fotos que habla, y acá la persona
              todavía las tiene delante. */}
          <OriginalityFields
            idPrefix="aviso-declaracion"
            value={declaration}
            onChange={setDeclaration}
          />
        </div>
      )}


      {step === STEP_PREVIEW && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">
              {M.preview.title}
            </h2>
            <p className="mt-0.5 text-sm text-foreground-secondary">{M.preview.help}</p>
          </div>

          {/* La tarjeta imita el aviso real —foto, título, precio, zona— para que
              "así te va a quedar" sea literal y no una lista de campos. */}
          <BezelCard coreClassName="overflow-hidden">
            {photos.length > 0 ? (
              <div className="relative aspect-[4/3] w-full bg-surface-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL) */}
                <img
                  src={photos[0].previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center gap-2 bg-surface-subtle text-foreground-muted">
                <ImageSquare size={22} aria-hidden="true" />
                <span className="text-sm font-medium">{M.preview.photosNone}</span>
              </div>
            )}

            <div className="flex flex-col gap-1.5 p-4">
              <p className="font-display text-lg font-bold leading-snug text-foreground">
                {title.trim() || "—"}
              </p>
              {photos.length > 1 && (
                // El contador va en el cuerpo y NO encima de la foto: sobre la
                // imagen pedía `text-on-media`, que es tinta clara por
                // definición y desaparece al imprimir sin su relleno
                // (src/test/print-contract.test.ts). Acá se lee siempre.
                <p className="text-xs text-foreground-muted">
                  {M.preview.photoCount(photos.length)}
                </p>
              )}
              {pricePreview && (
                <p className="numeric text-2xl font-bold text-brand">{pricePreview}</p>
              )}
              {areaLabel.trim() && (
                <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                  <MapPin size={14} aria-hidden="true" />
                  {areaLabel.trim()}
                </p>
              )}
              {description.trim() && (
                <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
                  {description.trim()}
                </p>
              )}
            </div>
          </BezelCard>

          {/* Contacto: en gratis es el chat y nada más. Se dice ACÁ, antes de
              publicar, para que nadie descubra después que su teléfono no
              aparece por ningún lado. */}
          <div className="rounded-lg bg-surface-subtle px-4 py-3">
            <p className="text-sm text-foreground">{M.tier.freeContactNote}</p>
            <p className="mt-1 text-xs text-foreground-muted">{M.tier.upgradeTeaser}</p>
          </div>

          <Button variant="outline" className="w-full" onClick={() => setStep(1)}>
            <PencilSimple size={18} aria-hidden="true" />
            {M.preview.edit}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            {C.nav.back}
          </Button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button variant="primary" className="ml-auto min-w-32" onClick={goNext}>
            {C.nav.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ml-auto min-w-40"
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? C.nav.submitting : C.nav.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de promoción de la pantalla de éxito
// ---------------------------------------------------------------------------

/**
 * Las dos rutas de "Promocionar", una al lado de la otra y con su diferencia
 * escrita. Son tarjetas y no dos botones apilados a propósito: impulsar y armar
 * una campaña no son la misma acción con distinto precio, y dos botones
 * idénticos invitan a elegir el de arriba sin leer.
 */
function PromoteCard({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-11 items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span className="mt-0.5 shrink-0 text-brand">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground group-hover:text-brand-ink">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
          {hint}
        </span>
      </span>
    </Link>
  );
}

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CheckCircle,
  House,
  ImageSquare,
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
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Celebration, useCelebration } from "@/components/motion";
import { COPY } from "@/components/listings";
import { createListingDraft, finalizeListing } from "./actions";

const C = COPY.publish;

// Campos específicos de professional/event (módulo DIRECTORIOS) — copy local
// para no tocar el COPY de vivienda.
const DIR_COPY = {
  professional: {
    categoryLabel: "Rubro",
    categoryError: "Elegí un rubro para tu perfil.",
    credentialsLabel: "Credenciales",
    credentialsPlaceholder: "Ej.: Matrícula NY #12345, CPA",
    credentialsHelp:
      "Separalas con comas. Si sos abogado o notario, después podés verificar tu matrícula en el Escudo.",
  },
  event: {
    dateLabel: "Fecha y hora del evento",
    dateError: "Decinos cuándo es el evento.",
  },
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

type Kind = "property" | "business" | "professional" | "event" | "job";

const KIND_OPTIONS: Array<{ value: Kind; label: string; Icon: typeof House }> = [
  { value: "property", label: "Vivienda", Icon: House },
  { value: "business", label: "Negocio", Icon: Storefront },
  { value: "professional", label: "Profesional", Icon: Briefcase },
  { value: "event", label: "Evento", Icon: Calendar },
  { value: "job", label: "Trabajo", Icon: Wrench },
];

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TOTAL_STEPS = 5;

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

export function PublishForm({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"published" | "pending_review" | null>(null);

  const [kind, setKind] = useState<Kind | null>(null);
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
  // Campos específicos de professional/event
  const [category, setCategory] = useState("");
  const [credentials, setCredentials] = useState("");
  const [eventStartsAt, setEventStartsAt] = useState("");

  // El borrador se crea una sola vez — reintentos no duplican avisos.
  const [draftId, setDraftId] = useState<string | null>(null);

  const isProperty = kind === "property";

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

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    setPhotos((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_PHOTOS) {
          toast({ title: C.steps.photos.tooMany, variant: "warning" });
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
          pricePeriod: price ? (period as "month" | "week" | "day" | "one_time") : null,
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
      const finalized = await finalizeListing({ listingId, photoPaths });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setDone(finalized.status);
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
    const published = done === "published";
    return (
      <>
      {published && (
        <Celebration active={celebrating} message={C.success.publishedTitle} />
      )}
      <BezelCard
        variant={published ? "success" : "default"}
        coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
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
        <div className="mt-3 flex w-full flex-col gap-2">
          <Link
            href="/propiedades"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
          >
            {C.success.goToListings}
          </Link>
          <Button variant="ghost" className="w-full" onClick={resetForm}>
            {C.success.publishAnother}
          </Button>
        </div>
      </BezelCard>
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
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.text.title}</h2>
          <Field htmlFor="pub-title" label={C.steps.text.titleLabel} help={C.steps.text.titleHelp}>
            <Input
              id="pub-title"
              value={title}
              maxLength={120}
              placeholder={C.steps.text.titlePlaceholder}
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
              placeholder={C.steps.text.descriptionPlaceholder}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.price.title}</h2>
          <div className="grid grid-cols-2 gap-3">
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
          <p className="-mt-2 text-sm text-foreground-secondary">{C.steps.photos.help}</p>

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
                  aria-label={C.steps.photos.removeLabel}
                  onClick={() => removePhoto(index)}
                  className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-media-scrim text-on-media focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
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

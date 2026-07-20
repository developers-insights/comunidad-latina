"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, ImageSquare, X } from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Celebration, useCelebration } from "@/components/motion";
import {
  COPY,
  PRODUCT_CATEGORIES,
  PRODUCT_CONDITIONS,
  isProductCondition,
} from "@/components/marketplace";
import { createProductDraft, finalizeProduct } from "./actions";

const C = COPY.publish;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export interface StoreOption {
  id: string;
  title: string;
}

interface PhotoItem {
  file: File;
  previewUrl: string;
}

/**
 * Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original.
 *
 * Duplicado intencional de la lógica equivalente en /publicar/publish-form.tsx
 * (propiedad de otro agente, ownership estricto §AGENTS.md del módulo): un
 * client component autocontenido en cada ruta evita acoplar dos rutas de
 * dueños distintos a un mismo archivo compartido.
 */
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

export function PublishForm({ tenantId, stores }: { tenantId: string; stores: StoreOption[] }) {
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"published" | "pending_review" | null>(null);
  // El borrador se crea una sola vez — reintentos no duplican productos.
  const [draftId, setDraftId] = useState<string | null>(null);

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    setPhotos((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_PHOTOS) {
          toast({ title: C.tooManyPhotos, variant: "warning" });
          break;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          toast({ title: C.tooBigPhoto, variant: "warning" });
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

  function validate(): string | null {
    if (!storeId) return C.errors.storeRequired;
    if (title.trim().length < 8) return C.errors.titleShort;
    if (description.trim().length < 10) return C.errors.descriptionShort;
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount <= 0) return C.errors.priceRequired;
    if (!category) return C.errors.categoryRequired;
    if (!condition) return C.errors.conditionRequired;
    return null;
  }

  function resetForm() {
    photos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setTitle("");
    setDescription("");
    setPrice("");
    setCategory("");
    setCondition("");
    setPhotos([]);
    setDraftId(null);
    setDone(null);
    setError(null);
  }

  async function handleSubmit() {
    const problem = validate();
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
        const result = await createProductDraft({
          storeListingId: storeId,
          title: title.trim(),
          description: description.trim(),
          priceAmount: Number(price),
          category,
          condition: isProductCondition(condition) ? condition : null,
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
      const finalized = await finalizeProduct({ listingId, photoPaths });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setDone(finalized.status);
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
    const store = stores.find((s) => s.id === storeId);
    return (
      <>
        {published && <Celebration active={celebrating} message={C.success.publishedTitle} />}
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
            {store && (
              <Link
                href={`/marketplace/tienda/${store.id}`}
                className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
              >
                {C.success.goToStore}
              </Link>
            )}
            <Link
              href="/marketplace"
              className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full")}
            >
              {C.success.goToMarketplace}
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
  // Formulario (una sola pantalla — menos campos que /publicar, no ameritan wizard)
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <Field htmlFor="mkt-store" label={C.storeFieldLabel} help={C.storeFieldHelp}>
        <Select id="mkt-store" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="mkt-title" label={C.titleLabel} help={C.titleHelp}>
        <Input
          id="mkt-title"
          value={title}
          maxLength={120}
          placeholder={C.titlePlaceholder}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <Field htmlFor="mkt-description" label={C.descriptionLabel} help={C.descriptionHelp}>
        <Textarea
          id="mkt-description"
          rows={5}
          value={description}
          maxLength={4000}
          placeholder={C.descriptionPlaceholder}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field htmlFor="mkt-price" label={C.priceLabel}>
          <Input
            id="mkt-price"
            type="number"
            inputMode="decimal"
            min={0}
            value={price}
            placeholder={C.pricePlaceholder}
            onChange={(event) => setPrice(event.target.value)}
            className="numeric"
          />
        </Field>
        <Field htmlFor="mkt-category" label={C.categoryLabel}>
          <Select
            id="mkt-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="" disabled>
              {C.categoryPlaceholder}
            </option>
            {PRODUCT_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">{C.conditionLegend}</legend>
        <div className="grid grid-cols-2 gap-2">
          {PRODUCT_CONDITIONS.map((option) => {
            const selected = condition === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCondition(option.value)}
                className={cn(
                  "min-h-11 rounded-md border px-3 text-sm font-semibold",
                  "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  selected
                    ? "border-brand bg-brand-tint text-brand-ink"
                    : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{C.photosTitle}</h2>
          <p className="mt-0.5 text-sm text-foreground-secondary">{C.photosHelp}</p>
        </div>

        <div className="grid grid-cols-4 gap-2">
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
                aria-label={C.removePhotoLabel}
                onClick={() => removePhoto(index)}
                className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-media-scrim text-on-media focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}

          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-md",
                "border border-dashed border-border text-foreground-muted",
                "transition-colors duration-(--duration-fast) hover:border-brand hover:text-brand-ink",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <ImageSquare size={22} aria-hidden="true" />
              <span className="text-[11px] font-semibold">{C.addPhotoLabel}</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={C.addPhotoLabel}
          onChange={(event) => addPhotos(event.target.files)}
        />

        {photos.length > 0 && <p className="text-xs text-foreground-muted">{C.reviewNote}</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button variant="primary" size="lg" className="w-full" loading={submitting} onClick={handleSubmit}>
        {submitting ? C.submitting : C.submit}
      </Button>
    </div>
  );
}

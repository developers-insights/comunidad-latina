"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, ImageSquare, X } from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { Celebration, useCelebration } from "@/components/motion";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { createGigDraft, finalizeGig } from "@/app/(app)/creadores/actions";
import { PHOTO_MAX_COUNT, selectPhotos } from "./helpers";
import { COPY } from "./copy";

const MAX_PHOTOS = PHOTO_MAX_COUNT;
const TOTAL_STEPS = 4;

interface PhotoItem {
  file: File;
  previewUrl: string;
}

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

const C = COPY.publish;

export function GigPublishForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"published" | "pending_review" | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [budget, setBudget] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [areaLabel, setAreaLabel] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (title.trim().length < 8) return C.errors.titleShort;
      if (description.trim().length < 30) return C.errors.descriptionShort;
    }
    if (current === 1) {
      const amount = Number(budget);
      if (!Number.isFinite(amount) || amount <= 0) return C.errors.amountRequired;
    }
    if (current === 2 && areaLabel.trim().length < 3) return C.errors.areaShort;
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) return setError(problem);
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function goBack() {
    setError(null);
    setStep((value) => Math.max(0, value - 1));
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    // Materializamos los archivos AHORA (síncrono): el input se limpia más abajo
    // (value = "") y su FileList es vivo — leerlo dentro del updater diferido de
    // setPhotos daría 0 archivos, y la foto "no se marcaba". Ver selectPhotos().
    const { accepted, tooMany, tooBig } = selectPhotos(Array.from(fileList), photos.length);
    if (accepted.length) {
      const items = accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
      setPhotos((current) => [...current, ...items]);
    }
    if (tooMany) toast({ variant: "warning", title: C.steps.photos.tooMany });
    if (tooBig) toast({ variant: "warning", title: C.steps.photos.tooBig });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit() {
    const problem = validateStep(step);
    if (problem) return setError(problem);
    setError(null);
    setSubmitting(true);
    try {
      let listingId = draftId;
      if (!listingId) {
        const result = await createGigDraft({
          title: title.trim(),
          description: description.trim(),
          budget: Number(budget),
          deliverables: deliverables.trim() || null,
          deadlineDays: deadlineDays ? Number(deadlineDays) : null,
          urgent,
          areaLabel: areaLabel.trim(),
        });
        if (!result.ok) {
          if (result.needsAuth) {
            router.push("/entrar?next=/creadores/publicar");
            return;
          }
          setError(result.error);
          return;
        }
        listingId = result.listingId;
        setDraftId(result.listingId);
      }

      const supabase = createClient();

      // Igual que el composer del feed (que sube en el SERVIDOR tras
      // requireTenantMatch): la foto va con una sesión válida y con el prefijo
      // {tenant}/{listing} que exige la policy listing_photos_insert. getUser()
      // revalida y refresca el token del browser client ANTES de subir (si está
      // vencido, la subida se rechazaba en silencio) y el tenant sale del JWT
      // (app_metadata.tenant_id) — lo que la RLS realmente compara— y no del prop
      // del request. El listing es el borrador propio recién creado, así que el
      // EXISTS de la policy (listing del mismo tenant y created_by) da verdadero.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        router.push("/entrar?next=/creadores/publicar");
        return;
      }
      const tid = String(user.app_metadata?.tenant_id ?? tenantId);

      const photoPaths: string[] = [];
      for (const item of photos) {
        const { blob, ext } = await preparePhoto(item.file);
        const path = `${tid}/${listingId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          // Sin este log el fallo real (RLS, token vencido, límite del bucket)
          // quedaba invisible: solo se veía el copy genérico de uploadFailed.
          console.warn("[creadores] subida de foto de trabajo falló", {
            message: uploadError.message,
          });
          setError(C.errors.uploadFailed);
          return;
        }
        photoPaths.push(path);
      }

      const finalized = await finalizeGig({ listingId, photoPaths });
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

  if (done) {
    const published = done === "published";
    return (
      <>
        {published && <Celebration active={celebrating} message={C.successPublishedTitle} />}
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
            {published ? C.successPublishedTitle : C.successReviewTitle}
          </h2>
          <p className="max-w-[40ch] text-sm text-foreground-secondary">
            {published ? C.successPublishedBody : C.successReviewBody}
          </p>
          <Link
            href="/creadores"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-3 w-full")}
          >
            {C.goToFeed}
          </Link>
        </BezelCard>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <ProgressDots total={TOTAL_STEPS} current={step + 1} />
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Field htmlFor="gig-title" label={C.steps.what.titleLabel} help={C.steps.what.titleHelp}>
            <Input
              id="gig-title"
              value={title}
              maxLength={120}
              placeholder={C.steps.what.titlePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field htmlFor="gig-description" label={C.steps.what.descriptionLabel} help={C.steps.what.descriptionHelp}>
            <Textarea
              id="gig-description"
              rows={5}
              value={description}
              maxLength={4000}
              placeholder={C.steps.what.descriptionPlaceholder}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field htmlFor="gig-deliverables" label={C.steps.what.deliverablesLabel} help={C.steps.what.deliverablesHelp} optional>
            <Input
              id="gig-deliverables"
              value={deliverables}
              maxLength={500}
              placeholder={C.steps.what.deliverablesPlaceholder}
              onChange={(event) => setDeliverables(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.budget.title}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="gig-budget" label={C.steps.budget.amountLabel} help={C.steps.budget.amountHelp}>
              <Input
                id="gig-budget"
                type="number"
                inputMode="decimal"
                min={1}
                value={budget}
                placeholder={C.steps.budget.amountPlaceholder}
                onChange={(event) => setBudget(event.target.value)}
                className="numeric"
              />
            </Field>
            <Field htmlFor="gig-deadline" label={C.steps.budget.deadlineLabel} optional>
              <Input
                id="gig-deadline"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={deadlineDays}
                placeholder={C.steps.budget.deadlinePlaceholder}
                onChange={(event) => setDeadlineDays(event.target.value)}
                className="numeric"
              />
            </Field>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={urgent}
            onClick={() => setUrgent((value) => !value)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{C.steps.budget.urgentLabel}</span>
              <span className="block text-xs text-foreground-muted">{C.steps.budget.urgentHelp}</span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                urgent ? "bg-brand" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-surface shadow-xs transition-[left]",
                  urgent ? "left-[22px]" : "left-0.5",
                )}
              />
            </span>
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.where.title}</h2>
          <Field htmlFor="gig-area" label={C.steps.where.areaLabel} help={C.steps.where.areaHelp}>
            <Input
              id="gig-area"
              value={areaLabel}
              maxLength={80}
              placeholder={C.steps.where.areaPlaceholder}
              onChange={(event) => setAreaLabel(event.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">{C.steps.photos.title}</h2>
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
                  aria-label={C.steps.photos.remove}
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
                  "transition-colors hover:border-brand hover:text-brand-ink",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <ImageSquare size={24} aria-hidden="true" />
                <span className="text-xs font-semibold">{C.steps.photos.add}</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label={C.steps.photos.add}
            onChange={(event) => addPhotos(event.target.files)}
          />
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
          <Button variant="primary" className="ml-auto min-w-40" loading={submitting} onClick={handleSubmit}>
            {submitting ? C.nav.submitting : C.nav.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

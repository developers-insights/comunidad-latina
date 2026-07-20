"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, ImageSquare, X } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Field, Input, Textarea, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { upsertCreatorProfile } from "@/app/(app)/creadores/actions";
import { creatorPhotoUrl } from "./helpers";
import { COPY } from "./copy";

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_SKILLS = 12;

export interface CreatorProfileInitial {
  headline: string;
  bio: string | null;
  skills: string[];
  rateHint: string | null;
  available: boolean;
  portfolioPaths: string[];
}

type PortfolioItem =
  | { kind: "existing"; path: string; url: string }
  | { kind: "new"; file: File; previewUrl: string };

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

export function CreatorProfileForm({
  tenantId,
  userId,
  initial,
}: {
  tenantId: string;
  userId: string;
  initial: CreatorProfileInitial | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [skillDraft, setSkillDraft] = useState("");
  const [rateHint, setRateHint] = useState(initial?.rateHint ?? "");
  const [available, setAvailable] = useState(initial?.available ?? true);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>(
    (initial?.portfolioPaths ?? []).map((path) => ({
      kind: "existing",
      path,
      url: creatorPhotoUrl(path),
    })),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function addSkill(raw: string) {
    const value = raw.trim().replace(/,$/, "").trim();
    if (!value) return;
    setSkills((current) => {
      if (current.length >= MAX_SKILLS || current.some((s) => s.toLowerCase() === value.toLowerCase())) {
        return current;
      }
      return [...current, value.slice(0, 40)];
    });
    setSkillDraft("");
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    setPortfolio((current) => {
      const next = [...current];
      for (const file of Array.from(fileList)) {
        if (next.length >= MAX_PHOTOS) {
          toast({ variant: "warning", title: "Podés subir hasta 6 fotos." });
          break;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          toast({ variant: "warning", title: "Esa foto pesa demasiado (máximo 8 MB)." });
          continue;
        }
        next.push({ kind: "new", file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPortfolio((current) => {
      const removed = current[index];
      if (removed?.kind === "new") URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit() {
    if (headline.trim().length < 6) {
      setError(COPY.profile.errors.headlineShort);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const paths: string[] = [];
      for (const item of portfolio) {
        if (item.kind === "existing") {
          paths.push(item.path);
          continue;
        }
        const { blob, ext } = await preparePhoto(item.file);
        const path = `${tenantId}/${userId}/portfolio-${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("post-media")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          setError(COPY.profile.errors.uploadFailed);
          return;
        }
        paths.push(path);
      }

      const result = await upsertCreatorProfile({
        headline: headline.trim(),
        bio: bio.trim() || null,
        skills,
        rateHint: rateHint.trim() || null,
        available,
        portfolioPaths: paths,
      });
      if (!result.ok) {
        if (result.needsAuth) {
          router.push("/entrar?next=/creadores/perfil");
          return;
        }
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError(COPY.profile.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <BezelCard variant="success" coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <CheckCircle size={56} weight="fill" aria-hidden="true" className="text-success" />
        <h2 className="font-display text-xl font-bold text-foreground">{COPY.profile.savedTitle}</h2>
        <p className="max-w-[40ch] text-sm text-foreground-secondary">{COPY.profile.savedBody}</p>
        <div className="mt-3 flex w-full flex-col gap-2">
          <Link
            href={`/creadores/perfil/${userId}`}
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
          >
            {COPY.profile.viewPublic}
          </Link>
          <Button variant="ghost" className="w-full" onClick={() => setDone(false)}>
            Seguir editando
          </Button>
        </div>
      </BezelCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Field htmlFor="cp-headline" label={COPY.profile.form.headlineLabel} help={COPY.profile.form.headlineHelp}>
        <Input
          id="cp-headline"
          value={headline}
          maxLength={120}
          placeholder={COPY.profile.form.headlinePlaceholder}
          onChange={(event) => setHeadline(event.target.value)}
        />
      </Field>

      <Field htmlFor="cp-bio" label={COPY.profile.form.bioLabel} help={COPY.profile.form.bioHelp} optional>
        <Textarea
          id="cp-bio"
          rows={4}
          value={bio}
          maxLength={2000}
          placeholder={COPY.profile.form.bioPlaceholder}
          onChange={(event) => setBio(event.target.value)}
        />
      </Field>

      <Field htmlFor="cp-skills" label={COPY.profile.form.skillsLabel} help={COPY.profile.form.skillsHelp}>
        <div className="flex flex-col gap-2">
          {skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {skills.map((skill, index) => (
                <li
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand-ink"
                >
                  {skill}
                  <button
                    type="button"
                    aria-label={`Quitar ${skill}`}
                    onClick={() => setSkills((current) => current.filter((_, i) => i !== index))}
                    className="rounded-full"
                  >
                    <X size={12} weight="bold" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Input
            id="cp-skills"
            value={skillDraft}
            maxLength={40}
            placeholder={COPY.profile.form.skillsPlaceholder}
            onChange={(event) => setSkillDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addSkill(skillDraft);
              } else if (event.key === "Backspace" && skillDraft === "") {
                setSkills((current) => current.slice(0, -1));
              }
            }}
            onBlur={() => addSkill(skillDraft)}
          />
        </div>
      </Field>

      <Field htmlFor="cp-rate" label={COPY.profile.form.rateHintLabel} help={COPY.profile.form.rateHintHelp} optional>
        <Input
          id="cp-rate"
          value={rateHint}
          maxLength={120}
          placeholder={COPY.profile.form.rateHintPlaceholder}
          onChange={(event) => setRateHint(event.target.value)}
        />
      </Field>

      <button
        type="button"
        role="switch"
        aria-checked={available}
        onClick={() => setAvailable((value) => !value)}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-foreground">{COPY.profile.form.availableLabel}</span>
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            available ? "bg-brand" : "bg-border",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-surface shadow-xs transition-[left]",
              available ? "left-[22px]" : "left-0.5",
            )}
          />
        </span>
      </button>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{COPY.profile.form.portfolioLabel}</span>
        <p className="-mt-1 text-sm text-foreground-muted">{COPY.profile.form.portfolioHelp}</p>
        <div className="grid grid-cols-3 gap-2">
          {portfolio.map((item, index) => (
            <div key={item.kind === "existing" ? item.path : item.previewUrl} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview local / URL pública de post-media */}
              <img
                src={item.kind === "existing" ? item.url : item.previewUrl}
                alt={`Trabajo ${index + 1}`}
                className="size-full rounded-md object-cover"
              />
              <button
                type="button"
                aria-label={COPY.publish.steps.photos.remove}
                onClick={() => removePhoto(index)}
                className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-media-scrim text-on-media focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          {portfolio.length < MAX_PHOTOS && (
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
              <span className="text-xs font-semibold">{COPY.publish.steps.photos.add}</span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={COPY.publish.steps.photos.add}
          onChange={(event) => addPhotos(event.target.files)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button variant="primary" size="lg" className="w-full" loading={submitting} onClick={handleSubmit}>
        {submitting ? COPY.profile.saving : COPY.profile.save}
      </Button>
    </div>
  );
}

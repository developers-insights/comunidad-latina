"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { submitReview } from "@/app/(app)/creadores/actions";
import { COPY } from "./copy";

/**
 * Formulario de reseña (aparece solo cuando el contrato está liberado y esta
 * parte todavía no reseñó). Estrellas 1–5 + texto. Al enviar, refresca la
 * página para mostrar la reseña ya dejada.
 */
export function ReviewForm({ contractId, rateeName }: { contractId: string; rateeName: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (rating < 1) {
      setError(COPY.reviews.errors.ratingRequired);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitReview({ contractId, rating, body: body.trim() || null });
      if (!result.ok) {
        if (result.needsAuth) {
          router.push("/entrar");
          return;
        }
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError(COPY.reviews.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  const active = hover || rating;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-display text-base font-bold text-foreground">{COPY.reviews.yourReview}</p>
        <p className="text-sm text-foreground-secondary">
          {COPY.reviews.rateLabel} <span className="font-medium text-foreground">{rateeName}</span>
        </p>
      </div>

      <div className="flex items-center gap-1" role="radiogroup" aria-label={COPY.reviews.rateLabel}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={COPY.reviews.starLabel(value)}
              onClick={() => setRating(value)}
              onMouseEnter={() => setHover(value)}
              onMouseLeave={() => setHover(0)}
              className="touch-hitbox rounded-sm p-0.5 transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              <Star
                size={32}
                weight={value <= active ? "fill" : "regular"}
                className={cn(value <= active ? "text-warning" : "text-border")}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <Field htmlFor="review-body" label={COPY.reviews.bodyLabel} optional>
        <Textarea
          id="review-body"
          rows={3}
          value={body}
          maxLength={1000}
          placeholder={COPY.reviews.bodyPlaceholder}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button variant="primary" className="w-full" loading={submitting} onClick={handleSubmit}>
        {submitting ? COPY.reviews.submitting : COPY.reviews.submit}
      </Button>
    </div>
  );
}

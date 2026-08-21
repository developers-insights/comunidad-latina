"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { Button, Field, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { submitReview } from "@/app/(app)/creadores/actions";
import { COPY } from "./copy";

/**
 * Formulario de reseña (aparece solo cuando el contrato está liberado y esta
 * parte todavía no reseñó). Estrellas 1–5 + texto. Al enviar, refresca la
 * página para mostrar la reseña ya dejada.
 *
 * ── SI LA SESIÓN SE CAYÓ, NO SE PIERDE LA RESEÑA (cliente 2026-08-20) ───────
 * Acá no llega gente anónima —el formulario aparece sobre un contrato propio ya
 * liberado—, pero una sesión sí puede vencerse mientras se escribe. Antes eso
 * era un `router.push("/entrar")` en el peor momento posible: la reseña escrita
 * desaparecía con el componente y había que volver a redactarla de memoria.
 * Ahora la puerta se abre encima, el formulario sigue montado con las estrellas
 * y el texto donde estaban, y al entrar el envío se reintenta solo.
 */
export function ReviewForm({ contractId, rateeName }: { contractId: string; rateeName: string }) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
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
          // El reintento vuelve a entrar por `handleSubmit`: no hay guard de
          // anónimo que revisar —quién reseña lo deriva el server de la
          // cookie—, así que no puede reabrir la hoja en bucle.
          requireAuth({
            reason: AUTH_REASON.review,
            onAuthenticated: () => void handleSubmit(),
          });
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

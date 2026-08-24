"use client";

import { useState, useTransition } from "react";
import { BookmarkSimple } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { useToast } from "@/components/ui";
import { toggleSaveAction } from "@/app/(app)/feed/engagement-actions";
import { cn } from "@/lib/utils";

/**
 * "GUARDAR" de una oferta (spec cliente: Ver oferta · Guardar · Contactar).
 *
 * ── NO INVENTA UN "GUARDADOS DE OFERTAS" ────────────────────────────────────
 * Escribe en `saves` con `subject_kind = 'post'`, que es la MISMA tabla y el
 * mismo sujeto que usa el botón de guardar del feed. Es la consecuencia directa
 * de que la oferta sea una sola fila: guardarla desde acá y guardarla desde la
 * publicación son el mismo acto, y aparecen juntas en /guardados. Una segunda
 * lista de "ofertas guardadas" habría sido el primer lugar donde el modelo de
 * "una sola publicación" se rompía en la práctica.
 *
 * ── SIN SESIÓN NO SE NAVEGA ─────────────────────────────────────────────────
 * Se abre la hoja de sesión ENCIMA de la lista y, al volver, el guardado se
 * reintenta solo (cliente 2026-08-20: "mientras menos pasos mejor"). Se reanuda
 * con `aplicar` y no con `alternar`, porque el closure de antes de entrar sigue
 * creyendo que no hay sesión y reabriría la hoja en bucle — mismo bug que ya
 * documentó `post-actions.tsx`.
 *
 * El estado es OPTIMISTA y se revierte si el server dice que no: una UI que
 * muestra "guardado" sobre algo que no se guardó miente sobre lo que la persona
 * va a encontrar después en su lista.
 */

const COPY = {
  guardar: "Guardar",
  guardada: "Guardada",
  errorTitulo: "No pudimos guardarla",
  errorCuerpo: "No es culpa tuya. Probá de nuevo en un ratito.",
} as const;

export interface GuardarOfertaProps {
  postId: string;
  /** Lo que sabía el servidor al renderizar. */
  guardadaInicialmente?: boolean;
  /** `null` = sin sesión: el primer toque abre la hoja en vez de escribir. */
  viewerId: string | null;
  className?: string;
}

export function GuardarOferta({
  postId,
  guardadaInicialmente = false,
  viewerId,
  className,
}: GuardarOfertaProps) {
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const [guardada, setGuardada] = useState(guardadaInicialmente);
  const [, startTransition] = useTransition();

  function pedirSesion(siguiente: boolean) {
    requireAuth({
      reason: AUTH_REASON.save,
      onAuthenticated: () => aplicar(siguiente),
    });
  }

  function aplicar(siguiente: boolean) {
    if (siguiente === guardada) return;
    setGuardada(siguiente);

    startTransition(async () => {
      const resultado = await toggleSaveAction({
        subjectKind: "post",
        subjectId: postId,
        save: siguiente,
      });
      if (resultado.ok) {
        // El server manda: si ya estaba guardada (doble toque veloz), su
        // respuesta es la verdad y el optimismo se alinea sin parpadeo.
        setGuardada(resultado.saved);
        return;
      }
      setGuardada(!siguiente);
      if (resultado.code === "unauthenticated") {
        pedirSesion(siguiente);
        return;
      }
      toast({ title: COPY.errorTitulo, description: COPY.errorCuerpo, variant: "danger" });
    });
  }

  function alternar() {
    const siguiente = !guardada;
    if (!viewerId) {
      pedirSesion(siguiente);
      return;
    }
    aplicar(siguiente);
  }

  return (
    <button
      type="button"
      aria-pressed={guardada}
      onClick={alternar}
      className={cn(
        "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold",
        "transition-[transform,background-color,border-color,color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        guardada
          ? "border-brand bg-brand-tint text-brand-ink"
          : "border-border-subtle bg-surface text-foreground hover:border-brand hover:bg-brand-tint hover:text-brand-ink",
        className,
      )}
    >
      <BookmarkSimple
        size={17}
        weight={guardada ? "fill" : "regular"}
        aria-hidden="true"
        className="shrink-0"
      />
      {/* La palabra cambia con el estado: `aria-pressed` solo no alcanza en un
          botón cuyo ícono relleno y vacío se parecen a 17px. */}
      <span className="truncate">{guardada ? COPY.guardada : COPY.guardar}</span>
    </button>
  );
}

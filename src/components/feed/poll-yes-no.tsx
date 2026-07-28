"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { m, useReducedMotion } from "motion/react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { votePostPollAction } from "@/app/(app)/feed/engagement-actions";
import { COPY } from "./copy";
import { pollPercent, type PostPollView } from "./helpers";

/**
 * ENCUESTA SÍ / NO de una pregunta (feedback cliente 2026-07-27: "viene la
 * pregunta así en grande, y acá viene sí o no, y viene el cuadro así para irse
 * llenando los votos… sale 30 sí, 50 no").
 *
 * Decisiones que valen la pena conocer antes de tocar el archivo:
 *
 *  · UN SOLO CONTROL, DOS ESTADOS. Los botones "Sí" y "No" no se reemplazan por
 *    barras al votar: SON las barras. Se llenan. Así cambiar el voto es tocar la
 *    otra opción —sin un "cambiar voto" aparte— y el layout nunca salta.
 *
 *  · RESULTADOS AL VOTAR. Antes de votar se ve cuánta gente participó, no cómo
 *    se reparte: saber el resultado de antemano sesga la respuesta (y hace que
 *    mucha gente ni vote). El AUTOR es la excepción — preguntó él, no tiene por
 *    qué votarse para leer su propia encuesta.
 *
 *  · NO ES SOLO COLOR. La opción elegida suma un ✓ y una barra más marcada; el
 *    estado real viaja en `aria-pressed`. Nada depende de distinguir dos tintes.
 *
 *  · LOS CONTADORES SON DE LA DB. `poll_yes_count` / `poll_no_count` los mantiene
 *    el trigger de la 0041: acá se leen y se estiman en optimista, jamás se
 *    escriben. La respuesta del servidor pisa la estimación apenas llega.
 */

/** Dos tintas: sobre el banner de la pregunta (media) o sobre la card (surface). */
export type PollTone = "media" | "surface";

const TONE = {
  media: {
    track: "bg-on-media/12",
    fill: "bg-on-media/28",
    fillChosen: "bg-on-media/45",
    border: "border-on-media/25",
    borderChosen: "border-on-media/55",
    text: "text-on-media",
    muted: "text-on-media/75",
    ring: "focus-visible:ring-on-media/60",
  },
  surface: {
    track: "bg-surface-subtle",
    fill: "bg-brand/12",
    fillChosen: "bg-brand/22",
    border: "border-border",
    borderChosen: "border-brand",
    text: "text-foreground",
    muted: "text-foreground-muted",
    ring: "focus-visible:ring-focus-ring",
  },
} as const satisfies Record<PollTone, Record<string, string>>;

export interface PollYesNoProps {
  postId: string;
  poll: PostPollView;
  /** id del usuario logueado, o null si es anónimo (votar lo lleva a entrar). */
  viewerId: string | null;
  /** El autor de la pregunta ve los resultados sin tener que votar. */
  isAuthor?: boolean;
  tone?: PollTone;
  className?: string;
}

export function PollYesNo({
  postId,
  poll,
  viewerId,
  isAuthor = false,
  tone = "media",
  className,
}: PollYesNoProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const reduce = useReducedMotion();

  const [vote, setVote] = useState<boolean | null>(poll.myVote);
  const [counts, setCounts] = useState({ yes: poll.yes, no: poll.no });
  const [, startTransition] = useTransition();
  /**
   * Dos toques seguidos (Sí → No) disparan dos requests: la respuesta que
   * vuelve segunda puede no ser la del último toque. Este contador descarta las
   * respuestas viejas para que la UI no retroceda sola.
   */
  const requestRef = useRef(0);

  const skin = TONE[tone];
  const total = counts.yes + counts.no;
  const revealed = vote !== null || isAuthor;
  // El segundo porcentaje se deriva del primero: así el par siempre suma 100 y
  // nunca se lee "51% / 50%" por dos redondeos independientes.
  const yesPercent = pollPercent(counts.yes, total);
  const noPercent = total > 0 ? 100 - yesPercent : 0;

  function castVote(choice: boolean) {
    if (!viewerId) {
      router.push(`/entrar?next=${encodeURIComponent(pathname || "/feed")}`);
      return;
    }
    if (choice === vote) return; // ya es su voto: nada que registrar

    const previous = { vote, counts };
    // Optimista: mover el voto de un balde al otro (o sumarlo si es el primero).
    setVote(choice);
    setCounts((current) => ({
      yes: Math.max(0, current.yes + (choice ? 1 : 0) - (previous.vote === true ? 1 : 0)),
      no: Math.max(0, current.no + (choice ? 0 : 1) - (previous.vote === false ? 1 : 0)),
    }));
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    const request = ++requestRef.current;
    startTransition(async () => {
      const result = await votePostPollAction({ postId, choice });
      if (request !== requestRef.current) return; // llegó tarde: ya hay otro voto

      if (result.ok) {
        setVote(result.choice);
        // El trigger es la verdad: si pudo releer, la estimación se alinea.
        if (result.yes !== null && result.no !== null) {
          setCounts({ yes: result.yes, no: result.no });
        }
        return;
      }

      // La UI no puede quedarse mostrando un voto que no existe.
      setVote(previous.vote);
      setCounts(previous.counts);
      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(pathname || "/feed")}`);
        return;
      }
      // "Estás mirando otra comunidad" tiene su propio copy, ya resuelto por el
      // guard: decirle "probá de nuevo" a alguien cuyo problema es la comunidad
      // lo manda a reintentar algo que nunca va a funcionar.
      if (result.code === "tenant-mismatch") {
        toast({
          title: TENANT_GUARD_COPY.mismatchTitle,
          description: result.message,
          variant: "warning",
          duration: 8000,
        });
        return;
      }
      toast({
        title: COPY.post.poll.errorTitle,
        description: COPY.post.poll.errorBody,
        variant: "danger",
      });
    });
  }

  function option(choice: boolean) {
    const chosen = vote === choice;
    const percent = choice ? yesPercent : noPercent;
    const votes = choice ? counts.yes : counts.no;
    return (
      <button
        type="button"
        onClick={() => castVote(choice)}
        aria-pressed={chosen}
        // El nombre accesible dice la ACCIÓN y, una vez revelados, también el
        // resultado: si no, quien usa lector de pantalla oiría "Votar que sí,
        // presionado" y se perdería justo el dato que la encuesta existe para dar.
        aria-label={[
          choice ? COPY.post.poll.voteYes : COPY.post.poll.voteNo,
          revealed ? COPY.post.poll.result(votes, percent) : null,
        ]
          .filter(Boolean)
          .join(" — ")}
        className={cn(
          // `cursor-pointer` explícito: Tailwind no le pone puntero a un
          // <button> por default (a diferencia de <a>, que sí lo trae del
          // navegador) — sin esto, el botón vota igual pero se siente al
          // revés: la mano aparece en el link invisible de alrededor y la
          // flecha justo encima del control que sí hace algo.
          "relative isolate flex min-h-11 w-full cursor-pointer items-center overflow-hidden rounded-full border",
          "px-4 text-left transition-[transform,border-color,background-color]",
          "duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.985]",
          "focus-visible:outline-none focus-visible:ring-[3px]",
          skin.track,
          skin.text,
          skin.ring,
          chosen ? skin.borderChosen : skin.border,
        )}
      >
        {/* Relleno de resultados. Se anima con scaleX (transform, no width) para
            que la barra crezca sin recalcular layout en cada frame. */}
        <m.span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 -z-10 w-full origin-left rounded-full",
            chosen ? skin.fillChosen : skin.fill,
          )}
          initial={false}
          animate={{ scaleX: revealed ? percent / 100 : 0 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.55, ease: [0.32, 0.72, 0, 1] }
          }
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold">
          <Check
            size={16}
            weight="bold"
            aria-hidden="true"
            className={cn(
              "shrink-0 transition-opacity duration-(--duration-fast)",
              chosen ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="truncate">
            {choice ? COPY.post.poll.yes : COPY.post.poll.no}
          </span>
        </span>
        {revealed && (
          <span className={cn("numeric shrink-0 pl-2 text-sm", skin.muted)}>
            {COPY.post.poll.result(votes, percent)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={COPY.post.poll.groupLabel}
      className={cn("w-full", className)}
    >
      <div className="flex flex-col gap-2">
        {option(true)}
        {option(false)}
      </div>
      <p
        aria-live="polite"
        className={cn("mt-2 text-center text-xs", skin.muted)}
      >
        {total === 0
          ? COPY.post.poll.noVotesYet
          : vote !== null
            ? `${COPY.post.poll.totalVotes(total)} · ${COPY.post.poll.changeHint}`
            : COPY.post.poll.totalVotes(total)}
      </p>
    </div>
  );
}

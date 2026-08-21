"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  PaperPlaneRight,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import type { SendListingMessageResult } from "@/app/(app)/mensajes/inline-actions";

/**
 * CONTACTAR SIN CAMBIAR DE PANTALLA — el primitivo compartido.
 *
 * Feedback del cliente 2026-08-20: "ahí nomás dentro de pantalla se tiene que
 * fluir sin sacarte del feed; si no es como que te corta el mambo. Mientras
 * menos pasos mejor". Hasta hoy "Contactar" hacía `router.push('/mensajes')` —
 * a la bandeja GENÉRICA, ni siquiera al hilo— así que la persona perdía el
 * aviso que estaba mirando, el scroll del listado y el filtro que había puesto.
 *
 * `listings/inline-message-cta` ya había resuelto esto bien para marketplace y
 * eventos. El problema era que convivía con tres pantallas que hacían lo
 * contrario. Este archivo es ese patrón extraído tal cual, para que las cuatro
 * digan lo mismo: se escribe donde estás, se confirma donde estás, y el hilo es
 * una OPCIÓN al final —nunca un peaje.
 *
 * ── POR QUÉ LA CONFIRMACIÓN ES UN COMPONENTE APARTE ─────────────────────────
 * `ContactDone` se exporta solo porque hay un caso que no puede tener composer:
 * escribirle a un candidato. `sendMessageAction` exige la conversación en
 * `accepted` y la que abre el empleador nace `pending`, así que ahí no hay
 * primer mensaje que mandar — solo hilo que abrir. Ese caso reusa la MISMA
 * confirmación en vez de inventarse una: el "listo" tiene que verse igual en
 * las cuatro pantallas o vuelven a ser cuatro productos distintos.
 *
 * ── HONESTIDAD SOBRE LO QUE PASÓ (requisito, no detalle) ────────────────────
 * `reused` distingue "abrimos algo nuevo" de "ya venían hablando". Cuando la
 * action lo sabe, el texto lo dice. Fingir un alta nueva sobre una conversación
 * que ya existía es exactamente el defecto que la revisión encontró en otro
 * módulo de este repo: la persona festeja un contacto que nunca ocurrió.
 */

/** Lo que una server action le devuelve a este componente, ya traducido. */
export type InlineContactOutcome =
  | {
      ok: true;
      /** Para linkear al hilo exacto. Sin él, el link cae a /mensajes. */
      conversationId?: string | null;
      /**
       * `true` = la conversación YA existía y el mensaje se sumó ahí.
       * `undefined` = la action no lo informa; entonces NO se afirma nada:
       * se usa el texto neutro, que es cierto en los dos casos.
       */
      reused?: boolean;
    }
  | {
      ok: false;
      /** Frase humana, ya elegida por quien llama. Nunca un code en pantalla. */
      message: string;
      /** Se venció la sesión: ofrecemos entrar y reintentar en el lugar. */
      needsAuth?: boolean;
      /** Cerrar el composer (ej. el aviso es tuyo: no hay nada que escribir). */
      collapse?: boolean;
    };

export interface InlineContactCopy {
  /** Etiqueta del botón colapsado ("Contactar", "Mensaje"…). */
  trigger: string;
  fieldLabel: string;
  placeholder: string;
  send: string;
  cancel: string;
  /** Aclaración de seguridad. Se ve siempre, colapsado y abierto. */
  hint: string;
  sentTitle: string;
  sentBody?: string;
  /** Textos para `reused: true`. Sin ellos se cae a los de alta nueva. */
  reusedTitle?: string;
  reusedBody?: string;
  /** Acción secundaria de la confirmación: ir al hilo si la persona quiere. */
  threadLink: string;
  /** Botón del error de sesión vencida. */
  retryLogin: string;
}

/** Los códigos que devuelve `sendListingMessageAction`, con su frase humana. */
export type ListingMessageErrorCopy = Record<
  "unauthenticated" | "tenant-mismatch" | "self" | "blocked" | "invalid" | "error",
  string
> &
  /**
   * Opcionales a propósito: `rate-limited` y `flagged` llegaron después (techo
   * y moderación del mensaje, auditoría 2026-08-20) y volverlos obligatorios
   * habría roto de golpe a las cuatro pantallas que ya pasaban su mapa. Quien
   * quiera decirlo con sus palabras los define; quien no, hereda el texto de
   * abajo, que ya es honesto.
   */
  Partial<Record<"rate-limited" | "flagged", string>>;

/**
 * Lo que se dice cuando la pantalla no trajo su propia frase.
 *
 * Ninguna de las dos culpa a la persona ni le explica cómo está hecho el
 * sistema: una dice que fue demasiado seguido, la otra que ese texto no se
 * pudo mandar. "Moderación" y "límite de tasa" no significan nada del otro
 * lado.
 */
const FALLBACK_ERROR_COPY: Record<"rate-limited" | "flagged", string> = {
  "rate-limited":
    "Mandaste varios mensajes seguidos. Esperá un ratito y volvé a intentar.",
  flagged:
    "Este mensaje no se pudo enviar. Probá escribirlo de otra manera.",
};

/**
 * Traduce el resultado del action al contrato del composer.
 *
 * El texto sale del mapa que pasa cada pantalla y NUNCA de `result.message`:
 * "es tu propia publicación" y "este perfil es tuyo" son el mismo código y dos
 * frases distintas, y quien las elige es la pantalla que se está mirando.
 *
 * Un código desconocido cae en `error` en vez de romper: el contrato del action
 * puede crecer sin dejar a nadie con una pantalla muda.
 */
export function listingMessageOutcome(
  result: SendListingMessageResult,
  errors: ListingMessageErrorCopy,
): InlineContactOutcome {
  if (result.ok) {
    return {
      ok: true,
      conversationId: result.conversationId,
      reused: result.reused,
    };
  }
  const code = result.code;
  const message =
    errors[code as keyof ListingMessageErrorCopy] ??
    FALLBACK_ERROR_COPY[code as keyof typeof FALLBACK_ERROR_COPY] ??
    errors.error;
  return {
    ok: false,
    message,
    needsAuth: code === "unauthenticated",
    // El aviso propio no es un error para reintentar: se cierra el composer.
    collapse: code === "self",
  };
}

const MAX_LENGTH = 2000;

/** Alto máximo del textarea antes de scrollear adentro (5 líneas cómodas). */
const MAX_TEXTAREA_HEIGHT = 160;

export interface ContactDoneProps {
  title: string;
  body?: string;
  /** Texto del link al hilo. */
  linkLabel: string;
  /** Hilo exacto. Sin él, el link cae a la bandeja. */
  conversationId?: string | null;
  className?: string;
}

/**
 * El "listo" que reemplaza a la navegación.
 *
 * `role="status"` y no un toast a secas: acá NO hay cambio de ruta, así que un
 * lector de pantalla no tiene nada que le avise que la acción salió. La región
 * viva es la única confirmación que recibe quien no ve la pantalla.
 */
export function ContactDone({
  title,
  body,
  linkLabel,
  conversationId,
  className,
}: ContactDoneProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-success/20 bg-success-bg px-4 py-3",
        className,
      )}
    >
      <p className="flex items-start gap-2 text-sm font-semibold text-success-ink">
        <CheckCircle
          size={18}
          weight="fill"
          aria-hidden="true"
          className="mt-px shrink-0 text-success"
        />
        {title}
      </p>
      {body && (
        <p className="pl-[1.625rem] text-sm leading-relaxed text-success-ink/80">
          {body}
        </p>
      )}
      <Link
        href={conversationId ? `/mensajes/${conversationId}` : "/mensajes"}
        className={cn(
          // min-h-11 = 44px de área táctil: es un link chico, pero se toca con
          // el pulgar igual que cualquier botón.
          "inline-flex min-h-11 w-fit items-center gap-1 pl-[1.625rem] text-sm font-semibold text-foreground",
          "underline underline-offset-2",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {linkLabel}
        <ArrowRight size={14} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

export interface InlineContactProps {
  /**
   * Manda el primer mensaje. SIEMPRE una server action que ya existe: la
   * identidad la deriva el servidor de la sesión, nunca de un parámetro que
   * viaje desde acá.
   */
  onSend: (body: string) => Promise<InlineContactOutcome>;
  /**
   * Lo que sabía el SERVIDOR al renderizar. Solo decide si el primer toque
   * abre la hoja de sesión; una vez abierta la hoja, deja de mandar (ver
   * `openComposer`).
   *
   * ── `"unknown"`: LA PANTALLA NO PUEDE SABERLO (2026-08-21) ────────────────
   * Lo estrena la ficha del feed (`feed/feed-listing-card`), que se monta desde
   * `renderFeedItem` con el modelo del aviso y NADA más: ahí no llega el viewer,
   * y ese cableado es de otro frente. Las opciones eran dos, y las dos malas:
   * decir `false` —y abrirle la hoja de sesión a quien YA entró, que es el paso
   * de más que este cambio vino a borrar— o decir `true`, que es afirmar algo
   * que no se sabe y que el próximo que lea el archivo va a creer.
   *
   * `"unknown"` no gatea nada: el composer abre y la SERVER ACTION decide, que
   * es la única que tiene la sesión de verdad. Si no hay, vuelve
   * `unauthenticated` y el error inline ofrece entrar y reintenta con el texto
   * ya escrito — el mismo camino que la sesión vencida, que tampoco se puede
   * prever desde el render.
   *
   * Para `true` y `false` no cambia NADA: la comparación de abajo es explícita
   * contra `false`, así que las siete pantallas que ya pasan un booleano se
   * comportan igual que antes.
   */
  isLoggedIn: boolean | "unknown";
  copy: InlineContactCopy;
  /** Se dispara al ABRIR el composer. Acá va la métrica del clic en el CTA. */
  onOpen?: () => void;
  /** Nombre accesible del disparador cuando "Contactar" solo no alcanza. */
  triggerAriaLabel?: string;
  triggerSize?: "md" | "lg";
  triggerIcon?: ReactNode;
  className?: string;
}

export function InlineContact({
  onSend,
  isLoggedIn,
  copy,
  onOpen,
  triggerAriaLabel,
  triggerSize = "lg",
  triggerIcon,
  className,
}: InlineContactProps) {
  const requireAuth = useRequireAuth();
  const fieldId = useId();
  const formId = useId();
  const triggerId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [phase, setPhase] = useState<"idle" | "open" | "sent">("idle");
  const [value, setValue] = useState("");
  const [error, setError] = useState<{ text: string; needsAuth: boolean } | null>(
    null,
  );
  const [done, setDone] = useState<{
    conversationId?: string | null;
    reused?: boolean;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * El camino autenticado, DIRECTO. Nunca vuelve a mirar `isLoggedIn`: cuando
   * lo llama `onAuthenticated` corre en el closure de ANTES de entrar, así que
   * esa prop todavía vale lo que valía para un anónimo y volver a pasar por el
   * guard reabriría la hoja en bucle (mismo reparto que `toggleSave`/`applySave`
   * en feed/post-actions).
   */
  function openComposer() {
    setError(null);
    setPhase("open");
    onOpen?.();
    // El foco llega después de que React monte el textarea.
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  /** El guard, y solo acá. Solo un `false` explícito gatea (ver `isLoggedIn`). */
  function handleTrigger() {
    if (isLoggedIn === false) {
      requireAuth({ reason: AUTH_REASON.message, onAuthenticated: openComposer });
      return;
    }
    openComposer();
  }

  function collapse() {
    setPhase("idle");
    setError(null);
    // Por id y no por ref: `Button` no declara `ref` en sus props, y el botón
    // recién vuelve a existir en el DOM en el próximo render.
    window.setTimeout(() => document.getElementById(triggerId)?.focus(), 0);
  }

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  function send(body: string) {
    startTransition(async () => {
      const result = await onSend(body);

      if (result.ok) {
        setValue("");
        setError(null);
        setDone({ conversationId: result.conversationId, reused: result.reused });
        setPhase("sent");
        try {
          navigator.vibrate?.(10);
        } catch {
          // Sin soporte háptico no hay nada que hacer, y no es un error.
        }
        return;
      }

      setError({ text: result.message, needsAuth: result.needsAuth === true });
      if (result.collapse) setPhase("idle");
    });
  }

  function submit() {
    const body = value.trim();
    if (!body || isPending) return;
    send(body);
  }

  if (phase === "sent") {
    const reused = done?.reused === true;
    return (
      <ContactDone
        className={className}
        title={(reused && copy.reusedTitle) || copy.sentTitle}
        body={reused ? (copy.reusedBody ?? copy.sentBody) : copy.sentBody}
        linkLabel={copy.threadLink}
        conversationId={done?.conversationId}
      />
    );
  }

  return (
    <div className={className}>
      {phase === "idle" ? (
        <>
          <Button
            id={triggerId}
            variant="primary"
            size={triggerSize}
            className="w-full"
            // Sin `aria-controls`: mientras está colapsado el composer no
            // existe en el DOM, y apuntar a un id ausente es un atributo ARIA
            // inválido — peor que no ponerlo.
            aria-expanded={false}
            aria-label={triggerAriaLabel}
            onClick={handleTrigger}
          >
            {triggerIcon}
            {copy.trigger}
          </Button>
          <p className="mt-1.5 text-center text-xs text-foreground-muted">
            {copy.hint}
          </p>
        </>
      ) : (
        <div
          id={formId}
          onKeyDown={(event) => {
            // Escape cierra y devuelve el foco al botón: el composer se comió
            // el foco al abrirse, y dejarlo suelto en el body obliga a
            // retabular la pantalla entera para volver.
            if (event.key === "Escape" && !isPending) {
              event.stopPropagation();
              collapse();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
          >
            <label htmlFor={fieldId} className="sr-only">
              {copy.fieldLabel}
            </label>
            <textarea
              id={fieldId}
              ref={textareaRef}
              rows={1}
              maxLength={MAX_LENGTH}
              value={value}
              placeholder={copy.placeholder}
              disabled={isPending}
              onChange={(event) => {
                setValue(event.target.value);
                autosize(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              className={cn(
                "max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-foreground",
                "placeholder:text-foreground-muted focus:outline-none",
                "disabled:opacity-60",
              )}
            />
            <button
              type="submit"
              aria-label={copy.send}
              disabled={isPending || value.trim().length === 0}
              className={cn(
                "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs",
                "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:bg-brand-hover active:scale-[0.94]",
                "disabled:pointer-events-none disabled:opacity-45",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              {isPending ? (
                <Spinner size={18} />
              ) : (
                <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
              )}
            </button>
          </form>

          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className="text-xs text-foreground-muted">{copy.hint}</p>
            <button
              type="button"
              onClick={collapse}
              className={cn(
                "shrink-0 text-xs font-semibold text-foreground-secondary underline underline-offset-2",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error.text}{" "}
          {error.needsAuth && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              onClick={() => {
                const body = value.trim();
                requireAuth({
                  reason: AUTH_REASON.message,
                  // Reintento DIRECTO: `send` no vuelve a pasar por ningún
                  // guard de cliente. Quien decide si esa sesión puede escribir
                  // es la server action, con el usuario del servidor.
                  onAuthenticated: () => {
                    if (body) send(body);
                    else openComposer();
                  },
                });
              }}
            >
              {copy.retryLogin}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

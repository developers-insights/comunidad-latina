"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { CodigoDeLlamada } from "@/lib/calls/errores";
import { COPY } from "./copy";
import { mensajeDeFallo } from "./hoja-agregar";

export interface BotonesDeLlamadaProps {
  /** Llamada de a dos. Excluyente con `groupId`. */
  profileId?: string;
  /** Llamada de un grupo de chat. */
  groupId?: string;
  onIniciar: (input: {
    kind: "audio" | "video";
    profileId?: string;
    groupId?: string;
  }) => Promise<{ ok: true; callId: string } | { ok: false; code: CodigoDeLlamada }>;
  className?: string;
}

/**
 * Los dos botones de llamar que van en la cabecera de un chat.
 *
 * ── POR QUÉ DESAPARECEN EN VEZ DE DESHABILITARSE ────────────────────────────
 * Sin `NEXT_PUBLIC_AGORA_APP_ID` no hay llamadas posibles, y un teléfono gris
 * que no hace nada es peor que no tener teléfono: invita a tocarlo. Es la misma
 * degradación que el resto del repo (§7 de ARQUITECTURA): la falta de una
 * credencial apaga la función, no la deja a medias.
 *
 * El App ID es público —viaja igual en el `join()` del navegador— así que
 * mirarlo desde el cliente no filtra nada. El certificado, que sí es secreto, no
 * se puede ni consultar desde acá, y por eso la comprobación completa la hace el
 * endpoint del token: si falta esa mitad, el botón existe y la pantalla dice
 * "estamos terminando de configurar las llamadas" en vez de romperse.
 *
 * ⚠️ TRAMPA DE DEPLOY: en el bundle del navegador un `NEXT_PUBLIC_*` no se lee
 * en runtime — se REEMPLAZA por su valor durante `next build`. O sea que
 * agregar `NEXT_PUBLIC_AGORA_APP_ID` en Vercel no hace aparecer estos botones:
 * hay que volver a construir. (Del lado del servidor sí se lee en runtime, y
 * por eso `/api/llamadas/token` puede pasar de 503 a 401 sin rebuild — se
 * verificó con dos `next start`, uno con la variable y otro sin ella.)
 */
export function BotonesDeLlamada({
  profileId,
  groupId,
  onIniciar,
  className,
}: BotonesDeLlamadaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [llamando, iniciar] = useTransition();

  if (!process.env.NEXT_PUBLIC_AGORA_APP_ID) return null;

  function llamar(kind: "audio" | "video") {
    if (llamando) return;
    iniciar(async () => {
      const resultado = await onIniciar({
        kind,
        ...(profileId ? { profileId } : {}),
        ...(groupId ? { groupId } : {}),
      });

      if (!resultado.ok) {
        const { title, body } = mensajeDeFallo(resultado.code);
        toast({ title, description: body, variant: "danger" });
        return;
      }

      // `entrar=1` marca que esto vino de un gesto: es lo que autoriza a la
      // pantalla a pedir micrófono sola. `agregar=1` abre la hoja de personas en
      // una llamada de grupo, donde todavía no hay a quién hacerle sonar nada.
      const extra = groupId ? "&agregar=1" : "";
      router.push(`/llamadas/${resultado.callId}?entrar=1${extra}`);
    });
  }

  const estilo = cn(
    "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full",
    "text-foreground-secondary transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
    "hover:bg-surface-subtle hover:text-foreground active:scale-[0.94]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
  );

  return (
    <div className={cn("flex items-center", className)}>
      <button
        type="button"
        aria-label={COPY.iniciar.audioLabel}
        title={COPY.iniciar.audioLabel}
        disabled={llamando}
        onClick={() => llamar("audio")}
        className={estilo}
      >
        <Phone size={21} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={COPY.iniciar.videoLabel}
        title={COPY.iniciar.videoLabel}
        disabled={llamando}
        onClick={() => llamar("video")}
        className={estilo}
      >
        <VideoCamera size={21} aria-hidden="true" />
      </button>
    </div>
  );
}

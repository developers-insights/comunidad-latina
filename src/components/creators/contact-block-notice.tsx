"use client";

import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  CONTACT_BLOCK_COPY,
  contactBlockMessage,
  findContactMatches,
} from "@/lib/moderation/contact-block";

/**
 * AVISO DE DATOS DE CONTACTO, mientras se escribe (spec §6).
 *
 * Aparece ANTES de tocar enviar. La alternativa —dejar que la persona escriba
 * todo, envíe, y recién ahí rebotarla— es la misma cantidad de reglas con el
 * doble de frustración, y encima la lleva a pensar que el sistema está roto.
 *
 * NO es la frontera: la decisión de rechazar la toma el servidor (ver
 * `blockContactInfoIn` en creadores/actions.ts). Esto es cortesía, y por eso
 * comparte exactamente el mismo detector: si avisara con otra regla que la que
 * bloquea, habría textos que pasan el aviso y rebotan igual, que es peor que
 * no avisar.
 *
 * TONO: explica el porqué en una línea y ofrece la salida. Quien escribe su
 * teléfono en una propuesta casi siempre está tratando de agilizar, no de
 * evadir — el mensaje tiene que tratarlo así.
 */
export function ContactBlockNotice({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const matches = findContactMatches(text);
  if (matches.length === 0) return null;

  const kinds = [...new Set(matches.map((match) => match.kind))];

  return (
    <div
      // `polite`: se anuncia sin interrumpir lo que la persona está tipeando.
      role="status"
      aria-live="polite"
      className={cn(
        "flex gap-2.5 rounded-md border-l-4 border-warning bg-warning-bg px-3 py-2.5",
        className,
      )}
    >
      <ShieldCheck
        size={18}
        weight="fill"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-warning"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{CONTACT_BLOCK_COPY.title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
          {contactBlockMessage(kinds)}
        </p>
      </div>
    </div>
  );
}

/** ¿El texto tiene datos de contacto? Para deshabilitar el envío. */
export function hasContactInfo(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => findContactMatches(value).length > 0);
}

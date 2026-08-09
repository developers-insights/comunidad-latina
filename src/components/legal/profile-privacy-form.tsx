"use client";

import { useState, useTransition } from "react";
import { ArrowCounterClockwise, Info } from "@phosphor-icons/react/dist/ssr";
import { updateProfilePrivacyAction } from "@/app/(app)/perfil/actions";
import {
  PRIVACY_BLOCKS,
  PRIVACY_DEFAULTS,
  PRIVACY_LEVELS,
  PRIVACY_LEVEL_LABEL,
  isDefaultPrivacy,
  type PrivacyKey,
  type PrivacyLevel,
  type PrivacySettings,
} from "@/lib/profile/privacy";
import { FormError } from "@/components/auth/form-error";
import { Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Quién ve cada parte de tu perfil.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA DECISIÓN DE DISEÑO: SE MUESTRA EL EFECTO, NO EL NOMBRE DEL NIVEL
 * ═══════════════════════════════════════════════════════════════════════════
 * "Público / Seguidores / Privado" son tres etiquetas que hay que traducir en
 * la cabeza, y la traducción sale mal seguido — mucha gente cree que "privado"
 * quiere decir "sólo mis contactos". Acá cada bloque muestra, EN VIVO y en una
 * frase, qué pasa con la opción que está elegida: «Nadie ve tu apellido. En el
 * perfil aparece solo tu nombre.» No hay nada que interpretar.
 *
 * La frase cambia al tocar, antes de guardar: es una previsualización, no una
 * confirmación. Poder ver la consecuencia sin comprometerse es lo que hace que
 * la gente pruebe la opción más cerrada en vez de dejar el default por miedo.
 *
 * ── DOS ADVERTENCIAS QUE NO DEPENDEN DEL NIVEL ELEGIDO ───────────────────────
 * La fecha de nacimiento NUNCA sale completa, ni en «Cualquiera», y las
 * publicaciones del feed se siguen viendo en el feed. Las dos van como `caveat`
 * permanente del bloque: son justo las cosas que alguien asumiría mal, y
 * enterarse después es lo que rompe la confianza.
 *
 * ── ESTO NO ES LA PRIVACIDAD ─────────────────────────────────────────────────
 * La privacidad la aplica `public.profile_card()` dentro de la base (0063): lo
 * que la configuración no permite vuelve NULL desde el servidor y no viaja al
 * cliente. Esta pantalla sólo escribe la fila. Si se borrara entera, no se
 * filtraría nada.
 */

const COPY = {
  heading: "Quién ve tu perfil",
  intro:
    "Elegí, bloque por bloque, qué muestra tu perfil y a quién. Podés cambiarlo cuando quieras.",
  levelsLabel: (block: string) => `Quién ve ${block.toLowerCase()}`,
  submit: "Guardar",
  saved: "Listo, tus controles quedaron guardados.",
  reset: "Volver a lo recomendado",
  resetHint: "Lo recomendado es lo más cerrado: apellido y edad solo para vos.",
  unsaved: "Tenés cambios sin guardar.",
} as const;

export interface ProfilePrivacyFormProps {
  initial: PrivacySettings;
}

export function ProfilePrivacyForm({ initial }: ProfilePrivacyFormProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState<PrivacySettings>(initial);
  const [saved, setSaved] = useState<PrivacySettings>(initial);
  const [formError, setFormError] = useState<string | null>(null);

  const dirty = PRIVACY_BLOCKS.some((block) => settings[block.key] !== saved[block.key]);
  const atDefaults = isDefaultPrivacy(settings);

  function set(key: PrivacyKey, level: PrivacyLevel) {
    setSettings((current) => ({ ...current, [key]: level }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await updateProfilePrivacyAction(settings);
      if (result.ok) {
        setSaved(settings);
        toast({ title: COPY.saved, variant: "success" });
        return;
      }
      setFormError(result.formError ?? null);
    });
  }

  return (
    <form
      id="perfil"
      method="post"
      onSubmit={onSubmit}
      className="scroll-mt-24 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <h2 className="font-display text-base font-bold text-foreground">{COPY.heading}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
        {COPY.intro}
      </p>

      <FormError>{formError}</FormError>

      <div className="mt-4 flex flex-col divide-y divide-border-subtle">
        {PRIVACY_BLOCKS.map((block) => {
          const level = settings[block.key];
          return (
            <fieldset key={block.key} className="flex flex-col gap-2 py-4 first:pt-0">
              <legend className="text-sm font-semibold text-foreground">
                {block.title}
              </legend>
              <p className="text-xs text-foreground-muted">{block.detail}</p>

              {/* Control segmentado. Radios de verdad —no botones— para que el
                  teclado los recorra con las flechas y el lector de pantalla
                  anuncie "1 de 3". El estado NO se comunica sólo por color: el
                  radio marcado ya lo dice, y debajo se lee el efecto. */}
              <div
                role="radiogroup"
                aria-label={COPY.levelsLabel(block.title)}
                className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-surface-subtle p-1"
              >
                {PRIVACY_LEVELS.map((option) => {
                  const id = `${block.key}-${option}`;
                  const active = level === option;
                  return (
                    <label
                      key={option}
                      htmlFor={id}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-center text-xs font-semibold",
                        "transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-(--ease-out-premium)",
                        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
                        active
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-foreground-secondary hover:text-foreground",
                      )}
                    >
                      <input
                        id={id}
                        type="radio"
                        name={block.key}
                        value={option}
                        checked={active}
                        disabled={pending}
                        onChange={() => set(block.key, option)}
                        className="sr-only"
                      />
                      {PRIVACY_LEVEL_LABEL[option]}
                    </label>
                  );
                })}
              </div>

              {/* EL EFECTO, en vivo. Es el punto entero de la pantalla. */}
              <p
                aria-live="polite"
                className="text-sm leading-relaxed text-foreground-secondary"
              >
                {block.effect[level]}
              </p>

              {block.caveat && (
                <p className="flex items-start gap-1.5 rounded-md bg-info-bg px-2.5 py-2 text-xs leading-relaxed text-foreground-secondary">
                  <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {block.caveat}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} disabled={!dirty}>
          {COPY.submit}
        </Button>
        {!atDefaults && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setSettings(PRIVACY_DEFAULTS)}
          >
            <ArrowCounterClockwise size={16} aria-hidden="true" />
            {COPY.reset}
          </Button>
        )}
      </div>

      {/* Aviso de cambios sin guardar: los radios se sienten instantáneos y sin
          esto la gente se va creyendo que ya quedó. */}
      <p aria-live="polite" className="mt-2 text-xs text-foreground-muted">
        {dirty ? COPY.unsaved : atDefaults ? COPY.resetHint : ""}
      </p>
    </form>
  );
}

import Link from "next/link";
import { ArrowRight, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import type { ProfileCard } from "./profile-card";

/**
 * "Todavía te falta esto" — la contracara de haber sacado campos del alta.
 *
 * ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
 * El alta pide dos campos nuevos y difiere cinco (ver la nota larga de
 * `(auth)/actions.ts`). Diferir sin pedir después no es diferir: es no pedir.
 * Este bloque es el otro lado del trato — la cuenta ya está creada, la persona
 * ya está adentro, y recién ahí se le muestra qué le falta y para qué sirve.
 *
 * ── LO QUE NO HACE ───────────────────────────────────────────────────────────
 * No hay barra de progreso ni "tu perfil está 60% completo". Un porcentaje
 * convierte datos personales en una tarea con nota, y presiona a completar cosas
 * que la persona puede tener buenas razones para no dar. Acá cada ítem dice qué
 * habilita, y quedarse sin completar ninguno es una opción legítima que no se
 * castiga con nada.
 *
 * Desaparece solo cuando no queda nada.
 */

const COPY = {
  title: "Completá tu perfil",
  body: "Cada dato que sumás hace que te encuentren las personas correctas. Todos son opcionales y elegís vos quién los ve.",
  cta: "Ir a editar mi perfil",
} as const;

interface MissingField {
  id: string;
  label: string;
}

/**
 * Qué falta. Se calcula sobre la ficha del PROPIO dueño, que es la única que
 * trae los campos privados completos.
 *
 * `bio` y `areaLabel` no entran: los pide el onboarding y no son parte de lo que
 * se difirió del alta — listarlos acá haría que el bloque le apareciera a
 * alguien que ya completó todo lo que se le pidió.
 */
export function missingProfileFields(card: ProfileCard): MissingField[] {
  const missing: MissingField[] = [];
  if (!card.username) missing.push({ id: "username", label: "Tu nombre de usuario" });
  if (!card.coverUrl) missing.push({ id: "cover", label: "Una foto de portada" });
  if (!card.birthdate) missing.push({ id: "birthdate", label: "Tu fecha de nacimiento" });
  if (!card.city && !card.countryResidence) {
    missing.push({ id: "location", label: "Dónde vivís" });
  }
  if (card.languages.length === 0) {
    missing.push({ id: "languages", label: "Los idiomas que hablás" });
  }
  return missing;
}

export function ProfileCompletion({ missing }: { missing: MissingField[] }) {
  if (missing.length === 0) return null;

  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <Sparkle size={20} weight="fill" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-foreground">
            {COPY.title}
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
            {COPY.body}
          </p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {missing.map((field) => (
          <li
            key={field.id}
            className="rounded-full bg-surface-subtle px-3 py-1.5 text-xs font-medium text-foreground-secondary"
          >
            {field.label}
          </li>
        ))}
      </ul>

      <Link
        href="#editar-perfil"
        className="group inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-brand-ink underline decoration-brand-subtle underline-offset-4 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        {COPY.cta}
        <ArrowRight
          size={16}
          aria-hidden="true"
          className="transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
        />
      </Link>
    </BezelCard>
  );
}

import Link from "next/link";
import { CaretRight, Compass } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { ASSISTANT_COPY as COPY } from "./copy";

/**
 * Acceso discreto al Asistente Comunitario (arriba del feed y donde haga
 * falta). Server-safe: solo Link + BezelCard, sin estado.
 */
export function AssistantEntryCard() {
  return (
    <Link
      href="/asistente"
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <BezelCard coreClassName="flex items-center gap-3 p-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <Compass size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {COPY.entry.title}
          </span>
          <span className="mt-0.5 block text-xs text-foreground-secondary">
            {COPY.entry.description}
          </span>
        </span>
        <CaretRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
        />
      </BezelCard>
    </Link>
  );
}

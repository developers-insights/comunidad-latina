import { ArrowSquareOut, GlobeSimple } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

export interface EnlaceExterno {
  href: string;
  dominio: string;
  detalle: string;
}

const HOSTS_LOCALES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "[::1]"]);

export function enlaceExternoDelCuerpo(body: string): EnlaceExterno | null {
  const value = body.trim();
  if (!value || /\s/.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!(["https:", "http:"] as const).includes(parsed.protocol as "https:" | "http:")) {
    return null;
  }
  if (parsed.username || parsed.password || HOSTS_LOCALES.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  const dominio = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!dominio) return null;

  const path = parsed.pathname === "/" ? "Enlace externo" : parsed.pathname;
  const detalle = path.length > 64 ? `${path.slice(0, 61)}…` : path;

  return { href: parsed.href, dominio, detalle };
}

export function ExternalLinkCard({
  enlace,
  className,
}: {
  enlace: EnlaceExterno;
  className?: string;
}) {
  return (
    <a
      href={enlace.href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      aria-label={`Abrir enlace externo de ${enlace.dominio}`}
      className={cn(
        "group flex min-h-16 items-center gap-3 rounded-xl bg-surface-raised px-3 py-2.5",
        "ring-1 ring-border-subtle",
        "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
        <GlobeSimple size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {enlace.dominio}
        </span>
        <span className="block truncate text-xs text-foreground-secondary">
          {enlace.detalle}
        </span>
      </span>
      <ArrowSquareOut
        size={18}
        aria-hidden="true"
        className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-spring) group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </a>
  );
}

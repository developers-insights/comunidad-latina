import Link from "next/link";
import { ArrowRight, ArrowsClockwise, Handshake, Lightning } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Billing, PriceBlock } from "./model";

const BILLING: Record<Billing, { badge: string; terms: string; Icon: typeof Lightning }> = {
  suscripcion: {
    badge: "Suscripción",
    terms: "Se renueva sola. Cancelás cuando quieras.",
    Icon: ArrowsClockwise,
  },
  unico: {
    badge: "Pago único",
    terms: "Pagás una vez. No se renueva.",
    Icon: Lightning,
  },
  por_trabajo: {
    badge: "Por trabajo",
    terms: "Solo se cobra si aceptás el contrato.",
    Icon: Handshake,
  },
};

export function PriceCard({ block }: { block: PriceBlock }) {
  const billing = BILLING[block.billing];
  const headingId = `precio-${block.id}`;

  return (
    <BezelCard className="h-full" coreClassName="flex h-full flex-col p-6 sm:p-7">
      <article aria-labelledby={headingId} className="flex h-full flex-col">
        <Badge variant={block.billing === "suscripcion" ? "brand" : "neutral"} className="w-fit">
          <billing.Icon size={12} weight="bold" aria-hidden="true" />
          {billing.badge}
        </Badge>

        <h3 id={headingId} className="mt-4 font-display text-xl font-bold tracking-tight text-foreground">
          {block.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">{block.summary}</p>

        <dl className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
          {block.lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4 py-3">
              <dt className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{line.label}</span>
                {line.detail && (
                  <span className="numeric block text-xs text-foreground-muted">{line.detail}</span>
                )}
              </dt>
              <dd className="shrink-0 text-right">
                <span className="numeric font-display text-lg font-bold text-foreground">
                  {line.amount}
                </span>
                {line.suffix && (
                  <span className="ml-1 text-xs text-foreground-muted">{line.suffix}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {block.notes.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 text-sm leading-relaxed text-foreground-secondary">
            {block.notes.map((note) => (
              <li key={note} className="numeric">
                {note}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs font-medium text-foreground-muted">{billing.terms}</p>

        <div className="mt-auto pt-6">
          <Link
            href={block.cta.href}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "group w-full justify-center gap-2")}
          >
            {block.cta.label}
            <ArrowRight
              size={16}
              aria-hidden="true"
              className="transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
            />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}

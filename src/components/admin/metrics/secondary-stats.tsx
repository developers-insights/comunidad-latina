import { COPY } from "@/lib/metrics/copy";
import type { MetricsOverview } from "@/lib/metrics/types";

/**
 * Los números que ponen en contexto a los tres principales.
 *
 * "Cuentas nuevas" está acá y no arriba a propósito: es el número que más se
 * confunde con "cuánta gente entra". Separarlo, con su explicación al lado, es
 * lo que evita que alguien lea "18 personas entraron" cuando lo que pasó es que
 * 18 se registraron y sólo 12 volvieron a usar la app.
 */
export function SecondaryStats({ data }: { data: MetricsOverview }) {
  const items = [
    {
      label: COPY.secondary.newMembers,
      value: data.totals.new_members,
      help: COPY.secondary.newMembersHelp,
    },
    {
      label: COPY.secondary.publications,
      value: data.totals.publications,
      help: COPY.secondary.publicationsHelp,
    },
    {
      label: COPY.secondary.contacts,
      value: data.totals.contacts,
      help: COPY.secondary.contactsHelp,
    },
    {
      label: COPY.secondary.acceptedContacts,
      value: data.totals.accepted_contacts,
      help: COPY.secondary.acceptedContactsHelp,
    },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3"
        >
          <dt className="text-xs font-medium text-foreground-secondary">{item.label}</dt>
          <dd className="mt-0.5 font-display text-2xl font-bold tabular-nums text-foreground">
            {item.value.toLocaleString("es-US")}
          </dd>
          <dd className="mt-1 text-xs leading-relaxed text-foreground-muted">{item.help}</dd>
        </div>
      ))}
    </dl>
  );
}

import { HandsClapping, Info } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import {
  DEFAULT_FILTER,
  QUEUE_FILTERS,
  QUEUE_LIMIT,
  fetchHelpNoticeQueue,
  resolveQueueFilter,
  type QueueFilterId,
} from "./queries";
import { NotaCard, type HelpNoticeCardData } from "./nota-card";

export const metadata = { title: "Ayuda mutua" };

/**
 * =============================================================================
 * COLA DE AVISOS DE AYUDA MUTUA (moderator+)
 * =============================================================================
 *
 * Es la pieza que el cliente pidió al final de su mensaje: «y todo esto se
 * verifica vía geovanny con la cuenta de admin». Sin esta pantalla, la tabla de
 * la 0120 acumularía avisos en `pending` para siempre y el tablón se vería
 * vacío — exactamente el agujero que tenía la cola de solicitudes de creador
 * antes de que le construyeran la suya, y por el mismo motivo: la capacidad de
 * escribir existía y la de resolver no.
 *
 * ── ES OTRA COSA QUE /admin/moderacion ──────────────────────────────────────
 * Aquella cola es `moderation_queue` (0009), que resuelve contenido YA
 * PUBLICADO que alguien denunció o que la IA marcó. Acá nada está publicado
 * todavía: se decide si SE PUBLICA. Son dos preguntas distintas —"¿esto sigue?"
 * contra "¿esto entra?"— y la segunda no tiene subject_kind en aquella tabla
 * (su CHECK enumera seis y ninguno es éste). Mezclarlas hubiese requerido una
 * migración sobre `moderation_queue` para que la cola vieja renderizara un
 * sujeto que no sabe dibujar.
 *
 * ── ROL: `moderator` ────────────────────────────────────────────────────────
 * Decidir si un texto se publica es moderación de contenido. La base pide lo
 * mismo (`app.is_staff()` en el trigger), así que acá la app no es ni más ni
 * menos estricta que el SQL — a diferencia de la cola de creadores, donde la
 * app pide `domain_admin` por ser una decisión de negocio con plata detrás.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * El del JWT. El Host header es cosmético, mismo criterio que el resto del
 * panel.
 * =============================================================================
 */

const COPY = {
  title: "Avisos de ayuda mutua",
  intro:
    "Lo que la gente publicó para ofrecer una mano o para pedir manos en su barrio. Nada se ve en la comunidad hasta que alguien del equipo lo aprueba acá.",
  navLabel: "Estado de los avisos",
  queueError:
    "No pudimos leer los avisos en este momento. No es que no haya: es que la consulta falló. Recargá la página.",
  truncated: `Mostramos los primeros ${QUEUE_LIMIT}. Resolvé estos y recargá para ver los que siguen.`,
  reglasTitle: "Lo que este tablón no acepta",
  reglas: [
    "Plata. Ningún aviso puede pedir ni ofrecer dinero, aunque la causa sea real: si lo pide, se rechaza y se explica por qué.",
    "Datos de contacto en el texto. Teléfonos, correos y enlaces a grupos se filtran solos en el alta, pero si alguno pasó, es motivo de rechazo — el contacto va por mensaje privado.",
    "Servicios profesionales. Acá se ofrece tiempo, manos y cosas. Quien ofrezca asesoría legal, médica o migratoria no va en esta sección.",
    "Alojamiento. Ofrecer dónde dormir no entra por acá: tiene su propio módulo, con verificación de identidad.",
  ],
  empty: {
    pendientes: {
      title: "No hay nada esperando",
      message:
        "Cuando alguien de tu comunidad publique un aviso para ayudar o para pedir manos, aparece acá.",
    },
    publicados: {
      title: "Todavía no publicaste ninguno",
      message: "Los avisos que apruebes se ven en el tablón de la comunidad y quedan listados acá.",
    },
    resueltos: {
      title: "No hay avisos rechazados",
      message: "Los que rechaces o bajes del tablón quedan acá como historial.",
    },
  } satisfies Record<QueueFilterId, { title: string; message: string }>,
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AyudaMutuaAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("moderator");
  const [tenant, sp] = await Promise.all([getTenant(), searchParams]);
  const tenantId = jwtTenantId ?? tenant.id;

  const filter = resolveQueueFilter(sp.estado);
  const cola = await fetchHelpNoticeQueue(supabase, tenantId, filter);

  // Mapeo explícito y no un spread: la tarjeta es un Client Component y sólo
  // tiene que cruzar la frontera lo que la tarjeta dibuja.
  const cards: HelpNoticeCardData[] = cola.items.map((item) => ({
    id: item.id,
    direction: item.direction,
    topic: item.topic,
    status: item.status,
    title: item.title,
    body: item.body,
    areaLabel: item.areaLabel,
    availability: item.availability,
    orgName: item.orgName,
    languages: item.languages,
    resourceName: item.resourceName,
    authorName: item.authorName,
    createdAt: item.createdAt,
    waitedDays: item.waitedDays,
    reviewNote: item.reviewNote,
    reviewedAt: item.reviewedAt,
  }));

  const tabs: NavTabItem[] = QUEUE_FILTERS.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.id === DEFAULT_FILTER ? "?" : `?estado=${item.id}`,
    count: cola.counts[item.id],
  }));

  const empty = COPY.empty[filter];

  return (
    <section aria-labelledby="ayuda-mutua-title" className="flex flex-col gap-4">
      <header>
        <h2
          id="ayuda-mutua-title"
          className="flex items-center gap-2 font-display text-2xl font-bold text-foreground"
        >
          <HandsClapping size={24} weight="fill" aria-hidden="true" className="text-brand-ink" />
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
      </header>

      <NavTabs items={tabs} active={filter} label={COPY.navLabel} />

      {cola.failed && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {COPY.queueError}
        </p>
      )}

      {cola.truncated && (
        <p className="text-xs leading-relaxed text-foreground-muted">{COPY.truncated}</p>
      )}

      {cards.length === 0 && !cola.failed ? (
        <EmptyState icon={<HandsClapping />} title={empty.title} message={empty.message} />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((aviso) => (
            <NotaCard key={aviso.id} aviso={aviso} />
          ))}
        </div>
      )}

      {/*
        El criterio de rechazo, escrito y a la vista, y no en la cabeza de quien
        modera. Va AL FINAL para no tapar la cola, pero va: sin un criterio
        compartido, dos personas del equipo resuelven distinto el mismo caso y
        la sección se vuelve arbitraria — que es lo peor que le puede pasar a
        algo que decide quién puede ofrecer ayuda.
      */}
      <section className="rounded-lg border border-border-subtle px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
          {COPY.reglasTitle}
        </h3>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
          {COPY.reglas.map((regla) => (
            <li key={regla} className="text-xs leading-relaxed text-foreground-secondary">
              {regla}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

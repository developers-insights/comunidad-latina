import { HandHeart, Info } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import {
  DEFAULT_FILTER,
  QUEUE_FILTERS,
  QUEUE_LIMIT,
  fetchPedirAyudaQueue,
  resolveQueueFilter,
  type QueueFilterId,
} from "./queries";
import { PedidoAdminCard } from "./pedido-card";
import { RespuestaAdminCard } from "./respuesta-card";

export const metadata = { title: "Pedir ayuda" };

/**
 * =============================================================================
 * MODERACIÓN DE "PEDIR AYUDA" (moderator+)
 * =============================================================================
 *
 * ── DEJÓ DE SER UNA COLA DE ADMISIÓN ────────────────────────────────────────
 * Con la 0120 esta pantalla decidía qué entraba: nada se veía hasta que alguien
 * del equipo lo aprobaba. El cliente pidió el 2026-09-03 un tablón vivo —«la
 * gente pone lo que necesita y la gente le contesta»— y la 0130 dio vuelta el
 * modelo: el pedido y la respuesta se publican al toque y el equipo modera
 * DESPUÉS.
 *
 * El cambio le da a esta pantalla un trabajo distinto y más chico: mirar lo que
 * se acaba de publicar, ocultar lo que no va, y poder deshacerlo. La cola vieja
 * sobrevive en la pestaña "Quedaron en cola" para las filas que quedaron en
 * `pending` y nunca se resolvieron.
 *
 * ── ES OTRA COSA QUE /admin/moderacion ──────────────────────────────────────
 * Aquella cola es `moderation_queue` (0009), que junta contenido denunciado o
 * marcado por IA de TODA la app. Acá se mira una sección entera, incluido lo
 * que nadie denunció — que es donde aparece lo que la comunidad todavía no vio.
 * Las dos conviven: un reporte sobre una respuesta llega por `report_scam` como
 * reporte de la PERSONA que la escribió (ver `<RespuestaItem>` del lado
 * público), y se resuelve en aquella pantalla; acá se oculta el texto.
 *
 * ── ROL: `moderator` ────────────────────────────────────────────────────────
 * Ocultar contenido es moderación de contenido. La base pide lo mismo
 * (`app.is_staff()` en los triggers), así que acá la app no es ni más ni menos
 * estricta que el SQL.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * El del JWT. El Host header es cosmético, mismo criterio que el resto del
 * panel.
 * =============================================================================
 */

const COPY = {
  title: "Pedir ayuda",
  intro:
    "Lo que la gente de tu comunidad está pidiendo y lo que le respondieron. Todo se publica al toque: acá se mira después y se oculta lo que no va.",
  navLabel: "Qué estás mirando",
  queueError:
    "No pudimos leer esta sección en este momento. No es que no haya: es que la consulta falló. Recargá la página.",
  truncated: `Mostramos los primeros ${QUEUE_LIMIT}. Resolvé estos y recargá para ver los que siguen.`,
  reglasTitle: "Cuándo se oculta algo",
  reglas: [
    "Plata. Ningún pedido ni respuesta puede pedir ni ofrecer dinero, aunque la causa sea real.",
    "Servicios pagos disfrazados de ayuda. Quien usa una respuesta para vender su servicio no está ayudando.",
    "Asesoría profesional. Acá se comparte información y contactos. Quien dé asesoría legal, médica o migratoria en primera persona, no va.",
    "Datos personales de terceros. El teléfono de una oficina se publica; el de una persona que no dio permiso, no.",
    "Alojamiento ofrecido a un desconocido. Tiene su propio módulo, con verificación de identidad.",
  ],
  empty: {
    publicados: {
      title: "Todavía no hay pedidos",
      message:
        "Cuando alguien de tu comunidad escriba un pedido, aparece acá apenas se publica.",
    },
    respuestas: {
      title: "Todavía nadie respondió nada",
      message: "Las respuestas de la comunidad aparecen acá, la más nueva primero.",
    },
    ocultos: {
      title: "No hay nada oculto",
      message: "Los pedidos que ocultes quedan acá, y desde acá los podés volver a publicar.",
    },
    cola: {
      title: "No quedó nada en la cola vieja",
      message:
        "Acá aparecen los pedidos que habían quedado esperando revisión antes de que el tablón pasara a publicarse solo.",
    },
  } satisfies Record<QueueFilterId, { title: string; message: string }>,
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PedirAyudaAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("moderator");
  const [tenant, sp] = await Promise.all([getTenant(), searchParams]);
  const tenantId = jwtTenantId ?? tenant.id;

  const filter = resolveQueueFilter(sp.estado);
  const cola = await fetchPedirAyudaQueue(supabase, tenantId, filter);

  const tabs: NavTabItem[] = QUEUE_FILTERS.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.id === DEFAULT_FILTER ? "?" : `?estado=${item.id}`,
    count: cola.counts[item.id],
  }));

  const empty = COPY.empty[filter];
  const mirandoRespuestas = filter === "respuestas";
  const vacio = mirandoRespuestas ? cola.respuestas.length === 0 : cola.pedidos.length === 0;

  return (
    <section aria-labelledby="pedir-ayuda-title" className="flex flex-col gap-4">
      <header>
        <h2
          id="pedir-ayuda-title"
          className="flex items-center gap-2 font-display text-2xl font-bold text-foreground"
        >
          <HandHeart size={24} weight="fill" aria-hidden="true" className="text-brand-ink" />
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

      {cola.truncated && !mirandoRespuestas && (
        <p className="text-xs leading-relaxed text-foreground-muted">{COPY.truncated}</p>
      )}

      {vacio && !cola.failed ? (
        <EmptyState icon={<HandHeart />} title={empty.title} message={empty.message} />
      ) : (
        <div className="flex flex-col gap-3">
          {mirandoRespuestas
            ? cola.respuestas.map((respuesta) => (
                <RespuestaAdminCard
                  key={respuesta.id}
                  respuesta={{
                    id: respuesta.id,
                    noticeId: respuesta.noticeId,
                    noticeTitle: respuesta.noticeTitle,
                    body: respuesta.body,
                    status: respuesta.status,
                    authorName: respuesta.authorName,
                    createdAt: respuesta.createdAt,
                    agedDays: respuesta.agedDays,
                  }}
                />
              ))
            : cola.pedidos.map((pedido) => (
                /* Mapeo explícito y no un spread: la tarjeta es un Client
                   Component y sólo tiene que cruzar la frontera lo que dibuja
                   (el `authorId`, por ejemplo, se queda del lado del servidor). */
                <PedidoAdminCard
                  key={pedido.id}
                  pedido={{
                    id: pedido.id,
                    topic: pedido.topic,
                    status: pedido.status,
                    title: pedido.title,
                    body: pedido.body,
                    areaLabel: pedido.areaLabel,
                    replyCount: pedido.replyCount,
                    authorName: pedido.authorName,
                    createdAt: pedido.createdAt,
                    agedDays: pedido.agedDays,
                    reviewNote: pedido.reviewNote,
                    reviewedAt: pedido.reviewedAt,
                  }}
                />
              ))}
        </div>
      )}

      {/*
        El criterio, escrito y a la vista, y no en la cabeza de quien modera. Va
        AL FINAL para no tapar la cola, pero va: sin un criterio compartido, dos
        personas del equipo resuelven distinto el mismo caso y la sección se
        vuelve arbitraria — que es lo peor que le puede pasar a algo que decide
        qué pedido de ayuda se ve.
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

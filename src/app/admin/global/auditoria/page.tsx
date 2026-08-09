import Link from "next/link";
import { ArrowRight, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import { decodeCursor, encodeCursor } from "@/components/listings/helpers";
import { formatDate } from "@/lib/utils";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, listCommunities } from "../../scope";
import { auditCopy, SUBJECT_LABEL, type AuditTone } from "./actions-catalog";

export const metadata = { title: "Registro de acciones" };

/**
 * REGISTRO DE ACCIONES ADMINISTRATIVAS (solo `global_admin`).
 *
 * El pliego lo pide en dos fases distintas ("registrar todas las acciones
 * administrativas"). La mitad difícil ya estaba hecha desde la migración 0011:
 * la tabla `audit_log` existe, es append-only (INSERT bloqueado por RLS para
 * cualquier JWT de usuario: sólo escribe `logAdminAction` con service role) y
 * ya la escriben todas las acciones del panel. Lo que faltaba era mirarla sin
 * abrir Supabase. Esta pantalla es eso.
 *
 * QUÉ NO VA A ENCONTRAR ACÁ QUIEN BUSQUE UN EXPEDIENTE. El registro guarda
 * QUIÉN, CUÁNDO y SOBRE QUÉ — nunca el contenido de un mensaje, ni IPs, ni
 * user-agents (§5.4, comentario de la propia columna `meta`). Es deliberado: el
 * producto se construyó para no acumular un archivo citable. Una auditoría que
 * además guardara el contenido sería justamente el honeypot que se evitó.
 *
 * Filtrar por comunidad usa el mismo parámetro que el resto del panel, pero acá
 * "Todas" es un estado legítimo: hay acciones sin comunidad (un anuncio global
 * no pertenece a ninguna) y esconderlas sería mentir por omisión.
 */

const COPY = {
  title: "Registro de acciones",
  intro:
    "Cada decisión que se toma desde el panel queda anotada acá: quién, cuándo y sobre qué. No se puede editar ni borrar.",
  privacy:
    "Por diseño, el registro no guarda el contenido de mensajes, ni direcciones IP, ni datos del dispositivo. Solo la acción.",
  emptyTitle: "Todavía no hay nada anotado",
  emptyMessage:
    "En cuanto alguien apruebe un aviso, cambie un dominio o toque permisos, la acción aparece acá.",
  errorTitle: "No pudimos leer el registro",
  errorMessage: "Algo falló de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  more: "Ver más",
  unknownActor: "Alguien del equipo",
  platform: "Toda la plataforma",
} as const;

const PAGE_SIZE = 30;

const TONE_CLASS: Record<AuditTone, string> = {
  grants: "border-l-success",
  removes: "border-l-warning",
  neutral: "border-l-border-strong",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditoriaPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireStaff("global_admin");
  const sp = await searchParams;

  const communities = await listCommunities(supabase);
  const requested = firstParam(sp[COMMUNITY_PARAM]);
  // Mismo criterio que `effectiveTenantId`, con una diferencia: acá "ninguna"
  // significa "todas" y es una opción válida, así que un uuid desconocido cae a
  // "todas" en vez de a la comunidad propia. Nunca se usa el valor crudo.
  const tenantId = communities.some((community) => community.id === requested)
    ? (requested as string)
    : null;

  const cursor = decodeCursor(firstParam(sp.cursor) ?? undefined);

  let query = supabase
    .from("audit_log")
    .select("id, action, actor_id, tenant_id, subject_kind, subject_id, meta, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  // Nombres de los actores en UNA consulta (profiles es de lectura pública).
  const actorIds = [
    ...new Set(page.map((row) => row.actor_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", actorIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const actorName = new Map((actors ?? []).map((row) => [row.id, row.display_name]));
  const communityName = new Map(communities.map((c) => [c.id, c.name]));

  const hrefFor = (nextCursor: string | null) => {
    const search = new URLSearchParams();
    if (tenantId) search.set(COMMUNITY_PARAM, tenantId);
    if (nextCursor) search.set("cursor", nextCursor);
    const qs = search.toString();
    return qs ? `/admin/global/auditoria?${qs}` : "/admin/global/auditoria";
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">{COPY.privacy}</p>
        </div>
        <CommunitySwitcher
          basePath="/admin/global/auditoria"
          communities={communities}
          activeTenantId={tenantId}
          isForeign={false}
          allowAll
        />
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink"
        >
          <strong className="font-semibold">{COPY.errorTitle}.</strong> {COPY.errorMessage}
        </p>
      ) : page.length === 0 ? (
        <EmptyState
          icon={<ClockCounterClockwise />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {page.map((row) => {
              const copy = auditCopy(row.action);
              const subject = row.subject_kind ? SUBJECT_LABEL[row.subject_kind] : null;
              return (
                <li
                  key={row.id}
                  className={`flex flex-col gap-1 rounded-lg border border-border border-l-4 bg-surface px-4 py-3 shadow-xs ${TONE_CLASS[copy.tone]}`}
                >
                  <p className="text-sm font-medium leading-snug text-foreground">
                    {copy.label}
                    {subject && (
                      <span className="font-normal text-foreground-secondary"> · {subject}</span>
                    )}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {(row.actor_id ? actorName.get(row.actor_id) : null) ?? COPY.unknownActor} ·{" "}
                    {row.tenant_id
                      ? (communityName.get(row.tenant_id) ?? "Comunidad")
                      : COPY.platform}{" "}
                    ·{" "}
                    <time dateTime={row.created_at}>
                      {formatDate(row.created_at, { withTime: true })}
                    </time>
                  </p>
                  <AuditMeta meta={row.meta} />
                </li>
              );
            })}
          </ol>

          {hasMore && last && (
            <div className="flex justify-center">
              <Link
                href={hrefFor(encodeCursor(last.created_at, last.id))}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-5 text-sm font-medium text-foreground transition-colors duration-(--duration-fast) ease-(--ease-out-premium) hover:border-border-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                {COPY.more}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * El detalle de `meta` — pares clave/valor cortos y nada más.
 *
 * Se renderiza SOLO lo primitivo (texto, número, booleano). Un objeto o un
 * arreglo anidado se saltea: `meta` es jsonb libre, y volcarlo entero en la
 * pantalla es la forma más fácil de mostrar algo que nadie revisó. Lo que
 * importa para leer el registro son los pares chicos ("de: activo, a:
 * suspendido"), y eso es exactamente lo que pasa este filtro.
 */
function AuditMeta({ meta }: { meta: unknown }) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const pairs = Object.entries(meta as Record<string, unknown>).filter(
    ([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );
  if (pairs.length === 0) return null;

  return (
    <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
      {pairs.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1 text-xs">
          <dt className="text-foreground-muted">{key}</dt>
          <dd className="font-mono text-foreground-secondary">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

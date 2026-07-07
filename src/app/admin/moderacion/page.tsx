import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { ModerationItem, type ModerationItemData } from "@/components/admin/moderation-item";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "../guard";

export const metadata = { title: "Moderación" };

/**
 * Cola de moderación (§12): pending del tenant, con extracto del contenido.
 *
 * Lectura de la cola y de posts/comments/listings/profiles: cliente SERVER del
 * usuario staff — la RLS ya permite (y acota) todo eso con el JWT correcto.
 * ÚNICA excepción: el body de un MENSAJE flaggeado. messages es participantes-
 * only por diseño (§5.4, sin rama de staff) → se lee vía admin client, gateado
 * por el rol ya verificado en requireStaff() y limitado a los ids que la RLS
 * de moderation_queue ya autorizó a ver a este staff.
 */

const COPY = {
  title: "Cola de moderación",
  intro:
    "Casos que la IA marcó para revisión humana. Lo más viejo primero — nadie espera de más.",
  emptyTitle: "Cola al día",
  emptyMessage: "No hay nada pendiente de revisar. Buen trabajo del equipo.",
  pendingLabel: (n: number) =>
    n === 1 ? "1 caso pendiente" : `${n} casos pendientes`,
} as const;

const EXCERPT_MAX = 280;

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.trim();
  if (!clean) return null;
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX)}…` : clean;
}

/**
 * `reasons` tiene DOS formas en la cola:
 * - array de strings (posts/comentarios publicados que entran a monitoreo);
 * - OBJETO {source, categories, body, ...} para contenido flaggeado que NUNCA
 *   se insertó (comentarios y mensajes tier 3: subject_id sintético). En ese
 *   caso el body real del intento viaja adentro del objeto — es la ÚNICA
 *   fuente del contenido, así que se usa como extracto de respaldo.
 */
function parseReasons(raw: unknown): { chips: string[]; body: string | null } {
  if (Array.isArray(raw)) {
    return {
      chips: (raw as unknown[]).filter((r): r is string => typeof r === "string"),
      body: null,
    };
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const chips = Array.isArray(record.categories)
      ? (record.categories as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
    return {
      chips,
      body: typeof record.body === "string" ? record.body : null,
    };
  }
  return { chips: [], body: null };
}

export default async function ModeracionPage() {
  const { supabase } = await requireStaff("moderator");

  const { data: rows } = await supabase
    .from("moderation_queue")
    .select("id, subject_kind, subject_id, tier, ai_score, reasons, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  const items = rows ?? [];

  // --- Extractos por lote (una query por tipo, no una por ítem) -------------
  const idsBy = (kind: string) =>
    items.filter((i) => i.subject_kind === kind).map((i) => i.subject_id);

  const excerpts = new Map<string, string | null>();
  const key = (kind: string, id: string) => `${kind}:${id}`;

  const postIds = idsBy("post");
  const commentIds = idsBy("comment");
  const listingIds = [...idsBy("listing"), ...idsBy("photo")];
  const profileIds = idsBy("profile");
  const messageIds = idsBy("message");

  const [posts, comments, listings, profiles] = await Promise.all([
    postIds.length
      ? supabase.from("posts").select("id, body").in("id", postIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[] }),
    commentIds.length
      ? supabase.from("comments").select("id, body").in("id", commentIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[] }),
    listingIds.length
      ? supabase.from("listings").select("id, title, description").in("id", listingIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; description: string | null }[],
        }),
    profileIds.length
      ? supabase.from("profiles").select("id, display_name, bio").in("id", profileIds)
      : Promise.resolve({
          data: [] as { id: string; display_name: string; bio: string | null }[],
        }),
  ]);

  for (const row of posts.data ?? []) excerpts.set(key("post", row.id), clip(row.body));
  for (const row of comments.data ?? []) excerpts.set(key("comment", row.id), clip(row.body));
  for (const row of listings.data ?? []) {
    const text = clip([row.title, row.description].filter(Boolean).join(" — "));
    excerpts.set(key("listing", row.id), text);
    excerpts.set(key("photo", row.id), text);
  }
  for (const row of profiles.data ?? []) {
    excerpts.set(
      key("profile", row.id),
      clip([row.display_name, row.bio].filter(Boolean).join(" — ")),
    );
  }

  // Mensajes flaggeados: admin client gateado (ver nota del módulo arriba).
  if (messageIds.length) {
    try {
      const admin = createAdminClient();
      const { data: messages } = await admin
        .from("messages")
        .select("id, body")
        .in("id", messageIds);
      for (const row of messages ?? []) excerpts.set(key("message", row.id), clip(row.body));
    } catch {
      // Admin no configurado en este entorno → el ítem muestra su aviso de
      // "no pudimos traer el contenido" y se puede resolver igual.
    }
  }

  const viewItems: ModerationItemData[] = items.map((row) => {
    const parsed = parseReasons(row.reasons);
    return {
      id: row.id,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      tier: row.tier,
      aiScore: typeof row.ai_score === "number" ? row.ai_score : null,
      reasons: parsed.chips,
      createdAt: row.created_at,
      // El subject_id sintético (contenido nunca insertado) no resuelve fila:
      // el body que viajó en `reasons` es el contenido real a revisar.
      excerpt: excerpts.get(key(row.subject_kind, row.subject_id)) ?? clip(parsed.body),
    };
  });

  return (
    <section aria-labelledby="moderacion-title" className="flex flex-col gap-4">
      <header>
        <h2 id="moderacion-title" className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.intro}</p>
        {viewItems.length > 0 && (
          <p className="mt-2 text-xs font-medium tabular-nums text-foreground-muted">
            {COPY.pendingLabel(viewItems.length)}
          </p>
        )}
      </header>

      {viewItems.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {viewItems.map((item) => (
            <ModerationItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckCircle, Info } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard } from "@/components/ui";
import {
  LIVE_DISPUTE_STATUSES,
  RECLAMO_COPY,
  disputeStatusMeta,
  untypedSupabase,
} from "@/lib/integrity/disputes";
import { createClient } from "@/lib/supabase/server";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { ReclamoForm } from "./reclamo-form";

/**
 * =============================================================================
 * /contenido/reclamar/[assetId] — "eso es mío"
 * =============================================================================
 *
 * LO QUE ESTA PÁGINA NO HACE, Y ES A PROPÓSITO: no muestra el contenido
 * reclamado ni quién lo subió.
 *
 * `content_assets_select` (0061) sólo deja ver un asset a su uploader y al
 * staff. Para pintar una vista previa habría que leerlo con el admin client, y
 * eso es exactamente lo que ARQUITECTURA.md §6 prohíbe: "JAMÁS usarlo en un
 * request path de usuario para leer datos". Además convertiría la pantalla en un
 * enumerador: con un uuid cualquiera se sabría si existe, de qué tipo es y
 * cuándo se subió.
 *
 * De esa misma restricción sale el ÚNICO chequeo que sí se puede hacer acá: si
 * la consulta devuelve fila, es porque el asset es tuyo (o sos staff) — y
 * reclamarte a vos mismo se corta con un mensaje, no con un crash. Si no
 * devuelve nada NO se concluye nada: puede ser ajeno, de otra comunidad o
 * inexistente. Esa ambigüedad la resuelve la RPC al enviar, que corre como
 * DEFINER y sí puede mirar.
 *
 * Si en algún momento el producto quiere mostrar de qué se trata el archivo,
 * hace falta una RPC nueva y acotada del lado de la base (algo como
 * `public.resumen_de_contenido_reclamable(uuid)` devolviendo sólo `media_kind` y
 * `first_uploaded_at`), no una excepción del lado de la app.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ assetId: string }>;

export const metadata: Metadata = { title: RECLAMO_COPY.title };

export default async function ReclamarContenidoPage({ params }: { params: Params }) {
  const { assetId } = await params;
  if (!UUID_RE.test(assetId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/contenido/reclamar/${assetId}`);

  // RLS: sólo devuelve fila si soy el uploader (o staff). Ver la nota de arriba.
  const { data: visibleAsset, error: assetError } = await supabase
    .from("content_assets")
    .select("id, uploader_id")
    .eq("id", assetId)
    .maybeSingle();

  if (assetError) {
    console.error("[reclamo] no se pudo leer el asset:", assetError.message);
  }
  const isOwnContent = visibleAsset?.uploader_id === user.id;

  // Un reclamo VIVO mío sobre este contenido. La policy de SELECT de
  // content_disputes deja al reclamante ver los suyos, así que va con el cliente
  // del usuario. El índice único parcial de la 0086 garantiza como mucho uno.
  const { data: liveRows, error: liveError } = await untypedSupabase(supabase)
    .from("content_disputes")
    .select("id, status, created_at")
    .eq("asset_id", assetId)
    .eq("claimant_id", user.id)
    .in("status", [...LIVE_DISPUTE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);

  if (liveError) {
    console.error("[reclamo] no se pudieron leer los reclamos propios:", liveError.message);
  }

  const existing = (liveRows as { id: string; status: string; created_at: string }[] | null)?.[0];
  const formatDate = await getViewerFormatDate();
  const shortRef = assetId.slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {RECLAMO_COPY.title}
        </h1>
        <p className="max-w-[60ch] text-sm leading-relaxed text-foreground-secondary">
          {RECLAMO_COPY.lead}
        </p>
        <p className="font-mono text-xs text-foreground-muted">
          {RECLAMO_COPY.reference(shortRef)}
        </p>
      </header>

      {isOwnContent ? (
        <BezelCard coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <CheckCircle size={40} weight="fill" aria-hidden="true" className="text-success" />
          <p className="font-display text-lg font-bold text-foreground">{RECLAMO_COPY.ownTitle}</p>
          <p className="max-w-[46ch] text-sm leading-relaxed text-foreground-secondary">
            {RECLAMO_COPY.ownBody}
          </p>
        </BezelCard>
      ) : existing ? (
        <BezelCard variant="warning" coreClassName="flex flex-col gap-3 px-6 py-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={disputeStatusMeta(existing.status).badge}>
              {disputeStatusMeta(existing.status).label}
            </Badge>
            <span className="numeric text-xs text-foreground-muted">
              {RECLAMO_COPY.existingOpened(formatDate(existing.created_at, { style: "long" }))}
            </span>
          </div>
          <p className="font-display text-lg font-bold text-foreground">
            {RECLAMO_COPY.existingTitle}
          </p>
          <p className="max-w-[52ch] text-sm leading-relaxed text-foreground-secondary">
            {RECLAMO_COPY.existingBody}
          </p>
          <p className="text-sm text-foreground-muted">
            {disputeStatusMeta(existing.status).meaning}
          </p>
        </BezelCard>
      ) : (
        <>
          {/* ---- Las tres cosas que no se pueden suavizar ------------------- */}
          <section
            aria-labelledby="reclamo-como-funciona"
            className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-4 sm:px-5"
          >
            <h2
              id="reclamo-como-funciona"
              className="flex items-center gap-2 font-display text-sm font-bold text-foreground"
            >
              <Info size={18} weight="fill" aria-hidden="true" className="shrink-0 text-info" />
              {RECLAMO_COPY.howTitle}
            </h2>
            <ol className="mt-3 flex flex-col gap-3">
              {RECLAMO_COPY.how.map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="numeric mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-foreground-secondary"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block max-w-[60ch] text-sm leading-relaxed text-foreground-secondary">
                      {item.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <ReclamoForm assetId={assetId} />
        </>
      )}
    </div>
  );
}

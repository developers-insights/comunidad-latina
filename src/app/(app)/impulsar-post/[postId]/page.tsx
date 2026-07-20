import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Megaphone, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { POST_PROMO_IDS, POST_PROMO_PACKAGES } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";
import { OpcionesCampana } from "./opciones-campana";

export const metadata = { title: "Promocionar tu publicación" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXCERPT_MAX = 140;

/** Copy local del módulo — no toca src/lib/i18n (compartido). */
const COPY = {
  volver: "Volver a la publicación",
  titulo: "Promocionar tu publicación",
  subtitulo:
    "Tu publicación aparece en el feed de toda la comunidad, marcada como \"Publicidad\".",
  // FTC §255: transparencia total — la promoción es publicidad y se dice.
  comoFunciona:
    "Promocionar es publicidad: tu publicación llega al feed de más gente con la etiqueta \"Publicidad\", para que siempre se sepa que es un espacio pago. Sin trucos.",
  notaHonesta:
    "Promocionar no cambia tu Trust Score ni el de nadie, no altera el verificador del centro de seguridad y no garantiza nada: solo amplía el alcance de tu publicación mientras dura. Es un pago único, sin renovación automática.",
  exito:
    "¡Listo! Recibimos tu pago. Tu publicación empieza a llegar a más gente en unos minutos — te avisamos con una notificación.",
  cancelado: "No se hizo ningún cargo. Tus opciones de promoción te esperan acá.",
  yaActivaTitulo: "Esta publicación ya está promocionada",
  yaActivaCuerpo: (fecha: string) =>
    `Llega al feed de toda la comunidad, marcada como "Publicidad", hasta el ${fecha}. Cuando termine, podés promocionarla de nuevo desde acá.`,
  noPublicadoTitulo: "Todavía no se puede promocionar",
  noPublicadoCuerpo:
    "La publicación tiene que estar publicada para promocionarla. Apenas la apruebe el equipo de tu comunidad, volvé por acá.",
  postLabel: "La publicación que vas a promocionar",
} as const;

type Params = Promise<{ postId: string }>;
type SearchParams = Promise<{ estado?: string }>;

export default async function ImpulsarPostPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ postId }, { estado }] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(postId)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar-post/${postId}`);

  // Gate de ownership con RLS del usuario: si no es suyo, la página no existe.
  const { data: post } = await supabase
    .from("posts")
    .select("id, tenant_id, author_id, status, body")
    .eq("id", postId)
    .maybeSingle();

  if (!post || post.tenant_id !== tenant.id || post.author_id !== user.id) {
    notFound();
  }

  // Campaña activa vigente (si la hay) + zonas para segmentar la audiencia.
  const [{ data: campanaActiva }, { data: zoneRows }] = await Promise.all([
    supabase
      .from("post_promotions")
      .select("ends_at")
      .eq("post_id", post.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("listings")
      .select("area_label")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .not("area_label", "is", null)
      .limit(200),
  ]);

  const zones = [
    ...new Set(
      (zoneRows ?? [])
        .map((row) => row.area_label)
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

  const excerpt =
    post.body.length > EXCERPT_MAX ? `${post.body.slice(0, EXCERPT_MAX)}…` : post.body;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <Link
        href={`/feed/${post.id}`}
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COPY.volver}
      </Link>

      {estado === "exito" && (
        <Banner
          variant="info"
          className="rounded-lg"
          icon={<SealCheck size={20} className="text-success" />}
        >
          {COPY.exito}
        </Banner>
      )}
      {estado === "cancelado" && (
        <Banner variant="offline" className="rounded-lg">
          {COPY.cancelado}
        </Banner>
      )}

      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.titulo}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitulo}</p>
      </header>

      {/* La publicación que se promociona, para que no haya dudas */}
      <BezelCard coreClassName="flex items-start gap-3 p-4">
        <Megaphone size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {COPY.postLabel}
          </p>
          <p className="mt-1 line-clamp-3 text-sm text-foreground">{excerpt}</p>
        </div>
      </BezelCard>

      {post.status !== "published" ? (
        <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.noPublicadoTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">
            {COPY.noPublicadoCuerpo}
          </p>
        </BezelCard>
      ) : campanaActiva?.ends_at ? (
        <BezelCard
          variant="featured"
          coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center"
          role="status"
        >
          <SealCheck size={40} weight="fill" aria-hidden="true" className="text-brand" />
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.yaActivaTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">
            {COPY.yaActivaCuerpo(
              formatDate(campanaActiva.ends_at, { locale: tenant.locale, style: "long" }),
            )}
          </p>
        </BezelCard>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {COPY.comoFunciona}
          </p>

          <OpcionesCampana
            postId={post.id}
            paquetes={POST_PROMO_IDS.map((id) => POST_PROMO_PACKAGES[id])}
            zones={zones}
            stripeConfigured={isStripeConfigured}
          />
        </>
      )}

      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.notaHonesta}
      </p>
    </div>
  );
}

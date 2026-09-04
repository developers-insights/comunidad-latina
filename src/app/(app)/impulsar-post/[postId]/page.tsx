import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Megaphone, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard } from "@/components/ui";
import { isPagosDemoPermitido } from "@/lib/config/services";
import { findPrice, type ResolvedPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { POST_PROMO_IDS, POST_PROMO_PACKAGES, type PostPromoId } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { listarZonasDelTenant } from "@/lib/zona/server";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { ADVERTISING_VIDEO_MAX_SECONDS } from "@/lib/media/video-policy";
import { OpcionesCampana } from "./opciones-campana";
import { VideoDeCampana } from "./video-de-campana";

export const metadata = { title: "Promocionar tu publicación" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXCERPT_MAX = 140;

/** Copy local del módulo — no toca src/lib/i18n (compartido). */
const COPY = {
  volver: "Volver a la publicación",
  titulo: "Promocionar tu publicación",
  subtitulo:
    "Tu publicación aparece en el feed de toda la comunidad, marcada como \"Patrocinado\".",
  // FTC §255: transparencia total — la promoción es publicidad y se dice.
  comoFunciona:
    "Promocionar es publicidad: tu publicación llega al feed de más gente con la etiqueta \"Patrocinado\", para que siempre se sepa que es un espacio pago. Sin trucos.",
  /**
   * LA PROMESA DEL VIDEO LARGO, DICHA ANTES DE COBRAR.
   *
   * El cliente lo describió así: «tú ves cuando van a hacer un boost, una
   * campaña, que dice que puede subir cierta cantidad de fotos y un video de 5
   * minutos» (2026-09-03, 19:40). La frase dice DOS cosas y las dos importan:
   * cuánto dura el video, y CUÁNDO se sube — con la campaña ya activa, que es
   * el único momento en que la base deja marcar una publicación como
   * publicitaria (`app.posts_validate_video`, 0046/0048). Prometer que se sube
   * "al pagar" sería prometer un paso que no existe.
   *
   * Los minutos salen del tope real del tipo, nunca escritos a mano.
   */
  videoLargo: (minutos: number) =>
    `Con tu campaña activa vas a poder sumarle a esta publicación un video de hasta ${minutos} minutos — el que la comunidad ve completo en la sección de Videos largos.`,
  notaHonesta:
    "Promocionar no cambia tu Trust Score ni el de nadie, no altera el verificador del centro de seguridad y no garantiza nada: solo amplía el alcance de tu publicación mientras dura. Es un pago único, sin renovación automática.",
  exito:
    "¡Listo! Recibimos tu pago. Tu publicación empieza a llegar a más gente en unos minutos — te avisamos con una notificación.",
  cancelado: "No se hizo ningún cargo. Tus opciones de promoción te esperan acá.",
  yaActivaTitulo: "Esta publicación ya está promocionada",
  yaActivaCuerpo: (fecha: string) =>
    `Llega al feed de toda la comunidad, marcada como "Patrocinado", hasta el ${fecha}. Cuando termine, podés promocionarla de nuevo desde acá.`,
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

  // "Tu campaña llega hasta el …": fecha de plata, con el reloj de quien paga.
  const [tenant, supabase, formatDate] = await Promise.all([
    getTenant(),
    createClient(),
    getViewerFormatDate(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar-post/${postId}`);

  // Gate de ownership con RLS del usuario: si no es suyo, la página no existe.
  const { data: post } = await supabase
    .from("posts")
    // Las columnas de video (0046 + 0132) las necesita el panel del video de la
    // campaña para saber si ya hay uno y cuánto dura.
    .select("id, tenant_id, author_id, status, body, video_type, duration_seconds")
    .eq("id", postId)
    .maybeSingle();

  if (!post || post.tenant_id !== tenant.id || post.author_id !== user.id) {
    notFound();
  }

  // Campaña activa vigente (si la hay) + zonas para segmentar la audiencia.
  //
  // El catálogo de zonas sale de `listarZonasDelTenant` (@/lib/zona/server) y ya
  // no de un `select area_label` escrito acá: es exactamente la misma consulta
  // que necesitaba el selector de "Tu zona", y tenerla dos veces garantizaba que
  // el día que una cambie de tope o de criterio la otra se quede vieja. Además
  // viene cache()-eada por request.
  const [{ data: campanaActiva }, zones] = await Promise.all([
    supabase
      .from("post_promotions")
      .select("ends_at")
      .eq("post_id", post.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listarZonasDelTenant(tenant.id),
  ]);

  const excerpt =
    post.body.length > EXCERPT_MAX ? `${post.body.slice(0, EXCERPT_MAX)}…` : post.body;

  // Precios vigentes de la campaña en ESTA comunidad. Misma lectura que la que
  // después usa `crearCampanaPost`; sin fila configurada caen a las constantes
  // del código y la pantalla se ve exactamente igual que hoy (§7).
  const preciosResueltos = await getTenantPrices(supabase, tenant.id);
  const preciosPromo: Partial<Record<PostPromoId, ResolvedPrice>> = {};
  for (const id of POST_PROMO_IDS) {
    const precio = findPrice(preciosResueltos, "post_promo", id, "unico");
    if (precio) preciosPromo[id] = precio;
  }

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
          <p className="mt-1 line-clamp-3 text-sm text-foreground">
            {excerpt || "Foto o video"}
          </p>
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
        <>
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

          {/*
            EL VIDEO LARGO VIVE ACÁ, Y SÓLO ACÁ.
            No es una decisión de layout: con la campaña activa es el ÚNICO
            momento en que una publicación puede pasar a `advertising_video`
            (`app.posts_validate_video`, 0046/0048) y, por lo tanto, el único en
            que la base deja que un video pase de 90 s. El detalle completo está
            en el docblock de `video-publicitario.ts`.
          */}
          <VideoDeCampana
            postId={post.id}
            actual={{
              durationSeconds: post.duration_seconds,
              esPublicitario: post.video_type === "advertising_video",
            }}
          />
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {COPY.comoFunciona}
          </p>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {COPY.videoLargo(Math.floor(ADVERTISING_VIDEO_MAX_SECONDS / 60))}
          </p>

          <OpcionesCampana
            postId={post.id}
            paquetes={POST_PROMO_IDS.map((id) => POST_PROMO_PACKAGES[id])}
            precios={preciosPromo}
            zones={zones}
            demoPermitido={isPagosDemoPermitido}
          />
        </>
      )}

      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.notaHonesta}
      </p>
    </div>
  );
}

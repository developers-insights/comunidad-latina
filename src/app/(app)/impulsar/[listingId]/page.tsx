import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Megaphone,
  SealCheck,
} from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { BOOST_IDS, BOOST_PACKAGES } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";
import { OpcionesBoost } from "./opciones-boost";

export const metadata = { title: "Impulsar tu aviso" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copy local del módulo BOOST — no toca src/lib/i18n (compartido). */
const COPY = {
  volver: "Volver al aviso",
  titulo: "Impulsar tu aviso",
  subtitulo: (zona: string | null) =>
    zona
      ? `Tu aviso aparece primero para la gente de ${zona}, marcado como "Destacado".`
      : "Tu aviso aparece primero en tu zona, marcado como \"Destacado\".",
  // FTC §255: transparencia total — el impulso es publicidad y se dice.
  comoFunciona:
    "El impulso es publicidad: tu aviso sube al principio de los resultados de tu zona con la etiqueta \"Destacado\", para que la gente siempre sepa que es un espacio pago. Sin trucos.",
  notaHonesta:
    "Impulsar no cambia tu Trust Score, no altera los resultados del verificador del centro de seguridad y no garantiza conducta: solo mejora la visibilidad de tu aviso mientras dura. Es un pago único, sin renovación automática.",
  exito:
    "¡Listo! Recibimos tu pago. Tu aviso queda destacado en unos minutos — te avisamos con una notificación.",
  cancelado: "No se hizo ningún cargo. Tus opciones de impulso te esperan acá.",
  yaActivoTitulo: "Este aviso ya está impulsado",
  yaActivoCuerpo: (fecha: string) =>
    `Aparece primero en tu zona, marcado como "Destacado", hasta el ${fecha}. Cuando termine, podés impulsarlo de nuevo desde acá.`,
  noPublicadoTitulo: "Todavía no se puede impulsar",
  noPublicadoCuerpo:
    "El aviso tiene que estar publicado para impulsarlo. Apenas lo apruebe el equipo de tu comunidad, volvé por acá.",
} as const;

type Params = Promise<{ listingId: string }>;
type SearchParams = Promise<{ estado?: string }>;

export default async function ImpulsarPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ listingId }, { estado }] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(listingId)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar/${listingId}`);

  // Gate de ownership con RLS del usuario: si no es suyo, la página no existe.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, title, status, created_by, area_label")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    notFound();
  }

  // Boost activo vigente (si lo hay) — estado honesto en vez de doble venta.
  const { data: boostActivo } = await supabase
    .from("boosts")
    .select("ends_at")
    .eq("listing_id", listing.id)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-5 pb-8">
      <Link
        href={`/propiedades/${listing.id}`}
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
        <p className="mt-1 text-sm text-foreground-secondary">
          {COPY.subtitulo(listing.area_label)}
        </p>
      </header>

      {/* El aviso que se impulsa, para que no haya dudas */}
      <BezelCard coreClassName="flex items-start gap-3 p-4">
        <Megaphone size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{listing.title}</p>
          {listing.area_label && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-foreground-secondary">
              <MapPin size={14} aria-hidden="true" />
              {listing.area_label}
            </p>
          )}
        </div>
      </BezelCard>

      {listing.status !== "published" ? (
        <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.noPublicadoTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">
            {COPY.noPublicadoCuerpo}
          </p>
        </BezelCard>
      ) : boostActivo?.ends_at ? (
        <BezelCard
          variant="featured"
          coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center"
          role="status"
        >
          <SealCheck size={40} weight="fill" aria-hidden="true" className="text-brand" />
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.yaActivoTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">
            {COPY.yaActivoCuerpo(
              formatDate(boostActivo.ends_at, { locale: tenant.locale, style: "long" }),
            )}
          </p>
        </BezelCard>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {COPY.comoFunciona}
          </p>

          <OpcionesBoost
            listingId={listing.id}
            paquetes={BOOST_IDS.map((id) => BOOST_PACKAGES[id])}
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

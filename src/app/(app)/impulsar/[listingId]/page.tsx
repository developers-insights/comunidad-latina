import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ChartBar,
  MapPin,
  Megaphone,
  SealCheck,
  SlidersHorizontal,
} from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard, NavTabs } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { MONETIZATION_COPY } from "@/lib/monetization";
import { listingViewHref } from "@/lib/monetization/href";
import { BOOST_IDS, BOOST_PACKAGES } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";
import { FormularioCampana, type CampaignDraft } from "./formulario-campana";
import { OpcionesBoost } from "./opciones-boost";

export const metadata = { title: "Promocionar tu aviso" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const M = MONETIZATION_COPY;

/** Copy local del módulo BOOST — no toca src/lib/i18n (compartido). */
const COPY = {
  volver: "Volver al aviso",
  // FTC §255: transparencia total — el impulso es publicidad y se dice. La
  // etiqueta es "Patrocinado" (contrato 2026-07-30 §4) y NO "Destacado": esa
  // palabra es el nivel máximo del Trust Score, que se gana por reputación.
  // Compartirla hacía que un espacio pago se leyera como un mérito ganado.
  comoFunciona:
    "El impulso es publicidad: tu aviso sube al principio de los resultados de tu zona con la etiqueta \"Patrocinado\", para que la gente siempre sepa que es un espacio pago. Sin trucos.",
  notaHonesta:
    "Impulsar no cambia tu Trust Score, no altera los resultados del verificador del centro de seguridad y no garantiza conducta: solo mejora la visibilidad de tu aviso mientras dura. Es un pago único, sin renovación automática.",
  exito:
    "¡Listo! Recibimos tu pago. En unos minutos tu aviso empieza a aparecer primero en tu zona — te avisamos con una notificación.",
  cancelado: "No se hizo ningún cargo. Tus opciones de impulso te esperan acá.",
  yaActivoTitulo: "Este aviso ya está impulsado",
  yaActivoCuerpo: (fecha: string) =>
    `Aparece primero en tu zona, marcado como "Patrocinado", hasta el ${fecha}. Cuando termine, podés impulsarlo de nuevo desde acá.`,
  noPublicadoTitulo: "Todavía no se puede promocionar",
  noPublicadoCuerpo:
    "El aviso tiene que estar publicado para promocionarlo. Apenas lo apruebe el equipo de tu comunidad, volvé por acá.",
  verEstadisticas: "Ver estadísticas de este aviso",
  verBotones: "Configurar botones de acción",
} as const;

/** Estilo compartido de los accesos secundarios del pie. */
const SECONDARY_LINK = cn(
  "flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-subtle",
  "px-4 py-2.5 text-sm font-semibold text-foreground-secondary",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

type Params = Promise<{ listingId: string }>;
type SearchParams = Promise<{ estado?: string; modo?: string }>;

/** Los DOS caminos de "Promocionar". Ni uno más — es literal del contrato. */
type Modo = "impulso" | "campana";

function parseModo(raw: string | undefined): Modo {
  return raw === "campana" ? "campana" : "impulso";
}

/**
 * /impulsar/[listingId] — "Promocionar" abre EXACTAMENTE dos caminos.
 *
 * Por qué una sola ruta con `?modo=` y no dos páginas: son dos formas de
 * comprar lo mismo (visibilidad para ESTE aviso), y separarlas en dos URLs
 * obligaba a elegir antes de saber en qué se diferencian. Acá la comparación
 * está a un tap, con back del sistema y link compartible — que es exactamente
 * para lo que existe <NavTabs> (enlaces, no `role="tab"`).
 *
 * El impulso ya existía y funcionaba, y al cliente le gustó: se CONSERVA tal
 * cual (mismo componente, mismos paquetes, mismo checkout). Lo nuevo se le suma
 * al lado.
 */
export default async function PromocionarPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ listingId }, { estado, modo: modoRaw }] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(listingId)) notFound();
  const modo = parseModo(modoRaw);

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar/${listingId}`);

  // Gate de ownership con RLS del usuario: si no es suyo, la página no existe.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, kind, title, status, created_by, area_label")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    notFound();
  }

  // Boost activo vigente + campaña del aviso (si las hay) — estado honesto en
  // vez de doble venta. `campaigns` es PRIVADA (dueño + admins), así que este
  // select ya lo limita la RLS a lo que es suyo.
  const [{ data: boostActivo }, { data: campaignRow }] = await Promise.all([
    supabase
      .from("boosts")
      .select("ends_at")
      .eq("listing_id", listing.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("campaigns")
      .select(
        "id, status, objective, budget_cents, duration_days, countries, cities, languages, interests, age_min, age_max, review_note",
      )
      .eq("listing_id", listing.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const campaign: CampaignDraft | null = campaignRow
    ? {
        id: campaignRow.id,
        status: campaignRow.status,
        objective: campaignRow.objective,
        budgetCents: campaignRow.budget_cents,
        durationDays: campaignRow.duration_days,
        countries: campaignRow.countries ?? [],
        cities: campaignRow.cities ?? [],
        languages: campaignRow.languages ?? [],
        interests: campaignRow.interests ?? [],
        ageMin: campaignRow.age_min,
        ageMax: campaignRow.age_max,
        reviewNote: campaignRow.review_note,
      }
    : null;

  const isPublished = listing.status === "published";
  const backHref = listingViewHref(listing.kind, listing.id);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <Link
        href={backHref}
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
          {M.promote.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{M.promote.subtitle}</p>
      </header>

      {/* El aviso que se promociona, para que no haya dudas */}
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

      {!isPublished ? (
        <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.noPublicadoTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">
            {COPY.noPublicadoCuerpo}
          </p>
        </BezelCard>
      ) : (
        <>
          <NavTabs
            label={M.promote.chooseTitle}
            active={modo}
            items={[
              {
                id: "impulso",
                label: M.promote.boostTab,
                href: `/impulsar/${listing.id}`,
              },
              {
                id: "campana",
                label: M.promote.campaignTab,
                href: `/impulsar/${listing.id}?modo=campana`,
              },
            ]}
          />

          {/* Qué hace cada camino, en una línea, ANTES de pedir plata. */}
          <p className="-mt-1 text-sm leading-relaxed text-foreground-secondary">
            {modo === "impulso" ? M.promote.boostSummary : M.promote.campaignSummary}
          </p>

          {modo === "impulso" ? (
            boostActivo?.ends_at ? (
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
            )
          ) : (
            <FormularioCampana listingId={listing.id} campaign={campaign} />
          )}
        </>
      )}

      {/* Accesos del dueño. Van abajo y discretos — no compiten con el CTA de
          arriba, y NO son un tercer "camino de promoción": estadísticas y
          botones no se compran, se configuran y se miran. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={`/impulsar/${listing.id}/estadisticas`}
          className={SECONDARY_LINK}
        >
          <ChartBar size={18} aria-hidden="true" />
          {COPY.verEstadisticas}
        </Link>
        <Link href={`/impulsar/${listing.id}/botones`} className={SECONDARY_LINK}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          {COPY.verBotones}
        </Link>
      </div>

      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.notaHonesta}
      </p>
    </div>
  );
}

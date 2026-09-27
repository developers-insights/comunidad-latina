import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChartLineUp,
  HourglassMedium,
  SealCheck,
  UserCirclePlus,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { AdChip } from "@/components/feed/card-ad-chip";
import {
  CreatorCard,
  creatorPhotoUrl,
  firstPortfolioUrl,
  type CreatorCardModel,
} from "@/components/creators";
import { SectionTopBar } from "@/components/shell";
import { moduleAvailability } from "@/components/shell/module-access";
import { Banner, BezelCard, buttonVariants } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { BOOST_IDS, BOOST_PACKAGES, type BoostId } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { leerChecksAzules } from "@/lib/verificacion/read";
import { cn } from "@/lib/utils";
import { impulsoVigente, situacionDelCreador } from "./modelo";
import { OpcionesPerfil, type PaquetePerfil } from "./opciones-perfil";

export const metadata = { title: "Promocioná tu perfil de creador" };

const COPY = {
  titulo: "Promocioná tu perfil",
  bajada:
    "Tu perfil de creador aparece primero en el directorio, justo donde las marcas y los negocios buscan a quién contratar.",
  previaTitulo: "Así te van a ver",
  // "Patrocinado" y nunca "Destacado": "Destacado" es el nivel más alto del
  // Trust Score, que se gana. Compartir la palabra haría pasar un pago por mérito.
  previaNota:
    "Va marcado como «Patrocinado» para que todos sepan que es un lugar pago. Tu reputación y tus reseñas no cambian.",
  duracionTitulo: "¿Cuánto tiempo?",
  paquetes: {
    "7d": "Una semana primero en el directorio de creadores.",
    "14d": "Dos semanas al frente, el equilibrio que más eligen.",
    "30d": "Un mes entero primero cada vez que busquen creadores.",
  } satisfies Record<BoostId, string>,
  exito:
    "¡Listo! Recibimos tu pago. En unos minutos tu perfil aparece primero en el directorio y te avisamos con una notificación.",
  cancelado: "No se hizo ningún cargo. Cuando quieras, elegí una opción de nuevo.",
  activoTitulo: "Tu perfil ya está promocionado",
  activoTexto: (fecha: string) =>
    `Aparecés primero en el directorio de creadores hasta el ${fecha}. Cuando termine, podés volver a promocionarlo desde acá.`,
  verResultados: "Ver cómo te va",
  videoTitulo: "¿Preferís mostrar tu trabajo en el feed?",
  videoTexto:
    "Subí un video o una foto contando lo que hacés y después promocionalo desde Boost: llega a toda la comunidad, marcado como publicidad.",
  videoCta: "Crear una publicación",
  sinPerfilTitulo: "Primero tenés que ser creador",
  sinPerfilTexto:
    "Para promocionar tu perfil necesitás estar aprobado como creador en esta comunidad. La solicitud te lleva unos minutos.",
  sinPerfilCta: "Quiero ser creador",
  enCaminoTitulo: "Tu solicitud está en revisión",
  enCaminoTexto:
    "Apenas te aprueben, vas a poder promocionar tu perfil desde acá. Mientras tanto, podés revisar cómo va tu solicitud.",
  enCaminoCta: "Ver mi solicitud",
  noDisponibleTitulo: "Ahora no podés promocionar tu perfil",
  noDisponibleTexto:
    "Tu cuenta de creador no está activa en este momento. Si creés que es un error, escribinos y lo revisamos.",
  noDisponibleCta: "Escribir a soporte",
  notaHonesta:
    "Promocionar tu perfil no cambia tu Trust Score ni tus reseñas: sólo mejora dónde aparecés mientras dura. Es un pago único, sin renovación automática.",
} as const;

type SearchParams = Promise<{ estado?: string }>;

export default async function PromocionarPerfilPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [{ estado }, tenant, supabase, formatDate] = await Promise.all([
    searchParams,
    getTenant(),
    createClient(),
    getViewerFormatDate(),
  ]);
  if (moduleAvailability("creadores", tenant.modules, tenant.modulesSoon) !== "active") {
    notFound();
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/impulsar/perfil-creador");

  const [perfilRes, cuentaRes, impulsosRes, precios, checksAzules] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select(
        "profile_id, tenant_id, status, headline, skills, portfolio_photos, available, completed_jobs, rating_avg, rating_count",
      )
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name, avatar_url, identity_verified")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("creator_profile_boosts")
      .select("status, ends_at")
      .eq("creator_id", user.id)
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .limit(1),
    getTenantPrices(supabase, tenant.id),
    leerChecksAzules(supabase, [user.id]),
  ]);

  if (impulsosRes.error) {
    console.warn("[impulso-perfil] no se pudo leer el impulso vigente", {
      code: impulsosRes.error.code,
    });
  }

  const perfil =
    perfilRes.data && perfilRes.data.tenant_id === tenant.id ? perfilRes.data : null;
  const situacion = situacionDelCreador(perfil?.status);
  const vigenteHasta = impulsoVigente(impulsosRes.data ?? [], new Date().getTime());

  const paquetes: PaquetePerfil[] = BOOST_IDS.map((id) => {
    const precio = findPrice(precios, "boost", id, "unico");
    return {
      id,
      nombre: BOOST_PACKAGES[id].nombre,
      descripcion: COPY.paquetes[id],
      recomendado: BOOST_PACKAGES[id].recomendado,
      amountCents: precio?.amountCents ?? null,
      currency: precio?.currency ?? "USD",
    };
  });

  const previa: CreatorCardModel | null = perfil
    ? {
        profileId: user.id,
        displayName: cuentaRes.data?.display_name ?? "Tu nombre",
        avatarUrl: cuentaRes.data?.avatar_url ?? null,
        identityVerified: cuentaRes.data?.identity_verified ?? false,
        checkAzul: checksAzules.has(user.id),
        headline: perfil.headline,
        skills: perfil.skills ?? [],
        portfolioUrl: firstPortfolioUrl(perfil.portfolio_photos),
        portfolioPhotos: (perfil.portfolio_photos ?? [])
          .filter((foto) => foto && foto.trim().length > 0)
          .map(creatorPhotoUrl),
        ratingAvg: perfil.rating_avg,
        ratingCount: perfil.rating_count,
        completedJobs: perfil.completed_jobs,
        available: perfil.available,
        initialFollowing: false,
        isSelf: true,
      }
    : null;

  return (
    <div className="flex flex-col gap-6 pb-8">
      <SectionTopBar fallbackHref="/impulsar" />

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
        <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-foreground-secondary">
          {COPY.bajada}
        </p>
      </header>

      {situacion !== "aprobado" ? (
        <EstadoSinAcceso situacion={situacion} />
      ) : (
        <>
          {vigenteHasta ? (
            <BezelCard
              variant="featured"
              coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center"
              role="status"
            >
              <SealCheck size={40} weight="fill" aria-hidden="true" className="text-brand" />
              <p className="font-display text-lg font-semibold text-foreground">
                {COPY.activoTitulo}
              </p>
              <p className="max-w-[42ch] text-sm text-foreground-secondary">
                {COPY.activoTexto(formatDate(vigenteHasta, { locale: tenant.locale, style: "long" }))}
              </p>
              <Link
                href="/impulsar/resultados"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}
              >
                <ChartLineUp size={16} aria-hidden="true" />
                {COPY.verResultados}
              </Link>
            </BezelCard>
          ) : (
            <section aria-labelledby="duracion-titulo" className="flex flex-col gap-3">
              <h2 id="duracion-titulo" className="font-display text-lg font-bold text-foreground">
                {COPY.duracionTitulo}
              </h2>
              <OpcionesPerfil paquetes={paquetes} stripeConfigured={isStripeConfigured} />
            </section>
          )}

          {previa && (
            <section aria-labelledby="previa-titulo" className="flex flex-col gap-3">
              <h2 id="previa-titulo" className="font-display text-lg font-bold text-foreground">
                {COPY.previaTitulo}
              </h2>
              {/* Angosta a propósito: la tarjeta real es 4:5 a todo el ancho y en
                  un teléfono empujaba las opciones de pago fuera de la pantalla. */}
              <div className="mx-auto flex w-full max-w-[280px] flex-col gap-2">
                <AdChip className="self-start" />
                <CreatorCard creator={previa} />
              </div>
              <p className="text-xs leading-relaxed text-foreground-muted">{COPY.previaNota}</p>
            </section>
          )}
        </>
      )}

      <BezelCard coreClassName="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-foreground">
          <VideoCamera size={20} weight="fill" aria-hidden="true" className="text-brand" />
          <span className="font-semibold">{COPY.videoTitulo}</span>
        </span>
        <p className="text-sm leading-relaxed text-foreground-secondary">{COPY.videoTexto}</p>
        <Link
          href="/feed"
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full sm:w-auto sm:self-start")}
        >
          {COPY.videoCta}
        </Link>
      </BezelCard>

      <p className="text-center text-xs leading-relaxed text-foreground-muted">{COPY.notaHonesta}</p>
    </div>
  );
}

function EstadoSinAcceso({ situacion }: { situacion: "sin_perfil" | "en_camino" | "no_disponible" }) {
  const contenido =
    situacion === "sin_perfil"
      ? {
          icono: <UserCirclePlus size={40} weight="fill" aria-hidden="true" className="text-brand" />,
          titulo: COPY.sinPerfilTitulo,
          texto: COPY.sinPerfilTexto,
          cta: { href: "/creadores/solicitud", label: COPY.sinPerfilCta },
        }
      : situacion === "en_camino"
        ? {
            icono: <HourglassMedium size={40} weight="fill" aria-hidden="true" className="text-warning" />,
            titulo: COPY.enCaminoTitulo,
            texto: COPY.enCaminoTexto,
            cta: { href: "/creadores/solicitud", label: COPY.enCaminoCta },
          }
        : {
            icono: null,
            titulo: COPY.noDisponibleTitulo,
            texto: COPY.noDisponibleTexto,
            cta: { href: "/ajustes/soporte", label: COPY.noDisponibleCta },
          };

  return (
    <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {contenido.icono}
      <p className="font-display text-lg font-semibold text-foreground">{contenido.titulo}</p>
      <p className="max-w-[42ch] text-sm text-foreground-secondary">{contenido.texto}</p>
      {contenido.cta && (
        <Link
          href={contenido.cta.href}
          className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-3")}
        >
          {contenido.cta.label}
        </Link>
      )}
    </BezelCard>
  );
}

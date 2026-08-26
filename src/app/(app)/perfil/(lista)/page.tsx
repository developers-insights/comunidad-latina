import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  CaretRight,
  GearSix,
  PencilSimple,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { BezelCard, buttonVariants } from "@/components/ui";
import { TrustScoreCard } from "@/components/trust";
import { decodeCursor } from "@/components/listings";
import { EditProfileForm } from "@/components/auth/edit-profile-form";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { moduleAvailability } from "@/components/shell/module-access";
import { PerfilCambiarIdentidad } from "@/components/shell/identity-switcher";
import { cn } from "@/lib/utils";
import { leerCheckAzul } from "@/lib/verificacion/read";
import {
  getIdentidadActiva,
  listarIdentidadesDeNegocio,
} from "@/lib/perfil-activo/identidad";
import { ProfileHeader } from "../profile-header";
import { ShareProfileButton } from "../share-profile-button";
import { ProfileTabSection } from "../profile-tab-section";
import { fetchProfileCounts } from "../profile-data";
import { fetchProfileCard, fullName } from "../profile-card";
import { ProfileCompletion, missingProfileFields } from "../profile-completion";
import { getViewerTimeZone } from "@/lib/time/viewer-zone";
import { memberSinceLabel, parseProfileTab, profileTabHref } from "../profile-tabs";

export const metadata = { title: "Tu perfil" };

const COPY = {
  editAction: "Editar perfil",
  verifyAction: "Verificar",
  statPosts: "Publicaciones",
  statFollowers: "Seguidores",
  statFollowing: "Siguiendo",
  trustHeading: "Tu Trust Score",
  trustHint:
    "Crece con tu tiempo en la comunidad, tus verificaciones y el aval de tus vecinos.",
  editHeading: "Editar tu perfil",
  contractsTitle: "Mis colaboraciones",
  contractsDesc: "Los trabajos que contrataste o entregaste como creador.",
  settingsTitle: "Ajustes de tu cuenta",
  settingsDesc:
    "Guardados, notificaciones, personas bloqueadas, tema y cerrar sesión.",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [tenant, supabase, sp, viewerZone] = await Promise.all([
    getTenant(),
    createClient(),
    searchParams,
    // La zona que la persona eligió en Ajustes (0067). Todas las fechas de esta
    // pantalla se formatean con ella.
    getViewerTimeZone(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil");

  const cursor = decodeCursor(firstValue(sp.fotos) || undefined);
  const tab = parseProfileTab(firstValue(sp.t) || undefined);

  /**
   * `profile_card()` Y NO `select("*")`.
   *
   * El `*` que había acá era el hueco que las migraciones 0062 y 0067 dejaron
   * anotado dos veces: mientras esta línea siguiera existiendo no se podía
   * cerrar `profiles` por GRANT de columna para `authenticated` (revocar una
   * columna tira 42501 sobre la consulta entera), así que TODA columna nueva de
   * `profiles` nacía legible por cualquier usuario con sesión.
   *
   * Además traía de vuelta al navegador `role`, `account_status`,
   * `suspended_until`, `terms_accepted_at`… para pintar un perfil.
   *
   * La ficha ahora viene de `public.profile_card()`, que devuelve 20 campos
   * elegidos y —por ser el dueño quien mira— los devuelve todos, incluida la
   * fecha de nacimiento completa, que es lo único que el formulario de edición
   * necesita y que NADIE más recibe jamás. Ver `../profile-card.ts`.
   *
   * `timezone` va aparte y con lista explícita: no es parte de la ficha pública
   * (no se le concede a `anon` a propósito, 0067) y sólo la usa el propio
   * usuario para formatear sus fechas.
   */
  const [card, { data: trust }, counts, { count: contractsCount }, negociosDisponibles, identidadActiva] =
    await Promise.all([
      fetchProfileCard(supabase, user.id),
      supabase
        .from("trust_scores")
        .select("score, level, signals")
        .eq("profile_id", user.id)
        .maybeSingle(),
      fetchProfileCounts(supabase, { tenantId: tenant.id, profileId: user.id }),
      // Acceso a "Mis contratos" (pedido cliente 26/7, movido del nav de
      // Creadores): solo se muestra si el usuario tiene algo que ver ahí — como
      // cliente o como creador — para no ofrecerle a cualquiera un atajo vacío.
      supabase
        .from("gig_contracts")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`),
      // Para la puerta del cambiador de perfil, junto a Editar/Verificar/
      // Compartir. `cache()`-eadas (perfil-activo/identidad.ts): el header ya
      // las pide en este mismo request, así que esto no repite la consulta.
      listarIdentidadesDeNegocio(),
      getIdentidadActiva(),
    ]);

  // Cuenta sin perfil (edge raro) → que complete el onboarding.
  if (!card) redirect("/bienvenida");

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, card.identityVerified);
  const firstName = card.displayName.split(/\s+/)[0] ?? card.displayName;
  const country = countryName(card.countryOrigin);
  const location =
    [country, card.city, card.areaLabel].filter(Boolean).join(" · ") || null;
  const memberSince = memberSinceLabel(card.createdAt, tenant.locale, viewerZone ?? undefined);
  const missing = missingProfileFields(card);

  // El check azul (0101) sale de `profiles.verified_badge`, el espejo público
  // que mantiene el trigger de la suscripción. NO de `profile_card`: esa RPC
  // devuelve la ficha filtrada por privacidad, y la insignia no es un dato
  // privado —es lo que ve cualquiera al lado del nombre—, así que meterla ahí
  // habría sido cambiar la firma de la función para nada.
  const checkAzul = await leerCheckAzul(supabase, card.id);

  // Mismo gate que Ajustes: si la comunidad tiene Negocios apagado o "muy
  // pronto", la puerta no se pinta — ofrecer un atajo a una ruta que 404 o que
  // todavía no abre es peor que no ofrecerlo.
  const negociosActivo =
    moduleAvailability("negocios", tenant.modules, tenant.modulesSoon) === "active";

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        displayName={fullName(card)}
        username={card.username}
        avatarUrl={card.avatarUrl}
        coverUrl={card.coverUrl}
        identityVerified={card.identityVerified}
        verifiedBadge={checkAzul}
        location={location}
        memberSince={memberSince}
        stats={[
          { label: COPY.statPosts, value: counts.posts, href: "/perfil" },
          {
            label: COPY.statFollowers,
            value: counts.followers,
            href: profileTabHref("/perfil", "seguidores"),
          },
          {
            label: COPY.statFollowing,
            value: counts.following,
            href: profileTabHref("/perfil", "siguiendo"),
          },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="#editar-perfil"
              className={cn(buttonVariants({ variant: "secondary", size: "md" }), "flex-1")}
            >
              <PencilSimple size={16} aria-hidden="true" />
              {COPY.editAction}
            </Link>
            {!card.identityVerified && (
              <Link
                href="/perfil/verificar"
                className={cn(buttonVariants({ variant: "outline", size: "md" }), "flex-1")}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {COPY.verifyAction}
              </Link>
            )}
            {/* Compartir el perfil PROPIO apunta a su URL pública (`/perfil/<id>`),
                no a `/perfil`: esta última redirige a "tu perfil" para quien
                abra el link, o sea que compartirla mandaría a cada persona a su
                propio perfil. Es el bug clásico de este botón. */}
            <ShareProfileButton
              path={`/perfil/${card.id}`}
              displayName={card.displayName}
            />
            {/* La puerta del cambiador de perfil (pedido cliente: "que haya una
                chance... de cambiar de perfil como en Instagram", dicho
                mirando ESTA pantalla). Reusa el mismo componente que el avatar
                del header — nunca un segundo cambiador — y decide sola entre
                "cambiar" y "crear tu primera cuenta de negocio" según
                `negociosDisponibles`. Ver identity-switcher.tsx. */}
            {negociosActivo && (
              <PerfilCambiarIdentidad
                personal={{ displayName: card.displayName, avatarUrl: card.avatarUrl }}
                negocios={negociosDisponibles.map((negocio) => ({
                  businessId: negocio.businessId,
                  nombre: negocio.nombre,
                  rol: negocio.rol,
                }))}
                activeBusinessId={
                  identidadActiva.tipo === "negocio"
                    ? identidadActiva.negocio.businessId
                    : null
                }
              />
            )}
          </div>
        }
      />

      {/* Qué falta del perfil. Va DESPUÉS de la cabecera y antes del Trust
          Score: es una invitación, no una alarma — la cuenta funciona entera
          sin esto. Desaparece sola cuando no queda nada por completar. */}
      <ProfileCompletion missing={missing} />

      {/* Trust Score — la tarjeta especial, con protagonismo visual (feedback 21/7). */}
      <section className="flex flex-col gap-2" aria-label={COPY.trustHeading}>
        <TrustScoreCard
          firstName={firstName}
          score={score}
          level={level}
          signals={signals}
          heading={COPY.trustHeading}
        />
        <p className="px-1 text-xs text-foreground-muted">{COPY.trustHint}</p>
      </section>

      {/* Las siete pestañas (contrato 2026-07-30 §B.6). Publicaciones · Fotos ·
          Videos · Información · Reseñas · Seguidores · Siguiendo. */}
      <ProfileTabSection
        supabase={supabase}
        tenantId={tenant.id}
        profileId={user.id}
        baseHref="/perfil"
        tab={tab}
        counts={counts}
        isOwn
        cursor={cursor}
        info={{
          bio: card.bio,
          country,
          areaLabel: card.areaLabel,
          memberSince,
          identityVerified: card.identityVerified,
          lastName: card.lastName,
          age: card.age,
          countryResidence: card.countryResidence,
          city: card.city,
          languages: card.languages,
        }}
      />

      {/* Editar — destino del ancla "Editar perfil" de la cabecera. */}
      <BezelCard id="editar-perfil" className="scroll-mt-20">
        <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
          {COPY.editHeading}
        </h2>
        {/* Todos los campos privados llegan completos porque quien mira es el
            DUEÑO — `app.privacy_allows()` devuelve siempre `true` para uno
            mismo. Es la misma función la que decide que nadie más los reciba. */}
        <EditProfileForm
          initial={{
            displayName: card.displayName,
            lastName: card.lastName ?? "",
            username: card.username ?? "",
            bio: card.bio ?? "",
            area: card.areaLabel ?? "",
            country: card.countryOrigin ?? "",
            countryResidence: card.countryResidence ?? "",
            city: card.city ?? "",
            birthdate: card.birthdate ?? "",
            languages: card.languages,
            coverUrl: card.coverUrl,
            avatarUrl: card.avatarUrl,
          }}
        />
      </BezelCard>

      {/* Mis colaboraciones — solo si el usuario tiene alguna (cliente o creador).
          La pestaña se llamaba "Contratos" hasta el pedido del cliente del 30/7;
          la ruta vieja sigue viva como 308, pero desde acá se entra derecho a la
          nueva para no gastar un redirect en cada visita. */}
      {Boolean(contractsCount) && (
        <section className="flex flex-col gap-3">
          <Link
            href="/creadores/colaboraciones"
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <BezelCard coreClassName="flex items-center gap-4 p-5">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
              >
                <Briefcase size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-semibold text-foreground">
                  {COPY.contractsTitle}
                </span>
                <span className="mt-0.5 block text-sm text-foreground-secondary">
                  {COPY.contractsDesc}
                </span>
              </span>
              <CaretRight
                size={18}
                aria-hidden="true"
                className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
              />
            </BezelCard>
          </Link>
        </section>
      )}

      {/* Administrar la cuenta ya no vive acá (2026-07-29). Guardados, cuentas
          bloqueadas, tema y el bloque de sesión —cerrar sesión y eliminar la
          cuenta— se mudaron ENTEROS a /ajustes, la pestaña nueva del bottom nav.
          El perfil quedó para lo que es: quién sos de cara a la comunidad. Este
          enlace es el puente, para quien venía con el camino viejo en la cabeza. */}
      <section className="flex flex-col gap-3">
        <Link
          href="/ajustes"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <BezelCard coreClassName="flex items-center gap-4 p-5">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
            >
              <GearSix size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold text-foreground">
                {COPY.settingsTitle}
              </span>
              <span className="mt-0.5 block text-sm text-foreground-secondary">
                {COPY.settingsDesc}
              </span>
            </span>
            <CaretRight
              size={18}
              aria-hidden="true"
              className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
            />
          </BezelCard>
        </Link>
      </section>
    </div>
  );
}

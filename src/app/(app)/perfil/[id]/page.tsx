import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui";
import { TrustScoreCard } from "@/components/trust";
import { decodeCursor } from "@/components/listings";
import { MessageCta } from "@/components/auth/message-cta";
import { ProfileActionsMenu } from "@/components/auth/profile-actions-menu";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { ProfileHeader } from "../profile-header";
import { ShareProfileButton } from "../share-profile-button";
import { ProfileTabSection } from "../profile-tab-section";
import { fetchProfileCounts } from "../profile-data";
import { memberSinceLabel, parseProfileTab, profileTabHref } from "../profile-tabs";

export const metadata = { title: "Perfil" };

const COPY = {
  sendMessage: "Enviar mensaje",
  statPosts: "Publicaciones",
  statFollowers: "Seguidores",
  statFollowing: "Siguiendo",
  trustHeading: (name: string) => `Trust Score de ${name}`,
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PerfilPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase, sp] = await Promise.all([
    getTenant(),
    createClient(),
    searchParams,
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tu propio perfil vive en /perfil (con edición y cuenta).
  if (user?.id === id) redirect("/perfil");

  /**
   * LISTA EXPLÍCITA DE COLUMNAS — no `select("*")`.
   *
   * Esta página es PÚBLICA (ver la nota de RLS abajo), así que todo lo que
   * entre en este select viaja al navegador de cualquiera. `profiles` tiene 20
   * columnas y la página usa 8; el `*` que había acá arrastraba además `role`
   * (quién es admin), `account_status` y `suspended_until` (si la persona está
   * sancionada, y hasta cuándo), `phone_verified`, `email_verified`,
   * `terms_accepted_at` y `age_confirmed_at`. Nada de eso se muestra: se
   * mandaba de puro `*`.
   *
   * Agregar una columna acá es publicarla. Que la lista esté escrita obliga a
   * pensarlo.
   *
   * Lo mismo vale para `trust_scores`, y ahí el `*` además ROMPÍA: la migración
   * 0059 le revocó a `anon` la columna `factors` (el desglose del motor
   * anti-fraude, que se puede estudiar para gamear el score), y con un permiso
   * de columna faltante Postgres tira 42501 sobre la tabla entera. Como el error
   * no se chequea, `trust` quedaba `null` y la página mostraba score 0 y el
   * nivel más bajo a CUALQUIER visitante sin sesión — un valor falso, no un
   * badge ausente. En un producto anti-estafa esa es la señal que más importa.
   */
  const [{ data: profile }, { data: trust }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, country_origin, area_label, bio, identity_verified, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("trust_scores")
      .select("score, level, signals")
      .eq("profile_id", id)
      .maybeSingle(),
  ]);

  if (!profile) {
    /**
     * RLS (verificado contra la base): la policy es
     * `profiles_select ... TO anon, authenticated USING (true)` — o sea que los
     * perfiles SÍ se ven sin sesión. El comentario que había acá afirmaba lo
     * contrario y por eso existía una rama que ofrecía "entrá a tu cuenta"
     * cuando no había perfil: era código muerto, y encima mentía. Sin sesión no
     * es la razón por la que un perfil no aparece — la razón es que no existe.
     *
     * Si algún día la policy pasara a exigir sesión, esta rama vuelve; hoy
     * mandar a alguien a loguearse para ver algo que no existe es hacerle
     * perder el viaje.
     */
    notFound();
  }

  const cursor = decodeCursor(firstValue(sp.fotos) || undefined);
  const tab = parseProfileTab(firstValue(sp.t) || undefined);

  // Conversación previa + contadores. Ver perfil NO implica tener sesión (la
  // policy es pública): para quien mira sin cuenta, `conversations` no devuelve
  // nada por su propia RLS y el CTA cae solo en el de "entrar para escribir".
  const [{ data: existingConversation }, counts] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, status, created_at")
      .or(`created_by.eq.${id},counterpart_id.eq.${id}`)
      .neq("status", "blocked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchProfileCounts(supabase, { tenantId: tenant.id, profileId: id }),
  ]);

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const location = [country, profile.area_label].filter(Boolean).join(" · ") || null;
  const base = `/perfil/${id}`;
  const memberSince = memberSinceLabel(profile.created_at, tenant.locale);

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        identityVerified={profile.identity_verified}
        location={location}
        memberSince={memberSince}
        stats={[
          { label: COPY.statPosts, value: counts.posts, href: base },
          {
            label: COPY.statFollowers,
            value: counts.followers,
            href: profileTabHref(base, "seguidores"),
          },
          {
            label: COPY.statFollowing,
            value: counts.following,
            href: profileTabHref(base, "siguiendo"),
          },
        ]}
        // Menú ⋯ con "Reportar como estafa" SIEMPRE primero (§3.3 / §4.c).
        headerRight={<ProfileActionsMenu profileId={profile.id} />}
        // 1 CTA primario por pantalla: hilo real si ya hay conversación; si no,
        // estado honesto (el contacto perfil→perfil llega con el módulo social).
        // "Compartir" va al lado como secundario, nunca compitiendo con él.
        actions={
          <>
            {existingConversation ? (
              <Link
                href={`/mensajes/${existingConversation.id}`}
                className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
              >
                <ChatCircle size={20} aria-hidden="true" />
                {COPY.sendMessage}
              </Link>
            ) : (
              <MessageCta firstName={firstName} />
            )}
            <ShareProfileButton path={base} displayName={profile.display_name} />
          </>
        }
      />

      {/* Trust Score — visible al ver el perfil de CUALQUIER persona (feedback 21/7). */}
      <TrustScoreCard
        firstName={firstName}
        score={score}
        level={level}
        signals={signals}
        heading={COPY.trustHeading(firstName)}
      />

      {profile.bio && (
        <p className="text-center text-sm leading-relaxed text-foreground-secondary">
          {profile.bio}
        </p>
      )}

      {/* Las siete pestañas — la MISMA sección que el perfil propio. */}
      <ProfileTabSection
        supabase={supabase}
        tenantId={tenant.id}
        profileId={id}
        baseHref={base}
        tab={tab}
        counts={counts}
        isOwn={false}
        cursor={cursor}
        info={{
          bio: profile.bio,
          country,
          areaLabel: profile.area_label,
          memberSince,
          identityVerified: profile.identity_verified,
        }}
      />
    </div>
  );
}

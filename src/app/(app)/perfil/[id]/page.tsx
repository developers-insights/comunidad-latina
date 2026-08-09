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
import { fetchProfileCard, fullName } from "../profile-card";
import { getViewerTimeZone } from "@/lib/time/viewer-zone";
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

  const [tenant, supabase, sp, viewerZone] = await Promise.all([
    getTenant(),
    createClient(),
    searchParams,
    // "Miembro desde" se formatea con el reloj de QUIEN MIRA, no con el de la
    // comunidad: alguien en Los Ángeles viendo un alta del 1 de marzo a las
    // 02:00 UTC tiene que leer "febrero", que es cuando pasó para él.
    getViewerTimeZone(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tu propio perfil vive en /perfil (con edición y cuenta).
  if (user?.id === id) redirect("/perfil");

  /**
   * `profile_card()` Y NO UNA LECTURA DE `profiles`.
   *
   * Acá había una lista explícita de columnas, que ya era mucho mejor que el
   * `select("*")` que la precedió (ese arrastraba `role`, `account_status`,
   * `suspended_until`, `phone_verified`, `terms_accepted_at`… al navegador de
   * cualquiera). Pero seguía teniendo el agujero de fondo: `bio` y
   * `country_origin` viajaban SIN pasar por los controles de privacidad, porque
   * la policy de `profiles` es `using(true)` y RLS filtra filas, no columnas. La
   * persona podía poner su presentación en "solo yo" y esta consulta la
   * publicaba igual.
   *
   * `public.profile_card()` (0063) es SECURITY DEFINER y aplica la matriz
   * ADENTRO de la base: lo que la configuración no permite vuelve NULL desde el
   * servidor. Ver el comentario largo de `../profile-card.ts`.
   *
   * Lo de `trust_scores` sigue igual y sigue importando: el `*` que hubo ahí
   * ROMPÍA, porque 0059 le revocó a `anon` la columna `factors` y un permiso de
   * columna faltante tira 42501 sobre la tabla entera. Como el error no se
   * chequea, `trust` quedaba `null` y la página mostraba score 0 y el nivel más
   * bajo a CUALQUIER visitante sin sesión — un valor falso, no un badge ausente.
   */
  const [card, { data: trust }] = await Promise.all([
    fetchProfileCard(supabase, id),
    supabase
      .from("trust_scores")
      .select("score, level, signals")
      .eq("profile_id", id)
      .maybeSingle(),
  ]);

  if (!card) {
    /**
     * Sin ficha = el perfil no existe, o la cuenta está dada de baja (la propia
     * `profile_card` devuelve cero filas cuando `account_status = 'banned'`, así
     * que esta pantalla ya no necesita acordarse de chequearlo).
     *
     * RLS (verificado contra la base): la policy es
     * `profiles_select ... TO anon, authenticated USING (true)` — o sea que los
     * perfiles SÍ se ven sin sesión, y por eso acá no hay ninguna rama que
     * ofrezca "entrá a tu cuenta". Sin sesión no es la razón por la que un
     * perfil no aparece; la razón es que no está.
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
  const signals = trustSignalsFrom(trust?.signals ?? null, card.identityVerified);
  const firstName = card.displayName.split(/\s+/)[0] ?? card.displayName;
  const country = countryName(card.countryOrigin);
  // La ubicación de la cabecera combina lo que la privacidad DEJÓ pasar: si el
  // bloque "dónde vivís" está cerrado, `city` viene null y la línea se arma sola
  // con lo que queda, sin huecos ni marcas de censura.
  const location =
    [country, card.city, card.areaLabel].filter(Boolean).join(" · ") || null;
  const base = `/perfil/${id}`;
  const memberSince = memberSinceLabel(card.createdAt, tenant.locale, viewerZone ?? undefined);

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        // `fullName` suma el apellido SOLO si la privacidad lo dejó pasar; si
        // no, sale el nombre solo, sin puntos suspensivos que delaten que hay
        // algo tapado (un indicador de "acá hay un apellido oculto" también es
        // información).
        displayName={fullName(card)}
        username={card.username}
        avatarUrl={card.avatarUrl}
        coverUrl={card.coverUrl}
        identityVerified={card.identityVerified}
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
        headerRight={<ProfileActionsMenu profileId={card.id} />}
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
            <ShareProfileButton path={base} displayName={card.displayName} />
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

      {/* La bio ya viene filtrada por la matriz: si está cerrada, `card.bio` es
          null y este bloque no existe — no hay un "presentación oculta" que
          contarle a nadie. */}
      {card.bio && (
        <p className="text-center text-sm leading-relaxed text-foreground-secondary">
          {card.bio}
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
        // Los dos permisos salen de `profile_card`, o sea de la base: las
        // pestañas de publicaciones y de seguidores muestran un estado cerrado
        // en vez de la lista cuando la persona así lo eligió.
        canSeePosts={card.canSeePosts}
        canSeeFollowers={card.canSeeFollowers}
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
    </div>
  );
}

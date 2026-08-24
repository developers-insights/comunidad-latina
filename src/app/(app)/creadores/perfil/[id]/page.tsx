import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatCircle, CheckCircle, MapPin, Star } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { Avatar, buttonVariants } from "@/components/ui";
import { InsigniaDePerfil } from "@/components/verificacion/check-azul";
import { MessageCta } from "@/components/auth/message-cta";
import { FollowButton } from "@/components/social/follow-button";
import {
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  toTrustLevel,
} from "@/components/listings";
import {
  COPY,
  ContractForm,
  RatingStars,
  SERVICE_PACKAGES_ANCHOR,
  ServicePackages,
  creatorPhotoUrl,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { leerCheckAzul } from "@/lib/verificacion/read";
import { cn, formatDate } from "@/lib/utils";
import { fetchServicePackages } from "../queries";

export const metadata = { title: "Perfil de creador" };

/**
 * Copy propio de esta pantalla. Va acá y no en `components/creators/copy.ts`
 * porque ese archivo es compartido y lo están tocando otros frentes en paralelo:
 * un solo dueño por archivo. Si estas líneas se estabilizan, mudarlas allá es
 * una línea de diff.
 */
const LOCAL_COPY = {
  messageCta: "Seguir la conversación",
  messageNeedLogin: "Entrá también para escribirle antes de contratarlo.",
} as const;

export default async function CreadorPublicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Mi propio perfil se edita en /creadores/perfil.
  if (user?.id === id) redirect("/creadores/perfil");

  const [
    { data: creator },
    { data: profile },
    { data: trust },
    { data: reviews },
    servicePackages,
    checkAzul,
  ] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select("profile_id, headline, bio, skills, portfolio_photos, rate_hint, available, completed_jobs, rating_avg, rating_count")
      .eq("profile_id", id)
      .maybeSingle(),
    supabase.from("profiles").select("id, display_name, avatar_url, identity_verified, area_label").eq("id", id).maybeSingle(),
    supabase.from("trust_scores").select("score, level, signals").eq("profile_id", id).maybeSingle(),
    supabase
      .from("gig_reviews")
      .select("id, reviewer_id, rating, body, created_at")
      .eq("ratee_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    // Sólo los ACTIVOS: un paquete apagado no es una oferta. La policy de
    // SELECT (0102) además no se los devolvería a un visitante aunque los
    // pidiéramos — esto evita traer filas que igual se descartan.
    fetchServicePackages(supabase, id, { activeOnly: true }),
    leerCheckAzul(supabase, id),
  ]);

  if (!creator) {
    /**
     * RLS (verificado contra la base): `creator_profiles_select` es
     * `TO anon, authenticated USING (true)`, igual que `profiles_select`. O sea
     * que el perfil de creador se ve SIN sesión, y que no aparezca nunca fue
     * por falta de login: es que esa persona no tiene perfil de creador.
     *
     * Acá había una rama que, para el visitante anónimo, ofrecía "entrá a tu
     * cuenta" — código muerto por diseño y, cuando llegaba a verse, un desvío
     * inútil: loguearse no iba a hacer aparecer algo que no existe.
     */
    notFound();
  }

  const displayName = profile?.display_name ?? "Creador de la comunidad";
  const score = trust?.score ?? 0;
  const level = toTrustLevel(trust?.level);
  const signals = buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false);

  // Nombres de quienes reseñaron. Sólo las 3 columnas que se pintan: el nombre
  // y la foto de quien reseñó son públicos, el resto de `profiles` no tiene por
  // qué viajar a una página abierta (misma regla que en /perfil/[id]).
  const reviewerIds = [...new Set((reviews ?? []).map((r) => r.reviewer_id))];
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", reviewerIds)
    : { data: [] as { id: string; display_name: string; avatar_url: string | null }[] };
  const reviewerById = new Map((reviewers ?? []).map((r) => [r.id, r]));

  // Seguimiento + conversación previa. Las dos consultas dependen de la sesión y
  // no dependen entre sí, así que van juntas y no una atrás de la otra.
  //
  // CONVERSACIÓN: mismo criterio EXACTO que /perfil/[id] — la RLS de
  // `conversations` sólo devuelve los hilos de quien mira, así que para un
  // visitante sin sesión no hay nada que traer y el CTA cae solo en "entrar".
  // Se excluyen los hilos bloqueados: ofrecer "seguí la conversación" hacia un
  // chat que la otra persona cortó sería empujar a alguien contra una puerta
  // cerrada.
  const [{ data: existingFollow }, { data: existingConversation }] = await Promise.all([
    user
      ? supabase
          .from("follows")
          .select("target_id")
          .eq("follower_id", user.id)
          .eq("target_kind", "profile")
          .eq("target_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? supabase
          .from("conversations")
          .select("id, status, created_at")
          .or(`created_by.eq.${id},counterpart_id.eq.${id}`)
          .neq("status", "blocked")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const portfolio = creator.portfolio_photos ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar
          size="xl"
          src={profile?.avatar_url ?? null}
          name={displayName}
          badge={
            checkAzul || profile?.identity_verified ? (
              <InsigniaDePerfil checkAzul={checkAzul} identityVerified={profile?.identity_verified ?? false} />
            ) : undefined
          }
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl font-bold text-foreground">{displayName}</h1>
          <p className="text-sm text-foreground-secondary">{creator.headline}</p>
          {profile?.area_label && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-muted">
              <MapPin size={14} aria-hidden="true" />
              {profile.area_label}
            </p>
          )}
        </div>

        {/*
          DISPONIBILIDAD. `creator_profiles.available` ya venía en el `select` de
          esta página y no se pintaba en ningún lado: quien entraba al perfil no
          tenía forma de saber si esa persona estaba tomando trabajos, y se
          enteraba recién después de mandarle una propuesta.

          Mismo lenguaje visual que el chip de la tarjeta del directorio
          (`creator-card.tsx`) para que "Disponible" signifique lo mismo en las
          dos pantallas. El punto de color es decorativo (`aria-hidden`): el
          estado lo dice el TEXTO, no el color — quien no distingue verde de gris
          lee lo mismo.
        */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
            creator.available
              ? "border-success/20 bg-success-bg text-success-ink"
              : "border-border-subtle bg-surface-subtle text-foreground-secondary",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              creator.available ? "bg-success" : "bg-foreground-muted",
            )}
          />
          {creator.available ? COPY.directory.available : COPY.directory.unavailable}
        </span>

        {user?.id !== id && (
          <FollowButton targetKind="profile" targetId={id} initialFollowing={Boolean(existingFollow)} size="sm" />
        )}
      </section>

      {/* Reputación — el "score de crédito": estrellas + trabajos + Trust Score */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <RatingStars avg={creator.rating_avg} count={creator.rating_count} size={16} />
          {creator.completed_jobs > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground-secondary">
              <CheckCircle size={16} weight="fill" aria-hidden="true" className="text-success" />
              {COPY.directory.completedJobs(creator.completed_jobs)}
            </span>
          )}
        </div>
        <PublisherTrust
          displayName={displayName}
          firstName={firstNameOf(displayName)}
          score={score}
          level={level}
          signals={signals}
          size="card"
          // El perfil de creador y el de comunidad son dos páginas distintas:
          // desde el profesional se puede ir al general, que es donde están sus
          // publicaciones y su gente.
          profileId={id}
        />
      </section>

      {/* CTA: proponer un trabajo directo (contrato con gig_id null) */}
      {user ? (
        <div className="flex flex-col gap-1.5">
          <ContractForm
            creatorId={id}
            creatorName={displayName}
            triggerLabel={COPY.profile.proposeCta}
            triggerSize="lg"
            triggerClassName="w-full"
          />
          <p className="text-center text-xs text-foreground-muted">{COPY.profile.hireHint}</p>

          {/*
            ESCRIBIRLE SIN CONTRATARLO (pedido del cliente: "dar mensajes a otras
            personas para que puedan conectar"). Antes de esto, la única forma de
            hablarle a un creador desde su perfil era proponerle un contrato: o
            contratás, o no hay canal. Mucha gente necesita preguntar primero.

            GUARDAS, copiadas de /perfil/[id] y no inventadas acá:
             - Perfil propio: la página ya redirige a /creadores/perfil arriba.
             - Sin sesión: cae en la rama de abajo, que lleva a /entrar.
             - Hilo ya existente: se va AL HILO en vez de ofrecer empezar otro.

            Va DESPUÉS del CTA primario y con variant `outline`: una pantalla
            tiene un solo CTA primario (el de contratar), y este es el camino
            suave. Cuando no hay hilo se usa `MessageCta`, que hoy responde con
            el estado honesto del contacto perfil→perfil — el mismo que ve
            cualquiera en /perfil/[id]. Es deliberado: prometer un chat que
            todavía no existe sería peor que decirlo.
          */}
          {existingConversation ? (
            <Link
              href={`/mensajes/${existingConversation.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-1.5 w-full")}
            >
              <ChatCircle size={20} aria-hidden="true" />
              {LOCAL_COPY.messageCta}
            </Link>
          ) : (
            <div className="mt-1.5">
              <MessageCta firstName={firstNameOf(displayName)} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Link
            href={`/entrar?next=${encodeURIComponent(`/creadores/perfil/${id}`)}`}
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
          >
            {COPY.profile.proposeCta}
          </Link>
          <p className="text-center text-xs text-foreground-muted">
            {LOCAL_COPY.messageNeedLogin}
          </p>
        </div>
      )}

      {creator.bio && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">{creator.bio}</p>
      )}

      {creator.skills && creator.skills.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.skillsTitle}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {creator.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-full bg-surface-subtle px-3 py-1 text-sm font-medium text-foreground-secondary"
              >
                {skill}
              </li>
            ))}

            {/*
              EL CHIP QUE PIDIÓ EL CLIENTE, literal: «al lado de instagram, que
              diga paquetes de servicio». Va como último chip de "Lo que hago",
              donde él lo señaló sobre la captura.

              No es un chip más de texto: es un ANCLA que baja hasta la sección
              de paquetes. Un chip que dijera "Paquetes de servicio" y no
              llevara a ningún lado sería una etiqueta mintiendo al lado de
              cuatro que describen a la persona.

              Y sólo aparece si hay paquetes ACTIVOS. Prometer paquetes en un
              perfil que no tiene ninguno es peor que no ofrecerlos: manda a
              alguien a buscar algo que no existe.
            */}
            {servicePackages.length > 0 && (
              <li>
                <a
                  href={`#${SERVICE_PACKAGES_ANCHOR}`}
                  aria-label={COPY.packages.anchorLabel}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-tint px-3 py-1",
                    "text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-tint/80",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  {COPY.packages.anchorChip}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {/*
        PAQUETES DE SERVICIO (0102). Va acá —entre "Lo que hago" y el
        portfolio— porque es la continuación natural de la lectura: primero qué
        hace esta persona, después cuánto cuesta contratarla, y recién ahí las
        pruebas (portfolio y reseñas). El componente se esconde solo si no hay
        paquetes activos.
      */}
      <ServicePackages
        packages={servicePackages}
        creatorId={id}
        creatorName={displayName}
        isAuthenticated={Boolean(user)}
      />

      {portfolio.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.portfolioTitle}</h2>
          <div className="grid grid-cols-2 gap-2">
            {portfolio.map((path, index) => (
              <div key={path} className="aspect-square overflow-hidden rounded-lg bg-surface-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- fotos públicas del bucket post-media */}
                <img
                  src={creatorPhotoUrl(path)}
                  alt={`Trabajo ${index + 1} de ${displayName}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.reviewsTitle}</h2>
        {reviews && reviews.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => {
              const reviewer = reviewerById.get(review.reviewer_id);
              return (
                <li key={review.id} className="rounded-lg border border-border-subtle bg-surface p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar size="sm" src={reviewer?.avatar_url ?? null} name={reviewer?.display_name ?? "Alguien"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {reviewer?.display_name ?? "Alguien de la comunidad"}
                      </p>
                      <span aria-hidden="true" className="flex">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            size={13}
                            weight={i < review.rating ? "fill" : "regular"}
                            className={i < review.rating ? "text-warning" : "text-border"}
                          />
                        ))}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {formatDate(review.created_at, { locale: tenant.locale, style: "medium" })}
                    </span>
                  </div>
                  {review.body && (
                    <p className="mt-2.5 whitespace-pre-line text-sm text-foreground-secondary">{review.body}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
            {COPY.profile.noReviews}
          </p>
        )}
      </section>
    </div>
  );
}

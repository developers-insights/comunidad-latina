import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatCircle, MapPin, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Avatar, EmptyState, buttonVariants } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { TrustBlock } from "@/components/auth/trust-block";
import { MessageCta } from "@/components/auth/message-cta";
import { ProfileActionsMenu } from "@/components/auth/profile-actions-menu";
import { countryName } from "@/components/auth/countries";
import {
  concreteSignals,
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";

export const metadata = { title: "Perfil" };

const COPY = {
  sendMessage: "Enviar mensaje",
  loginTitle: "Este perfil es de la comunidad",
  loginMessage:
    "Entrá a tu cuenta para ver los perfiles y el Trust Score de tus vecinos.",
  loginCta: "Entrar",
} as const;

export default async function PerfilPublicoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tu propio perfil vive en /perfil (con edición y cuenta).
  if (user?.id === id) redirect("/perfil");

  const [{ data: profile }, { data: trust }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("trust_scores").select("*").eq("profile_id", id).maybeSingle(),
  ]);

  if (!profile) {
    // RLS: sin sesión no se ven perfiles — guiamos, nunca un error seco.
    if (!user) {
      return (
        <EmptyState
          icon={<UserCircle />}
          title={COPY.loginTitle}
          message={COPY.loginMessage}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent(`/perfil/${id}`)}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.loginCta}
            </Link>
          }
        />
      );
    }
    notFound();
  }

  // ¿Ya existe una conversación con esta persona? (RLS ya limita a las mías;
  // el filtro busca las que tienen a este perfil del otro lado.)
  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id, status, created_at")
    .or(`created_by.eq.${id},counterpart_id.eq.${id}`)
    .neq("status", "blocked")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const highlights = concreteSignals(signals);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const meta = [country, profile.area_label].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      {/* Menú ⋯ con "Reportar como estafa" SIEMPRE primero (§3.3 / §4.c) */}
      <div className="-mt-2 flex justify-end">
        <ProfileActionsMenu profileId={profile.id} />
      </div>

      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar
          size="xl"
          src={profile.avatar_url}
          name={profile.display_name}
          badge={profile.identity_verified ? <IdentityBadge /> : undefined}
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl font-bold text-foreground">
            {profile.display_name}
          </h1>
          {meta && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-secondary">
              <MapPin size={14} aria-hidden="true" />
              {meta}
            </p>
          )}
        </div>
      </section>

      {/* Trust Score — clickeable → sheet con el desglose */}
      <TrustBlock
        firstName={firstName}
        score={score}
        level={level}
        signals={signals}
      />

      {/* 1 CTA primario por pantalla: si ya hay conversación → al hilo real;
          si no, estado honesto (el contacto perfil→perfil llega con SOCIAL) */}
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

      {profile.bio && (
        <p className="text-center text-sm leading-relaxed text-foreground-secondary">
          {profile.bio}
        </p>
      )}

      {/* Señales concretas de confianza en texto plano (§4.c) */}
      {highlights.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
          {highlights.map((signal) => (
            <li
              key={signal}
              className="py-3 text-center text-sm text-foreground"
            >
              {signal}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

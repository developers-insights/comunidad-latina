import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Info } from "@phosphor-icons/react/dist/ssr";
import { AssistantChat } from "@/components/assistant";
import { ASSISTANT_COPY as COPY } from "@/components/assistant/copy";
import { ProximamentePremium } from "@/components/ui";
import { isOpenAIConfigured } from "@/lib/config/services";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import {
  ANON_COOKIE,
  ANON_LIMIT,
  anonRemaining,
} from "@/app/api/assistant/_lib/anon-limit";

/**
 * /asistente — Asistente Comunitario (wireframe §4.e, moat de IA §3.②).
 *
 * Se nombra por la comunidad ("Asistente de Queens, NY") — NUNCA "Chatbot IA".
 * Disclaimer legal FIJO bajo el header (encuadre §11): informa con fuentes,
 * no aconseja. Accesible por anónimos con límite de 3 preguntas (cookie
 * firmada) → invitación cálida a crear cuenta.
 */

export const metadata: Metadata = { title: "Asistente" };

export default async function AsistentePage() {
  const [tenant, supabase, cookieStore] = await Promise.all([
    getTenant(),
    createClient(),
    cookies(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Ciudad del tenant para el título hiperlocal (fallback: nombre del tenant).
  let cityLabel = tenant.name;
  try {
    const { data } = await supabase
      .from("tenants")
      .select("city_seed")
      .eq("id", tenant.id)
      .maybeSingle();
    cityLabel = data?.city_seed ?? tenant.name;
  } catch {
    // sin DB seguimos con el nombre — jamás bloquear la pantalla por esto
  }

  const isAnon = !user;
  const initialAnonRemaining = isAnon
    ? anonRemaining(cookieStore.get(ANON_COOKIE)?.value ?? null)
    : null;

  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col">
      <header className="mb-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.header.title(cityLabel)}
        </h1>
        <p className="mt-0.5 text-sm text-foreground-secondary">
          {COPY.header.subtitle}
        </p>
      </header>

      {/* Disclaimer legal FIJO — sticky bajo el header del shell (h-14) */}
      <div className="sticky top-14 z-30 -mx-4 bg-canvas/95 px-4 py-2 backdrop-blur-sm">
        <p
          role="note"
          className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2.5 text-[13px] leading-snug text-info"
        >
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {COPY.disclaimer}
        </p>
      </div>

      {isOpenAIConfigured ? (
        <AssistantChat
          isAnon={isAnon}
          initialAnonRemaining={
            initialAnonRemaining === null
              ? null
              : Math.min(initialAnonRemaining, ANON_LIMIT)
          }
        />
      ) : (
        /* Degradación elegante §5.6 — nunca un error técnico crudo */
        <ProximamentePremium feature="el asistente comunitario" className="mt-4" />
      )}
    </div>
  );
}

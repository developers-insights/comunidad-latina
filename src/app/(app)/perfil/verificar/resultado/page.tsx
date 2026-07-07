import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowClockwise,
  HourglassMedium,
  SealCheck,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, buttonVariants } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";
import { IDENTITY_SESSION_COOKIE } from "../identity-session";

export const metadata = { title: "Verificación de identidad" };

/** Copy local del módulo IDENTIDAD — no toca src/lib/i18n (compartido). */
const COPY = {
  titulo: "Verificación de identidad",
  verificadaTitulo: "¡Tu identidad quedó verificada!",
  verificadaCuerpo: (fecha: string | null) =>
    fecha
      ? `Documento validado por Stripe Identity el ${fecha}. El tilde ya aparece en tu perfil.`
      : "Documento validado por Stripe Identity. El tilde aparece en tu perfil en unos minutos.",
  procesandoTitulo: "Estamos procesando tu verificación",
  procesandoCuerpo:
    "Stripe está revisando tu documento — suele tardar menos de un minuto. Te avisamos con una notificación apenas esté listo. Podés seguir usando la app tranquilo.",
  reintentoTitulo: "Nos faltó un detalle",
  reintentoCuerpo:
    "No pudimos completar la verificación — pasa seguido con fotos movidas o con poca luz. No es tu culpa: probá de nuevo con buena luz y el documento completo en el encuadre.",
  reintentar: "Intentar de nuevo",
  irPerfil: "Ir a tu perfil",
  // §11: nunca "verificado" a secas.
  disclaimer:
    "Verificar tu identidad confirma que tu documento es real — no garantiza la conducta de nadie. Nunca envíes dinero por adelantado.",
} as const;

type Estado = "verificada" | "procesando" | "reintento";

export default async function ResultadoVerificacionPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil/verificar");

  const { data: profile } = await supabase
    .from("profiles")
    .select("identity_verified, identity_verified_at")
    .eq("id", user.id)
    .maybeSingle();

  // Fuente de verdad #1: el flag del perfil (lo enciende el webhook).
  let estado: Estado = "procesando";
  if (profile?.identity_verified) {
    estado = "verificada";
  } else if (isStripeConfigured) {
    // Fuente #2: la sesión de Stripe directamente (el webhook puede demorar).
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(IDENTITY_SESSION_COOKIE)?.value;
    if (sessionId && /^vs_[A-Za-z0-9]+$/.test(sessionId)) {
      try {
        const session = await getStripe().identity.verificationSessions.retrieve(
          sessionId,
        );
        // Anti-confusión: la cookie debe ser de ESTE usuario.
        if (session.metadata?.user_id === user.id) {
          if (session.status === "verified") estado = "verificada";
          else if (session.status === "requires_input") estado = "reintento";
          // "processing" y "canceled" quedan en procesando/pendiente suave.
          if (session.status === "canceled") estado = "reintento";
        }
      } catch (error) {
        // Sesión vieja o error de red → estado procesando (nunca romper §5.6).
        console.warn(
          "[identidad] No se pudo consultar la VerificationSession:",
          error instanceof Error ? error.message : "error desconocido",
        );
      }
    }
  }

  const fechaVerificada = profile?.identity_verified_at
    ? formatDate(profile.identity_verified_at, { locale: tenant.locale, style: "long" })
    : null;

  return (
    <div className="flex flex-col gap-6 pb-8">
      <h1 className="sr-only">{COPY.titulo}</h1>

      {estado === "verificada" && (
        <BezelCard
          variant="success"
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
          role="status"
        >
          <SealCheck size={56} weight="fill" aria-hidden="true" className="text-success" />
          <p className="font-display text-xl font-bold text-foreground">
            {COPY.verificadaTitulo}
          </p>
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            {COPY.verificadaCuerpo(fechaVerificada)}
          </p>
          <Link
            href="/perfil"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-1")}
          >
            {COPY.irPerfil}
          </Link>
        </BezelCard>
      )}

      {estado === "procesando" && (
        <BezelCard
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
          role="status"
        >
          <HourglassMedium
            size={56}
            weight="light"
            aria-hidden="true"
            className="text-brand"
          />
          <p className="font-display text-xl font-bold text-foreground">
            {COPY.procesandoTitulo}
          </p>
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            {COPY.procesandoCuerpo}
          </p>
          <Link
            href="/perfil"
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-1")}
          >
            {COPY.irPerfil}
          </Link>
        </BezelCard>
      )}

      {estado === "reintento" && (
        <BezelCard
          variant="warning"
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
          role="status"
        >
          <ArrowClockwise
            size={56}
            weight="light"
            aria-hidden="true"
            className="text-warning"
          />
          <p className="font-display text-xl font-bold text-foreground">
            {COPY.reintentoTitulo}
          </p>
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            {COPY.reintentoCuerpo}
          </p>
          <Link
            href="/perfil/verificar"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-1")}
          >
            {COPY.reintentar}
          </Link>
        </BezelCard>
      )}

      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.disclaimer}
      </p>
    </div>
  );
}

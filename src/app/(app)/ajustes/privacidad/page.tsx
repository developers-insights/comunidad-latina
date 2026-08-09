import Link from "next/link";
import { ArrowSquareOut, DownloadSimple, FileText } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui";
import { PrivacyControls } from "@/components/legal/privacy-controls";
import { ProfilePrivacyForm } from "@/components/legal/profile-privacy-form";
import { CONSENT_COPY as COPY } from "@/components/legal/consent-copy";
import { normalizePrivacy } from "@/lib/profile/privacy";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: COPY.settings.title };

/**
 * Ajustes › Privacidad.
 *
 * Es la casa permanente de tres cosas que la ley exige que estén siempre a
 * mano y que hasta ahora no tenían dónde vivir:
 *   · revocar el consentimiento (RGPD art. 7.3: retirarlo tiene que ser tan
 *     fácil como darlo, y no puede depender de que reaparezca un banner);
 *   · el derecho de acceso y portabilidad (art. 15 y 20 / "right to know" de
 *     la CCPA), que antes no existía en ninguna parte de la app;
 *   · el "no vendan mi información" que California exige enlazar.
 *
 * Anónimo también entra: la política y los controles del navegador sirven sin
 * sesión. Lo que necesita cuenta —bajar tus datos— se muestra sólo con sesión,
 * en vez de ofrecer un botón que rebota a /entrar.
 */
export default async function PrivacidadAjustesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /**
   * Los controles del PERFIL (quién ve tu apellido, tu edad, dónde vivís…) se
   * suman a esta pantalla en vez de tener casa propia: son la misma pregunta
   * —"¿qué se sabe de mí?"— y partirlos en dos rutas hace que la mitad de la
   * gente encuentre una sola.
   *
   * LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS (0063): no se siembra una fila
   * por registro, para que nadie quede expuesto por una fila que no se llegó a
   * crear. `normalizePrivacy(null)` devuelve exactamente esos defaults.
   *
   * La consulta corre con el cliente de servidor, o sea con RLS: la policy de
   * `profile_privacy` es solo-dueño, así que ni siquiera es consultable qué
   * configuró otra persona.
   */
  let privacy = null;
  if (user) {
    const { data } = await supabase
      .from("profile_privacy")
      .select(
        "show_last_name, show_birthdate, show_location, show_languages, show_country_origin, show_bio, show_followers, show_posts",
      )
      .eq("profile_id", user.id)
      .maybeSingle();
    privacy = data;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.settings.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.settings.subtitle}</p>
      </header>

      {/* Los controles del perfil van PRIMEROS: son los que la gente viene a
          buscar. Lo de las cookies y el almacenamiento del navegador es
          importante y sirve sin cuenta, pero no es lo que alguien tiene en la
          cabeza cuando entra a "Privacidad" desde su perfil. */}
      {user && <ProfilePrivacyForm initial={normalizePrivacy(privacy)} />}

      <PrivacyControls />

      <section className="rounded-xl border border-border-subtle bg-surface p-4">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.settings.rights.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {COPY.settings.rights.body}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {user && (
            // <a> y no <Link>: es una descarga, no una navegación. `Link`
            // haría prefetch de una ruta que genera un archivo con datos
            // personales cada vez que se pasa el dedo por encima.
            <a
              href="/ajustes/privacidad/exportar"
              download
              className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
            >
              <DownloadSimple size={16} aria-hidden="true" />
              {COPY.settings.rights.exportCta}
            </a>
          )}

          <Link
            href="/legal/cookies"
            className={cn(buttonVariants({ variant: "ghost" }), "w-full sm:w-auto")}
          >
            <FileText size={16} aria-hidden="true" />
            {COPY.settings.nothingToConsent.cta}
          </Link>
        </div>
      </section>

      {/* Enlace obligatorio en California (CPRA §1798.135). Se pone aunque la
          respuesta sea "no vendemos": el derecho es a PEDIRLO, y esconderlo
          porque no aplica es justamente lo que la ley no permite. */}
      <section
        id="no-vender"
        className="scroll-mt-24 rounded-xl border border-border-subtle bg-surface-subtle p-4"
      >
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.settings.rights.doNotSell}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {COPY.settings.rights.doNotSellNote}
        </p>
        <Link
          href="/legal/privacidad#tus-derechos"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          Cómo ejercer tus derechos
          <ArrowSquareOut size={14} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

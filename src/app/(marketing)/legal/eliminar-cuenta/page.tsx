import type { Metadata } from "next";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { SUPPORT_EMAIL } from "@/lib/support/contact";
import { LegalCallout, LegalHeader, LegalSection, legalProse } from "@/components/legal/legal-prose";

/**
 * Página pública (sin sesión) que Google Play exige como "URL de eliminación
 * de cuenta": tiene que decir cómo pedir la baja SIN instalar la app y qué se
 * borra y qué se conserva. Lo que afirma tiene que coincidir con
 * `deleteAccountAction` (perfil/actions.ts) y con la declaración de Data
 * safety de Play: si cambia el borrado, cambia esta página.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";
const UPDATED = "19 de octubre de 2026";
const DELETE_SUBJECT = "Eliminar mi cuenta";

const linkClass =
  "font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Eliminar tu cuenta — ${tenant.name}`;
  const description =
    "Cómo eliminar tu cuenta desde la app o pedirlo por correo, qué datos se borran y cuáles se conservan.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/eliminar-cuenta` },
    openGraph: { title, description, type: "website", locale: "es_US" },
  };
}

export default async function EliminarCuentaPage() {
  const tenant = await getTenant();
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(DELETE_SUBJECT)}`;

  return (
    <article>
      <LegalHeader
        title="Eliminar tu cuenta"
        updated={UPDATED}
        intro={
          <>
            Podés eliminar tu cuenta de {tenant.name} cuando quieras: desde la app en un minuto,
            o pidiéndonoslo por correo si ya no tenés la app instalada.
          </>
        }
      />

      <LegalSection id="desde-la-app" title="Desde la app o la web">
        <ol className={legalProse.ol}>
          <li>Entrá con tu cuenta.</li>
          <li>
            Abrí <strong className={legalProse.strong}>Ajustes</strong> y bajá hasta el final.
          </li>
          <li>
            Tocá <strong className={legalProse.strong}>Eliminar mi cuenta</strong> y confirmá.
          </li>
        </ol>
        <p className={legalProse.p}>
          La cuenta se elimina en ese momento y se cierra tu sesión.
        </p>
      </LegalSection>

      <LegalSection id="por-correo" title="Sin la app, por correo">
        <p className={legalProse.p}>
          Escribinos a{" "}
          <a href={mailto} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>{" "}
          desde el correo con el que te registraste, con el asunto «{DELETE_SUBJECT}». Así sabemos
          que la cuenta es tuya. Te respondemos en hasta 3 días hábiles y la eliminamos en un
          plazo máximo de 30 días.
        </p>
        <LegalCallout>
          Si tenés un negocio con una suscripción activa o participaste en un contrato de trabajo
          con un creador, la baja se hace por correo: primero cancelamos la suscripción y
          conservamos el registro del contrato, como se explica abajo.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="que-se-borra" title="Qué se borra">
        <ul className={legalProse.ul}>
          <li>Tu perfil, tu foto y tus datos de contacto.</li>
          <li>Tus mensajes y conversaciones.</li>
          <li>Tus avisos, con las fotos, los videos y los archivos que subiste, como tu currículum.</li>
          <li>Tus guardados, seguidos y notificaciones.</li>
        </ul>
      </LegalSection>

      <LegalSection id="que-se-conserva" title="Qué se conserva y por cuánto">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Publicaciones y comentarios en la comunidad.</strong>{" "}
            Se quedan porque les sirven a otros, pero dejan de estar a tu nombre: se muestran como
            de «cuenta eliminada».
          </li>
          <li>
            <strong className={legalProse.strong}>Reportes de estafa que hiciste.</strong> Se
            conservan sin tu nombre, para proteger a la comunidad.
          </li>
          <li>
            <strong className={legalProse.strong}>Registros de seguridad.</strong> Nunca incluyen
            el contenido de tus mensajes y se borran solos al año.
          </li>
          <li>
            <strong className={legalProse.strong}>Pagos.</strong> Stripe guarda el registro de los
            cobros el tiempo que exigen las leyes fiscales.
          </li>
          <li>
            <strong className={legalProse.strong}>Contratos con creadores.</strong> El contrato
            firmado se conserva mientras pueda hacer falta como prueba legal.
          </li>
        </ul>
        <p className={legalProse.p}>
          El detalle de todo lo que guardamos está en la{" "}
          <Link href="/legal/privacidad" className={linkClass}>
            Política de privacidad
          </Link>
          .
        </p>
      </LegalSection>
    </article>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { SUPPORT_EMAIL } from "@/lib/support/contact";
import { LegalCallout, LegalHeader, LegalSection, legalProse } from "@/components/legal/legal-prose";

/**
 * Estándares contra la explotación y el abuso sexual infantil (CSAE). Google
 * Play exige esta página pública a toda app social o con contenido de usuarios
 * ("Child safety standards" en App content), con un punto de contacto. Lo que
 * promete acá (cierre de cuenta, denuncia a NCMEC) es obligación legal en EE. UU.
 * (18 U.S.C. § 2258A) y tiene que cumplirse desde la moderación.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";
const UPDATED = "21 de octubre de 2026";
const SUBJECT = "Seguridad infantil";

const linkClass =
  "font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Seguridad infantil — ${tenant.name}`;
  const description =
    "Tolerancia cero con la explotación y el abuso sexual infantil: qué prohibimos, cómo denunciarlo y qué hacemos.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/seguridad-infantil` },
    openGraph: { title, description, type: "website", locale: "es_US" },
  };
}

export default async function SeguridadInfantilPage() {
  const tenant = await getTenant();
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}`;

  return (
    <article>
      <LegalHeader
        title="Seguridad infantil"
        updated={UPDATED}
        intro={
          <>
            En {tenant.name} hay tolerancia cero con la explotación y el abuso sexual infantil. La
            plataforma es solo para mayores de 18 años, y cualquier contenido o conducta que ponga
            en riesgo a un menor se elimina y se denuncia.
          </>
        }
      />

      <LegalSection id="que-prohibimos" title="Qué está prohibido">
        <ul className={legalProse.ul}>
          <li>Material de abuso sexual infantil, en cualquier formato, incluso dibujado o generado.</li>
          <li>Contenido que sexualice a menores, aunque no muestre desnudez.</li>
          <li>
            Contactar a un menor con fines sexuales, pedirle fotos o intentar ganarse su confianza
            para eso.
          </li>
          <li>Ofrecer, buscar o promover la trata o la explotación de menores.</li>
          <li>Compartir enlaces o indicaciones para encontrar este tipo de material.</li>
        </ul>
      </LegalSection>

      <LegalSection id="como-denunciar" title="Cómo denunciarlo">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Desde la app:</strong> tocá «Reportar» en el
            perfil, el aviso o el mensaje. Los reportes los revisa una persona de nuestro equipo.
          </li>
          <li>
            <strong className={legalProse.strong}>Por correo:</strong> escribinos a{" "}
            <a href={mailto} className={linkClass}>
              {SUPPORT_EMAIL}
            </a>{" "}
            con el asunto «{SUBJECT}». Es nuestro punto de contacto para estos casos.
          </li>
          <li>
            <strong className={legalProse.strong}>Directo a las autoridades:</strong> podés
            denunciar en el CyberTipline del National Center for Missing &amp; Exploited Children
            (NCMEC), en{" "}
            <a href="https://report.cybertip.org" className={linkClass} rel="noopener noreferrer">
              report.cybertip.org
            </a>{" "}
            o al 1-800-843-5678.
          </li>
        </ul>
        <LegalCallout tone="warning">
          Si un menor está en peligro ahora, llamá al 911.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="que-hacemos" title="Qué hacemos">
        <ul className={legalProse.ul}>
          <li>Eliminamos el contenido apenas lo detectamos o nos lo reportan.</li>
          <li>Cerramos la cuenta de forma definitiva.</li>
          <li>
            Denunciamos el material de abuso sexual infantil al NCMEC, como exige la ley de Estados
            Unidos, y colaboramos con las autoridades.
          </li>
          <li>
            Las fotos y los videos de publicaciones y avisos los revisa una persona antes de que se
            vean, y los textos pasan por una moderación automática.
          </li>
        </ul>
        <p className={legalProse.p}>
          Estas reglas son parte de las{" "}
          <Link href="/legal/normas" className={linkClass}>
            Normas de la comunidad
          </Link>{" "}
          y de los{" "}
          <Link href="/legal/terminos" className={linkClass}>
            Términos de uso
          </Link>
          .
        </p>
      </LegalSection>
    </article>
  );
}

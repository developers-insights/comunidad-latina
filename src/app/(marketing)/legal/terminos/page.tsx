import type { Metadata } from "next";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { JsonLd } from "@/components/marketing/json-ld";
import {
  LegalCallout,
  LegalHeader,
  LegalSection,
  LegalToc,
  legalProse,
} from "@/components/legal/legal-prose";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

const TOC = [
  { id: "que-es-esto", label: "Qué es esta plataforma" },
  { id: "quien-puede-usar", label: "Quién puede usarla" },
  { id: "tu-cuenta", label: "Tu cuenta" },
  { id: "lo-que-publicas", label: "Lo que publicás" },
  { id: "verificacion", label: "Sobre la verificación" },
  { id: "vivienda-y-negocios", label: "Vivienda, negocios y acuerdos entre usuarios" },
  { id: "moderacion", label: "Moderación, reportes y sanciones" },
  { id: "borrar-tu-cuenta", label: "Borrar tu cuenta" },
  { id: "cambios", label: "Cambios a estos Términos" },
  { id: "contacto", label: "Ley aplicable y contacto" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Términos de Uso — ${tenant.name}`;
  const description =
    "Las reglas claras para usar la plataforma: qué podés hacer, qué esperamos de vos y qué hacemos nosotros.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/terminos` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function TerminosPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Términos de Uso — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/terminos`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Términos de Uso"
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> esto es la letra chica,
            pero a la vista y en español de todos los días — qué podés hacer en{" "}
            {tenant.name}, qué esperamos de vos, y qué hacemos nosotros de nuestro lado.
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="que-es-esto" title="Qué es esta plataforma">
        <p className={legalProse.p}>
          {tenant.name} es una comunidad pensada para inmigrantes latinos en Estados Unidos:
          avisos de vivienda, guías para tus trámites, negocios locales y gente que ya pasó por lo
          mismo que vos y puede darte una mano. Al usar la plataforma, aceptás estos Términos.
        </p>
        <p className={legalProse.p}>
          Si algo acá no te cierra, contanos — esto se escribe pensando en gente real, y podemos
          mejorarlo.
        </p>
      </LegalSection>

      <LegalSection id="quien-puede-usar" title="Quién puede usarla">
        <ul className={legalProse.ul}>
          <li>Tenés que tener 18 años o más.</li>
          <li>
            Tenés que darnos datos reales: un nombre para mostrar y un email que uses de verdad.
            No hace falta tu nombre legal completo, pero no puede ser para engañar a nadie.
          </li>
          <li>Una cuenta por persona.</li>
          <li>
            Podés usarla estés donde estés en tu proceso migratorio — no te pedimos estatus
            migratorio para registrarte, y nunca lo vamos a pedir.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="tu-cuenta" title="Tu cuenta">
        <ul className={legalProse.ul}>
          <li>
            Para crear tu cuenta solo pedimos nombre para mostrar, email y contraseña — nada de
            teléfono ni dirección.
          </li>
          <li>Sos responsable de tu contraseña y de lo que pase con tu cuenta.</li>
          <li>Si notás algo raro (alguien entró sin tu permiso), avisanos apenas puedas.</li>
        </ul>
      </LegalSection>

      <LegalSection id="lo-que-publicas" title="Lo que publicás">
        <p className={legalProse.p}>
          Lo que publicás —fotos, avisos de vivienda, publicaciones, mensajes— sigue siendo tuyo.
          Nos das permiso para mostrarlo dentro de la plataforma, y nada más.
        </p>
        <p className={legalProse.p}>
          No publiques nada falso, ilegal, discriminatorio o que perjudique a otra persona. Las
          reglas completas de convivencia están en las{" "}
          <Link
            href="/legal/normas"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Normas de la Comunidad
          </Link>
          . Si algo las rompe, podemos removerlo — sin previo aviso si la situación lo amerita,
          por ejemplo una estafa activa.
        </p>
      </LegalSection>

      <LegalSection id="verificacion" title="Sobre la verificación">
        <p className={legalProse.p}>
          Hay dos sellos distintos. El de un negocio o profesional (licencias, matrículas) sale de
          consultar un registro público oficial: te mostramos textual lo que dice, con la fecha
          exacta en que lo consultamos. El de tu identidad personal, cuando esa función esté
          activa, sale de subir tu documento a Stripe Identity — lo procesan ellos, nunca
          nosotros.
        </p>
        <LegalCallout tone="warning">
          Cualquiera de los dos es un indicador de lo que dice la fuente a esa fecha —{" "}
          <strong>no</strong> es una garantía de que la persona o el negocio se vaya a comportar
          bien. La regla de oro no tiene excepciones: nunca envíes dinero por adelantado.
        </LegalCallout>
      </LegalSection>

      <LegalSection
        id="vivienda-y-negocios"
        title="Vivienda, negocios y acuerdos entre usuarios"
      >
        <p className={legalProse.p}>
          {tenant.name} conecta personas — no es parte de ningún contrato de alquiler,
          compraventa o servicio entre usuarios. No somos inmobiliaria, no procesamos pagos entre
          usuarios ni garantizamos ningún trato.
        </p>
        <p className={legalProse.p}>
          Cualquier acuerdo lo cierran las partes directamente, fuera de la plataforma, bajo su
          propia responsabilidad.
        </p>
      </LegalSection>

      <LegalSection id="moderacion" title="Moderación, reportes y sanciones">
        <p className={legalProse.p}>
          Moderamos contenido y cuentas para cuidar la convivencia. Podés reportar
          cualquier perfil, aviso o mensaje en un par de toques, y es anónimo para la otra
          persona.
        </p>
        <p className={legalProse.p}>
          Si alguien rompe las Normas de la Comunidad, según la gravedad puede recibir una
          advertencia, una suspensión temporal de su cuenta o la baja definitiva.
        </p>
      </LegalSection>

      <LegalSection id="borrar-tu-cuenta" title="Borrar tu cuenta">
        <p className={legalProse.p}>
          Podés eliminar tu cuenta cuando quieras, desde Ajustes. Se borra tu perfil, tus
          mensajes, tus conversaciones y tus avisos —incluidas las fotos y los archivos que
          subiste, como tu currículum—. Es una acción irreversible: no hay vuelta atrás, y si un
          día volvés, empezás de cero.
        </p>
        <p className={legalProse.p}>
          Tus publicaciones y comentarios en la comunidad se quedan, porque le siguen sirviendo a
          otros, pero dejan de estar a tu nombre: se muestran como de «cuenta eliminada» y ya no
          hay forma de asociarlos con vos.
        </p>
        <p className={legalProse.p}>
          Si tenés un negocio activo con suscripción paga, primero hay que dar de baja esa
          suscripción — te lo decimos en el momento y te ayudamos a resolverlo.
        </p>
      </LegalSection>

      <LegalSection id="cambios" title="Cambios a estos Términos">
        <p className={legalProse.p}>
          Podemos actualizar estos Términos a medida que la plataforma crece. Si el cambio es
          importante, te lo avisamos dentro de la plataforma antes de que entre en vigencia.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="Ley aplicable y contacto">
        <p className={legalProse.p}>
          Estos Términos se rigen por las leyes de Estados Unidos
          [y del estado de — completar]. Para cualquier consulta legal sobre estos Términos,
          escribinos a [correo de contacto legal — completar].
        </p>
      </LegalSection>
    </article>
  );
}

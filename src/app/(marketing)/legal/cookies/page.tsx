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
import { CookieTable } from "@/components/legal/cookie-table";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

const TOC = [
  { id: "resumen", label: "Lo que importa, en tres líneas" },
  { id: "imprescindibles", label: "Las imprescindibles" },
  { id: "preferencias", label: "Tus preferencias" },
  { id: "medicion", label: "Medición de uso" },
  { id: "publicidad", label: "Publicidad" },
  { id: "terceros", label: "Empresas que nos ayudan" },
  { id: "controlar", label: "Cómo lo controlás vos" },
  { id: "cambios", label: "Si esto cambia" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Política de Cookies — ${tenant.name}`;
  const description =
    "La lista completa de lo que guardamos en tu teléfono, para qué sirve cada cosa y cómo borrarla.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/cookies` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function CookiesPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Política de Cookies — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/cookies`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Política de Cookies"
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> {tenant.name} guarda
            unas pocas cosas en tu teléfono para que puedas entrar a tu cuenta y para
            recordar cómo te gusta usar la app. Nada más. Acá está la lista completa, sin
            esconder ninguna.
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="resumen" title="Lo que importa, en tres líneas">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>No te seguimos por internet.</strong> No
            usamos herramientas de medición ni de publicidad, ni propias ni de otras
            empresas.
          </li>
          <li>
            <strong className={legalProse.strong}>
              Nadie más pone cookies en tu teléfono desde nuestra app.
            </strong>{" "}
            Todo lo de la lista de abajo lo ponemos nosotros.
          </li>
          <li>
            <strong className={legalProse.strong}>Tus preferencias no viajan.</strong> Tu
            historial de búsqueda y el modo claro u oscuro se quedan en el navegador que
            estás usando.
          </li>
        </ul>
        <LegalCallout>
          Por eso no vas a ver un cartel de cookies al entrar. No hay nada que pedirte
          permiso para usar: lo poco que guardamos hace falta para que la app funcione o lo
          elegiste vos. El día que eso cambie, te vamos a preguntar antes — no después.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="imprescindibles" title="Las imprescindibles">
        <p className={legalProse.p}>
          Sin estas la app no funciona: no podrías iniciar sesión ni te reconoceríamos de
          una pantalla a la otra. No se pueden apagar, y no sirven para seguirte.
        </p>
        <CookieTable category="necesarias" />
      </LegalSection>

      <LegalSection id="preferencias" title="Tus preferencias">
        <p className={legalProse.p}>
          Recuerdan cómo te gusta usar la app. Las guardamos porque vos las elegiste —al
          cambiar el tema, al buscar algo, al bajar una guía— y{" "}
          <strong className={legalProse.strong}>
            nunca salen del navegador que estás usando
          </strong>
          : no llegan a nuestros servidores ni a los de nadie.
        </p>
        <CookieTable category="preferencias" />
        <p className={legalProse.p}>
          Podés borrarlas todas de una vez desde{" "}
          <Link
            href="/ajustes/privacidad"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Ajustes › Privacidad
          </Link>
          . Tu cuenta y tus publicaciones no se tocan.
        </p>
      </LegalSection>

      <LegalSection id="medicion" title="Medición de uso">
        <CookieTable category="analitica" />
        <p className={legalProse.p}>
          Si algún día queremos medir cómo se usa la app, te lo vamos a preguntar antes de
          activar nada, y vas a poder decir que no con un solo toque.
        </p>
      </LegalSection>

      <LegalSection id="publicidad" title="Publicidad">
        <CookieTable category="marketing" />
        <p className={legalProse.p}>
          No vendemos ni compartimos tu información con nadie para publicidad. Tampoco está
          en nuestros planes.
        </p>
      </LegalSection>

      <LegalSection id="terceros" title="Empresas que nos ayudan">
        <p className={legalProse.p}>
          Ninguna de estas empresas pone cookies en tu teléfono a través de nuestra app.
          Las nombramos igual porque procesan datos tuyos de nuestro lado, y tenés derecho a
          saber quiénes son. Todas están en Estados Unidos.
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Supabase</strong> — guarda tu cuenta, tus
            publicaciones y tus fotos.
          </li>
          <li>
            <strong className={legalProse.strong}>Resend</strong> — envía los correos de la
            plataforma (confirmar tu cuenta, avisos).
          </li>
          <li>
            <strong className={legalProse.strong}>Sentry</strong> — nos avisa cuando algo se
            rompe, para poder arreglarlo. Recibe el error, no a vos: le quitamos tu correo,
            tu teléfono y tu dirección de internet antes de enviarlo.
          </li>
          <li>
            <strong className={legalProse.strong}>Stripe</strong> — cobra las suscripciones
            y, cuando esa función esté activa, verifica identidades.
          </li>
          <li>
            <strong className={legalProse.strong}>OpenAI</strong> y{" "}
            <strong className={legalProse.strong}>Google Cloud Vision</strong> — revisan
            publicaciones y fotos para detectar estafas y contenido prohibido.
          </li>
          <li>
            <strong className={legalProse.strong}>Anthropic</strong> — responde las preguntas
            del asistente, cuando esa función esté activa.
          </li>
        </ul>
        <p className={legalProse.p}>
          El detalle de qué recibe cada una está en la{" "}
          <Link
            href="/legal/privacidad"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Política de Privacidad
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="controlar" title="Cómo lo controlás vos">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Desde la app:</strong> en{" "}
            <Link
              href="/ajustes/privacidad"
              className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
            >
              Ajustes › Privacidad
            </Link>{" "}
            ves exactamente qué hay guardado en este teléfono y lo borrás con un botón.
          </li>
          <li>
            <strong className={legalProse.strong}>Desde tu navegador:</strong> podés bloquear
            o borrar cookies desde su configuración. Si bloqueás las imprescindibles no vas a
            poder iniciar sesión — no es un castigo nuestro, es que sin ellas el sitio no
            sabe quién sos.
          </li>
          <li>
            <strong className={legalProse.strong}>Cerrando sesión:</strong> se borra la cookie
            que te mantiene identificado.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cambios" title="Si esto cambia">
        <p className={legalProse.p}>
          Esta lista sale directamente del código de la app, así que se actualiza sola cuando
          agregamos o sacamos algo — no depende de que alguien se acuerde de editar esta
          página.
        </p>
        <p className={legalProse.p}>
          Si algún día sumamos algo que necesite tu permiso, te lo vamos a pedir antes de
          activarlo, con la opción de rechazar tan a mano como la de aceptar.
        </p>
      </LegalSection>
    </article>
  );
}

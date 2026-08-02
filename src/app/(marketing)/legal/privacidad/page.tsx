import type { Metadata } from "next";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { JsonLd } from "@/components/marketing/json-ld";
import {
  LegalCallout,
  LegalContact,
  LegalHeader,
  LegalSection,
  LegalToc,
  legalProse,
} from "@/components/legal/legal-prose";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

const TOC = [
  { id: "resumen", label: "Resumen honesto" },
  { id: "que-pedimos", label: "Qué te pedimos al registrarte" },
  { id: "por-que-podemos", label: "Por qué podemos usar tus datos" },
  { id: "ubicacion", label: "Tu ubicación es aproximada, siempre" },
  { id: "mensajes", label: "Tus mensajes se borran solos" },
  { id: "verificacion", label: "Cómo verificamos identidad y negocios" },
  { id: "inteligencia-artificial", label: "Dónde usamos inteligencia artificial" },
  { id: "con-quien-compartimos", label: "Con quién compartimos tus datos" },
  { id: "cookies", label: "Qué guardamos en tu teléfono" },
  { id: "seguridad", label: "Cómo protegemos tus datos" },
  { id: "tus-derechos", label: "Tus derechos sobre tus datos" },
  { id: "california", label: "Si estás en California" },
  { id: "europa", label: "Si estás en Europa o el Reino Unido" },
  { id: "menores", label: "Menores de edad" },
  { id: "cambios", label: "Cambios a esta Política" },
  { id: "contacto", label: "Contacto" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Política de Privacidad — ${tenant.name}`;
  const description =
    "Qué datos pedimos, por qué, y cuándo los borramos. Minimización de datos real, explicada sin letra chica.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/privacidad` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function PrivacidadPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Política de Privacidad — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/privacidad`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Política de Privacidad"
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> pedimos lo mínimo
            indispensable para que la plataforma funcione, y borramos lo que ya no hace falta.
            Así de simple — el resto de esta página es el detalle.
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="resumen" title="Resumen honesto">
        <p className={legalProse.p}>
          Sabemos que mucha gente llega acá en un momento vulnerable. Por eso diseñamos{" "}
          {tenant.name} para guardar lo menos posible:
        </p>
        <ul className={legalProse.ul}>
          <li>No pedimos tu teléfono ni tu dirección exacta al registrarte.</li>
          <li>Tu ubicación siempre se muestra aproximada — nunca la dirección exacta.</li>
          <li>
            Lo que nos contás al llegar (qué necesitás: vivienda, trámites, ayuda) lo ves solo
            vos — ni otros miembros ni nuestro equipo lo pueden leer.
          </li>
          <li>Tus mensajes se borran solos, con el tiempo.</li>
          <li>No vendemos tus datos a nadie.</li>
        </ul>
      </LegalSection>

      <LegalSection id="que-pedimos" title="Qué te pedimos al registrarte">
        <p className={legalProse.p}>
          Para crear tu cuenta pedimos tres cosas y nada más: un nombre para mostrar (el que
          elijas), tu email y una contraseña.
        </p>
        <p className={legalProse.p}>
          No pedimos teléfono, número de seguro social ni dirección postal en el registro. Si más
          adelante contás tu zona o barrio —por ejemplo, para buscar vivienda—, es siempre
          aproximado.
        </p>
      </LegalSection>

      <LegalSection id="por-que-podemos" title="Por qué podemos usar tus datos">
        <p className={legalProse.p}>
          No usamos tus datos «porque sí». Cada cosa que hacemos con ellos se apoya en una
          razón concreta:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Para cumplir con lo que te prometimos.</strong>{" "}
            Tu cuenta, tus publicaciones y tus mensajes existen porque pediste usar la
            plataforma.
          </li>
          <li>
            <strong className={legalProse.strong}>Porque nos diste permiso.</strong> Las cosas
            que son opcionales —verificar tu identidad, por ejemplo— solo pasan si vos las
            iniciás, y podés arrepentirte.
          </li>
          <li>
            <strong className={legalProse.strong}>Para cuidar a la comunidad.</strong> Moderar
            contenido, detectar estafas y mantener la app en pie son intereses legítimos
            nuestros y tuyos. Siempre buscamos la forma que menos datos use.
          </li>
          <li>
            <strong className={legalProse.strong}>Porque la ley nos obliga.</strong> En algunos
            casos puntuales tenemos que conservar o entregar información.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="ubicacion" title="Tu ubicación es aproximada, siempre">
        <p className={legalProse.p}>
          Cuando compartís dónde vivís o dónde buscás vivienda, mostramos la zona o el barrio —
          nunca la dirección exacta. La dirección real solo se comparte cuando vos decidís
          dársela a la otra persona directamente, fuera de la plataforma, una vez que confiás en
          el contacto.
        </p>
      </LegalSection>

      <LegalSection id="mensajes" title="Tus mensajes se borran solos">
        <p className={legalProse.p}>
          Los mensajes privados entre usuarios se guardan por un tiempo limitado —90
          días— y después se eliminan automáticamente. No dependés de acordarte de borrarlos, y
          nosotros no los guardamos «por si acaso». Las conversaciones sin mensajes activos
          también se limpian con el tiempo.
        </p>
        <p className={legalProse.p}>
          Lo mismo aplica al resto de lo que guardamos: tus notificaciones se borran solas a los
          60 días, y los registros internos que usamos para seguridad y soporte —nunca el
          contenido de tus mensajes— se limpian al año. Nada queda guardado «por las dudas».
        </p>
        <LegalCallout>
          Es una decisión de privacidad, no un descuido: menos dato guardado es menos riesgo para
          vos si algo sale mal en el camino.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="verificacion" title="Cómo verificamos identidad y negocios">
        <p className={legalProse.p}>Son dos verificaciones distintas, con datos distintos:</p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Tu identidad</strong> (el tilde de tu perfil):
            cuando esta función esté activa, subís tu documento a Stripe Identity, nuestro
            proveedor de verificación — lo procesan ellos, y el documento nunca llega a nuestra
            base de datos. Lo único que recibimos nosotros es un sí o un no, y la fecha.
            <br />
            <strong className={legalProse.strong}>Ojo con esto, que es importante:</strong> para
            confirmar que el documento es tuyo, Stripe te pide una selfie y compara tu cara con
            la foto del documento. Eso es un dato biométrico, de los más sensibles que existen.
            Nunca pasa sin que vos lo empieces, nosotros no recibimos ni tu cara ni tu documento,
            y podés usar toda la plataforma sin verificarte. Stripe explica cuánto conserva esos
            datos en su propia política de privacidad.
          </li>
          <li>
            <strong className={legalProse.strong}>Un negocio o profesional</strong> (licencias,
            matrículas): consultamos el registro público oficial correspondiente y guardamos solo
            el resultado textual y la fecha de consulta — no conservamos documentos de más.
          </li>
        </ul>
        <p className={legalProse.p}>
          Cualquiera de los dos sellos describe lo que dice la fuente a una fecha exacta; no es
          una garantía de conducta.
        </p>
      </LegalSection>

      <LegalSection id="inteligencia-artificial" title="Dónde usamos inteligencia artificial">
        <p className={legalProse.p}>
          La usamos en dos lugares, y en los dos casos el texto o la imagen salen de nuestros
          servidores hacia el proveedor:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Para revisar lo que se publica.</strong> Cuando
            alguien publica un aviso o una foto, el texto se manda a OpenAI y la imagen a Google
            Cloud Vision para detectar estafas, violencia o contenido prohibido. Es automático y
            pasa con todo lo que se publica.
          </li>
          <li>
            <strong className={legalProse.strong}>Para responder tus preguntas.</strong> Si usás
            el asistente, tu pregunta se manda a Anthropic para armar la respuesta. Solo pasa
            cuando vos escribís algo — si no lo usás, no sale nada.
          </li>
        </ul>
        <LegalCallout>
          Ninguna decisión importante sobre vos la toma una máquina sola. Si algo que publicaste
          queda frenado, lo revisa una persona de nuestro equipo antes de eliminarlo o
          sancionar tu cuenta, y podés pedir que se revise de nuevo.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="con-quien-compartimos" title="Con quién compartimos tus datos">
        <p className={legalProse.p}>
          <strong className={legalProse.strong}>No vendemos tus datos a nadie, nunca.</strong>{" "}
          Trabajamos con estas empresas, cada una para una sola tarea y con acceso únicamente a
          lo que esa tarea necesita. Todas están en Estados Unidos:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Supabase</strong> — guarda tu cuenta, tus
            publicaciones, tus mensajes y tus fotos.
          </li>
          <li>
            <strong className={legalProse.strong}>Resend</strong> — envía los correos de la
            plataforma. Recibe tu dirección de correo y el contenido del mensaje.
          </li>
          <li>
            <strong className={legalProse.strong}>Sentry</strong> — nos avisa cuando algo se
            rompe. Antes de enviar el error le quitamos tu correo, tu teléfono, tu dirección de
            internet y tus cookies: queda un código de cuenta que no dice quién sos.
          </li>
          <li>
            <strong className={legalProse.strong}>Stripe</strong> — cobra las suscripciones de
            negocios y, cuando esté activa, hace la verificación de identidad.
          </li>
          <li>
            <strong className={legalProse.strong}>OpenAI</strong>,{" "}
            <strong className={legalProse.strong}>Google Cloud Vision</strong> y{" "}
            <strong className={legalProse.strong}>Anthropic</strong> — lo explicado arriba sobre
            inteligencia artificial.
          </li>
        </ul>
        <p className={legalProse.p}>
          También podemos compartir información si nos lo exige la ley, y solo en esa medida.
        </p>
        <p className={legalProse.p}>
          <strong className={legalProse.strong}>Si escribís desde fuera de Estados Unidos</strong>{" "}
          —incluida la Unión Europea o el Reino Unido—, tus datos se guardan y se procesan en
          servidores estadounidenses. Las protecciones legales allá no son las mismas que en tu
          país. Al usar la plataforma sabés que esto pasa; si no te resulta cómodo, es motivo
          suficiente para no registrarte.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Qué guardamos en tu teléfono">
        <p className={legalProse.p}>
          Poco, y nada para seguirte: lo justo para mantener tu sesión abierta y recordar cómo te
          gusta usar la app. No usamos herramientas de medición ni de publicidad, ni propias ni
          de terceros.
        </p>
        <p className={legalProse.p}>
          La lista completa —cada cosa, para qué sirve, cuánto dura y cómo borrarla— está en la{" "}
          <Link
            href="/legal/cookies"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Política de Cookies
          </Link>
          , y podés verla y borrarla desde{" "}
          <Link
            href="/ajustes/privacidad"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Ajustes › Privacidad
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="seguridad" title="Cómo protegemos tus datos">
        <p className={legalProse.p}>
          Tus datos viven en Supabase, con cifrado en tránsito y controles de acceso por
          comunidad: cada comunidad ve solo lo suyo. Ninguna medida de seguridad es 100%
          infalible, pero nos tomamos en serio guardar lo mínimo y protegerlo bien.
        </p>
      </LegalSection>

      <LegalSection id="tus-derechos" title="Tus derechos sobre tus datos">
        <p className={legalProse.p}>
          Dos de ellos los ejercés vos solo, sin pedirnos permiso ni esperar respuesta:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Llevarte una copia de tus datos.</strong> Desde{" "}
            <Link
              href="/ajustes/privacidad"
              className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
            >
              Ajustes › Privacidad
            </Link>{" "}
            descargás un archivo con tu perfil, tus publicaciones, tus avisos y tus mensajes.
          </li>
          <li>
            <strong className={legalProse.strong}>Borrar tu cuenta.</strong> También desde
            Ajustes, y es inmediato.
          </li>
        </ul>
        <p className={legalProse.p}>
          Además podés pedirnos que corrijamos algo que esté mal, que limitemos cómo usamos tus
          datos, o que dejemos de usarlos para algo puntual. Escribinos y te respondemos.
        </p>
        <LegalCallout>
          Ejercer cualquiera de estos derechos no te cuesta nada y no cambia en nada cómo te
          tratamos. Nadie va a recibir peor servicio por pedir sus datos o por decir que no.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="california" title="Si estás en California">
        <p className={legalProse.p}>
          Las leyes CCPA y CPRA te dan derecho a saber qué información recolectamos y con quién
          la compartimos, a pedir que la borremos, a corregirla, y a que no te traten distinto
          por pedirlo. Todo eso ya está explicado arriba y vale para vos.
        </p>
        <p className={legalProse.p}>
          <strong className={legalProse.strong}>
            No vendemos ni compartimos tu información personal.
          </strong>{" "}
          Tampoco la usamos para publicidad dirigida, ni acá ni en otros sitios. Aun así, la ley
          nos pide darte un lugar para ejercer ese derecho, y está en{" "}
          <Link
            href="/ajustes/privacidad#no-vender"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            No vendan ni compartan mi información personal
          </Link>
          .
        </p>
        <p className={legalProse.p}>
          Podés autorizar a otra persona a hacer el pedido por vos. Vamos a pedirle una prueba
          de que la autorizaste, y a vos que lo confirmes — es la forma de que nadie pida tus
          datos haciéndose pasar por vos.
        </p>
      </LegalSection>

      <LegalSection id="europa" title="Si estás en Europa o el Reino Unido">
        <p className={legalProse.p}>
          La plataforma está pensada para la comunidad latina en Estados Unidos, pero se puede
          abrir desde cualquier lado. Si estás en la Unión Europea o el Reino Unido, el RGPD te
          da los derechos de acceso, rectificación, borrado, limitación, portabilidad y
          oposición. Los de acceso, borrado y portabilidad ya los tenés como botones en Ajustes;
          para el resto, escribinos.
        </p>
        <p className={legalProse.p}>
          Cuando usamos tus datos porque nos diste permiso, podés retirarlo cuando quieras, y
          hacerlo es tan fácil como fue darlo. Retirarlo no invalida lo que hicimos antes de que
          lo retiraras.
        </p>
        <p className={legalProse.p}>
          Si creés que manejamos mal tus datos, decínoslo primero — queremos arreglarlo. Y si aun
          así no quedás conforme, tenés derecho a reclamar ante la autoridad de protección de
          datos de tu país.
        </p>
      </LegalSection>

      <LegalSection id="menores" title="Menores de edad">
        <p className={legalProse.p}>
          La plataforma es para personas mayores de 18 años. Lo pedimos al registrarse y lo
          verificamos del lado del servidor, no solo con una casilla en la pantalla.
        </p>
        <p className={legalProse.p}>
          No la diseñamos pensando en menores y no recolectamos a sabiendas datos de personas
          menores de edad. Si te enterás de que un menor creó una cuenta, avisanos: la damos de
          baja y borramos sus datos apenas lo confirmemos.
        </p>
      </LegalSection>

      <LegalSection id="cambios" title="Cambios a esta Política">
        <p className={legalProse.p}>
          Si cambiamos algo importante sobre cómo manejamos tus datos, te lo avisamos dentro de
          la plataforma antes de que entre en vigencia.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="Contacto">
        <p className={legalProse.p}>
          Para cualquier consulta sobre tus datos o esta Política, o para ejercer cualquiera de
          los derechos de arriba, escribinos por <LegalContact />. Te respondemos dentro de los
          plazos que marca la ley: 30 días si estás en Europa, 45 si estás en California.
        </p>
        <p className={legalProse.p}>
          Para confirmar que sos vos, vamos a pedirte que hagas el pedido desde la cuenta de
          correo con la que te registraste. No te pedimos documentos para esto.
        </p>
      </LegalSection>
    </article>
  );
}

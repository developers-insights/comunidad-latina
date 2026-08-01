import type { Metadata } from "next";
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
  { id: "resumen", label: "Resumen honesto" },
  { id: "que-pedimos", label: "Qué te pedimos al registrarte" },
  { id: "ubicacion", label: "Tu ubicación es aproximada, siempre" },
  { id: "mensajes", label: "Tus mensajes se borran solos" },
  { id: "verificacion", label: "Cómo verificamos identidad y negocios" },
  { id: "con-quien-compartimos", label: "Con quién compartimos tus datos" },
  { id: "seguridad", label: "Cómo protegemos tus datos" },
  { id: "tus-derechos", label: "Tus derechos sobre tus datos" },
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

      <LegalSection id="con-quien-compartimos" title="Con quién compartimos tus datos">
        <ul className={legalProse.ul}>
          <li>No vendemos tus datos a nadie, nunca.</li>
          <li>
            Usamos proveedores externos solo para funciones puntuales: envío de emails
            transaccionales, procesamiento de pagos y verificación de identidad (cuando esas
            funciones estén activas), moderación de contenido, y el asistente comunitario con
            inteligencia artificial (tu pregunta se envía al proveedor solo cuando lo usás, para
            generar la respuesta). Cada uno accede solo a lo que necesita para su tarea.
          </li>
          <li>Podemos compartir información si nos lo exige la ley, y solo en esa medida.</li>
        </ul>
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
          Podés pedirnos acceder a los datos que tenemos de vos, corregirlos o eliminarlos.
        </p>
        <p className={legalProse.p}>
          Si estás en California, además tenés los derechos de la CCPA (Ley de Privacidad del
          Consumidor de California): saber qué datos recolectamos, pedir que los eliminemos y no
          sufrir ningún trato distinto por ejercer esos derechos.
        </p>
        <p className={legalProse.p}>
          La forma más rápida de ejercer tu derecho al borrado es eliminar tu cuenta vos mismo,
          desde Ajustes. Para cualquier otro pedido, escribinos a [correo de contacto legal —
          completar].
        </p>
      </LegalSection>

      <LegalSection id="menores" title="Menores de edad">
        <p className={legalProse.p}>
          La plataforma es para personas mayores de 18 años. No la diseñamos pensando en
          menores y no recolectamos a sabiendas datos de menores de edad.
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
          Para cualquier consulta sobre tus datos o esta Política, escribinos a [correo de
          contacto legal — completar].
        </p>
      </LegalSection>
    </article>
  );
}

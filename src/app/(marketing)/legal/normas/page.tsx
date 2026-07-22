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
  { id: "espiritu", label: "El espíritu de estas normas" },
  { id: "lo-que-si", label: "Lo que sí queremos ver" },
  { id: "lo-que-no", label: "Lo que no está permitido" },
  { id: "reportar-y-bloquear", label: "Cómo reportar o bloquear" },
  { id: "consecuencias", label: "Qué pasa si no se cumplen" },
  { id: "otros-documentos", label: "Relación con otros documentos" },
  { id: "contacto", label: "Contacto" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Normas de la Comunidad — ${tenant.name}`;
  const description =
    "Qué está permitido, qué no, y qué pasa si alguien rompe las reglas de convivencia de la comunidad.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/normas` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function NormasPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Normas de la Comunidad — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/normas`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Normas de la Comunidad"
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> tratá a los demás como te
            gustaría que te traten a vos si acabaras de llegar. El resto de esta página son los
            detalles.
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="espiritu" title="El espíritu de estas normas">
        <p className={legalProse.p}>
          {tenant.name} existe porque alguien que ya pasó por esto decidió tender una mano. Estas
          normas están para que eso siga siendo posible: un lugar donde da confianza pedir ayuda
          y ofrecerla.
        </p>
      </LegalSection>

      <LegalSection id="lo-que-si" title="Lo que sí queremos ver">
        <ul className={legalProse.ul}>
          <li>Preguntas reales sobre trámites, vivienda, trabajo o la vida en Estados Unidos.</li>
          <li>Avisos de vivienda y negocios con información verdadera.</li>
          <li>Compartir lo que aprendiste — tu experiencia le puede servir a alguien más.</li>
          <li>Discrepar con respeto.</li>
        </ul>
      </LegalSection>

      <LegalSection id="lo-que-no" title="Lo que no está permitido">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Estafas y pedidos de dinero por adelantado</strong>
            {" — "}pedir dinero, códigos o datos bancarios antes de conocer a alguien en persona o
            cerrar un trato de forma verificable.
          </li>
          <li>
            <strong className={legalProse.strong}>Acoso o maltrato</strong> — insultos, amenazas
            o contacto no deseado insistente.
          </li>
          <li>
            <strong className={legalProse.strong}>Discriminación</strong> — por origen, estatus
            migratorio, raza, religión, género, orientación sexual, discapacidad o cualquier otra
            condición.
          </li>
          <li>
            <strong className={legalProse.strong}>Suplantación de identidad</strong> — hacerte
            pasar por otra persona, negocio o entidad.
          </li>
          <li>
            <strong className={legalProse.strong}>Spam y contenido engañoso</strong> — publicidad
            no solicitada, avisos falsos, precios irreales o cuentas duplicadas.
          </li>
          <li>
            <strong className={legalProse.strong}>Contenido ilegal</strong> — cualquier cosa que
            viole la ley, incluida la venta de bienes o servicios ilegales.
          </li>
          <li>
            <strong className={legalProse.strong}>Compartir datos de otra persona sin permiso</strong>
            {" — "}su dirección exacta, documentos u otra información privada.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="reportar-y-bloquear" title="Cómo reportar o bloquear">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Reportar:</strong> en cualquier perfil, aviso o
            mensaje, tocá «Reportar», elegí qué pasó y enviá — dos toques. Es anónimo para la
            otra persona, y lo revisa nuestro equipo.
          </li>
          <li>
            <strong className={legalProse.strong}>Bloquear:</strong> podés ignorar o bloquear una
            conversación y desaparece de tu bandeja.
          </li>
        </ul>
        <LegalCallout>
          Actuamos más rápido en casos de estafa activa o de riesgo para alguien.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="consecuencias" title="Qué pasa si no se cumplen">
        <ol className={legalProse.ol}>
          <li>
            <strong className={legalProse.strong}>Advertencia</strong> — para la mayoría de las
            primeras veces, te avisamos qué hiciste mal y qué esperamos de ahí en más.
          </li>
          <li>
            <strong className={legalProse.strong}>Suspensión temporal</strong> — si se repite o
            es grave, tu cuenta queda pausada un tiempo: no podés publicar ni escribir mensajes.
          </li>
          <li>
            <strong className={legalProse.strong}>Baja definitiva</strong> — para estafas, daño a
            otras personas o casos graves, damos de baja la cuenta sin vuelta atrás.
          </li>
        </ol>
        <p className={legalProse.p}>
          El contenido que rompe estas normas lo podemos remover en cualquier momento, incluso
          sin previo aviso si la situación lo amerita.
        </p>
      </LegalSection>

      <LegalSection id="otros-documentos" title="Relación con otros documentos">
        <p className={legalProse.p}>
          Estas Normas se leen junto a los{" "}
          <Link
            href="/legal/terminos"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Términos de Uso
          </Link>{" "}
          y la{" "}
          <Link
            href="/legal/privacidad"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Política de Privacidad
          </Link>
          . Ante cualquier duda sobre qué datos usamos o cómo, esos documentos mandan.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="Contacto">
        <p className={legalProse.p}>
          Si algo no te cierra o querés apelar una decisión de moderación, escribinos a [correo de
          contacto legal — completar].
        </p>
      </LegalSection>
    </article>
  );
}

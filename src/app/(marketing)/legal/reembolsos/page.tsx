import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { SUPPORT_EMAIL, findTopic } from "@/lib/support/contact";
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
const UPDATED = "12 de octubre de 2026";
const LEGAL_ENTITY = "Comunidad Latina LLC";
const PAYMENTS_SUBJECT = findTopic("pagos").subject;

const linkClass =
  "font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink";

const TOC = [
  { id: "resumen", label: "Lo más importante" },
  { id: "suscripciones", label: "Suscripciones: cómo cancelar" },
  { id: "pagos-unicos", label: "Impulsos y campañas (pago único)" },
  { id: "siempre-devolvemos", label: "Cuándo te devolvemos siempre" },
  { id: "como-pedir", label: "Cómo pedir un reembolso" },
  { id: "colaboraciones", label: "Colaboraciones con creadores" },
  { id: "sin-reembolso", label: "Lo que no podemos devolver" },
  { id: "contracargos", label: "Si hablás con tu banco" },
  { id: "contacto", label: "Contacto" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Cancelación y reembolsos — ${tenant.name}`;
  const description =
    "Cómo cancelar una suscripción, cuándo te devolvemos el dinero, cómo pedirlo y cuánto tarda en volver a tu tarjeta.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/reembolsos` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/brand/og-logo.png", width: 1200, height: 630 }],
    },
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}

export default async function ReembolsosPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Política de cancelación y reembolsos — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/reembolsos`,
          publisher: { "@type": "Organization", name: LEGAL_ENTITY, url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Política de cancelación y reembolsos"
        updated={UPDATED}
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> podés cancelar cuando
            quieras, no te volvemos a cobrar, y si te cobramos algo por error te lo devolvemos
            completo. Acá está el detalle de cada caso, sin letra chica.
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="resumen" title="Lo más importante">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label="Cancelar">
            Cuando quieras, desde tu panel de facturación o escribiéndonos.
          </Fact>
          <Fact label="Después de cancelar">
            Seguís teniendo el beneficio hasta el fin del período que ya pagaste.
          </Fact>
          <Fact label="Para pedir un reembolso">
            Hasta 30 días después del cobro. Te respondemos en hasta 3 días hábiles.
          </Fact>
          <Fact label="Cuándo vuelve el dinero">
            A la misma tarjeta, en 5 a 10 días hábiles (es el plazo del banco).
          </Fact>
        </dl>
        <p className={legalProse.p}>
          Esta política la aplica {LEGAL_ENTITY}, que opera {tenant.name}. Todos los precios
          están en dólares estadounidenses (USD). Los pagos los procesa Stripe: nosotros nunca
          vemos ni guardamos los datos de tu tarjeta.
        </p>
      </LegalSection>

      <LegalSection id="suscripciones" title="Suscripciones: cómo cancelar">
        <p className={legalProse.p}>
          Estas son suscripciones: se pagan por mes o por año y se renuevan solas hasta que las
          cancelás.
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Presencia Verificada</strong> para negocios
            (planes Básico, Prioridad y Pro), mensual o anual.
          </li>
          <li>
            <strong className={legalProse.strong}>Check azul</strong> de verificación.
          </li>
          <li>
            <strong className={legalProse.strong}>Membresía de tienda</strong> del
            Marketplace.
          </li>
          <li>
            <strong className={legalProse.strong}>Publicación premium</strong> de un aviso.
          </li>
        </ul>
        <p className={legalProse.p}>Para cancelar tenés dos caminos:</p>
        <ol className={legalProse.ol}>
          <li>
            Desde el <strong className={legalProse.strong}>panel de facturación</strong> dentro
            de tu cuenta. Ahí también ves tus facturas y cambiás la tarjeta.
          </li>
          <li>
            Escribiéndonos a <LegalContact /> y lo cancelamos nosotros.
          </li>
        </ol>
        <p className={legalProse.p}>
          Cuando cancelás, no te cobramos más. El beneficio sigue activo hasta el último día del
          período que ya pagaste, y ahí se apaga solo. Por ejemplo: si pagaste el mes el día 5 y
          cancelás el 20, lo seguís usando hasta el 5 del mes siguiente.
        </p>
        <LegalCallout>
          No devolvemos la parte que queda del mes (o del año) en curso, porque el beneficio
          sigue funcionando hasta el final. La excepción es un cobro por error: ese te lo
          devolvemos completo (mirá{" "}
          <a href="#siempre-devolvemos" className={linkClass}>
            cuándo te devolvemos siempre
          </a>
          ).
        </LegalCallout>
      </LegalSection>

      <LegalSection id="pagos-unicos" title="Impulsos y campañas (pago único)">
        <p className={legalProse.p}>
          Estos se pagan una sola vez y no se renuevan:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Impulso</strong> de un aviso.
          </li>
          <li>
            <strong className={legalProse.strong}>Campaña</strong> de una publicación.
          </li>
          <li>
            <strong className={legalProse.strong}>Perfil de creador patrocinado</strong> por 7,
            14 o 30 días.
          </li>
        </ul>
        <p className={legalProse.p}>
          Se activan apenas se aprueba el pago. Por eso la regla es esta:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Si todavía no empezó a mostrarse</strong>, o
            no se pudo mostrar por una falla nuestra, te devolvemos todo.
          </li>
          <li>
            <strong className={legalProse.strong}>Si ya empezó a correr</strong>, no devolvemos
            la parte que ya se usó.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="siempre-devolvemos" title="Cuándo te devolvemos siempre">
        <p className={legalProse.p}>
          En estos casos el reembolso es completo, sin importar qué hayas comprado:
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Cobro duplicado.</strong> Te cobramos dos
            veces lo mismo.
          </li>
          <li>
            <strong className={legalProse.strong}>Un cobro que no reconocés.</strong> Lo
            revisamos con vos y, si no corresponde, lo devolvemos.
          </li>
          <li>
            <strong className={legalProse.strong}>Una falla técnica nuestra</strong> que no te
            dejó recibir lo que pagaste.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="como-pedir" title="Cómo pedir un reembolso">
        <ol className={legalProse.ol}>
          <li>
            Escribinos a <LegalContact /> con el asunto{" "}
            <strong className={legalProse.strong}>«{PAYMENTS_SUBJECT}»</strong>, dentro de los
            30 días del cobro.
          </li>
          <li>
            Contanos qué pasó y, si podés, la fecha y el monto del cobro y el correo de tu
            cuenta. Así lo encontramos rápido.
          </li>
          <li>Te respondemos en hasta 3 días hábiles.</li>
          <li>
            Si corresponde, el dinero vuelve a la misma tarjeta con la que pagaste, en 5 a 10
            días hábiles. Ese plazo lo pone tu banco, no nosotros.
          </li>
        </ol>
      </LegalSection>

      <LegalSection id="colaboraciones" title="Colaboraciones con creadores">
        <p className={legalProse.p}>
          Cuando un negocio contrata a un creador dentro de {tenant.name}, el pago está
          protegido: el negocio paga, nosotros guardamos el dinero y el creador lo recibe recién
          cuando el negocio aprueba la entrega.
        </p>
        <ul className={legalProse.ul}>
          <li>
            Cuando llega la entrega, el negocio tiene{" "}
            <strong className={legalProse.strong}>72 horas</strong> para aprobarla o pedir
            cambios. Si no responde en ese plazo, se aprueba sola y el pago se libera al creador.
          </li>
          <li>
            Al creador le llega el pago menos la comisión de la plataforma. Esa comisión se ve en
            el contrato antes de aceptarlo.
          </li>
          <li>
            <strong className={legalProse.strong}>
              Si el negocio cancela antes de que el creador empiece
            </strong>{" "}
            (sin avances ni entregas), el reembolso es completo y automático a su tarjeta, en 5 a
            10 días hábiles.
          </li>
          <li>
            <strong className={legalProse.strong}>Si el creador ya avanzó</strong>, la
            colaboración no se puede cancelar sin más: se abre una disputa, el pago queda
            congelado y lo revisa una persona de nuestro equipo.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="sin-reembolso" title="Lo que no podemos devolver">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>
              Compras entre usuarios.
            </strong>{" "}
            Alquileres, ventas del Marketplace o servicios que acordaste con otra persona se
            pagan por fuera de {tenant.name}. Nosotros no procesamos ese dinero, así que no
            podemos devolverlo. Mirá las{" "}
            <Link href="/legal/marketplace" className={linkClass}>
              Reglas del Marketplace
            </Link>
            .
          </li>
          <li>
            <strong className={legalProse.strong}>
              Una cuenta dada de baja por romper las normas.
            </strong>{" "}
            Si cerramos una cuenta por estafa, falsificaciones u otra falta grave, lo que se
            pagó no se devuelve.
          </li>
          <li>
            <strong className={legalProse.strong}>
              La parte ya usada de un impulso o campaña
            </strong>
            , y lo que queda del período en curso de una suscripción que cancelaste.
          </li>
        </ul>
        <p className={legalProse.p}>
          La verificación de identidad con Stripe Identity es gratis para vos: no se cobra, así
          que no hay nada que devolver.
        </p>
      </LegalSection>

      <LegalSection id="contracargos" title="Si hablás con tu banco">
        <p className={legalProse.p}>
          Si ves un cobro raro, escribinos primero: casi siempre lo resolvemos más rápido que el
          banco. Si abrís un reclamo (contracargo) con tu banco, el beneficio que pagaste puede
          quedar en pausa mientras se resuelve.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="Contacto">
        <p className={legalProse.p}>
          Para cualquier duda sobre pagos, cancelaciones o reembolsos, escribinos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>
          . También tenés todas las formas de contactarnos en la página de{" "}
          <Link href="/contacto" className={linkClass}>
            Contacto
          </Link>
          .
        </p>
        <p className={legalProse.p}>
          Esta política se lee junto a los{" "}
          <Link href="/legal/terminos" className={linkClass}>
            Términos de Uso
          </Link>
          . Ante cualquier contradicción, mandan los Términos.
        </p>
      </LegalSection>
    </article>
  );
}

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

/**
 * /legal/marketplace — Reglas del Marketplace (spec §7).
 *
 * Cuarta pieza legal del lanzamiento, hermana de terminos / privacidad /
 * normas: mismos primitivos, misma fecha, mismo registro de voz.
 *
 * CRITERIO EDITORIAL (por qué NO es la transcripción del texto del cliente):
 * quien lee esto es alguien que acaba de llegar al país y quiere vender lo que
 * cocina o lo que teje, no un abogado revisando un contrato. Un listado de
 * prohibiciones en lenguaje jurídico se saltea entero, y una regla que nadie
 * lee no protege a nadie. Entonces: encabezados que se escanean, una idea por
 * frase, ejemplos concretos en vez de categorías abstractas ("cargadores que se
 * recalientan", no "productos que incumplan normativa de seguridad eléctrica"),
 * y el porqué de cada regla cuando el porqué no es obvio.
 *
 * REGLA DE COPY DEL REPO (§11): nada de "Verificado" a secas ni de promesas de
 * seguridad. La sección de control dice literalmente que revisamos por muestreo
 * y que revisar NO es garantizar — porque no lo es.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

const TOC = [
  { id: "lo-que-si", label: "Lo que sí podés vender" },
  { id: "lo-prohibido", label: "Lo que no se puede vender" },
  { id: "autenticidad", label: "Originales, copias y productos usados" },
  { id: "publicaciones", label: "Cómo tiene que estar publicado" },
  { id: "pago-y-envio", label: "El pago y el envío son entre ustedes" },
  { id: "control", label: "Qué revisamos y qué no" },
  { id: "reportar", label: "Cómo reportar un producto" },
  { id: "consecuencias", label: "Qué pasa si no se cumple" },
  { id: "contacto", label: "Contacto" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Reglas del Marketplace — ${tenant.name}`;
  const description =
    "Qué se puede vender y qué no en el Marketplace de la comunidad, cómo tiene que estar publicado, y qué pasa si alguien rompe las reglas.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/legal/marketplace` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function MarketplaceLegalPage() {
  const tenant = await getTenant();

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Reglas del Marketplace — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/legal/marketplace`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Reglas del Marketplace"
        intro={
          <>
            <strong className={legalProse.strong}>En criollo:</strong> vendé cosas tuyas, que
            sean legales y que sean lo que decís que son. Si tenés que pensar mucho si algo
            entra, probablemente no entre.
          </>
        }
      />

      {/* Estado del documento — igual que sus tres hermanos de este lanzamiento. */}
      <div className="mt-6">
        <LegalCallout tone="warning">
          <strong className={legalProse.strong}>BORRADOR — requiere revisión de abogado.</strong>{" "}
          Este texto está escrito para que se entienda, no revisado por un profesional. Antes de
          publicarlo como documento vinculante tiene que pasar por asesoría legal.
        </LegalCallout>
      </div>

      <LegalToc items={TOC} />

      <LegalSection id="lo-que-si" title="Lo que sí podés vender">
        <p className={legalProse.p}>
          El Marketplace es para lo que produce y revende la comunidad. Por ejemplo:
        </p>
        <ul className={legalProse.ul}>
          <li>Comida casera, repostería, productos típicos de tu país.</li>
          <li>Ropa, calzado y accesorios, nuevos o usados.</li>
          <li>Artesanías y cosas hechas por vos.</li>
          <li>Muebles, electrodomésticos y cosas de casa.</li>
          <li>Electrónica de segunda mano que funcione y sea tuya.</li>
          <li>Productos de belleza y cuidado personal de venta libre.</li>
          <li>Cosas de bebés y de chicos en buen estado.</li>
        </ul>
        <p className={legalProse.p}>
          Si vendés comida, ropa o cosméticos, también corren las reglas del estado y del
          condado donde estás: permisos, etiquetado, manipulación de alimentos. Nosotros no te
          los pedimos, pero la autoridad sí puede.
        </p>
      </LegalSection>

      <LegalSection id="lo-prohibido" title="Lo que no se puede vender">
        <p className={legalProse.p}>
          Estas categorías no entran en ningún caso. No importa el precio, ni que la venta sea
          para un conocido, ni que se acuerde por chat: publicarlas alcanza para que el aviso
          se dé de baja.
        </p>
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Armas y municiones</strong> — armas de fuego,
            partes, municiones, réplicas realistas, cuchillos de combate, gas pimienta y
            aturdidores.
          </li>
          <li>
            <strong className={legalProse.strong}>Falsificaciones</strong> — imitaciones de
            marcas, réplicas «AAA», copias de películas, música o software.
          </li>
          <li>
            <strong className={legalProse.strong}>Cosas robadas</strong> — o de origen dudoso,
            incluidos teléfonos bloqueados o sin comprobante.
          </li>
          <li>
            <strong className={legalProse.strong}>Drogas y parafernalia</strong> — drogas
            ilegales, sustancias de uso recreativo, y los accesorios para consumirlas.
          </li>
          <li>
            <strong className={legalProse.strong}>Alcohol y tabaco</strong> — bebidas
            alcohólicas, cigarrillos, vapeadores, cartuchos y líquidos.
          </li>
          <li>
            <strong className={legalProse.strong}>Medicamentos</strong> — recetados o de venta
            libre, antibióticos, inyectables, suplementos que prometen curar algo, y productos
            para bajar de peso con sustancias controladas.
          </li>
          <li>
            <strong className={legalProse.strong}>Animales y especies protegidas</strong> —
            venta de animales vivos, y cualquier producto hecho con especies protegidas: marfil,
            carey, pieles, corales.
          </li>
          <li>
            <strong className={legalProse.strong}>Material para adultos</strong> — contenido
            sexual explícito, servicios sexuales, y juguetes o productos de esa categoría.
          </li>
          <li>
            <strong className={legalProse.strong}>Documentos</strong> — pasaportes, licencias,
            seguros sociales, títulos, certificados, sellos o formularios oficiales, sean
            falsos o ajenos.
          </li>
          <li>
            <strong className={legalProse.strong}>Productos peligrosos</strong> — químicos
            tóxicos, explosivos, fuegos artificiales, material inflamable, cosas retiradas del
            mercado por defectuosas, y cargadores o baterías que se recalientan.
          </li>
          <li>
            <strong className={legalProse.strong}>Servicios ilegales</strong> — trámites
            migratorios truchos, «arreglos» con funcionarios, hackeo, cuentas o suscripciones
            ajenas, y cualquier cosa que se ofrezca para evadir la ley.
          </li>
          <li>
            <strong className={legalProse.strong}>Partes del cuerpo humano</strong> — órganos,
            sangre, fluidos o tejidos.
          </li>
        </ul>
        <LegalCallout tone="warning">
          Un notario en Estados Unidos NO es un abogado. Nadie puede venderte un trámite
          migratorio «garantizado». Si alguien te lo ofrece en el Marketplace, reportalo — y no
          le pagues nada.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="autenticidad" title="Originales, copias y productos usados">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Si decís que es original, tiene que serlo.</strong>{" "}
            Una cartera de marca que no es de la marca es una falsificación, aunque el precio
            deje claro que no lo es.
          </li>
          <li>
            <strong className={legalProse.strong}>Inspirado no es lo mismo que copia.</strong>{" "}
            Podés vender lo que hacés vos aunque se parezca a algo conocido, siempre que no
            lleve el logo, el nombre ni el empaque de otra marca.
          </li>
          <li>
            <strong className={legalProse.strong}>Usado se dice.</strong> Decí el estado real:
            si tiene una mancha, un rayón o le falta una pieza, ponelo. Ahorra la discusión
            después.
          </li>
          <li>
            <strong className={legalProse.strong}>Las fotos son del producto.</strong> Fotos
            tuyas, de lo que estás vendiendo. Una foto bajada de internet no muestra lo que la
            persona va a recibir.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="publicaciones" title="Cómo tiene que estar publicado">
        <ul className={legalProse.ul}>
          <li>
            <strong className={legalProse.strong}>Un aviso, un producto.</strong> Nada de
            publicar diez cosas distintas en el mismo aviso ni repetir el mismo producto para
            aparecer más veces.
          </li>
          <li>
            <strong className={legalProse.strong}>El precio es el precio.</strong> Sin precios
            de anzuelo que después cambian, sin cargos que aparecen recién al final.
          </li>
          <li>
            <strong className={legalProse.strong}>La categoría correcta.</strong> Poner una
            cosa en la categoría de otra para que se vea más no ayuda a vender: solo molesta a
            quien está buscando.
          </li>
          <li>
            <strong className={legalProse.strong}>Sin promesas que no podés cumplir.</strong>{" "}
            Nada de «cura», «adelgaza sin dieta», «aprobación garantizada».
          </li>
          <li>
            <strong className={legalProse.strong}>Sin datos de otra persona.</strong> No
            publiques el teléfono, la dirección ni los documentos de nadie más.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="pago-y-envio" title="El pago y el envío son entre ustedes">
        <p className={legalProse.p}>
          Cuando tocás «Comprar», salís de {tenant.name} y entrás al sitio del negocio. Eso
          significa, sin vueltas:
        </p>
        <ul className={legalProse.ul}>
          <li>El pago lo cobra el negocio, en su propio sitio. Nosotros no lo procesamos.</li>
          <li>El envío, la devolución y la garantía las maneja el negocio.</li>
          <li>
            No podemos reembolsarte, ni frenar un cobro, ni mediar en una disputa de una compra
            hecha afuera.
          </li>
        </ul>
        <p className={legalProse.p}>
          Cobramos una membresía mensual a las tiendas por estar en el Marketplace. No cobramos
          comisión por lo que venden — no tocamos ese dinero, y por eso tampoco podemos
          devolvértelo.
        </p>
        <LegalCallout tone="warning">
          Nunca envíes dinero por adelantado a alguien que no conocés. Ni por transferencia, ni
          por aplicación de pagos, ni en tarjetas de regalo. Es la forma número uno en que se
          estafa a nuestra comunidad.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="control" title="Qué revisamos y qué no">
        <p className={legalProse.p}>
          Antes de que un producto se publique, un sistema automático revisa el texto. Las fotos
          las revisa una persona de tu comunidad antes de que el producto quede visible —
          todavía no tenemos revisión automática de imágenes—. Después, el equipo revisa por
          muestreo y todo lo que se reporta.
        </p>
        <p className={legalProse.p}>
          <strong className={legalProse.strong}>
            Revisar no es garantizar.
          </strong>{" "}
          No vemos el producto, no lo probamos y no conocemos a quien vende. Que un aviso esté
          publicado significa que todavía no encontramos un problema — no que sea seguro
          comprarlo. La confianza la tenés que construir vos, con preguntas, con fotos y sin
          apurarte.
        </p>
        <p className={legalProse.p}>
          Podemos pedirle a quien vende un comprobante, una foto adicional o una aclaración
          antes de dejar un aviso publicado. También podemos bajar un aviso en cualquier
          momento, incluso sin aviso previo, si hay riesgo para alguien.
        </p>
      </LegalSection>

      <LegalSection id="reportar" title="Cómo reportar un producto">
        <p className={legalProse.p}>
          En cualquier producto, al pie, tenés «Reportar este producto». Elegís el motivo y
          enviás: dos toques. Es anónimo para quien vende.
        </p>
        <ul className={legalProse.ul}>
          <li>Producto falso o imitación</li>
          <li>Producto robado</li>
          <li>Es una estafa</li>
          <li>Fraude en el pago</li>
          <li>Publicidad engañosa</li>
          <li>Artículo prohibido</li>
          <li>Usa una marca o contenido que no le pertenece</li>
        </ul>
        <LegalCallout>
          Si ya perdiste dinero, reportalo igual: nos sirve para frenar a esa cuenta antes de
          que le pase a otra persona. Y si hay un delito, hacé la denuncia también ante la
          policía local — nosotros no reemplazamos esa vía.
        </LegalCallout>
      </LegalSection>

      <LegalSection id="consecuencias" title="Qué pasa si no se cumple">
        <ol className={legalProse.ol}>
          <li>
            <strong className={legalProse.strong}>Bajamos el aviso</strong> — te avisamos qué
            regla no se cumplió y qué corregir para volver a publicarlo, si tiene arreglo.
          </li>
          <li>
            <strong className={legalProse.strong}>Suspendemos tu tienda</strong> — si se repite,
            tus productos dejan de aparecer en el Marketplace por un tiempo.
          </li>
          <li>
            <strong className={legalProse.strong}>Cerramos la cuenta</strong> — para
            falsificaciones, cosas robadas, estafas o cualquier cosa que ponga en riesgo a
            alguien, la baja es definitiva y sin devolución de la membresía.
          </li>
        </ol>
        <p className={legalProse.p}>
          En casos graves también avisamos a las autoridades. Si creés que nos equivocamos,
          podés apelar: escribinos y lo revisa una persona.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="Contacto">
        <p className={legalProse.p}>
          Estas Reglas se leen junto a los{" "}
          <Link
            href="/legal/terminos"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Términos de Uso
          </Link>{" "}
          y a las{" "}
          <Link
            href="/legal/normas"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Normas de la Comunidad
          </Link>
          . Ante cualquier contradicción, mandan los Términos.
        </p>
        <p className={legalProse.p}>
          Para reclamos de propiedad intelectual, apelaciones o cualquier duda sobre estas
          Reglas, escribinos a [correo de contacto legal — completar].
        </p>
      </LegalSection>
    </article>
  );
}

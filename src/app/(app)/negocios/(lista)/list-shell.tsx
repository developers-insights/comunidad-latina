import { ListingListSkeleton } from "@/components/listings";
import { SectionCta, SectionHeading } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * La CÁSCARA del listado de negocios: el copy de la sección, su identidad
 * visual, y la silueta que se pinta mientras llegan los datos.
 *
 * Vive fuera de `page.tsx` porque un archivo `page` sólo puede exportar el
 * juego que Next reconoce (`default`, `metadata`, `revalidate`…): cualquier
 * otro export rompe el type-check del build ("Property 'NegociosSkeleton' is
 * incompatible with index signature"). Es la misma forma que ya tienen los
 * otros listados del repo, donde la página exporta únicamente `metadata` y su
 * componente.
 */

/** Copy local del módulo negocios — no toca src/lib/i18n (compartido). */
export const COPY = {
  titulo: "Negocios de la comunidad",
  subtitulo: "Comercios y servicios de tu gente, cerca tuyo.",
  bannerTitulo: "Tu negocio, presente y verificado",
  bannerTexto:
    "Aunque no tengas un aviso activo, tu negocio queda presente en el directorio de tu comunidad.",
  bannerCta: "Conocer Presencia Verificada",
  vacioTitulo: "Todavía no hay negocios publicados",
  vacioMensaje:
    "Los comercios de la comunidad van a aparecer acá. Si tenés un negocio, este es tu lugar.",
  vacioCta: "Sumar mi negocio",
  copilotoTitulo: "¿Tenés un negocio? Probá el Copiloto",
  copilotoTexto:
    "Mejores títulos, mejor descripción e ideas de post — sugerencias de IA que revisás vos.",
  copilotoCta: "Abrir el Copiloto",
} as const;

/**
 * Identidad visual de la sección: el acento y el ícono 3D que ya la representan
 * en el menú y en /buscar (shell/modules.ts). Los mismos tres lugares, el mismo
 * dibujo — así se reconoce la sección sin leer.
 */
export const SECCION = {
  accent: "var(--accent-negocios)",
  image: "/icons/menu/negocios.webp",
  publicarHref: "/publicar?kind=business",
} as const;

/**
 * Fallback del listado: título + subtítulo estáticos + siluetas del banner y de
 * las tarjetas. Lo usan el Suspense de la página Y `loading.tsx`, para que el
 * shell no parpadee al navegar (Server Component, cero JS).
 */
export function NegociosSkeleton() {
  return (
    <div aria-busy="true">
      {/* Cabecera y burbuja de publicar son estáticas: se pintan de una y no
          parpadean cuando llega el listado (cero CLS entre fallback y real). */}
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.titulo}
        subtitle={COPY.subtitulo}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishBusinessTitle")}
        hint={t("sections", "publishBusinessHint")}
        className="mt-3"
      />
      {/* Silueta del buscador + los dos filtros, con las MISMAS alturas que la
          barra real (44px cada control): sin esto, la lista salta hacia abajo
          88px cuando llega el contenido. */}
      <div className="mt-4 flex flex-col gap-3">
        <div className="h-11 rounded-md bg-surface-subtle" />
        <div className="flex gap-2">
          <div className="h-11 flex-1 rounded-md bg-surface-subtle" />
          <div className="h-11 w-32 rounded-full bg-surface-subtle" />
        </div>
      </div>
      <div className="mt-4 h-32 rounded-xl bg-surface-subtle animate-pulse" />
      <div className="mt-6">
        <ListingListSkeleton />
      </div>
    </div>
  );
}

import { ListingListSkeleton } from "@/components/listings";
import { PostCardSkeleton } from "@/components/feed";
import { SectionCta, SectionHeading } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * La CÁSCARA del módulo Negocios: el copy de la sección, su identidad visual, y
 * las siluetas que se pintan mientras llegan los datos de cada pestaña.
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
  tabsLabel: "Secciones de Negocios",
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

  /* ------------------------------- Filtros -------------------------------- */
  filtrosLabel: "Filtros del directorio",
  filtroCerca: "Cerca de mí",
  /** Se muestra sólo con el filtro puesto: dice con qué zona está filtrando. */
  filtroCercaNota: (zona: string) =>
    `Mostrando negocios de ${zona}, la zona que cargaste en tu perfil.`,
  filtroAbiertos: "Abiertos ahora",
  filtroCalificacionLabel: "Filtrar por calificación",
  filtroCalificacionCualquiera: "Cualquier calificación",
  filtroCalificacionCuatro: "4 estrellas o más",
  filtroCalificacionTres: "3 estrellas o más",

  /**
   * EL NOMBRE DEL FILTRO DE "DESTACADOS", Y POR QUÉ NO SE LLAMA ASÍ A SECAS.
   *
   * La spec pide un filtro "Negocios destacados". En esta app "Destacado" ya es
   * algo muy concreto: el nivel MÁS ALTO del Trust Score, o sea reputación
   * GANADA (`lib/trust/levels.ts`, 85 puntos o más). Y hay una decisión vieja y
   * deliberada al lado: los impulsos pagos se llaman "Patrocinado" en las cinco
   * superficies donde aparecen, JAMÁS "Destacado", justamente para que nadie
   * confunda lo que se compra con lo que se gana.
   *
   * Un chip que dijera "Destacados" a secas caía en el medio de esas dos cosas y
   * se leía como "los que pagaron". Por eso la etiqueta nombra el hecho —
   * reputación — y por eso el filtro filtra exactamente eso: el nivel del Trust
   * Score del dueño. No se inventó un tercer significado; se usó el que la app
   * ya tenía, con todas las letras.
   */
  filtroReputacion: "Reputación destacada",
  filtroReputacionNota:
    "Estás viendo negocios cuyo dueño llegó al nivel más alto del Trust Score. Es reputación ganada: la publicidad se marca aparte, con el sello «Patrocinado».",
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
 * Silueta de la PESTAÑA del directorio: buscador, filtros y tarjetas. No incluye
 * cabecera ni pestañas — esas se pintan de una, fuera del Suspense, así que no
 * hay que dibujarlas dos veces ni pueden parpadear al cambiar de pestaña.
 */
export function DirectorioSkeleton() {
  return (
    <div aria-busy="true">
      {/* Las MISMAS alturas que la barra real (44px cada control): sin esto, la
          lista salta hacia abajo cuando llega el contenido. Tres filas ahora —
          buscador, los dos selects, y la fila de sí/no. */}
      <div className="mt-4 flex flex-col gap-3">
        <div className="h-11 rounded-md bg-surface-subtle" />
        <div className="flex gap-2">
          <div className="h-11 flex-1 rounded-md bg-surface-subtle" />
          <div className="h-11 flex-1 rounded-md bg-surface-subtle" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          <div className="h-11 w-32 shrink-0 rounded-full bg-surface-subtle" />
          <div className="h-11 w-32 shrink-0 rounded-full bg-surface-subtle" />
          <div className="h-11 w-36 shrink-0 rounded-full bg-surface-subtle" />
        </div>
      </div>
      <div className="mt-4 h-32 rounded-xl bg-surface-subtle animate-pulse" />
      <div className="mt-6">
        <ListingListSkeleton />
      </div>
    </div>
  );
}

/**
 * Silueta de las pestañas de contenido (Publicaciones y Ofertas): las dos
 * muestran tarjetas altas y comparten esqueleto. `PostCardSkeleton` es el mismo
 * que usa el feed, así que la transición al contenido real no mueve nada.
 */
export function ListaDePublicacionesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-6 flex flex-col gap-4" role="status" aria-label="Cargando publicaciones">
      {Array.from({ length: count }, (_, index) => (
        <PostCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

/**
 * Fallback de la PÁGINA entera (lo usa `loading.tsx` al navegar hacia acá).
 * Cabecera y burbuja de publicar son estáticas: se pintan de una y no parpadean
 * cuando llega el listado (cero CLS entre fallback y real).
 */
export function NegociosSkeleton() {
  return (
    <div aria-busy="true">
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
      {/* Silueta de la barra de pestañas: 44px de alto y la línea de abajo. */}
      <div className="mb-1 mt-5 h-11 border-b border-border-subtle" />
      <DirectorioSkeleton />
    </div>
  );
}

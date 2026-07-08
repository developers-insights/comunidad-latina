import { getImageProps } from "next/image";

/**
 * Fondo del hero de la landing, con art direction real (§2.4).
 *
 * ¿Por qué dos archivos y no un `object-cover` y listo? En un teléfono de 375px
 * el hero mide 365x1231 (aspect 0.30). Con la foto 16:9 de escritorio,
 * `object-cover` escala por altura y deja visible apenas el 21% central: se
 * pierden la familia y la caja "FRÁGIL", que son TODO el mensaje. El master
 * vertical (768x1401 → aspect 0.548) deja visible el 54% del ancho, suficiente
 * para que entren los cuatro y la caja.
 *
 * El encuadre vertical no es estético, es geométrico. Mientras el aspect del
 * master sea MAYOR que el del hero, `object-cover` recorta solo a los costados
 * y la vertical mapea 1:1: la fila `r` del master aterriza en `r/1401` de la
 * altura del hero. Con eso se calibró el master para que la familia caiga
 * entera DEBAJO del último texto (la barra de confianza termina en 911px):
 *
 *     pelo del padre  fila 1063 → 934px      caras adultos  945-993px
 *     caras chicos    fila 1140 → 1002px     pies           1161px
 *
 * Por eso el hero móvil lleva `pb-80`: esa franja no es aire, es la foto.
 * Sin ella la banda de caras (86px en pantalla) no entra en el hueco libre
 * entre los CTAs y la barra de confianza (40px), y el texto cae sobre las caras.
 *
 * La técnica es la documentada por Next para art direction: `getImageProps()`
 * + `<picture>`. Así el navegador descarga UNA sola imagen (con dos <Image> y
 * `hidden`/`block` descargaría las dos).
 *
 * Nada de `preload`/`priority`: el propio doc de next/image lo desaconseja
 * cuando el LCP depende del viewport (acá hay dos candidatos, uno por breakpoint).
 * `loading="eager"` + `fetchPriority="high"` es lo que corresponde.
 */

/** Breakpoint `sm` de Tailwind: por encima manda la foto apaisada. */
const DESKTOP_MEDIA = "(min-width: 640px)";

/**
 * Scrim del móvil, calibrado con contraste medido, no a ojo.
 *
 * Arriba se abre hasta 0.62 para que el atardecer se vea (a 0.88 la foto era
 * una pared marrón). Un píxel de cielo quemado bajo 0.62 da 6.0:1 contra el
 * texto blanco: sobra para AA (4.5:1 en el subhead, que es el caso más chico).
 * Cierra detrás de los CTAs y de la barra de confianza (hasta el 74%), y a
 * partir del 77% se abre casi del todo: ahí ya no hay texto, ahí está la familia.
 */
/**
 * Tinta de los degradados sobre foto: negro cálido, no negro azulado. Es el
 * valor de `--color-media-shade` (#0d0c08) escrito en canal-a-canal porque este
 * gradiente tiene 11 paradas con alphas distintos: Tailwind no puede aplicar un
 * modificador de opacidad a una var() dentro de un `linear-gradient` arbitrario
 * sin relative color syntax, que pide Chrome 119 (el piso de Next 16 es 111).
 * Los degradados de escritorio, que sí son expresables, usan `media-shade/N`.
 */
const INK = "13,12,8";

const MOBILE_SCRIM =
  "linear-gradient(to bottom," +
  `rgba(${INK},0.62) 0%,` +
  `rgba(${INK},0.62) 32%,` +
  `rgba(${INK},0.66) 50%,` +
  `rgba(${INK},0.70) 62%,` +
  `rgba(${INK},0.72) 66%,` +
  // Apertura escalonada: de golpe se ve el borde del degradado cruzando la foto.
  `rgba(${INK},0.70) 74%,` +
  `rgba(${INK},0.52) 76.5%,` +
  `rgba(${INK},0.32) 79%,` +
  `rgba(${INK},0.24) 82%,` +
  `rgba(${INK},0.26) 90%,` +
  `rgba(${INK},0.48) 100%)`;

export function HeroBackdrop() {
  const common = { alt: "", sizes: "100vw", fill: true, loading: "eager", fetchPriority: "high" } as const;

  const {
    props: { srcSet: desktopSrcSet },
  } = getImageProps({ ...common, src: "/images/hero-community.png" });

  // El móvil es el fallback del <picture>: si ninguna <source> matchea, este
  // <img> ya trae su propio srcSet y su src.
  const { props: mobileProps } = getImageProps({
    ...common,
    src: "/images/hero-community-mobile.webp",
  });

  return (
    <div className="absolute inset-0 -z-10">
      <picture>
        <source media={DESKTOP_MEDIA} srcSet={desktopSrcSet} sizes="100vw" />
        {/* 60% horizontal: la familia no está centrada en el master (el padre y su
            caja tiran a la derecha), y el hero móvil solo deja ver ~54% del ancho.
            El 100% vertical es un no-op mientras el recorte sea horizontal; solo
            actúa en pantallas anchas-y-bajas, donde sacrifica cielo antes que familia.
            En ≥sm vuelve el encuadre original de la foto apaisada.
            `alt` ya viene en mobileProps; se repite explícito para jsx-a11y/alt-text. */}
        <img {...mobileProps} alt="" className="object-cover object-[60%_100%] sm:object-center" />
      </picture>

      {/* Scrim del móvil: un solo gradiente, calibrado contra el mapa de texto. */}
      <div aria-hidden="true" className="absolute inset-0 sm:hidden" style={{ background: MOBILE_SCRIM }} />

      {/* Escritorio: overlay vertical para legibilidad (§2.4)… */}
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden bg-gradient-to-t from-media-shade/92 via-media-shade/62 to-media-shade/30 sm:block"
      />
      {/* …y refuerzo lateral desde la izquierda: la columna de texto queda
          siempre sobre zona oscura, sin ensuciar la foto a la derecha. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden bg-gradient-to-r from-media-shade/55 via-media-shade/10 to-transparent sm:block"
      />
      {/* Glow sutil con la marca del tenant: profundidad premium, muy tenue. */}
      <div
        aria-hidden="true"
        className="absolute -left-40 top-1/2 -z-0 hidden size-[36rem] -translate-y-1/2 rounded-full opacity-[0.16] blur-3xl sm:block"
        style={{ background: "radial-gradient(closest-side, var(--color-brand-500), transparent)" }}
      />
    </div>
  );
}

import { areaPath, axisMax, linePath, type PathGeometry } from "./series-path";

/**
 * Sparkline de una tarjeta: la forma del período, sin ejes ni números.
 *
 * `aria-hidden`: el dato ya está escrito al lado (el número grande y, para
 * lectores de pantalla, la tabla del gráfico de abajo). Anunciar además "78
 * puntos de datos" sería ruido, no accesibilidad.
 */

const GEO: PathGeometry = { width: 240, height: 56, padY: 5 };

export function Sparkline({
  values,
  /** Color del trazo. Token del design system, nunca un hex suelto. */
  tone,
}: {
  values: number[];
  tone: string;
}) {
  const max = axisMax(values);

  return (
    <svg
      viewBox={`0 0 ${GEO.width} ${GEO.height}`}
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
      className="h-10 w-full"
    >
      {/* Piso: ancla la lectura cuando la serie está toda en cero. */}
      <line
        x1={0}
        y1={GEO.height - GEO.padY}
        x2={GEO.width}
        y2={GEO.height - GEO.padY}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path d={areaPath(values, max, GEO)} fill={tone} opacity={0.12} />
      <path
        d={linePath(values, max, GEO)}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Sin esto, preserveAspectRatio="none" estira el grosor del trazo junto
        // con el eje X y la línea queda más gruesa en pantallas anchas.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

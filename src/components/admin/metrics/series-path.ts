/**
 * Geometría compartida por el gráfico grande y los sparklines de las tarjetas.
 *
 * Se mantiene fuera de los componentes porque los dos dibujan exactamente la
 * misma curva a distinta escala: si la fórmula se duplicara, el sparkline de
 * una tarjeta podría dejar de coincidir con su línea en el gráfico de abajo, y
 * dos dibujos del mismo dato que no coinciden es peor que no dibujar nada.
 */

export interface PathGeometry {
  width: number;
  height: number;
  /** Aire arriba y abajo para que el trazo no toque el borde del viewBox. */
  padY: number;
}

/**
 * Valor máximo del eje Y.
 *
 * Nunca menos de 1: con todo en cero, dividir por el máximo real daría NaN y
 * el trazo desaparecería. Con 1, la línea se apoya prolija en el piso — que es
 * la lectura correcta de "no pasó nada".
 */
export function axisMax(...series: number[][]): number {
  let max = 0;
  for (const values of series) {
    for (const v of values) if (v > max) max = v;
  }
  return Math.max(1, max);
}

function pointAt(
  index: number,
  value: number,
  total: number,
  max: number,
  geo: PathGeometry,
): [number, number] {
  // Un solo punto no tiene "recorrido": se centra en vez de quedar pegado al
  // borde izquierdo con una línea de ancho cero.
  const x = total <= 1 ? geo.width / 2 : (index / (total - 1)) * geo.width;
  const usable = geo.height - geo.padY * 2;
  const y = geo.height - geo.padY - (value / max) * usable;
  return [x, y];
}

/** Polilínea de la serie. */
export function linePath(values: number[], max: number, geo: PathGeometry): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    // Con un solo día, una línea horizontal corta lee mejor que un punto suelto.
    const [, y] = pointAt(0, values[0]!, 1, max, geo);
    return `M ${geo.width * 0.35} ${y} L ${geo.width * 0.65} ${y}`;
  }
  return values
    .map((v, i) => {
      const [x, y] = pointAt(i, v, values.length, max, geo);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** La misma curva cerrada contra el piso, para el relleno tenue. */
export function areaPath(values: number[], max: number, geo: PathGeometry): string {
  const line = linePath(values, max, geo);
  if (!line) return "";
  const floor = geo.height - geo.padY;
  const firstX = values.length <= 1 ? geo.width * 0.35 : 0;
  const lastX = values.length <= 1 ? geo.width * 0.65 : geo.width;
  return `${line} L ${lastX} ${floor} L ${firstX} ${floor} Z`;
}

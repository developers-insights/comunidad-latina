import { COPY, METRIC_COPY } from "@/lib/metrics/copy";
import { METRIC_KEYS, type MetricKey, type MetricsPoint } from "@/lib/metrics/types";
import { areaPath, axisMax, linePath, type PathGeometry } from "./series-path";
import { METRIC_TONE } from "./tone";

/**
 * Evolución día por día de las tres métricas.
 *
 * DECISIONES DE DIBUJO
 * --------------------
 * · Ningún texto vive DENTRO del svg. Con viewBox escalado, un `<text>` de 10px
 *   mide ~4px reales en un teléfono: ilegible. Ejes y rótulos son HTML alrededor
 *   del svg, así que respetan el tamaño de fuente del sistema.
 * · El svg escala con el ancho disponible en vez de scrollear. La pantalla no
 *   puede tener scroll horizontal, y un gráfico que se sale es la forma más
 *   común de romper esa regla.
 * · Tres formas además de tres colores en la leyenda: quien no distingue los
 *   colores tiene que poder leer el gráfico igual.
 * · Debajo, la MISMA tabla de números en sr-only. Un svg no se lee con lector
 *   de pantalla; la tabla es el gráfico para quien no lo ve.
 */

const GEO: PathGeometry = { width: 720, height: 220, padY: 14 };

/** Marcador de la leyenda: forma distinta por serie, no sólo color. */
const LEGEND_SHAPE: Record<MetricKey, string> = {
  active: "rounded-full",
  publishers: "rounded-[2px]",
  contacters: "rounded-[2px] rotate-45",
};

function formatDay(day: string, opts: Intl.DateTimeFormatOptions): string {
  // timeZone UTC no es opcional: los días vienen como YYYY-MM-DD (medianoche
  // UTC) y formatearlos en la zona del navegador mostraría el día anterior en
  // toda América.
  return new Intl.DateTimeFormat("es-US", { ...opts, timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function TrendChart({ series }: { series: MetricsPoint[] }) {
  const byKey: Record<MetricKey, number[]> = {
    active: series.map((p) => p.active),
    publishers: series.map((p) => p.publishers),
    contacters: series.map((p) => p.contacters),
  };
  const max = axisMax(byKey.active, byKey.publishers, byKey.contacters);

  const first = series.at(0)?.day;
  const last = series.at(-1)?.day;
  const dayOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

  // Resumen para lector de pantalla: el titular del gráfico en una frase, para
  // que no haya que recorrer 90 filas de tabla sólo para saber cómo viene.
  const summary = METRIC_KEYS.map(
    (key) => `${METRIC_COPY[key].label}: máximo ${Math.max(0, ...byKey[key])} en un día`,
  ).join(". ");

  return (
    <figure className="m-0 flex flex-col gap-3">
      {/* Leyenda arriba: se lee antes que el dibujo, como corresponde. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {METRIC_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-xs text-foreground-secondary">
            <span
              aria-hidden="true"
              className={`inline-block size-2.5 shrink-0 ${LEGEND_SHAPE[key]}`}
              style={{ backgroundColor: METRIC_TONE[key] }}
            />
            {METRIC_COPY[key].label}
          </li>
        ))}
        <li className="ms-auto text-xs tabular-nums text-foreground-muted">
          máx. {max.toLocaleString("es-US")}
        </li>
      </ul>

      <svg
        viewBox={`0 0 ${GEO.width} ${GEO.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${COPY.chartTitle}. ${summary}`}
        className="h-32 w-full sm:h-48"
      >
        {/* Grillas al 0, la mitad y el máximo. Bajo contraste a propósito: son
            referencia, no dato — no deben competir con las líneas. */}
        {[0, 0.5, 1].map((t) => {
          const y = GEO.height - GEO.padY - t * (GEO.height - GEO.padY * 2);
          return (
            <line
              key={t}
              x1={0}
              y1={y}
              x2={GEO.width}
              y2={y}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {METRIC_KEYS.map((key) => (
          <path
            key={`area-${key}`}
            d={areaPath(byKey[key], max, GEO)}
            fill={METRIC_TONE[key]}
            opacity={0.08}
          />
        ))}
        {METRIC_KEYS.map((key) => (
          <path
            key={`line-${key}`}
            d={linePath(byKey[key], max, GEO)}
            fill="none"
            stroke={METRIC_TONE[key]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* Eje X en HTML: sólo los extremos. Con 90 días, una etiqueta por día no
          entra en un teléfono, y rotarlas para que entren las vuelve ilegibles. */}
      <div className="flex justify-between text-xs tabular-nums text-foreground-muted">
        <span>{first ? formatDay(first, dayOpts) : ""}</span>
        <span>{last ? formatDay(last, dayOpts) : ""}</span>
      </div>

      {/* Sin <figcaption>: el <caption> de la tabla ya cumple ese rol y tener
          los dos hacía que el lector de pantalla dijera la misma frase dos
          veces seguidas (verificado en el HTML renderizado). */}
      <table className="sr-only">
        <caption>{COPY.chartTableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.chartColDay}</th>
            {METRIC_KEYS.map((key) => (
              <th key={key} scope="col">
                {METRIC_COPY[key].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.day}>
              <th scope="row">
                {formatDay(point.day, { day: "numeric", month: "long", year: "numeric" })}
              </th>
              <td>{point.active}</td>
              <td>{point.publishers}</td>
              <td>{point.contacters}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

import type { Cifra } from "@/lib/escudo/transparencia";
import { cn } from "@/lib/utils";

/**
 * Una cifra del panel de transparencia: número a la izquierda, qué significa a
 * la derecha.
 *
 * ── POR QUÉ FILA Y NO GRILLA ────────────────────────────────────────────────
 * El shell de la app tope en `max-w-lg` y a 375 px la columna útil son 343.
 * Partida en dos, cada tarjeta queda en ~166 px, y ahí la NOTA —que es la mitad
 * del sentido del número— se rompe en seis renglones de texto diminuto o
 * directamente se corta. Un número sin la frase que dice qué cuenta y qué NO
 * cuenta es exactamente el dato que después se lee a nuestro favor.
 *
 * En fila el número se lee de un golpe y la nota tiene el ancho para decir la
 * verdad completa. De paso, una sola columna no puede desbordar a lo ancho en
 * ningún viewport.
 *
 * ── EL CERO NO ES ROJO ──────────────────────────────────────────────────────
 * `todavia` pinta el número en el gris secundario en vez del tinte de marca.
 * Un cero acá no es una falla del sistema ni un error de la app: es una
 * comunidad joven. Pintarlo como alerta le enseñaría a quien lee justo lo que
 * no es cierto.
 */
export function CifraFila({ cifra }: { cifra: Cifra }) {
  return (
    <li className="flex items-baseline gap-4 py-4 first:pt-0 last:pb-0">
      <span
        className={cn(
          "min-w-[2.75ch] shrink-0 text-right font-display text-3xl font-bold tabular-nums",
          cifra.todavia ? "text-foreground-muted" : "text-brand-ink",
        )}
      >
        {cifra.valor}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-semibold text-foreground">
          {cifra.etiqueta}
        </span>
        <span className="mt-0.5 block text-sm text-foreground-secondary">{cifra.nota}</span>
      </span>
    </li>
  );
}

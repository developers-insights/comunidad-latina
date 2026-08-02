import { CATEGORY_META, TRACKERS, isActive, trackersOf, type ConsentCategory } from "@/lib/consent";
import { legalProse } from "./legal-prose";

/**
 * La tabla del inventario, RENDERIZADA DESDE EL REGISTRO (`@/lib/consent`).
 *
 * Este es el punto del ejercicio: la política de cookies no es un texto que
 * alguien tiene que acordarse de actualizar, es una vista del mismo dato que
 * usa el gate de consentimiento. Si mañana entra Google Analytics, aparece acá
 * sin que nadie escriba una línea de prosa — y si alguien la borra del
 * registro, desaparece de las dos partes a la vez. No pueden divergir.
 *
 * En el teléfono se dibuja como fichas y no como tabla: una tabla de 5 columnas
 * en 375px obliga a hacer scroll lateral para leer una fila, que es la peor
 * forma de leer un documento legal. En pantalla ancha sí es tabla.
 */
export function CookieTable({ category }: { category: ConsentCategory }) {
  const rows = trackersOf(category);
  const meta = CATEGORY_META[category];

  if (rows.length === 0) {
    return (
      <p className={legalProse.p}>
        <strong className={legalProse.strong}>Ninguna.</strong> {meta.summary}
      </p>
    );
  }

  return (
    <>
      {/* Teléfono: una ficha por entrada. */}
      <ul className="mt-4 flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.name}
            className="rounded-lg border border-border-subtle bg-surface-subtle p-4"
          >
            <p className="break-all font-mono text-xs font-semibold text-foreground">
              {row.name}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
              {row.purpose}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-foreground-muted">Dónde</dt>
              <dd className="text-foreground-secondary">{KIND_LABEL[row.kind]}</dd>
              <dt className="text-foreground-muted">Cuánto dura</dt>
              <dd className="text-foreground-secondary">{row.duration}</dd>
              <dt className="text-foreground-muted">Quién la pone</dt>
              <dd className="text-foreground-secondary">
                {row.owner}
                {row.firstParty ? " (nosotros)" : " (tercero)"}
              </dd>
            </dl>
            {row.dormant && <DormantNote note={row.dormant} />}
          </li>
        ))}
      </ul>

      {/* Pantalla ancha: tabla real, con su propio scroll horizontal para que
          la página nunca se desborde. */}
      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th>Nombre</Th>
              <Th>Para qué sirve</Th>
              <Th>Dónde</Th>
              <Th>Cuánto dura</Th>
              <Th>Quién la pone</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-border-subtle align-top">
                <td className="py-3 pr-4">
                  <span className="break-all font-mono text-xs font-semibold text-foreground">
                    {row.name}
                  </span>
                </td>
                <td className="py-3 pr-4 text-foreground-secondary">
                  {row.purpose}
                  {row.dormant && <DormantNote note={row.dormant} />}
                </td>
                <td className="py-3 pr-4 text-foreground-secondary">
                  {KIND_LABEL[row.kind]}
                </td>
                <td className="py-3 pr-4 text-foreground-secondary">{row.duration}</td>
                <td className="py-3 text-foreground-secondary">
                  {row.owner}
                  {row.firstParty ? " (nosotros)" : " (tercero)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
    >
      {children}
    </th>
  );
}

/**
 * "Todavía no está funcionando" dicho sin rodeos. Declarar algo que hoy no
 * ocurre y no aclararlo sería tan engañoso como no declararlo.
 */
function DormantNote({ note }: { note: string }) {
  return (
    <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
      <span className="font-semibold">Hoy no está activa.</span> {note}
    </p>
  );
}

/** El nombre técnico traducido a algo que se entienda sin ser programador. */
const KIND_LABEL: Record<string, string> = {
  cookie: "Cookie",
  localStorage: "Memoria del navegador",
  sessionStorage: "Memoria del navegador (hasta cerrar la pestaña)",
  cache: "Copia guardada de archivos",
  servicio: "Servicio externo",
};

/** Cuántas entradas hay en total — para que la página no invente el número. */
export const TRACKER_TOTAL = TRACKERS.length;
export const ACTIVE_TRACKER_TOTAL = TRACKERS.filter(isActive).length;

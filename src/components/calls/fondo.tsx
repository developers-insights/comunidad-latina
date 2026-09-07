import { cn } from "@/lib/utils";

/**
 * El piso de la pantalla de llamada.
 *
 * NO es negro plano. Un negro plano es lo que hace que una llamada parezca una
 * pantalla rota: no hay dónde apoyar la vista y cualquier avatar queda flotando
 * en la nada. Acá hay tres capas, y las tres son estáticas —cero animación, cero
 * costo por frame—:
 *
 *   1. Un marrón profundo y CÁLIDO (`--color-media-backdrop`, #17150f), que es
 *      el mismo negro que ya usan el visor de fotos y el reproductor. La app es
 *      crema; un negro azulado acá se vería prestado de otro producto.
 *   2. Dos halos radiales muy abiertos —uno del azul de marca arriba a la
 *      izquierda, uno ámbar abajo a la derecha— al 12% y 8%. Dan profundidad y
 *      una dirección de luz sin llegar a leerse como "gradiente".
 *   3. Un grano finísimo en un pseudo-elemento fijo, `pointer-events-none`, que
 *      le saca el plástico a las dos capas de arriba.
 *
 * `-z-10` y `aria-hidden`: es decorado y no participa ni del layout ni del
 * árbol de accesibilidad.
 */
export function FondoDeLlamada({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div className="absolute inset-0 bg-media-backdrop" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(120% 80% at 8% -10%, color-mix(in oklab, var(--color-brand) 22%, transparent), transparent 62%)",
            "radial-gradient(110% 75% at 108% 108%, color-mix(in oklab, var(--color-gold) 14%, transparent), transparent 58%)",
          ].join(","),
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.055] mix-blend-overlay"
        style={{
          // SVG inline y no un .png: son 200 bytes, no pega un request y no hay
          // un archivo más que se pueda perder en un deploy.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "120px 120px",
        }}
      />
    </div>
  );
}

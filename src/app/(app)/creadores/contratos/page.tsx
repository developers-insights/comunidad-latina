import { permanentRedirect } from "next/navigation";

/**
 * `/creadores/contratos` → `/creadores/colaboraciones`.
 *
 * La sección pasó a llamarse "Colaboraciones" (pedido textual del cliente,
 * 2026-07-30). La ruta vieja sigue viva como redirección porque ya circula:
 * está enlazada desde `/creadores/perfil`, desde `/perfil`, y —lo que no
 * controlamos— en los links que la gente se pasó por mensaje. Romperlos
 * mandaría a un 404 a quien vuelve a mirar el trabajo que acordó.
 *
 * `permanentRedirect` (308) y no `redirect` (307): esto es un cambio de nombre
 * definitivo, no una desviación temporal. El 308 le dice al navegador y a los
 * buscadores que la dirección buena es la nueva, y preserva el método.
 *
 * NO se resuelve en `next.config.ts` a propósito: ese archivo es de otro
 * módulo, y esta redirección es parte del renombre de esta sección — vive con
 * ella y se borra con ella el día que ya no haga falta.
 */
export default function ContratosRedirectPage(): never {
  permanentRedirect("/creadores/colaboraciones");
}

import { permanentRedirect } from "next/navigation";

/**
 * `/creadores/contratos/[id]` → `/creadores/colaboraciones/[id]`.
 *
 * El caso que importa: alguien compartió el link de SU contrato por mensaje
 * (es lo que hace la gente cuando acuerda un trabajo). Ese link tiene que
 * seguir llevando al mismo lugar después del renombre — ver la cabecera de
 * `../page.tsx` para el porqué del 308.
 *
 * El id se pasa tal cual, sin validar: si es basura, la página destino ya
 * responde 404 con su propia validación. Validar dos veces sólo agrega un
 * segundo lugar donde la regla se puede desincronizar.
 */
export default async function ContratoDetalleRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  permanentRedirect(`/creadores/colaboraciones/${encodeURIComponent(id)}`);
}

/**
 * Una solicitud descartada (`declined`, 0177) se ve distinto según quién mira:
 * para quien la recibió ya no existe, y para quien la mandó sigue pendiente,
 * porque enterarse del descarte es justo lo que Instagram evita. Toda lectura
 * de `conversations` que se pinte tiene que pasar por acá.
 */
export const STATUS_DESCARTADA = "declined";

type ConEstado = { status: string; created_by: string };

export function visiblesParaMi<T extends ConEstado>(filas: T[], miId: string): T[] {
  const visibles: T[] = [];
  for (const fila of filas) {
    if (fila.status !== STATUS_DESCARTADA) {
      visibles.push(fila);
    } else if (fila.created_by === miId) {
      visibles.push({ ...fila, status: "pending" });
    }
  }
  return visibles;
}

export function sigueDescartada(status: string | null | undefined): boolean {
  return status === STATUS_DESCARTADA;
}

export function estadoDelDescarte(resultado: unknown): "eliminada" | "aceptada" | null {
  switch (resultado) {
    case STATUS_DESCARTADA:
    case "blocked":
      return "eliminada";
    case "accepted":
      return "aceptada";
    default:
      return null;
  }
}

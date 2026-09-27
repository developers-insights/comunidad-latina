import { estaViva, esEstadoDeLlamada, type LlamadaRow } from "./tipos";

/** Una fila mía de `call_participants` sin entrar ni salir (0155). */
export interface InvitacionPendiente {
  call_id: string;
  invitada_at: string;
}

/**
 * Qué llamada tiene que sonar. Cuenta la invitación, no la llamada: en un grupo
 * la llamada sigue `en_curso` después de que atienda el primero, y a los demás
 * les tiene que seguir sonando.
 */
export function elegirTimbre(params: {
  invitaciones: readonly InvitacionPendiente[];
  llamadas: readonly LlamadaRow[];
  descartadas: ReadonlySet<string>;
  miId: string;
}): { llamada: LlamadaRow; invitadaAt: string } | null {
  const porId = new Map(params.llamadas.map((l) => [l.id, l]));
  const ordenadas = [...params.invitaciones].sort((a, b) =>
    b.invitada_at.localeCompare(a.invitada_at),
  );
  for (const invitacion of ordenadas) {
    if (params.descartadas.has(invitacion.call_id)) continue;
    const llamada = porId.get(invitacion.call_id);
    if (!llamada || llamada.iniciada_por === params.miId) continue;
    if (!esEstadoDeLlamada(llamada.status) || !estaViva(llamada.status)) continue;
    return { llamada, invitadaAt: invitacion.invitada_at };
  }
  return null;
}

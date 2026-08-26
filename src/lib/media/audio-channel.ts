/**
 * EL CANAL ÚNICO DE SONIDO (0090 + feedback 2026-08-26: "tendría que sonar solo").
 *
 * Un feed es una pila de publicaciones que pueden sonar: videos con audio,
 * fotos con música, videos con música. Sin un árbitro, dos de ellas terminan
 * cantando juntas — y eso, en un teléfono, no se distingue de una app rota.
 *
 * Este módulo es ese árbitro, y es UNO SOLO para todo el documento: un store
 * de módulo, no un contexto de React. La razón no es pereza: el sonido del
 * navegador es un recurso global de verdad (los parlantes son uno), y un
 * provider obligaría a que cada superficie que monta una card —el feed, el
 * detalle, el perfil, los guardados, las novedades de un evento— se acuerde de
 * montarlo. Olvidarse en una sola pantalla devolvería exactamente el bug que
 * esto viene a matar.
 *
 * TRES DATOS, y ninguno es adorno:
 *
 *  · `owner`: qué medio tiene el sonido AHORA. null = silencio. Como es uno
 *    solo, "que suene una sola a la vez" no es una regla que haya que recordar
 *    en cada componente: es la forma del dato.
 *
 *  · `enabled`: si la persona YA pidió sonido alguna vez. Sin ese gesto no
 *    suena nada, y no es una preferencia de diseño: los navegadores bloquean el
 *    audio automático sin interacción previa (Chrome/Safari autoplay policy).
 *    Con el gesto hecho, el scroll puede pasar el sonido de una publicación a
 *    la siguiente sin volver a pedir permiso — que es, textual, lo que se pidió.
 *
 *  · `suspended`: hay algo ENCIMA que manda sobre el audio (el visor a pantalla
 *    completa arranca con sonido). Se apaga todo sin perder el gesto: al cerrar
 *    el visor, la música vuelve donde estaba.
 *
 * `stopAudio()` apaga `enabled` a propósito: si alguien toca "silenciar", no
 * quiere silenciar ESA canción, quiere dejar de escuchar. Que el scroll le
 * devuelva música dos publicaciones después sería no haberle hecho caso.
 */

export interface AudioChannelState {
  /** Clave del medio que tiene el sonido. null = no suena nada. */
  owner: string | null;
  /** ¿Hubo un gesto de la persona pidiendo sonido? */
  enabled: boolean;
  /** Algo de arriba (el visor) se adueñó del audio. */
  suspended: boolean;
}

const SILENT: AudioChannelState = { owner: null, enabled: false, suspended: false };

let state: AudioChannelState = SILENT;
const listeners = new Set<() => void>();

function commit(next: AudioChannelState) {
  if (
    next.owner === state.owner &&
    next.enabled === state.enabled &&
    next.suspended === state.suspended
  ) {
    // Misma identidad de objeto si nada cambió: `useSyncExternalStore` compara
    // por referencia y un objeto nuevo por cada scroll sería un re-render por
    // cada card del feed.
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeAudioChannel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAudioChannel(): AudioChannelState {
  return state;
}

/**
 * GESTO: esta persona quiere escuchar ESTE medio. Le saca el sonido a quien lo
 * tuviera (una sola cosa suena) y deja el canal habilitado para que el scroll
 * siga trayendo sonido sin pedir permiso otra vez.
 */
export function claimAudio(key: string): void {
  commit({ owner: key, enabled: true, suspended: false });
}

/** GESTO de silencio: se calla lo que suena Y se apaga el seguimiento. */
export function stopAudio(): void {
  commit({ ...state, owner: null, enabled: false });
}

/**
 * EL SCROLL, no la persona: este medio entró en pantalla y se ofrece a sonar.
 * Sólo lo toma si ya hubo gesto — sin eso, el navegador lo bloquearía igual y
 * la publicación quedaría con un botón de pausa que no pausa nada.
 */
export function followAudio(key: string): void {
  if (!state.enabled) return;
  commit({ ...state, owner: key });
}

/**
 * Este medio se fue de pantalla (o se desmontó). NO apaga el gesto: el sonido
 * queda libre para que lo tome la publicación que entra.
 */
export function releaseAudio(key: string): void {
  if (state.owner !== key) return;
  commit({ ...state, owner: null });
}

/** El visor a pantalla completa toma el audio: acá abajo no suena nada. */
export function suspendAudio(): void {
  commit({ ...state, suspended: true });
}

/** Se cerró el visor: vuelve a sonar lo que sonaba. */
export function resumeAudio(): void {
  commit({ ...state, suspended: false });
}

/** Sólo para los tests: el store es de módulo y sobrevive entre casos. */
export function resetAudioChannel(): void {
  state = SILENT;
  for (const listener of listeners) listener();
}

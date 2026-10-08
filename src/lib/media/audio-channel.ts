/**
 * Un solo canal de sonido para todo el documento: los parlantes son uno, así
 * que el árbitro es un store de módulo y no un contexto que cada pantalla
 * tendría que acordarse de montar.
 *
 * El dueño anterior se calla por callback directo, no por re-render: sólo se
 * entera la fuente desplazada.
 */

type Silencer = () => void;

interface Owner {
  key: string;
  silence: Silencer;
}

let owner: Owner | null = null;
const holds = new Set<symbol>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeAudioChannel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAudioOwner(): string | null {
  return owner?.key ?? null;
}

export function isAudioHeld(): boolean {
  return holds.size > 0;
}

/**
 * `key` empezó a sonar. Devuelve false si el canal está retenido (llamada en
 * curso): quien llama tiene que callarse solo.
 */
export function claimAudio(key: string, silence: Silencer): boolean {
  if (holds.size > 0) return false;
  if (owner?.key === key) {
    owner.silence = silence;
    return true;
  }
  const previous = owner;
  owner = { key, silence };
  emit();
  previous?.silence();
  return true;
}

export function releaseAudio(key: string): void {
  if (owner?.key !== key) return;
  owner = null;
  emit();
}

/**
 * Retiene el canal mientras algo de más arriba manda sobre el audio (una
 * llamada): calla al dueño actual y rechaza todo claim hasta soltarlo.
 */
export function holdAudio(reason: string): () => void {
  const token = Symbol(reason);
  holds.add(token);
  const previous = owner;
  owner = null;
  emit();
  previous?.silence();
  return () => {
    if (!holds.delete(token)) return;
    emit();
  };
}

export function resetAudioChannelForTests(): void {
  owner = null;
  holds.clear();
  emit();
}

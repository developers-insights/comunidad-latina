/**
 * Traducción de los "no" de la base a códigos de la app.
 *
 * REGLA DEL REPO (misma que `errorDelRpc` en mensajes/direct-actions.ts y que
 * `messageErrorFromRpc` en inline-actions.ts): se extrae SÓLO EL TOKEN de
 * prefijo (`/^\s*([A-Z_]+)\s*:/`). Nunca string-match del texto en español —el
 * mensaje del `raise` está escrito para un log, se puede reescribir cualquier
 * día, y matchearlo ataría la UI a una frase— y nunca el mensaje crudo en
 * pantalla.
 *
 * Módulo PURO: entra un `message` de Postgres, sale un código nuestro.
 */

export type CodigoDeLlamada =
  /** `CALL_FULL` del trigger de tope (0139 §4.3): ya son diez. */
  | "call-full"
  /** `ACCOUNT_SUSPENDED` (0021): la cuenta no puede iniciar nada. */
  | "account-suspended"
  /** La RLS dijo que no: no sos participante, o hay bloqueo entre las dos personas. */
  | "forbidden"
  /** La llamada ya no existe o ya terminó. */
  | "gone"
  | "unauthenticated"
  | "tenant-mismatch"
  | "rate-limited"
  | "invalid"
  | "error";

/**
 * Códigos de Postgres que la RLS produce cuando una policy rechaza la fila.
 * `42501` es "insufficient_privilege" —lo que devuelve un INSERT/UPDATE que no
 * pasa el `with check`— y `23505` es la PK duplicada de `call_participants`,
 * que en este módulo significa "ya estaba invitada", no un error.
 */
const RLS_DENEGADO = "42501";
export const DUPLICADO = "23505";

export function tokenDeError(message: string | null | undefined): string {
  return message?.match(/^\s*([A-Z_]+)\s*:/)?.[1] ?? "";
}

export function codigoDeLlamada(
  error: { message?: string | null; code?: string | null } | null | undefined,
): CodigoDeLlamada {
  if (!error) return "error";

  switch (tokenDeError(error.message)) {
    case "CALL_FULL":
      return "call-full";
    case "ACCOUNT_SUSPENDED":
      return "account-suspended";
    case "AUTH_REQUIRED":
      return "unauthenticated";
    case "USER_BLOCKED":
      return "forbidden";
    default:
      break;
  }

  if (error.code === RLS_DENEGADO) return "forbidden";
  return "error";
}

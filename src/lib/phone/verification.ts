import "server-only";

import { createHash, randomInt } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ciclo de vida del código de verificación por SMS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA LÓGICA VIVE EN LA BASE. ACÁ SÓLO SE LA LLAMA.
 * ═══════════════════════════════════════════════════════════════════════════
 * El rate limit y el canje son `app.phone_verification_can_send()` y
 * `app.phone_verification_consume()` (migración 0066), alcanzables desde la app
 * por los envoltorios `public.*` de la 0071 — PostgREST sólo expone `public`, y
 * sin esos envoltorios las funciones no eran llamables (404, aunque el
 * `grant execute … to service_role` estuviera puesto).
 *
 * ── POR QUÉ NO SE REIMPLEMENTA ACÁ (había una réplica, y se borró) ───────────
 * Mientras los envoltorios no existieron, esto era una réplica en TypeScript.
 * Funcionaba, pero tenía UN agujero que no se puede tapar desde afuera del
 * motor: PostgREST no sabe expresar `attempts = attempts + 1`, así que sumar un
 * intento fallido eran dos viajes (leer, escribir) y dos intentos simultáneos
 * gastaban UN solo intento entre los dos. Ese es exactamente el hueco por el que
 * se fuerza bruta un OTP de seis dígitos: con el contador pisándose, el tope de
 * 5 intentos deja de ser un tope.
 *
 * Dentro de `app.phone_verification_consume()` eso pasa en UNA transacción, con
 * `select … for update` sobre el candidato: el segundo request espera al primero
 * y el contador avanza de a uno. La réplica no podía darlo, y por eso ya no está.
 *
 * ── LO QUE SÍ SIGUE ACÁ, Y POR QUÉ ───────────────────────────────────────────
 *   · Generar el código y hashearlo. El código EN CLARO nunca puede entrar a la
 *     base — el servidor manda el hash y se queda con el texto sólo el tiempo
 *     que tarda en dárselo al proveedor de SMS.
 *   · El pepper, que vive en variable de entorno justamente para que un backup
 *     completo de Postgres no alcance.
 *   · Insertar la fila del código: es lo único que la base no puede hacer sola,
 *     porque el hash lo calcula quien conoce el pepper.
 */

/** Longitud del código. 6 dígitos: lo que la gente espera y puede tipear. */
const CODE_LENGTH = 6;

/**
 * ⚠️ ESTOS CUATRO NÚMEROS SON COPIA DE LA BASE, NO SU FUENTE.
 *
 * Los usa el COPY de la pantalla ("tenés 5 intentos", "vence en 10 minutos"), y
 * quien los aplica de verdad es Postgres: `app.phone_verification_can_send()`
 * para los dos primeros, y los DEFAULT de `phone_verification_codes` para los
 * otros dos. Si se separan, la app le miente a la persona sobre un límite que no
 * controla — le dice "te quedan 3 intentos" mientras el servidor ya la cortó.
 *
 * `verification.test.ts` LEE la migración 0066 y compara: si alguien cambia un
 * número en el SQL y no acá (o al revés), el test falla.
 */
export const MAX_SENDS_PER_HOUR = 3;
export const MAX_SENDS_PER_DAY = 10;
export const MAX_ATTEMPTS = 5;
export const CODE_TTL_MINUTES = 10;

export type CanSendResult = "ok" | "rate_limited_hora" | "rate_limited_dia";
export type ConsumeResult = "ok" | "invalido" | "expirado" | "agotado" | "sin_codigo";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Un código de 6 dígitos con aleatoriedad criptográfica.
 *
 * `randomInt` y no `Math.random()`: el segundo es predecible a partir de unas
 * pocas salidas, y un OTP predecible no es un OTP. Se permite el `000000` — el
 * espacio es 10^6 y sacarle valores sólo lo achica.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * `sha256(código + pepper)` en hexadecimal — exactamente el formato que exige el
 * CHECK `phone_verification_codes_hash_format` (`^[a-f0-9]{64}$`).
 *
 * El código EN CLARO nunca se guarda ni se loguea. Un volcado de la tabla es una
 * lista de hashes inútiles sin el pepper, que vive en env y no en la base.
 */
export function hashCode(code: string, pepper: string): string {
  return createHash("sha256").update(`${code}${pepper}`, "utf8").digest("hex");
}

/* ─────────────────────────── 1. ¿Se puede enviar? ─────────────────────────── */

const CAN_SEND_VALUES: readonly string[] = ["ok", "rate_limited_hora", "rate_limited_dia"];

/**
 * Rate limit de envío: 3 por hora y 10 por día, por (tenant, teléfono).
 *
 * Cuenta filas de `phone_verification_codes` DENTRO de la base, así que el
 * límite sigue valiendo aunque el proceso se reinicie o haya varias instancias —
 * un contador en memoria de la app no daría esa garantía.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 * Si la RPC falla o devuelve algo inesperado, se responde `rate_limited_hora`.
 * Equivocarse hacia el otro lado significa un teléfono ajeno bombardeado a
 * códigos, que es acoso y además cuesta plata por mensaje.
 */
export async function canSend(
  admin: AdminClient,
  tenantId: string,
  phone: string,
): Promise<CanSendResult> {
  const { data, error } = await admin.rpc("phone_verification_can_send", {
    p_tenant: tenantId,
    p_phone: phone,
  });

  if (error || typeof data !== "string" || !CAN_SEND_VALUES.includes(data)) {
    console.error("[telefono] phone_verification_can_send falló", {
      code: error?.code,
      recibido: typeof data,
    });
    return "rate_limited_hora";
  }

  return data as CanSendResult;
}

/* ───────────────────────────── 2. Emitir ───────────────────────────── */

/**
 * Emite y persiste un código. Devuelve el código EN CLARO, que quien llama usa
 * para el SMS y no guarda en ningún lado.
 *
 * ── EL VENCIMIENTO NO SE MANDA ───────────────────────────────────────────────
 * `expires_at` tiene DEFAULT `now() + interval '10 minutes'` en la tabla, y
 * `max_attempts` DEFAULT 5. Mandarlos desde acá les daría dos dueños, y encima
 * dejaría que el reloj del runtime de Node —que puede estar corrido respecto del
 * de Postgres— decidiera cuándo vence un código. Los pone la tabla.
 */
export async function issueCode(
  admin: AdminClient,
  tenantId: string,
  { phone, profileId, pepper }: { phone: string; profileId: string | null; pepper: string },
): Promise<{ ok: true; code: string } | { ok: false }> {
  const code = generateCode();

  const { error } = await admin.from("phone_verification_codes").insert({
    tenant_id: tenantId,
    profile_id: profileId,
    phone_e164: phone,
    code_hash: hashCode(code, pepper),
  });

  if (error) {
    console.error("[telefono] insert de código falló", { code: error.code });
    return { ok: false };
  }

  return { ok: true, code };
}

/* ───────────────────────────── 3. Canjear ───────────────────────────── */

const CONSUME_VALUES: readonly string[] = [
  "ok",
  "invalido",
  "expirado",
  "agotado",
  "sin_codigo",
];

/**
 * Canjea el código de forma ATÓMICA.
 *
 * Todo pasa dentro de una transacción del motor: se busca el código vivo más
 * reciente con `for update`, se valida vencimiento y tope de intentos, se
 * compara el hash y se suma el intento fallido — en la misma transacción. Al
 * canjear con éxito, los códigos anteriores del mismo teléfono mueren, para que
 * un código viejo todavía vivo no siga sirviendo después de haber verificado.
 *
 * El ORDEN de los chequeos lo fija la función SQL y es el correcto: vencido
 * antes que agotado, agotado antes que comparar. Comparar primero dejaría que un
 * código muerto siguiera respondiendo "invalido", y la persona reintentaría seis
 * dígitos que están bien contra algo que ya no puede funcionar.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 * Un error o una respuesta inesperada NUNCA se traducen a `ok`: se devuelve
 * `sin_codigo`, que es el estado que no verifica a nadie.
 */
export async function consumeCode(
  admin: AdminClient,
  tenantId: string,
  { phone, code, pepper }: { phone: string; code: string; pepper: string },
): Promise<ConsumeResult> {
  const { data, error } = await admin.rpc("phone_verification_consume", {
    p_tenant: tenantId,
    p_phone: phone,
    // El código en claro NUNCA sale de este proceso: viaja el hash.
    p_code_hash: hashCode(code, pepper),
  });

  if (error || typeof data !== "string" || !CONSUME_VALUES.includes(data)) {
    console.error("[telefono] phone_verification_consume falló", {
      code: error?.code,
      recibido: typeof data,
    });
    return "sin_codigo";
  }

  return data as ConsumeResult;
}

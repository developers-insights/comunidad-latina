import "server-only";

import { createHmac } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { isSentryConfigured } from "@/lib/config/services";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { claveDeLimitePorCuenta } from "./recovery";

/**
 * El tope de "olvidé mi contraseña", contado en la base (0184) para que valga igual
 * en todas las instancias y sobreviva a un deploy.
 *
 * Si la RPC no existe o falla cae al límite en memoria: el código se puede desplegar
 * antes que la migración, y una base lenta no puede dejar a nadie sin recuperar su
 * cuenta. Por eso la espera también tiene tope de tiempo.
 */

const MAX_POR_CUENTA = 3;
const MAX_POR_IP = 5;
const ESPERA_MS = 60_000;
const TIMEOUT_MS = 2_000;

/**
 * HMAC y no un hash pelado: una IPv4 se revierte probando las 4 mil millones que
 * hay, y acá la clave se persiste (§11). Rotar el secreto sólo pone los topes en cero.
 */
function claveDurable(clave: string): string {
  const secreto = process.env.CRON_SECRET || "cl-recuperar-dev-only";
  return `recuperar:${createHmac("sha256", secreto).update(clave).digest("hex")}`;
}

function avisarFalla(error: unknown): void {
  const code = (error as { code?: string } | null)?.code;
  console.error("[auth] recuperar: el tope durable falló, sigue el de memoria", { code });
  if (isSentryConfigured) {
    Sentry.captureException(
      error instanceof Error ? error : new Error(`[auth] tope de recuperación: ${code ?? "sin código"}`),
      { tags: { module: "auth", reason: "recovery-tope" } },
    );
  }
}

async function consumir(clave: string, maximo: number, ventanaMs: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .rpc("consumir_tope_de_recuperacion", {
        p_clave: claveDurable(clave),
        p_maximo: maximo,
        p_ventana_segundos: ventanaMs / 1000,
      })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));

    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("[auth] tope de recuperación sin respuesta");
    return data;
  } catch (error) {
    avisarFalla(error);
    return limit(clave, maximo, ventanaMs).ok;
  }
}

export async function ipPuedePedirRecuperacion(ip: string): Promise<boolean> {
  const clave = `recuperar:${ip}`;
  // Sin IP real todo el mundo caería en el mismo cupo durable, y cinco pedidos
  // dejarían sin recuperación a todas las comunidades.
  if (ip === "unknown") return limit(clave, MAX_POR_IP, HOUR_MS).ok;
  return consumir(clave, MAX_POR_IP, HOUR_MS);
}

/**
 * La espera va primero y por separado: un doble clic no tiene que gastar uno de los
 * tres pedidos de la hora.
 */
export async function cuentaPuedePedirRecuperacion(email: string): Promise<boolean> {
  const clave = claveDeLimitePorCuenta(email);
  if (!(await consumir(`recuperar-espera:${clave}`, 1, ESPERA_MS))) return false;
  return consumir(clave, MAX_POR_CUENTA, HOUR_MS);
}

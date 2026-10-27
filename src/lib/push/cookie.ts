import "server-only";

import { cookies } from "next/headers";

/**
 * El token del teléfono queda en una cookie httpOnly al registrarlo: es la
 * única forma de que el cierre de sesión (una server action, sin acceso al
 * plugin nativo) sepa qué dispositivo dar de baja.
 */
export const PUSH_TOKEN_COOKIE = "cl-push-device";

export async function guardarTokenPush(token: string): Promise<void> {
  (await cookies()).set(PUSH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Devuelve el token guardado y borra la cookie. */
export async function soltarTokenPush(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(PUSH_TOKEN_COOKIE)?.value ?? null;
  if (token) jar.delete(PUSH_TOKEN_COOKIE);
  return token;
}

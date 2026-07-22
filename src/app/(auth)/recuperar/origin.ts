/**
 * Resuelve el origin público (esquema + host) para armar el `redirectTo`
 * absoluto del correo de recuperación de contraseña.
 *
 * Orden: los headers del request mandan (el enlace tiene que volver al MISMO
 * host donde el usuario pidió el reset — clave con el multi-dominio de Vercel),
 * con fallback a NEXT_PUBLIC_SITE_URL y por último a localhost para dev/tests.
 *
 * ⚠️ SUPUESTO VERCEL: `x-forwarded-host` / `x-forwarded-proto` los normaliza la
 * plataforma. Fuera de Vercel (self-hosted / otro proxy) revisá tu cadena antes
 * de confiar en el host del request para construir URLs de correo.
 */
export function resolveOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host")?.trim() || headers.get("host")?.trim();

  if (host) {
    const proto =
      headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (envUrl || "http://localhost:3000").replace(/\/+$/, "");
}

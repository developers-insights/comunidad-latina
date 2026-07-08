/**
 * Regla pura de divergencia tenant-del-request ↔ tenant-del-usuario.
 *
 * Vive separada de `guard.ts` (que es `server-only` y hace I/O) porque la
 * parte que puede estar sutilmente mal es la REGLA, no el cableado — y así se
 * testea sin un solo mock.
 *
 * Contexto (ARQUITECTURA §3 y §4):
 * - El tenant del REQUEST sale del header `x-tenant-slug` que inyecta el
 *   middleware (Host en prod; `?t=` o cookie `cl-tenant` en dev/previews).
 * - El tenant del USUARIO vive en el JWT (`app_metadata.tenant_id`) y es lo
 *   ÚNICO que gobierna la RLS, vía `app.current_tenant_id()`.
 * - Cuando divergen, la lectura de contenido publicado sigue funcionando
 *   (cross-tenant a propósito, por SEO: policy `listings_select`), pero TODA
 *   escritura RLS-scoped rebota contra el `with check`.
 *
 * En producción los dominios son registrables distintos, así que las cookies
 * de sesión nunca cruzan y la divergencia es inalcanzable. Esto protege dev,
 * previews de Vercel y cualquier tenancy futura basada en path.
 */

export type TenantMatchStatus =
  /** JWT y header apuntan al mismo tenant: escritura habilitada. */
  | "match"
  /** Sin sesión: no hay nada que comparar (la RLS de anon ya decide). */
  | "anonymous"
  /** `getTenant()` cayó al fallback: no sabemos el tenant real del request. */
  | "tenant-unavailable"
  /** Divergencia real, o sesión sin claim de tenant. */
  | "tenant-mismatch";

export interface TenantMatchInput {
  /** `id` del tenant del request, tal como lo devolvió `getTenant()`. */
  requestTenantId: string;
  /** `true` si ese id es el PLACEHOLDER del fallback (DB caída, slug inexistente). */
  requestTenantIsFallback: boolean;
  /** `app_metadata.tenant_id` del JWT. `null` = anon, o token sin el claim. */
  jwtTenantId: string | null;
  /** Hay sesión. Un usuario sin claim NO es lo mismo que un anónimo. */
  isAuthenticated: boolean;
}

export function classifyTenantMatch(input: TenantMatchInput): TenantMatchStatus {
  if (!input.isAuthenticated) return "anonymous";

  // El fallback trae un id PLACEHOLDER (ver DEFAULT_TENANTS en resolve.ts).
  // Compararlo contra el JWT convertiría una caída de DB — o un `?t=` mal
  // tipeado — en "estás en la comunidad equivocada", que es mentira. Preferimos
  // el error genérico de degradación elegante (§7): nunca afirmar de más.
  if (input.requestTenantIsFallback) return "tenant-unavailable";

  // Sesión sin claim: `app.current_tenant_id()` devuelve NULL y todo
  // `with check (tenant_id = ...)` da NULL → false. La escritura rebota igual
  // que en una divergencia, y el usuario merece el mismo aviso claro.
  if (!input.jwtTenantId) return "tenant-mismatch";

  return input.jwtTenantId === input.requestTenantId ? "match" : "tenant-mismatch";
}

/* ------------------------------- Copy ------------------------------------ */

/** Tono del proyecto: afirmación + instrucción suave, voseo, cero jerga. */
export const TENANT_GUARD_COPY = {
  unauthenticated: "Para esto necesitás entrar a tu cuenta.",
  unavailable:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  /** Título del toast/banner cuando el usuario está en otra comunidad. */
  mismatchTitle: "Estás en otra comunidad",
} as const;

/**
 * Mensaje para server actions. Nombra ambas comunidades cuando las conoce;
 * si el tenant del JWT no se pudo resolver, no inventa un nombre.
 */
export function tenantMismatchMessage(
  currentTenantName: string,
  homeTenantName: string | null,
): string {
  return homeTenantName
    ? `Estás mirando ${currentTenantName}, pero tu cuenta es de ${homeTenantName}. Podés leer todo acá; para publicar o participar, volvé a tu comunidad.`
    : `Estás mirando ${currentTenantName}, pero tu cuenta es de otra comunidad. Podés leer todo acá; para publicar o participar, volvé a la tuya.`;
}

/** Copy del banner del shell — informa sin bloquear la lectura. */
export function tenantMismatchBanner(
  currentTenantName: string,
  homeTenantName: string | null,
): { title: string; body: string; action: string } {
  return {
    title: homeTenantName
      ? `Estás mirando ${currentTenantName}, pero tu cuenta vive en ${homeTenantName}.`
      : `Estás mirando ${currentTenantName}, pero tu cuenta es de otra comunidad.`,
    body: "Podés leer todo lo que quieras acá. Para publicar, escribir o anotarte a algo, volvé a tu comunidad.",
    action: homeTenantName ? `Volver a ${homeTenantName}` : "Volver a mi comunidad",
  };
}

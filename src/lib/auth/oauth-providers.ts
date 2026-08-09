/**
 * Los proveedores de identidad soportados. Sin `server-only`: la lista y las
 * etiquetas las necesita también el botón, que es un client component.
 *
 * Qué proveedor está DISPONIBLE es otra pregunta y se responde en el servidor
 * (`isGoogleAuthConfigured` / `isAppleAuthConfigured` en lib/config/services.ts):
 * sin credenciales el botón directamente no se dibuja.
 */

export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Cómo se llama cada proveedor en el botón.
 *
 * Los nombres van tal cual los escriben ellos —"Google", "Apple"— porque son
 * marcas y porque es lo que la persona reconoce. El verbo es "Continuar" y no
 * "Entrar": el mismo botón sirve para entrar y para crear la cuenta, y prometer
 * sólo una de las dos cosas hace dudar a la mitad de la gente.
 */
export const OAUTH_LABEL: Record<OAuthProvider, string> = {
  google: "Continuar con Google",
  apple: "Continuar con Apple",
};

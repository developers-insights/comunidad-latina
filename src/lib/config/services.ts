import "server-only";

/**
 * Flags de degradación elegante (§5.6 del plan / §7 de ARQUITECTURA.md).
 *
 * Cada servicio externo tiene un flag derivado de env. Si un servicio no está
 * configurado, la feature que depende de él muestra un estado premium
 * ("Estamos terminando de configurar…"), NUNCA un error técnico crudo.
 *
 * server-only: estos flags leen secretos de servidor; jamás importar desde
 * un client component (los booleanos no filtran el secreto, pero en el bundle
 * cliente las env vars de servidor son undefined y el flag mentiría).
 */

export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

export const isResendConfigured = Boolean(process.env.RESEND_API_KEY);

export const isVisionConfigured = Boolean(
  process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS,
);

export const isSentryConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

export const isOpenAIConfigured = Boolean(process.env.OPENAI_API_KEY);

/**
 * Asistente Comunitario: responde con Claude (Anthropic). Es la ÚNICA
 * credencial que el asistente necesita — la recuperación de contexto usa
 * full-text search en Postgres (match_chunks_fts, 0019), sin OpenAI. Sin esta
 * key la UI muestra <ProximamentePremium> ("muy pronto"), nunca un error crudo.
 */
export const isAnthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

/*
 * `isVercelConfigured` e `isSupabaseConfigured` vivían acá y se borraron en la
 * auditoría 2026-08-13: ninguno de los dos tenía un solo consumidor. El de
 * Supabase además era engañoso — cada módulo que necesita esas dos env las
 * chequea donde las usa y decide qué hacer con la falta (lanzar, degradar o
 * saltear), que es lo correcto: un booleano global no puede saber cuál de las
 * tres corresponde. `assertSupabaseConfigured()` (más abajo) sí se usa y sí se
 * queda.
 */

// ---------------------------------------------------------------------------
// Entrar con Google / Apple
// ---------------------------------------------------------------------------
/**
 * El proveedor se habilita en el DASHBOARD de Supabase (Authentication →
 * Providers), no acá: el intercambio del token pasa entero por el Auth server y
 * nuestra app nunca ve el client secret. Pero la app igual necesita saber si el
 * proveedor existe, y no hay forma de preguntárselo a Supabase desde el server
 * sin la Management API.
 *
 * Entonces estas dos variables son un ESPEJO declarativo de lo que hay en el
 * dashboard, con un solo trabajo: decidir si el botón se dibuja. Sin ellas el
 * botón no aparece — que es la degradación correcta. Un botón "Entrar con
 * Google" contra un proveedor apagado lleva a una pantalla de error de Supabase
 * con jerga en inglés, que es exactamente lo que §7 prohíbe.
 *
 * No llevan `NEXT_PUBLIC_`: el client id de OAuth no es secreto, pero tampoco
 * hace falta en el bundle — la página de login es un server component y baja el
 * booleano como prop.
 */
export const isGoogleAuthConfigured = Boolean(process.env.AUTH_GOOGLE_CLIENT_ID);

export const isAppleAuthConfigured = Boolean(process.env.AUTH_APPLE_CLIENT_ID);

// ---------------------------------------------------------------------------
// Teléfono y códigos por SMS
// ---------------------------------------------------------------------------
/**
 * ⚠️ GATE LEGAL, NO UN FLAG DE FEATURE. APAGADO POR DEFECTO.
 *
 * La migración 0030 lo dejó escrito y 0066 lo repitió: `user_phones` es un mapa
 * teléfono↔identidad, subpoenable, y NO se recolectan números reales hasta que
 * haya firma legal. El flujo completo está construido y probado; lo único que
 * falta es la decisión, y esa decisión no la toma un deploy.
 *
 * Por eso el default es apagado y la comparación es contra el string `"true"`
 * exacto: `Boolean(process.env.X)` prendería la recolección de teléfonos con un
 * `PHONE_VERIFICATION_ENABLED=false` mal escrito, y ese error de dedo no puede
 * costar una recolección de datos personales sin cobertura.
 */
export const isPhoneVerificationEnabled =
  process.env.PHONE_VERIFICATION_ENABLED === "true";

/**
 * ¿Hay un proveedor de SMS de verdad detrás?
 *
 * Decisión comercial pendiente: hoy es SIEMPRE false y el código se entrega por
 * el log del servidor (ver lib/phone/sms.ts). El flag existe para que enchufar
 * un proveedor sea agregar una variable, no tocar el flujo.
 */
export const isSmsConfigured = Boolean(process.env.SMS_PROVIDER_API_KEY);

/**
 * Sal del servidor para el hash de los códigos: `sha256(código + pepper)`.
 *
 * Vive FUERA de la base a propósito (0066): así un backup completo de Postgres
 * tampoco alcanza para verificar el teléfono de nadie. Sin pepper el flujo se
 * niega a emitir códigos — un hash sin sal es una tabla arcoíris de seis
 * dígitos, o sea nada.
 */
export const isPhonePepperConfigured = Boolean(process.env.PHONE_CODE_PEPPER);

/**
 * Supabase es la única dependencia SIN degradación posible: sin DB no hay app.
 * Llamar al inicializar clientes; el mensaje le dice al dev exactamente qué falta.
 */
export function assertSupabaseConfigured(): void {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Supabase no está configurado. Faltan estas variables en .env.local: ${missing.join(", ")}. ` +
        "Copiá .env.example a .env.local y completá el BLOQUE A (Project Settings → API en el dashboard de Supabase).",
    );
  }
}

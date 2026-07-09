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

export const isVercelConfigured = Boolean(
  process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID,
);

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

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

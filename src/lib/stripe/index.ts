import "server-only";

import Stripe from "stripe";
import { isStripeConfigured } from "@/lib/config/services";

/**
 * Módulo PAGOS — Presencia Verificada (PLAN §7).
 *
 * El ingreso NO está atado a tener un aviso activo: un negocio paga por
 * presencia verificada continua en el directorio, tenga o no un listing
 * publicado. Hoy Stripe NO está configurado → los callers chequean
 * `isStripeConfigured` ANTES de llamar a `getStripe()` y degradan elegante
 * (ProximamentePremium), nunca rompen (§5.6).
 */

let stripeSingleton: Stripe | null = null;

/**
 * En qué modo de Stripe está corriendo la app, leído del PREFIJO de la clave.
 *
 * `null` = sin configurar. Es lo mismo que dice `isStripeConfigured`, pero con
 * un dato más que hace falta y que hasta ahora no existía en ninguna parte: si
 * la plata que entra es de verdad o no.
 *
 * POR QUÉ IMPORTA TENERLO ESCRITO EN ALGÚN LADO
 *   Una app apuntada a claves `sk_test_` acepta la 4242 4242 4242 4242 y devuelve
 *   éxito, activa el beneficio, manda el comprobante y no cobra un centavo. Desde
 *   adentro es INDISTINGUIBLE de haber vendido. Ese es el modo correcto mientras
 *   se prueba —y por eso acá no se bloquea— pero el día que se pase a `sk_live_`,
 *   confundirse de dirección cuesta en las dos: en test se regala el producto, en
 *   live se le cobra de verdad a alguien que estaba probando.
 *
 * NO SE VALIDA CONTRA LA CLAVE PÚBLICA porque no hay ninguna: todos los cobros
 * son por Checkout hospedado (redirect) e Identity con `return_url`, así que
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` no se usa en `src/` — ver docs/STRIPE.md.
 */
export type StripeMode = "test" | "live";

export function getStripeMode(): StripeMode | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return null;
}

/**
 * Aviso de una sola vez cuando un deploy PUBLICADO corre en modo de prueba.
 *
 * No bloquea a propósito: probar contra `sk_test_` en un preview —o en producción
 * antes de abrir la venta— es exactamente lo que hay que hacer primero, y un
 * throw acá haría imposible el paso que el runbook pide dar. Lo que sí hace es
 * que el hecho quede escrito: sin esta línea, "estamos en test" y "estamos
 * vendiendo" se ven igual en los logs.
 */
let modoAvisado = false;
function avisarModo(): void {
  if (modoAvisado) return;
  modoAvisado = true;
  const modo = getStripeMode();
  if (modo === null) {
    console.warn(
      "[pagos] STRIPE_SECRET_KEY no arranca con sk_test_ ni sk_live_ — no se puede saber si los cobros son reales. Revisar que la clave esté completa y sin comillas.",
    );
    return;
  }
  if (modo === "test" && process.env.VERCEL_ENV) {
    console.warn(
      `[pagos] Stripe en modo TEST sobre un deploy publicado (VERCEL_ENV=${process.env.VERCEL_ENV}). Los pagos NO cobran plata de verdad y las tarjetas de prueba se aceptan. Correcto mientras se prueba; antes de abrir la venta hay que pasar a sk_live_ y regenerar el STRIPE_WEBHOOK_SECRET del endpoint LIVE.`,
    );
  }
}

/**
 * Factory server-only del cliente Stripe.
 *
 * Lanza un error claro si falta STRIPE_SECRET_KEY — este error es para el
 * DEV, no para el usuario: todo caller debe chequear `isStripeConfigured`
 * antes y mostrar el estado premium de degradación si es false.
 */
export function getStripe(): Stripe {
  if (!isStripeConfigured) {
    throw new Error(
      "Stripe no está configurado: falta STRIPE_SECRET_KEY en .env.local (BLOQUE B de .env.example). " +
        "Los callers deben chequear `isStripeConfigured` ANTES de llamar a getStripe() y degradar con <ProximamentePremium />.",
    );
  }
  if (!stripeSingleton) {
    avisarModo();
    stripeSingleton = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      typescript: true,
    });
  }
  return stripeSingleton;
}

// ---------------------------------------------------------------------------
// Planes de Presencia Verificada
// ---------------------------------------------------------------------------

export type PlanId = "basico" | "destacado" | "pro";

/** Intervalo de facturación. Anual = 2 meses gratis (10 × precio mensual). */
export type Intervalo = "mensual" | "anual";

export interface PlanPresencia {
  id: PlanId;
  nombre: string;
  /** Frase corta de posicionamiento honesto del plan. */
  descripcion: string;
  /** USD por mes (facturación mensual). */
  precioMensualUsd: number;
  /** USD por año — 2 meses gratis (= 10 × mensual). */
  precioAnualUsd: number;
  /** Beneficios HONESTOS — nada de promesas de conducta ni de "confianza". */
  features: string[];
  /** Plan recomendado (⭐ destacado en la UI). */
  recomendado: boolean;
}

/**
 * [EJEMPLO] (PLAN §18): precios de ejemplo para validar el modelo de
 * Presencia Verificada. La decisión de pricing real (y su migración a
 * Products/Prices del dashboard de Stripe) es una decisión humana previa
 * al go-live — hoy el Checkout usa `price_data` inline con estos montos.
 *
 * Principio §7: la presencia verificada es CONTINUA — no depende de tener
 * un aviso activo. Pagar NUNCA altera el Trust Score ni los resultados
 * del verificador del Escudo Anti-Estafa.
 */
export const PLANES_PRESENCIA: Record<PlanId, PlanPresencia> = {
  basico: {
    id: "basico",
    nombre: "Básico",
    descripcion: "Tu negocio presente en la comunidad, todo el año.",
    precioMensualUsd: 19,
    precioAnualUsd: 190,
    features: [
      "Presencia verificada continua — aunque no tengas un aviso activo",
      "Badge de negocio en tu perfil y tus publicaciones",
      "Página de negocio en el directorio de tu comunidad",
    ],
    recomendado: false,
  },
  destacado: {
    // El `id` es un valor PERSISTIDO (subscriptions.plan en la DB, metadata del
    // Checkout, PLAN_IDS del webhook): NO se toca nunca. Lo que cambió es solo
    // el `nombre` visible. Se llamaba "Destacado", la misma palabra con la que
    // el Trust Score nombra su nivel máximo ganado por reputación — un plan de
    // USD 29/mes no puede compartir nombre con un mérito. "Prioridad" dice
    // exactamente lo que se compra (prioridad en el directorio) y nada más.
    id: "destacado",
    nombre: "Prioridad",
    descripcion: "Que te encuentren primero cuando te buscan.",
    precioMensualUsd: 29,
    precioAnualUsd: 290,
    features: [
      "Todo lo del plan Básico",
      "Prioridad en el directorio de negocios",
      "Estadísticas básicas: cuánta gente vio tu negocio",
    ],
    recomendado: true,
  },
  pro: {
    id: "pro",
    nombre: "Pro",
    descripcion: "Para negocios que viven de la comunidad.",
    precioMensualUsd: 49,
    precioAnualUsd: 490,
    features: [
      "Todo lo del plan Prioridad",
      "Máxima prioridad en el directorio de negocios",
      "Estadísticas completas: visitas, contactos y evolución mensual",
    ],
    recomendado: false,
  },
};

/** Orden canónico de render en la página de pricing. */
export const PLAN_IDS: readonly PlanId[] = ["basico", "destacado", "pro"];

/** Meses que se ahorran pagando anual (2 meses gratis). */
export const MESES_GRATIS_ANUAL = 2;

/** Precio efectivo por mes según intervalo (anual prorrateado, 2 decimales máx). */
export function precioPorMes(plan: PlanPresencia, intervalo: Intervalo): number {
  if (intervalo === "mensual") return plan.precioMensualUsd;
  return Math.round((plan.precioAnualUsd / 12) * 100) / 100;
}

/** Monto a cobrar en centavos para el Checkout según intervalo. */
export function montoCentavos(plan: PlanPresencia, intervalo: Intervalo): number {
  return (intervalo === "mensual" ? plan.precioMensualUsd : plan.precioAnualUsd) * 100;
}

// ---------------------------------------------------------------------------
// Boost geolocalizado (PLAN §7) — pago ONE-TIME, no suscripción
// ---------------------------------------------------------------------------

export type BoostId = "7d" | "14d" | "30d";

export interface BoostPackage {
  id: BoostId;
  /** Días que dura el impulso. */
  dias: number;
  /** USD, cobro único. */
  precioUsd: number;
  nombre: string;
  /** Qué obtiene, en criollo y HONESTO (es publicidad, se marca como tal). */
  descripcion: string;
  /** Paquete recomendado (⭐ destacado en la UI). */
  recomendado: boolean;
}

/**
 * [EJEMPLO] (PLAN §18): precios de ejemplo del Boost para validar el modelo.
 * La decisión de pricing real es humana previa al go-live — el Checkout usa
 * `price_data` inline con estos montos.
 *
 * Principios §7 (no negociables):
 * - El alcance es la ZONA del listing (su `area_label`/`geo_zone`, ya
 *   aproximados por §5.4) — no se recolecta geo nueva para esto.
 * - El resultado se marca SIEMPRE como "Patrocinado" con aclaración de que es
 *   publicidad (FTC §255: paid placement se divulga, sin excepciones). La
 *   palabra es "Patrocinado" y no "Destacado" (contrato 2026-07-30 §4): la
 *   segunda es el nivel máximo del Trust Score, que se GANA por reputación, y
 *   usarla para lo pago hacía leer la publicidad como mérito.
 * - Pagar visibilidad JAMÁS altera Trust Score ni verificación.
 */
export const BOOST_PACKAGES: Record<BoostId, BoostPackage> = {
  "7d": {
    id: "7d",
    dias: 7,
    precioUsd: 10,
    nombre: "7 días",
    descripcion: "Tu aviso primero en tu zona durante una semana.",
    recomendado: false,
  },
  "14d": {
    id: "14d",
    dias: 14,
    precioUsd: 25,
    nombre: "14 días",
    descripcion: "Dos semanas al frente de tu zona — el equilibrio que más eligen.",
    recomendado: true,
  },
  "30d": {
    id: "30d",
    dias: 30,
    precioUsd: 45,
    nombre: "30 días",
    descripcion: "Un mes entero al frente de tu comunidad.",
    recomendado: false,
  },
};

/** Orden canónico de render en /impulsar. */
export const BOOST_IDS: readonly BoostId[] = ["7d", "14d", "30d"];

/** Monto a cobrar en centavos para el Checkout one-time del boost. */
export function boostMontoCentavos(boost: BoostPackage): number {
  return boost.precioUsd * 100;
}

/**
 * [EJEMPLO §18] RECARGO POR ALCANCE GEOGRÁFICO (migración 0092).
 *
 * El impulso se cobra con DOS números que se suman: la duración (arriba) y el
 * alcance (acá). Los dos son configurables por comunidad en `tenant_prices`;
 * estas constantes son el respaldo cuando la comunidad no tocó la casilla, y la
 * semilla de la 0092 las copia fila por fila (hay un test que lo verifica).
 *
 * POR QUÉ 'local' CUESTA CERO Y EXISTE IGUAL
 *   Porque el alcance más chico es un escalón real, no la ausencia de compra:
 *   quien impulsa su aviso para su barrio está comprando el impulso completo,
 *   sólo que dirigido. Que la casilla exista con valor 0 le da a cada comunidad
 *   la palanca de cobrarlo si quiere, sin que nadie tenga que tocar código.
 *
 * Los saltos son deliberadamente grandes (0 → 15 → 40): el alcance es lo único
 * que cambia entre las tres opciones, así que si la diferencia de precio fuera
 * chica la decisión se tomaría al azar. La cifra real la fija cada comunidad.
 */
export const BOOST_SCOPE_SURCHARGES_USD: Record<"local" | "nacional" | "global", number> = {
  local: 0,
  nacional: 15,
  global: 40,
};

/** Recargo del alcance en centavos, para `unit_amount` de Stripe. */
export function boostScopeMontoCentavos(scope: "local" | "nacional" | "global"): number {
  return BOOST_SCOPE_SURCHARGES_USD[scope] * 100;
}

// ---------------------------------------------------------------------------
// Promoción de post (feedback cliente 2026-07-19) — pago ONE-TIME
// ---------------------------------------------------------------------------
// Espeja el Boost geolocalizado (mismos montos y duraciones), pero el sujeto
// es un POST del feed, no un listing. Regla de alcance: lo orgánico de una
// entidad llega SOLO a sus seguidores; una promoción activa lo lleva al feed
// de TODA la comunidad, marcado "Patrocinado" (FTC §255, la misma palabra que
// lleva el impulso de un aviso: una sola divulgación para todo lo pago).
// Sin Stripe configurado, la campaña corre en MODO DEMO (services.ts).

export type PostPromoId = "7d" | "14d" | "30d";

export interface PostPromoPackage {
  id: PostPromoId;
  /** Días que dura la campaña. */
  dias: number;
  /** USD, cobro único. */
  precioUsd: number;
  nombre: string;
  /** Qué obtiene, en criollo y HONESTO (es publicidad, se marca como tal). */
  descripcion: string;
  /** Paquete recomendado (⭐ destacado en la UI). */
  recomendado: boolean;
}

/**
 * [EJEMPLO] (PLAN §18): precios de ejemplo de la campaña de post, espejo de
 * BOOST_PACKAGES (mismos montos: la decisión de pricing real es humana previa
 * al go-live). El Checkout usa `price_data` inline con estos montos.
 *
 * Principios §7 (no negociables, iguales al boost):
 * - Una campaña activa lleva el post al feed de todos según `audience`
 *   (toda la comunidad, o zonas = `area_label` aproximado §5.4).
 * - Se marca SIEMPRE como "Publicidad" (FTC §255: paid placement se divulga).
 * - Pagar visibilidad JAMÁS altera Trust Score ni verificación.
 */
export const POST_PROMO_PACKAGES: Record<PostPromoId, PostPromoPackage> = {
  "7d": {
    id: "7d",
    dias: 7,
    precioUsd: 10,
    nombre: "7 días",
    descripcion: "Tu publicación llega a toda la comunidad durante una semana.",
    recomendado: false,
  },
  "14d": {
    id: "14d",
    dias: 14,
    precioUsd: 25,
    nombre: "14 días",
    descripcion: "Dos semanas al alcance de todos — el equilibrio que más eligen.",
    recomendado: true,
  },
  "30d": {
    id: "30d",
    dias: 30,
    precioUsd: 45,
    nombre: "30 días",
    descripcion: "Un mes entero llegando a toda tu comunidad.",
    recomendado: false,
  },
};

/** Orden canónico de render en /impulsar-post. */
export const POST_PROMO_IDS: readonly PostPromoId[] = ["7d", "14d", "30d"];

/** Monto a cobrar en centavos para el Checkout one-time de la campaña. */
export function postPromoMontoCentavos(promo: PostPromoPackage): number {
  return promo.precioUsd * 100;
}

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
    id: "destacado",
    nombre: "Destacado",
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
      "Todo lo del plan Destacado",
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
 * - El resultado se marca SIEMPRE como "Destacado" con aclaración de que es
 *   publicidad (FTC §255: paid placement se divulga, sin excepciones).
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
    descripcion: "Dos semanas destacado — el equilibrio que más eligen.",
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

// ---------------------------------------------------------------------------
// Promoción de post (feedback cliente 2026-07-19) — pago ONE-TIME
// ---------------------------------------------------------------------------
// Espeja el Boost geolocalizado (mismos montos y duraciones), pero el sujeto
// es un POST del feed, no un listing. Regla de alcance: lo orgánico de una
// entidad llega SOLO a sus seguidores; una promoción activa lo lleva al feed
// de TODA la comunidad, marcado "Publicidad" (FTC §255, igual que "Destacado").
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

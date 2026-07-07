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

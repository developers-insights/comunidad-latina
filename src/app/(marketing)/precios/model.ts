import "server-only";

import { findPrice, formatCents, type PriceInterval, type PriceProduct, type ResolvedPrice } from "@/lib/pricing";
import { MESES_GRATIS_ANUAL, PLAN_IDS, PLANES_PRESENCIA } from "@/lib/stripe";
import {
  VERIFICACION_BOOST_DIAS,
  VERIFICACION_PLANES,
  VERIFICACION_TIER_IDS,
} from "@/lib/verificacion/catalogo";
import { DEFAULT_FEE_PCT } from "@/lib/creators/commission";

export type Billing = "suscripcion" | "unico" | "por_trabajo";

export interface PriceLine {
  label: string;
  detail?: string;
  amount: string;
  suffix?: string;
}

export interface PriceBlock {
  id: string;
  title: string;
  summary: string;
  billing: Billing;
  lines: PriceLine[];
  notes: string[];
  cta: { label: string; href: string };
}

export interface PriceGroup {
  id: string;
  title: string;
  lead: string;
  blocks: PriceBlock[];
}

const DURATIONS = ["7d", "14d", "30d"] as const;
const DURATION_LABEL: Record<(typeof DURATIONS)[number], string> = {
  "7d": "7 días",
  "14d": "14 días",
  "30d": "30 días",
};

function amountOf(
  prices: readonly ResolvedPrice[],
  product: PriceProduct,
  variant: string,
  interval: PriceInterval,
): string {
  const price = findPrice(prices, product, variant, interval);
  if (!price) return "—";
  return formatCents(price.amountCents, price.currency);
}

function durationLines(prices: readonly ResolvedPrice[], product: PriceProduct): PriceLine[] {
  return DURATIONS.map((d) => ({
    label: DURATION_LABEL[d],
    amount: amountOf(prices, product, d, "unico"),
  }));
}

export function buildPriceGroups(prices: readonly ResolvedPrice[]): PriceGroup[] {
  const presencia: PriceBlock = {
    id: "presencia",
    title: "Presencia Verificada",
    summary:
      "Tu negocio en el directorio de la comunidad todo el año, tengas o no un aviso publicado.",
    billing: "suscripcion",
    lines: PLAN_IDS.map((plan) => ({
      label: PLANES_PRESENCIA[plan].nombre,
      detail: `${amountOf(prices, "presencia", plan, "anual")} por año`,
      amount: amountOf(prices, "presencia", plan, "mensual"),
      suffix: "por mes",
    })),
    notes: [
      `Podés pagar por mes o por año. El pago anual te regala ${MESES_GRATIS_ANUAL} meses.`,
      "Pagar no cambia tu reputación ni los resultados del centro de seguridad: solo te da más visibilidad en el directorio.",
    ],
    cta: { label: "Ver planes para negocios", href: "/negocios/presencia" },
  };

  const checkAzul: PriceBlock = {
    id: "check-azul",
    title: "Check azul",
    summary:
      "La insignia azul al lado de tu nombre, para cuentas que ya confirmaron su identidad con un documento.",
    billing: "suscripcion",
    lines: VERIFICACION_TIER_IDS.map((tier) => ({
      label: VERIFICACION_PLANES[tier].nombre,
      amount: amountOf(prices, "verificacion", tier, "mensual"),
      suffix: "por mes",
    })),
    notes: [
      `Todos incluyen un impulso de ${VERIFICACION_BOOST_DIAS} días por mes para el aviso que elijas.`,
      "Confirmar tu identidad es gratis. Lo que se paga es mostrar el check.",
    ],
    cta: { label: "Conseguir el check azul", href: "/verificacion" },
  };

  const membresia: PriceBlock = {
    id: "membresia-tienda",
    title: "Membresía de tienda del Marketplace",
    summary: "Mantiene tu tienda abierta y visible en el Marketplace de la comunidad.",
    billing: "suscripcion",
    lines: [
      {
        label: "Membresía",
        amount: amountOf(prices, "store_membership", "estandar", "mensual"),
        suffix: "por mes",
      },
    ],
    notes: ["No te cobramos comisión por tus ventas."],
    cta: { label: "Abrir mi tienda", href: "/marketplace/membresia" },
  };

  const premium: PriceBlock = {
    id: "publicacion-premium",
    title: "Publicación premium",
    summary: "Mejora un aviso gratis: más fotos, video más largo y botones para que te contacten.",
    billing: "suscripcion",
    lines: [
      {
        label: "Por aviso",
        amount: amountOf(prices, "listing_premium", "estandar", "mensual"),
        suffix: "por mes",
      },
    ],
    notes: ["Se paga por cada aviso que quieras mejorar."],
    cta: { label: "Publicar un aviso", href: "/publicar" },
  };

  const impulso: PriceBlock = {
    id: "impulso",
    title: "Impulso de un aviso",
    summary:
      "Pone tu aviso al frente de los resultados por unos días. Se marca como publicidad.",
    billing: "unico",
    lines: durationLines(prices, "boost"),
    notes: [
      "Al precio de los días se le suma un recargo según hasta dónde querés llegar:",
      ...(["local", "nacional", "global"] as const).map((scope) => {
        const label = { local: "Tu zona", nacional: "Todo el país", global: "Todas las comunidades" }[
          scope
        ];
        const price = findPrice(prices, "boost_scope", scope, "unico");
        const value =
          !price || price.amountCents === 0
            ? "sin recargo"
            : `+ ${formatCents(price.amountCents, price.currency)}`;
        return `${label}: ${value}`;
      }),
    ],
    cta: { label: "Impulsar un aviso", href: "/impulsar" },
  };

  const campana: PriceBlock = {
    id: "campana",
    title: "Campaña de una publicación",
    summary:
      "Lleva una publicación tuya al inicio de toda la comunidad. Se marca como publicidad.",
    billing: "unico",
    lines: durationLines(prices, "post_promo"),
    notes: [],
    cta: { label: "Promocionar una publicación", href: "/impulsar" },
  };

  const perfilCreador: PriceBlock = {
    id: "perfil-creador",
    title: "Perfil de creador patrocinado",
    summary:
      "Tu perfil de creador aparece arriba en el directorio de creadores, marcado como patrocinado.",
    billing: "unico",
    lines: durationLines(prices, "boost"),
    notes: ["Cuesta lo mismo que impulsar un aviso por la misma cantidad de días, sin recargo por alcance."],
    cta: { label: "Destacar mi perfil", href: "/impulsar/perfil-creador" },
  };

  const colaboraciones: PriceBlock = {
    id: "colaboraciones",
    title: "Colaboraciones con creadores",
    summary:
      "Un negocio contrata a un creador para un trabajo. El monto lo acuerdan entre ustedes dos.",
    billing: "por_trabajo",
    lines: [
      {
        label: "Comisión de la plataforma",
        detail: "Se descuenta del monto acordado",
        amount: `${DEFAULT_FEE_PCT}%`,
        suffix: "por defecto",
      },
    ],
    notes: [
      "Cada comunidad puede ajustar la comisión. El porcentaje exacto y lo que cobra el creador se ven en el contrato antes de aceptarlo.",
    ],
    cta: { label: "Conocer a los creadores", href: "/creadores" },
  };

  return [
    {
      id: "negocios",
      title: "Para tu negocio y tu cuenta",
      lead: "Suscripciones para que la comunidad te encuentre y sepa quién sos.",
      blocks: [presencia, checkAzul],
    },
    {
      id: "vender",
      title: "Para vender",
      lead: "Para quien vende en el Marketplace o publica avisos.",
      blocks: [membresia, premium],
    },
    {
      id: "visibilidad",
      title: "Para que te vean más",
      lead: "Pagos de una sola vez, por la cantidad de días que elijas.",
      blocks: [impulso, campana, perfilCreador],
    },
    {
      id: "creadores",
      title: "Trabajos con creadores",
      lead: "Cuando un negocio y un creador hacen un trato dentro de la plataforma.",
      blocks: [colaboraciones],
    },
  ];
}

export const FREE_ITEMS = [
  "Crear tu cuenta y usar la plataforma",
  "Publicar avisos",
  "Mandar y recibir mensajes",
  "Participar en la comunidad",
  "Confirmar tu identidad",
] as const;

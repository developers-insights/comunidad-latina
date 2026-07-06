import { auth } from "./es/auth";
import { common } from "./es/common";
import { errors } from "./es/errors";
import { listings } from "./es/listings";
import { nav } from "./es/nav";
import { trust } from "./es/trust";

/**
 * i18n mínimo y tipado. ES es la fuente de verdad; EN puede quedar incompleto
 * (fallback automático a ES). Server-safe: sin estado, sin contexto de React.
 */

const es = { common, nav, auth, listings, trust, errors } as const;

export type Dictionary = typeof es;
export type Namespace = keyof Dictionary;
export type Locale = "es" | "en";

/** EN parcial — se completa cuando el producto lo pida; toda clave ausente cae a ES. */
const en: { [N in Namespace]?: Partial<Record<keyof Dictionary[N] & string, string>> } = {};

const dictionaries: Record<Locale, typeof en | typeof es> = { es, en };

type Params = Record<string, string | number>;

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * t('trust', 'scoreShort', { score: 87, level: 'Confiable' }) → "87 · Confiable"
 * Tipado: namespace y key se autocompletan y validan en compile time.
 */
export function t<N extends Namespace, K extends keyof Dictionary[N] & string>(
  namespace: N,
  key: K,
  params?: Params,
  locale: Locale = "es",
): string {
  if (locale !== "es") {
    const localized = (dictionaries[locale] as typeof en)[namespace]?.[key];
    if (localized) return interpolate(localized, params);
  }
  return interpolate(es[namespace][key] as string, params);
}

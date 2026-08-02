import { auth } from "./es/auth";
import { common } from "./es/common";
import { errors } from "./es/errors";
import { nav } from "./es/nav";
import { sections } from "./es/sections";
import { trust } from "./es/trust";

/**
 * i18n mínimo y tipado. ES es la fuente de verdad; EN puede quedar incompleto
 * (fallback automático a ES). Server-safe: sin estado, sin contexto de React.
 *
 * Se dio de baja el namespace `listings` (2026-08-02): estaba registrado acá
 * pero ningún `t("listings", …)` lo llamaba, y su vocabulario ya había quedado
 * viejo ("Propiedades" donde la navegación dice "Vivienda", "Publicar
 * propiedad" donde la app dice "aviso"). Un diccionario muerto no es neutro:
 * autocompleta, compila y el día que alguien lo cablee mete de vuelta las
 * palabras que el producto dejó atrás. La vertical de vivienda usa `sections`.
 */

const es = { common, nav, auth, sections, trust, errors } as const;

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

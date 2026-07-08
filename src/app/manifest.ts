import type { MetadataRoute } from "next";
import { getTenant } from "@/lib/tenant/resolve";

/**
 * Manifest PWA dinámico por tenant (módulo PWA, §1 del plan: instalable sin
 * App Store). name/short_name/theme_color salen del tenant resuelto por el
 * middleware; si la DB no responde, getTenant() degrada al tenant default
 * (dominicanos, #1A5EDB) y el manifest sigue siendo válido.
 */
/**
 * short_name aparece bajo el ícono en el launcher: los SO truncan ~12
 * caracteres. Si el nombre completo no entra, usamos la primera palabra
 * ("Dominicanos en USA" → "Dominicanos").
 */
function shortName(name: string): string {
  if (name.length <= 12) return name;
  const firstWord = name.split(/\s+/)[0];
  return firstWord.length <= 12 ? firstWord : firstWord.slice(0, 12);
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getTenant();

  return {
    id: "/",
    name: tenant.name,
    short_name: shortName(tenant.name),
    description:
      "Tu comunidad, en tu idioma. Vivienda, trabajo, negocios y gente de tu país — con verificación real para que nadie te estafe.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: tenant.locale === "en" ? "en" : "es",
    dir: "ltr",
    // El manifest se congela en la INSTALACIÓN: no reacciona al toggle ni a
    // prefers-color-scheme. background_color es el color de la splash nativa
    // mientras la PWA arranca (Android 12+ también lo usa detrás del ícono).
    // Se queda en el canvas LIGHT (--cl-light-canvas) a propósito:
    //  · el default del producto es light y la mayoría instala sin haber tocado
    //    el toggle;
    //  · un mid-tone o un oscuro se ve sucio detrás del ícono maskable;
    //  · la splash dura ~300ms y <ThemeScript /> ya pintó el tema real cuando
    //    el WebView entrega el primer frame.
    // theme_color sí puede ser la marca: el pipeline garantiza su contraste, y
    // <meta name="theme-color"> (que sí es dinámico) manda una vez que abrió.
    background_color: "#FCFCFB",
    theme_color: tenant.brandHex,
    categories: ["social", "lifestyle", "news"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

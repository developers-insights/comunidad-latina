import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";
import { ToastProvider } from "@/components/ui/toast";
import { MotionProvider } from "@/components/motion/motion-provider";
import { SplashScreen } from "@/components/experience/splash-screen";
import { DARK_THEME_COLOR, ThemeColorSync, ThemeScript } from "@/components/theme";
import "./globals.css";

// Display: General Sans variable (Fontshare), self-hosted en src/fonts/.
// Solo la cara normal: la itálica (40.7KB) se preloadeaba en TODA ruta y ningún
// elemento la renderiza (las 2 itálicas del proyecto son body/Jakarta oblicuo).
const generalSans = localFont({
  src: [
    {
      path: "../fonts/GeneralSans-Variable.woff2",
      weight: "200 700",
      style: "normal",
    },
  ],
  variable: "--font-general-sans",
  display: "swap",
});

// Body/UI: Plus Jakarta Sans variable. Subset 'latin' cubre todos los
// diacríticos de ES/EN (á é í ó ú ü ñ ¿ ¡); 'latin-ext' agregaba un 2º woff2
// preloadeado (~21KB) para europeo central/oriental que la app no usa.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  // Sin esto Next resuelve las imágenes OG relativas contra localhost:3000 en
  // build (warning + URLs de OG rotas para crawlers). El dominio real por-tenant
  // se sirve por proxy/DNS; acá basta el origin canónico del sitio.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com"),
  title: {
    default: "Comunidad Latina",
    template: "%s · Comunidad Latina",
  },
  description:
    "Tu comunidad, en tu idioma. Vivienda, trabajo, negocios y gente de tu país — con verificación real para que nadie te estafe.",
  openGraph: {
    type: "website",
    siteName: "Comunidad Latina",
    images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
  },
};

// theme-color: tiñe la barra del navegador / status bar del celular.
//   · light → la marca del tenant (premium multi-tenant).
//   · dark  → el canvas oscuro; con la marca quedaba una franja de color arriba
//             de una app oscura.
// Las dos metas con `media` hacen que el server ya acierte sin JS. Sus `media`
// siguen al SO, no al toggle, así que <ThemeScript /> las reemplaza por una sola
// meta con el tema RESUELTO antes del primer paint, y <ThemeColorSync /> pisa el
// content cuando el usuario cambia de tema en caliente.
// Ref: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenant();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: tenant.brandHex },
      { media: "(prefers-color-scheme: dark)", color: DARK_THEME_COLOR },
    ],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await getTenant();
  // Capa 3 del design system: el hex del tenant pasa por el brand pipeline y
  // pisa las variables --color-brand-* / --brand-light-* / --brand-dark-* de
  // globals.css. Se inyecta ACÁ Y SOLO ACÁ: los layouts hijos NO deben repetirlo.
  const brandStyle = brandThemeToStyle(tenant.brandHex);

  return (
    <html
      lang={tenant.locale === "en" ? "en" : "es"}
      style={brandStyle}
      className={`${generalSans.variable} ${jakarta.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Antes del primer paint: estampa .light/.dark en <html> y deja el
            <meta name="theme-color"> en el color del tema resuelto. */}
        <ThemeScript brandHex={tenant.brandHex} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-foreground">
        {/* LazyMotion: carga las features de animación async → `m` (todo el árbol)
            queda fuera del first-load JS. Envuelve a todo lo que anima. */}
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
          {/* Splash de entrada premium: overlay que se desvanece encima del
              contenido ya hidratado (no bloquea el LCP), una vez por sesión. */}
          <SplashScreen brandHex={tenant.brandHex} name={tenant.name} />
          <ThemeColorSync brandHex={tenant.brandHex} />
        </MotionProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";
import { ToastProvider } from "@/components/ui/toast";
import { SplashScreen } from "@/components/experience/splash-screen";
import "./globals.css";

// Display: General Sans variable (Fontshare), self-hosted en src/fonts/
const generalSans = localFont({
  src: [
    {
      path: "../fonts/GeneralSans-Variable.woff2",
      weight: "200 700",
      style: "normal",
    },
    {
      path: "../fonts/GeneralSans-VariableItalic.woff2",
      weight: "200 700",
      style: "italic",
    },
  ],
  variable: "--font-general-sans",
  display: "swap",
});

// Body/UI: Plus Jakarta Sans variable (excelente soporte de diacríticos ES)
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
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

// theme-color por tenant: tiñe la barra del navegador / status bar móvil con la
// marca del tenant (premium multi-tenant). El hex real lo da la DB; el fallback
// resuelve al azul default. Se calcula por request como el resto del theming.
export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenant();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: tenant.brandHex,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await getTenant();
  // Capa 3 del design system: el hex del tenant pasa por el brand pipeline y
  // pisa las variables --color-brand-* definidas en globals.css.
  const brandStyle = brandThemeToStyle(tenant.brandHex);

  return (
    <html
      lang={tenant.locale === "en" ? "en" : "es"}
      style={brandStyle}
      className={`${generalSans.variable} ${jakarta.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-canvas font-sans text-foreground">
        <ToastProvider>{children}</ToastProvider>
        {/* Splash de entrada premium: overlay que se desvanece encima del
            contenido ya hidratado (no bloquea el LCP), una vez por sesión. */}
        <SplashScreen brandHex={tenant.brandHex} name={tenant.name} />
      </body>
    </html>
  );
}

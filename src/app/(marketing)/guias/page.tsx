import type { Metadata } from "next";
import { getTenant } from "@/lib/tenant/resolve";
import { COPY } from "@/components/marketing/copy";
import { fetchPublishedGuides, toGuideCardData } from "@/components/marketing/data";
import { GuidesExplorer } from "@/components/marketing/guides-explorer";
import { JsonLd } from "@/components/marketing/json-ld";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  return {
    title: `Guías para tu llegada — ${tenant.name}`,
    description:
      "Trámites explicados paso a paso, en tu idioma y con fuentes oficiales citadas: ITIN, licencia de conducir, tus derechos y más.",
    openGraph: {
      title: `Guías para tu llegada — ${tenant.name}`,
      description:
        "Trámites explicados paso a paso, en tu idioma y con fuentes oficiales citadas.",
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function GuiasPage() {
  const guides = (await fetchPublishedGuides()).map(toGuideCardData);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: COPY.guidesIndex.title,
          itemListElement: guides.map((guide, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: guide.title,
            url: `${SITE_URL}/guias/${guide.slug}`,
          })),
        }}
      />

      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {COPY.guidesIndex.title}
        </h1>
        <p className="mt-4 leading-relaxed text-foreground-secondary">
          {COPY.guidesIndex.subtitle}
        </p>
      </header>

      <div className="mt-10">
        <GuidesExplorer guides={guides} />
      </div>
    </div>
  );
}

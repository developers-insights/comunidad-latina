import Link from "next/link";
import { MagicWand, MapPin, Storefront } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip, EmptyState, buttonVariants } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { toTrustProps } from "@/lib/trust/signals";
import type { Json, Tables } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import { BusinessTrustBadge, type OwnerTrust } from "./business-trust-badge";

export const metadata = { title: "Negocios" };

/** Copy local del módulo PAGOS/negocios — no toca src/lib/i18n (compartido). */
const COPY = {
  titulo: "Negocios de la comunidad",
  subtitulo: "Comercios y servicios de tu gente, cerca tuyo.",
  bannerTitulo: "Tu negocio, presente y verificado",
  bannerTexto:
    "Aunque no tengas un aviso activo, tu negocio queda presente en el directorio de tu comunidad.",
  bannerCta: "Conocer Presencia Verificada",
  publicadoPor: "Publicado por",
  vacioTitulo: "Todavía no hay negocios publicados",
  vacioMensaje:
    "Los comercios de la comunidad van a aparecer acá. Si tenés un negocio, este es tu lugar.",
  vacioCta: "Sumar mi negocio",
  copilotoTitulo: "¿Tenés un negocio? Probá el Copiloto",
  copilotoTexto:
    "Mejores títulos, mejor descripción e ideas de post — sugerencias de IA que revisás vos.",
  copilotoCta: "Abrir el Copiloto",
} as const;

/** Etiquetas legibles para las categorías más comunes de `attrs.category`. */
const CATEGORIA_LABELS: Record<string, string> = {
  restaurante: "Restaurante",
  envios: "Envíos",
  belleza: "Belleza",
  mecanica: "Mecánica",
  mercado: "Mercado",
  servicios: "Servicios",
};

function categoriaLabel(attrs: Json): string | null {
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const raw = (attrs as Record<string, unknown>).category;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return CATEGORIA_LABELS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Trust Score del dueño → props del badge. Usa la fuente única
 * (@/lib/trust/signals): las mismas señales que ve el usuario en vivienda,
 * mensajes y profesionales. `identity_verified` viene del perfil del dueño.
 */
function buildOwnerTrust(
  score: Tables<"trust_scores"> | undefined,
  ownerName: string,
  identityVerified: boolean,
): OwnerTrust | null {
  const props = toTrustProps(score ?? null, identityVerified);
  if (!props) return null;
  return { name: ownerName, ...props };
}

export default async function NegociosPage() {
  const tenant = await getTenant();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: negocios } = await supabase
    .from("listings")
    .select(
      "id, title, description, area_label, attrs, publisher_name, created_by, published_at, created_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);

  const rows = negocios ?? [];

  // Trust Score del dueño (si el negocio tiene dueño con score computado).
  const ownerIds = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  );
  const trustByOwner = new Map<string, Tables<"trust_scores">>();
  const nameByOwner = new Map<string, string>();
  const verifiedByOwner = new Map<string, boolean>();
  if (ownerIds.length > 0) {
    const [{ data: scores }, { data: owners }] = await Promise.all([
      supabase.from("trust_scores").select("*").in("profile_id", ownerIds),
      supabase.from("profiles").select("id, display_name, identity_verified").in("id", ownerIds),
    ]);
    for (const score of scores ?? []) trustByOwner.set(score.profile_id, score);
    for (const owner of owners ?? []) {
      nameByOwner.set(owner.id, owner.display_name);
      verifiedByOwner.set(owner.id, owner.identity_verified ?? false);
    }
  }

  return (
    <>
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.titulo}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitulo}</p>

      {/* Banner premium para dueños de negocio → Presencia Verificada (§7) */}
      <BezelCard
        variant="featured"
        className="mt-5"
        coreClassName="flex flex-col gap-3 p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"
          >
            <Storefront size={22} weight="light" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-foreground">
              {COPY.bannerTitulo}
            </p>
            <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.bannerTexto}</p>
          </div>
        </div>
        <Link
          href="/negocios/presencia"
          className={cn(buttonVariants({ variant: "primary", size: "sm" }), "self-start")}
        >
          {COPY.bannerCta}
        </Link>
      </BezelCard>

      {/* Entrada al Copiloto de Negocios (módulo MATCHING+COPILOTO) — solo logueados */}
      {user && (
        <BezelCard className="mt-4" coreClassName="flex flex-col gap-3 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"
            >
              <MagicWand size={22} weight="light" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-foreground">
                {COPY.copilotoTitulo}
              </p>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {COPY.copilotoTexto}
              </p>
            </div>
          </div>
          <Link
            href="/negocios/copiloto"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
          >
            {COPY.copilotoCta}
          </Link>
        </BezelCard>
      )}

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          illustration="/images/empty-state-search.png"
          title={COPY.vacioTitulo}
          message={COPY.vacioMensaje}
          action={
            <Link
              href="/negocios/presencia"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {COPY.vacioCta}
            </Link>
          }
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {rows.map((negocio) => {
            const categoria = categoriaLabel(negocio.attrs);
            const ownerName = negocio.created_by
              ? (nameByOwner.get(negocio.created_by) ?? negocio.publisher_name ?? "")
              : "";
            const ownerTrust = negocio.created_by
              ? buildOwnerTrust(
                  trustByOwner.get(negocio.created_by),
                  ownerName,
                  verifiedByOwner.get(negocio.created_by) ?? false,
                )
              : null;

            return (
              <li key={negocio.id}>
                <BezelCard coreClassName="flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {categoria && (
                      <Chip
                        size="sm"
                        variant="brand"
                        icon={<Storefront aria-hidden="true" />}
                      >
                        {categoria}
                      </Chip>
                    )}
                    {negocio.area_label && (
                      <Chip size="sm" icon={<MapPin aria-hidden="true" />}>
                        {negocio.area_label}
                      </Chip>
                    )}
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-semibold leading-snug text-foreground">
                      {negocio.title}
                    </h2>
                    {negocio.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-foreground-secondary">
                        {negocio.description}
                      </p>
                    )}
                  </div>
                  {ownerTrust ? (
                    <BusinessTrustBadge trust={ownerTrust} />
                  ) : (
                    negocio.publisher_name && (
                      <p className="text-xs text-foreground-muted">
                        {COPY.publicadoPor} {negocio.publisher_name}
                      </p>
                    )
                  )}
                </BezelCard>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

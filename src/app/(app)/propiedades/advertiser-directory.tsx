import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY, buildTrustSignals, toTrustLevel } from "@/components/listings";
import { aggregateAdvertisers, type AdvertiserListingRow } from "@/lib/propiedades/anunciante";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import {
  AdvertiserCard,
  AdvertiserListSkeleton,
  type AdvertiserCardModel,
} from "./advertiser-card";

/**
 * =============================================================================
 * DIRECTORIO "AGENTES Y PROPIETARIOS" (pestaña nueva de /propiedades)
 * =============================================================================
 *
 * Requisito del cliente: quién publica los alquileres — propietarios, agentes
 * inmobiliarios, administradoras, representantes autorizados — con su
 * verificación, ciudad, calificación y propiedades activas. Esto NO es otra
 * lista de avisos: es un directorio de PERSONAS, agregado a partir de sus
 * avisos de vivienda.
 *
 * ── UNA query a `listings` + dos en lote (`profiles`, `trust_scores`) ───────
 * `listings` no tiene una fila "por persona" — sólo por aviso — así que
 * agrupar por publicador se hace acá, en memoria, sobre un lote de avisos ya
 * traído (mismo criterio que ya usa esta misma página para derivar las zonas
 * del filtro: `.select("area_label")...limit(200)` + `new Set` en JS). La
 * agregación en sí (PURA, testeada) vive en `@/lib/propiedades/anunciante`;
 * acá sólo hay I/O y el armado del view-model de cada card. Nunca una query
 * por persona — eso sería exactamente el N+1 que este módulo evita.
 *
 * ── EL TOPE DE 50 Y LA VENTANA DE 600 (documentado, "por ahora está bien") ──
 * El directorio muestra los primeros 50 anunciantes (por avisos más
 * recientes), sin paginación todavía. Para descubrirlos se leen hasta 600
 * avisos de vivienda `published` del tenant — de sobra para la escala actual
 * de la comunidad, donde ni siquiera hay 50 anunciantes distintos hoy. Si el
 * tenant llega a superar esa ventana sin que los 50 primeros anunciantes ya
 * hayan aparecido, esta cuenta (`activeListingCount`) y el orden dejan de ser
 * exactos — en ese punto hace falta una agregación real en la base (vista o
 * RPC con `GROUP BY created_by`) en vez de esto. No es el caso hoy.
 *
 * ── SIN "TU ZONA" ─────────────────────────────────────────────────────────
 * A diferencia del listado de avisos, este directorio no filtra por zona
 * preferida: es un directorio de confianza (quién es quién), no una búsqueda
 * de vivienda — cada card ya muestra su propia zona.
 *
 * ── VISIBLE SIN SESIÓN ────────────────────────────────────────────────────
 * `createClient()` alcanza sin `user`: mismo criterio que el resto de los
 * directorios de la app (negocios, profesionales) — un visitante anónimo
 * también puede ver quién publica antes de crear una cuenta.
 */

const DIRECTORY_PAGE_SIZE = 50;
const LISTING_SCAN_LIMIT = 600;

const LOCAL_COPY = {
  emptyTitle: "Todavía no hay agentes ni propietarios",
  emptyMessage:
    "Apenas alguien publique un alquiler, va a aparecer acá con su zona, su verificación y sus propiedades activas.",
  publishCta: "Publicar una propiedad",
} as const;

export async function AdvertiserDirectoryContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: rows, error } = await supabase
    .from("listings")
    .select("id, created_by, area_label, attrs, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "property")
    .eq("status", "published")
    .not("created_by", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LISTING_SCAN_LIMIT);

  if (error) {
    console.warn("[vivienda] query de anunciantes falló", { code: error.code });
  }

  const listingRows: AdvertiserListingRow[] = (rows ?? [])
    .filter((row): row is typeof row & { created_by: string } => Boolean(row.created_by))
    .map((row) => ({
      createdBy: row.created_by,
      createdAt: row.created_at,
      areaLabel: row.area_label,
      attrs: row.attrs,
    }));

  const advertisers = aggregateAdvertisers(listingRows).slice(0, DIRECTORY_PAGE_SIZE);

  if (advertisers.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        illustration="/images/empty-state-search.png"
        title={LOCAL_COPY.emptyTitle}
        message={LOCAL_COPY.emptyMessage}
        action={
          <Link
            href="/publicar?kind=property"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            <Plus size={18} aria-hidden="true" />
            {LOCAL_COPY.publishCta}
          </Link>
        }
      />
    );
  }

  const advertiserIds = advertisers.map((advertiser) => advertiser.profileId);

  // Dos lotes en paralelo, cada uno UNA sola consulta para TODOS los
  // anunciantes de esta página — mismo patrón que ya usan /propiedades,
  // /profesionales y /negocios para publicador + Trust Score.
  const [profilesResult, trustResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, identity_verified")
      .in("id", advertiserIds),
    supabase
      .from("trust_scores")
      .select("profile_id, score, level, signals")
      .in("profile_id", advertiserIds),
  ]);

  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const trustById = new Map(
    (trustResult.data ?? []).map((trust) => [trust.profile_id, trust]),
  );

  const cards: AdvertiserCardModel[] = advertisers.map((advertiser) => {
    const profile = profileById.get(advertiser.profileId);
    const trust = trustById.get(advertiser.profileId);
    const identityVerified = profile?.identity_verified ?? false;
    return {
      profileId: advertiser.profileId,
      displayName: profile?.display_name ?? COPY.list.communityMember,
      avatarUrl: profile?.avatar_url ?? null,
      identityVerified,
      role: advertiser.role,
      areaLabel: advertiser.areaLabel,
      activeListingCount: advertiser.activeListingCount,
      trust: {
        score: trust?.score ?? 0,
        level: toTrustLevel(trust?.level),
        signals: buildTrustSignals(trust?.signals ?? {}, identityVerified),
      },
    };
  });

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <AdvertiserCard key={card.profileId} advertiser={card} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback: shimmer, nunca spinner (§5.2)
// ---------------------------------------------------------------------------

export function AdvertiserDirectorySkeleton() {
  return (
    <div aria-busy="true" className="mt-4">
      <AdvertiserListSkeleton />
    </div>
  );
}

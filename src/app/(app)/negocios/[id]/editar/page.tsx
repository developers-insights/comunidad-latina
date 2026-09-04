import { notFound } from "next/navigation";
import { z } from "zod";
import { DetailTopBar } from "@/components/listings";
import { EditarPaginaForm } from "@/components/negocios";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { supabaseSinTipar } from "@/lib/resenas";
import { fetchPaginaDeNegocio } from "@/lib/negocios/pagina-query";
import { businessCategoryOf } from "../../categories";
import { EDITAR_NEGOCIO_COPY as C } from "./copy";

/**
 * EDITAR LA PÁGINA DE UN NEGOCIO (call del 3/9, punto 14 del feedback: «falta
 * poder editar la información de la otra cuenta y agregar los servicios que da
 * cada perfil»).
 *
 * Vive en `/negocios/[id]/editar`, al lado del editor de horarios y por el
 * mismo motivo que aquél: es la página PÚBLICA lo que se está editando, y a
 * esta pantalla se llega desde ahí —o desde «Administrar tu cuenta de
 * negocio»—, que es donde el dueño ve el hueco y quiere llenarlo.
 *
 * ── QUIÉN ENTRA ─────────────────────────────────────────────────────────────
 * Lo decide `puedo_administrar_aviso()` (0093), el mismo predicado que usan la
 * RLS y las dos RPC de escritura de la 0127: dueño del aviso o miembro activo
 * del negocio con rol de gestión. Quien no puede recibe un 404 y no un «no
 * tenés permiso» — la existencia de la pantalla no es información que le
 * debamos.
 */

type Params = Promise<{ id: string }>;

export const metadata = { title: C.title };

export default async function EditarNegocioPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, attrs, area_label, tier, cta_phone, cta_whatsapp, cta_website, cta_address",
    )
    .eq("id", id)
    .eq("kind", "business")
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const sinTipar = supabaseSinTipar(supabase);
  const { data: puedeAdministrar } = await sinTipar.rpc("puedo_administrar_aviso", {
    p_listing: listing.id,
  });
  if (puedeAdministrar !== true) notFound();

  // Servicios, logo y portada salen de su propia consulta, tolerante a que la
  // 0127 todavía no esté aplicada (ver `pagina-query.ts`).
  const pagina = await fetchPaginaDeNegocio(supabase, listing.id);

  return (
    <div className="pb-28">
      <DetailTopBar title={C.title} listingId={listing.id} />

      <header className="mb-4 mt-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
          {C.subtitle}
        </p>
      </header>

      <EditarPaginaForm
        listingId={listing.id}
        esPremium={listing.tier === "premium"}
        inicial={{
          title: listing.title,
          description: listing.description ?? "",
          category: businessCategoryOf(listing.attrs) ?? "",
          areaLabel: listing.area_label ?? "",
          phone: listing.cta_phone ?? "",
          whatsapp: listing.cta_whatsapp ?? "",
          website: listing.cta_website ?? "",
          address: listing.cta_address ?? "",
          servicios: pagina.servicios,
          logoUrl: pagina.logoUrl,
          coverUrl: pagina.coverUrl,
        }}
      />
    </div>
  );
}

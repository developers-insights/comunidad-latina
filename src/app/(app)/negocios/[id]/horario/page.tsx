import { notFound } from "next/navigation";
import { z } from "zod";
import { DetailTopBar } from "@/components/listings";
import { HorarioEditor } from "@/components/negocios";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { HORARIO_COPY as C, esDiaSemana, type DiaSemana, type Tramo } from "@/lib/horarios";
import { supabaseSinTipar } from "@/lib/resenas";

/**
 * EDITOR DEL HORARIO DE ATENCIÓN de un negocio.
 *
 * Vive en `/negocios/[id]/horario` y no en el panel de presencia porque es del
 * AVISO, que es la cara pública: se llega desde la ficha, que es donde el dueño
 * ve el hueco y quiere llenarlo.
 *
 * ── QUIÉN ENTRA ─────────────────────────────────────────────────────────────
 * Lo decide `puedo_administrar_aviso()` (0093), que es el mismo predicado que
 * usa la RLS: dueño del aviso o miembro activo del negocio con rol de gestión
 * (`business_members`, 0031). Quien no puede, recibe un 404 y no un "no tenés
 * permiso": la existencia de la pantalla no es información que le debamos.
 */

type Params = Promise<{ id: string }>;

export const metadata = { title: C.editarTitulo };

interface FilaTramo {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export default async function HorarioDeNegocioPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, title, kind")
    .eq("id", id)
    .eq("kind", "business")
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const sinTipar = supabaseSinTipar(supabase);
  const { data: puedeAdministrar } = await sinTipar.rpc("puedo_administrar_aviso", {
    p_listing: listing.id,
  });
  if (puedeAdministrar !== true) notFound();

  const [configResult, tramosResult] = await Promise.all([
    sinTipar.from("listing_hours").select("time_zone").eq("listing_id", listing.id).maybeSingle(),
    sinTipar
      .from("listing_hours_slots")
      .select("weekday, opens_at, closes_at")
      .eq("listing_id", listing.id)
      .order("weekday", { ascending: true })
      .order("opens_at", { ascending: true }),
  ]);

  if (configResult.error) {
    console.warn("[horarios] no se pudo leer la zona al editar", {
      listingId: listing.id,
      code: configResult.error.code,
    });
  }
  if (tramosResult.error) {
    console.warn("[horarios] no se pudieron leer los tramos al editar", {
      listingId: listing.id,
      code: tramosResult.error.code,
    });
  }

  const tramos: Tramo[] = ((tramosResult.data ?? []) as FilaTramo[])
    .filter((fila) => esDiaSemana(fila.weekday))
    .map((fila) => ({
      weekday: fila.weekday as DiaSemana,
      opensAt: fila.opens_at.slice(0, 5),
      closesAt: fila.closes_at.slice(0, 5),
    }));

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} />
      <HorarioEditor
        className="mt-4"
        listingId={listing.id}
        timeZoneInicial={(configResult.data?.time_zone as string | undefined) ?? null}
        tramosIniciales={tramos}
      />
    </div>
  );
}

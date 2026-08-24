import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * ACCESO A `listing_premiums` — el único lugar con el cast
 * =============================================================================
 *
 * `src/lib/types/database.types.ts` se REGENERA desde la base y no se edita a
 * mano, así que hasta que alguien lo regenere `listing_premiums` (0054) no
 * existe para TypeScript y `supabase.from("listing_premiums")` no compila.
 *
 * En vez de esparcir un cast por cada archivo que la toca —que es como se pierde
 * el tipado de verdad— todo el acceso pasa por acá: cuatro funciones, un solo
 * cast, y las filas tipadas a mano contra el DDL de la migración. Cuando
 * `database.types.ts` se regenere, se borra `untyped()` y los tipos de abajo se
 * reemplazan por los generados; el resto del código no se entera.
 *
 * Las filas de abajo NO son la tabla entera: son exactamente las columnas que
 * este producto lee o escribe. Un tipo que promete columnas que nadie pide es un
 * tipo que se desactualiza sin que ningún test lo note.
 */

/** Lo que la pantalla del dueño necesita saber. */
export interface ListingPremiumRow {
  id: string;
  status: string;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  price_cents: number | null;
}

/** Lo que el webhook escribe en el alta. */
export interface ListingPremiumUpsert {
  tenant_id: string;
  listing_id: string;
  owner_id: string;
  status: string;
  /** Lo que se cobró de verdad (CHECK `> 0` en 0054), no el default de la columna. */
  price_cents: number;
  /** ISO 4217 en MINÚSCULAS, como la guarda la columna (default 'usd'). */
  currency: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  updated_at: string;
}

/** Lo que el webhook escribe en cada cambio de estado. */
export interface ListingPremiumPatch {
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: string;
  updated_at: string;
}

/** La fila devuelta tras sincronizar, para poder notificar a quien corresponde. */
export interface ListingPremiumOwnerRef {
  id: string;
  tenant_id: string;
  owner_id: string;
  listing_id: string;
}

/**
 * El error de PostgREST tal como lo necesita quien llama.
 *
 * `message`/`details` no son adorno: `code` sola no distingue CUÁL unique índice
 * rebotó, y `listing_premiums` tiene tres (listing_id, subscription, checkout
 * session). El handler decide muy distinto según cuál sea — ver
 * `activateFromCheckout`.
 */
export interface DbError {
  code?: string;
  message?: string;
  details?: string;
}

const TABLE = "listing_premiums";

/**
 * El cast, aislado. `SupabaseClient` sin genéricos deja `from()` sin tipos de
 * tabla — es exactamente lo que hace falta para una tabla que el generador
 * todavía no vio, y no afecta a ninguna otra consulta del proyecto.
 */
function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/** La suscripción de un aviso, o `null`. Respeta la RLS del cliente que reciba. */
export async function selectPremiumByListing(
  client: unknown,
  listingId: string,
  ownerId?: string,
): Promise<{ data: ListingPremiumRow | null; error: { code?: string } | null }> {
  let query = untyped(client)
    .from(TABLE)
    .select("id, status, cancel_at_period_end, current_period_end, stripe_customer_id, price_cents")
    .eq("listing_id", listingId);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.maybeSingle();
  return { data: (data as ListingPremiumRow | null) ?? null, error };
}

/*
 * `upsertPremium` vivía acá y se borró en la auditoría de pagos 2026-08-24.
 *
 * Era un `upsert(onConflict: listing_id)` que escribía SIEMPRE, y su docblock
 * afirmaba ser "idempotente por construcción — un reintento reescribe los mismos
 * valores". Eso es cierto de la FILA y falso de todo lo demás: el handler seguía
 * de largo hasta la notificación y la auditoría, así que la segunda entrega del
 * mismo pago mandaba un segundo comprobante y escribía una segunda fila de
 * `audit_log`. Y no reescribía "los mismos valores" cuando la suscripción se
 * había cancelado entre medio: la resucitaba a `active`.
 *
 * El alta la hace ahora `concederUnaSolaVez` (./concesion.ts), que pone el token
 * del pago en el `WHERE` — el mismo patrón que `activateBoost` ya usaba con el
 * estado. `ListingPremiumUpsert` se queda: es el tipo de la fila que se escribe.
 */

/**
 * Sincroniza por `stripe_subscription_id`, que es la correlación real: NO se
 * confía en la metadata para decidir a qué fila aplicar un cambio de estado.
 */
export async function updatePremiumBySubscription(
  admin: unknown,
  subscriptionId: string,
  patch: ListingPremiumPatch,
): Promise<{ data: ListingPremiumOwnerRef | null; error: { code?: string } | null }> {
  const { data, error } = await untyped(admin)
    .from(TABLE)
    .update(patch)
    .eq("stripe_subscription_id", subscriptionId)
    .select("id, tenant_id, owner_id, listing_id")
    .maybeSingle();
  return { data: (data as ListingPremiumOwnerRef | null) ?? null, error };
}

import { UrgentBroadcastCard } from "@/components/notifications";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { fetchUrgentBroadcast } from "./alert-queries";

/**
 * La alerta comunitaria del feed, como Server Component propio.
 *
 * Vive aparte del contenido a propósito, por dos razones:
 *
 *  1. NO BLOQUEA EL FEED. Se monta dentro de su propio <Suspense fallback=
 *     {null}>: mientras la query viaja, el feed ya se está pintando. Si la
 *     lectura falla, `fetchUrgentBroadcast` devuelve null y acá no se renderiza
 *     nada — ni hueco, ni espacio reservado, ni error.
 *  2. NO SE REMONTA AL CAMBIAR DE TAB. El contenido del feed cuelga de un
 *     Suspense keyeado por tab; si la alerta viviera adentro, se descartaría y
 *     volvería a consultarse en cada toque de "Propiedades" / "Eventos".
 */
export async function FeedAlert() {
  // El try/catch envuelve SOLO los fetches (mismo criterio que
  // FeedHeaderWithArea): construir el JSX adentro haría que un error de render
  // se tragara acá en vez de subir al error boundary.
  let alert = null;
  try {
    const [supabase, viewerId] = await Promise.all([createClient(), getAuthUserId()]);
    alert = await fetchUrgentBroadcast(supabase, viewerId);
  } catch {
    alert = null; // el feed se renderiza igual; una alerta que no carga no se ve.
  }

  if (!alert) return null;
  return <UrgentBroadcastCard broadcast={alert} />;
}

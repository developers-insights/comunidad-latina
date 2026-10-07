import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/supabase/server";
import { leerConversacion, leerMensajesDelHilo } from "@/lib/messaging/hilo-queries";
import { COPY } from "@/components/messaging/copy";
import { HiloDirecto } from "@/components/messaging/hilo-directo";
import { EsqueletoDelHilo } from "@/components/messaging/esqueleto-del-hilo";

export const metadata: Metadata = { title: COPY.inbox.title };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /mensajes/[id] — el hilo vive en `HiloDirecto`, que también monta la llamada.
 *
 * ANTES del `Suspense` va sólo lo que decide el status: sesión y que la
 * conversación exista para mí. Un `notFound()` que llega después de empezar a
 * streamear ya no puede devolver 404. Lo demás —mensajes, adjuntos firmados,
 * presencia— entra en el `Suspense` con la silueta del hilo, así la pantalla se
 * pinta en cuanto pasa el chequeo. Los mensajes se piden YA (sin esperarlos):
 * corren en paralelo con la conversación y `HiloDirecto` recibe la misma
 * promesa por `cache()`.
 */
export default async function HiloPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const userId = await getAuthUserId();
  if (!userId) redirect(`/entrar?next=/mensajes/${id}`);

  void leerMensajesDelHilo(id);
  const conversacion = await leerConversacion(id);
  if (!conversacion) notFound();

  return (
    <Suspense fallback={<EsqueletoDelHilo />}>
      <HiloDirecto id={id} variante="pagina" />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COPY } from "@/components/messaging/copy";
import { HiloDirecto } from "@/components/messaging/hilo-directo";

export const metadata: Metadata = { title: COPY.inbox.title };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /mensajes/[id] — el hilo vive en `HiloDirecto`, que también monta la llamada. */
export default async function HiloPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return <HiloDirecto id={id} variante="pagina" />;
}

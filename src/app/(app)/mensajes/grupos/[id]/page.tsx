import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COPY } from "@/components/messaging/copy";
import { HiloDeGrupo } from "@/components/messaging/hilo-de-grupo";

export const metadata: Metadata = { title: COPY.groups.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /mensajes/grupos/[id] — el hilo vive en `HiloDeGrupo`, que también monta la llamada. */
export default async function GrupoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return <HiloDeGrupo id={id} variante="pagina" />;
}

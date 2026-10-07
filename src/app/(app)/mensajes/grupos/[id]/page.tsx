import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/supabase/server";
import { COPY } from "@/components/messaging/copy";
import { HiloDeGrupo } from "@/components/messaging/hilo-de-grupo";
import { EsqueletoDelHilo } from "@/components/messaging/esqueleto-del-hilo";
import { listarMensajesDelGrupo, obtenerGrupo } from "../queries";

export const metadata: Metadata = { title: COPY.groups.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /mensajes/grupos/[id] — el hilo vive en `HiloDeGrupo`, que también monta la llamada.
 *
 * Mismo corte que el hilo 1-a-1: antes del `Suspense`, sólo lo que decide el
 * status (sesión, y que el grupo exista para mí — uno privado ajeno es 404).
 * Los mensajes salen ya, sin esperarlos, y el hilo recibe la misma promesa por
 * `cache()`.
 */
export default async function GrupoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const userId = await getAuthUserId();
  if (!userId) redirect(`/entrar?next=/mensajes/grupos/${id}`);

  void listarMensajesDelGrupo(id);
  const grupo = await obtenerGrupo(id, userId);
  if (!grupo) notFound();

  return (
    <Suspense fallback={<EsqueletoDelHilo grupo />}>
      <HiloDeGrupo id={id} variante="pagina" />
    </Suspense>
  );
}

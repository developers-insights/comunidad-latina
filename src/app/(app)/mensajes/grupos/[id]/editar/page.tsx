import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { COPY } from "@/components/messaging/copy";
import { GroupForm } from "@/components/messaging/group-form";
import {
  administra,
  esCategoriaDeGrupo,
  type VisibilidadDeGrupo,
} from "@/lib/messaging/grupos";
import { obtenerGrupo } from "../../queries";

export const metadata: Metadata = { title: COPY.groups.edit };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /mensajes/grupos/[id]/editar — la misma ficha de "crear", con los datos.
 *
 * Quien no administra vuelve a la info del grupo en vez de ver un 403: el
 * botón que trae acá sólo se le muestra a quien puede, así que llegar sin
 * permiso es una URL pegada a mano, y la respuesta útil es devolverlo a la
 * pantalla que sí puede ver. La base decide igual: `chat_groups_update` sólo
 * deja escribir a owner/admin, y el UPDATE no toca ninguna fila si no lo sos.
 */
export default async function EditarGrupoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const grupo = await obtenerGrupo(id, user.id);
  if (!grupo) notFound();
  if (!administra(grupo.miRol)) redirect(`/mensajes/grupos/${grupo.id}/info`);

  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.groups.edit}
      </h1>

      <GroupForm
        grupo={{
          id: grupo.id,
          name: grupo.name,
          description: grupo.description,
          category: esCategoriaDeGrupo(grupo.category) ? grupo.category : "otro",
          visibility: grupo.visibility as VisibilidadDeGrupo,
          avatarUrl: grupo.avatar_url,
        }}
      />
    </>
  );
}

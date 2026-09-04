import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { COPY } from "@/components/messaging/copy";
import { GroupForm } from "@/components/messaging/group-form";

export const metadata: Metadata = { title: COPY.groups.createTitle };

/**
 * /mensajes/grupos/nuevo — crear un grupo.
 *
 * Página propia y no una hoja modal sobre la lista: el formulario tiene cinco
 * campos y una subida de foto, y en 375px eso no entra en una hoja sin que el
 * teclado tape la mitad. Además así tiene URL propia y el back del sistema
 * vuelve a la lista, que es justo el reclamo del punto 3 del feedback.
 */
export default async function NuevoGrupoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  return (
    <>
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.groups.createTitle}
      </h1>
      <p className="mb-6 mt-1.5 text-sm text-foreground-secondary">
        {COPY.groups.createIntro}
      </p>

      <GroupForm />
    </>
  );
}

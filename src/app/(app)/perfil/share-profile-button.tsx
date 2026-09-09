"use client";

import { ShareNetwork } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { CompartirSheet, urlAbsoluta, useCompartir } from "@/components/share";

const COPY = {
  action: "Compartir perfil",
  shareTitle: (name: string) => `Perfil de ${name} en Comunidad Latina`,
} as const;

export interface ShareProfileButtonProps {
  /** Ruta del perfil ("/perfil/<id>"). Se absolutiza con el origin real. */
  path: string;
  displayName: string;
}

/** Comparte la ruta pública del perfil en chats internos o hacia afuera. */
export function ShareProfileButton({ path, displayName }: ShareProfileButtonProps) {
  const compartir = useCompartir();
  const profileId = path.split("/").filter(Boolean).at(-1) ?? "";

  function share() {
    compartir.abrir({
      kind: "profile",
      id: profileId,
      titulo: COPY.shareTitle(displayName),
      url: urlAbsoluta(path),
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="md" onClick={share}>
        <ShareNetwork size={16} aria-hidden="true" />
        {COPY.action}
      </Button>

      {compartir.contenido && (
        <CompartirSheet
          open={compartir.abierto}
          onClose={compartir.cerrar}
          kind={compartir.contenido.kind}
          id={compartir.contenido.id}
          url={compartir.contenido.url ?? urlAbsoluta(path)}
          titulo={compartir.contenido.titulo}
          imagenUrl={compartir.contenido.imagenUrl}
          detalle={compartir.contenido.detalle}
        />
      )}
    </>
  );
}

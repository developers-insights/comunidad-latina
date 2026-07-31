"use client";

import { useState } from "react";
import { DownloadSimple, FilePdf } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { createCvSignedUrlAction } from "@/app/(app)/empleos/actions";
import { COPY } from "./copy";

const C = COPY.candidates;

export interface CvDownloadButtonProps {
  applicationId: string;
  className?: string;
}

/**
 * Abre el currículum de una candidatura.
 *
 * ── LO QUE NO HACE, QUE ES EL PUNTO ────────────────────────────────────────
 * No recibe la ruta del archivo. No la tiene, no viaja en el HTML y no está en
 * el payload RSC: lo único que este componente conoce es el id de la
 * postulación. Al tocar el botón, una server action verifica —con la RLS del
 * usuario, dos veces: la fila y después el objeto— y devuelve una URL firmada
 * que vive 60 segundos.
 *
 * Un `<a href="…/object/public/job-cvs/…">` en el HTML sería un currículum
 * ajeno a un clic derecho de distancia, y el bucket es privado justamente para
 * que eso no exista.
 */
export function CvDownloadButton({ applicationId, className }: CvDownloadButtonProps) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function open() {
    setPending(true);
    try {
      const result = await createCvSignedUrlAction({ applicationId });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.cvError });
        return;
      }
      // Un <a> efímero en vez de window.open: no lo bloquea el navegador por
      // venir después de un await, y la respuesta llega con Content-Disposition
      // attachment, así que descarga sin sacar a nadie de la pantalla.
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      toast({ variant: "danger", title: C.cvError });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <Button variant="outline" size="sm" loading={pending} onClick={open}>
        {pending ? (
          <DownloadSimple size={16} aria-hidden="true" />
        ) : (
          <FilePdf size={16} weight="fill" aria-hidden="true" />
        )}
        {pending ? C.cvOpening : C.cvOpen}
      </Button>
      <p className="mt-1 text-xs text-foreground-muted">{C.cvPrivacyNote}</p>
    </div>
  );
}

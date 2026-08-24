"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Select } from "@/components/ui";
import { COPY_VERIFICACION } from "@/components/verificacion/copy";
import { canjearImpulsoDeRegalo } from "./actions";

export interface AvisoCanjeable {
  id: string;
  title: string;
}

/**
 * Canje del impulso de regalo: elegir aviso y usarlo.
 *
 * POR QUÉ ES UNA ELECCIÓN Y NO UN BOTÓN "USAR AHORA"
 * Porque el impulso arranca en el momento en que se canjea y corre siete días
 * seguidos. Aplicarlo solo, sobre el aviso que la app crea que corresponde, es
 * gastarle a alguien un regalo en algo que no quería impulsar — y no hay forma
 * de deshacerlo. Que la persona elija es más trabajo para ella y es lo correcto.
 *
 * El `<select>` de avisos ya viene filtrado por el servidor con la RLS del
 * usuario (sólo publicados y propios). Igual la action lo vuelve a verificar:
 * la lista que se pinta no es una barrera de seguridad, sólo una comodidad.
 */
export function CanjeForm({
  grantId,
  avisos,
}: {
  grantId: string;
  avisos: readonly AvisoCanjeable[];
}) {
  const router = useRouter();
  const [listingId, setListingId] = useState(avisos[0]?.id ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  if (avisos.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">{COPY_VERIFICACION.regalo.sinAvisos}</p>
    );
  }

  function canjear() {
    if (pending || !listingId) return;
    setErrorMessage(null);
    setPending(true);

    startTransition(async () => {
      const result = await canjearImpulsoDeRegalo({ grantId, listingId });
      if (result.status === "ok") {
        // El estado nuevo lo sabe el SERVIDOR (el crédito ya no está, el aviso
        // quedó impulsado), así que se vuelve a pedir la pantalla en vez de
        // pintar de memoria algo que no existe.
        //
        // Y la confirmación viaja por la URL, no por un estado local: al
        // recargar, el crédito ya no existe y la página deja de renderizar este
        // formulario — un `useState("listo")` se desmontaría antes de que nadie
        // lo leyera. Con `?estado=impulsado` la persona ve QUÉ pasó y HASTA
        // CUÁNDO dura, que es lo que acaba de gastar. Es el mismo mecanismo que
        // ya usa el Checkout (`?estado=exito`).
        router.replace(
          `/verificacion?estado=impulsado&hasta=${encodeURIComponent(result.endsAt)}`,
          { scroll: false },
        );
        router.refresh();
        return;
      }
      if (result.status === "sin_sesion") {
        router.push(`/entrar?next=${encodeURIComponent("/verificacion")}`);
        return;
      }
      setErrorMessage(result.message);
      setPending(false);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="canje-aviso">{COPY_VERIFICACION.regalo.elegirAviso}</Label>
        <Select
          id="canje-aviso"
          value={listingId}
          onChange={(event) => setListingId(event.target.value)}
          disabled={pending}
        >
          {avisos.map((aviso) => (
            <option key={aviso.id} value={aviso.id}>
              {aviso.title}
            </option>
          ))}
        </Select>
      </div>

      <Button variant="primary" size="md" loading={pending} onClick={canjear}>
        {COPY_VERIFICACION.regalo.canjear}
      </Button>
    </div>
  );
}

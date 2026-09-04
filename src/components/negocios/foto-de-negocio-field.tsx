"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Camera, Storefront, Trash } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, Spinner } from "@/components/ui";
import {
  FOTO_MIME_ACEPTADOS,
  MAX_FOTO_BYTES,
  type TipoDeFotoDeNegocio,
} from "@/lib/negocios/pagina";
import {
  quitarFotoDeNegocioAction,
  subirFotoDeNegocioAction,
} from "@/app/(app)/negocios/[id]/editar/actions";
import { EDITAR_NEGOCIO_COPY as C } from "@/app/(app)/negocios/[id]/editar/copy";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * LA FOTO DE UN NEGOCIO — el botón que el cliente tocó y no hacía nada
 * =============================================================================
 *
 * Call del 3/9 (58:11): «ahí no te dejó subir una foto». No era un bug: la
 * subida no existía. El botón «Subir la foto» del perfil-como-negocio era un
 * `<Link>` a la ficha pública, donde no había ningún `<input type="file">`.
 *
 * ── SE GUARDA SOLA, Y ES A PROPÓSITO ────────────────────────────────────────
 * Elegir la foto la sube y la deja puesta, sin esperar a un «Guardar cambios»
 * más abajo. Es distinto del avatar personal (`avatar-upload-field.tsx`, que sí
 * espera al submit) y la diferencia es el contexto: acá la queja fue
 * exactamente «toqué y no pasó nada». Una subida que queda en suspenso hasta
 * otro botón produce la misma sensación. Quitar tiene su propio botón, así que
 * nada queda atrapado por haberse guardado solo.
 *
 * ── EL ARCHIVO VIAJA POR LA SERVER ACTION ───────────────────────────────────
 * A diferencia del resto del repo, que sube directo al bucket desde el
 * navegador. Los dos motivos están escritos en `editar/actions.ts`: la
 * validación que importa es sobre los BYTES (tipo real, dimensiones, EXIF) y la
 * policy de Storage no deja subir a un administrador que no publicó la ficha.
 * Acá sólo se ataja lo evidente —tipo declarado y peso— para no gastar una
 * subida entera en un archivo que ya se sabe que no entra.
 *
 * ── LA PREVIA ES LA DE VERDAD ───────────────────────────────────────────────
 * No se muestra un `URL.createObjectURL` del archivo local: se muestra lo que
 * el servidor devolvió después de guardarlo. Una previa local se ve bien
 * incluso cuando la subida falló, y eso es una mentira cara — el negocio se
 * queda pensando que ya tiene logo.
 */

export interface FotoDeNegocioFieldProps {
  listingId: string;
  tipo: TipoDeFotoDeNegocio;
  /** Nombre del negocio: la inicial del círculo mientras no hay foto. */
  nombre: string;
  urlInicial: string | null;
  className?: string;
}

export function FotoDeNegocioField({
  listingId,
  tipo,
  nombre,
  urlInicial,
  className,
}: FotoDeNegocioFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(urlInicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const esLogo = tipo === "logo";

  function elegir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setAviso(null);

    if (!FOTO_MIME_ACEPTADOS.includes(archivo.type as (typeof FOTO_MIME_ACEPTADOS)[number])) {
      setError(C.erroresFoto.tipo);
      return;
    }
    if (archivo.size > MAX_FOTO_BYTES) {
      setError(C.erroresFoto.peso);
      return;
    }

    const formData = new FormData();
    formData.append("listingId", listingId);
    formData.append("tipo", tipo);
    formData.append("archivo", archivo);

    startTransition(async () => {
      const resultado = await subirFotoDeNegocioAction(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setUrl(resultado.url);
      setAviso(C.fotos.subida);
    });
  }

  function quitar() {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const resultado = await quitarFotoDeNegocioAction({ listingId, tipo });
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setUrl(null);
      setAviso(C.fotos.quitada);
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
          {esLogo ? C.fotos.logoLabel : C.fotos.coverLabel}
        </label>
        <span className="text-xs text-foreground-muted">{C.fotos.formatos}</span>
      </div>

      <div className={cn("flex gap-3", esLogo ? "items-center" : "flex-col")}>
        {esLogo ? (
          <Avatar size="xl" name={nombre} src={url} />
        ) : (
          <Portada url={url} />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {esLogo ? C.fotos.logoHelp : C.fotos.coverHelp}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pendiente}
              onClick={() => inputRef.current?.click()}
            >
              <Camera size={16} aria-hidden="true" />
              {url ? C.fotos.cambiar : C.fotos.elegir}
            </Button>

            {url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pendiente}
                onClick={quitar}
              >
                <Trash size={16} aria-hidden="true" />
                {C.fotos.quitar}
              </Button>
            )}

            {pendiente && (
              <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <Spinner size={14} />
                {C.fotos.subiendo}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* El input real, fuera de la vista pero enfocable por su label: un
          `hidden` lo sacaría del árbol de accesibilidad y del click del botón. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={FOTO_MIME_ACEPTADOS.join(",")}
        className="sr-only"
        disabled={pendiente}
        onChange={(evento) => {
          elegir(evento.target.files?.[0]);
          // Para que elegir DOS VECES el mismo archivo vuelva a disparar el
          // change (si no, el segundo intento tras un error no hace nada).
          evento.target.value = "";
        }}
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!error && aviso && (
        <p role="status" className="text-sm text-success">
          {aviso}
        </p>
      )}
    </div>
  );
}

/**
 * La portada. Sin foto no se muestra un rectángulo gris vacío: se muestra la
 * franja con la firma tricolor de la marca en un degradé suave, que es lo que
 * la página va a mostrar igual mientras no haya foto. Así la previa dice la
 * verdad —«hoy tu portada se ve así»— en vez de simular un hueco roto.
 */
function Portada({ url }: { url: string | null }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto del bucket público, sin optimizador
      <img
        src={url}
        alt=""
        className="aspect-[16/6] w-full rounded-lg border border-border-subtle object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[16/6] w-full items-center justify-center rounded-lg border border-border-subtle bg-gradient-to-br from-brand-tint via-surface to-surface-subtle text-foreground-muted"
    >
      <Storefront size={28} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { FileArrowUp, FilePdf, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { mimeBase, validarAdjunto, type MotivoDeRechazo } from "@/lib/messaging/adjuntos";
import { COPY_COMPOSER } from "./copy-composer";

const C = COPY_COMPOSER.archivo;

export function formatearPeso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",").replace(",0", "")} MB`;
}

function textoDeRechazo(motivo: MotivoDeRechazo): string {
  if (motivo === "peso") return COPY_COMPOSER.rechazo.peso;
  if (motivo === "tipo") return COPY_COMPOSER.rechazo.tipo;
  return COPY_COMPOSER.rechazo.vacio;
}

export interface ArchivoPreviaProps {
  /** Vacío = hoja cerrada. */
  archivos: File[];
  onCancelar: () => void;
  onEnviar: (archivos: File[], pie: string) => void;
}

export function ArchivoPrevia({ archivos, onCancelar, onEnviar }: ArchivoPreviaProps) {
  const [mostrados, setMostrados] = useState<File[]>(archivos);
  const [pie, setPie] = useState("");

  // Se conserva la última lista mientras la hoja se va: si se vaciara en el
  // acto, la animación de salida mostraría una hoja en blanco.
  if (archivos.length > 0 && archivos !== mostrados) {
    setMostrados(archivos);
    setPie("");
  }

  const revisados = mostrados.map((archivo) => {
    const validacion = validarAdjunto({ mime: archivo.type, bytes: archivo.size });
    return { archivo, motivo: validacion.ok ? null : validacion.motivo };
  });
  const sanos = revisados.filter((item) => item.motivo === null).map((item) => item.archivo);

  function enviar() {
    if (sanos.length === 0) return;
    onEnviar(sanos, pie.trim());
  }

  return (
    <BottomSheet
      open={archivos.length > 0}
      onClose={onCancelar}
      title={C.titulo(mostrados.length)}
      keyboardAware
    >
      <ul className="flex flex-col gap-2">
        {revisados.map(({ archivo, motivo }) => {
          const esPdf = mimeBase(archivo.type) === "application/pdf";
          const Icono = esPdf ? FilePdf : FileArrowUp;
          return (
            <li
              key={`${archivo.name}·${archivo.size}·${archivo.lastModified}`}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-3 py-3",
                motivo ? "border-danger/40 bg-danger-bg" : "border-border-subtle bg-surface-subtle",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                  motivo
                    ? "bg-surface text-danger ring-danger/30"
                    : "bg-surface-raised text-brand ring-border-subtle",
                )}
              >
                <Icono size={26} weight="duotone" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-sm font-semibold text-foreground">
                  {archivo.name}
                </span>
                <span className="mt-0.5 block text-xs tabular-nums text-foreground-muted">
                  {esPdf ? C.tipoPdf : C.tipoOtro} · {formatearPeso(archivo.size)}
                </span>
                {motivo && (
                  <span role="alert" className="mt-1 flex items-start gap-1 text-xs text-danger-ink">
                    <WarningCircle size={14} weight="fill" aria-hidden="true" className="mt-px shrink-0" />
                    {textoDeRechazo(motivo)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <label htmlFor="archivo-pie" className="sr-only">
        {C.pie}
      </label>
      <input
        id="archivo-pie"
        type="text"
        value={pie}
        maxLength={2000}
        placeholder={C.pie}
        disabled={sanos.length === 0}
        onChange={(event) => setPie(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            enviar();
          }
        }}
        // 16 px en el teléfono: por debajo de eso iOS hace zoom al enfocar y la hoja se corre.
        className="mt-4 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base text-foreground placeholder:text-placeholder focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring disabled:opacity-50 sm:text-sm"
      />

      <div className="mt-4 flex items-center justify-end gap-2 pb-[env(safe-area-inset-bottom)]">
        <button
          type="button"
          onClick={onCancelar}
          className="min-h-11 rounded-full px-5 text-sm font-semibold text-foreground-secondary transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-surface-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          {C.cancelar}
        </button>
        <button
          type="button"
          onClick={enviar}
          disabled={sanos.length === 0}
          className="min-h-11 rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          {C.enviar(mostrados.length)}
        </button>
      </div>
    </BottomSheet>
  );
}

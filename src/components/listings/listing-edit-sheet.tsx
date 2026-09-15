"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagesSquare, Plus, Trash } from "@phosphor-icons/react/dist/ssr";
import {
  cargarAvisoParaEditar,
  editarAvisoAction,
  type AvisoEditable,
} from "@/app/(app)/publicaciones/editar-actions";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet, Button, Field, Input, Textarea, useToast } from "@/components/ui";
import {
  EDICION_COPY,
  EDICION_LIMITES,
  camposEditables,
  hayCambios,
  parsearPrecio,
} from "@/lib/listings/edicion";
import { cn } from "@/lib/utils";
import { listingPhotoUrl } from "./helpers";

/**
 * =============================================================================
 * LA HOJA PARA EDITAR UN AVISO
 * =============================================================================
 *
 * Los campos que la gente de verdad corrige: el título, la descripción, el
 * precio y las fotos. Nada más. No es un wizard de alta recortado — es la
 * contracara de `PostEditSheet` para las nueve verticales de aviso.
 *
 * ── LOS VALORES SE PIDEN AL ABRIR, NO VIAJAN EN LA TARJETA ─────────────────
 * La tarjeta sólo sabe un booleano ("es tuyo"). Todo lo demás —texto, precio,
 * paths de las fotos— se trae con UNA consulta, y recién cuando alguien abre la
 * hoja. Mandarlo en cada tarjeta habría engordado nueve grillas para un dato que
 * casi nadie va a usar en esa pantalla, y traerlo por tarjeta habría sido una
 * consulta por fila.
 *
 * ── LAS FOTOS NUEVAS SUBEN AL BUCKET ANTES DE GUARDAR ──────────────────────
 * Igual que en el alta: la policy `listing_photos_insert` exige el path
 * `{tenant}/{listing}/…` de un aviso propio, así que la sesión de la persona es
 * la que sube y la base es la que autoriza. El servidor recibe PATHS, nunca
 * bytes, y le corre a cada foto nueva el mismo pipeline de integridad y de
 * moderación que corre el alta.
 *
 * Consecuencia conocida: si alguien sube una foto y después cancela, el archivo
 * queda en el bucket sin que ninguna fila lo apunte. Es exactamente lo que ya
 * pasa en los cuatro wizards de publicación, y la alternativa —diferir la subida
 * hasta el submit— haría que la foto no se pueda ver antes de guardarla, que es
 * el momento en que sirve verla.
 *
 * ── SE DICE ANTES DE GUARDAR QUE VUELVE A REVISIÓN ─────────────────────────
 * Enterarse después es enterarse tarde. El aviso está arriba del botón, no en el
 * toast de salida.
 */

export interface ListingEditSheetProps {
  open: boolean;
  onClose: () => void;
  listingId: string;
  kind: string;
  /** Para que el menú que la montó pueda actualizar su rótulo sin recargar. */
  onGuardado?: (status: string) => void;
}

export function ListingEditSheet({
  open,
  onClose,
  listingId,
  kind,
  onGuardado,
}: ListingEditSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={EDICION_COPY.hoja.titulo}
      keyboardAware
    >
      {/* El BottomSheet desmonta a sus hijos al cerrar: el cuerpo monta fresco
          en cada apertura y nunca arrastra el borrador de la vez anterior. */}
      <Cuerpo
        key={listingId}
        onClose={onClose}
        listingId={listingId}
        kind={kind}
        onGuardado={onGuardado}
      />
    </BottomSheet>
  );
}

function Cuerpo({
  onClose,
  listingId,
  kind,
  onGuardado,
}: Omit<ListingEditSheetProps, "open">) {
  const router = useRouter();
  const { toast } = useToast();
  const campos = camposEditables(kind);

  const [aviso, setAviso] = useState<AvisoEditable | null>(null);
  const [cargaFallida, setCargaFallida] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [precioCrudo, setPrecioCrudo] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [isPending, startTransition] = useTransition();

  const tituloId = useId();
  const descripcionId = useId();
  const precioId = useId();
  const archivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const result = await cargarAvisoParaEditar({ listingId });
      if (!vigente) return;
      if (!result.ok) {
        setCargaFallida(result.error);
        return;
      }
      setAviso(result.aviso);
      setTitle(result.aviso.title);
      setDescription(result.aviso.description);
      setPrecioCrudo(
        result.aviso.priceAmount === null ? "" : String(result.aviso.priceAmount),
      );
      setPhotos(result.aviso.photos);
    })();
    return () => {
      vigente = false;
    };
  }, [listingId]);

  if (cargaFallida) {
    return (
      <p role="alert" className="pb-4 text-sm font-medium text-danger">
        {cargaFallida}
      </p>
    );
  }

  if (!aviso) {
    return (
      <p className="pb-4 text-sm text-foreground-muted">{EDICION_COPY.hoja.cargando}</p>
    );
  }

  const precio = campos.precio ? parsearPrecio(precioCrudo) : aviso.priceAmount;
  const precioInvalido = precio === undefined;
  const tituloCorto = title.trim().length < EDICION_LIMITES.tituloMin;

  const cambiado = hayCambios(
    {
      title: aviso.title,
      description: aviso.description,
      priceAmount: aviso.priceAmount,
      photos: aviso.photos,
    },
    {
      title,
      description,
      priceAmount: precioInvalido ? aviso.priceAmount : (precio ?? null),
      photos,
    },
  );

  const puedeGuardar =
    cambiado && !tituloCorto && !precioInvalido && !isPending && !subiendo;

  /** El aviso sobre qué pasa al guardar. Depende del estado real de la fila. */
  const avisoDeRevision =
    aviso.status === "paused"
      ? EDICION_COPY.revision.pausada
      : aviso.status === "pending_review"
        ? EDICION_COPY.revision.enRevision
        : EDICION_COPY.revision.publicada;

  async function agregarFotos(archivos: FileList) {
    if (!aviso) return;
    const lugar = EDICION_LIMITES.fotosMax - photos.length;
    if (lugar <= 0) {
      setErrorMessage(EDICION_COPY.errores.fotosMuchas(EDICION_LIMITES.fotosMax));
      return;
    }
    setErrorMessage(null);
    setSubiendo(true);
    try {
      const supabase = createClient();
      const subidas: string[] = [];
      for (const archivo of Array.from(archivos).slice(0, lugar)) {
        const { blob, ext } = await prepararFoto(archivo);
        const path = `${aviso.tenantId}/${aviso.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || archivo.type || "image/webp",
            upsert: false,
          });
        if (error) {
          setErrorMessage(EDICION_COPY.errores.fotoSubida);
          break;
        }
        subidas.push(path);
      }
      if (subidas.length > 0) setPhotos((previas) => [...previas, ...subidas]);
    } catch {
      setErrorMessage(EDICION_COPY.errores.fotoSubida);
    } finally {
      setSubiendo(false);
      if (archivoRef.current) archivoRef.current.value = "";
    }
  }

  function guardar() {
    if (!aviso || !puedeGuardar) return;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await editarAvisoAction({
        listingId: aviso.id,
        title: title.trim(),
        description: description.trim(),
        priceAmount: campos.precio ? (precio ?? null) : aviso.priceAmount,
        photoPaths: photos,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      onGuardado?.(result.status);
      toast({
        title: EDICION_COPY.ok.guardadoTitulo,
        description:
          result.status === "pending_review"
            ? EDICION_COPY.ok.guardadoRevision
            : EDICION_COPY.ok.guardadoDirecto,
        variant: result.status === "pending_review" ? "info" : "success",
      });
      router.refresh();
      onClose();
    });
  }

  const deshabilitado = isPending || subiendo;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        guardar();
      }}
      className="flex flex-col gap-4 pb-2"
    >
      <Field
        htmlFor={tituloId}
        label={EDICION_COPY.hoja.tituloCampo}
        help={EDICION_COPY.hoja.contador(title.trim().length, EDICION_LIMITES.tituloMax)}
        error={
          cambiado && tituloCorto
            ? EDICION_COPY.errores.tituloCorto(EDICION_LIMITES.tituloMin)
            : undefined
        }
      >
        <Input
          id={tituloId}
          value={title}
          maxLength={EDICION_LIMITES.tituloMax}
          placeholder={EDICION_COPY.hoja.tituloPlaceholder}
          onChange={(event) => setTitle(event.target.value)}
          disabled={deshabilitado}
          aria-invalid={cambiado && tituloCorto ? true : undefined}
          autoFocus
        />
      </Field>

      <Field
        htmlFor={descripcionId}
        label={campos.descripcionEtiqueta}
        help={EDICION_COPY.hoja.contador(
          description.trim().length,
          EDICION_LIMITES.descripcionMax,
        )}
        optional
      >
        <Textarea
          id={descripcionId}
          rows={5}
          value={description}
          maxLength={EDICION_LIMITES.descripcionMax}
          onChange={(event) => setDescription(event.target.value)}
          disabled={deshabilitado}
        />
      </Field>

      {campos.precio && (
        <Field
          htmlFor={precioId}
          label={campos.precioEtiqueta}
          help={EDICION_COPY.hoja.sinPrecio}
          error={precioInvalido ? EDICION_COPY.errores.precioInvalido : undefined}
          optional
        >
          <Input
            id={precioId}
            // `inputMode="decimal"` y no `type="number"`: en el teclado del
            // teléfono da las mismas teclas, pero deja escribir "1.200" sin que
            // el navegador tire el valor entero por "inválido" mientras se tipea.
            inputMode="decimal"
            value={precioCrudo}
            maxLength={16}
            placeholder={EDICION_COPY.hoja.precioPlaceholder}
            onChange={(event) => setPrecioCrudo(event.target.value)}
            disabled={deshabilitado}
            aria-invalid={precioInvalido ? true : undefined}
            className="numeric"
          />
        </Field>
      )}

      {campos.fotos && (
        <TiraDeFotos
          photos={photos}
          disabled={deshabilitado}
          onQuitar={(path) => setPhotos((previas) => previas.filter((p) => p !== path))}
          onAgregar={() => archivoRef.current?.click()}
          subiendo={subiendo}
        />
      )}

      <input
        ref={archivoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const archivos = event.target.files;
          if (archivos && archivos.length > 0) void agregarFotos(archivos);
        }}
      />

      <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-xs text-foreground-secondary">
        {avisoDeRevision}
      </p>

      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage}
        </p>
      )}

      {/* Sin cambios y sin error: se dice por qué Guardar está apagado, en vez
          de dejar un control muerto sin explicación. */}
      {!cambiado && !errorMessage && (
        <p className="text-xs text-foreground-muted">{EDICION_COPY.hoja.sinCambios}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isPending}
          className="sm:min-w-28"
        >
          {EDICION_COPY.hoja.cancelar}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={!puedeGuardar}
          className="sm:min-w-40"
        >
          {isPending ? EDICION_COPY.hoja.guardando : EDICION_COPY.hoja.guardar}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Las fotos
// ---------------------------------------------------------------------------

function TiraDeFotos({
  photos,
  disabled,
  subiendo,
  onQuitar,
  onAgregar,
}: {
  photos: readonly string[];
  disabled: boolean;
  subiendo: boolean;
  onQuitar: (path: string) => void;
  onAgregar: () => void;
}) {
  const lleno = photos.length >= EDICION_LIMITES.fotosMax;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground-secondary">
        {EDICION_COPY.hoja.fotosLabel}
      </p>

      {/* Tira horizontal y no grilla: con diez fotos permitidas, una grilla
          empujaría el botón de guardar fuera de la hoja en un teléfono. */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {photos.map((path, index) => (
          <li key={path} className="relative shrink-0">
            <div className="size-20 overflow-hidden rounded-md bg-surface-subtle ring-1 ring-inset ring-border-subtle">
              {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de 80px de un bucket público, sin layout shift ni necesidad de optimización */}
              <img
                src={listingPhotoUrl(path)}
                alt=""
                className="size-full object-cover"
                loading="lazy"
              />
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onQuitar(path)}
              aria-label={EDICION_COPY.hoja.fotosQuitar(index + 1, photos.length)}
              className={cn(
                "absolute -right-1 -top-1 flex size-8 items-center justify-center rounded-full",
                "bg-danger text-on-danger shadow-sm",
                // Área táctil a 44px con ::after y no agrandando el botón: acá
                // taparía la miniatura. `touch-hitbox` no sirve porque fuerza
                // `position: relative` y este botón es `absolute`.
                "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
                "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Trash size={14} weight="bold" aria-hidden="true" />
            </button>
          </li>
        ))}

        {!lleno && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={onAgregar}
              disabled={disabled}
              aria-label={EDICION_COPY.hoja.fotosAgregar}
              className={cn(
                "flex size-20 flex-col items-center justify-center gap-1 rounded-md",
                "border border-dashed border-border text-foreground-muted",
                "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:bg-surface-subtle active:scale-[0.96]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {subiendo ? (
                <ImagesSquare size={20} aria-hidden="true" />
              ) : (
                <Plus size={20} aria-hidden="true" />
              )}
              <span className="text-[11px] font-medium">
                {EDICION_COPY.hoja.fotosAgregar}
              </span>
            </button>
          </li>
        )}
      </ul>

      <p className="text-xs text-foreground-muted">
        {EDICION_COPY.hoja.fotosTope(EDICION_LIMITES.fotosMax)}
      </p>
    </div>
  );
}

/**
 * Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original.
 *
 * Copia deliberada de la función del mismo nombre en los wizards de publicación
 * (que son de otro dueño, §ownership): un client component autocontenido evita
 * acoplar rutas de dueños distintos a un archivo compartido. Cambió el nombre a
 * español para no fingir que es el mismo símbolo importado.
 */
async function prepararFoto(file: File): Promise<{ blob: Blob; ext: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (blob) return { blob, ext: "webp" };
  } catch {
    // Caemos al original.
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  return { blob: file, ext: ["webp", "jpg", "jpeg", "png"].includes(ext) ? ext : "jpg" };
}

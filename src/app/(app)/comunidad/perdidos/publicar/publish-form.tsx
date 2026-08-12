"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  HandHeart,
  ImageSquare,
  MagnifyingGlass,
  Plus,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Select,
  Textarea,
  buttonVariants,
} from "@/components/ui";
import {
  COMUNIDAD_COPY,
  LOST_FOUND_AREA_MAX,
  LOST_FOUND_AREA_MIN,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_CATEGORY_LABEL,
  LOST_FOUND_DESCRIPTION_MAX,
  LOST_FOUND_DESCRIPTION_MIN,
  LOST_FOUND_MAX_PHOTOS,
  LOST_FOUND_TITLE_MAX,
  LOST_FOUND_TITLE_MIN,
  isAcceptableHappenedOn,
  type LostFoundCategory,
  type LostFoundType,
} from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { createLostFoundCaseDraft, finalizeLostFoundCase } from "../../actions";

/**
 * Wizard de /comunidad/perdidos/publicar — TRES pasos, mobile-first.
 *
 *   1. Qué pasó   (perdí / encontré + categoría + título + detalle)
 *   2. Dónde y cuándo (zona + fecha aproximada)
 *   3. Fotos      (opcionales) → publicar
 *
 * El flujo de guardado es el de siempre y lo dictan la RLS de `listings` y la
 * policy del bucket: `createLostFoundCaseDraft` → subir a `listing-photos` con
 * el path {tenant}/{listing}/… → `finalizeLostFoundCase`.
 *
 * ── DOS COSAS PROPIAS DE ESTE FORMULARIO ────────────────────────────────────
 *  · NO HAY CAMPO DE RECOMPENSA, y es deliberado. Una recompensa publicada es
 *    el anzuelo de la estafa clásica de esta sección ("lo tengo yo, mandame el
 *    envío y te lo devuelvo"). Si alguien quiere ofrecer algo, lo hablará por
 *    mensaje privado, que deja rastro y se puede reportar.
 *  · A QUIEN ENCONTRÓ ALGO SE LE PIDE QUE SE GUARDE UN DETALLE. Está en la
 *    ayuda del campo de descripción, no escondido en un aviso legal: es la
 *    única forma práctica de que después pueda confirmar que quien reclama es
 *    el dueño de verdad.
 */

const C = COMUNIDAD_COPY.publicar;
const TOTAL_PASOS = 3;

const ACCENT = "var(--accent-comunidad)";
const ACCENT_TINT = `color-mix(in oklab, ${ACCENT} 12%, transparent)`;
const ACCENT_EDGE = `color-mix(in oklab, ${ACCENT} 42%, transparent)`;

/**
 * Tope del archivo CRUDO. Generoso a propósito (mismo criterio que el resto de
 * los flujos): las fotos de celular pesan 8–20 MB y un tope chico se ve como
 * "elijo la foto y no se marca ninguna". Lo que SE SUBE es la versión
 * recomprimida, y ésa sí tiene tope duro.
 */
const RAW_PHOTO_MAX_BYTES = 40 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const TAP_CARD = cn(
  "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold",
  "transition-[border-color,background-color,transform,color] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

interface PhotoItem {
  file: File;
  previewUrl: string;
}

/**
 * Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original.
 * Duplicado intencional del helper equivalente de las otras rutas de
 * publicación: cada ruta es autocontenida.
 */
async function preparePhoto(file: File): Promise<{ blob: Blob; ext: string }> {
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

/** Hoy en `YYYY-MM-DD` local — el `max` del input de fecha. */
function hoyISO(): string {
  const ahora = new Date();
  const offset = ahora.getTimezoneOffset() * 60_000;
  return new Date(ahora.getTime() - offset).toISOString().slice(0, 10);
}

export function CasoPublishForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();

  const [paso, setPaso] = useState(0);
  const [tipo, setTipo] = useState<LostFoundType>("lost");
  const [categoria, setCategoria] = useState<LostFoundCategory>("documentos");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [zona, setZona] = useState("");
  const [fecha, setFecha] = useState("");
  const [fotos, setFotos] = useState<PhotoItem[]>([]);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<"published" | "pending_review" | null>(null);

  const inputFotos = useRef<HTMLInputElement>(null);

  // Las previsualizaciones son object URLs: sin esto se acumulan en memoria
  // hasta que se recarga la página.
  useEffect(() => {
    return () => {
      fotos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
    // Sólo al desmontar: en cada cambio ya se revoca la foto que se saca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validarPaso(indice: number): string | null {
    if (indice === 0) {
      if (titulo.trim().length < LOST_FOUND_TITLE_MIN) return C.errors.title;
      if (descripcion.trim().length < LOST_FOUND_DESCRIPTION_MIN) return C.errors.description;
    }
    if (indice === 1) {
      if (zona.trim().length < LOST_FOUND_AREA_MIN) return C.errors.area;
      if (fecha && !isAcceptableHappenedOn(fecha)) return C.errors.date;
    }
    return null;
  }

  function siguiente() {
    const problema = validarPaso(paso);
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    setPaso((actual) => Math.min(actual + 1, TOTAL_PASOS - 1));
  }

  function agregarFotos(files: FileList | null) {
    if (!files) return;
    // `files` es una lista VIVA y se vacía al terminar el handler: hay que
    // materializarla acá y no dentro del updater diferido de setState.
    const elegidas = Array.from(files);
    const aceptadas: PhotoItem[] = [];
    let pesada = false;

    for (const file of elegidas) {
      if (fotos.length + aceptadas.length >= LOST_FOUND_MAX_PHOTOS) break;
      if (file.size > RAW_PHOTO_MAX_BYTES) {
        pesada = true;
        continue;
      }
      aceptadas.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (pesada) setError(C.steps.photos.tooBig);
    else setError(null);
    if (aceptadas.length > 0) setFotos((actual) => [...actual, ...aceptadas]);
    if (inputFotos.current) inputFotos.current.value = "";
  }

  function sacarFoto(indice: number) {
    setFotos((actual) => {
      const fuera = actual[indice];
      if (fuera) URL.revokeObjectURL(fuera.previewUrl);
      return actual.filter((_, i) => i !== indice);
    });
  }

  async function publicar() {
    // Se revalida TODO: se puede volver atrás y vaciar un campo ya aprobado.
    for (let indice = 0; indice < TOTAL_PASOS; indice += 1) {
      const problema = validarPaso(indice);
      if (problema) {
        setPaso(indice);
        setError(problema);
        return;
      }
    }
    setError(null);
    setEnviando(true);

    try {
      let caseId = draftId;
      if (!caseId) {
        const creado = await createLostFoundCaseDraft({
          type: tipo,
          category: categoria,
          title: titulo.trim(),
          description: descripcion.trim(),
          areaLabel: zona.trim(),
          happenedOn: fecha || null,
        });
        if (!creado.ok) {
          if (creado.needsAuth) {
            router.push(`/entrar?next=${encodeURIComponent("/comunidad/perdidos/publicar")}`);
            return;
          }
          setError(creado.error);
          return;
        }
        caseId = creado.caseId;
        setDraftId(creado.caseId);
      }

      const supabase = createClient();

      // getUser() revalida y refresca el token del browser ANTES de subir (con
      // el token vencido la subida se rechaza en silencio), y el tenant sale del
      // JWT —lo que la RLS realmente compara— no del prop.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        setError(C.errors.auth);
        router.push(`/entrar?next=${encodeURIComponent("/comunidad/perdidos/publicar")}`);
        return;
      }
      const tid = String(user.app_metadata?.tenant_id ?? tenantId);

      const photoPaths: string[] = [];
      for (const item of fotos) {
        const { blob, ext } = await preparePhoto(item.file);
        if (blob.size > UPLOAD_MAX_BYTES) {
          setError(C.steps.photos.tooBig);
          return;
        }
        const path = `${tid}/${caseId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          // Sin este log el fallo real (RLS, token vencido, límite del bucket)
          // queda invisible: sólo se vería el copy genérico.
          console.warn("[comunidad] subida de foto falló", { message: uploadError.message });
          setError(C.errors.upload);
          return;
        }
        photoPaths.push(path);
      }

      const cerrado = await finalizeLostFoundCase({ caseId, photoPaths });
      if (!cerrado.ok) {
        setError(cerrado.error);
        return;
      }
      setListo(cerrado.status);
    } catch {
      setError(C.errors.generic);
    } finally {
      setEnviando(false);
    }
  }

  // -------------------------------------------------------------------------
  // Final
  // -------------------------------------------------------------------------
  if (listo) {
    const final = listo === "published" ? C.donePublished : C.donePending;
    return (
      <BezelCard variant={listo === "published" ? "success" : "default"} coreClassName="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {listo === "published" ? (
            <CheckCircle size={40} weight="fill" aria-hidden="true" className="text-success-ink" />
          ) : (
            <Clock size={40} weight="fill" aria-hidden="true" className="text-foreground-muted" />
          )}
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {final.title}
          </h2>
          <p className="text-sm leading-relaxed text-foreground-secondary">{final.body}</p>

          <div className="mt-2 flex w-full flex-col gap-2">
            <Link
              href="/comunidad/perdidos"
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
            >
              {C.seeSection}
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="w-full"
              onClick={() => {
                fotos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
                setFotos([]);
                setTitulo("");
                setDescripcion("");
                setZona("");
                setFecha("");
                setDraftId(null);
                setListo(null);
                setPaso(0);
              }}
            >
              {C.publishAnother}
            </Button>
          </div>
        </div>
      </BezelCard>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <ProgressDots total={TOTAL_PASOS} current={paso} />

      {paso === 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.steps.what.title}
          </h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              {C.steps.what.typeLabel}
            </legend>
            <div className="flex gap-2">
              {(
                [
                  { value: "lost", label: C.steps.what.lost, icon: <MagnifyingGlass size={18} weight="bold" /> },
                  { value: "found", label: C.steps.what.found, icon: <HandHeart size={18} weight="fill" /> },
                ] as const
              ).map((opcion) => {
                const activo = tipo === opcion.value;
                return (
                  <button
                    key={opcion.value}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setTipo(opcion.value)}
                    className={cn(
                      TAP_CARD,
                      activo
                        ? "text-foreground"
                        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
                    )}
                    style={
                      activo
                        ? { backgroundColor: ACCENT_TINT, borderColor: ACCENT_EDGE }
                        : undefined
                    }
                  >
                    <span aria-hidden="true" style={{ color: activo ? ACCENT : undefined }}>
                      {opcion.icon}
                    </span>
                    {opcion.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field htmlFor="caso-categoria" label={C.steps.what.categoryLabel}>
            <Select
              id="caso-categoria"
              value={categoria}
              onChange={(event) => setCategoria(event.target.value as LostFoundCategory)}
            >
              {LOST_FOUND_CATEGORIES.map((valor) => (
                <option key={valor} value={valor}>
                  {LOST_FOUND_CATEGORY_LABEL[valor]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor="caso-titulo"
            label={C.steps.what.titleLabel}
            help={C.steps.what.titleHelp}
          >
            <Input
              id="caso-titulo"
              value={titulo}
              maxLength={LOST_FOUND_TITLE_MAX}
              placeholder={C.steps.what.titlePlaceholder}
              onChange={(event) => setTitulo(event.target.value)}
            />
          </Field>

          <Field
            htmlFor="caso-descripcion"
            label={C.steps.what.descriptionLabel}
            help={tipo === "found" ? C.steps.what.descriptionHelp : undefined}
          >
            <Textarea
              id="caso-descripcion"
              rows={5}
              value={descripcion}
              maxLength={LOST_FOUND_DESCRIPTION_MAX}
              placeholder={
                tipo === "found"
                  ? C.steps.what.descriptionPlaceholderFound
                  : C.steps.what.descriptionPlaceholderLost
              }
              onChange={(event) => setDescripcion(event.target.value)}
            />
          </Field>
        </section>
      )}

      {paso === 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.steps.where.title}
          </h2>

          <Field htmlFor="caso-zona" label={C.steps.where.areaLabel} help={C.steps.where.areaHelp}>
            <Input
              id="caso-zona"
              value={zona}
              maxLength={LOST_FOUND_AREA_MAX}
              placeholder={C.steps.where.areaPlaceholder}
              onChange={(event) => setZona(event.target.value)}
            />
          </Field>

          <Field
            htmlFor="caso-fecha"
            label={C.steps.where.dateLabel}
            help={C.steps.where.dateHelp}
            optional
          >
            <Input
              id="caso-fecha"
              type="date"
              value={fecha}
              max={hoyISO()}
              onChange={(event) => setFecha(event.target.value)}
            />
          </Field>

          <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground-muted">
            <CalendarBlank size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {COMUNIDAD_COPY.perdidos.privacyNote}
          </p>
        </section>
      )}

      {paso === 2 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {C.steps.photos.title}
          </h2>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {C.steps.photos.hint}
          </p>

          {fotos.length > 0 && (
            <ul className="grid grid-cols-2 gap-3">
              {fotos.map((item, indice) => (
                <li key={item.previewUrl} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL local, jamás pasa por el optimizador */}
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="aspect-[4/3] w-full rounded-md object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => sacarFoto(indice)}
                    aria-label={C.steps.photos.remove}
                    className={cn(
                      "absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-full",
                      // Pastilla opaca sobre la foto en vez de una tinta
                      // `on-media`: el contraste no depende de qué se ve
                      // detrás, y funciona igual sobre una foto clara que
                      // sobre una oscura.
                      "border border-border bg-surface text-foreground shadow-sm",
                      "transition-transform duration-(--duration-fast) active:scale-95",
                      "hover:text-danger",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    )}
                  >
                    <Trash size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {fotos.length < LOST_FOUND_MAX_PHOTOS && (
            <>
              <input
                ref={inputFotos}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => agregarFotos(event.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-full"
                onClick={() => inputFotos.current?.click()}
              >
                {fotos.length === 0 ? (
                  <ImageSquare size={18} aria-hidden="true" />
                ) : (
                  <Plus size={18} aria-hidden="true" />
                )}
                {C.steps.photos.add}
              </Button>
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm leading-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {paso > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="flex-1"
            disabled={enviando}
            onClick={() => {
              setError(null);
              setPaso((actual) => Math.max(0, actual - 1));
            }}
          >
            {C.back}
          </Button>
        )}

        {paso < TOTAL_PASOS - 1 ? (
          <Button type="button" variant="primary" size="md" className="flex-1" onClick={siguiente}>
            {C.next}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            disabled={enviando}
            aria-busy={enviando}
            onClick={publicar}
          >
            {enviando ? C.submitting : C.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

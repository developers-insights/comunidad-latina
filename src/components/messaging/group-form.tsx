"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Lock, Trash, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  Avatar,
  Button,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { bakePhoto } from "@/lib/media/bake-photo";
import {
  CATEGORIAS_DE_GRUPO,
  ETIQUETA_DE_CATEGORIA,
  LIMITES,
  type CategoriaDeGrupo,
  type VisibilidadDeGrupo,
} from "@/lib/messaging/grupos";
import {
  crearGrupoAction,
  editarGrupoAction,
  prepararFotoDeGrupoAction,
} from "@/app/(app)/mensajes/grupos/actions";
import { COPY } from "./copy";

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;
const ACEPTADOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type GrupoEditable = {
  id: string;
  name: string;
  description: string | null;
  category: CategoriaDeGrupo;
  visibility: VisibilidadDeGrupo;
  avatarUrl: string | null;
};

/**
 * CREAR Y EDITAR UN GRUPO. Un solo formulario para las dos cosas: son los
 * mismos cinco campos y partirlo en dos archivos garantiza que uno se olvide
 * de un cambio del otro.
 *
 * ── DE DÓNDE SALE LA FORMA ──────────────────────────────────────────────────
 * El orden —foto arriba, nombre, y una descripción con su texto de ayuda
 * debajo— sale de la pantalla "New group" de WhatsApp
 * (https://mobbin.com/screens/1354cfd3-a325-4d91-bc66-b6aa61b48e67), donde la
 * descripción lleva literalmente el consejo de contar de qué se trata para que
 * la gente sepa si sumarse. Nuestro `descriptionHelp` dice eso mismo con
 * nuestras palabras.
 *
 * La visibilidad va como DOS OPCIONES EXPLICADAS y no como el `>` a una
 * subpantalla que usa la referencia (ahí "Group visibility" abre otra vista).
 * Motivo: en WhatsApp el default —privado, entre conocidos— es obvio; acá la
 * decisión importa (un grupo público lo ve toda la comunidad) y esconderla
 * detrás de un toque es cómo se termina publicando algo que se creía privado.
 *
 * ── LA FOTO ─────────────────────────────────────────────────────────────────
 * Sube DIRECTO al bucket desde el navegador, con el prefijo que entrega el
 * servidor y que la policy `avatars_insert` (0012) vuelve a validar contra el
 * JWT. Sin diálogo de encuadre —a diferencia de la foto de perfil—: acá la
 * foto se ve chica y siempre con `object-cover`, así que un recorte manual
 * sería ceremonia sin efecto. `bakePhoto` igual endereza el EXIF y la achica,
 * que es lo que evita subir 8 MB desde un celular.
 */
export function GroupForm({ grupo }: { grupo?: GrupoEditable }) {
  const router = useRouter();
  const { toast } = useToast();
  const idNombre = useId();
  const idDescripcion = useId();
  const idCategoria = useId();
  const archivoRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(grupo?.name ?? "");
  const [description, setDescription] = useState(grupo?.description ?? "");
  const [category, setCategory] = useState<CategoriaDeGrupo>(
    grupo?.category ?? "deportes",
  );
  const [visibility, setVisibility] = useState<VisibilidadDeGrupo>(
    grupo?.visibility ?? "public",
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(grupo?.avatarUrl ?? null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorNombre, setErrorNombre] = useState<string | undefined>();
  const [enviando, startTransition] = useTransition();

  async function elegirFoto(file: File) {
    if (!ACEPTADOS[file.type]) {
      toast({ title: "Esa no parece una foto. Probá con un JPG, PNG o WebP.", variant: "warning" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "La foto pesa más de 5 MB. Probá con una más liviana.", variant: "warning" });
      return;
    }

    setSubiendo(true);
    try {
      const preparado = await prepararFotoDeGrupoAction();
      if (!preparado.ok) {
        toast({ title: "Tu sesión se cerró — entrá de nuevo para continuar.", variant: "danger" });
        return;
      }

      const normalizada = await bakePhoto(file, { maxLongSide: 720 });
      const ruta = `${preparado.tenantId}/${preparado.userId}/grupo-${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(ruta, normalizada, { contentType: normalizada.type, upsert: false });

      if (error) {
        toast({ title: "No pudimos subir la foto. Revisá tu conexión y probá de nuevo.", variant: "danger" });
        return;
      }

      setAvatarUrl(supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl);
    } catch {
      toast({ title: "No pudimos abrir esa foto. Probá con otro archivo.", variant: "danger" });
    } finally {
      setSubiendo(false);
      if (archivoRef.current) archivoRef.current.value = "";
    }
  }

  function enviar() {
    const limpio = name.trim().replace(/\s+/g, " ");
    if (limpio.length < LIMITES.nombreMin) {
      setErrorNombre(COPY.groups.nameTooShort);
      return;
    }
    if (limpio.length > LIMITES.nombreMax) {
      setErrorNombre(COPY.groups.nameTooLong);
      return;
    }
    setErrorNombre(undefined);

    startTransition(async () => {
      const payload = {
        name: limpio,
        description: description.trim() || undefined,
        category,
        visibility,
        avatarUrl,
      };

      const resultado = grupo
        ? await editarGrupoAction({ groupId: grupo.id, ...payload })
        : await crearGrupoAction(payload);

      if (resultado.ok) {
        toast({ title: grupo ? COPY.groups.saved : COPY.groups.created });
        router.push(`/mensajes/grupos/${resultado.groupId ?? grupo?.id ?? ""}`);
        router.refresh();
        return;
      }

      if (resultado.code === "duplicate") {
        setErrorNombre(COPY.groups.nameTaken);
        return;
      }
      if (resultado.code === "flagged") {
        toast({
          title: COPY.composer.flaggedTitle,
          description: COPY.composer.flaggedBody,
          variant: "warning",
        });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: grupo ? COPY.groups.saveError : COPY.groups.createError,
        variant: "danger",
      });
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        enviar();
      }}
    >
      {/* Foto */}
      <div className="flex items-center gap-4">
        <Avatar src={avatarUrl} name={name || "Grupo"} size="xl" />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{COPY.groups.photoLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={subiendo}
              onClick={() => archivoRef.current?.click()}
            >
              {subiendo ? <Spinner size={16} /> : <Camera size={16} aria-hidden="true" />}
              {avatarUrl ? "Cambiar la foto" : "Elegir una foto"}
            </Button>
            {avatarUrl && !subiendo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAvatarUrl(null)}
              >
                <Trash size={16} aria-hidden="true" />
                Quitar
              </Button>
            )}
          </div>
          <input
            ref={archivoRef}
            type="file"
            accept={Object.keys(ACEPTADOS).join(",")}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void elegirFoto(file);
            }}
          />
        </div>
      </div>

      <Field htmlFor={idNombre} label={COPY.groups.nameLabel} help={COPY.groups.nameHelp} error={errorNombre}>
        <Input
          id={idNombre}
          value={name}
          maxLength={LIMITES.nombreMax}
          placeholder={COPY.groups.namePlaceholder}
          aria-invalid={errorNombre ? true : undefined}
          aria-describedby={errorNombre ? `${idNombre}-error` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        htmlFor={idDescripcion}
        label={COPY.groups.descriptionLabel}
        help={COPY.groups.descriptionHelp}
        optional
      >
        <Textarea
          id={idDescripcion}
          rows={3}
          value={description}
          maxLength={LIMITES.descripcionMax}
          placeholder={COPY.groups.descriptionPlaceholder}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <Field htmlFor={idCategoria} label={COPY.groups.categoryLabel} help={COPY.groups.categoryHelp}>
        <Select
          id={idCategoria}
          value={category}
          onChange={(event) => setCategory(event.target.value as CategoriaDeGrupo)}
        >
          {CATEGORIAS_DE_GRUPO.map((valor) => (
            <option key={valor} value={valor}>
              {ETIQUETA_DE_CATEGORIA[valor]}
            </option>
          ))}
        </Select>
      </Field>

      {/* Visibilidad: las dos opciones a la vista, con su consecuencia escrita. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          {COPY.groups.visibilityLabel}
        </legend>
        <OpcionVisibilidad
          valor="public"
          actual={visibility}
          onSelect={setVisibility}
          icono={<UsersThree size={20} aria-hidden="true" />}
          titulo={COPY.groups.visibilityPublic}
          detalle={COPY.groups.visibilityPublicHelp}
        />
        <OpcionVisibilidad
          valor="private"
          actual={visibility}
          onSelect={setVisibility}
          icono={<Lock size={20} aria-hidden="true" />}
          titulo={COPY.groups.visibilityPrivate}
          detalle={COPY.groups.visibilityPrivateHelp}
        />
      </fieldset>

      <Button type="submit" variant="primary" size="lg" loading={enviando} className="w-full">
        {enviando
          ? grupo
            ? COPY.groups.save
            : COPY.groups.submitting
          : grupo
            ? COPY.groups.save
            : COPY.groups.submit}
      </Button>
    </form>
  );
}

function OpcionVisibilidad({
  valor,
  actual,
  onSelect,
  icono,
  titulo,
  detalle,
}: {
  valor: VisibilidadDeGrupo;
  actual: VisibilidadDeGrupo;
  onSelect: (valor: VisibilidadDeGrupo) => void;
  icono: React.ReactNode;
  titulo: string;
  detalle: string;
}) {
  const activo = actual === valor;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
        activo
          ? "border-brand-strong bg-brand-tint"
          : "border-border-subtle bg-surface hover:border-border-strong",
      )}
    >
      <input
        type="radio"
        name="visibility"
        value={valor}
        checked={activo}
        onChange={() => onSelect(valor)}
        className="sr-only"
      />
      <span className={cn("mt-0.5 shrink-0", activo ? "text-brand-ink" : "text-foreground-muted")}>
        {icono}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", activo ? "text-brand-ink" : "text-foreground")}>
          {titulo}
        </span>
        <span className="block text-xs text-foreground-secondary">{detalle}</span>
      </span>
    </label>
  );
}

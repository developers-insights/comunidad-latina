"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTipar } from "@/lib/resenas";
import { listingPhotoUrl } from "@/components/listings/helpers";
import { INTEGRITY_REASONS, registerUploadedMedia } from "@/lib/integrity";
import { currentSourceHost } from "@/lib/integrity/source-host";
import { isBusinessCategory } from "@/app/(app)/negocios/categories";
import {
  FOTO_FORMATOS_ACEPTADOS,
  FOTO_MIME_ACEPTADOS,
  LOGO_SALIDA,
  MAX_FOTO_BYTES,
  MAX_LARGO_CONTACTO,
  MAX_LARGO_DESCRIPCION,
  MAX_LARGO_TITULO,
  MAX_LARGO_ZONA,
  MAX_SERVICIOS,
  MAX_LARGO_SERVICIO,
  MIN_LARGO_TITULO,
  PORTADA_SALIDA,
  esPathDeEsteNegocio,
  normalizarServicios,
  pathDeFotoDeNegocio,
  problemaDeDimensiones,
  problemaDeServicios,
  type TipoDeFotoDeNegocio,
} from "@/lib/negocios/pagina";
import { EDITAR_NEGOCIO_COPY as C } from "./copy";
import type { EditarPaginaState, FotoDeNegocioResultado } from "./estado";

/**
 * =============================================================================
 * EDITAR LA PÁGINA DE UN NEGOCIO — server actions (migración 0127)
 * =============================================================================
 *
 * Call del 3/9 (punto 2 y 14 del feedback): «ahí no te dejó subir una foto» y
 * «falta poder editar la información de la otra cuenta y agregar los servicios
 * que da cada perfil».
 *
 * ── NINGUNA DE ESTAS ACTIONS AUTORIZA NADA ──────────────────────────────────
 * Las dos escrituras terminan en una RPC `security definer` que vuelve a
 * verificar tenant, kind y `app.can_manage_listing` (0093) adentro de la base.
 * Acá se valida la FORMA —para poder explicar el rechazo en español en vez de
 * mostrar un 23514— y se hace el trabajo que la base no puede hacer: mirar los
 * bytes de una imagen. El chequeo de permiso que sí ocurre acá
 * (`puedo_administrar_aviso`) existe para no gastar una subida al bucket que la
 * RPC iba a rechazar después, no como barrera de seguridad.
 *
 * ── POR QUÉ LA FOTO VIAJA POR LA ACTION Y NO DIRECTO AL BUCKET ──────────────
 * El resto del repo sube las imágenes desde el navegador directo a Storage
 * (composer, /publicar, avatar). Acá NO, por dos motivos concretos:
 *
 *  1. LA VALIDACIÓN QUE PIDE ESTA FUNCIÓN ES SOBRE LOS BYTES. Tipo real (no el
 *     `Content-Type` que declara el navegador), peso y DIMENSIONES. Un logo de
 *     80 px o un PNG renombrado a .webp sólo se detectan decodificando, y eso
 *     el cliente no lo puede afirmar por nosotros. De paso, al re-codificar con
 *     `sharp` se cae el EXIF —incluidas las coordenadas GPS que traen las fotos
 *     de celular—, que en una app con §5.4 de geolocalización aproximada no es
 *     un detalle menor.
 *
 *  2. LA POLICY DE STORAGE NO ALCANZA PARA EL EQUIPO. `listing_photos_insert`
 *     (0012) exige `listings.created_by = auth.uid()`: el administrador de un
 *     negocio —que SÍ puede editar la página según `can_manage_listing`— no
 *     puede subir con su propia sesión. Extender esa policy no es una opción
 *     desde una migración: `storage.objects` pertenece a
 *     `supabase_storage_admin` y en este proyecto el rol de migraciones no
 *     puede tocarla (está documentado en `supabase/manual/harden-storage-
 *     listing.sql`). Prometer en la 0127 una policy que no se puede aplicar
 *     sería peor que esto. Entonces sube el SERVIDOR, con el service role,
 *     después de verificar el permiso.
 *
 * El archivo entra por el body de la action, que tiene 11 MB de tope
 * (`next.config.ts`) contra los 5 MB que aceptamos: hay aire de sobra.
 *
 * ── LA FOTO SE GUARDA SOLA, EL TEXTO ESPERA A "GUARDAR CAMBIOS" ─────────────
 * Elegir una foto y verla aparecer es un acto completo en sí mismo: el cliente
 * probó justamente esto y lo que vio fue un botón que no hacía nada. Que la
 * subida quede pendiente de un submit posterior habría repetido la misma
 * sensación. Quitar tiene su propio botón, así que nada queda atrapado.
 */

const GENERICO = C.errores.generico;

// ---------------------------------------------------------------------------
// 1 · Guardar la información de la página
// ---------------------------------------------------------------------------

const guardarSchema = z.object({
  listingId: z.uuid(),
  title: z.string().trim().min(MIN_LARGO_TITULO).max(MAX_LARGO_TITULO),
  description: z.string().trim().max(MAX_LARGO_DESCRIPCION),
  category: z.string().trim().max(40),
  areaLabel: z.string().trim().max(MAX_LARGO_ZONA),
  phone: z.string().trim().max(MAX_LARGO_CONTACTO),
  whatsapp: z.string().trim().max(MAX_LARGO_CONTACTO),
  website: z.string().trim().max(MAX_LARGO_CONTACTO),
  address: z.string().trim().max(MAX_LARGO_CONTACTO),
  /**
   * Los servicios viajan como JSON en un campo oculto: la cantidad es dinámica
   * (se agregan y se quitan sin recargar), así que la lista ya necesita
   * JavaScript. Mismo criterio que el editor de horarios — el JSON es
   * transporte, no confianza: del otro lado hay un zod y, después, el CHECK.
   */
  services: z
    .string()
    .max(2000)
    .transform((crudo, ctx) => {
      try {
        return JSON.parse(crudo) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "json_invalido" });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.string()).max(60)),
});

/** El primer problema de forma, traducido al campo que lo tiene. */
function mensajeDeCampo(campo: string): { mensaje: string; campo: string } {
  switch (campo) {
    case "title":
      return { mensaje: C.errores.nombreCorto, campo };
    case "description":
      return { mensaje: C.errores.descripcionLarga, campo };
    case "areaLabel":
      return { mensaje: C.errores.zonaLarga, campo };
    case "phone":
    case "whatsapp":
    case "website":
    case "address":
      return { mensaje: C.errores.contactoLargo, campo };
    default:
      return { mensaje: GENERICO, campo: "form" };
  }
}

export async function guardarPaginaDeNegocioAction(
  _prevState: EditarPaginaState,
  formData: FormData,
): Promise<EditarPaginaState> {
  const parsed = guardarSchema.safeParse({
    listingId: formData.get("listingId"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    category: formData.get("category") ?? "",
    areaLabel: formData.get("areaLabel") ?? "",
    phone: formData.get("phone") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    website: formData.get("website") ?? "",
    address: formData.get("address") ?? "",
    services: formData.get("services") ?? "[]",
  });

  if (!parsed.success) {
    const primero = String(parsed.error.issues[0]?.path[0] ?? "form");
    // El nombre tiene dos formas de fallar y no dan el mismo consejo.
    if (primero === "title") {
      const largo = String(formData.get("title") ?? "").trim().length;
      return {
        estado: "error",
        campo: "title",
        mensaje: largo > MAX_LARGO_TITULO ? C.errores.nombreLargo : C.errores.nombreCorto,
      };
    }
    const { mensaje, campo } = mensajeDeCampo(primero);
    return { estado: "error", mensaje, campo };
  }

  const datos = parsed.data;
  const servicios = normalizarServicios(datos.services);
  const problema = problemaDeServicios(servicios);
  if (problema === "demasiados") {
    return {
      estado: "error",
      campo: "services",
      mensaje: C.errores.serviciosMuchos(MAX_SERVICIOS),
    };
  }
  if (problema === "muy_largo") {
    return {
      estado: "error",
      campo: "services",
      mensaje: C.errores.serviciosLargos(MAX_LARGO_SERVICIO),
    };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      estado: "error",
      mensaje: guard.reason === "unauthenticated" ? C.errores.sesion : guard.message,
    };
  }
  const { supabase, user } = guard;

  if (!limit(`negocio-editar:${user.id}`, 30, HOUR_MS).ok) {
    return { estado: "error", mensaje: GENERICO };
  }

  // El rubro se acota al set curado de la UI. `attrs.category` es texto libre
  // en la base, así que si no se filtrara acá esta action sería la puerta para
  // escribir cualquier cosa en el atributo que después filtra el directorio.
  const category = isBusinessCategory(datos.category) ? datos.category : "";

  const { data, error } = await supabaseSinTipar(supabase).rpc(
    "guardar_pagina_de_negocio",
    {
      p_listing_id: datos.listingId,
      p_title: datos.title,
      p_description: datos.description || null,
      p_category: category || null,
      p_area_label: datos.areaLabel || null,
      p_services: servicios,
      p_phone: datos.phone || null,
      p_whatsapp: datos.whatsapp || null,
      p_website: datos.website || null,
      p_address: datos.address || null,
    },
  );

  if (error) {
    console.warn("[negocios] no se pudo guardar la página", {
      listingId: datos.listingId,
      code: error.code,
    });
    return { estado: "error", mensaje: GENERICO };
  }

  switch (data) {
    case "ok":
      break;
    case "sin_sesion":
      return { estado: "error", mensaje: C.errores.sesion };
    case "sin_permiso":
      return { estado: "error", mensaje: C.errores.permiso };
    case "contacto_premium":
      return { estado: "error", campo: "phone", mensaje: C.errores.contactoPremium };
    default:
      return { estado: "error", mensaje: GENERICO };
  }

  revalidarPaginasDelNegocio(datos.listingId);
  return { estado: "ok", mensaje: C.ok };
}

// ---------------------------------------------------------------------------
// 2 · Subir el logo o la portada
// ---------------------------------------------------------------------------

const subirSchema = z.object({
  listingId: z.uuid(),
  tipo: z.enum(["logo", "portada"]),
});

export async function subirFotoDeNegocioAction(
  formData: FormData,
): Promise<FotoDeNegocioResultado> {
  const parsed = subirSchema.safeParse({
    listingId: formData.get("listingId"),
    tipo: formData.get("tipo"),
  });
  if (!parsed.success) return { ok: false, mensaje: C.erroresFoto.generico };
  const { listingId, tipo } = parsed.data;

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, mensaje: C.erroresFoto.vacia };
  }
  if (archivo.size > MAX_FOTO_BYTES) {
    return { ok: false, mensaje: C.erroresFoto.peso };
  }
  // Primera barrera, la barata: lo que el navegador DECLARA. La de verdad es
  // la de más abajo, sobre los bytes.
  if (!FOTO_MIME_ACEPTADOS.includes(archivo.type as (typeof FOTO_MIME_ACEPTADOS)[number])) {
    return { ok: false, mensaje: C.erroresFoto.tipo };
  }

  // El guard va ANTES de cualquier efecto colateral (regla de `requireTenantMatch`).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      mensaje: guard.reason === "unauthenticated" ? C.errores.sesion : guard.message,
    };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`negocio-foto:${user.id}`, 20, HOUR_MS).ok) {
    return { ok: false, mensaje: C.erroresFoto.demasiadas };
  }

  const permiso = await puedeAdministrar(supabase, listingId);
  if (!permiso) return { ok: false, mensaje: C.errores.permiso };

  // ---- Los bytes, decodificados de verdad --------------------------------
  const normalizada = await normalizarImagen(archivo, tipo);
  if (!normalizada.ok) return { ok: false, mensaje: normalizada.mensaje };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error("[negocios] sin cliente admin: no se puede subir la foto del negocio");
    return { ok: false, mensaje: C.erroresFoto.generico };
  }

  const actuales = await fotosActuales(supabase, listingId);
  const path = pathDeFotoDeNegocio(tipo, tenant.id, listingId, crypto.randomUUID());

  const { error: subidaError } = await admin.storage
    .from("listing-photos")
    .upload(path, normalizada.buffer, { contentType: "image/webp", upsert: false });

  if (subidaError) {
    console.warn("[negocios] falló la subida de la foto del negocio", {
      listingId,
      tipo,
      message: subidaError.message,
    });
    return { ok: false, mensaje: C.erroresFoto.subida };
  }

  // ---- Content Integrity: la misma pasada que las fotos de los avisos ------
  // La declaración va VACÍA a propósito: nadie afirmó nada sobre esta imagen y
  // este módulo no pone afirmaciones en boca de quien no las hizo. Lo que sí
  // se hace con el resultado es lo único que corresponde para la CARA de una
  // identidad: si el escaneo encontró la misma imagen (o una casi igual) ya
  // publicada por otra cuenta, la subida se deshace. Que la huella no se haya
  // podido calcular no bloquea nada — el avatar de una persona hoy ni siquiera
  // se registra, así que esto ya es más de lo que había.
  const integridad = await registerUploadedMedia({
    tenantId: tenant.id,
    uploaderId: user.id,
    subjectKind: "listing",
    subjectId: listingId,
    sourceHost: await currentSourceHost(tenant.slug),
    items: [{ mediaKind: "imagen", storageBucket: "listing-photos", storagePath: path }],
  });

  const repetida = integridad.reasons.some(
    (motivo) =>
      motivo === INTEGRITY_REASONS.duplicate || motivo === INTEGRITY_REASONS.similar,
  );
  if (repetida) {
    await borrarDelBucket(admin, [path]);
    return { ok: false, mensaje: C.erroresFoto.repetida };
  }

  const logo = tipo === "logo" ? path : actuales.logoPath;
  const cover = tipo === "portada" ? path : actuales.coverPath;

  const guardado = await guardarFotos(supabase, listingId, logo, cover);
  if (!guardado) {
    // El objeto ya está en el bucket y la fila no lo apunta: se borra, si no
    // queda basura pagando storage que nadie va a poder ver ni borrar después.
    await borrarDelBucket(admin, [path]);
    return { ok: false, mensaje: C.erroresFoto.generico };
  }

  // La anterior deja de existir recién cuando la nueva ya quedó guardada.
  const anterior = tipo === "logo" ? actuales.logoPath : actuales.coverPath;
  if (anterior && anterior !== path && esPathDeEsteNegocio(anterior, tenant.id, listingId)) {
    await borrarDelBucket(admin, [anterior]);
  }

  revalidarPaginasDelNegocio(listingId);
  return { ok: true, tipo, url: listingPhotoUrl(path) };
}

// ---------------------------------------------------------------------------
// 3 · Quitar una de las dos fotos
// ---------------------------------------------------------------------------

export async function quitarFotoDeNegocioAction(
  input: unknown,
): Promise<FotoDeNegocioResultado> {
  const parsed = subirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, mensaje: C.erroresFoto.generico };
  const { listingId, tipo } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      mensaje: guard.reason === "unauthenticated" ? C.errores.sesion : guard.message,
    };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`negocio-foto:${user.id}`, 20, HOUR_MS).ok) {
    return { ok: false, mensaje: C.erroresFoto.demasiadas };
  }

  const actuales = await fotosActuales(supabase, listingId);
  const guardado = await guardarFotos(
    supabase,
    listingId,
    tipo === "logo" ? null : actuales.logoPath,
    tipo === "portada" ? null : actuales.coverPath,
  );
  if (!guardado) return { ok: false, mensaje: C.erroresFoto.generico };

  const quitada = tipo === "logo" ? actuales.logoPath : actuales.coverPath;
  if (quitada && esPathDeEsteNegocio(quitada, tenant.id, listingId)) {
    try {
      await borrarDelBucket(createAdminClient(), [quitada]);
    } catch {
      // Que el archivo quede huérfano en el bucket no puede hacer fallar el
      // "quitar": la fila ya no lo apunta y eso es lo que se ve.
    }
  }

  revalidarPaginasDelNegocio(listingId);
  return { ok: true, tipo, url: null };
}

// ---------------------------------------------------------------------------
// Ayudantes — todos async porque este módulo es "use server".
// ---------------------------------------------------------------------------

/**
 * ¿Puede esta persona administrar el aviso? Es la MISMA RPC que decide quién ve
 * el editor de horarios (0093). No es la barrera —esa está en la RPC de
 * escritura—: evita gastar una subida al bucket que iba a rebotar.
 */
async function puedeAdministrar(supabase: unknown, listingId: string): Promise<boolean> {
  try {
    const { data } = await supabaseSinTipar(supabase).rpc("puedo_administrar_aviso", {
      p_listing: listingId,
    });
    return data === true;
  } catch {
    return false;
  }
}

async function fotosActuales(
  supabase: unknown,
  listingId: string,
): Promise<{ logoPath: string | null; coverPath: string | null }> {
  try {
    const { data } = await supabaseSinTipar(supabase)
      .from("listings")
      .select("logo_path, cover_path")
      .eq("id", listingId)
      .maybeSingle();
    const fila = (data ?? {}) as { logo_path?: string | null; cover_path?: string | null };
    return { logoPath: fila.logo_path ?? null, coverPath: fila.cover_path ?? null };
  } catch {
    return { logoPath: null, coverPath: null };
  }
}

/** Escribe las dos columnas por la RPC de la 0127, que revalida el permiso. */
async function guardarFotos(
  supabase: unknown,
  listingId: string,
  logo: string | null,
  cover: string | null,
): Promise<boolean> {
  const { data, error } = await supabaseSinTipar(supabase).rpc(
    "guardar_fotos_de_negocio",
    { p_listing_id: listingId, p_logo: logo, p_cover: cover },
  );
  if (error) {
    console.warn("[negocios] no se pudieron guardar las fotos del negocio", {
      listingId,
      code: error.code,
    });
    return false;
  }
  return data === "ok";
}

async function borrarDelBucket(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[],
): Promise<void> {
  try {
    await admin.storage.from("listing-photos").remove(paths);
  } catch {
    // Best-effort: un archivo huérfano no puede tumbar la operación.
  }
}

type ImagenNormalizada =
  | { ok: true; buffer: Buffer }
  | { ok: false; mensaje: string };

/**
 * Decodifica, valida las dimensiones REALES y re-codifica a WebP del tamaño
 * final. `sharp` ya está en el repo (lo usa el pipeline de integridad) y se
 * importa dinámico por el mismo motivo que ahí: es un binario nativo.
 *
 * Si no está, la subida se RECHAZA en vez de degradar. Es la diferencia con
 * `lib/integrity/image.ts`, que degrada a "que lo mire un humano": acá sharp no
 * es un análisis extra, es lo único que separa una foto de un archivo
 * arbitrario con nombre de foto.
 */
async function normalizarImagen(
  archivo: File,
  tipo: TipoDeFotoDeNegocio,
): Promise<ImagenNormalizada> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    console.error("[negocios] sharp no disponible: no se puede validar la foto", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return { ok: false, mensaje: C.erroresFoto.generico };
  }

  try {
    const entrada = Buffer.from(await archivo.arrayBuffer());
    const imagen = sharp(entrada, { failOn: "error" });
    const meta = await imagen.metadata();

    const formato = meta.format ?? "";
    if (!FOTO_FORMATOS_ACEPTADOS.includes(formato as (typeof FOTO_FORMATOS_ACEPTADOS)[number])) {
      return { ok: false, mensaje: C.erroresFoto.tipo };
    }

    // Con EXIF de orientación 6/8 la foto viene "acostada": las dimensiones
    // que valen son las de después de rotar, que es como se va a ver.
    const rotada = meta.orientation !== undefined && meta.orientation >= 5;
    const ancho = (rotada ? meta.height : meta.width) ?? 0;
    const alto = (rotada ? meta.width : meta.height) ?? 0;

    const problema = problemaDeDimensiones(tipo, ancho, alto);
    if (problema === "chica") {
      return {
        ok: false,
        mensaje: tipo === "logo" ? C.erroresFoto.chicaLogo : C.erroresFoto.chicaPortada,
      };
    }
    if (problema === "enorme") return { ok: false, mensaje: C.erroresFoto.enorme };
    if (problema) return { ok: false, mensaje: C.erroresFoto.ilegible };

    const salida = tipo === "logo" ? LOGO_SALIDA : PORTADA_SALIDA;
    const buffer = await imagen
      // `rotate()` sin argumentos aplica el EXIF y después lo descarta: la foto
      // queda derecha y sin metadatos (incluidas las coordenadas GPS del
      // celular, que §5.4 no quiere ni cerca de una columna pública).
      .rotate()
      .resize(salida.ancho, salida.alto, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();

    return { ok: true, buffer };
  } catch (error) {
    console.warn("[negocios] no se pudo decodificar la foto del negocio", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return { ok: false, mensaje: C.erroresFoto.ilegible };
  }
}

/**
 * Las tres superficies donde se ve lo que se acaba de cambiar: la página del
 * negocio, el directorio (tarjetas con foto y rubro) y el perfil-como-negocio.
 */
function revalidarPaginasDelNegocio(listingId: string): void {
  revalidatePath(`/negocios/${listingId}`);
  revalidatePath("/negocios");
  revalidatePath("/perfil");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVisionConfigured } from "@/lib/config/services";
import { listingViewHref } from "@/lib/monetization/href";
import { TIER_AUTO, TIER_HUMAN, moderateText, moderationTier } from "@/lib/moderation";
import { registerUploadedMedia } from "@/lib/integrity";
import { retireAssetFromSubject } from "@/lib/integrity/retire";
import { currentSourceHost } from "@/lib/integrity/source-host";
import { supabaseSinTiparListings } from "@/lib/listings";
import { fetchVideoDeAviso, type VideoGuardado } from "@/lib/media/listing-video-queries";
import {
  SIN_VIDEO,
  columnasDeVideo,
  errorDeVideoDeLaBase,
  listingVideoInputSchema,
  validarVideoDeAviso,
  type ListingVideoColumns,
  type ListingVideoInput,
} from "@/lib/media/listing-video-server";
import {
  EDICION_COPY,
  EDICION_LIMITES,
  PAUSA_DEL_DUENO,
  editaEnPaginaPropia,
  fotosNuevas,
  fotosQuitadas,
  hayCambios,
  pausadoPorReportes,
  puedeEditarse,
  puedePausarse,
  puedeReactivarse,
  statusDespuesDeEditar,
} from "@/lib/listings/edicion";
import { republicarAvisoEditado, vuelveAPublicarse } from "@/lib/listings/republicar";
import { encolarSiQuedaEnRevision } from "@/lib/listings/cola";

/**
 * =============================================================================
 * EDITAR UN AVISO — server actions
 * =============================================================================
 *
 * Tres funciones y una sola idea: el aviso que se toca es SIEMPRE el de quien
 * llama. Lo garantiza la RLS (`listings_update` exige tenant + created_by), no
 * estas funciones; el `.eq()` que viaja en cada query está para poder distinguir
 * "no es tuyo" de "no existe" en el mensaje, y para no gastar una escritura que
 * la base iba a rechazar. Que el menú no muestre el botón no es seguridad: el
 * camino de PostgREST con un token propio se topa exactamente con lo mismo.
 *
 * ── LO QUE ESTAS ACTIONS *NO* PUEDEN HACER, POR CONTRATO ────────────────────
 * Dejar un aviso en `published`. El WITH CHECK de `listings_update` sólo admite
 * draft / pending_review / paused / removed / closed para el dueño (0004, última
 * versión 0075). No es una preferencia de este archivo: un UPDATE que intente
 * `status = 'published'` con el JWT de la persona rebota con 42501. Por eso el
 * UPDATE de editar deja `pending_review`, y la vuelta a `published` (si
 * corresponde) la hace `republicarAvisoEditado` con el admin client.
 *
 * ── Y POR QUÉ ESO ES, ADEMÁS, LO SEGURO ────────────────────────────────────
 * Es lo que cierra el agujero de las fotos. Una foto agregada al editar pasa por
 * el mismo `registerUploadedMedia` + la misma puerta de Vision + la misma cola
 * que en el alta, y —esto es lo estructural— NO LLEGA A VERSE mientras eso
 * ocurre, porque la fila quedó en `pending_review`. No hay ventana en la que una
 * imagen editada esté publicada y sin revisar.
 *
 * ── `.update().select()` Y EL 42501 QUE NO ES DEL UPDATE ────────────────────
 * Pedir la fila de vuelta es OTRA policy. Acá está cubierto: `listings_select`
 * le deja al dueño leer sus propias filas en cualquier status
 * (`tenant_id = current_tenant AND created_by = uid`), así que el `.select("id")`
 * de abajo no puede rebotar por sí solo. Si algún día esa policy se angosta, lo
 * que hay que sacar es el `.select()`, no aflojar el UPDATE.
 */

const GENERICO = EDICION_COPY.errores.generico;

/** Los mismos tres estados que ofrece el menú (`puedeEditarse`). */
const EDITABLES_EN_QUERY = ["published", "paused", "pending_review"] as const;

/** Columnas que necesitan la carga y la escritura. Una sola definición. */
const COLUMNAS = "id, kind, status, title, description, price_amount, photos, attrs";

type FilaDeAviso = {
  id: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  price_amount: number | string | null;
  photos: string[] | null;
  attrs: unknown;
};

function attrsDe(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? { ...(valor as Record<string, unknown>) }
    : {};
}

function fotosDe(valor: string[] | null): string[] {
  return (valor ?? []).filter((path) => typeof path === "string" && path.trim() !== "");
}

function precioDe(valor: number | string | null): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Paths canónicos `{tenant_id}/{listing_id}/{archivo}`. Es el MISMO patrón que
 * exige `finalizeProduct`, y refleja la policy `listing_photos_insert` del
 * bucket: sin esto, una ruta armada a mano apuntaría a la carpeta de otro aviso
 * y la fila terminaría mostrando una foto que su dueño no subió.
 */
function pathsValidos(paths: string[], tenantId: string, listingId: string): boolean {
  const patron = new RegExp(
    `^${tenantId}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  return paths.every((path) => patron.test(path) && !path.includes(".."));
}

/** Auto-aprobación de DEV. Estructuralmente imposible en producción. */
function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

/** Las tres superficies donde se ve lo que acaba de cambiar. */
function revalidar(kind: string, listingId: string): void {
  revalidatePath("/publicaciones");
  revalidatePath(listingViewHref(kind, listingId));
}

// ===========================================================================
// 1 · Traer los valores actuales para sembrar la hoja
// ===========================================================================

const cargarSchema = z.object({ listingId: z.uuid() });

export interface AvisoEditable {
  id: string;
  kind: string;
  status: string;
  title: string;
  description: string;
  priceAmount: number | null;
  /** Paths de storage crudos — la hoja los manda de vuelta tal cual. */
  photos: string[];
  /** La comunidad de quien llama: la hoja arma con esto el path de subida. */
  tenantId: string;
  /** Pausado por denuncias: la hoja lo dice y no ofrece guardar. */
  bloqueadoPorModeracion: boolean;
  /** `videoDisponible` en false = la 0160 todavía no está aplicada: la hoja no ofrece video. */
  tier: string | null;
  video: VideoGuardado | null;
  videoDisponible: boolean;
}

export type CargarAvisoResult =
  | { ok: true; aviso: AvisoEditable }
  | { ok: false; error: string; needsAuth?: boolean };

export async function cargarAvisoParaEditar(rawInput: {
  listingId: string;
}): Promise<CargarAvisoResult> {
  const parsed = cargarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: GENERICO };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: EDICION_COPY.errores.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const { data, error } = await supabaseSinTiparListings(supabase)
    .from("listings")
    .select(COLUMNAS)
    .eq("id", parsed.data.listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: EDICION_COPY.errores.noEsTuya };
  }
  const fila = data as FilaDeAviso;
  const extra = await fetchVideoDeAviso(supabase, fila.id);

  return {
    ok: true,
    aviso: {
      tier: extra?.tier ?? null,
      video: extra?.video ?? null,
      videoDisponible: extra !== null,
      id: fila.id,
      kind: fila.kind,
      status: fila.status,
      title: fila.title ?? "",
      description: fila.description ?? "",
      priceAmount: precioDe(fila.price_amount),
      photos: fotosDe(fila.photos),
      tenantId: tenant.id,
      bloqueadoPorModeracion: pausadoPorReportes(fila.status, fila.attrs),
    },
  };
}

// ===========================================================================
// 2 · Guardar los cambios
// ===========================================================================

const editarSchema = z.object({
  listingId: z.uuid(),
  title: z.string().trim().min(EDICION_LIMITES.tituloMin).max(EDICION_LIMITES.tituloMax),
  description: z.string().trim().max(EDICION_LIMITES.descripcionMax),
  priceAmount: z.number().min(0).max(EDICION_LIMITES.precioMax).nullable(),
  photoPaths: z.array(z.string().min(1).max(300)).max(EDICION_LIMITES.fotosMax),
  /** Ausente = no se tocó; `null` = se quitó. */
  video: listingVideoInputSchema,
});

export type EditarAvisoResult =
  | { ok: true; status: "published" | "pending_review" | "paused"; sinCambios?: false }
  | { ok: true; status: string; sinCambios: true }
  | { ok: false; error: string; needsAuth?: boolean };

export async function editarAvisoAction(rawInput: {
  listingId: string;
  title: string;
  description: string;
  priceAmount: number | null;
  photoPaths: string[];
  video?: ListingVideoInput | null;
}): Promise<EditarAvisoResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = editarSchema.safeParse(rawInput);
  if (!parsed.success) {
    const campo = String(parsed.error.issues[0]?.path[0] ?? "");
    if (campo === "title") {
      const largo = rawInput.title?.trim().length ?? 0;
      return {
        ok: false,
        error:
          largo > EDICION_LIMITES.tituloMax
            ? EDICION_COPY.errores.tituloLargo(EDICION_LIMITES.tituloMax)
            : EDICION_COPY.errores.tituloCorto(EDICION_LIMITES.tituloMin),
      };
    }
    if (campo === "description") {
      return {
        ok: false,
        error: EDICION_COPY.errores.descripcionLarga(EDICION_LIMITES.descripcionMax),
      };
    }
    if (campo === "priceAmount") {
      return { ok: false, error: EDICION_COPY.errores.precioAlto };
    }
    if (campo === "photoPaths") {
      return { ok: false, error: EDICION_COPY.errores.fotosMuchas(EDICION_LIMITES.fotosMax) };
    }
    return { ok: false, error: GENERICO };
  }
  const entrada = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: EDICION_COPY.errores.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Editar es barato y legítimo, pero no infinito: sin cuota sería el motor de
  // un bucle de escritura sobre `listings` y de re-encolado de moderación.
  if (!limit(`editar-aviso:${user.id}`, 40, DAY_MS).ok) {
    return { ok: false, error: EDICION_COPY.errores.demasiado };
  }

  const sinTipar = supabaseSinTiparListings(supabase);

  const { data, error: readError } = await sinTipar
    .from("listings")
    .select(COLUMNAS)
    .eq("id", entrada.listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (readError || !data) {
    return { ok: false, error: EDICION_COPY.errores.noEsTuya };
  }
  const fila = data as FilaDeAviso;

  // Un negocio tiene su propia página de edición (rubro, servicios, horarios,
  // logo, portada) y su propia RPC. Aceptarlo acá guardaría la mitad de lo que
  // esa pantalla muestra y pisaría el resto sin avisar.
  if (editaEnPaginaPropia(fila.kind)) {
    return { ok: false, error: EDICION_COPY.errores.noSeEdita };
  }

  const porReportes = pausadoPorReportes(fila.status, fila.attrs);
  if (!puedeEditarse(fila.status, porReportes)) {
    return { ok: false, error: EDICION_COPY.errores.noSeEdita };
  }

  if (!pathsValidos(entrada.photoPaths, tenant.id, entrada.listingId)) {
    return { ok: false, error: EDICION_COPY.errores.fotoRuta };
  }

  const fotosActuales = fotosDe(fila.photos);
  const valoresActuales = {
    title: fila.title ?? "",
    description: fila.description ?? "",
    priceAmount: precioDe(fila.price_amount),
    photos: fotosActuales,
  };
  const valoresNuevos = {
    title: entrada.title,
    description: entrada.description,
    priceAmount: entrada.priceAmount,
    photos: entrada.photoPaths,
  };

  // Guardar "lo mismo" mandaría un aviso publicado a la cola de revisión a
  // cambio de nada: se corta acá y se dice que no había nada que guardar.
  let videoColumns: ListingVideoColumns | null = null;
  if (entrada.video !== undefined) {
    const actual = await fetchVideoDeAviso(supabase, entrada.listingId);
    const pathActual = actual?.video?.path ?? null;
    if ((entrada.video?.path ?? null) !== pathActual) {
      if (entrada.video === null) {
        videoColumns = SIN_VIDEO;
      } else {
        const videoCheck = await validarVideoDeAviso({
          input: entrada.video,
          tenantId: tenant.id,
          userId: user.id,
          tier: actual?.tier,
        });
        if (!videoCheck.ok) return { ok: false, error: videoCheck.error };
        videoColumns = videoCheck.columns;
      }
    }
  }
  const videoNuevo = videoColumns !== null && videoColumns.video_path !== null;

  if (!hayCambios(valoresActuales, valoresNuevos) && videoColumns === null) {
    return { ok: true, status: fila.status, sinCambios: true };
  }

  const nuevas = fotosNuevas(fotosActuales, entrada.photoPaths);
  const quitadas = fotosQuitadas(fotosActuales, entrada.photoPaths);

  // ---- Moderación de texto, igual que en el alta ---------------------------
  const moderation = await moderateText(`${entrada.title}\n${entrada.description}`);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Content Integrity: SÓLO las fotos que entran ------------------------
  // Volver a huellar las que ya estaban duplicaría filas de procedencia y las
  // marcaría como duplicado de sí mismas.
  const integrity =
    nuevas.length > 0
      ? await registerUploadedMedia({
          tenantId: tenant.id,
          uploaderId: user.id,
          subjectKind: "listing",
          subjectId: entrada.listingId,
          sourceHost: await currentSourceHost(tenant.slug),
          items: nuevas.map((path) => ({
            mediaKind: "imagen" as const,
            storageBucket: "listing-photos",
            storagePath: path,
          })),
        })
      : { needsHumanReview: false, reasons: [] as string[], assetIds: [] as string[] };

  // Sin Vision, una imagen JAMÁS se publica sola (§5.6) — misma regla del alta.
  const autoApprove = devAutoApprove();
  const photoNeedsReview = nuevas.length > 0 && !isVisionConfigured && !autoApprove;
  const videoNeedsReview = videoNuevo && !autoApprove;

  const nuevoStatus = statusDespuesDeEditar(fila.status);

  const { data: updated, error: updateError } = await sinTipar
    .from("listings")
    .update({
      title: entrada.title,
      description: entrada.description || null,
      price_amount: entrada.priceAmount,
      photos: entrada.photoPaths,
      status: nuevoStatus,
      ...columnasDeVideo(videoColumns),
    })
    .eq("id", entrada.listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    // El candado: entre la lectura y esta escritura, moderación pudo haber
    // movido el aviso a 'removed'. Sin este filtro, editar lo resucitaría a
    // pending_review — la policy del dueño SÍ permite esa transición.
    .in("status", [...EDITABLES_EN_QUERY])
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[publicaciones] no se pudo guardar la edición", {
      listingId: entrada.listingId,
      code: updateError?.code,
    });
    return { ok: false, error: errorDeVideoDeLaBase(updateError) ?? GENERICO };
  }

  // Las que salieron quedan ANOTADAS, no borradas: el libro de procedencia es
  // evidencia y sobrevive a que el contenido deje de mostrarse (0097).
  for (const path of quitadas) {
    await retireAssetFromSubject({
      tenantId: tenant.id,
      subjectKind: "listing",
      subjectId: entrada.listingId,
      storagePath: path,
    });
  }

  let statusFinal: "published" | "pending_review" | "paused" = nuevoStatus;
  const republicar = vuelveAPublicarse({
    statusPrevio: fila.status,
    textoMarcado: moderation.flagged,
    tier,
    mediaPendiente: photoNeedsReview || videoNeedsReview || integrity.needsHumanReview,
  });
  if (republicar) {
    try {
      const resultado = await republicarAvisoEditado(supabaseSinTiparListings(createAdminClient()), {
        listingId: entrada.listingId,
        tenantId: tenant.id,
        userId: user.id,
      });
      if (resultado.ok) {
        statusFinal = "published";
      } else {
        console.warn("[publicaciones] la edición no pudo volver a publicarse", {
          listingId: entrada.listingId,
          motivo: resultado.motivo,
          code: resultado.code,
        });
      }
    } catch (error) {
      console.warn("[publicaciones] admin client no disponible para volver a publicar", {
        listingId: entrada.listingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await encolarSiQuedaEnRevision({
    status: statusFinal,
    exigeHumano:
      moderation.flagged || photoNeedsReview || videoNeedsReview || integrity.needsHumanReview,
    monitorear: moderation.skipped === true || tier > TIER_AUTO,
    tenantId: tenant.id,
    listingId: entrada.listingId,
    aiScore: moderation.skipped ? null : moderation.score,
    reasons: [
      ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
      ...(photoNeedsReview ? ["photo_pending_review"] : []),
      ...(videoNeedsReview ? ["video_async_review"] : []),
      ...integrity.reasons,
    ],
    motivoEnRevision: "edited_listing",
    origen: "publicaciones",
  });

  revalidar(fila.kind, entrada.listingId);
  return { ok: true, status: statusFinal };
}

// ===========================================================================
// 3 · Pausar / volver a publicar
// ===========================================================================

const pausarSchema = z.object({ listingId: z.uuid(), pausar: z.boolean() });

export type PausarAvisoResult =
  | { ok: true; status: "paused" | "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Pausar NO toca el contenido, así que no vuelve a moderación: es la única
 * acción de este archivo que no cuesta una revisión.
 *
 * Volver a publicar: el UPDATE del dueño deja `pending_review` (`published`
 * está fuera de su WITH CHECK) y el admin lo devuelve a la vista si nada lo
 * impide; si algo lo impide, queda en la cola. Nunca en revisión sin cola.
 */
export async function pausarAvisoAction(rawInput: {
  listingId: string;
  pausar: boolean;
}): Promise<PausarAvisoResult> {
  const parsed = pausarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: GENERICO };
  const { listingId, pausar } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: EDICION_COPY.errores.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`pausar-aviso:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: EDICION_COPY.errores.demasiado };
  }

  const sinTipar = supabaseSinTiparListings(supabase);

  const { data, error: readError } = await sinTipar
    .from("listings")
    .select(COLUMNAS)
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (readError || !data) {
    return { ok: false, error: EDICION_COPY.errores.noEsTuya };
  }
  const fila = data as FilaDeAviso;
  const porReportes = pausadoPorReportes(fila.status, fila.attrs);

  if (pausar ? !puedePausarse(fila.status) : !puedeReactivarse(fila.status, porReportes)) {
    return { ok: false, error: EDICION_COPY.errores.noSeEdita };
  }

  const attrs = attrsDe(fila.attrs);
  if (pausar) {
    // `'owner'` y no `'reports'`: el trigger `listings_registrar_pausa_automatica`
    // (0118) sólo se dispara con `'reports'`, y `puedeCerrarPublicacion` usa ese
    // mismo valor para decidir si el dueño puede cerrar su aviso. Escribir el
    // motivo equivocado acá le trabaría el cierre a quien no denunció nadie.
    attrs.paused_reason = PAUSA_DEL_DUENO;
    attrs.paused_at = new Date().toISOString();
  } else {
    delete attrs.paused_reason;
    delete attrs.paused_at;
  }

  const nuevoStatus = pausar ? "paused" : "pending_review";
  const desde = pausar ? ["published"] : ["paused"];

  const { data: updated, error: updateError } = await sinTipar
    .from("listings")
    .update({ status: nuevoStatus, attrs })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .in("status", desde)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[publicaciones] no se pudo cambiar la pausa", {
      listingId,
      code: updateError?.code,
    });
    return { ok: false, error: GENERICO };
  }

  const status = pausar
    ? "paused"
    : await volverAPublicarReactivado({ listingId, tenantId: tenant.id, userId: user.id });

  revalidar(fila.kind, listingId);
  return { ok: true, status };
}

type IdsDeAviso = { listingId: string; tenantId: string; userId: string };

type Bloqueo = "cola_abierta" | "denuncias" | "error" | null;

/**
 * Por qué un aviso pausado no puede volver solo a la vista, aunque su dueño lo
 * haya pausado. Se pregunta a la cola y a las denuncias y no sólo a
 * `attrs.paused_reason`: esa marca estuvo desprotegida entre la 0124 y la 0178,
 * y un aviso puede tener revisión abierta sin estar pausado por denuncias.
 */
async function bloqueoParaRepublicar(
  admin: ReturnType<typeof createAdminClient>,
  ids: IdsDeAviso,
): Promise<Bloqueo> {
  // `photo` también: el pipeline encola las fotos con el id del aviso dueño.
  const { data: abierta, error: colaError } = await admin
    .from("moderation_queue")
    .select("id")
    .eq("tenant_id", ids.tenantId)
    .in("subject_kind", ["listing", "photo"])
    .eq("subject_id", ids.listingId)
    .in("status", ["pending", "escalated"])
    .limit(1)
    .maybeSingle();
  if (colaError) {
    console.warn("[publicaciones] no se pudo leer la cola al reactivar", {
      listingId: ids.listingId,
      code: colaError.code,
    });
    return "error";
  }
  if (abierta) return "cola_abierta";

  // Mismo criterio que `app.peso_de_denuncias_de_aviso` (0118): sólo
  // 'dismissed' afirma que no pasó nada.
  const { data: denuncia, error: denunciaError } = await admin
    .from("scam_reports")
    .select("id")
    .eq("tenant_id", ids.tenantId)
    .eq("target_kind", "listing")
    .eq("target_id", ids.listingId)
    .neq("status", "dismissed")
    .limit(1)
    .maybeSingle();
  if (denunciaError) {
    console.warn("[publicaciones] no se pudieron leer las denuncias al reactivar", {
      listingId: ids.listingId,
      code: denunciaError.code,
    });
    return "error";
  }
  return denuncia ? "denuncias" : null;
}

/**
 * Pausar sólo sale de `published` (`puedePausarse`), así que reactivar es
 * devolver a la vista lo que ya estaba a la vista: se republica con el mismo
 * helper que la edición — sin tocar `published_at` y reponiendo el vencimiento
 * previo. El tiempo en pausa corre contra el plazo: congelarlo dependería de
 * `attrs.paused_at`, que el dueño puede escribir; y reiniciarlo haría de
 * pausar+reactivar una renovación gratis que esquiva el tope de la 0098. Si
 * venció durante la pausa, el cron lo pasa a `expired` y se renueva por
 * `renovar_publicacion`, la única puerta que cuenta renovaciones.
 */
async function volverAPublicarReactivado(ids: IdsDeAviso): Promise<"published" | "pending_review"> {
  const encolar = (reasons: string[]) =>
    encolarSiQuedaEnRevision({
      status: "pending_review",
      exigeHumano: true,
      monitorear: false,
      tenantId: ids.tenantId,
      listingId: ids.listingId,
      aiScore: null,
      reasons,
      motivoEnRevision: "reactivated_listing",
      origen: "publicaciones",
    });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.warn("[publicaciones] admin client no disponible para reactivar", {
      listingId: ids.listingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "pending_review";
  }

  const bloqueo = await bloqueoParaRepublicar(admin, ids);
  // La revisión que ya está abierta es la que decide: una segunda fila sólo
  // duplicaría el trabajo del moderador.
  if (bloqueo === "cola_abierta") return "pending_review";
  if (bloqueo === "denuncias") {
    await encolar(["listing_reports_open"]);
    return "pending_review";
  }
  if (bloqueo === "error") {
    await encolar([]);
    return "pending_review";
  }

  const resultado = await republicarAvisoEditado(supabaseSinTiparListings(admin), ids);
  if (resultado.ok) return "published";
  console.warn("[publicaciones] el aviso reactivado no pudo volver a publicarse", {
    listingId: ids.listingId,
    motivo: resultado.motivo,
    code: resultado.code,
  });
  await encolar([]);
  return "pending_review";
}

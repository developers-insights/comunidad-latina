"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RESOURCE_TOPICS, supabaseSinTiparComunidad } from "@/lib/comunidad";
import { getStaffContext, logAdminAction } from "../../guard";

/**
 * =============================================================================
 * CARGAR Y CORREGIR EL DIRECTORIO (0096, pantalla nueva de la 0131)
 * =============================================================================
 *
 * Tres acciones: crear una ficha, corregirla y cambiarle el estado (publicarla o
 * bajarla).
 *
 * ── LO QUE ESTE ARCHIVO NO PUEDE AFLOJAR ────────────────────────────────────
 * La procedencia. `source_name`, `source_url` y `source_checked_at` son
 * obligatorios acá porque son NOT NULL en la 0096, y son NOT NULL porque una
 * ficha sin fuente se lee como si el consejo lo diera la plataforma. El zod de
 * abajo no está para «validar el formulario»: está para que el mensaje de error
 * sea una frase y no un `null value in column source_url`.
 *
 * ── ROL: `domain_admin` ─────────────────────────────────────────────────────
 * Es el que exige la policy de la 0096 desde el día uno. No es moderación de
 * contenido: es curaduría del directorio de una comunidad.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * Del JWT, jamás del formulario. Las fichas GLOBALES (`tenant_id is null`) no se
 * pueden crear desde acá y eso es correcto: sólo entran por `service_role`,
 * porque afectan a todas las comunidades a la vez.
 * =============================================================================
 */

const RUTA = "/admin/comunidad/recursos";

const COPY = {
  notAllowed: "Tu sesión no tiene permisos para esta sección. Entrá de nuevo e intentá otra vez.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid:
    "Faltan datos o alguno no tiene el formato esperado. Revisá el nombre, la fuente y el enlace.",
  sinContacto:
    "Poné al menos un teléfono, un sitio web o una dirección: una ficha a la que no se puede llegar no sirve.",
  notFound: "Esa ficha ya no está en tu comunidad — la lista se actualizó.",
  genericError: "No pudimos guardar — no es tu culpa. Probá de nuevo en un momento.",
  creada: "Listo. La ficha ya está en el directorio.",
  guardada: "Listo, guardamos los cambios.",
  publicada: "Listo. La ficha volvió a verse en la comunidad.",
  bajada: "Listo. La ficha ya no se ve en la comunidad.",
} as const;

export type RecursoActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/** Un texto opcional del formulario: vacío significa «no hay dato», no «cadena vacía». */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((valor) => (valor.length > 0 ? valor : null))
    .nullable()
    .optional();

const recursoSchema = z.object({
  topic: z.enum(RESOURCE_TOPICS),
  name: z.string().trim().min(2).max(140),
  description: opcional(600),
  phone: opcional(40),
  website: opcional(300),
  address: opcional(240),
  areaLabel: opcional(80),
  hoursNote: opcional(240),
  costNote: opcional(160),
  requirementsNote: opcional(300),
  sourceName: z.string().trim().min(2).max(160),
  sourceUrl: z.url(),
  sourceCheckedAt: z.iso.date(),
  status: z.enum(["draft", "published", "removed"]),
});

function leerFormulario(formData: FormData) {
  const texto = (clave: string) => {
    const valor = formData.get(clave);
    return typeof valor === "string" ? valor : "";
  };
  return {
    topic: texto("topic"),
    name: texto("name"),
    description: texto("description"),
    phone: texto("phone"),
    website: texto("website"),
    address: texto("address"),
    areaLabel: texto("areaLabel"),
    hoursNote: texto("hoursNote"),
    costNote: texto("costNote"),
    requirementsNote: texto("requirementsNote"),
    sourceName: texto("sourceName"),
    sourceUrl: texto("sourceUrl"),
    sourceCheckedAt: texto("sourceCheckedAt"),
    status: texto("status") || "published",
  };
}

/** Entrada validada → las columnas de la 0096. */
function aFila(input: z.output<typeof recursoSchema>) {
  return {
    topic: input.topic,
    name: input.name,
    description: input.description ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    address: input.address ?? null,
    area_label: input.areaLabel ?? null,
    hours_note: input.hoursNote ?? null,
    cost_note: input.costNote ?? null,
    requirements_note: input.requirementsNote ?? null,
    source_name: input.sourceName,
    source_url: input.sourceUrl,
    source_checked_at: input.sourceCheckedAt,
    status: input.status,
  };
}

// ===========================================================================
// 1. Crear
// ===========================================================================

export async function crearRecurso(
  _prev: RecursoActionState,
  formData: FormData,
): Promise<RecursoActionState> {
  const parsed = recursoSchema.safeParse(leerFormulario(formData));
  if (!parsed.success) return { status: "error", message: COPY.invalid };

  const fila = aFila(parsed.data);
  // Espeja `community_resources_need_contact` (0096). Se chequea acá para poder
  // decir POR QUÉ, en vez de devolver el nombre del constraint.
  if (!fila.phone && !fila.website && !fila.address) {
    return { status: "error", message: COPY.sinContacto };
  }

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_resources")
    .insert({ tenant_id: tenantId, languages: [], ...fila })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.warn("[admin/recursos] alta falló", { code: error?.code });
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "community_resource.create",
    tenantId,
    subjectKind: "community_resource",
    subjectId: (data as { id: string }).id,
    meta: { topic: fila.topic, status: fila.status },
  });

  revalidatePath(RUTA);
  revalidatePath("/comunidad/recursos");
  return { status: "success", message: COPY.creada };
}

// ===========================================================================
// 2. Corregir
// ===========================================================================

export async function actualizarRecurso(
  _prev: RecursoActionState,
  formData: FormData,
): Promise<RecursoActionState> {
  const id = formData.get("recursoId");
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) {
    return { status: "error", message: COPY.invalid };
  }

  const parsed = recursoSchema.safeParse(leerFormulario(formData));
  if (!parsed.success) return { status: "error", message: COPY.invalid };

  const fila = aFila(parsed.data);
  if (!fila.phone && !fila.website && !fila.address) {
    return { status: "error", message: COPY.sinContacto };
  }

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const { error } = await supabaseSinTiparComunidad(supabase)
    .from("community_resources")
    .update(fila)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.warn("[admin/recursos] update falló", { code: error.code });
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "community_resource.update",
    tenantId,
    subjectKind: "community_resource",
    subjectId: id,
    meta: { topic: fila.topic, status: fila.status },
  });

  revalidatePath(RUTA);
  revalidatePath("/comunidad/recursos");
  return { status: "success", message: COPY.guardada };
}

// ===========================================================================
// 3. Publicar / bajar
// ===========================================================================

const estadoSchema = z.object({
  recursoId: z.uuid(),
  status: z.enum(["draft", "published", "removed"]),
});

/**
 * Sube o baja una ficha sin tocar su contenido.
 *
 * Bajar es `removed` y no un DELETE: una ficha que se bajó porque el lugar cerró
 * puede volver, y volver a escribir catorce campos a mano para eso sería un
 * castigo. El borrado de verdad existe en la policy de la 0096, pero no tiene
 * botón: nada de lo que hay acá justifica perder el trabajo de cargarlo.
 */
export async function cambiarEstadoDeRecurso(
  _prev: RecursoActionState,
  formData: FormData,
): Promise<RecursoActionState> {
  const parsed = estadoSchema.safeParse({
    recursoId: formData.get("recursoId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const { error } = await supabaseSinTiparComunidad(supabase)
    .from("community_resources")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.recursoId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.warn("[admin/recursos] cambio de estado falló", { code: error.code });
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "community_resource.set_status",
    tenantId,
    subjectKind: "community_resource",
    subjectId: parsed.data.recursoId,
    meta: { status: parsed.data.status },
  });

  revalidatePath(RUTA);
  revalidatePath("/comunidad/recursos");
  return {
    status: "success",
    message: parsed.data.status === "published" ? COPY.publicada : COPY.bajada,
  };
}

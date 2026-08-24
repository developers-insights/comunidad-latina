import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getIdentidadActiva } from "@/lib/perfil-activo/identidad";
import { getShellContext } from "@/components/shell/shell-context";

/**
 * =============================================================================
 * AUTORÍA DE UNA PUBLICACIÓN — a nombre de quién sale lo que se publica
 * =============================================================================
 *
 * `posts.entity_listing_id` (0023) existe desde hace veinte migraciones y hasta
 * hoy NINGUNA pantalla lo escribía: los cuatro tiles del "+" siempre creaban un
 * post personal. Consecuencia en cadena: las pestañas "Publicaciones" de
 * Negocios y de Profesionales nacían vacías, y la regla de alcance
 * (`feedPostVisibilityFilter`) —las publicaciones comerciales no se derraman a
 * toda la audiencia de "Para ti"— estaba escrita pero no se ejercitaba nunca.
 * Este módulo es la llave que faltaba.
 *
 * ── QUÉ ES UNA "AUTORÍA DISPONIBLE" ─────────────────────────────────────────
 * Exactamente lo que la policy `posts_insert` (0023, reescrita en 0046) acepta
 * y ni un caso más:
 *
 *     entity_listing_id is null
 *     or exists (select 1 from listings l
 *                where l.id = posts.entity_listing_id
 *                  and l.tenant_id = posts.tenant_id
 *                  and l.created_by = auth.uid()
 *                  and l.status = 'published')
 *
 * Se copia el predicado, no se aproxima. Ofrecer en la UI una ficha que la
 * policy después rechaza es peor que no ofrecerla: la persona escribe, elige,
 * toca Publicar y recibe un error de Postgres que nadie puede explicar.
 *
 * De ahí salen las dos consecuencias que sorprenden y que son correctas:
 *   · Una ficha en borrador o pausada NO aparece. Todavía no es pública.
 *   · Un ADMINISTRADOR invitado de un negocio ajeno (`business_members`, 0031)
 *     puede ACTUAR como ese negocio en el header, pero no puede firmar
 *     publicaciones con su ficha: la policy exige `created_by = auth.uid()`, y
 *     el creador de la ficha es el dueño. Mostrarle la opción sería prometerle
 *     algo que la base no le va a dar.
 *
 * ── PROFESIONALES ENTRAN POR LA MISMA PUERTA ────────────────────────────────
 * Un profesional no es otra cosa: es una ficha `kind='professional'` en la
 * misma tabla, con el mismo dueño y el mismo estado. Por eso no hay un segundo
 * mecanismo — hay UNA consulta con `kind in ('business','professional')`. El
 * día que Eventos o Propiedades quieran publicar como entidad, es un elemento
 * más en ese arreglo y nada más.
 *
 * ── DE DÓNDE SALE EL VALOR POR DEFECTO, Y QUÉ NO ES ─────────────────────────
 * De `active_identities` (0103), vía `getIdentidadActiva()`. Esa tabla sigue
 * siendo la ÚNICA verdad persistente sobre con qué identidad está actuando la
 * persona; acá no se inventa un segundo estado ni se escribe uno nuevo. Lo que
 * aporta es el DEFAULT: si estás actuando como tu negocio, el composer llega
 * con tu negocio elegido.
 *
 * Elegir otra autoría EN EL COMPOSER es una decisión de ESA publicación, no un
 * cambio de identidad: no toca `active_identities`, no cambia el header y no
 * sobrevive a la publicación. Es deliberado —y es lo único que puede funcionar
 * para una ficha profesional, que no tiene ni puede tener fila en esa tabla—.
 * Publicar es un acto puntual; el interruptor global es otra cosa y vive en el
 * header y en /perfil.
 *
 * ── ESTO NO ES LA FRONTERA, PERO SE PARECE MUCHO ────────────────────────────
 * `listarAutoriasDelComposer()` es lo que se le OFRECE a la persona.
 * `puedeFirmarComo()` es lo que el servidor EXIGE antes de persistir, y corre
 * con el mismo predicado sobre el cliente del usuario. Y detrás de las dos
 * sigue estando la policy. Un `entityId` que llega por el body y se guarda sin
 * pasar por `puedeFirmarComo()` es publicar a nombre de un negocio ajeno.
 */

/** Verticales que hoy pueden firmar una publicación. */
export const AUTORIA_KINDS = ["business", "professional"] as const;
export type AutoriaKind = (typeof AUTORIA_KINDS)[number];

export interface AutoriaEntidad {
  /** `listings.id` — es lo que se persiste en `posts.entity_listing_id`. */
  listingId: string;
  nombre: string;
  kind: AutoriaKind;
}

export interface AutoriasDelComposer {
  /**
   * Quién es la persona, para poder nombrar la opción "vos".
   *
   * Sale de `getShellContext()`, que es el MISMO lector que usa el header para
   * pintar el avatar: el nombre y la foto del composer y los de arriba no
   * pueden salir de dos consultas distintas y terminar diciendo cosas
   * distintas.
   */
  personal: { displayName: string; avatarUrl: string | null };
  /** Fichas propias PUBLICADAS con las que se puede firmar. Vacío = sólo vos. */
  entidades: AutoriaEntidad[];
  /**
   * `listings.id` elegido de arranque, o null = perfil personal. Sale de la
   * identidad activa (0103) y sólo si esa identidad tiene una ficha usable.
   */
  porDefecto: string | null;
}

/**
 * El default seguro: sos vos y nadie más. Es a donde cae CUALQUIER falla — el
 * mismo criterio que `IDENTIDAD_PERSONAL` en perfil-activo/identidad.ts.
 * "Tu cuenta" es el mismo texto de reserva que ya usa `getShellContext()`.
 */
export const SIN_AUTORIAS: AutoriasDelComposer = {
  personal: { displayName: "Tu cuenta", avatarUrl: null },
  entidades: [],
  porDefecto: null,
};

/**
 * Fila cruda de `listings` con las TRES columnas que mira este módulo.
 *
 * No trae `photos` a propósito. El selector pinta la inicial del nombre con una
 * insignia de vertical (`<Avatar name=… badge=…>`), que es exactamente lo que
 * ya hace el cambiador de perfil del header: una sola gramática visual para
 * "esta es tu otra identidad" en toda la app, y ninguna columna traída para
 * después no usarla.
 */
interface FilaFicha {
  id: string;
  title: string;
  kind: string;
}

function esAutoriaKind(valor: string): valor is AutoriaKind {
  return (AUTORIA_KINDS as readonly string[]).includes(valor);
}

function aEntidad(fila: FilaFicha): AutoriaEntidad | null {
  if (!esAutoriaKind(fila.kind)) return null;
  return {
    listingId: fila.id,
    nombre: fila.title,
    kind: fila.kind,
  };
}

/**
 * Tope de fichas que el selector va a mostrar. No es una regla de producto: es
 * el techo de una lista que se pinta entera dentro de una hoja. La 0103 y la
 * 0106 ya limitan a UNA ficha de negocio por dueño y por comunidad, así que en
 * la práctica nadie se acerca — está para que una fila rara no traiga cien.
 */
const MAX_ENTIDADES = 12;

/**
 * Con qué firmas puede publicar quien pregunta, y cuál viene elegida.
 *
 * `cache()` por request: el composer la pide UNA vez (al abrir el menú de
 * crear) y la server action que valida la respuesta corre en otro request, así
 * que en la práctica es una consulta por apertura del composer — nunca una por
 * render, y nunca en el camino de las pantallas que no publican nada.
 *
 * NUNCA TIRA. Un error de red no puede dejar el composer sin poder publicar:
 * ante cualquier falla devuelve "sólo tu perfil personal", que es exactamente
 * lo que la app hacía antes de que esto existiera.
 */
export const listarAutoriasDelComposer = cache(
  async (): Promise<AutoriasDelComposer> => {
    try {
      const guard = await requireTenantMatch();
      if (!guard.ok) return SIN_AUTORIAS;
      const { supabase, tenant, user } = guard;

      // El MISMO predicado que la policy `posts_insert`. Ver el encabezado.
      const [{ data, error }, identidad, shell] = await Promise.all([
        supabase
          .from("listings")
          .select("id, title, kind")
          .eq("tenant_id", tenant.id)
          .eq("created_by", user.id)
          .eq("status", "published")
          .in("kind", [...AUTORIA_KINDS])
          // Negocio primero y después profesional: es el orden en que la spec
          // los nombra y el que espera quien tiene los dos.
          .order("kind", { ascending: true })
          .order("title", { ascending: true })
          .limit(MAX_ENTIDADES),
        getIdentidadActiva(),
        getShellContext(),
      ]);

      if (error || !Array.isArray(data)) return SIN_AUTORIAS;

      const entidades = (data as FilaFicha[])
        .map(aEntidad)
        .filter((entidad): entidad is AutoriaEntidad => entidad !== null);

      // El default sale de la identidad activa, pero SÓLO si esa identidad
      // tiene una ficha con la que de verdad se pueda firmar: un negocio sin
      // ficha publicada actúa en el header y publica como vos, porque no hay
      // otra cosa que la base acepte.
      const listingActivo =
        identidad.tipo === "negocio" ? identidad.negocio.listingId : null;
      const porDefecto =
        listingActivo && entidades.some((item) => item.listingId === listingActivo)
          ? listingActivo
          : null;

      return {
        personal: shell.user ?? SIN_AUTORIAS.personal,
        entidades,
        porDefecto,
      };
    } catch {
      return SIN_AUTORIAS;
    }
  },
);

/**
 * LA FRONTERA. ¿Esta persona puede firmar una publicación con esta ficha?
 *
 * Corre con el cliente del USUARIO (el del guard, con su JWT) y repite el
 * predicado de `posts_insert` columna por columna. Es redundante con la policy
 * A PROPÓSITO, por dos motivos:
 *
 *   · El error. Sin esto, un `entityId` ajeno sale como un 42501 de PostgREST
 *     que el composer sólo puede traducir a "no se pudo publicar", después de
 *     haber subido las fotos y gastado la llamada de moderación.
 *   · El orden. Esto corta ANTES de tocar Storage y OpenAI. La policy corta al
 *     final, cuando el gasto ya se hizo.
 *
 * Devuelve `false` ante cualquier error: si no se puede comprobar que la ficha
 * es tuya, no es tuya.
 */
export async function puedeFirmarComo(
  supabase: SupabaseClient,
  params: { tenantId: string; userId: string; listingId: string },
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("listings")
      .select("id")
      .eq("id", params.listingId)
      .eq("tenant_id", params.tenantId)
      .eq("created_by", params.userId)
      .eq("status", "published")
      .in("kind", [...AUTORIA_KINDS])
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { id?: string } | null)?.id);
  } catch {
    return false;
  }
}

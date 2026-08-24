import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseSinTiparVerificacion } from "./types";

/**
 * =============================================================================
 * EL GATE DE IDENTIDAD — el mismo que la RLS, preguntado antes
 * =============================================================================
 *
 * La barrera real vive en la base: la policy `listings_insert` (migración 0106)
 * exige identidad verificada para publicar alquileres, artículos de marketplace,
 * empleos y eventos pagos. Este módulo NO es esa barrera y no puede serlo —
 * PostgREST está expuesto y un cliente modificado no pasa por acá.
 *
 * Entonces, ¿para qué existe? Para que la persona se entere ANTES de llenar el
 * formulario entero y no después de apretar "Publicar". Es la misma doctrina de
 * `puedo_administrar_aviso()` (0093): la pantalla y la policy tienen que
 * preguntarle al MISMO lugar, porque el día que una de las dos copias de la
 * regla cambie sin la otra vamos a tener un formulario que se completa entero y
 * revienta al final.
 *
 * ── POR QUÉ SE PREGUNTA POR RPC Y NO SE LEE `profiles.identity_verified` ─────
 * Leer el flag y decidir acá sería reescribir la regla en TypeScript: qué
 * verticales la exigen, qué cuenta como evento pago, qué pasa con un precio
 * nulo. Tres decisiones que ya están tomadas en el SQL. `puedo_publicar_vertical()`
 * devuelve la respuesta YA calculada por la misma lógica que después va a
 * aplicar la policy.
 *
 * La única parte que sí se duplica es `verticalExigeIdentidad()`, y se duplica a
 * propósito y con límites: sirve para EVITAR EL VIAJE cuando la vertical no
 * exige nada (la mayoría de los altas), y para que la UI pueda decidir si
 * siquiera muestra el aviso de verificación. Nunca para conceder permiso: si la
 * vertical exige identidad, la respuesta la da la base. La copia sólo puede
 * pedir de más, jamás de menos — y ese error se ve, porque aparece un cartel
 * que no correspondía.
 *
 * ── ANTE LA DUDA, NO SE DEJA PASAR ──────────────────────────────────────────
 * Al revés que `leerCheckAzul()`, que ante un error devuelve `false` y no pinta
 * la insignia. Acá los dos errores no son simétricos: un falso "no podés" es un
 * cartel de más que se resuelve verificándose o recargando, y un falso "sí
 * podés" es mandar a alguien a llenar un formulario largo para que la base se lo
 * rechace al final. Ante un error de red o de permisos devolvemos
 * `indeterminado`, que la UI trata como bloqueo blando.
 */

/**
 * Las verticales donde hay dinero de por medio y la identidad es obligatoria
 * SIEMPRE, sin importar el precio.
 *
 * Espeja `app.vertical_exige_identidad()` de la 0106. Cuando el SQL y esto se
 * contradigan, manda el SQL — que no se contradigan es responsabilidad de quien
 * toque cualquiera de los dos.
 */
export const VERTICALES_QUE_EXIGEN_IDENTIDAD = ["property", "product", "job"] as const;

/**
 * `event` es el caso con matiz: sólo exige identidad si COBRA ENTRADA. Una
 * juntada de vecinos sin costo no la pide — pedirle documento a quien organiza
 * un asado es la fricción que apagaría el módulo Comunidad entero.
 */
export const VERTICAL_CONDICIONADA_AL_PRECIO = "event";

/** Por qué el gate dijo que no. */
export type MotivoDelGate =
  /** La base contestó que esta persona todavía no verificó su identidad. */
  | "identidad_no_verificada"
  /** No se pudo preguntar (red, permisos, sesión vencida). Se bloquea igual. */
  | "indeterminado";

export type ResultadoDelGate =
  | { permitido: true }
  | { permitido: false; motivo: MotivoDelGate };

/**
 * Normaliza el precio como lo hace el `coalesce(p_price, 0)` del SQL.
 *
 * Acepta string porque un precio que viene de un `<input>` es un string, y
 * comparar `"12" > 0` a mano funciona por coerción hasta el día que llega
 * `"12,50"` con coma y se convierte silenciosamente en `NaN`. Todo lo que no sea
 * un número finito se trata como 0: sin precio válido no hay evento pago.
 */
function precioComoNumero(precio: number | string | null | undefined): number {
  if (typeof precio === "number") return Number.isFinite(precio) ? precio : 0;
  if (typeof precio === "string") {
    const parseado = Number.parseFloat(precio.trim().replace(",", "."));
    return Number.isFinite(parseado) ? parseado : 0;
  }
  return 0;
}

/**
 * ¿Esta vertical exige identidad verificada para publicar?
 *
 * Función pura: es la copia acotada de `app.vertical_exige_identidad()` que
 * permite no viajar a la base cuando la respuesta es "no exige nada". Ver el
 * encabezado del archivo para los límites de esa duplicación.
 */
export function verticalExigeIdentidad(
  kind: string,
  precio?: number | string | null,
): boolean {
  if ((VERTICALES_QUE_EXIGEN_IDENTIDAD as readonly string[]).includes(kind)) {
    return true;
  }
  return kind === VERTICAL_CONDICIONADA_AL_PRECIO && precioComoNumero(precio) > 0;
}

/**
 * ¿Puede QUIEN TIENE ESTA SESIÓN publicar en esta vertical?
 *
 * Se lo pregunta a `public.puedo_publicar_vertical()` (0106), que es la misma
 * lógica que después aplica la policy. La función nunca acepta el perfil por
 * parámetro: sale de `auth.uid()` del lado del servidor, así que no hay forma de
 * usarla para averiguar el estado de verificación de otra persona.
 *
 * Corta antes de viajar cuando la vertical no exige nada — que es la mayoría de
 * los altas, y no tiene sentido pagarle un round trip a la base para que conteste
 * que sí.
 */
export async function requireIdentidadVerificada(
  supabase: SupabaseClient,
  vertical: { kind: string; precio?: number | string | null },
): Promise<ResultadoDelGate> {
  if (!verticalExigeIdentidad(vertical.kind, vertical.precio)) {
    return { permitido: true };
  }

  const { data, error } = await supabaseSinTiparVerificacion(supabase).rpc(
    "puedo_publicar_vertical",
    {
      p_kind: vertical.kind,
      p_price: precioComoNumero(vertical.precio),
    },
  );

  if (error) {
    console.warn("[verificacion] no se pudo consultar el gate de identidad", {
      code: error.code,
      kind: vertical.kind,
    });
    return { permitido: false, motivo: "indeterminado" };
  }

  // Sólo un `true` explícito abre la puerta. Un null —que es lo que devuelve
  // PostgREST si la función no existe todavía en esa base— NO es permiso.
  if (data === true) return { permitido: true };

  return {
    permitido: false,
    motivo: data === false ? "identidad_no_verificada" : "indeterminado",
  };
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ContentSubjectKind } from "./register";

/**
 * =============================================================================
 * ANOTAR QUE UN ARCHIVO DEJÓ DE MOSTRARSE — Content Integrity (migración 0097)
 * =============================================================================
 *
 * La contracara de `register.ts`. Aquél escribe la fila de procedencia cuando un
 * archivo entra; éste escribe UNA fecha cuando ese archivo deja de mostrarse en
 * el sujeto donde se cargó (hoy: una foto quitada de su publicación).
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTE MÓDULO NO HACE, Y ES LO IMPORTANTE
 * -----------------------------------------------------------------------------
 * No borra la fila de `content_assets`. No borra el objeto del bucket. No toca
 * el SHA-256, ni las huellas perceptuales, ni `first_uploaded_at`, ni la
 * declaración de licencia. El archivo sigue participando de cada escaneo futuro
 * exactamente igual que antes.
 *
 * Esto no es timidez: es la regla del libro de procedencia. La 0061 dice que la
 * fila «NO se borra al borrar el post: el asset sobrevive para que una
 * reclamación posterior siga teniendo evidencia», y la 0069 la deja fuera de
 * toda purga. Un archivo que se saca de una publicación es un caso MENOR que
 * borrar la publicación entera, y aquél ya no borra nada. Sacar evidencia
 * porque el contenido dejó de estar a la vista es justo al revés de para qué
 * existe la evidencia.
 *
 * Lo único que faltaba era poder distinguir, seis meses después y frente a un
 * reclamo, "esa foto nunca estuvo en esa publicación" de "esa foto estuvo y la
 * sacaron el 13 de agosto". Eso es `retired_from_subject_at`, y es lo único que
 * escribe este módulo.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `service_role`
 * -----------------------------------------------------------------------------
 * Las cuatro policies de escritura de `content_assets` están en `false` (0061):
 * ningún JWT de usuario escribe el libro de procedencia, y así tiene que
 * seguir siendo — si alguien pudiera tocar su propia fila, podría marcar como
 * retirado un archivo que sigue publicado. El admin client es el único camino y
 * es un uso permitido, igual que en `register.ts`: acá no se lee ni un dato de
 * usuario para mostrarlo, se anota un hecho que el servidor acaba de ejecutar.
 *
 * -----------------------------------------------------------------------------
 * NUNCA LANZA, Y NUNCA MIENTE SOBRE LO QUE NO PUDO
 * -----------------------------------------------------------------------------
 * La foto ya se quitó de la publicación cuando esto corre. Un fallo acá no puede
 * desandar eso ni romperle la pantalla a nadie, así que se devuelve `false` y se
 * registra en el log del servidor. La consecuencia real de perder la anotación
 * es acotada y conocida: la fila queda como estaba —completa y válida— y quien
 * modere ve la publicación sin la foto, que es exactamente la situación que
 * había antes de la 0097.
 */

export interface RetireAssetInput {
  tenantId: string;
  subjectKind: ContentSubjectKind;
  subjectId: string;
  /** Ruta del objeto en el bucket, tal cual quedó en `content_assets.storage_path`. */
  storagePath: string;
}

/**
 * Anota que el archivo dejó de mostrarse. `true` si quedó anotado.
 *
 * Idempotente: `coalesce(retired_from_subject_at, now())` en la base conserva la
 * PRIMERA fecha. Reintentar no reescribe la historia — el día que salió es el
 * día que salió, no el día que alguien volvió a ejecutar esto.
 *
 * Un archivo sin fila de procedencia (subido antes de que existiera el pipeline,
 * o una foto de stock de la semilla) no es un error: no hay nada que anotar
 * porque no hay evidencia que aclarar. Devuelve `false` sin ruido.
 */
export async function retireAssetFromSubject(
  input: RetireAssetInput,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("content_assets")
      // `retired_from_subject_at` llega con la 0097 y `database.types.ts` se
      // regenera aparte: el cast es por el TIPO, no por el contrato. Mismo
      // patrón que `commercial_intent` en register.ts desde la 0086.
      .update({ retired_from_subject_at: new Date().toISOString() } as never)
      .eq("tenant_id", input.tenantId)
      .eq("subject_kind", input.subjectKind)
      .eq("subject_id", input.subjectId)
      .eq("storage_path", input.storagePath)
      .is("retired_from_subject_at", null)
      .select("id");

    if (error) {
      console.warn("[integrity] no se pudo anotar la baja del archivo", {
        code: error.code,
      });
      return false;
    }
    return (data ?? []).length > 0;
  } catch {
    // Admin no configurado (entorno sin service role). La foto ya se quitó; la
    // anotación es lo único que se pierde, y se dice.
    console.warn("[integrity] admin client no disponible: la baja del archivo no quedó anotada");
    return false;
  }
}

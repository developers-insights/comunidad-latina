import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  MENSAJE_DE_GRUPO_COLUMNS,
  supabaseSinTiparGrupos,
  type MensajeDeGrupoRow,
} from "@/lib/messaging/grupos";
import {
  ITEMS_POR_TANDA,
  primerEnlaceDelCuerpo,
  type CursorDeGaleria,
  type SolapaDeGaleria,
} from "@/lib/messaging/galeria";

/**
 * LO QUE SE COMPARTIÓ EN UN GRUPO — la consulta.
 *
 * No filtra por `tenant_id` ni por membresía, por el mismo motivo que el resto
 * de `grupos/queries.ts`: las policies de la 0133 ya resuelven las dos cosas y
 * una segunda verdad acá es la forma de que un día digan distinto.
 *
 * ⚠️ `deleted_at is null` VA EXPLÍCITO Y NO SE SACA. La 0135 abrió
 * `chat_group_messages_select` para que el autor y quien administra sigan
 * viendo la fila bajada —hacía falta para que el UPDATE del borrado no muriera—
 * así que la base SÍ devuelve mensajes borrados a esas dos personas. La 0144
 * les vacía `adjunto`, `ubicacion` y `compartido_*` al bajarlos, con lo cual un
 * borrado que se colara acá sería una fila muda; pero el criterio del producto
 * es que lo borrado no aparece, y eso se afirma en la consulta, no se deduce de
 * que el contenido esté vacío.
 */
export interface TandaDeGaleria {
  mensajes: MensajeDeGrupoRow[];
  /** `null` cuando ya no queda nada más viejo. */
  siguiente: CursorDeGaleria | null;
}

export async function leerGaleriaDelGrupo(params: {
  groupId: string;
  solapa: SolapaDeGaleria;
  cursor?: CursorDeGaleria | null;
}): Promise<TandaDeGaleria> {
  const { groupId, solapa, cursor } = params;
  const supabase = supabaseSinTiparGrupos(await createClient());

  let query = supabase
    .from("chat_group_messages")
    .select(MENSAJE_DE_GRUPO_COLUMNS)
    .eq("group_id", groupId)
    .is("deleted_at", null);

  if (solapa === "multimedia") {
    query = query.in("kind", ["imagen", "video"]);
  } else if (solapa === "archivos") {
    query = query.eq("kind", "archivo");
  } else {
    /**
     * `ilike '%http%'` es un PREFILTRO GRUESO, no el criterio. Atrapa también
     * palabras como "httpd" y URLs mal escritas; quien decide de verdad es
     * `primerEnlaceDelCuerpo`, unas líneas más abajo. Se hace así porque la
     * alternativa —un regex en SQL— tampoco usa índice y encima deja la regla
     * escrita en dos idiomas.
     */
    query = query.or("kind.eq.contenido,and(kind.eq.texto,body.ilike.*http*)");
  }

  if (cursor) {
    /**
     * Keyset: "más viejo que el último que mostré". El segundo término
     * desempata los mensajes del mismo instante —una tanda de fotos entra con
     * el mismo `created_at`— y sin él la paginación saltea filas.
     *
     * Son DOS `.or()` en la misma consulta cuando la solapa es Enlaces, y está
     * bien: `postgrest-js` los manda como dos parámetros `or=` y PostgREST los
     * combina con AND (`searchParams.append`, no `set`).
     */
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ITEMS_POR_TANDA + 1);

  if (error) {
    console.warn("[grupos] no se pudo leer la galería", { code: error.code });
    return { mensajes: [], siguiente: null };
  }

  const crudas = (data ?? []) as unknown as MensajeDeGrupoRow[];
  const hayMas = crudas.length > ITEMS_POR_TANDA;
  const pagina = hayMas ? crudas.slice(0, ITEMS_POR_TANDA) : crudas;

  /**
   * EL CURSOR SALE DE LA ÚLTIMA FILA QUE VINO DE LA BASE, NO DEL ÚLTIMO ÍTEM
   * QUE SE MUESTRA. En Enlaces el refinado descarta filas, y apoyar el cursor
   * en la última que sobrevivió haría que la tanda siguiente volviera a traer
   * —y a descartar— las mismas. Una tanda puede quedar corta; ninguna se
   * saltea.
   */
  const ultima = pagina[pagina.length - 1];
  const siguiente =
    hayMas && ultima ? { createdAt: ultima.created_at, id: ultima.id } : null;

  const mensajes =
    solapa === "enlaces"
      ? pagina.filter(
          (mensaje) =>
            mensaje.kind === "contenido" || primerEnlaceDelCuerpo(mensaje.body) !== null,
        )
      : pagina;

  return { mensajes, siguiente };
}

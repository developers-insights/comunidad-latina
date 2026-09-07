import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { COPY } from "@/components/messaging/copy";
import { firmarAdjuntosDelHilo } from "@/components/messaging/message-attachment";
import { claveCompartido, resolverCompartidos } from "@/components/messaging/shared-card";
import { esCompartidoKind, type EnlaceInterno } from "@/components/share/enlace-interno";
import type { MensajeDeGrupoRow } from "@/lib/messaging/grupos";
import {
  etiquetaDeEnlace,
  pesoLegible,
  primerEnlaceDelCuerpo,
  tipoLegible,
  type ItemDeGaleria,
  type SolapaDeGaleria,
} from "@/lib/messaging/galeria";
import { perfilesDeAutores } from "../../queries";

/**
 * DE FILAS DE LA BASE A LO QUE SE PINTA.
 *
 * Vive acá, y no adentro de la página, porque lo llaman DOS caminos: el primer
 * render (Server Component) y el "Ver más" (server action). Escrito dos veces,
 * la tanda dos se vería distinta de la tanda uno — que es el bug clásico de la
 * paginación con append.
 *
 * `ItemDeGaleria` NO se declara acá: vive en `lib/messaging/galeria.ts` porque
 * lo importa un client component, y este módulo abre con `server-only`. Ver la
 * advertencia en la declaración del tipo.
 */
const AUTOR_DESCONOCIDO = "Miembro de la comunidad";

export async function armarGaleria(params: {
  solapa: SolapaDeGaleria;
  mensajes: readonly MensajeDeGrupoRow[];
}): Promise<ItemDeGaleria[]> {
  const { solapa, mensajes } = params;
  if (mensajes.length === 0) return [];

  const compartidosPedidos: EnlaceInterno[] =
    solapa === "enlaces"
      ? mensajes
          .filter(
            (mensaje) =>
              esCompartidoKind(mensaje.compartido_kind) && Boolean(mensaje.compartido_id),
          )
          .map((mensaje) => ({
            kind: mensaje.compartido_kind as EnlaceInterno["kind"],
            id: mensaje.compartido_id as string,
          }))
      : [];

  /**
   * Las cinco en paralelo: ninguna depende de otra. Las que no le tocan a esta
   * solapa reciben una lista vacía y vuelven sin viajar.
   */
  const [autores, firmas, compartidos, formatDate] = await Promise.all([
    perfilesDeAutores(mensajes.map((mensaje) => mensaje.sender_id)),
    firmarAdjuntosDelHilo(
      solapa === "multimedia"
        ? mensajes
            .map((mensaje) => mensaje.adjunto?.path)
            .filter((path): path is string => typeof path === "string" && path.length > 0)
        : [],
    ),
    compartidosPedidos.length > 0
      ? (async () => {
          const [supabase, tenant] = await Promise.all([createClient(), getTenant()]);
          return resolverCompartidos(supabase, compartidosPedidos, { locale: tenant.locale });
        })()
      : Promise.resolve(new Map()),
    getViewerFormatDate(),
  ]);

  const items: ItemDeGaleria[] = [];

  for (const mensaje of mensajes) {
    const base = {
      mensajeId: mensaje.id,
      quien: autores.get(mensaje.sender_id)?.displayName ?? AUTOR_DESCONOCIDO,
      cuando: formatDate(mensaje.created_at, { style: "medium" }),
    };

    if (solapa === "multimedia") {
      const adjunto = mensaje.adjunto;
      if (!adjunto?.path) continue;
      items.push({
        ...base,
        clase: "media",
        tipo: mensaje.kind === "video" ? "video" : "imagen",
        src: firmas.get(adjunto.path) ?? null,
        ancho: adjunto.ancho ?? null,
        alto: adjunto.alto ?? null,
      });
      continue;
    }

    if (solapa === "archivos") {
      const adjunto = mensaje.adjunto;
      if (!adjunto?.path) continue;
      items.push({
        ...base,
        clase: "archivo",
        nombre: adjunto.nombre?.trim() || COPY.thread.adjunto.archivoSinNombre,
        tipo: tipoLegible(adjunto.mime),
        peso: pesoLegible(adjunto.bytes),
      });
      continue;
    }

    if (esCompartidoKind(mensaje.compartido_kind) && mensaje.compartido_id) {
      const resuelto = compartidos.get(
        claveCompartido({ kind: mensaje.compartido_kind, id: mensaje.compartido_id }),
      );
      items.push({
        ...base,
        clase: "enlace",
        // Sin `resuelto` el original se borró o quien mira no puede verlo. Se
        // muestra igual, con el rótulo genérico: la fila cuenta que ahí se
        // compartió algo, y esconderla dejaría un hueco sin explicación.
        titulo: resuelto?.titulo ?? COPY.inbox.resumen.contenido,
        detalle: resuelto?.detalle ?? null,
      });
      continue;
    }

    const url = primerEnlaceDelCuerpo(mensaje.body);
    if (!url) continue;
    // Lo que la persona escribió ALREDEDOR del link, si escribió algo: es el
    // contexto que explica por qué lo mandó.
    const alrededor = mensaje.body.replace(url, " ").replace(/\s+/g, " ").trim();
    items.push({
      ...base,
      clase: "enlace",
      titulo: etiquetaDeEnlace(url),
      detalle: alrededor.length > 0 ? recortar(alrededor, 90) : null,
    });
  }

  return items;
}

function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${(ultimoEspacio > max / 2 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { EmptyState, NavTabs } from "@/components/ui";
import { COPY } from "@/components/messaging/copy";
import { GaleriaLista } from "@/components/messaging/galeria-lista";
import {
  SOLAPAS_DE_GALERIA,
  armarCursor,
  parsearSolapa,
} from "@/lib/messaging/galeria";
import { obtenerGrupo } from "../../queries";
import { armarGaleria } from "./armar";
import { leerGaleriaDelGrupo } from "./queries";

export const metadata: Metadata = { title: COPY.galeria.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const G = COPY.galeria;

/**
 * /mensajes/grupos/[id]/multimedia — los archivos, enlaces y documentos que se
 * compartieron en el grupo (punto 8 del pliego).
 *
 * ── POR QUÉ UNA RUTA PROPIA Y NO SOLAPAS ADENTRO DE `info` ──────────────────
 * Tres motivos, y cualquiera alcanzaría:
 *
 *  · `info` ya es larga: cabecera, descripción, invitar, hasta 200 miembros y
 *    las acciones de riesgo. Meterle tres listas paginadas abajo hace una
 *    pantalla que no termina nunca, y deja "Salir del grupo" a un scroll de
 *    distancia que crece con cada foto que se manda.
 *  · Estas listas tienen ESTADO propio (qué solapa, cuánto se bajó) y `info`
 *    también (la lista de miembros). Compartir una URL mezclaría los dos y un
 *    enlace a la solapa Enlaces arrastraría de vuelta la ficha entera.
 *  · Es el mismo argumento que la propia `info` escribió para no ser una hoja
 *    modal: scroll propio, URL compartible y back del sistema.
 *
 * La entrada vive en `info`, que es donde el cliente la pidió ("dentro del
 * grupo: administradores, ver miembros, ver los archivos…").
 *
 * ── LA PRIMERA TANDA LA SIRVE EL SERVIDOR ───────────────────────────────────
 * Ya viene resuelta —autores, URLs firmadas y fechas en la zona de quien lee—
 * así que la pantalla pinta de una. El "Ver más" acumula desde el cliente; el
 * cursor NO viaja en la URL a propósito: al volver a esta pantalla se quiere lo
 * más nuevo, no la página siete de la última visita.
 */
export default async function GaleriaDelGrupoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const grupo = await obtenerGrupo(id, user.id);
  if (!grupo) notFound();

  // Mismo criterio que `info`: esto es para quien está adentro. Quien no lo
  // está va al chat, que es la pantalla que sí le corresponde.
  if (grupo.miRol === null) redirect(`/mensajes/grupos/${grupo.id}`);

  const solapa = parsearSolapa(sp.solapa);
  const { mensajes, siguiente } = await leerGaleriaDelGrupo({ groupId: grupo.id, solapa });
  const items = await armarGaleria({ solapa, mensajes });

  const vacio = G.vacio[solapa];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="truncate text-sm text-foreground-muted">{grupo.name}</p>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          {G.title}
        </h1>
      </header>

      <NavTabs
        label={G.solapasLabel}
        active={solapa}
        items={SOLAPAS_DE_GALERIA.map((item) => ({
          id: item,
          label: G.solapas[item],
          href: `/mensajes/grupos/${grupo.id}/multimedia?solapa=${item}`,
        }))}
      />

      {items.length === 0 ? (
        <EmptyState title={vacio.title} message={vacio.message} />
      ) : (
        <GaleriaLista
          // Cambiar de solapa cambia la URL pero deja el componente en la misma
          // posición del árbol: sin `key`, React conservaría el estado y la
          // solapa nueva arrancaría con los ítems de la anterior apilados.
          key={solapa}
          grupoId={grupo.id}
          solapa={solapa}
          itemsIniciales={items}
          cursorInicial={siguiente ? armarCursor(siguiente) : null}
        />
      )}
    </div>
  );
}

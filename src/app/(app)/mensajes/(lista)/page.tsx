import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/messaging/copy";
import { InboxFiltros } from "@/components/messaging/inbox-filtros";
import { InboxRow } from "@/components/messaging/inbox-row";
import { InboxSearch } from "@/components/messaging/inbox-search";
import { InboxTabs } from "@/components/messaging/inbox-tabs";
import { parseFiltroDePersonas, type FiltroDePersonas } from "@/lib/messaging/bandeja";
import { leerPresencia, presenciaVisible } from "@/lib/messaging/presencia";
import { leerBandejaDePersonas } from "../bandeja-queries";

export const metadata: Metadata = { title: COPY.inbox.title };

/**
 * /mensajes — la pestaña PERSONAS de la bandeja.
 *
 * Sigue agrupada por persona (0134): una fila por contraparte, el aviso como
 * contexto y no como título. Lo que cambió en esta tanda:
 *
 * · **Las solicitudes se mudaron.** Antes venían mezcladas en esta misma lista,
 *   marcadas con un borde. Una decisión pendiente ("¿acepto o ignoro?") no
 *   puede vivir enterrada entre charlas viejas: ahora tienen su pestaña, con su
 *   contador. Lo que NO se movió es el banner del hilo — quien entra por un
 *   enlace directo sigue encontrando ahí el Aceptar.
 *
 * · **Filtros rápidos** en la URL (`?filtro=`), así el estado se comparte y
 *   sobrevive al back del sistema.
 *
 * · **La fila dice qué pasó**: "Nota de voz · 0:24", "Foto", el contador sin
 *   leer y el tilde de leído. Ver `inbox-row.tsx`.
 *
 * RLS ya limita a conversaciones donde soy `created_by` o `counterpart`;
 * `blocked` se filtra en la consulta (ignorar = desaparece sin drama).
 */
export default async function MensajesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, userId] = await Promise.all([searchParams, getAuthUserId()]);
  if (!userId) redirect("/entrar?next=/mensajes");

  const filtro = parseFiltroDePersonas(sp.filtro);
  const [{ filas, totalNoLeidos, hayLecturas }, supabase] = await Promise.all([
    leerBandejaDePersonas({ miId: userId, filtro }),
    createClient(),
  ]);

  /**
   * LA PRESENCIA VIAJA CON LA BANDEJA, NO DESPUÉS.
   *
   * Se resuelve en el servidor y baja pintada: la fila no monta un efecto para
   * ir a buscar quién está en línea, así que la lista no aparece primero muda y
   * se completa un segundo más tarde. La reconciliación la hace el refresco que
   * la pantalla ya tenía, no un viaje propio.
   */
  const presencias = await leerPresencia(
    supabase,
    filas.map((fila) => fila.personaId),
  );

  const ahora = new Date();
  const vacio = VACIOS[hayLecturas ? filtro : "todos"];

  return (
    <>

      <h1 className="mb-5 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.inbox.title}
      </h1>

      <InboxTabs active="personas" />

      {/* El buscador va ARRIBA de la lista y se ve aunque la bandeja esté
          vacía: es justo cuando más falta hace («busco a Manuel y le
          escribo»), y esconderlo detrás de un estado vacío dejaría la pantalla
          sin ninguna salida. */}
      <InboxSearch />

      {/* Sin `conversation_reads` no hay forma honesta de decir qué está sin
          leer, así que el chip no se dibuja. Prometer un filtro que devuelve
          siempre cero es peor que no ofrecerlo. */}
      <InboxFiltros
        activo={filtro}
        noLeidos={totalNoLeidos}
        ocultarNoLeidos={!hayLecturas}
      />

      {filas.length === 0 ? (
        <EmptyState
          illustration={filtro === "todos" ? "/images/empty-state-search.png" : undefined}
          title={vacio.title}
          message={vacio.message}
          action={
            filtro === "todos" ? undefined : (
              <Link
                href="/mensajes"
                className={buttonVariants({ variant: "secondary", size: "md" })}
              >
                {COPY.inbox.resetFilter}
              </Link>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((fila) => (
            <InboxRow
              key={fila.personaId}
              fila={fila}
              miId={userId}
              ahora={ahora}
              presencia={
                presenciaVisible(presencias.get(fila.personaId), ahora) ?? undefined
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Un vacío por filtro. El de "todos" va sin CTA (pedido del cliente
 * 2026-07-20): informa dónde van a aparecer las conversaciones, y el buscador
 * de arriba ya es la acción que corresponde. Los otros dos SÍ llevan salida —
 * ahí el vacío es consecuencia de un filtro, y hay que poder deshacerlo.
 */
const VACIOS: Record<FiltroDePersonas, { title: string; message: string }> = {
  todos: { title: COPY.inbox.emptyTitle, message: COPY.inbox.emptyMessage },
  amigos: {
    title: COPY.inbox.emptyFriendsTitle,
    message: COPY.inbox.emptyFriendsMessage,
  },
  "no-leidos": {
    title: COPY.inbox.emptyUnreadTitle,
    message: COPY.inbox.emptyUnreadMessage,
  },
};

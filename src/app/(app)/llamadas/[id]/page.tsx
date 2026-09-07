import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { esEstadoDeLlamada, KINDS, type KindDeLlamada } from "@/lib/calls/tipos";
import { PantallaDeLlamada } from "@/components/calls/pantalla-de-llamada";
import { COPY } from "@/components/calls/copy";
import { conversacionEntre, getCandidatos, getLlamada } from "../queries";
import { invitarALlamadaAction, terminarLlamadaAction } from "../actions";

export const metadata: Metadata = { title: COPY.seccion.title };

/**
 * La llamada no se cachea nunca: su estado cambia cada pocos segundos y una
 * versión vieja mostraría gente que ya cortó.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /llamadas/[id] — la pantalla de llamada.
 *
 * NO hay ni un chequeo de permiso escrito acá y es correcto: `calls_select`
 * (0139 §5) sólo devuelve llamadas en las que quien mira está invitado, así que
 * "no sos participante" y "no existe" llegan igual —como `null`— y salen igual,
 * como un 404. Un mensaje distinto para cada caso sería una forma de averiguar
 * qué llamadas existen probando ids.
 *
 * El `canal` de Agora no viaja en este payload (ver `LLAMADA_COLUMNS`). La
 * pantalla lo recibe recién del endpoint del token, después de que la base
 * vuelva a confirmar la pertenencia.
 */
export default async function LlamadaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agregar?: string }>;
}) {
  const [{ id }, { agregar }] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();

  const [user, supabase] = await Promise.all([getCurrentUser(), createClient()]);
  if (!user) redirect("/entrar");

  const llamada = await getLlamada(supabase, id);
  if (!llamada) notFound();

  const kind: KindDeLlamada = (KINDS as readonly string[]).includes(llamada.kind)
    ? (llamada.kind as KindDeLlamada)
    : "audio";
  const estado = esEstadoDeLlamada(llamada.status) ? llamada.status : "terminada";

  const candidatos = await getCandidatos(supabase, {
    userId: user.id,
    groupId: llamada.groupId,
  });

  const otro = llamada.personas.find((p) => p.id !== user.id) ?? null;
  const conversacion = otro && !llamada.groupId ? await conversacionEntre(supabase, user.id, otro.id) : null;
  const hrefDelChat = llamada.groupId
    ? `/mensajes/grupos/${llamada.groupId}`
    : conversacion
      ? `/mensajes/${conversacion}`
      : null;

  const yo = llamada.personas.find((p) => p.id === user.id);

  return (
    <PantallaDeLlamada
      callId={llamada.id}
      kind={kind}
      estado={estado}
      startedAt={llamada.startedAt}
      endedAt={llamada.endedAt}
      yo={{
        id: user.id,
        displayName: yo?.displayName ?? "Vos",
        avatarUrl: yo?.avatarUrl ?? null,
      }}
      personas={llamada.personas}
      soyQuienLlama={llamada.iniciadaPor === user.id}
      grupoNombre={llamada.grupo?.name ?? null}
      hrefDelChat={hrefDelChat}
      candidatos={candidatos}
      abrirAgregar={agregar === "1"}
      acciones={{ terminar: terminarLlamadaAction, invitar: invitarALlamadaAction }}
    />
  );
}

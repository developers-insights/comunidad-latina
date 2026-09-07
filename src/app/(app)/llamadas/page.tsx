import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Phone,
  PhoneIncoming,
  PhoneSlash,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Avatar, EmptyState, NavTabs, buttonVariants } from "@/components/ui";
import { SectionTopBar } from "@/components/shell";
import { resumenDeDuracion } from "@/lib/calls/duracion";
import { COPY } from "@/components/calls/copy";
import { getHistorial, type FilaDeHistorial } from "./queries";

export const metadata: Metadata = { title: COPY.seccion.title };

/**
 * /llamadas — la pestaña "Llamadas" de la bandeja.
 *
 * ⚠️ LAS PESTAÑAS ESTÁN ESCRITAS ACÁ Y TAMBIÉN EN `messaging/inbox-tabs.tsx`.
 * No es un descuido: esta tanda no puede tocar ese archivo, que pertenece a otro
 * frente, y sin la tercera pestaña acá no habría forma de volver a Personas o
 * Grupos desde el historial. Cuando `inbox-tabs.tsx` sume "Llamadas", este
 * `<NavTabs>` se reemplaza por `<InboxTabs active="llamadas" />` y esta nota se
 * borra.
 */
export default async function LlamadasPage() {
  const [user, supabase] = await Promise.all([getCurrentUser(), createClient()]);
  if (!user) redirect("/entrar");

  const historial = await getHistorial(supabase, user.id);

  return (
    <>
      <SectionTopBar fallbackHref="/mensajes" title={COPY.seccion.title} />

      <NavTabs
        className="mb-5"
        label={COPY.seccion.tabsLabel}
        active="llamadas"
        items={[
          { id: "personas", label: COPY.seccion.tabPersonas, href: "/mensajes" },
          { id: "grupos", label: COPY.seccion.tabGrupos, href: "/mensajes/grupos" },
          { id: "llamadas", label: COPY.seccion.tabLlamadas, href: "/llamadas" },
        ]}
      />

      {historial.length === 0 ? (
        <EmptyState
          title={COPY.seccion.emptyTitle}
          description={COPY.seccion.emptyBody}
          action={
            <Link href="/mensajes" className={cn(buttonVariants({ variant: "primary" }))}>
              {COPY.seccion.emptyCta}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {historial.map((fila) => (
            <FilaDeLlamada key={fila.id} fila={fila} miId={user.id} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Una llamada del historial.
 *
 * El ícono y su color dicen QUÉ pasó antes de leer una palabra: perdida en rojo,
 * el resto en gris. Es la misma jerarquía que usa cualquier registro de llamadas
 * y no hay razón para inventar otra — acá lo distintivo es el resto de la app,
 * no esta lista.
 */
function FilaDeLlamada({ fila, miId }: { fila: FilaDeHistorial; miId: string }) {
  const saliente = fila.iniciadaPor === miId;
  const perdida = fila.status === "perdida" || fila.status === "rechazada";
  const duracion = resumenDeDuracion(fila.startedAt, fila.endedAt);

  const titulo =
    fila.grupoNombre ??
    (fila.otros.length === 0
      ? "Miembro de la comunidad"
      : fila.otros.length === 1
        ? fila.otros[0].displayName
        : `${fila.otros[0].displayName} y ${fila.otros.length - 1} más`);

  const detalle = perdida
    ? fila.status === "rechazada"
      ? COPY.historial.rechazada
      : COPY.historial.perdida
    : [
        saliente ? COPY.historial.saliente : COPY.historial.entrante,
        duracion,
        fila.kind === "video" ? COPY.historial.kindVideo : COPY.historial.kindAudio,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <li>
      <div className="flex min-h-16 items-center gap-3 rounded-lg px-2 py-2">
        <Avatar
          src={fila.otros[0]?.avatarUrl ?? null}
          name={titulo}
          size="md"
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{titulo}</p>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-xs",
              perdida ? "font-medium text-danger-ink" : "text-foreground-muted",
            )}
          >
            {perdida ? (
              <PhoneSlash size={13} weight="fill" aria-hidden="true" />
            ) : saliente ? (
              <Phone size={13} aria-hidden="true" />
            ) : (
              <PhoneIncoming size={13} aria-hidden="true" />
            )}
            {detalle}
          </p>
        </div>

        {fila.kind === "video" ? (
          <VideoCamera size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        ) : (
          <Phone size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        )}
      </div>
    </li>
  );
}

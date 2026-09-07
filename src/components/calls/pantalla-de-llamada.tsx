"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { PhoneDisconnect, ShieldCheck, Users } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, Button } from "@/components/ui";
import { duracionEnSegundos, duracionHablada, formatearDuracion } from "@/lib/calls/duracion";
import type { CodigoDeLlamada } from "@/lib/calls/errores";
import { useMotorDeLlamada, type MotivoDeCierre } from "@/lib/calls/motor";
import {
  cupoRestante,
  sigueEnLaLlamada,
  type EstadoDeLlamada,
  type KindDeLlamada,
  type PersonaEnLlamada,
} from "@/lib/calls/tipos";
import { useVigilanciaDeLlamada } from "@/lib/calls/vigilancia";
import { Controles } from "./controles";
import { COPY } from "./copy";
import { FondoDeLlamada } from "./fondo";
import { HojaAgregar, type CandidatoUI } from "./hoja-agregar";
import { Mosaico } from "./mosaico";
import styles from "./llamada.module.css";

/**
 * Cuánto suena una llamada antes de darse por perdida. Cuarenta y cinco
 * segundos es lo que tarda alguien en sacar el teléfono del bolsillo; más que
 * eso es un canal de Agora abierto esperando a nadie, y eso se factura.
 */
const TIMBRE_MAXIMO_MS = 45_000;

export interface PantallaDeLlamadaProps {
  callId: string;
  kind: KindDeLlamada;
  estado: EstadoDeLlamada;
  startedAt: string | null;
  endedAt: string | null;
  yo: { id: string; displayName: string; avatarUrl: string | null };
  personas: PersonaEnLlamada[];
  soyQuienLlama: boolean;
  /** Nombre del grupo, cuando la llamada salió de uno. */
  grupoNombre: string | null;
  /** A dónde lleva el botón Chat. Se abre en otra pestaña para no cortar. */
  hrefDelChat: string | null;
  candidatos: CandidatoUI[];
  /** Llamada de grupo recién creada: la hoja de "Añadir" abre sola. */
  abrirAgregar: boolean;
  /** Las server actions con su firma real. Ver la nota en vigilante.tsx. */
  acciones: {
    terminar: (input: { callId: string }) => Promise<{ ok: boolean }>;
    invitar: (input: {
      callId: string;
      profileIds: string[];
    }) => Promise<{ ok: true; sumados: number } | { ok: false; code: CodigoDeLlamada }>;
  };
}

export function PantallaDeLlamada(props: PantallaDeLlamadaProps) {
  const {
    callId,
    kind,
    estado,
    startedAt,
    endedAt,
    yo,
    personas,
    soyQuienLlama,
    grupoNombre,
    hrefDelChat,
    candidatos,
    abrirAgregar,
    acciones,
  } = props;

  const router = useRouter();
  const [agregarAbierto, setAgregarAbierto] = useState(abrirAgregar);
  const [ahora, setAhora] = useState(() => Date.now());
  const cerrandoRef = useRef(false);

  const alCerrar = useCallback(
    (motivo: MotivoDeCierre) => {
      if (cerrandoRef.current) return;
      cerrandoRef.current = true;
      // `ended_at` se escribe SIEMPRE, se haya salido como se haya salido. Es lo
      // único que distingue una llamada que terminó de una que quedó colgada, y
      // de eso depende que la bandeja pueda resumirla.
      void acciones.terminar({ callId });
      if (motivo !== "sali-de-la-pagina") router.replace("/llamadas");
    },
    [acciones, callId, router],
  );

  const motor = useMotorDeLlamada({ callId, kind, alCerrar });

  /**
   * EL PERMISO SE PIDE EN EL GESTO, NO AL CARGAR.
   *
   * `?entrar=1` lo pone quien tocó Llamar o Atender, y sólo esa vez. Abrir esta
   * URL de otra forma —un enlace pegado, una pestaña que el navegador restaura—
   * no arranca nada: aparece el botón "Entrar a la llamada" y el micrófono se
   * pide recién ahí. Se lee de `location` y no de `useSearchParams` para poder
   * borrarlo con `replaceState`, sin provocar una navegación.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("entrar") !== "1") return;
    url.searchParams.delete("entrar");
    url.searchParams.delete("agregar");
    window.history.replaceState(null, "", url.pathname + url.search);
    motor.arrancar();
    // Sólo al montar: es un disparo único por diseño.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambios de estado y de participantes llegan por Realtime (y por sondeo si
  // la publicación todavía no está habilitada). Ver lib/calls/vigilancia.ts.
  useVigilanciaDeLlamada(callId, () => router.refresh());

  const enLinea = motor.fase === "en-linea" || motor.fase === "reconectando";
  const corriendo = estado === "en_curso" && startedAt !== null && endedAt === null;

  useEffect(() => {
    if (!corriendo) return;
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [corriendo]);

  const segundos = duracionEnSegundos(startedAt, endedAt, ahora);

  /**
   * Nadie atendió.
   *
   * La corta quien llama, no quien no atendió: es el único de los dos que con
   * seguridad tiene la pestaña abierta. Al colgar sin `started_at`, la acción de
   * cierre la marca `perdida` — y de ahí sale el "Llamada perdida" de la bandeja.
   */
  useEffect(() => {
    if (!soyQuienLlama || estado !== "sonando") return;
    const id = window.setTimeout(() => motor.colgar("colgue"), TIMBRE_MAXIMO_MS);
    return () => window.clearTimeout(id);
  }, [soyQuienLlama, estado, motor]);

  const yoEnLista = useMemo(
    () => personas.find((p) => p.id === yo.id) ?? null,
    [personas, yo.id],
  );

  /**
   * Los mosaicos se arman cruzando DOS fuentes: la lista de la base (quién está
   * invitado y cómo se llama) y la de Agora (quién está publicando ahora). Ni
   * una sola alcanza — la base no sabe si alguien tiene la cámara apagada, y
   * Agora no sabe cómo se llama nadie.
   */
  const otros = useMemo(() => {
    const porUid = new Map(motor.remotos.map((r) => [r.uid, r]));
    return personas
      .filter((p) => p.id !== yo.id && p.leftAt === null)
      .map((persona) => {
        const remoto = porUid.get(persona.id) ?? null;
        return {
          persona,
          conectado: remoto !== null,
          video: remoto?.video ?? null,
          micApagado: remoto ? !remoto.tieneAudio : false,
          camaraApagada: remoto ? !remoto.tieneVideo : kind === "audio",
        };
      });
  }, [personas, motor.remotos, yo.id, kind]);

  const conectados = otros.filter((o) => o.conectado);
  const enGrilla = conectados.length > 1;
  const dueto = conectados.length === 1 ? conectados[0] : null;

  const titulo = grupoNombre ?? otros[0]?.persona.displayName ?? COPY.pantalla.llamando;
  const subtituloPais = grupoNombre ? null : (otros[0]?.persona.country ?? null);

  const cupo = cupoRestante(personas.length);

  function abrirChat() {
    if (!hrefDelChat) return;
    // Otra pestaña y no `router.push`: navegar acá desmontaría el motor y
    // cortaría la llamada. Que el chat se abra al lado es lo que permite las dos
    // cosas a la vez.
    window.open(hrefDelChat, "_blank", "noopener,noreferrer");
  }

  async function invitar(ids: string[]) {
    const resultado = await acciones.invitar({ callId, profileIds: ids });
    if (resultado.ok) router.refresh();
    return resultado;
  }

  /* ------------------------------- estados ------------------------------- */

  if (motor.fase === "error") {
    const { title, body } = mensajeDeError(motor.error?.motivo);
    return (
      <Marco>
        <TarjetaDeAviso title={title} body={body}>
          <Button variant="secondary" onClick={() => router.replace("/llamadas")}>
            {COPY.errores.salir}
          </Button>
          <Button onClick={() => window.location.reload()}>{COPY.errores.reintentar}</Button>
        </TarjetaDeAviso>
      </Marco>
    );
  }

  if (estado === "terminada" || estado === "perdida" || estado === "rechazada") {
    return (
      <Marco>
        <TarjetaDeAviso
          title={estado === "terminada" ? COPY.pantalla.terminada : COPY.historial.sinRespuesta}
          body={
            segundos > 0
              ? `Duró ${formatearDuracion(segundos)}.`
              : COPY.fallos.terminadaBody
          }
        >
          <Button onClick={() => router.replace("/llamadas")}>{COPY.pantalla.volver}</Button>
        </TarjetaDeAviso>
      </Marco>
    );
  }

  if (motor.fase === "en-espera") {
    return (
      <Marco>
        <TarjetaDeAviso
          title={titulo}
          body={kind === "video" ? COPY.pantalla.entrarHintVideo : COPY.pantalla.entrarHint}
        >
          <Button variant="secondary" onClick={() => router.replace("/llamadas")}>
            {COPY.errores.salir}
          </Button>
          <Button onClick={motor.arrancar}>{COPY.pantalla.entrar}</Button>
        </TarjetaDeAviso>
      </Marco>
    );
  }

  const estadoDeTexto =
    motor.fase === "reconectando"
      ? COPY.pantalla.reconectando
      : motor.fase === "preparando"
        ? COPY.pantalla.conectando
        : estado === "sonando"
          ? soyQuienLlama
            ? COPY.pantalla.llamando
            : COPY.pantalla.sonando
          : null;

  return (
    <Marco>
      {/* Estado de la llamada para lectores de pantalla: cambia poco y siempre
          importa, así que va en un live region educado y no en un alert. */}
      <p className="sr-only" role="status" aria-live="polite">
        {estadoDeTexto ?? COPY.pantalla.duracionLabel(duracionHablada(segundos))}
      </p>

      <header className="flex items-start gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-xs font-medium text-on-media/85 ring-1 ring-inset ring-white/10">
          <Users size={13} aria-hidden="true" />
          {COPY.pantalla.participantes(conectados.length + 1)}
        </span>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-base font-semibold text-on-media">{titulo}</p>
          <p className="mt-0.5 text-xs tabular-nums text-on-media/70">
            {estadoDeTexto ?? formatearDuracion(segundos)}
          </p>
        </div>

        <SelloSeguro />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {enGrilla ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <li className="aspect-[3/4] sm:aspect-square">
              <Mosaico
                className="size-full"
                nombre={yo.displayName}
                avatarUrl={yo.avatarUrl}
                video={motor.videoLocal}
                micApagado={motor.micApagado}
                camaraApagada={motor.camaraApagada}
                soyYo
                indice={0}
              />
            </li>
            {otros.map((otro, i) => (
              <li key={otro.persona.id} className="aspect-[3/4] sm:aspect-square">
                <Mosaico
                  className="size-full"
                  nombre={otro.persona.displayName}
                  avatarUrl={otro.persona.avatarUrl}
                  video={otro.video}
                  micApagado={otro.micApagado}
                  camaraApagada={otro.camaraApagada}
                  esperando={!otro.conectado}
                  indice={i + 1}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Dueto
            titulo={otros[0]?.persona.displayName ?? titulo}
            pais={subtituloPais}
            avatarUrl={otros[0]?.persona.avatarUrl ?? null}
            sonando={estado === "sonando"}
            videoRemoto={dueto?.video ?? null}
            micRemotoApagado={dueto?.micApagado ?? false}
            videoLocal={motor.videoLocal}
            miNombre={yo.displayName}
            miAvatar={yo.avatarUrl}
            micApagado={motor.micApagado}
            camaraApagada={motor.camaraApagada}
          />
        )}
      </div>

      <Controles
        kind={kind}
        micApagado={motor.micApagado}
        camaraApagada={motor.camaraApagada}
        sonidoApagado={motor.sonidoApagado}
        puedeAgregar={enLinea && cupo > 0}
        hrefDelChat={hrefDelChat}
        onMic={motor.alternarMic}
        onCamara={motor.alternarCamara}
        onSonido={motor.alternarSonido}
        onAgregar={() => setAgregarAbierto(true)}
        onChat={abrirChat}
        onFinalizar={() => motor.colgar("colgue")}
      />

      <HojaAgregar
        open={agregarAbierto}
        onClose={() => setAgregarAbierto(false)}
        candidatos={candidatos}
        yaEnLlamada={personas.map((p) => p.id)}
        cupo={cupo}
        onInvitar={invitar}
      />

      {/* Un aviso que no depende de la hoja: si la llamada se llenó mientras
          estaba abierta, el botón "Añadir" ya está deshabilitado y el motivo
          tiene que estar escrito en algún lado. */}
      {cupo === 0 && yoEnLista !== null && sigueEnLaLlamada(yoEnLista) && (
        <p className="pb-2 text-center text-[11px] text-on-media/60">{COPY.agregar.sinCupo}</p>
      )}
    </Marco>
  );
}

/* ------------------------------ piezas chicas ----------------------------- */

/**
 * El marco de la llamada.
 *
 * ── POR QUÉ SE SALE DEL SHELL ───────────────────────────────────────────────
 * El `<main>` de `(app)/layout.tsx` es una columna de 512px con padding y 7rem
 * de aire abajo para la barra de navegación. Una llamada adentro de esa columna
 * sería una llamada con bordes crema a los costados y la barra de "Inicio ·
 * Buscar · Perfil" tapando los controles: el peor lugar posible para poner
 * "Finalizar". Así que se dibuja fija sobre todo el shell, como ya hace el visor
 * de reels.
 *
 * El z-index NO es arbitrario y por eso no es `z-50`: la barra y el header viven
 * en 40, las hojas (`BottomSheet`) en 50 y los toasts en 70. 45 es exactamente
 * "arriba del shell, debajo de la hoja de Añadir" — con `z-50` la hoja quedaría
 * empatada con la pantalla y quién gana pasaría a depender del orden del DOM.
 *
 * `h-[100dvh]` y no `inset-0`: en iOS la barra del navegador se esconde al
 * hacer scroll y el viewport fijo queda más alto que lo que se ve, así que los
 * controles terminarían debajo del borde inferior de la pantalla.
 *
 * `caret-color: transparent`: acá no hay ni un campo de texto, y una barrita
 * parpadeando sobre un video es la marca más barata de "esto es una página web".
 * En la hoja de Añadir, que sí tiene buscador, el cursor vuelve solo porque la
 * hoja se dibuja en su propio portal, fuera de este árbol.
 */
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 top-0 z-45 flex h-[100dvh] flex-col overflow-hidden text-on-media [caret-color:transparent]">
      <FondoDeLlamada />
      {children}
    </div>
  );
}

function SelloSeguro() {
  return (
    <span
      title={COPY.pantalla.selloDetalle}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-success/15 px-2.5 text-[11px] font-semibold text-on-media ring-1 ring-inset ring-success/35"
    >
      <ShieldCheck size={13} weight="fill" aria-hidden="true" className="text-success" />
      <span className="hidden sm:inline">{COPY.pantalla.sello}</span>
      <span className="sr-only sm:hidden">{COPY.pantalla.sello}</span>
    </span>
  );
}

function TarjetaDeAviso({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm rounded-[2rem] bg-white/[0.07] p-1.5 ring-1 ring-inset ring-white/12 backdrop-blur-xl">
        <div className="rounded-[calc(2rem-0.375rem)] bg-black/25 px-6 py-7 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-white/10 text-on-media">
            <PhoneDisconnect size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-lg font-semibold text-on-media">{title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-on-media/75">{body}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * La llamada de a dos.
 *
 * Con video del otro lado, su imagen ocupa la pantalla y la mía queda en un
 * mosaico chico arriba a la derecha — nadie quiere verse a sí mismo en grande.
 * Sin video, un avatar grande con dos anillos que respiran mientras suena.
 */
function Dueto(props: {
  titulo: string;
  pais: string | null;
  avatarUrl: string | null;
  sonando: boolean;
  videoRemoto: IRemoteVideoTrack | null;
  micRemotoApagado: boolean;
  videoLocal: ILocalVideoTrack | null;
  miNombre: string;
  miAvatar: string | null;
  micApagado: boolean;
  camaraApagada: boolean;
}) {
  const conVideo = props.videoRemoto !== null;

  return (
    <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center">
      {conVideo ? (
        <Mosaico
          className="aspect-[3/4] w-full sm:aspect-video"
          nombre={props.titulo}
          avatarUrl={props.avatarUrl}
          video={props.videoRemoto}
          micApagado={props.micRemotoApagado}
          camaraApagada={false}
        />
      ) : (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="relative flex items-center justify-center">
            {props.sonando && (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    styles.halo,
                    "absolute size-24 rounded-full ring-2 ring-inset ring-on-media/50",
                  )}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    styles.haloTardio,
                    "absolute size-24 rounded-full ring-2 ring-inset ring-on-media/50",
                  )}
                />
              </>
            )}
            <span className="relative rounded-full p-1 ring-1 ring-inset ring-white/15">
              <Avatar src={props.avatarUrl} name={props.titulo} size="xl" />
            </span>
          </span>

          <div>
            <p className="font-display text-2xl font-semibold text-on-media">{props.titulo}</p>
            {props.pais && <p className="mt-1 text-sm text-on-media/70">{props.pais}</p>}
          </div>
        </div>
      )}

      {props.videoLocal && !props.camaraApagada && (
        <div className="absolute right-1 top-1 w-24 sm:w-32">
          <Mosaico
            className="aspect-[3/4] w-full"
            nombre={props.miNombre}
            avatarUrl={props.miAvatar}
            video={props.videoLocal}
            micApagado={props.micApagado}
            camaraApagada={false}
            soyYo
          />
        </div>
      )}
    </div>
  );
}

function mensajeDeError(motivo: string | undefined): { title: string; body: string } {
  switch (motivo) {
    case "permiso":
      return { title: COPY.errores.permisoTitle, body: COPY.errores.permisoBody };
    case "sin-dispositivo":
      return { title: COPY.errores.sinDispositivoTitle, body: COPY.errores.sinDispositivoBody };
    case "ocupado":
      return { title: COPY.errores.ocupadoTitle, body: COPY.errores.ocupadoBody };
    case "sin-contexto-seguro":
      return {
        title: COPY.errores.sinContextoSeguroTitle,
        body: COPY.errores.sinContextoSeguroBody,
      };
    case "sin-api":
      return { title: COPY.errores.sinApiTitle, body: COPY.errores.sinApiBody };
    case "token":
      return { title: COPY.errores.tokenTitle, body: COPY.errores.tokenBody };
    case "conexion":
      return { title: COPY.errores.conexionTitle, body: COPY.errores.conexionBody };
    default:
      return { title: COPY.errores.desconocidoTitle, body: COPY.errores.desconocidoBody };
  }
}

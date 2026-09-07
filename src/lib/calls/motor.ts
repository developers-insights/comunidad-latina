"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionState,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  ILocalVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
  UID,
} from "agora-rtc-sdk-ng";
import { cargarAgora, motivoSinMedios, soporteDeMedios, type MotivoSinMedios } from "./sdk";
import type { KindDeLlamada } from "./tipos";

/**
 * =============================================================================
 * EL MOTOR DE LA LLAMADA
 * =============================================================================
 *
 * Todo lo que toca a Agora vive acá; la pantalla sólo pinta lo que este hook
 * devuelve. Dos cosas que parecen detalles y no lo son:
 *
 * 1 · EL CANAL SE CIERRA DE VERDAD, Y POR TRES CAMINOS. Agora factura por minuto
 *     de participante conectado, no por llamada: una pestaña olvidada en segundo
 *     plano con el canal abierto sigue costando plata hasta que alguien la
 *     cierre. Por eso se cuelga al tocar Finalizar, al irse de la página
 *     (`pagehide`, que es el único evento que el bfcache de iOS garantiza —
 *     `beforeunload` y `unload` no se disparan ahí) y al quedarse solo en el
 *     canal más de `SOLO_DEMASIADO_MS`.
 *
 * 2 · EL PERMISO SE PIDE EN EL GESTO. `arrancar()` no se llama al montar: lo
 *     llama la pantalla cuando la persona toca Llamar o Atender. Un navegador
 *     que pide micrófono al abrir una URL es un navegador que la persona
 *     bloquea para siempre.
 */

const SOLO_DEMASIADO_MS = 60_000;

export type FaseDeLlamada =
  /** Todavía no tocó nada: el motor está dormido. */
  | "en-espera"
  /** Pidiendo micrófono/cámara y bajando el SDK. */
  | "preparando"
  /** Adentro del canal. */
  | "en-linea"
  /** Agora perdió la red y está reintentando solo. */
  | "reconectando"
  /** Se colgó — por decisión, por quedarse solo o porque se fue de la página. */
  | "cerrada"
  | "error";

export type MotivoDeCierre = "colgue" | "solo" | "sali-de-la-pagina";

export interface RemotoEnLlamada {
  uid: string;
  tieneVideo: boolean;
  tieneAudio: boolean;
  video: IRemoteVideoTrack | null;
}

export interface ErrorDeLlamada {
  motivo: MotivoSinMedios | "sin-contexto-seguro" | "sin-api" | "token" | "conexion";
}

export interface MotorDeLlamada {
  fase: FaseDeLlamada;
  error: ErrorDeLlamada | null;
  videoLocal: ILocalVideoTrack | null;
  remotos: RemotoEnLlamada[];
  micApagado: boolean;
  camaraApagada: boolean;
  sonidoApagado: boolean;
  arrancar: () => void;
  alternarMic: () => void;
  alternarCamara: () => void;
  alternarSonido: () => void;
  colgar: (motivo?: MotivoDeCierre) => void;
}

interface Credenciales {
  token: string;
  canal: string;
  uid: string;
  appId: string;
}

async function pedirCredenciales(callId: string): Promise<Credenciales> {
  const respuesta = await fetch("/api/llamadas/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callId }),
  });
  if (!respuesta.ok) throw new Error(`token ${respuesta.status}`);
  const datos: unknown = await respuesta.json();
  const d = datos as Partial<Credenciales>;
  if (!d.token || !d.canal || !d.uid || !d.appId) throw new Error("token incompleto");
  return { token: d.token, canal: d.canal, uid: d.uid, appId: d.appId };
}

export function useMotorDeLlamada(opciones: {
  callId: string;
  kind: KindDeLlamada;
  /** Se llama una vez cuando el canal se cierra, con el motivo. */
  alCerrar?: (motivo: MotivoDeCierre) => void;
}): MotorDeLlamada {
  const { callId, kind, alCerrar } = opciones;

  const [fase, setFase] = useState<FaseDeLlamada>("en-espera");
  const [error, setError] = useState<ErrorDeLlamada | null>(null);
  const [videoLocal, setVideoLocal] = useState<ILocalVideoTrack | null>(null);
  const [remotos, setRemotos] = useState<RemotoEnLlamada[]>([]);
  const [micApagado, setMicApagado] = useState(false);
  const [camaraApagada, setCamaraApagada] = useState(kind === "audio");
  const [sonidoApagado, setSonidoApagado] = useState(false);

  const clienteRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const camaraRef = useRef<ICameraVideoTrack | null>(null);
  const cerradoRef = useRef(false);
  const arrancadoRef = useRef(false);
  const alCerrarRef = useRef(alCerrar);
  alCerrarRef.current = alCerrar;

  /**
   * Un solo cierre, pase lo que pase.
   *
   * `cerradoRef` no es paranoia: colgar y cerrar la pestaña al mismo tiempo es
   * el caso normal (se toca Finalizar y se cierra), y `leave()` dos veces
   * rechaza con un error que taparía el motivo real en los logs.
   */
  const colgar = useCallback((motivo: MotivoDeCierre = "colgue") => {
    if (cerradoRef.current) return;
    cerradoRef.current = true;

    const cliente = clienteRef.current;
    clienteRef.current = null;

    for (const pista of [micRef.current, camaraRef.current]) {
      try {
        pista?.stop();
        pista?.close();
      } catch {
        // Una pista ya cerrada no es un problema: el objetivo era que no quede viva.
      }
    }
    micRef.current = null;
    camaraRef.current = null;
    setVideoLocal(null);
    setRemotos([]);

    // `leave()` es asíncrono y esto puede correr en `pagehide`, donde ya no hay
    // turno para esperarlo. Se dispara y no se espera: el servidor de Agora
    // igual cierra la sesión cuando el transporte muere, y esto sólo acelera.
    void cliente?.leave().catch(() => undefined);

    setFase("cerrada");
    alCerrarRef.current?.(motivo);
  }, []);

  // El handler de `user-published` se registra UNA vez y necesita leer el valor
  // VIGENTE del sonido, no el que había cuando se registró.
  const sonidoApagadoRef = useRef(sonidoApagado);
  sonidoApagadoRef.current = sonidoApagado;

  const arrancar = useCallback(() => {
    if (arrancadoRef.current) return;
    arrancadoRef.current = true;

    const soporte = soporteDeMedios();
    if (soporte !== "ok") {
      setError({ motivo: soporte });
      setFase("error");
      return;
    }

    setFase("preparando");

    void (async () => {
      let credenciales: Credenciales;
      try {
        credenciales = await pedirCredenciales(callId);
      } catch {
        setError({ motivo: "token" });
        setFase("error");
        return;
      }

      const AgoraRTC = await cargarAgora();
      if (cerradoRef.current) return;

      const cliente = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clienteRef.current = cliente;

      cliente.on("user-published", (usuario, tipo) => {
        void (async () => {
          try {
            await cliente.subscribe(usuario, tipo);
          } catch {
            return;
          }
          if (tipo === "audio") {
            usuario.audioTrack?.play();
            // Quien entra a una llamada con el sonido apagado tiene que seguir
            // sin escuchar al que llegue después.
            usuario.audioTrack?.setVolume(sonidoApagadoRef.current ? 0 : 100);
          }
          refrescarRemotos(cliente, setRemotos);
        })();
      });

      cliente.on("user-unpublished", () => refrescarRemotos(cliente, setRemotos));
      cliente.on("user-joined", () => refrescarRemotos(cliente, setRemotos));
      cliente.on("user-left", () => refrescarRemotos(cliente, setRemotos));

      cliente.on("connection-state-change", (estado: ConnectionState) => {
        if (cerradoRef.current) return;
        if (estado === "RECONNECTING") setFase("reconectando");
        else if (estado === "CONNECTED") setFase("en-linea");
      });

      /**
       * El token vence en minutos (ver token-de-agora.ts). Agora avisa 30 s
       * antes; acá se pide uno nuevo al MISMO endpoint, que vuelve a comprobar
       * contra la base que la persona siga siendo participante. O sea: sacar a
       * alguien de la llamada tiene efecto real en la renovación siguiente, no
       * sólo en la UI.
       */
      cliente.on("token-privilege-will-expire", () => {
        void (async () => {
          try {
            const frescas = await pedirCredenciales(callId);
            await cliente.renewToken(frescas.token);
          } catch {
            colgar("colgue");
          }
        })();
      });

      try {
        await cliente.join(
          credenciales.appId,
          credenciales.canal,
          credenciales.token,
          credenciales.uid,
        );
      } catch {
        if (!cerradoRef.current) {
          setError({ motivo: "conexion" });
          setFase("error");
        }
        return;
      }

      if (cerradoRef.current) {
        void cliente.leave().catch(() => undefined);
        return;
      }

      try {
        const mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true });
        micRef.current = mic;

        const publicar: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = [mic];

        if (kind === "video") {
          const camara = await AgoraRTC.createCameraVideoTrack({
            encoderConfig: "480p_1",
          });
          camaraRef.current = camara;
          publicar.push(camara);
          setVideoLocal(camara);
          setCamaraApagada(false);
        }

        if (cerradoRef.current) return;
        await cliente.publish(publicar);
      } catch (e) {
        // Entró al canal pero no puede publicar: se avisa y se cierra, en vez de
        // dejarla adentro de una sala donde nadie la oye y el minuto se cobra.
        setError({ motivo: motivoSinMedios(e) });
        setFase("error");
        colgar("colgue");
        return;
      }

      if (!cerradoRef.current) {
        setFase("en-linea");
        refrescarRemotos(cliente, setRemotos);
      }
    })();
  }, [callId, kind, colgar]);

  const alternarMic = useCallback(() => {
    const mic = micRef.current;
    if (!mic) return;
    const proximo = !mic.muted;
    void mic.setMuted(proximo).catch(() => undefined);
    setMicApagado(proximo);
  }, []);

  /**
   * `setEnabled` y no `setMuted`, y sólo para la cámara.
   *
   * `setMuted` deja de mandar pero sigue capturando: la luz de la cámara queda
   * encendida y quien apagó el video cree que lo apagó. `setEnabled(false)`
   * suelta el dispositivo —la luz se apaga— y despublica la pista. Para el
   * micrófono es al revés: `setEnabled` tarda cientos de milisegundos en volver
   * y silenciar/hablar es lo que más se toca en una llamada.
   */
  const alternarCamara = useCallback(() => {
    const camara = camaraRef.current;
    if (!camara) return;
    const apagar = camara.enabled;
    void camara.setEnabled(!apagar).catch(() => undefined);
    setCamaraApagada(apagar);
    setVideoLocal(apagar ? null : camara);
  }, []);

  /**
   * En la web no existe el "altavoz vs auricular" del teléfono: el ruteo de
   * salida lo decide el sistema operativo y el navegador no lo expone. Lo que sí
   * se puede —y es lo que la persona quiere cuando toca ese botón— es dejar de
   * escuchar la llamada sin salirse de ella. Eso es esto.
   *
   * El estado se lee del ref y no del `setState` funcional a propósito: adentro
   * de un updater no van efectos (React lo puede invocar dos veces).
   */
  const alternarSonido = useCallback(() => {
    const cliente = clienteRef.current;
    if (!cliente) return;
    const proximo = !sonidoApagadoRef.current;
    for (const usuario of cliente.remoteUsers) {
      usuario.audioTrack?.setVolume(proximo ? 0 : 100);
    }
    sonidoApagadoRef.current = proximo;
    setSonidoApagado(proximo);
  }, []);

  /** Irse de la página cierra el canal. Ver §1 de la cabecera. */
  useEffect(() => {
    const alIrse = () => colgar("sali-de-la-pagina");
    window.addEventListener("pagehide", alIrse);
    return () => {
      window.removeEventListener("pagehide", alIrse);
      colgar("sali-de-la-pagina");
    };
  }, [colgar]);

  /**
   * Solo en el canal por más de un minuto = la llamada terminó y alguien se
   * olvidó la pestaña abierta. Se cierra sola: es el único punto de este módulo
   * donde no cerrar cuesta dinero de forma indefinida.
   */
  useEffect(() => {
    if (fase !== "en-linea" || remotos.length > 0) return;
    const id = window.setTimeout(() => colgar("solo"), SOLO_DEMASIADO_MS);
    return () => window.clearTimeout(id);
  }, [fase, remotos.length, colgar]);

  return {
    fase,
    error,
    videoLocal,
    remotos,
    micApagado,
    camaraApagada,
    sonidoApagado,
    arrancar,
    alternarMic,
    alternarCamara,
    alternarSonido,
    colgar,
  };
}

/**
 * La lista de remotos se REDERIVA de `client.remoteUsers` en cada evento en vez
 * de mantenerse a mano. Llevar un Map propio significa acertarle a los seis
 * eventos siempre; leer la fuente significa acertarle una vez.
 */
function refrescarRemotos(
  cliente: IAgoraRTCClient,
  setRemotos: (valor: RemotoEnLlamada[]) => void,
): void {
  setRemotos(
    cliente.remoteUsers.map((usuario: IAgoraRTCRemoteUser) => ({
      uid: uidComoTexto(usuario.uid),
      tieneVideo: usuario.hasVideo,
      tieneAudio: usuario.hasAudio,
      video: usuario.videoTrack ?? null,
    })),
  );
}

/**
 * El servidor firma siempre un uid de texto (el id de perfil), así que en la
 * práctica esto no convierte nada — existe porque el tipo `UID` del SDK admite
 * número y sin esto habría que mentirle al compilador.
 */
export function uidComoTexto(uid: UID): string {
  return typeof uid === "string" ? uid : String(uid);
}

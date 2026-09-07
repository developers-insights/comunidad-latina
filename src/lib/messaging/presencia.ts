import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * "EN LÍNEA" Y "ÚLTIMA VEZ" — contrato compartido (migración 0145)
 * =============================================================================
 *
 * Lo importan por igual la bandeja (servidor), el encabezado del hilo
 * (navegador) y el latido de presencia. Un solo lugar decide qué se muestra y
 * cómo se lee, porque el dato es sensible: dice cuándo estuvo alguien frente al
 * teléfono.
 *
 * ─── LA AUSENCIA DEL DATO ES LA RESPUESTA ───────────────────────────────────
 * `presencia_de` devuelve `en_linea = false` y `ultima_vez = null` cuando la
 * persona apagó `mostrar_ultima_vez`. Eso NO se pinta como "desconocido" ni
 * como un punto gris: no se pinta nada. Un estado vacío con forma propia sigue
 * delatando que hay alguien del otro lado que eligió no mostrarse — que es
 * justo lo que apagó. Por eso `presenciaVisible` devuelve `null` y quien la
 * consume no dibuja el renglón.
 *
 * ─── LA 0145 PUEDE NO ESTAR APLICADA ────────────────────────────────────────
 * Mientras no lo esté, la RPC no existe y `leerPresencia` devuelve un mapa
 * vacío. La bandeja y el hilo se pintan igual, sin el renglón. Ninguna pantalla
 * puede caerse porque falte un adorno.
 */

/**
 * `escribiendo` sigue sin tener fuente: no hay Supabase Realtime en el repo y
 * un "está escribiendo" derivado del refresco de 15 s miente. Vive en el tipo
 * porque la fila de la bandeja ya sabe pintarlo — ver `inbox-row.tsx`.
 */
export type EstadoDePresencia =
  | { tipo: "escribiendo" }
  | { tipo: "en-linea" }
  | { tipo: "ultima-vez"; cuando: string };

export interface PresenciaDePerfil {
  enLinea: boolean;
  /** ISO, o `null` si la persona apagó que se vea. */
  ultimaVez: string | null;
}

/**
 * Tope de la RPC (0145 §4). Pasarse LANZA `TOO_MANY_PROFILES` — no devuelve
 * menos filas—, así que partir en tandas no es una optimización: es la
 * diferencia entre que la bandeja tenga presencia o no la tenga.
 */
export const MAX_IDS_POR_CONSULTA = 100;

/**
 * NO SUBIR DE 2 MINUTOS. `presencia_de` considera "en línea" a quien tocó
 * presencia en los últimos 2 minutos (0145 §4); un latido más espaciado que esa
 * ventana deja intermitente a alguien que tiene la app abierta. El minuto es la
 * mitad justa, que es lo que da margen a un request lento.
 *
 * La RPC ya trae anti-rebote propio (no escribe si la marca tiene menos de
 * 60 s), pero eso ahorra la ESCRITURA, no el viaje: sin este freno del lado del
 * cliente cada navegación seguiría gastando un request. Ver `presence-beat.tsx`.
 */
export const MINIMO_ENTRE_TOQUES_MS = 60_000;

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;
/** A partir de acá el número exacto de días deja de decir algo útil. */
const TOPE_EN_DIAS = 30;

/**
 * Cómo se lee la antigüedad DESPUÉS de "Última vez" (ver `COPY.inbox.resumen`).
 *
 * Se arma a mano y no con `Intl.RelativeTimeFormat` a propósito: el formateador
 * con `numeric: "auto"` devuelve "ayer" y "anteayer", que suenan bien sueltos y
 * mal detrás de "Última vez", y además dependen del `locale` que resuelva cada
 * runtime — o sea que el servidor y el navegador podrían escribir distinto la
 * misma fila e hidratar con un salto visible.
 */
export function textoDeUltimaVez(ultimaVez: string, ahora: Date = new Date()): string | null {
  const cuando = new Date(ultimaVez);
  if (Number.isNaN(cuando.getTime())) return null;

  // Un reloj adelantado del otro lado no puede producir "hace -3 minutos".
  const transcurrido = Math.max(0, ahora.getTime() - cuando.getTime());

  if (transcurrido < MINUTO_MS) return "hace un momento";

  const minutos = Math.floor(transcurrido / MINUTO_MS);
  if (minutos < 60) return minutos === 1 ? "hace 1 minuto" : `hace ${minutos} minutos`;

  const horas = Math.floor(transcurrido / HORA_MS);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;

  const dias = Math.floor(transcurrido / DIA_MS);
  if (dias > TOPE_EN_DIAS) return "hace más de un mes";
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/**
 * Qué se pinta, o nada. `null` significa literalmente "no dibujes el renglón".
 */
export function presenciaVisible(
  presencia: PresenciaDePerfil | undefined,
  ahora: Date = new Date(),
): EstadoDePresencia | null {
  if (!presencia) return null;
  if (presencia.enLinea) return { tipo: "en-linea" };
  if (!presencia.ultimaVez) return null;

  const cuando = textoDeUltimaVez(presencia.ultimaVez, ahora);
  return cuando === null ? null : { tipo: "ultima-vez", cuando };
}

interface PresenciaRow {
  profile_id: string;
  en_linea: boolean;
  ultima_vez: string | null;
}

/**
 * `presencia_de` no está en `database.types.ts` — los tipos se regeneran aparte
 * y la 0145 puede no estar aplicada todavía. Mismo escape que `tag-policy.ts`.
 */
type OpenClient = SupabaseClient;

/**
 * La presencia de hasta N perfiles, en tandas de 100 y en paralelo.
 *
 * Devuelve un mapa por `profile_id`; los ids que la RPC no contesta quedan
 * afuera, y quien los consulte recibe `undefined` → no se pinta nada, que es
 * el mismo camino que "esta persona apagó que se vea".
 */
export async function leerPresencia(
  client: SupabaseClient,
  profileIds: readonly string[],
): Promise<Map<string, PresenciaDePerfil>> {
  const unicos = [...new Set(profileIds.filter(Boolean))];
  if (unicos.length === 0) return new Map();

  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += MAX_IDS_POR_CONSULTA) {
    tandas.push(unicos.slice(i, i + MAX_IDS_POR_CONSULTA));
  }

  const open = client as OpenClient;
  const resultados = await Promise.all(
    tandas.map((ids) => open.rpc("presencia_de", { ids })),
  );

  const mapa = new Map<string, PresenciaDePerfil>();
  for (const { data, error } of resultados) {
    if (error) {
      // 42883 = la 0145 todavía no corrió en este entorno. Cualquier otro
      // código: mismo criterio, la bandeja se lee igual sin el renglón.
      console.warn("[mensajes] no se pudo leer la presencia", { code: error.code });
      continue;
    }
    for (const fila of (data ?? []) as PresenciaRow[]) {
      mapa.set(fila.profile_id, {
        enLinea: Boolean(fila.en_linea),
        ultimaVez: fila.ultima_vez ?? null,
      });
    }
  }
  return mapa;
}

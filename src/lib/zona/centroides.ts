import { normalizeGeoLabel, sameZoneLabel } from "@/lib/boosts/scope";
import { ZONAS_MATCH_MAX, zonasCoincidentes } from "./coincidencias";

/**
 * =============================================================================
 * CENTROIDES DE BARRIO — la única geografía numérica de esta app
 * =============================================================================
 *
 * MÓDULO PURO a propósito (sin Supabase, sin React, sin `server-only`): lo
 * importan la action que resuelve "usar mi ubicación", la resolución de la
 * vista de zona y los tests. Mismo criterio que `./coincidencias` y
 * `@/lib/boosts/scope`.
 *
 * ── LO QUE ESTE ARCHIVO NO ES ───────────────────────────────────────────────
 * No es la ubicación de nadie. Cada fila es el centro APROXIMADO de un BARRIO
 * —un dato público, el mismo que imprime cualquier mapa— y por eso puede vivir
 * en el código y en una tabla que lee cualquiera. La 0004 lo dejó escrito con
 * todas las letras: PROHIBIDO point exacto o dirección en columnas públicas.
 * Este módulo existe justamente para poder hacer geografía SIN violar eso.
 *
 * El recorrido completo de "usar mi ubicación" es:
 *
 *     navegador → lat/lng → server action → barrio más cercano → `cl-zona`
 *                               ↑                                    ↑
 *                     la coordenada muere acá          se guarda SOLO el barrio
 *
 * La coordenada cruda no se persiste, no se loguea y no vuelve al cliente. Lo
 * único que sobrevive al request es una etiqueta de texto —"Corona, Queens"—
 * que la persona podría haber elegido a mano de la misma lista. O sea: la
 * feature ahorra toques, no baja el listón de privacidad ni un punto.
 *
 * ── POR QUÉ EL CATÁLOGO VIVE EN EL CÓDIGO Y NO EN UNA TABLA ─────────────────
 * Resolver el barrio más cercano es una cuenta sobre ~70 filas fijas que no
 * cambian nunca. Hacerla contra la base sería una consulta por request en el
 * camino más caliente de la app: `resolverVistaZona` corre en el header y en
 * los siete listados, y el scroll infinito del feed la repite en cada tanda
 * (el mismo problema que el memo de `listarZonasDelTenant` acaba de resolver
 * para las zonas publicadas). Un `select` para leer una constante es una
 * consulta que no se puede justificar.
 *
 * Y son datos de otra naturaleza: los barrios de Nueva York no son contenido de
 * la comunidad, son geografía. No los edita nadie desde la app, no dependen del
 * tenant y no tienen RLS que discutir. Un `const` es la forma honesta de decir
 * eso; una tabla insinuaría que se administran.
 *
 * SI ALGÚN DÍA hace falta administrarlos —agregar un barrio sin deploy, o que
 * el filtro de radio se resuelva del lado de SQL dentro de una función de
 * página— la tabla `public.zone_centroids` es el paso siguiente, sembrada
 * DESDE esta constante y con un test de paridad que impida la divergencia. Hoy
 * no existe, y este módulo no la necesita para funcionar.
 *
 * ── CÓMO SE ELIGIERON LOS BARRIOS ───────────────────────────────────────────
 * Arranca por los que YA aparecen en los datos de esta comunidad (Corona,
 * Jackson Heights, Elmhurst, Flushing, Woodside, Astoria, Jamaica) y se
 * completa con el resto de Queens, los cinco condados, y los polos latinos del
 * área metropolitana donde esta comunidad efectivamente se mueve. Un radio de
 * 25 millas desde Corona cruza a Nueva Jersey: si esos lugares no estuvieran,
 * el filtro prometería un área y devolvería otra.
 */

/** Un punto en el mundo. Se usa de paso; nunca se guarda. */
export interface Coordenada {
  lat: number;
  lng: number;
}

/** El centro público de un barrio. `label` es la forma canónica de escribirlo. */
export interface Centroide extends Coordenada {
  label: string;
}

/**
 * Radio medio de la Tierra en millas (6371.0088 km ÷ 1.609344).
 *
 * Millas terrestres, que es la unidad que pidió el cliente y la que usa la
 * gente acá. Nada en la app convierte a kilómetros: si algún día hace falta, se
 * convierte al MOSTRAR, nunca al calcular.
 */
export const RADIO_TIERRA_MILLAS = 3958.7613;

/**
 * Hasta dónde puede estar el barrio más cercano para que "usar mi ubicación"
 * conteste algo.
 *
 * Sin este techo, alguien abriendo la app desde Miami o desde Santo Domingo
 * quedaría "en Queens" porque es lo más cercano que hay en el catálogo — una
 * respuesta segura de sí misma y falsa, que además le cambiaría lo que ve sin
 * que entienda por qué. 60 millas cubre toda el área metropolitana (los cinco
 * condados, el norte de Nueva Jersey, el oeste de Long Island, Westchester) y
 * corta ahí.
 *
 * Fuera de ese radio la action responde "no encontramos un barrio cerca" y la
 * hoja se queda abierta para elegir a mano. Decir "no sé" también es contestar.
 */
export const SNAP_MAX_MILLAS = 60;

/**
 * El catálogo. `label` se escribe como la gente escribe su `area_label`
 * ("Corona, Queens"), porque es el valor que termina guardado en `cl-zona` y
 * comparado contra `listings.area_label`.
 *
 * Las coordenadas son el centro del barrio con cuatro decimales (~11 m de
 * resolución). Más precisión sería falsa: un barrio no es un punto.
 *
 * ORDEN: Queens primero (es donde vive esta comunidad), después el resto de los
 * condados, después el área metropolitana, y al final los condados enteros —
 * ver por qué los enteros van últimos en `centroideDeZona`. Adentro de cada
 * bloque, alfabético, y el test lo verifica: una lista de 70 nombres sin orden
 * garantizado se llena de duplicados en el tercer agregado.
 */
export const CENTROIDES: readonly Centroide[] = [
  // ── Queens ───────────────────────────────────────────────────────────────
  { label: "Astoria, Queens", lat: 40.7644, lng: -73.9235 },
  { label: "Bayside, Queens", lat: 40.7686, lng: -73.771 },
  { label: "College Point, Queens", lat: 40.7847, lng: -73.8432 },
  { label: "Corona, Queens", lat: 40.7498, lng: -73.862 },
  { label: "East Elmhurst, Queens", lat: 40.7644, lng: -73.8722 },
  { label: "Elmhurst, Queens", lat: 40.7362, lng: -73.877 },
  { label: "Far Rockaway, Queens", lat: 40.6046, lng: -73.7551 },
  { label: "Flushing, Queens", lat: 40.7654, lng: -73.8318 },
  { label: "Forest Hills, Queens", lat: 40.7196, lng: -73.8448 },
  { label: "Glendale, Queens", lat: 40.7017, lng: -73.8836 },
  { label: "Jackson Heights, Queens", lat: 40.7557, lng: -73.8831 },
  { label: "Jamaica, Queens", lat: 40.702, lng: -73.7889 },
  { label: "Kew Gardens, Queens", lat: 40.7085, lng: -73.8303 },
  { label: "Long Island City, Queens", lat: 40.7447, lng: -73.9485 },
  { label: "Maspeth, Queens", lat: 40.7294, lng: -73.906 },
  { label: "Ozone Park, Queens", lat: 40.6764, lng: -73.8448 },
  { label: "Rego Park, Queens", lat: 40.7257, lng: -73.8624 },
  { label: "Richmond Hill, Queens", lat: 40.696, lng: -73.8318 },
  { label: "Ridgewood, Queens", lat: 40.7002, lng: -73.906 },
  { label: "Rosedale, Queens", lat: 40.6659, lng: -73.7382 },
  { label: "Springfield Gardens, Queens", lat: 40.6654, lng: -73.7629 },
  { label: "Sunnyside, Queens", lat: 40.7433, lng: -73.9196 },
  { label: "Whitestone, Queens", lat: 40.792, lng: -73.8095 },
  { label: "Woodhaven, Queens", lat: 40.6894, lng: -73.8579 },
  { label: "Woodside, Queens", lat: 40.7454, lng: -73.9066 },

  // ── Brooklyn ─────────────────────────────────────────────────────────────
  { label: "Bay Ridge, Brooklyn", lat: 40.6264, lng: -74.0299 },
  { label: "Bedford-Stuyvesant, Brooklyn", lat: 40.6872, lng: -73.9418 },
  { label: "Borough Park, Brooklyn", lat: 40.6329, lng: -73.9932 },
  { label: "Bushwick, Brooklyn", lat: 40.6944, lng: -73.9213 },
  { label: "Coney Island, Brooklyn", lat: 40.5755, lng: -73.9707 },
  { label: "Crown Heights, Brooklyn", lat: 40.6694, lng: -73.9422 },
  { label: "East New York, Brooklyn", lat: 40.6694, lng: -73.8821 },
  { label: "Flatbush, Brooklyn", lat: 40.6409, lng: -73.9624 },
  { label: "Sunset Park, Brooklyn", lat: 40.6455, lng: -74.0122 },
  { label: "Williamsburg, Brooklyn", lat: 40.7081, lng: -73.9571 },

  // ── El Bronx ─────────────────────────────────────────────────────────────
  { label: "Concourse, Bronx", lat: 40.83, lng: -73.92 },
  { label: "Fordham, Bronx", lat: 40.861, lng: -73.8896 },
  { label: "Hunts Point, Bronx", lat: 40.8125, lng: -73.884 },
  { label: "Kingsbridge, Bronx", lat: 40.8811, lng: -73.9051 },
  { label: "Mott Haven, Bronx", lat: 40.8091, lng: -73.9229 },
  { label: "Riverdale, Bronx", lat: 40.8901, lng: -73.9126 },
  { label: "Soundview, Bronx", lat: 40.8244, lng: -73.8724 },

  // ── Manhattan ────────────────────────────────────────────────────────────
  { label: "Chelsea, Manhattan", lat: 40.7465, lng: -74.0014 },
  { label: "East Harlem, Manhattan", lat: 40.7957, lng: -73.9389 },
  { label: "Harlem, Manhattan", lat: 40.8116, lng: -73.9465 },
  { label: "Inwood, Manhattan", lat: 40.8677, lng: -73.9212 },
  { label: "Lower East Side, Manhattan", lat: 40.715, lng: -73.9843 },
  { label: "Midtown, Manhattan", lat: 40.7549, lng: -73.984 },
  { label: "Upper East Side, Manhattan", lat: 40.7736, lng: -73.9566 },
  { label: "Upper West Side, Manhattan", lat: 40.787, lng: -73.9754 },
  { label: "Washington Heights, Manhattan", lat: 40.8417, lng: -73.9394 },

  // ── Staten Island ────────────────────────────────────────────────────────
  { label: "Port Richmond, Staten Island", lat: 40.6353, lng: -74.1329 },
  { label: "St. George, Staten Island", lat: 40.6437, lng: -74.0765 },

  // ── Área metropolitana ───────────────────────────────────────────────────
  // No es relleno: a 25 millas de Corona, el norte de Nueva Jersey y el oeste
  // de Long Island están adentro del círculo. Sin estas filas el radio
  // prometería un área y devolvería otra.
  { label: "Elizabeth, NJ", lat: 40.6639, lng: -74.2107 },
  { label: "Freeport, NY", lat: 40.6576, lng: -73.5832 },
  { label: "Hempstead, NY", lat: 40.7062, lng: -73.6187 },
  { label: "Mount Vernon, NY", lat: 40.9126, lng: -73.8371 },
  { label: "New Rochelle, NY", lat: 40.9115, lng: -73.7824 },
  { label: "Newark, NJ", lat: 40.7357, lng: -74.1724 },
  { label: "Passaic, NJ", lat: 40.8568, lng: -74.1285 },
  { label: "Paterson, NJ", lat: 40.9168, lng: -74.1718 },
  { label: "Union City, NJ", lat: 40.7795, lng: -74.0238 },
  { label: "West New York, NJ", lat: 40.7879, lng: -74.0143 },
  { label: "Yonkers, NY", lat: 40.9312, lng: -73.8988 },

  // ── Los condados enteros ─────────────────────────────────────────────────
  // Van ÚLTIMOS y no primeros a propósito: `centroideDeZona` resuelve por
  // igualdad exacta ANTES que por contención, así que "Queens, NY" cae acá y
  // "Corona, Queens" cae en su barrio. Existen porque hay `area_label`
  // cargados así —el seed tiene "New York, NY"— y sin ellos esa gente no
  // tendría centro desde el cual medir.
  { label: "Bronx, NY", lat: 40.8448, lng: -73.8648 },
  { label: "Brooklyn, NY", lat: 40.6782, lng: -73.9442 },
  { label: "Manhattan, NY", lat: 40.7831, lng: -73.9712 },
  { label: "New York, NY", lat: 40.7128, lng: -74.006 },
  { label: "Queens, NY", lat: 40.7282, lng: -73.7949 },
  { label: "Staten Island, NY", lat: 40.5795, lng: -74.1502 },
];

const GRADOS_A_RADIANES = Math.PI / 180;

/**
 * Distancia sobre la superficie de la Tierra, en millas (Haversine).
 *
 * Haversine y no una aproximación plana: a 100 millas el error de tratar el
 * mundo como una hoja ya se cuenta en millas, y 100 es justamente el filtro más
 * grande que ofrece la app. Es trigonometría sobre ~70 filas: no hay nada que
 * optimizar acá.
 *
 * El `Math.min(1, …)` no es paranoia: cubre el error de redondeo que puede
 * empujar la raíz apenas por encima de 1 en puntos casi antipodales, donde
 * `asin` devolvería `NaN` y contaminaría el orden entero.
 */
export function distanciaEnMillas(a: Coordenada, b: Coordenada): number {
  const dLat = (b.lat - a.lat) * GRADOS_A_RADIANES;
  const dLng = (b.lng - a.lng) * GRADOS_A_RADIANES;
  const lat1 = a.lat * GRADOS_A_RADIANES;
  const lat2 = b.lat * GRADOS_A_RADIANES;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * RADIO_TIERRA_MILLAS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ¿Es una coordenada de la Tierra?
 *
 * Lo que llega de `navigator.geolocation` cruza el borde cliente→servidor, así
 * que es entrada del cliente y se trata como tal — mismo criterio que
 * `sanitizeZona` con la cookie. `Number.isFinite` descarta `NaN` e `Infinity`,
 * que pasarían cualquier comparación de rango sin quejarse.
 */
export function esCoordenadaValida(punto: unknown): punto is Coordenada {
  if (typeof punto !== "object" || punto === null) return false;
  const { lat, lng } = punto as Partial<Coordenada>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * El centroide de una etiqueta de zona, o `null` si el catálogo no la conoce.
 *
 * DOS PASADAS, y el orden importa:
 *
 *   1. igualdad NORMALIZADA — "corona, queens" y "Corona, Queens" son la misma
 *      fila, y "Queens, NY" cae en el condado y no en cualquier barrio que lo
 *      contenga.
 *   2. recién si no hubo igualdad, el match LAXO de `sameZoneLabel` — el mismo
 *      que ya decide si un impulso local te alcanza. Así "Corona" a secas
 *      encuentra "Corona, Queens" sin que nadie tenga que escribir el condado.
 *
 * Cuando la pasada laxa deja varios candidatos (pasa con etiquetas muy vagas)
 * gana la de ETIQUETA MÁS CORTA y, a igual largo, la primera en orden
 * alfabético. Es una regla arbitraria pero DETERMINISTA y testeada: lo que no
 * puede pasar es que la misma etiqueta caiga en un barrio distinto según el
 * día. La alternativa —no contestar ante la ambigüedad— dejaría sin radio a
 * quien escribió su zona a mano, que es justo a quien más le sirve.
 */
export function centroideDeZona(label: string | null | undefined): Centroide | null {
  const buscado = normalizeGeoLabel(typeof label === "string" ? label : "");
  if (!buscado) return null;

  for (const centroide of CENTROIDES) {
    if (normalizeGeoLabel(centroide.label) === buscado) return centroide;
  }

  let mejor: Centroide | null = null;
  let mejorLargo = Number.POSITIVE_INFINITY;
  for (const centroide of CENTROIDES) {
    if (!sameZoneLabel(label, centroide.label)) continue;
    const largo = normalizeGeoLabel(centroide.label).length;
    if (largo < mejorLargo) {
      mejor = centroide;
      mejorLargo = largo;
    } else if (largo === mejorLargo && mejor !== null && centroide.label < mejor.label) {
      mejor = centroide;
    }
  }
  return mejor;
}

/** Lo que devuelve `barrioMasCercano`: el barrio y a qué distancia quedó. */
export interface BarrioCercano {
  centroide: Centroide;
  millas: number;
}

/**
 * El barrio del catálogo más cercano a un punto, o `null` si no hay ninguno
 * dentro de `maxMillas`.
 *
 * Esta es la función que convierte una coordenada en una etiqueta, o sea el
 * único lugar de la app donde la ubicación de una persona se toca. Recibe el
 * punto, mide ~70 distancias y devuelve un nombre de barrio: la `Coordenada`
 * que entró no sale de acá ni siquiera en el valor de retorno.
 */
export function barrioMasCercano(
  punto: Coordenada,
  maxMillas: number = SNAP_MAX_MILLAS,
): BarrioCercano | null {
  if (!esCoordenadaValida(punto)) return null;

  let mejor: BarrioCercano | null = null;
  for (const centroide of CENTROIDES) {
    const millas = distanciaEnMillas(punto, centroide);
    if (millas > maxMillas) continue;
    if (mejor === null || millas < mejor.millas) mejor = { centroide, millas };
  }
  return mejor;
}

/**
 * Las etiquetas de `area_label` que caen dentro de `millas` alrededor de la
 * zona activa.
 *
 * `null` significa NO PUEDO APLICAR EL RADIO —no hay zona elegida, o el
 * catálogo no conoce su centro— y quien llama tiene que caer al filtro de
 * siempre (`zonasCoincidentes`). Es distinto de `[]`, que en el vocabulario de
 * este módulo significa "no filtres": devolver `[]` acá dejaría a alguien
 * mirando toda la comunidad porque pidió un radio, que es lo contrario de lo
 * que pidió.
 *
 * ── LA SEMILLA NO ES OPCIONAL ───────────────────────────────────────────────
 * El resultado SIEMPRE arranca por lo que `zonasCoincidentes` habría devuelto
 * sin radio. Un radio es una AMPLIACIÓN: pedir "25 millas alrededor de Corona"
 * y ver MENOS avisos que con "Corona" a secas sería un absurdo, y pasaría con
 * solo que a un `area_label` del propio barrio no le encontráramos centroide.
 *
 * ── LAS ETIQUETAS SIN CENTROIDE QUEDAN AFUERA, Y ESTÁ BIEN ──────────────────
 * `area_label` es texto libre: alguien puede haber escrito "cerca del parque".
 * Sin centro no hay forma de saber si está adentro del círculo, y meterla por
 * las dudas convertiría el radio en "esto más cualquier cosa". Quedan afuera,
 * salvo que la semilla ya las hubiera traído por nombre.
 *
 * ── EL TECHO CORTA POR LAS MÁS LEJANAS ──────────────────────────────────────
 * Mismo `ZONAS_MATCH_MAX` que `zonasCoincidentes` y por el mismo motivo (el
 * `.in()` viaja en el querystring, y este repo tiene documentado el techo de
 * 8 KB de URL). Acá sí hay un criterio para elegir qué se cae: se ordena por
 * distancia y se recorta el final. Si 25 etiquetas no alcanzan, lo que sobra es
 * el borde del círculo, no la cuadra de al lado.
 */
export function zonasEnRadio(
  zona: string | null | undefined,
  millas: number,
  zonasDelTenant: readonly string[],
): string[] | null {
  const centro = centroideDeZona(zona);
  if (!centro || !Number.isFinite(millas) || millas <= 0) return null;

  const salida = zonasCoincidentes(zona, zonasDelTenant);
  const vistas = new Set(salida.map((label) => normalizeGeoLabel(label)));

  const candidatas: { label: string; millas: number }[] = [];
  for (const candidata of zonasDelTenant) {
    const label = typeof candidata === "string" ? candidata.trim() : "";
    if (!label) continue;
    const normalizada = normalizeGeoLabel(label);
    if (!normalizada || vistas.has(normalizada)) continue;

    const centroide = centroideDeZona(label);
    if (!centroide) continue;

    const distancia = distanciaEnMillas(centro, centroide);
    if (distancia > millas) continue;

    vistas.add(normalizada);
    candidatas.push({ label, millas: distancia });
  }

  candidatas.sort((a, b) => a.millas - b.millas || a.label.localeCompare(b.label, "es"));

  for (const candidata of candidatas) {
    if (salida.length >= ZONAS_MATCH_MAX) break;
    salida.push(candidata.label);
  }

  return salida;
}

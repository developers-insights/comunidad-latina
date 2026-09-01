#!/usr/bin/env node
/**
 * quitar-fondo-emojis.mjs — saca el fondo chroma de los emojis generados por IA
 * y los deja en PNG con alfa, recortados y SIN halo verde.
 *
 * Es el paso previo a `cargar-emojis.mjs`: el modelo devuelve el dibujo sobre un
 * verde plano (se le pide así justamente para poder recortarlo), y lo que sube
 * al bucket tiene que tener el fondo transparente, porque el emoji se pega
 * arriba de una foto y de los dos temas.
 *
 * Uso:
 *   node scripts/quitar-fondo-emojis.mjs --desde "C:/pack/crudos" --revisar
 *   node scripts/quitar-fondo-emojis.mjs --desde "C:/pack/crudos" --hacia "C:/pack/listos"
 *   node scripts/quitar-fondo-emojis.mjs --desde ... --hacia ... --tolerancia 75
 *   node scripts/quitar-fondo-emojis.mjs --desde ... --hacia ... --lado 512
 *
 *   --revisar     No escribe nada: dice qué verde detectó y cuánto lienzo quedó
 *                 transparente en cada archivo. Es el paso 1 de un pack nuevo.
 *   --tolerancia  Cuán lejos del verde muestreado puede estar un píxel y seguir
 *                 contando como fondo (distancia RGB, 0–441). Default 60.
 *   --lado        Deja la salida tal cual va al bucket: cuadrado de N×N y la
 *                 misma codificación que aplica `cargar-emojis.mjs`. Sin esto el
 *                 archivo queda pegado al dibujo y, viniendo de un render de
 *                 1024 px, pesa cerca de 1 MB — sesenta de esos son 60 MB de
 *                 repositorio para algo que en producción pesa 80 KB.
 *   --margen      Aire alrededor del dibujo, como fracción de su lado mayor
 *                 (0.04 = 4%). Default 0. Ver "EL RECORTE VA PEGADO" abajo.
 *
 * ─── POR QUÉ FLOOD FILL Y NO "TODO LO VERDE ES FONDO" ───────────────────────
 * El keying global (borrar todo píxel parecido al verde, esté donde esté) es una
 * línea de código y se come el dibujo: una hoja, una palta, el verde de una
 * bandera. Acá el relleno entra SÓLO desde los bordes y sólo atraviesa píxeles
 * conectados entre sí, así que el verde que está adentro del dibujo —rodeado de
 * dibujo, sin camino hasta la orilla— no se toca en esta pasada. Es la misma
 * decisión que en `cutout-icons.mjs`, por el mismo motivo.
 *
 * ─── LOS HUECOS ENCERRADOS, Y LA TOLERANCIA EN DOS NIVELES ──────────────────
 * Lo anterior tiene una contra que se ve a simple vista: el dibujo también
 * ENCIERRA fondo. El triángulo entre la mano levantada y la mejilla, el ojo del
 * asa de una taza, el hueco adentro de la voluta del vapor. Todo eso es chroma
 * que no toca la orilla, y quedaba como manchas verdes flotando adentro del
 * emoji. Sobre una foto, cantan.
 *
 * Por eso hay una SEGUNDA siembra, después de la del borde, sobre los píxeles
 * que quedaron opacos — pero con una tolerancia mucho más ESTRICTA (un tercio
 * de la del borde). El fondo encerrado es chroma plano, prácticamente el mismo
 * valor que se muestreó en las orillas; un verde legítimo del dibujo (las hojas
 * de una palmera, el verde de una bandera, un plátano) viene sombreado e
 * iluminado, así que está mucho más lejos de ese valor. Con la tolerancia
 * generosa del borde te comés la hoja; con la estricta, no.
 *
 * La siembra es estricta, pero la PROPAGACIÓN desde esa semilla usa el mismo
 * criterio que el nivel 1: el hueco se lleva su rampa de antialias y su despill
 * igual que el contorno de afuera. Sin eso quedaba con escalera dura justo en
 * el lugar donde más se mira.
 *
 * ─── POR QUÉ SE MUESTREA EL VERDE, Y POR QUÉ CON MEDIANA ────────────────────
 * El fondo NO es #00FF00. El modelo lo aproxima, y encima le mete ruido de
 * compresión, viñeteo y una sombra suave del dibujo: hardcodear el verde deja
 * fleco en unos archivos y se come medio dibujo en otros. Se muestrean las
 * cuatro orillas y se toma la MEDIANA por canal, no el promedio: si el dibujo
 * llega hasta el borde (pasa seguido) esos píxeles son outliers, y el promedio
 * se los lleva puestos —arrastra el "verde de referencia" hacia el color del
 * dibujo—, mientras que la mediana ni se entera.
 *
 * ─── POR QUÉ HAY UNA RAMPA Y NO UN CORTE SECO ───────────────────────────────
 * El dibujo viene antialiaseado: entre el trazo y el fondo hay una franja de
 * píxeles que son mezcla de los dos. Con un umbral único quedan o adentro (halo)
 * o afuera (escalera). Por eso el relleno avanza hasta la tolerancia ALTA pero
 * el alfa sale de una rampa: por debajo de la tolerancia baja es fondo puro
 * (alfa 0), y de ahí hasta la alta el alfa sube proporcional a lo lejos que está
 * del verde. A 22 px en el picker la diferencia entre esto y un corte seco se
 * nota, y mucho.
 *
 * ─── POR QUÉ EL DESPILL NO ES OPCIONAL ──────────────────────────────────────
 * Esos mismos píxeles de mezcla siguen teniendo verde en el RGB aunque el alfa
 * los deje semitransparentes. Sobre fondo blanco no se ve; sobre una foto oscura
 * el dibujo queda contorneado en verde fluorescente. El despill le pone techo al
 * canal verde (`g = min(g, max(r,b) + k)`): si el verde no está acompañado por
 * rojo o azul, es derrame del fondo y se baja.
 *
 * Cubre dos zonas: los píxeles con alfa parcial (más 2 px hacia adentro, porque
 * el derrame no termina donde termina el alfa) y TODO píxel que caiga dentro de
 * la tolerancia generosa del chroma aunque haya quedado opaco. Lo segundo es
 * para las lengüetas de fondo demasiado finas como para tener un solo píxel de
 * chroma plano, que ninguna semilla alcanza; ver el bloque de los huecos.
 *
 * ─── ESTE SCRIPT NO SE CORRE DOS VECES SOBRE EL MISMO ARCHIVO ───────────────
 * NO es idempotente y no puede serlo: volver a pasar un archivo YA recortado
 * hace que el muestreo lea el RGB de píxeles transparentes (basura) y el segundo
 * pase le come el contorno al dibujo. Por eso los archivos que entran con alfa
 * se rechazan con el motivo escrito, en vez de "procesarlos" y arruinarlos.
 *
 * ─── EL RECORTE VA PEGADO AL DIBUJO ─────────────────────────────────────────
 * `cargar-emojis.mjs` normaliza con `fit: 'contain'`, que RESPETA el margen que
 * le dejes: un emoji con 20% de aire alrededor entra al PNG de 512 un 20% más
 * chico que el resto y en el picker se ve como si estuviera mal. Por eso el
 * default de `--margen` es 0 (recorte al bounding box exacto) y el aire, si
 * hace falta, se agrega parejo para todo el pack.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/** Ancho en px de la orilla que se muestrea para adivinar el verde. */
export const BORDE_MUESTRA = 6;
/** Distancia RGB por debajo de la cual un píxel ES fondo (alfa 0). */
export const TOLERANCIA_POR_DEFECTO = 60;
/**
 * La tolerancia alta (fin de la rampa, alfa 255) sale de multiplicar la baja.
 * 1.9 es lo más ancho que se banca sin empezar a comerse trazos apenas verdosos
 * pegados al borde; con 3x un emoji con contorno oliva perdía el contorno.
 */
export const FACTOR_TOLERANCIA_ALTA = 1.9;
/**
 * Los HUECOS ENCERRADOS se siembran con una tolerancia mucho más estricta que
 * la del borde: `tolerancia × 0.33` (20 con el default de 60). Ver el bloque
 * "LOS HUECOS ENCERRADOS" del encabezado.
 *
 * El 0.33 sale de medir, no de tantear. Sobre klk.png y cafecito.png (chroma
 * #09f505): la meseta plana del chroma encerrado vive entre 0 y 9 de distancia
 * y de 10 en adelante ya es cola, y el resultado final es IDÉNTICO con
 * cualquier valor entre 5 y 60 —lo que se borra lo termina de definir la
 * propagación, no la semilla—. La primera fuga aparece recién en 90 (+31 px en
 * cafecito). 20 queda cómodo en el medio de esa meseta y bien lejos de un verde
 * de dibujo: un verde hoja como #2e7d32 está a 133 de ese mismo chroma.
 */
export const FACTOR_TOLERANCIA_ESTRICTA = 0.33;
/** Cuánto verde de más se le perdona a un píxel del borde antes de bajarlo. */
export const K_DESPILL = 10;
/**
 * El despill se estira `MARGEN_DESPILL` px hacia adentro del dibujo. El derrame
 * no termina donde termina el alfa parcial: el píxel siguiente ya es opaco y
 * todavía viene teñido. Con 0 quedaba una línea verde de 1 px, visible.
 */
export const MARGEN_DESPILL = 2;
/** Alfa a partir del cual un píxel "cuenta" para el bounding box del recorte. */
export const UMBRAL_TRIM = 8;
/** Alfa por debajo del cual un píxel se cuenta como transparente en el reporte. */
export const UMBRAL_TRANSPARENTE = 8;
/**
 * Más que esto de alfa en la ENTRADA y el archivo ya está recortado. Se rechaza
 * en vez de procesarlo: el muestreo de la orilla mide el RGB de píxeles ya
 * transparentes (basura), sale un verde de referencia que no es el fondo, y el
 * segundo pase le come el contorno al dibujo. Pasa cuando alguien apunta
 * `--desde` a la carpeta de salida, que es un error de un solo carácter.
 */
export const PISO_YA_RECORTADO = 5;
/** Menos que esto de lienzo transparente = probablemente no había fondo plano. */
export const PISO_SOSPECHOSO = 10;
/** Más que esto = probablemente el keying se comió el dibujo. */
export const TECHO_SOSPECHOSO = 92;

const EXTENSIONES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Mediana por canal de las cuatro orillas.
 *
 * Va por histograma y no ordenando: es O(n) y, sobre todo, es EXACTO y
 * determinista (mismo input → mismo verde, sin depender del orden de un sort).
 *
 * @param {Uint8Array} pixeles RGBA/RGB crudo, fila por fila.
 * @param {{ width: number, height: number, channels: number }} info
 * @param {number} [borde] Ancho de la orilla a muestrear, en px.
 * @returns {{ r: number, g: number, b: number }}
 */
export function colorDeFondo(pixeles, info, borde = BORDE_MUESTRA) {
  const { width, height, channels } = info;
  const grosor = Math.max(1, Math.min(borde, Math.floor(Math.min(width, height) / 2)));

  const histogramas = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let muestras = 0;

  const anotar = (x, y) => {
    const o = (y * width + x) * channels;
    histogramas[0][pixeles[o]] += 1;
    histogramas[1][pixeles[o + 1]] += 1;
    histogramas[2][pixeles[o + 2]] += 1;
    muestras += 1;
  };

  for (let y = 0; y < height; y += 1) {
    const filaDeArribaOAbajo = y < grosor || y >= height - grosor;
    if (filaDeArribaOAbajo) {
      for (let x = 0; x < width; x += 1) anotar(x, y);
      continue;
    }
    // En las filas del medio sólo las columnas de los costados: así ninguna
    // esquina se cuenta dos veces y el peso de las cuatro orillas es parejo.
    for (let x = 0; x < grosor; x += 1) anotar(x, y);
    for (let x = Math.max(grosor, width - grosor); x < width; x += 1) anotar(x, y);
  }

  const medianaDe = (histograma) => {
    const mitad = muestras / 2;
    let acumulado = 0;
    for (let valor = 0; valor < 256; valor += 1) {
      acumulado += histograma[valor];
      if (acumulado >= mitad) return valor;
    }
    return 255;
  };

  return { r: medianaDe(histogramas[0]), g: medianaDe(histogramas[1]), b: medianaDe(histogramas[2]) };
}

/**
 * Distancia euclídea de cada píxel al color de fondo, redondeada.
 *
 * Se calcula una sola vez por imagen y la comparten la máscara y el despill: el
 * flood fill la mira hasta cuatro veces por píxel (una por vecino) y
 * recalcularla ahí adentro es la diferencia entre 1M de raíces cuadradas y 4M.
 *
 * @param {Uint8Array} pixeles RGBA/RGB crudo.
 * @param {{ width: number, height: number, channels: number }} info
 * @param {{ r: number, g: number, b: number }} fondo
 * @returns {Uint16Array}
 */
export function distanciasAlFondo(pixeles, info, fondo) {
  const { width, height, channels } = info;
  const total = width * height;
  const distancia = new Uint16Array(total);
  for (let i = 0; i < total; i += 1) {
    const o = i * channels;
    // Un píxel que YA venía transparente es fondo por definición: distancia 0,
    // así el relleno lo atraviesa. Sin esto, volver a correr el script sobre un
    // archivo ya recortado resucitaba el RGB basura de las zonas transparentes.
    if (channels === 4 && pixeles[o + 3] < UMBRAL_TRANSPARENTE) {
      distancia[i] = 0;
      continue;
    }
    const dr = pixeles[o] - fondo.r;
    const dg = pixeles[o + 1] - fondo.g;
    const db = pixeles[o + 2] - fondo.b;
    distancia[i] = Math.round(Math.sqrt(dr * dr + dg * dg + db * db));
  }
  return distancia;
}

/**
 * Flood fill desde los bordes + rampa de antialias. Devuelve el canal alfa.
 *
 * La pila es iterativa y vive en un `Int32Array`: en 1024×1024 una versión
 * recursiva desborda la pila de Node antes de terminar la primera fila larga.
 *
 * @param {Uint8Array} pixeles RGBA/RGB crudo.
 * @param {{ width: number, height: number, channels: number }} info
 * @param {{ r: number, g: number, b: number }} fondo
 * @param {{ tolerancia?: number, toleranciaAlta?: number, toleranciaEstricta?: number,
 *   distancias?: Uint16Array }} [opciones]
 * @returns {Uint8Array} Un alfa por píxel (0 = fondo, 255 = dibujo).
 */
export function construirMascaraAlfa(pixeles, info, fondo, opciones = {}) {
  const { width, height, channels } = info;
  const total = width * height;
  const tolBaja = opciones.tolerancia ?? TOLERANCIA_POR_DEFECTO;
  const tolAlta = opciones.toleranciaAlta ?? Math.round(tolBaja * FACTOR_TOLERANCIA_ALTA);
  const tolEstricta = opciones.toleranciaEstricta ?? Math.round(tolBaja * FACTOR_TOLERANCIA_ESTRICTA);
  const rampa = Math.max(1, tolAlta - tolBaja);

  const distancia = opciones.distancias ?? distanciasAlFondo(pixeles, info, fondo);

  const enElFondo = new Uint8Array(total);
  const pila = new Int32Array(total); // cota real: cada píxel se apila una vez
  let tope = 0;

  const empujar = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (enElFondo[i]) return;
    if (distancia[i] >= tolAlta) return;
    enElFondo[i] = 1;
    pila[tope] = i;
    tope += 1;
  };

  const vaciarPila = () => {
    while (tope > 0) {
      tope -= 1;
      const i = pila[tope];
      const x = i % width;
      const y = (i - x) / width;
      empujar(x + 1, y);
      empujar(x - 1, y);
      empujar(x, y + 1);
      empujar(x, y - 1);
    }
  };

  // NIVEL 1: el fondo que toca la orilla del lienzo.
  for (let x = 0; x < width; x += 1) {
    empujar(x, 0);
    empujar(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    empujar(0, y);
    empujar(width - 1, y);
  }
  vaciarPila();

  // NIVEL 2: los huecos ENCERRADOS. Se siembra con `tolEstricta` —un píxel que
  // es casi exactamente el chroma muestreado— y a partir de ahí se propaga con
  // el MISMO criterio que el nivel 1, así el hueco se lleva su rampa de
  // antialias igual que el borde de afuera. Lo que no puede pasar es sembrar
  // con la tolerancia generosa: ahí sí se comería una hoja o una bandera.
  for (let i = 0; i < total; i += 1) {
    if (enElFondo[i] || distancia[i] > tolEstricta) continue;
    const x = i % width;
    empujar(x, (i - x) / width);
  }
  vaciarPila();

  const alfa = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    let valor = 255;
    if (enElFondo[i]) {
      const d = distancia[i];
      valor = d <= tolBaja ? 0 : Math.round((255 * (d - tolBaja)) / rampa);
    }
    // Nunca volver opaco algo que el original tenía transparente, aunque el
    // relleno no haya llegado hasta ahí (un hueco cerrado, por ejemplo).
    if (channels === 4 && pixeles[i * channels + 3] < valor) valor = pixeles[i * channels + 3];
    alfa[i] = valor;
  }

  return alfa;
}

/**
 * Le baja el verde derramado a la zona del borde. MUTA `pixeles` (el buffer ya
 * es una copia cruda propia del proceso; duplicar 4 MB por imagen no aporta).
 *
 * @param {Uint8Array} pixeles RGBA/RGB crudo.
 * @param {{ width: number, height: number, channels: number }} info
 * @param {Uint8Array} alfa Máscara de `construirMascaraAlfa`.
 * @param {{ k?: number, margenDespill?: number, distancias?: Uint16Array,
 *   toleranciaAlta?: number }} [opciones]
 * @returns {Uint8Array} El mismo buffer, ya corregido.
 */
export function aplicarDespill(pixeles, info, alfa, opciones = {}) {
  const { width, height, channels } = info;
  const total = width * height;
  const k = opciones.k ?? K_DESPILL;
  const margen = opciones.margenDespill ?? MARGEN_DESPILL;
  const distancias = opciones.distancias ?? null;
  const tolAlta =
    opciones.toleranciaAlta ?? Math.round(TOLERANCIA_POR_DEFECTO * FACTOR_TOLERANCIA_ALTA);

  // Zona = píxeles con alfa parcial, dilatada `margen` px hacia adentro. Se
  // dilata y no se recorre todo el lienzo a propósito: el verde legítimo del
  // centro del dibujo (una hoja, una bandera) no tiene por qué perder saturación.
  let zona = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) zona[i] = alfa[i] < 255 ? 1 : 0;

  // Y además, TODO píxel que esté dentro de la tolerancia generosa del chroma,
  // aunque haya quedado opaco. Eso agarra las lengüetas de fondo demasiado
  // finas para tener un solo píxel de chroma plano —chroma mezclado con el
  // contorno blanco del sticker por los dos lados, así que ninguna semilla las
  // alcanza— que quedaban como una raya verde fluorescente adentro del dibujo
  // (medido: 110 px en el vapor de cafecito.png). No las borra: les saca el
  // verde, y se funden con lo que las rodea.
  //
  // El corte es el MISMO `tolAlta` que el flood fill ya usa para decidir qué es
  // fondo, así que esto es estrictamente más conservador que el relleno: sólo
  // cambia el color de píxeles que el relleno habría borrado enteros si los
  // hubiera podido alcanzar. Un verde legítimo está mucho más lejos que eso (la
  // verde hoja #2e7d32 está a 133 del chroma real; el corte está en 114).
  if (distancias) {
    for (let i = 0; i < total; i += 1) {
      if (!zona[i] && distancias[i] < tolAlta) zona[i] = 1;
    }
  }

  for (let paso = 0; paso < margen; paso += 1) {
    const siguiente = zona.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (zona[i]) continue;
        const vecinoMarcado =
          (x > 0 && zona[i - 1]) ||
          (x < width - 1 && zona[i + 1]) ||
          (y > 0 && zona[i - width]) ||
          (y < height - 1 && zona[i + width]);
        if (vecinoMarcado) siguiente[i] = 1;
      }
    }
    zona = siguiente;
  }

  for (let i = 0; i < total; i += 1) {
    if (!zona[i]) continue;
    const o = i * channels;
    const techo = Math.min(255, Math.max(pixeles[o], pixeles[o + 2]) + k);
    if (pixeles[o + 1] > techo) pixeles[o + 1] = techo;
  }

  return pixeles;
}

/**
 * Recorta al bounding box de lo que quedó opaco y devuelve un buffer RGBA.
 *
 * @param {Uint8Array} pixeles RGBA/RGB crudo (ya despilleado).
 * @param {{ width: number, height: number, channels: number }} info
 * @param {Uint8Array} alfa
 * @param {{ umbral?: number, margenRelativo?: number }} [opciones]
 * @returns {{ data: Uint8Array, width: number, height: number, util: { width: number, height: number } } | null}
 *   `null` si no quedó ni un píxel opaco: eso no es un recorte, es un archivo
 *   vacío. `util` es el bounding box SIN el aire de `--margen`, que es lo único
 *   comparable contra el lienzo original.
 */
export function recortar(pixeles, info, alfa, opciones = {}) {
  const { width, height, channels } = info;
  const umbral = opciones.umbral ?? UMBRAL_TRIM;
  const margenRelativo = opciones.margenRelativo ?? 0;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const fila = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alfa[fila + x] <= umbral) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const anchoUtil = maxX - minX + 1;
  const altoUtil = maxY - minY + 1;
  // El aire se AGREGA (no se toma del original): si el dibujo llegaba hasta la
  // orilla igual queda centrado, en vez de pedir un margen que no existía.
  const aire = Math.round(margenRelativo * Math.max(anchoUtil, altoUtil));
  const anchoFinal = anchoUtil + aire * 2;
  const altoFinal = altoUtil + aire * 2;

  const salida = new Uint8Array(anchoFinal * altoFinal * 4); // ceros = transparente
  for (let y = 0; y < altoUtil; y += 1) {
    for (let x = 0; x < anchoUtil; x += 1) {
      const origen = (minY + y) * width + (minX + x);
      const o = origen * channels;
      const destino = ((y + aire) * anchoFinal + (x + aire)) * 4;
      salida[destino] = pixeles[o];
      salida[destino + 1] = pixeles[o + 1];
      salida[destino + 2] = pixeles[o + 2];
      salida[destino + 3] = alfa[origen];
    }
  }

  return {
    data: salida,
    width: anchoFinal,
    height: altoFinal,
    util: { width: anchoUtil, height: altoUtil },
  };
}

/**
 * Qué porcentaje del lienzo quedó transparente. Se mide sobre el lienzo
 * ORIGINAL (antes del recorte), que es el número que sirve para saber si el
 * keying hizo algo razonable.
 *
 * @param {Uint8Array} alfa
 * @param {number} [umbral]
 * @returns {number}
 */
export function porcentajeTransparente(alfa, umbral = UMBRAL_TRANSPARENTE) {
  let transparentes = 0;
  for (let i = 0; i < alfa.length; i += 1) if (alfa[i] < umbral) transparentes += 1;
  return (transparentes / alfa.length) * 100;
}

/**
 * Cuánto del lienzo ENTRA ya transparente. Ver `PISO_YA_RECORTADO`.
 *
 * @param {Uint8Array} pixeles
 * @param {{ width: number, height: number, channels: number }} info
 * @returns {number}
 */
export function porcentajeAlfaDeOrigen(pixeles, info) {
  if (info.channels !== 4) return 0;
  const total = info.width * info.height;
  let transparentes = 0;
  for (let i = 0; i < total; i += 1) {
    if (pixeles[i * 4 + 3] < UMBRAL_TRANSPARENTE) transparentes += 1;
  }
  return (transparentes / total) * 100;
}

/**
 * Un porcentaje sospechoso no es un error —el archivo se escribe igual— pero sí
 * es lo único que separa "salió bien" de "salió roto y en la terminal se veía
 * igual". Por eso levanta advertencia y hace fallar el exit code.
 *
 * @param {number} porcentaje
 * @returns {string | null}
 */
export function advertenciaPorcentaje(porcentaje) {
  if (porcentaje < PISO_SOSPECHOSO) {
    return `sólo ${porcentaje.toFixed(1)}% del lienzo quedó transparente: probablemente el fondo no era plano (o no es verde) y no se detectó`;
  }
  if (porcentaje > TECHO_SOSPECHOSO) {
    return `${porcentaje.toFixed(1)}% del lienzo quedó transparente: probablemente el keying se comió el dibujo (bajá --tolerancia)`;
  }
  return null;
}

/**
 * El porcentaje solo no alcanza: un fondo con degradé (una foto, un render sin
 * chroma) puede dejar un 17% transparente —dentro de lo "normal"— y no haber
 * recortado NADA. Si el bounding box de lo opaco sigue siendo el lienzo entero,
 * el fondo no se fue por ningún lado, y eso sí es concluyente.
 *
 * @param {{ width: number, height: number }} entrada Lienzo original.
 * @param {{ width: number, height: number }} util Bounding box de lo opaco.
 * @returns {string | null}
 */
export function advertenciaDeRecorte(entrada, util) {
  if (util.width >= entrada.width && util.height >= entrada.height) {
    return 'el recorte no achicó el lienzo por ningún lado: el fondo no se detectó (¿no era plano, o no era chroma?)';
  }
  return null;
}

/**
 * Una imagen entera: crudo → máscara → despill → recorte → PNG.
 *
 * @param {Buffer | Uint8Array} entrada Archivo original, tal cual salió del disco.
 * @param {{ tolerancia?: number, margenRelativo?: number, codificar?: boolean }} [opciones]
 */
export async function procesarImagen(entrada, opciones = {}) {
  // `toColourspace('srgb')` antes de `ensureAlpha()`: si el archivo viniera en
  // escala de grises, `ensureAlpha` daría 2 canales y todo el resto —que lee
  // r/g/b por offset— quedaría corrido sin avisar.
  const { data, info } = await sharp(entrada)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const yaTransparente = porcentajeAlfaDeOrigen(data, info);
  if (yaTransparente > PISO_YA_RECORTADO) {
    throw new Error(
      `ya viene con ${yaTransparente.toFixed(1)}% del lienzo transparente, o sea que ya está recortado ` +
        '(¿--desde apunta a la carpeta de salida?). No se toca: pasarlo de nuevo le come el contorno.',
    );
  }

  const fondo = colorDeFondo(data, info);
  // Una sola pasada de distancias para la máscara y el despill.
  const distancias = distanciasAlFondo(data, info, fondo);
  const toleranciaAlta =
    opciones.toleranciaAlta ??
    Math.round((opciones.tolerancia ?? TOLERANCIA_POR_DEFECTO) * FACTOR_TOLERANCIA_ALTA);

  const alfa = construirMascaraAlfa(data, info, fondo, { ...opciones, distancias, toleranciaAlta });
  const transparente = porcentajeTransparente(alfa);

  aplicarDespill(data, info, alfa, { ...opciones, distancias, toleranciaAlta });
  const recorte = recortar(data, info, alfa, opciones);
  if (!recorte) {
    throw new Error('no quedó ni un píxel opaco después del keying');
  }

  let salida =
    opciones.codificar === false
      ? null
      : sharp(recorte.data, {
          raw: { width: recorte.width, height: recorte.height, channels: 4 },
        });

  // `--lado` deja el archivo EXACTAMENTE como va al bucket: mismo cuadrado y
  // misma codificación que aplica `cargar-emojis.mjs` al subir. El recorte
  // pegado al dibujo sale de un render de 1024 px y pesa cerca de 1 MB — sesenta
  // de esos son 60 MB de repositorio para archivos que en producción pesan 80 KB.
  // Con esto, lo que se versiona es lo que ve la gente, y se puede auditar el
  // pack de producción mirando el repo.
  //
  // Acá SÍ va `palette`, y en el camino normal NO: la regla es no cuantizar dos
  // veces, y cuantizar lo que ya tiene ≤256 colores no cuantiza nada — el
  // `png({palette:true})` del cargador queda sin trabajo que hacer. Sin `--lado`
  // el archivo es un intermedio de máxima calidad y la única cuantización la
  // hace el cargador.
  if (salida && opciones.lado) {
    salida = salida
      .resize(opciones.lado, opciones.lado, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, palette: true });
  }

  const png = salida
    ? await (opciones.lado ? salida : salida.png({ compressionLevel: 9 })).toBuffer()
    : null;

  return {
    png,
    fondo,
    transparente,
    entrada: { width: info.width, height: info.height },
    salida: { width: recorte.width, height: recorte.height },
    util: recorte.util,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) {
  return process.argv.includes(name);
}

function hex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function main() {
  const desde = flag('--desde');
  const hacia = flag('--hacia');
  const soloRevisar = has('--revisar');
  const tolerancia = Number(flag('--tolerancia', String(TOLERANCIA_POR_DEFECTO)));
  const margenRelativo = Number(flag('--margen', '0'));
  const lado = flag('--lado') === null ? 0 : Number(flag('--lado'));

  if (!desde) {
    console.error('✘ Falta --desde <carpeta con las imágenes crudas>');
    console.error('  Uso: node scripts/quitar-fondo-emojis.mjs --desde "C:/pack/crudos" --revisar');
    process.exit(1);
  }
  if (!hacia && !soloRevisar) {
    console.error('✘ Falta --hacia <carpeta de salida> (o pasá --revisar para no escribir nada)');
    process.exit(1);
  }
  if (!Number.isFinite(tolerancia) || tolerancia <= 0) {
    console.error(`✘ --tolerancia tiene que ser un número mayor que 0 (llegó "${flag('--tolerancia')}")`);
    process.exit(1);
  }
  if (!Number.isFinite(margenRelativo) || margenRelativo < 0) {
    console.error(`✘ --margen tiene que ser una fracción ≥ 0 (llegó "${flag('--margen')}")`);
    process.exit(1);
  }
  if (!Number.isFinite(lado) || lado < 0) {
    console.error(`✘ --lado tiene que ser un número de píxeles ≥ 0 (llegó "${flag('--lado')}")`);
    process.exit(1);
  }

  const entradas = (await fs.readdir(desde))
    .filter((nombre) => EXTENSIONES.has(path.extname(nombre).toLowerCase()))
    .sort(); // orden estable: el reporte de dos corridas se puede diffear

  console.log(`▸ ${entradas.length} imagen(es) en ${desde}`);
  console.log(
    `  tolerancia ${tolerancia} (rampa hasta ${Math.round(tolerancia * FACTOR_TOLERANCIA_ALTA)}) · margen ${margenRelativo}` +
      (lado ? ` · salida ${lado}×${lado}` : ' · salida pegada al dibujo'),
  );
  if (soloRevisar) console.log('  MODO REVISIÓN: no se escribe nada.');
  else console.log(`  destino ${hacia}`);
  console.log('');

  if (entradas.length === 0) {
    console.error('✘ No hay .png/.jpg/.jpeg/.webp en esa carpeta.');
    process.exit(1);
  }

  if (!soloRevisar) await fs.mkdir(hacia, { recursive: true });

  let fallaron = 0;

  for (const nombre of entradas) {
    const origen = path.resolve(desde, nombre);
    try {
      const resultado = await procesarImagen(await fs.readFile(origen), {
        tolerancia,
        margenRelativo,
        lado,
        codificar: !soloRevisar,
      });

      const avisos = [
        advertenciaPorcentaje(resultado.transparente),
        advertenciaDeRecorte(resultado.entrada, resultado.util),
      ].filter((aviso) => aviso !== null);
      const marca = avisos.length > 0 ? '⚠️ ' : '✓';
      const medidas = `${resultado.entrada.width}×${resultado.entrada.height} → ${resultado.salida.width}×${resultado.salida.height}`;

      if (soloRevisar) {
        console.log(
          `  ${marca} ${nombre}  ·  fondo ${hex(resultado.fondo)}  ·  ${medidas}  ·  ${resultado.transparente.toFixed(1)}% transparente`,
        );
      } else {
        await fs.writeFile(
          path.resolve(hacia, `${path.basename(nombre, path.extname(nombre))}.png`),
          resultado.png,
        );
        console.log(
          `  ${marca} ${nombre}  ·  ${medidas}  ·  ${resultado.transparente.toFixed(1)}% transparente  ·  ${(resultado.png.length / 1024).toFixed(0)} KB`,
        );
      }

      for (const aviso of avisos) {
        console.error(`      ⚠️  ${nombre}: ${aviso}`);
      }
      if (avisos.length > 0) fallaron += 1;
    } catch (error) {
      // A propósito no aborta: en un pack de 60, un archivo roto no puede dejar
      // los 59 restantes sin procesar. El exit code se encarga de que igual se note.
      console.error(`  ✘ ${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      fallaron += 1;
    }
  }

  console.log('');
  if (fallaron > 0) {
    console.error(`▸ ${fallaron} archivo(s) fallaron o quedaron dudosos. Miralos antes de cargarlos.`);
    process.exitCode = 1;
    return;
  }
  if (soloRevisar) {
    console.log('▸ Todo prolijo. Volvé a correrlo con --hacia <carpeta> para escribir los PNG.');
    return;
  }
  console.log('▸ Listos. Ahora: node scripts/cargar-emojis.mjs --desde <carpeta> --revisar');
}

// Sólo corre el CLI cuando ES el entrypoint: el test importa las funciones puras
// de este mismo archivo y no puede tolerar que `main()` arranque solo.
const invocadoDirecto =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  main().catch((error) => {
    console.error('✘ Falló el recorte:', error);
    process.exit(1);
  });
}

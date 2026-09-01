import { describe, expect, it } from "vitest";

import {
  K_DESPILL,
  MARGEN_DESPILL,
  PISO_YA_RECORTADO,
  advertenciaDeRecorte,
  advertenciaPorcentaje,
  aplicarDespill,
  colorDeFondo,
  construirMascaraAlfa,
  porcentajeAlfaDeOrigen,
  porcentajeTransparente,
  recortar,
} from "./quitar-fondo-emojis.mjs";

/**
 * Los cuatro casos que separan "recortó" de "arruinó el emoji".
 *
 * El script no se puede probar contra una imagen de verdad —no hay fixtures
 * binarios en el repo y un PNG generado por IA no es reproducible—, así que se
 * arman lienzos crudos a mano: son los mismos `Uint8Array` RGBA que devuelve
 * `sharp(...).raw()`, sin sharp de por medio. Eso deja los tests en milisegundos
 * y, más importante, hace que cada caso pruebe UNA decisión del algoritmo.
 *
 * Los tres que más importan son los que ya salieron mal alguna vez en scripts
 * parecidos: verde adentro del dibujo que desaparece, borde en escalera, y halo
 * verde alrededor del trazo.
 */

const VERDE = { r: 22, g: 198, b: 41 };
const ROJO = { r: 201, g: 44, b: 38 };
const BLANCO = { r: 255, g: 255, b: 255 };
/** Verde de hoja: sombreado e iluminado, a 80 de distancia del chroma. */
const VERDE_HOJA = { r: 34, g: 120, b: 52 };

type Color = { r: number; g: number; b: number };
type Info = { width: number; height: number; channels: number };

function lienzo(width: number, height: number, color: Color) {
  const pixeles = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixeles[i * 4] = color.r;
    pixeles[i * 4 + 1] = color.g;
    pixeles[i * 4 + 2] = color.b;
    pixeles[i * 4 + 3] = 255;
  }
  return { pixeles, info: { width, height, channels: 4 } satisfies Info };
}

function pintar(pixeles: Uint8Array, info: Info, x: number, y: number, color: Color) {
  const o = (y * info.width + x) * 4;
  pixeles[o] = color.r;
  pixeles[o + 1] = color.g;
  pixeles[o + 2] = color.b;
  pixeles[o + 3] = 255;
}

function rectangulo(
  pixeles: Uint8Array,
  info: Info,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Color,
) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) pintar(pixeles, info, x, y, color);
  }
}

/** Mezcla lineal: `t = 0` es `a`, `t = 1` es `b`. Simula el antialias del render. */
function mezclar(a: Color, b: Color, t: number): Color {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

const alfaEn = (alfa: Uint8Array, info: Info, x: number, y: number) => alfa[y * info.width + x];
const verdeEn = (pixeles: Uint8Array, info: Info, x: number, y: number) =>
  pixeles[(y * info.width + x) * 4 + 1];

describe("colorDeFondo", () => {
  it("toma la mediana de las orillas y no se deja arrastrar por los outliers", () => {
    const { pixeles, info } = lienzo(24, 24, VERDE);
    // Un dibujo que llega hasta el borde: cuatro píxeles blancos en la orilla de
    // arriba. Con promedio, el "verde de referencia" se corre hacia el blanco y
    // la tolerancia empieza a medir desde un color que no existe en la imagen.
    for (let x = 4; x < 8; x += 1) pintar(pixeles, info, x, 0, BLANCO);

    expect(colorDeFondo(pixeles, info)).toEqual(VERDE);
  });
});

describe("construirMascaraAlfa", () => {
  it("deja opaco un cuadrado centrado y lo recorta sin margen", () => {
    const { pixeles, info } = lienzo(32, 32, VERDE);
    rectangulo(pixeles, info, 10, 10, 21, 21, ROJO);

    const alfa = construirMascaraAlfa(pixeles, info, colorDeFondo(pixeles, info));

    expect(alfaEn(alfa, info, 0, 0)).toBe(0);
    expect(alfaEn(alfa, info, 16, 16)).toBe(255);

    const recorte = recortar(pixeles, info, alfa);
    expect(recorte).not.toBeNull();
    expect(recorte!.width).toBe(12);
    expect(recorte!.height).toBe(12);
    expect(recorte!.util).toEqual({ width: 12, height: 12 });
    // Todo el recorte es dibujo: ni una fila ni una columna de aire de más. El
    // `fit: 'contain'` de cargar-emojis.mjs respeta el margen que le dejen, así
    // que un píxel de más acá es un emoji más chico que el resto en el picker.
    for (let i = 0; i < recorte!.width * recorte!.height; i += 1) {
      expect(recorte!.data[i * 4 + 3]).toBe(255);
    }
  });

  it("no se come el verde que está ADENTRO del dibujo", () => {
    const { pixeles, info } = lienzo(32, 32, VERDE);
    rectangulo(pixeles, info, 8, 8, 23, 23, ROJO);
    // Franja de verde del DIBUJO (sombreado, a 80 del chroma), rodeada de dibujo
    // por los cuatro costados. Un keying global se la lleva; el flood fill
    // conectado no puede llegar.
    //
    // OJO con el color: acá iba el chroma EXACTO hasta que se agregó el barrido
    // de huecos encerrados, y ahora ese caso tiene que dar lo contrario (lo
    // cubre el test de abajo). El verde que se defiende es el del dibujo, no el
    // del fondo encerrado: son dos cosas distintas que se veían iguales.
    rectangulo(pixeles, info, 12, 14, 19, 17, VERDE_HOJA);

    const alfa = construirMascaraAlfa(pixeles, info, colorDeFondo(pixeles, info));

    expect(alfaEn(alfa, info, 12, 14)).toBe(255);
    expect(alfaEn(alfa, info, 16, 16)).toBe(255);
    expect(alfaEn(alfa, info, 19, 17)).toBe(255);
    // …y el fondo de verdad sí se va.
    expect(alfaEn(alfa, info, 0, 0)).toBe(0);
    expect(alfaEn(alfa, info, 31, 31)).toBe(0);
  });

  it("borra los huecos de chroma ENCERRADOS pero respeta el verde sombreado", () => {
    // Los dos casos que tienen que convivir, en el mismo dibujo:
    //  · un hueco de chroma EXACTO que el dibujo encierra (el triángulo entre la
    //    mano y la mejilla en klk.png) → se va;
    //  · un verde de hoja, también encerrado, a 80 de distancia del chroma → se
    //    queda. Está DENTRO de la tolerancia generosa del borde (114): si la
    //    siembra de los huecos usara esa tolerancia, se comería la hoja.
    const { pixeles, info } = lienzo(40, 40, VERDE);
    rectangulo(pixeles, info, 6, 6, 33, 33, ROJO);
    rectangulo(pixeles, info, 10, 10, 15, 15, VERDE);
    rectangulo(pixeles, info, 24, 24, 29, 29, VERDE_HOJA);

    const alfa = construirMascaraAlfa(pixeles, info, colorDeFondo(pixeles, info));

    expect(alfaEn(alfa, info, 12, 12)).toBe(0); // hueco encerrado de chroma
    expect(alfaEn(alfa, info, 26, 26)).toBe(255); // hoja encerrada
    expect(alfaEn(alfa, info, 8, 8)).toBe(255); // dibujo
    expect(alfaEn(alfa, info, 0, 0)).toBe(0); // fondo de afuera

    // Y la prueba de que la tolerancia estricta es lo único que salva a la hoja:
    // con una siembra generosa, el mismo dibujo la pierde (queda en 94 de alfa,
    // o sea translúcida — arruinada igual que si se hubiera borrado).
    const conSiembraGenerosa = construirMascaraAlfa(pixeles, info, colorDeFondo(pixeles, info), {
      toleranciaEstricta: 100,
    });
    expect(alfaEn(conSiembraGenerosa, info, 26, 26)).toBeLessThan(128);
  });

  it("le da al borde del hueco encerrado la misma rampa que al de afuera", () => {
    // Hueco de chroma con un anillo de mezcla alrededor: el antialias que deja
    // el render entre el hueco y el trazo. Sin rampa, el hueco queda con
    // escalera dura justo en el medio del dibujo, que es donde más se mira.
    const { pixeles, info } = lienzo(40, 40, VERDE);
    rectangulo(pixeles, info, 6, 6, 33, 33, ROJO);
    rectangulo(pixeles, info, 16, 16, 23, 23, mezclar(VERDE, ROJO, 0.35));
    rectangulo(pixeles, info, 17, 17, 22, 22, VERDE);

    const alfa = construirMascaraAlfa(pixeles, info, colorDeFondo(pixeles, info));

    expect(alfaEn(alfa, info, 19, 19)).toBe(0); // adentro del hueco
    const anillo = alfaEn(alfa, info, 16, 19);
    expect(anillo).toBeGreaterThan(0);
    expect(anillo).toBeLessThan(255);
    expect(alfaEn(alfa, info, 15, 19)).toBe(255); // el trazo, intacto
  });

  it("le da alfa intermedio al borde antialiaseado, no sólo 0 o 255", () => {
    // Degradé horizontal verde → rojo: columnas 0–2 fondo puro, 3–11 la mezcla
    // que deja el antialias, 12+ dibujo puro. El fondo se pasa a mano para que
    // el caso pruebe la rampa y nada más (el muestreo tiene su propio test).
    const width = 20;
    const height = 5;
    const { pixeles, info } = lienzo(width, height, VERDE);
    for (let x = 0; x < width; x += 1) {
      const t = Math.max(0, Math.min(1, (x - 2) / 10));
      const color = mezclar(VERDE, ROJO, t);
      for (let y = 0; y < height; y += 1) pintar(pixeles, info, x, y, color);
    }

    const alfa = construirMascaraAlfa(pixeles, info, VERDE);
    const fila = Array.from({ length: width }, (_, x) => alfaEn(alfa, info, x, 2));

    expect(fila[0]).toBe(0);
    expect(fila[width - 1]).toBe(255);
    // Monótona: cuanto más lejos del verde, más opaco. Un alfa que sube y baja
    // en el borde se ve como un fleco sucio.
    for (let x = 1; x < width; x += 1) expect(fila[x]).toBeGreaterThanOrEqual(fila[x - 1]);
    expect(fila.some((valor) => valor > 0 && valor < 255)).toBe(true);
  });
});

describe("aplicarDespill", () => {
  it("le baja el verde al borde y no toca el interior del dibujo", () => {
    const { pixeles, info } = lienzo(5, 5, { r: 60, g: 180, b: 70 });
    const alfa = new Uint8Array(25).fill(255);
    // Un solo píxel semitransparente en el centro: el borde del dibujo.
    alfa[2 * 5 + 2] = 120;

    aplicarDespill(pixeles, info, alfa, {});

    // El píxel del borde tenía 180 de verde sin rojo ni azul que lo justifiquen:
    // eso es derrame del fondo, y es lo que se ve como halo fluorescente.
    expect(verdeEn(pixeles, info, 2, 2)).toBeLessThanOrEqual(70 + K_DESPILL);
    expect(verdeEn(pixeles, info, 2, 2)).toBeLessThan(180);
    // La esquina está a 4 px del borde, más lejos que el margen de erosión: es
    // interior del dibujo y su verde es legítimo (una hoja, una bandera).
    expect(MARGEN_DESPILL).toBeLessThan(4);
    expect(verdeEn(pixeles, info, 0, 0)).toBe(180);
  });

  it("también le saca el verde a las lengüetas de chroma que quedaron opacas", () => {
    // El caso de cafecito.png: una lengüeta de fondo tan fina que está mezclada
    // con el contorno blanco por los dos lados. Nunca llega a la meseta del
    // chroma, así que ninguna semilla la agarra y queda opaca y fluorescente.
    // Pasándole las distancias, el despill la alcanza igual.
    const { pixeles, info } = lienzo(3, 1, { r: 60, g: 200, b: 70 });
    const alfa = new Uint8Array(3).fill(255);
    // Píxel 0 dentro de la banda del chroma; píxel 2, muy lejos (verde legítimo).
    const distancias = new Uint16Array([40, 200, 300]);

    aplicarDespill(pixeles, info, alfa, { distancias, toleranciaAlta: 114, margenDespill: 0 });

    expect(verdeEn(pixeles, info, 0, 0)).toBeLessThanOrEqual(70 + K_DESPILL);
    expect(verdeEn(pixeles, info, 2, 0)).toBe(200);
  });
});

describe("advertencias", () => {
  it("avisa cuando el recorte no tocó nada o se comió el dibujo", () => {
    expect(advertenciaPorcentaje(2)).toMatch(/no era plano/);
    expect(advertenciaPorcentaje(98)).toMatch(/se comió el dibujo/);
    expect(advertenciaPorcentaje(70)).toBeNull();
  });

  it("avisa cuando el bounding box sigue siendo el lienzo entero", () => {
    // El caso que el porcentaje solo NO agarra: un fondo con degradé deja un
    // 17% transparente (parece sano) sin haber recortado un solo borde.
    expect(advertenciaDeRecorte({ width: 400, height: 400 }, { width: 400, height: 400 })).toMatch(
      /no achicó el lienzo/,
    );
    expect(advertenciaDeRecorte({ width: 400, height: 400 }, { width: 400, height: 380 })).toBeNull();
  });

  it("mide el porcentaje sobre el lienzo entero", () => {
    const alfa = new Uint8Array(10);
    alfa.fill(255, 0, 4);
    expect(porcentajeTransparente(alfa)).toBe(60);
  });

  it("reconoce un archivo que YA venía recortado", () => {
    const { pixeles, info } = lienzo(10, 10, VERDE);
    expect(porcentajeAlfaDeOrigen(pixeles, info)).toBe(0);
    for (let i = 0; i < 20; i += 1) pixeles[i * 4 + 3] = 0;
    expect(porcentajeAlfaDeOrigen(pixeles, info)).toBe(20);
    expect(20).toBeGreaterThan(PISO_YA_RECORTADO);
  });
});

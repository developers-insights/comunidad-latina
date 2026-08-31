import { describe, expect, it } from "vitest";
import { normalizeGeoLabel } from "@/lib/boosts/scope";
import { zonasCoincidentes, ZONAS_MATCH_MAX } from "./coincidencias";
import {
  barrioMasCercano,
  CENTROIDES,
  centroideDeZona,
  distanciaEnMillas,
  esCoordenadaValida,
  RADIO_TIERRA_MILLAS,
  SNAP_MAX_MILLAS,
  zonasEnRadio,
} from "./centroides";

/**
 * Los tests de la geografía de "Tu zona".
 *
 * La regla que atraviesa todo este archivo: lo que se verifica es que el filtro
 * NUNCA devuelva menos de lo que devolvería sin radio, y que una coordenada
 * nunca se convierta en un barrio que no le corresponde. Los dos errores son
 * invisibles en producción —nadie reporta "vi de menos"— y por eso tienen que
 * fallar acá.
 */

const CORONA = { lat: 40.7498, lng: -73.862 };

describe("distanciaEnMillas — Haversine, no una aproximación plana", () => {
  it("un punto contra sí mismo da cero", () => {
    expect(distanciaEnMillas(CORONA, CORONA)).toBe(0);
  });

  it("es simétrica", () => {
    const a = { lat: 40.7557, lng: -73.8831 };
    expect(distanciaEnMillas(CORONA, a)).toBeCloseTo(distanciaEnMillas(a, CORONA), 10);
  });

  it("un grado de latitud son ~69.09 millas", () => {
    // El valor de referencia de cualquier tabla: pi*R/180. Si esto se mueve, se
    // movió el radio de la Tierra y TODOS los radios de la app cambiaron de
    // tamaño sin que nadie lo pidiera.
    expect(distanciaEnMillas({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(69.093, 2);
  });

  it("del ecuador al polo son un cuarto de meridiano", () => {
    const esperado = (Math.PI * RADIO_TIERRA_MILLAS) / 2;
    expect(distanciaEnMillas({ lat: 0, lng: 0 }, { lat: 90, lng: 0 })).toBeCloseTo(esperado, 6);
  });

  it("los meridianos se juntan: un grado de longitud mide menos lejos del ecuador", () => {
    // Esto es exactamente lo que una aproximación plana se come, y es la razón
    // por la que acá hay trigonometría y no un teorema de Pitágoras.
    const enElEcuador = distanciaEnMillas({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const enQueens = distanciaEnMillas({ lat: 40.75, lng: 0 }, { lat: 40.75, lng: 1 });
    expect(enQueens).toBeLessThan(enElEcuador);
    // cos(40.75°) ≈ 0.758
    expect(enQueens / enElEcuador).toBeCloseTo(Math.cos((40.75 * Math.PI) / 180), 3);
  });

  it("no devuelve NaN en puntos antipodales (el clamp de la raíz)", () => {
    const d = distanciaEnMillas({ lat: 40.75, lng: -73.86 }, { lat: -40.75, lng: 106.14 });
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeGreaterThan(12000);
  });

  it("dos barrios vecinos de Queens dan una distancia de barrio, no de condado", () => {
    const jacksonHeights = { lat: 40.7557, lng: -73.8831 };
    const millas = distanciaEnMillas(CORONA, jacksonHeights);
    expect(millas).toBeGreaterThan(0.5);
    expect(millas).toBeLessThan(2);
  });
});

describe("esCoordenadaValida — lo que llega del navegador es entrada del cliente", () => {
  it("acepta una coordenada de la Tierra", () => {
    expect(esCoordenadaValida(CORONA)).toBe(true);
    expect(esCoordenadaValida({ lat: -90, lng: 180 })).toBe(true);
  });

  it("rechaza NaN e Infinity, que pasarían cualquier comparación de rango", () => {
    expect(esCoordenadaValida({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(esCoordenadaValida({ lat: 0, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("rechaza lo que está fuera del planeta y lo que no es un objeto", () => {
    expect(esCoordenadaValida({ lat: 91, lng: 0 })).toBe(false);
    expect(esCoordenadaValida({ lat: 0, lng: -181 })).toBe(false);
    expect(esCoordenadaValida({ lat: "40.75", lng: -73.86 })).toBe(false);
    expect(esCoordenadaValida(null)).toBe(false);
    expect(esCoordenadaValida("40.75,-73.86")).toBe(false);
  });
});

describe("CENTROIDES — el catálogo tiene que ser sano por construcción", () => {
  it("no tiene dos filas que signifiquen el mismo lugar", () => {
    // Un duplicado normalizado haría INALCANZABLE a la segunda fila: la pasada
    // por igualdad de `centroideDeZona` devuelve siempre la primera.
    const vistas = new Set<string>();
    const duplicadas: string[] = [];
    for (const centroide of CENTROIDES) {
      const clave = normalizeGeoLabel(centroide.label);
      if (vistas.has(clave)) duplicadas.push(centroide.label);
      vistas.add(clave);
    }
    expect(duplicadas).toEqual([]);
  });

  it("todas las coordenadas caen en el área metropolitana de Nueva York", () => {
    // Un dígito de más o un signo dado vuelta manda un barrio al Atlántico y el
    // radio empieza a devolver cosas absurdas sin que nada falle.
    for (const { label, lat, lng } of CENTROIDES) {
      expect(lat, label).toBeGreaterThan(40.4);
      expect(lat, label).toBeLessThan(41.1);
      expect(lng, label).toBeLessThan(-73.4);
      expect(lng, label).toBeGreaterThan(-74.4);
    }
  });

  it("cada fila se encuentra a sí misma por su propia etiqueta", () => {
    for (const centroide of CENTROIDES) {
      expect(centroideDeZona(centroide.label), centroide.label).toEqual(centroide);
    }
  });

  it("tiene los barrios que ya aparecen en los datos de esta comunidad", () => {
    // Si alguno se cayera del catálogo, "usar mi ubicación" dejaría de poder
    // devolver la zona donde de hecho vive la gente de esta comunidad.
    for (const barrio of [
      "Corona, Queens",
      "Jackson Heights, Queens",
      "Elmhurst, Queens",
      "Flushing, Queens",
      "Woodside, Queens",
      "Astoria, Queens",
      "Jamaica, Queens",
      "New York, NY",
    ]) {
      expect(centroideDeZona(barrio), barrio).not.toBeNull();
    }
  });
});

describe("centroideDeZona — igualdad primero, match laxo después", () => {
  it("encuentra por igualdad normalizada, sin importar mayúsculas ni acentos", () => {
    expect(centroideDeZona("corona, queens")?.label).toBe("Corona, Queens");
    expect(centroideDeZona("  CORONA,   QUEENS  ")?.label).toBe("Corona, Queens");
  });

  it("encuentra el barrio escrito a secas, sin el condado", () => {
    // Es el caso real: la gente escribe "Corona", no "Corona, Queens".
    expect(centroideDeZona("Corona")?.label).toBe("Corona, Queens");
    expect(centroideDeZona("Astoria")?.label).toBe("Astoria, Queens");
  });

  it("la igualdad le gana a la contención: un condado no cae en un barrio suyo", () => {
    // "Queens, NY" está contenido laxamente por una docena de barrios de
    // Queens. Sin la pasada de igualdad primero, elegir el condado entero
    // aterrizaría en cualquiera de ellos.
    expect(centroideDeZona("Queens, NY")?.label).toBe("Queens, NY");
    expect(centroideDeZona("Brooklyn, NY")?.label).toBe("Brooklyn, NY");
  });

  it("ante varios candidatos laxos gana la etiqueta más corta, y es determinista", () => {
    // "harlem" está adentro de "Harlem, Manhattan" y de "East Harlem,
    // Manhattan". Gana el más corto, que es el que la persona quiso decir.
    expect(centroideDeZona("Harlem")?.label).toBe("Harlem, Manhattan");
    expect(centroideDeZona("Elmhurst")?.label).toBe("Elmhurst, Queens");
    // Y contesta lo MISMO todas las veces: una zona que cae en un barrio
    // distinto según el día sería peor que no contestar.
    expect(centroideDeZona("Harlem")).toEqual(centroideDeZona("Harlem"));
  });

  it("devuelve null cuando no conoce el lugar", () => {
    expect(centroideDeZona("cerca del parque")).toBeNull();
    expect(centroideDeZona("Bogotá")).toBeNull();
    expect(centroideDeZona("")).toBeNull();
    expect(centroideDeZona(null)).toBeNull();
    expect(centroideDeZona(undefined)).toBeNull();
  });
});

describe("barrioMasCercano — la única función que toca una ubicación real", () => {
  it("parada en el centro de un barrio, devuelve ese barrio", () => {
    const cercano = barrioMasCercano(CORONA);
    expect(cercano?.centroide.label).toBe("Corona, Queens");
    expect(cercano?.millas).toBeCloseTo(0, 6);
  });

  it("a unas cuadras, sigue devolviendo el barrio correcto", () => {
    // ~0.5 millas al norte de Corona: sigue siendo Corona, no el barrio de al
    // lado. Es el caso normal de alguien parado en su casa.
    const cercano = barrioMasCercano({ lat: 40.7570, lng: -73.862 });
    expect(cercano?.centroide.label).toBe("Corona, Queens");
  });

  it("en Manhattan devuelve un barrio de Manhattan", () => {
    expect(barrioMasCercano({ lat: 40.8417, lng: -73.9394 })?.centroide.label).toBe(
      "Washington Heights, Manhattan",
    );
  });

  it("NO devuelve el catálogo entero: fuera del área metropolitana contesta null", () => {
    // Este es el test que impide la respuesta segura de sí misma y falsa.
    // Miami y Santo Domingo no son Queens, y decirles que sí les cambiaría lo
    // que ven con una mentira.
    expect(barrioMasCercano({ lat: 25.7617, lng: -80.1918 })).toBeNull();
    expect(barrioMasCercano({ lat: 18.4861, lng: -69.9312 })).toBeNull();
    expect(barrioMasCercano({ lat: 0, lng: 0 })).toBeNull();
  });

  it("el techo es configurable y se respeta", () => {
    // Filadelfia está a ~80 millas: afuera del techo normal, adentro de uno
    // grande. Verifica que el corte es el parámetro y no un accidente.
    const filadelfia = { lat: 39.9526, lng: -75.1652 };
    expect(barrioMasCercano(filadelfia, SNAP_MAX_MILLAS)).toBeNull();
    expect(barrioMasCercano(filadelfia, 120)).not.toBeNull();
  });

  it("una coordenada inválida no explota: contesta null", () => {
    expect(barrioMasCercano({ lat: Number.NaN, lng: -73.86 })).toBeNull();
    expect(barrioMasCercano({ lat: 999, lng: 999 })).toBeNull();
  });
});

describe("zonasEnRadio — el filtro que recorta los listados", () => {
  const CATALOGO = [
    "Corona, Queens",
    "Jackson Heights, Queens",
    "Elmhurst, Queens",
    "Flushing, Queens",
    "Far Rockaway, Queens",
    "Yonkers, NY",
    "cerca del parque",
  ];

  it("sin barrio activo NO puede aplicar el radio y lo dice con null", () => {
    // `null` es distinto de `[]`. `[]` significa "no filtres" en el vocabulario
    // de este módulo, y devolverlo acá dejaría a alguien mirando toda la
    // comunidad justo cuando pidió acotar. Quien llama tiene que caer al
    // filtro por nombre de siempre.
    expect(zonasEnRadio(null, 25, CATALOGO)).toBeNull();
    expect(zonasEnRadio(undefined, 25, CATALOGO)).toBeNull();
    expect(zonasEnRadio("", 25, CATALOGO)).toBeNull();
    expect(zonasEnRadio("   ", 25, CATALOGO)).toBeNull();
  });

  it("con una zona que el catálogo no conoce, tampoco inventa: null", () => {
    expect(zonasEnRadio("cerca del parque", 25, CATALOGO)).toBeNull();
  });

  it("un radio que no es un número usable devuelve null", () => {
    expect(zonasEnRadio("Corona, Queens", 0, CATALOGO)).toBeNull();
    expect(zonasEnRadio("Corona, Queens", -5, CATALOGO)).toBeNull();
    expect(zonasEnRadio("Corona, Queens", Number.NaN, CATALOGO)).toBeNull();
  });

  it("trae los barrios de adentro del círculo y deja afuera los de afuera", () => {
    const salida = zonasEnRadio("Corona, Queens", 5, CATALOGO);
    expect(salida).not.toBeNull();
    expect(salida).toContain("Corona, Queens");
    expect(salida).toContain("Jackson Heights, Queens");
    expect(salida).toContain("Elmhurst, Queens");
    expect(salida).toContain("Flushing, Queens");
    // Far Rockaway (~11 mi) y Yonkers (~13 mi) quedan afuera de 5 millas.
    expect(salida).not.toContain("Far Rockaway, Queens");
    expect(salida).not.toContain("Yonkers, NY");
  });

  it("un radio más grande trae más, nunca menos", () => {
    const cinco = zonasEnRadio("Corona, Queens", 5, CATALOGO) ?? [];
    const veinticinco = zonasEnRadio("Corona, Queens", 25, CATALOGO) ?? [];
    for (const label of cinco) expect(veinticinco).toContain(label);
    expect(veinticinco).toContain("Far Rockaway, Queens");
    expect(veinticinco).toContain("Yonkers, NY");
  });

  it("una etiqueta sin centroide queda afuera: no se mete por las dudas", () => {
    // Meterla convertiría "25 millas a la redonda" en "esto más cualquier
    // cosa", que es justo lo que el radio promete no hacer.
    expect(zonasEnRadio("Corona, Queens", 100, CATALOGO)).not.toContain("cerca del parque");
  });

  it("SIEMPRE incluye lo que el filtro sin radio habría devuelto (la semilla)", () => {
    // La invariante que impide el absurdo: pedir un radio y ver MENOS avisos
    // que sin él.
    for (const zona of ["Corona", "Corona, Queens", "Flushing, Queens", "Yonkers, NY"]) {
      const sinRadio = zonasCoincidentes(zona, CATALOGO);
      for (const millas of [5, 10, 25, 50, 100]) {
        const conRadio = zonasEnRadio(zona, millas, CATALOGO);
        expect(conRadio, `${zona} @ ${millas}`).not.toBeNull();
        for (const label of sinRadio) {
          expect(conRadio, `${zona} @ ${millas}`).toContain(label);
        }
      }
    }
  });

  it("la zona elegida va primera, aunque no esté en el catálogo del tenant", () => {
    const salida = zonasEnRadio("Corona", 25, CATALOGO);
    expect(salida?.[0]).toBe("Corona");
  });

  it("no repite una etiqueta que la semilla ya trajo", () => {
    const salida = zonasEnRadio("Corona, Queens", 100, CATALOGO) ?? [];
    expect(new Set(salida).size).toBe(salida.length);
  });

  it("respeta el techo de etiquetas y corta por las MÁS LEJANAS", () => {
    // El `.in()` viaja en el querystring y tiene techo. Lo que se cae tiene que
    // ser el borde del círculo, nunca la cuadra de al lado.
    const catalogoGrande = CENTROIDES.map((c) => c.label);
    const salida = zonasEnRadio("Corona, Queens", 100, catalogoGrande);
    expect(salida).not.toBeNull();
    expect(salida!.length).toBeLessThanOrEqual(ZONAS_MATCH_MAX);
    // Los vecinos inmediatos entran; el techo no se los come.
    expect(salida).toContain("Jackson Heights, Queens");
    expect(salida).toContain("Elmhurst, Queens");
    // Y lo que entró está ordenado de más cerca a más lejos (después de la
    // semilla, que siempre va adelante).
    const centro = centroideDeZona("Corona, Queens")!;
    const distancias = salida!
      .slice(1)
      .map((label) => distanciaEnMillas(centro, centroideDeZona(label)!));
    const ordenadas = [...distancias].sort((a, b) => a - b);
    expect(distancias).toEqual(ordenadas);
  });

  it("tolera basura adentro del catálogo del tenant sin romperse", () => {
    const sucio = ["Corona, Queens", "", "   ", "Elmhurst, Queens"];
    const salida = zonasEnRadio("Corona, Queens", 25, sucio);
    expect(salida).toContain("Corona, Queens");
    expect(salida).toContain("Elmhurst, Queens");
    expect(salida).not.toContain("");
    expect(salida).not.toContain("   ");
  });
});

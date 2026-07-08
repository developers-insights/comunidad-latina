// Dirección de arte compartida. Un solo "look" para que el set sea cohesivo:
// misma cámara, misma luz cálida, mismo material mate premium, fondo plano.
// Colores SOLO de la capa fija del design system (neutros + semánticos):
// un raster no puede llevar el color de marca del tenant (varía por dominio).

const LOOK_BASE = [
  "matte soft-touch ceramic finish with a subtle satin bevel along the edges",
  "soft warm key light from the upper left, gentle ambient fill, no harsh specular highlights, no glossy mirror reflections",
  "slight 3/4 tilt facing the viewer, perfectly centered, isolated single object",
  "flat plain light warm-gray studio background, soft diffuse contact shadow",
  "premium fintech trust emblem, collectible enamel pin aesthetic, physically based render",
];

// Los emblemas puros prohíben texto; el de marca LO NECESITA (monograma).
const NO_TEXT = "clean and minimal, no text, no lettering, no logos, no extra objects, no hands";
const WITH_TEXT = "clean and minimal, no extra objects, no hands, no additional lettering beyond the monogram";

const p = (subject) => `A single premium 3D emblem: ${subject}. ${[...LOOK_BASE, NO_TEXT].join(", ")}.`;
const pText = (subject) => `A single premium 3D emblem: ${subject}. ${[...LOOK_BASE, WITH_TEXT].join(", ")}.`;

// Nota de la sesión: "collectible enamel pin" (en LOOK_BASE) es el lenguaje
// correcto para insignias —escudos, sellos, estrella— pero convierte una GEMA en
// una placa plana con engaste. Se intentó un look alternativo que pedía
// "gemstone con volumen real": image-to-3d devolvió un pedrusco grumoso, porque
// no reconstruye vidrio transparente. La solución fue no pelearse con el look:
// pedir un SÓLIDO FACETADO OPACO, el mismo material que el resto del set.

export const PROMPTS = {
  // ── Bloque 1 — Escudo Anti-Estafa (la firma visual del moat) ──────────────
  "escudo-guard": {
    prompt: p(
      "a rounded heraldic shield with a bold rounded checkmark deeply embossed at its center, " +
        "the shield body in deep emerald green #1A7F5A, the checkmark in warm cream #FCFCFB",
    ),
    note: "Hero de /escudo. Verde success (color semántico FIJO, no varía por tenant).",
  },
  "escudo-alerta": {
    prompt: p(
      "a rounded heraldic shield with a bold rounded exclamation mark deeply embossed at its center, " +
        "the shield body in warm amber ochre #B7791F, the exclamation mark in warm cream #FCFCFB",
    ),
    note: "ScamShieldNotice. Ámbar warning (semántico fijo).",
  },
  "sello-verificado": {
    prompt: p(
      "a circular scalloped notary seal medallion with a bold rounded checkmark deeply embossed at its center, " +
        "the medallion in deep emerald green #1A7F5A, the checkmark in warm cream #FCFCFB",
    ),
    note: "VerificationCard found_active. Verde success.",
  },
  "sello-alerta": {
    prompt: p(
      "a circular scalloped notary seal medallion with a bold rounded X cross deeply embossed at its center, " +
        "the medallion in muted brick red #C23B3B, the X in warm cream #FCFCFB",
    ),
    note: "VerificationCard not_found. Rojo danger.",
  },

  // ── Bloque 2 — Los 5 niveles del Trust Score (§3.3, set coleccionable) ────
  "trust-1-nuevo": {
    prompt: p(
      "a small two-leaf sprout seedling growing out of a rounded pebble base, " +
        "the sprout in soft sage green, the pebble base in warm sand beige #E2DFD7",
    ),
    note: "Nivel Nuevo. Brote. Neutro cálido (el nivel es gris: el objeto no grita).",
  },
  "trust-2-verificado": {
    prompt: p(
      "a circular seal badge with a scalloped rim and a bold rounded checkmark deeply embossed at its center, " +
        "the seal in steel blue #2B6CB0, the checkmark in warm cream #FCFCFB",
    ),
    note: "Nivel Verificado. Sello-check. Azul info (semántico fijo).",
  },
  // Nivel "Confiable" NO tiene emblema propio: reutiliza `escudo-guard`. Un
  // escudo verde significa "protegido" en todo el producto — un objeto, un
  // significado. Ver el MAP de process.mjs.
  "trust-4-premium": {
    // v2: la v1 salió BLANCA — "satin sheen" + "matte ceramic" la empujaron a
    // perla. Se refuerza el color con nombre + hex + negativo explícito.
    prompt: p(
      "a plump rounded five-pointed star with softly beveled faceted points, " +
        "the entire star saturated deep golden ochre yellow #B7791F, " +
        "rich warm gold enamel color throughout, amber-gold tone, " +
        "absolutely not white, not silver, not pearl, not cream",
    ),
    note: "Nivel Premium. Estrella. Dorado (token --color-gold #B7791F).",
  },
  "trust-5-diamante": {
    // v1: rosa/lila ("lilac inner glints" tomado literal).
    // v2: incoloro pero PLANO, con reborde oscuro — el LOOK compartido
    //     ("collectible enamel pin") convierte una gema en placa con engaste.
    // v3: pGem exigiendo volumen -> image-to-3d no reconstruye vidrio
    //     transparente: salió un pedrusco grumoso. Peor.
    // v4: el material del set es ESMALTE MATE. Se abandona la gema de vidrio y
    //     se pide un sólido facetado, con el mismo lenguaje que la estrella (que
    //     salió limpia): objeto macizo, sin engaste, sin reborde, opaco.
    // v5: v4 salió limpio pero SIN facetas y casi blanco. Se piden las facetas
    // triangulares de la corona una por una y se fuerza el color con hex.
    prompt: p(
      "a chunky solid brilliant-cut diamond, thick and voluminous, " +
        "a wide flat hexagonal table on top surrounded by a ring of distinct triangular crown facets, " +
        "the body tapering down to a point through clearly defined long angled pavilion facets, " +
        "each facet a separate flat plane catching the light at its own angle, " +
        "opaque enamel in pale ice blue #A9C8E8 with cool white highlights on the upper facets, " +
        "no metal setting, no outline rim, no border around it, " +
        "not transparent, not glass, not white, no pink, no rose, no purple, no lilac",
    ),
    note:
      "Nivel Diamante. Cristal NEUTRO a propósito: el código lo tiñe con text-brand, " +
      "que varía por tenant — un diamante azul horneado rompería el tenant naranja.",
  },

  // ── Bloque 3 — Emblema de marca ───────────────────────────────────────────
  "brand-emblem": {
    prompt: pText(
      "a rounded heraldic shield in deep royal blue #1A5EDB, its flat front face bearing only the " +
        'two capital letters "CL" side by side as a monogram, raised and embossed in warm cream ' +
        "#FCFCFB, the letters simple, geometric, evenly spaced and perfectly legible",
    ),
    note: "Ícono PWA + BrandMark 3D. Azul de la familia de producto (fijo, igual que brand-mark.svg).",
  },
};

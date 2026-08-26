import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * LAS FORMAS RESERVADAS — test de contrato, no de render
 * =============================================================================
 *
 * En la app conviven tres cosas que la gente lee como "verificado", y cada una
 * tiene su FORMA reservada. No sólo su color: hay daltonismo, y a 14px, al sol
 * y sin nada al lado con qué comparar, el tono no es un canal.
 *
 *   · ESCUDO (`ShieldCheck`) verde — un HECHO comprobado de la persona o la
 *     ficha. Gratis o ganado: `IdentityBadge`, `SellerIdentityBadge`.
 *   · SELLO (`SealCheck`) azul — un PLAN CONTRATADO. Se compra: el check azul
 *     (0101) y la Presencia Verificada de negocios.
 *   · El ladder del Trust Score — REPUTACIÓN. No verifica nada, no se compra.
 *
 * LOS DOS BUGS QUE ESTE TEST ANCLA, los dos reales y los dos encontrados en la
 * misma auditoría:
 *
 *  1. `components/trust/levels.ts` dibujaba un `SealCheck` azul en el peldaño
 *     "Activo" (30–49 puntos, el segundo más bajo) y un `ShieldCheck` verde en
 *     "Confiable". O sea: un score de 30 mostraba el mismo tilde que una
 *     suscripción paga al día, y en una card de directorio podían convivir dos
 *     escudos verdes idénticos con significados distintos.
 *
 *  2. `perfil/profile-panels.tsx` dibujaba un `SealCheck` en `text-info` al
 *     lado de cada nombre de la lista de seguidores cuando la persona tenía
 *     `identity_verified`. Es, píxel por píxel, el check azul PAGO puesto sobre
 *     una verificación GRATIS.
 *
 * POR QUÉ ES ESTÁTICO. Estas dos regresiones no rompen ningún render: la
 * pantalla anda perfecto y miente igual. Lo único verificable siempre es la
 * REGLA — qué glifo puede aparecer al lado de qué dato.
 *
 * ALCANCE: el territorio de confianza/identidad. Los módulos de avisos tienen
 * su propia gramática ya unificada (`seller-chip.tsx`, `professional-card.tsx`)
 * y sus propios tests.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Carpetas donde vive la gramática de confianza e identidad. */
const ROOTS = [
  path.join(SRC, "components", "trust"),
  path.join(SRC, "components", "auth"),
  path.join(SRC, "components", "verificacion"),
  path.join(SRC, "components", "comunidad"),
  path.join(SRC, "components", "creators"),
  path.join(SRC, "app", "(app)", "perfil"),
  path.join(SRC, "app", "(app)", "verificacion"),
  path.join(SRC, "app", "(app)", "ajustes"),
];

const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (EXTENSIONS.includes(path.extname(entry)) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = ROOTS.flatMap(walk);

/**
 * Las líneas de COMENTARIO no cuentan. Media docena de archivos explican por
 * qué NO usan tal o cual ícono, y ese texto es justamente lo que mantiene viva
 * la regla — sería absurdo que la rompiera.
 */
function codeLines(source: string): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = [];
  let inBlock = false;
  source.split("\n").forEach((raw, index) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const block = line.indexOf("/*");
    if (block !== -1) {
      inBlock = !line.includes("*/", block);
      line = line.slice(0, block) + (inBlock ? "" : line.slice(line.indexOf("*/", block) + 2));
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);
    if (line.trim()) out.push({ line, number: index + 1 });
  });
  return out;
}

describe("las formas reservadas de las tres verificaciones", () => {
  it("encuentra los archivos del territorio de confianza", () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES).toContain(path.join(SRC, "components", "trust", "levels.ts"));
  });

  it("el ladder del Trust Score no usa ni el escudo ni el sello", () => {
    // La reputación no es un hecho verificado ni un plan pago: si toma prestada
    // la forma de cualquiera de los dos, pasa a afirmar algo que no midió.
    const levels = readFileSync(path.join(SRC, "components", "trust", "levels.ts"), "utf8");
    const offenders = codeLines(levels)
      .filter(({ line }) => /\b(ShieldCheck|SealCheck)\b/.test(line))
      .map(({ line, number }) => `components/trust/levels.ts:${number} → ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  it('el nivel 70–84 no se llama "Verificado" a secas', () => {
    // §11 del repo. Se llega a ese peldaño con antigüedad, transacciones y
    // avales, SIN haber verificado ningún documento: la palabra prometía algo
    // que la app no comprobó. El `id` sigue siendo `verificado` porque es lo
    // que guarda `trust_scores.level` — lo que no puede decir "Verificado" es
    // la etiqueta que se lee.
    const levels = readFileSync(path.join(SRC, "components", "trust", "levels.ts"), "utf8");
    const canon = readFileSync(path.join(SRC, "lib", "trust", "levels.ts"), "utf8");

    for (const [name, source] of [
      ["components/trust/levels.ts", levels],
      ["lib/trust/levels.ts", canon],
    ] as const) {
      const labels = [...source.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels, `${name} sigue rotulando un nivel como "Verificado"`).not.toContain(
        "Verificado",
      );
    }
  });

  it("ninguna insignia de identidad verificada usa el sello del plan pago", () => {
    // `identity_verified` es Stripe Identity: GRATIS, y su marca es el escudo
    // verde de `IdentityBadge`. El sello con tilde es la insignia que se
    // compra. Pintar el sello sobre el dato gratis es hacer pasar una cosa por
    // la otra — que es todo lo que este módulo existe para evitar.
    const WINDOW = 8;
    const violations: string[] = [];

    for (const file of FILES) {
      const lines = codeLines(readFileSync(file, "utf8"));
      const seals = new Set(
        lines.filter(({ line }) => /\bSealCheck\b/.test(line)).map(({ number }) => number),
      );
      if (seals.size === 0) continue;

      for (const { line, number } of lines) {
        if (!/\bidentity_verified\b|\bidentityVerified\b/.test(line)) continue;
        for (const seal of seals) {
          if (Math.abs(seal - number) > WINDOW) continue;
          violations.push(
            `${path.relative(SRC, file)}:${seal} dibuja un <SealCheck> a ${Math.abs(seal - number)} ` +
              `líneas de \`identityVerified\` (línea ${number}). El sello es la insignia PAGA ` +
              `(check azul / Presencia Verificada); la identidad con documento es gratis y le ` +
              `corresponde el escudo de IdentityBadge.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

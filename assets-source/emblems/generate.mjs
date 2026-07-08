/**
 * Emblemas 3D — generación (Meshy).
 *
 *   text-to-image (nano-banana-pro, concepto art-dirigido)
 *     -> image-to-3d (meshy-6, malla + textura)
 *     -> alpha_thumbnail (render PNG del modelo 3D, fondo transparente)
 *
 * Después: `node assets-source/emblems/process.mjs <dir>` para el WebP final.
 *
 * Uso:
 *   export MESHY_API_KEY=msy_...        # nunca se commitea
 *   node assets-source/emblems/generate.mjs escudo-guard trust-4-premium
 *   node assets-source/emblems/generate.mjs --all
 *
 * Costo: 9 cr (concepto) + 30 cr (3D) = 39 cr por emblema.
 * El ledger (out/ledger.json) hace la corrida idempotente: re-ejecutar no
 * vuelve a pagar un task ya creado; para forzar un re-render, borrá su entrada.
 *
 * Ajustes fijados empíricamente (ver PROMPTS):
 *  - enable_pbr:false     -> el PBR mete especular y rompe el look mate.
 *  - remove_lighting:false-> conserva la luz cálida horneada del concepto;
 *                            con `true`, Meshy re-ilumina con su estudio frío.
 */
import fs from "node:fs";
import path from "node:path";
import { PROMPTS } from "./prompts.mjs";

const KEY = process.env.MESHY_API_KEY;
if (!KEY) throw new Error("Falta MESHY_API_KEY en el entorno");

const BASE = "https://api.meshy.ai/openapi";
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const OUT = path.join(process.cwd(), "assets-source/emblems/out");
const LEDGER = path.join(OUT, "ledger.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, pathname, body) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status} ${t}`);
  return JSON.parse(t);
}

async function waitFor(kind, id) {
  for (let i = 0; i < 90; i++) {
    const t = await api("GET", `/v1/${kind}/${id}`);
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") {
      throw new Error(`${kind} ${id} -> ${t.status}`);
    }
    await sleep(6000);
  }
  throw new Error(`${kind} ${id} timeout`);
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

const MODEL_3D = {
  ai_model: "meshy-6",
  should_texture: true,
  enable_pbr: false,
  remove_lighting: false,
  alpha_thumbnail: true,
  target_formats: ["glb"],
};

fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : {};
const save = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

const args = process.argv.slice(2);
const keys = args[0] === "--all" ? Object.keys(PROMPTS) : args;
if (!keys.length) throw new Error("pasá claves de emblema o --all");

for (const key of keys) {
  const spec = PROMPTS[key];
  if (!spec) throw new Error(`emblema desconocido: ${key}`);
  const rec = (ledger[key] ??= {});

  if (!rec.imageTask) {
    rec.imageTask = (
      await api("POST", "/v1/text-to-image", {
        ai_model: "nano-banana-pro",
        prompt: spec.prompt,
        aspect_ratio: "1:1",
      })
    ).result;
    save();
  }
  const img = await waitFor("text-to-image", rec.imageTask);
  await download(img.image_urls?.[0] ?? img.image_url, path.join(OUT, "concept", `${key}.png`));

  if (!rec.task3d) {
    rec.task3d = (
      await api("POST", "/v1/image-to-3d", { input_task_id: rec.imageTask, ...MODEL_3D })
    ).result;
    save();
  }
  const m = await waitFor("image-to-3d", rec.task3d);
  await download(m.alpha_thumbnail_url, path.join(OUT, "alpha", `${key}.png`));
  if (m.model_urls?.glb) await download(m.model_urls.glb, path.join(OUT, "glb", `${key}.glb`));

  rec.credits = (img.consumed_credits ?? 0) + (m.consumed_credits ?? 0);
  save();
  console.log(`[${key}] listo — ${rec.credits} cr`);
}

console.log("balance:", (await api("GET", "/v1/balance")).balance, "cr");

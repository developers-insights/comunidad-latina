// Audita qué variables de entorno le faltan al proyecto de Vercel respecto de `.env.local`.
//
// POR QUÉ EXISTE: una clave que funciona en la notebook y no está en Vercel es una feature
// que el cliente cree entregada y en producción no existe. Pasó exactamente eso: la clave de
// Resend es válida desde el 2026-08-01, pero producción nunca la tuvo — así que ningún correo
// salió nunca del sitio publicado. Este script hace visible esa diferencia antes de prometerla.
//
// NUNCA imprime valores. Sólo nombres, destino y un veredicto.
//
// Uso:
//   node scripts/vercel-env-sync.mjs            # sólo reporta (default, no escribe nada)
//   node scripts/vercel-env-sync.mjs --push     # sube las que faltan y son subibles
//
// El `--push` es explícito a propósito: escribir en producción es una decisión de una persona,
// no un efecto colateral de correr un reporte.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const TEAM_ID = 'team_DDWd3gfPbdPnDlj5HGoRtckT' // insights3 · InsightsApps
const PROJECT_ID = 'prj_eNnHfx33W1879zoNu2HuoixP4JEO' // comunidad-latina
const PUSH = process.argv.includes('--push')

const TOKEN = process.env.VERCEL_API_TOKEN
if (!TOKEN) {
  console.error('Falta VERCEL_API_TOKEN en .env.local')
  process.exit(1)
}

/**
 * Clasificación curada. El default NO es "subir todo": una variable de más en producción es
 * superficie de ataque de más, y las credenciales de herramientas locales no tienen por qué
 * vivir en el runtime del sitio.
 *
 *   prod      → el sitio publicado la necesita en runtime.
 *   build     → sólo el build la usa (source maps, generación de assets).
 *   local     → herramienta de la notebook. NUNCA sube.
 *   unused    → declarada pero sin consumidor hoy.
 */
const CLASS = {
  CRON_SECRET: { scope: 'prod', why: 'protege los endpoints de cron' },
  EMAIL_FROM: { scope: 'prod', why: 'remitente de los correos' },
  RESEND_API_KEY: { scope: 'prod', why: 'sin esto no sale un solo correo desde el sitio' },
  NEXT_PUBLIC_SENTRY_DSN: { scope: 'prod', why: 'sin esto producción falla en silencio' },
  SENTRY_AUTH_TOKEN: { scope: 'build', why: 'sube los source maps; sin él los errores llegan minificados' },
  SENTRY_ORG: { scope: 'build', why: 'destino de los source maps' },
  SENTRY_PROJECT: { scope: 'build', why: 'destino de los source maps' },
  NEXT_PUBLIC_SITE_URL: { scope: 'prod', why: 'base de los links absolutos (correos, sitemap, OG)' },
  NEXT_PUBLIC_APP_ENV: { scope: 'prod', why: 'distingue dev/staging/producción' },
  NEXT_PUBLIC_SUPABASE_URL: { scope: 'prod', why: 'cliente de Supabase' },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: { scope: 'prod', why: 'cliente de Supabase' },
  SUPABASE_SERVICE_ROLE_KEY: { scope: 'prod', why: 'operaciones server-only' },
  OPENAI_API_KEY: { scope: 'prod', why: 'moderación de texto y asistente RAG' },
  STRIPE_SECRET_KEY: { scope: 'prod', why: 'cobros' },
  STRIPE_WEBHOOK_SECRET: { scope: 'prod', why: 'valida la firma del webhook de Stripe' },
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: { scope: 'prod', why: 'checkout del lado del navegador' },
  GOOGLE_VISION_API_KEY: { scope: 'prod', why: 'moderación de imagen' },
  GEMINI_API_KEY: { scope: 'unused', why: 'sin consumidor en el código hoy' },

  SUPABASE_DB_PASSWORD: {
    scope: 'local',
    why: 'sólo la usa scripts/apply-migrations.mjs desde la notebook — el runtime nunca abre una conexión directa a Postgres',
  },
  SEED_DEMO_PASSWORD: { scope: 'local', why: 'sólo el seed de datos demo' },
  MESHY_API_KEY: { scope: 'local', why: 'pipeline de assets 3D, se corre a mano' },
  VERCEL_API_TOKEN: { scope: 'local', why: 'credencial de la herramienta, no del sitio' },
  VERCEL_OIDC_TOKEN: { scope: 'local', why: 'lo inyecta Vercel solo' },
  VERCEL_TEAM_ID: { scope: 'local', why: 'credencial de la herramienta' },
  VERCEL_PROJECT_ID: { scope: 'local', why: 'credencial de la herramienta' },
}

/** Prefijo esperado por clave conocida. Un valor con la forma equivocada es un placeholder. */
const SHAPE = {
  RESEND_API_KEY: /^re_/,
  STRIPE_SECRET_KEY: /^sk_(test|live)_/,
  STRIPE_WEBHOOK_SECRET: /^whsec_/,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: /^pk_(test|live)_/,
  NEXT_PUBLIC_SENTRY_DSN: /^https:\/\//,
  NEXT_PUBLIC_SUPABASE_URL: /^https:\/\//,
}

/**
 * Un valor "presente" puede ser basura. El caso real que motivó esto: STRIPE_SECRET_KEY tenía
 * el comentario del .env.example pegado adentro del valor, así que `length > 0` decía "está" y
 * la API de Stripe respondía 401. Chequear la forma, no la longitud.
 */
function looksPlaceholder(key, value) {
  if (!value) return 'vacía'
  if (/(placeholder|your[-_]|xxxx|TODO|CAMBIAR|pegar[- ]aca)/i.test(value)) return 'texto de ejemplo sin reemplazar'
  const shape = SHAPE[key]
  if (shape && !shape.test(value)) return `no tiene la forma esperada (${shape.source})`
  return null
}

/**
 * Parsea `.env.local` como lo hace dotenv, no "a ojo".
 *
 * El detalle que importa: dotenv **descarta el comentario en línea** de un valor sin comillas
 * (`KEY=valor   # nota`), pero lo CONSERVA si el valor está entre comillas. Un parser ingenuo
 * que corta en el primer `#` rompe cualquier secreto que contenga ese carácter, y uno que no
 * corta nunca marca como placeholder a media docena de claves válidas. Las dos versiones
 * equivocadas de este parser existieron antes de esta.
 */
function readLocalEnv() {
  const raw = readFileSync(join(root, '.env.local'), 'utf8')
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value)
    if (quoted) {
      value = quoted[2]
    } else {
      value = value.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim()
    }
    out[m[1]] = value
  }
  return out
}

const api = (path, init) =>
  fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM_ID}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

async function main() {
  const local = readLocalEnv()

  const res = await api(`/v9/projects/${PROJECT_ID}/env`)
  if (!res.ok) {
    console.error(`Vercel respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  const remote = new Map()
  for (const e of (await res.json()).envs ?? []) remote.set(e.key, e.target ?? [])

  const faltan = []
  const conProblema = []
  const deMas = []
  const ok = []

  for (const [key, value] of Object.entries(local)) {
    const meta = CLASS[key] ?? { scope: 'unused', why: 'sin clasificar — agregala a CLASS en este script' }
    if (meta.scope === 'local' || meta.scope === 'unused') {
      if (remote.has(key)) deMas.push({ key, ...meta })
      continue
    }
    const problema = looksPlaceholder(key, value)
    if (remote.has(key)) {
      ok.push({ key, targets: remote.get(key) })
    } else if (problema) {
      conProblema.push({ key, problema, ...meta })
    } else {
      faltan.push({ key, value, ...meta })
    }
  }

  const line = (s) => console.log(s)
  line('')
  line('  VERCEL · comunidad-latina · team insights3')
  line('  ─────────────────────────────────────────────────────────────')
  line('')

  line(`  ✅ Ya están en Vercel (${ok.length})`)
  for (const e of ok) line(`     ${e.key}  →  ${e.targets.join(', ')}`)
  line('')

  if (faltan.length) {
    line(`  ❌ FALTAN en Vercel y son subibles ahora (${faltan.length})`)
    for (const e of faltan) line(`     ${e.key}  [${e.scope}]  — ${e.why}`)
    line('')
  }

  if (conProblema.length) {
    line(`  ⏸  FALTAN pero el valor local no sirve todavía (${conProblema.length})`)
    for (const e of conProblema) line(`     ${e.key}  — ${e.problema}`)
    line('')
  }

  if (deMas.length) {
    line(`  ⚠️  Están en Vercel y NO deberían (${deMas.length})`)
    for (const e of deMas) line(`     ${e.key}  — ${e.why}`)
    line('')
  }

  if (!PUSH) {
    line(faltan.length ? '  Para subir las que faltan:  node scripts/vercel-env-sync.mjs --push' : '  Nada para subir.')
    line('')
    return
  }

  if (!faltan.length) {
    line('  Nada para subir.')
    line('')
    return
  }

  line(`  Subiendo ${faltan.length}…`)
  for (const e of faltan) {
    const target = e.scope === 'build' ? ['production', 'preview'] : ['production', 'preview']
    const r = await api(`/v10/projects/${PROJECT_ID}/env`, {
      method: 'POST',
      body: JSON.stringify({
        key: e.key,
        value: e.value,
        type: e.key.startsWith('NEXT_PUBLIC_') ? 'plain' : 'encrypted',
        target,
      }),
    })
    line(r.ok ? `     ✅ ${e.key}` : `     ❌ ${e.key} — ${r.status} ${(await r.text()).slice(0, 160)}`)
  }
  line('')
  line('  Ojo: las variables nuevas recién viven en el próximo deploy. Redeployá.')
  line('')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})

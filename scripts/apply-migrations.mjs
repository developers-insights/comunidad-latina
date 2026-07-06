// Aplica las migraciones de supabase/migrations en orden, directo a Postgres.
// Uso: node scripts/apply-migrations.mjs [--from 0003]
// Registra cada una en supabase_migrations.schema_migrations (mismo registro que usa el MCP/CLI).
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const REF = 'ktmbtpuhqqofdkisqseq'
const PASSWORD = process.env.SUPABASE_DB_PASSWORD
if (!PASSWORD) {
  console.error('Falta SUPABASE_DB_PASSWORD en .env.local')
  process.exit(1)
}

const CANDIDATES = [
  `postgresql://postgres:${encodeURIComponent(PASSWORD)}@db.${REF}.supabase.co:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-1-us-west-2.pooler.supabase.com:5432/postgres`,
]

async function connect() {
  // Primero TLS verificado; si el cert de Supabase no valida en este entorno,
  // degrada con warning explícito (host conocido, script one-off de migración).
  const sslModes = [{ mode: 'verificado', ssl: true }, { mode: 'sin-verificar (fallback)', ssl: { rejectUnauthorized: false } }]
  for (const { mode, ssl } of sslModes) {
    for (const url of CANDIDATES) {
      const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 10000 })
      try {
        await client.connect()
        console.log(`Conectado via ${url.split('@')[1].split(':')[0]} (TLS ${mode})`)
        if (mode !== 'verificado') console.warn('⚠️ TLS sin verificación de CA — solo aceptable para este script one-off contra host conocido.')
        return client
      } catch (e) {
        console.warn(`No conecta ${url.split('@')[1]?.split(':')[0]} (TLS ${mode}): ${e.message}`)
        try { await client.end() } catch {}
      }
    }
  }
  return null
}

const fromArg = process.argv.indexOf('--from')
const from = fromArg > -1 ? process.argv[fromArg + 1] : '0000'

const client = await connect()
if (!client) {
  console.error('SIN_CONEXION_DIRECTA')
  process.exit(2)
}

await client.query(`create schema if not exists supabase_migrations`)
await client.query(`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`)
const { rows: applied } = await client.query(`select version from supabase_migrations.schema_migrations`)
const appliedSet = new Set(applied.map(r => r.version))

const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

for (const file of files) {
  const version = file.replace('.sql', '')
  const num = file.slice(0, 4)
  if (num < from) { console.log(`skip (antes de --from): ${file}`); continue }
  if (appliedSet.has(version) || [...appliedSet].some(v => v.endsWith(version) || version.endsWith(v))) {
    console.log(`skip (ya aplicada): ${file}`)
    continue
  }
  const sql = readFileSync(join(dir, file), 'utf8')
  process.stdout.write(`Aplicando ${file} ... `)
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query(`insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict do nothing`, [version, version])
    await client.query('commit')
    console.log('OK')
  } catch (e) {
    await client.query('rollback')
    console.error(`FALLO en ${file}: ${e.message}`)
    await client.end()
    process.exit(3)
  }
}

await client.end()
console.log('TODAS_APLICADAS')

// Corre `supabase gen types typescript --db-url` sin exponer la password. TEMP.
import { spawnSync } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: 'C:/MisProyectos/INSIGHTS/clientes/comunidad_latina/.env.local' })

const REF = 'ktmbtpuhqqofdkisqseq'
const PASSWORD = process.env.SUPABASE_DB_PASSWORD
if (!PASSWORD) { console.error('Falta SUPABASE_DB_PASSWORD'); process.exit(1) }

const HOSTS = [
  `postgresql://postgres:${encodeURIComponent(PASSWORD)}@db.${REF}.supabase.co:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-1-us-west-2.pooler.supabase.com:5432/postgres`,
]

for (const url of HOSTS) {
  const host = url.split('@')[1].split(':')[0]
  console.error(`# probando ${host}`)
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--db-url', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const out = r.stdout ?? ''
  const err = (r.stderr ?? '').split(PASSWORD).join('***')
  if (r.status === 0 && out.includes('export type Database')) {
    process.stdout.write(out)
    console.error(`# OK via ${host} (${out.length} chars)`)
    process.exit(0)
  }
  console.error(`# fallo ${host} (status ${r.status}): ${err.trim().slice(0, 600)}`)
}
console.error('# NINGUN_HOST_FUNCIONO')
process.exit(3)

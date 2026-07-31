// Introspección de la base de Supabase (ktmbtpuhqqofdkisqseq) sin MCP ni CLI. TEMP.
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: 'C:/MisProyectos/INSIGHTS/clientes/comunidad_latina/.env.local' })

const REF = 'ktmbtpuhqqofdkisqseq'
const PASSWORD = process.env.SUPABASE_DB_PASSWORD
if (!PASSWORD) { console.error('Falta SUPABASE_DB_PASSWORD'); process.exit(1) }

const CANDIDATES = [
  `postgresql://postgres:${encodeURIComponent(PASSWORD)}@db.${REF}.supabase.co:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-1-us-west-2.pooler.supabase.com:5432/postgres`,
]

async function connect() {
  for (const ssl of [true, { rejectUnauthorized: false }]) {
    for (const url of CANDIDATES) {
      const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 12000 })
      try { await client.connect(); return client } catch { try { await client.end() } catch {} }
    }
  }
  return null
}

const client = await connect()
if (!client) { console.error('SIN_CONEXION'); process.exit(2) }

const { rows: tables } = await client.query(
  `select c.relname as name, c.relkind as kind
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v','m','p')
   order by c.relname`,
)
console.log('TABLAS(' + tables.length + '): ' + tables.map((r) => `${r.name}[${r.kind}]`).join(', '))

const ESPERADAS = [
  'user_roles', 'score_history', 'score_penalties', 'creator_scores', 'business_scores',
  'business_members', 'business_verifications', 'creator_portfolio_items', 'connected_accounts',
  'job_deliverables', 'job_revisions', 'appeals',
]
const presentes = new Set(tables.map((r) => r.name))
console.log('\n--- CHEQUEO 0028-0037 ---')
for (const t of ESPERADAS) console.log(`${presentes.has(t) ? 'SI ' : 'NO '} ${t}`)

const { rows: cols } = await client.query(
  `select table_name, column_name, udt_name, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public' and table_name = any($1)
   order by table_name, ordinal_position`,
  [ESPERADAS],
)
console.log('\n--- COLUMNAS ---')
for (const c of cols) {
  console.log(`${c.table_name}.${c.column_name} :: ${c.udt_name} null=${c.is_nullable} def=${c.column_default ?? '-'}`)
}

await client.end()

#!/usr/bin/env node
/**
 * rls-enumerator.mjs — Gate de seguridad multi-tenant (PLAN_MAESTRO §5.2.1)
 *
 * El modo de falla real no es "policy mal escrita" sino "la policy que nunca
 * se escribió" (CVE-2025-48757). Este script NO confía en una suite escrita a
 * mano: enumera el esquema real y ROMPE el build (exit 1) si algo falta.
 *
 * Reglas que aplica:
 *  1. Toda tabla de `public` con columna tenant_id (+ las globales
 *     whitelisteadas) debe tener RLS ENABLED **y** FORCED.
 *  2. Cada una debe tener EXACTAMENTE 4 policies nombradas
 *     <tabla>_select|insert|update|delete con el cmd correcto. Policies extra
 *     también fallan: una policy permisiva agregada "de más" es una fuga.
 *  3. Ninguna tabla de `public` puede quedar fuera del contrato: si no tiene
 *     tenant_id y no está whitelisteada, falla (decisión consciente o nada).
 *  4. storage.objects debe tener policies para los 4 cmds de cada bucket
 *     (avatars, listing-photos, tenant-assets), y los buckets deben existir.
 *
 * Uso: npm run check:rls   (lee .env.local: SUPABASE_DB_PASSWORD o DATABASE_URL)
 *
 * CONEXIÓN: el default (SUPABASE_DB_PASSWORD → db.<ref>.supabase.co) usa el
 * host directo, que en Supabase resuelve SOLO a IPv6 salvo add-on de IPv4
 * dedicado. En redes/CI solo-IPv4 (GitHub Actions incluido) seteá DATABASE_URL
 * apuntando al SESSION POOLER (tiene IPv4):
 *   postgresql://postgres.<project-ref>:<password>@aws-X-<region>.pooler.supabase.com:5432/postgres
 * (Dashboard → Connect → Session pooler. No usar el transaction pooler :6543
 * para este script.)
 */

import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const DB_HOST = 'db.ktmbtpuhqqofdkisqseq.supabase.co';
const DB_PORT = 5432;

/**
 * Tablas globales SIN tenant_id, cross-tenant BY DESIGN (documentadas en sus
 * migraciones). Whitelisteadas para la regla del tenant_id, pero se les exige
 * RLS FORCE + 4 policies igual que a todas.
 */
const GLOBAL_TABLES_BY_DESIGN = {
  tenants: 'la fila ES el tenant (0002) — select público de activos, escritura global_admin',
  broadcasts: 'Broadcast Global cross-tenant BY DESIGN (0010) — lectura pull por broadcast_targets',
  broadcast_receipts: 'receipt (broadcast, profile) — el tenant vive en profiles (0010)',
};

const STORAGE_BUCKETS = ['avatars', 'listing-photos', 'tenant-assets'];
const CMDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const SUFFIX_BY_CMD = { SELECT: 'select', INSERT: 'insert', UPDATE: 'update', DELETE: 'delete' };

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error('✘ Falta SUPABASE_DB_PASSWORD (o DATABASE_URL) en .env.local — no puedo auditar la base.');
    process.exit(1);
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@${DB_HOST}:${DB_PORT}/postgres`;
}

/**
 * TLS estricto por default (un gate de seguridad no viaja sin verificar certs).
 * - SUPABASE_DB_CA_CERT_PATH: ruta al CA de Supabase (Dashboard → Database →
 *   SSL → Download certificate) para validar la cadena completa.
 * - RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1: opt-out EXPLÍCITO solo para dev
 *   (imprime advertencia; jamás usarlo en CI).
 */
function buildSslConfig() {
  const caPath = process.env.SUPABASE_DB_CA_CERT_PATH;
  if (caPath) {
    if (!existsSync(caPath)) {
      console.error(`✘ SUPABASE_DB_CA_CERT_PATH apunta a un archivo inexistente: ${caPath}`);
      process.exit(1);
    }
    return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
  }
  if (process.env.RLS_ENUMERATOR_ALLOW_INSECURE_TLS === '1') {
    console.warn(
      '⚠ TLS sin verificación de certificado (RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1). ' +
        'Solo aceptable en dev; en CI configurá SUPABASE_DB_CA_CERT_PATH.'
    );
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

const failures = [];
const passes = [];

function fail(msg) {
  failures.push(msg);
}
function pass(msg) {
  passes.push(msg);
}

async function main() {
  const client = new pg.Client({
    connectionString: buildConnectionString(),
    ssl: buildSslConfig(),
    statement_timeout: 30_000,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error(`✘ No pude conectar a Postgres (${DB_HOST}): ${err.message}`);
    if (/certificate/i.test(String(err.message))) {
      console.error(
        '  Sugerencia: descargá el CA de Supabase (Dashboard → Database → SSL) y seteá ' +
          'SUPABASE_DB_CA_CERT_PATH en .env.local. Opt-out solo-dev: RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1.'
      );
    }
    if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(String(err.code ?? err.message))) {
      console.error(
        '  Sugerencia: el host directo db.<ref>.supabase.co resuelve SOLO a IPv6 en Supabase. ' +
          'Si tu red/CI es solo-IPv4, seteá DATABASE_URL en .env.local apuntando al SESSION POOLER ' +
          '(postgresql://postgres.<project-ref>:<password>@aws-X-<region>.pooler.supabase.com:5432/postgres — ' +
          'Dashboard → Connect → Session pooler), que sí tiene IPv4.'
      );
    }
    process.exit(1);
  }

  try {
    // -- 1. Tablas de public + flags de RLS -------------------------------
    const { rows: tables } = await client.query(`
      select c.relname as table_name,
             c.relrowsecurity as rls_enabled,
             c.relforcerowsecurity as rls_forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
       order by c.relname
    `);

    const { rows: tenantCols } = await client.query(`
      select table_name
        from information_schema.columns
       where table_schema = 'public'
         and column_name = 'tenant_id'
    `);
    const tenantTables = new Set(tenantCols.map((r) => r.table_name));

    const { rows: policies } = await client.query(`
      select schemaname, tablename, policyname, cmd, qual, with_check
        from pg_policies
       where schemaname in ('public', 'storage')
    `);

    const publicPoliciesByTable = new Map();
    for (const p of policies.filter((p) => p.schemaname === 'public')) {
      if (!publicPoliciesByTable.has(p.tablename)) publicPoliciesByTable.set(p.tablename, []);
      publicPoliciesByTable.get(p.tablename).push(p);
    }

    if (tables.length === 0) {
      fail('No hay tablas en el schema public: ¿las migraciones se aplicaron?');
    }

    for (const t of tables) {
      const name = t.table_name;
      const hasTenantId = tenantTables.has(name);
      const isWhitelisted = Object.hasOwn(GLOBAL_TABLES_BY_DESIGN, name);

      // Regla 3: nada queda fuera del contrato.
      if (!hasTenantId && !isWhitelisted) {
        fail(
          `Tabla public.${name}: sin columna tenant_id y NO whitelisteada. ` +
            `Agregale tenant_id o whitelistéala EXPLÍCITAMENTE en GLOBAL_TABLES_BY_DESIGN con su justificación.`
        );
        continue;
      }

      // Regla 1: RLS enabled + forced, sin excepción (whitelisted incluidas).
      if (!t.rls_enabled) fail(`Tabla public.${name}: RLS NO habilitado (enable row level security).`);
      if (!t.rls_forced) fail(`Tabla public.${name}: RLS sin FORCE (force row level security) — el owner/jobs la bypassean.`);

      // Regla 2: exactamente las 4 policies canónicas, con el cmd correcto.
      const tablePolicies = publicPoliciesByTable.get(name) ?? [];
      const expected = CMDS.map((cmd) => ({ cmd, name: `${name}_${SUFFIX_BY_CMD[cmd]}` }));

      for (const exp of expected) {
        const found = tablePolicies.find((p) => p.policyname === exp.name);
        if (!found) {
          fail(`Tabla public.${name}: falta la policy ${exp.name} (${exp.cmd}).`);
        } else if (found.cmd !== exp.cmd) {
          fail(`Tabla public.${name}: la policy ${exp.name} es FOR ${found.cmd}, se esperaba FOR ${exp.cmd}.`);
        }
      }

      const expectedNames = new Set(expected.map((e) => e.name));
      const extras = tablePolicies.filter((p) => !expectedNames.has(p.policyname));
      for (const extra of extras) {
        fail(
          `Tabla public.${name}: policy EXTRA "${extra.policyname}" (${extra.cmd}). ` +
            `El contrato es exactamente 4 policies canónicas: consolidá la lógica dentro de ellas.`
        );
      }

      if (
        t.rls_enabled &&
        t.rls_forced &&
        extras.length === 0 &&
        expected.every((e) => tablePolicies.some((p) => p.policyname === e.name && p.cmd === e.cmd))
      ) {
        pass(`public.${name} — RLS FORCE + 4/4 policies${isWhitelisted ? ' (global by design)' : ''}`);
      }
    }

    // -- 2. Storage: buckets + policies por bucket y por cmd ----------------
    let bucketRows = [];
    try {
      const res = await client.query(`select id from storage.buckets where id = any($1::text[])`, [STORAGE_BUCKETS]);
      bucketRows = res.rows;
    } catch {
      fail('No pude leer storage.buckets: ¿el proyecto tiene Storage habilitado?');
    }
    const existingBuckets = new Set(bucketRows.map((r) => r.id));

    const storagePolicies = policies.filter((p) => p.schemaname === 'storage' && p.tablename === 'objects');

    for (const bucket of STORAGE_BUCKETS) {
      if (!existingBuckets.has(bucket)) {
        fail(`Storage: falta el bucket "${bucket}" (0012_storage.sql no aplicado).`);
      }

      for (const cmd of CMDS) {
        const covering = storagePolicies.filter((p) => {
          if (p.cmd !== cmd && p.cmd !== 'ALL') return false;
          const definition = `${p.qual ?? ''} ${p.with_check ?? ''}`;
          return definition.includes(`'${bucket}'`);
        });
        if (covering.length === 0) {
          fail(`Storage: sin policy ${cmd} para el bucket "${bucket}" en storage.objects.`);
        }
      }

      if (
        existingBuckets.has(bucket) &&
        CMDS.every((cmd) =>
          storagePolicies.some((p) => {
            if (p.cmd !== cmd && p.cmd !== 'ALL') return false;
            return `${p.qual ?? ''} ${p.with_check ?? ''}`.includes(`'${bucket}'`);
          })
        )
      ) {
        pass(`storage bucket "${bucket}" — 4/4 cmds con policy`);
      }
    }
  } finally {
    await client.end();
  }

  // -- Reporte --------------------------------------------------------------
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ENUMERADOR RLS — Comunidad Latina (gate §5.2.1)');
  console.log('══════════════════════════════════════════════════════\n');

  for (const p of passes) console.log(`  ✔ ${p}`);

  if (failures.length > 0) {
    console.log('');
    for (const f of failures) console.error(`  ✘ ${f}`);
    console.error(
      `\n✘ GATE ROJO: ${failures.length} problema(s) de aislamiento. ` +
        'Ninguna migración avanza hasta que esto esté verde (y firmado por el senior §14.4).\n'
    );
    process.exit(1);
  }

  console.log(`\n✔ GATE VERDE: ${passes.length} superficies auditadas, aislamiento completo.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`✘ Error inesperado del enumerador: ${err.stack || err.message}`);
  process.exit(1);
});

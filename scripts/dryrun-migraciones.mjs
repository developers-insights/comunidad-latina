// Dry-run de migraciones contra la base REAL sin dejar rastro.
//
// Uso: node scripts/dryrun-migraciones.mjs 0133_grupos_de_chat.sql [0134_...sql ...]
//      PROBE="select ..." node scripts/dryrun-migraciones.mjs ...   (consulta al final, antes del rollback)
//
// POR QUÉ EXISTE (2026-09-03): las migraciones de este repo traen su propio
// `begin;` … `commit;`. Envolverlas en una transacción externa para "probar y
// deshacer" NO protege nada: el `commit` del archivo cierra la transacción
// externa y el `rollback` posterior no tiene qué deshacer. Así se aplicó la 0127
// en producción sin querer. Este script neutraliza esas líneas, corre todos los
// archivos en UNA transacción (para validar también las dependencias entre
// ellos, en orden) y hace rollback SIEMPRE.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const REF = "ktmbtpuhqqofdkisqseq";
const repo = process.cwd();
const files = process.argv.slice(2);
if (files.length === 0) { console.error("Pasá al menos un archivo de supabase/migrations/"); process.exit(2); }
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_PASSWORD) {
  console.error("Falta SUPABASE_DB_PASSWORD o DATABASE_URL en process.env. Ejecutá este script con envkit run.");
  process.exit(2);
}
const neutralizar = (sql) => sql.replace(/^\s*(begin|commit|start transaction)\s*;\s*$/gim, "-- (begin/commit neutralizado por dryrun)");

const caPath = process.env.SUPABASE_DB_CA_CERT_PATH;
const ssl = caPath
  ? { rejectUnauthorized: true, ca: fs.readFileSync(caPath, "utf8") }
  : process.env.DRYRUN_ALLOW_INSECURE_TLS === "1"
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true };
const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: `db.${REF}.supabase.co`,
      port: 5432,
      user: "postgres",
      password: process.env.SUPABASE_DB_PASSWORD,
      database: "postgres",
    };
const client = new pg.Client({ ...connection, ssl });
await client.connect();
let ok = true;
try {
  await client.query("begin");
  for (const f of files) {
    const sql = neutralizar(fs.readFileSync(path.join(repo, "supabase/migrations", f), "utf8"));
    if (/^\s*commit\s*;/im.test(sql)) throw new Error(`quedó un commit sin neutralizar en ${f}`);
    try { await client.query(sql); console.log("OK  ", f); }
    catch (e) { ok = false; console.log("FAIL", f, "→", e.message, e.position ? `(pos ${e.position})` : ""); break; }
  }
  if (ok && process.env.PROBE) { const r = await client.query(process.env.PROBE); console.log("probe:", JSON.stringify(r.rows)); }
} finally {
  await client.query("rollback").catch(() => {});
  console.log("rollback hecho — la base quedó como estaba");
  await client.end();
}
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
// Uso: envkit run -- node scripts/encolar-huerfanos.mjs [--dry]
import pg from "pg";

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("Falta SUPABASE_DB_PASSWORD en process.env. Ejecutá este script con envkit run.");
  process.exit(1);
}

const dry = process.argv.includes("--dry");

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.ktmbtpuhqqofdkisqseq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

// `photo` cuenta como entrada abierta: el pipeline encola las fotos con el id
// del aviso dueño, y ese item ya lo pone frente a un moderador.
const HUERFANOS = `
  from public.listings l
  where l.status = 'pending_review'
    and not exists (
      select 1 from public.moderation_queue q
       where q.tenant_id = l.tenant_id
         and q.subject_kind in ('listing', 'photo')
         and q.subject_id = l.id
         and q.status in ('pending', 'escalated')
    )
`;

await client.connect();
try {
  await client.query("begin");

  const { rows: porTenant } = await client.query(
    `select l.tenant_id, l.kind, count(*)::int as huerfanos ${HUERFANOS} group by 1, 2 order by 3 desc`,
  );
  const total = porTenant.reduce((suma, fila) => suma + fila.huerfanos, 0);
  console.table(porTenant);
  console.log(`Huérfanos en pending_review: ${total}`);

  if (dry || total === 0) {
    await client.query("rollback");
    console.log(dry ? "--dry: no se escribió nada." : "Nada que encolar.");
  } else {
    const { rowCount } = await client.query(
      `insert into public.moderation_queue (tenant_id, subject_kind, subject_id, tier, reasons)
       select l.tenant_id, 'listing', l.id, 3, '["orphan_pending_review"]'::jsonb ${HUERFANOS}`,
    );
    await client.query("commit");
    console.log(`Encolados: ${rowCount}`);
  }
} catch (error) {
  await client.query("rollback");
  console.error("Falló, no se escribió nada:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}

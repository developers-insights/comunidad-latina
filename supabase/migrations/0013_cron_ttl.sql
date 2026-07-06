-- =============================================================================
-- 0013_cron_ttl.sql — Comunidad Latina
-- Jobs pg_cron de purga (TTL §5.4): el dato que se borra rápido no es
-- subpoenable después. Los jobs corren como el rol que los agenda (postgres),
-- que en Supabase bypassa RLS — por eso las policies "false" no los frenan.
-- Idempotente: si el job ya existe se re-agenda con la misma definición.
-- =============================================================================

-- Mensajes privados: TTL 90 días (03:10 UTC diario)
do $$
begin
  perform cron.unschedule('purge-expired-messages');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'purge-expired-messages',
  '10 3 * * *',
  $$delete from public.messages where expires_at < now()$$
);

-- Notificaciones: TTL 60 días (03:20 UTC diario)
do $$
begin
  perform cron.unschedule('purge-expired-notifications');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-expired-notifications',
  '20 3 * * *',
  $$delete from public.notifications where expires_at < now()$$
);

-- Audit log: TTL 365 días (03:30 UTC diario)
do $$
begin
  perform cron.unschedule('purge-old-audit-log');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-old-audit-log',
  '30 3 * * *',
  $$delete from public.audit_log where created_at < now() - interval '365 days'$$
);

-- Conversaciones: purgar el grafo de contacto cuando ya no queda contenido
-- (03:40 UTC diario, DESPUÉS de purge-expired-messages). Sin esto, el TTL de
-- 90d de messages queda vacío de sentido: sobreviviría para siempre el
-- metadato subpoenable de quién contactó a quién, sobre qué listing y cuándo.
-- Regla: conversación de +90 días SIN mensajes vivos (pending nunca aceptadas
-- y accepted cuyos mensajes ya vencieron y fueron purgados). La actividad
-- renueva: mientras haya mensajes no purgados, la conversación se conserva.
do $$
begin
  perform cron.unschedule('purge-stale-conversations');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-stale-conversations',
  '40 3 * * *',
  $$delete from public.conversations c
     where c.created_at < now() - interval '90 days'
       and not exists (
         select 1 from public.messages m where m.conversation_id = c.id
       )$$
);

-- payment_events: el inbox de idempotencia no necesita el webhook completo de
-- Stripe (trae PII: email/nombre/dirección de facturación) más allá de la
-- ventana operativa de reintentos/debug. 90 días para procesados (03:50 UTC).
-- Los no procesados (error pendiente de resolver) se conservan.
do $$
begin
  perform cron.unschedule('purge-processed-payment-events');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-processed-payment-events',
  '50 3 * * *',
  $$delete from public.payment_events
     where processed = true
       and received_at < now() - interval '90 days'$$
);

-- broadcast_receipts: el historial de quién-vio-qué-anuncio-y-cuándo no se
-- retiene indefinidamente (§5.4). Se purgan receipts de broadcasts vencidos
-- hace +30 días (04:00 UTC); los de broadcasts vigentes se conservan para no
-- re-mostrar el anuncio.
do $$
begin
  perform cron.unschedule('purge-old-broadcast-receipts');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-old-broadcast-receipts',
  '0 4 * * *',
  $$delete from public.broadcast_receipts br
     using public.broadcasts b
     where b.id = br.broadcast_id
       and b.ends_at is not null
       and b.ends_at < now() - interval '30 days'$$
);

-- moderation_queue: TTL prometido por la policy de DELETE de 0009 ("TTL/
-- archivado = service"). Entradas RESUELTAS se purgan a los 365 días
-- (alineado con audit_log); pending/escalated se conservan (04:10 UTC).
do $$
begin
  perform cron.unschedule('purge-resolved-moderation-queue');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-resolved-moderation-queue',
  '10 4 * * *',
  $$delete from public.moderation_queue
     where status in ('approved', 'rejected')
       and resolved_at is not null
       and resolved_at < now() - interval '365 days'$$
);

-- scam_reports: los reportes RESUELTOS (upheld/dismissed) son un dossier
-- quién-denunció-a-quién con texto libre ('details') que puede contener PII
-- de población vulnerable, legible por el staff del tenant. No se retienen
-- indefinidamente (§5.4): purga a los 365 días de creados, alineado con
-- moderation_queue y audit_log (04:20 UTC). open/reviewing se conservan.
do $$
begin
  perform cron.unschedule('purge-resolved-scam-reports');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-resolved-scam-reports',
  '20 4 * * *',
  $$delete from public.scam_reports
     where status in ('upheld', 'dismissed')
       and created_at < now() - interval '365 days'$$
);

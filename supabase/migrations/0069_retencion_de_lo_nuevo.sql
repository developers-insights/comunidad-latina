-- =============================================================================
-- 0069_retencion_de_lo_nuevo.sql — Comunidad Latina
--
-- §5.4: dato viejo = riesgo, no activo. Toda tabla nueva de esta tanda que
-- acumule filas necesita su purga, igual que las 19 que ya corren en pg_cron
-- desde 0013. Acá se agregan las dos que faltaban.
--
-- -----------------------------------------------------------------------------
-- ⚠️ TRAMPA: la purga de códigos NO puede ser agresiva
-- -----------------------------------------------------------------------------
-- El instinto es borrar los códigos apenas vencen (viven 10 minutos). Sería un
-- error, y silencioso: `app.phone_verification_can_send()` implementa el rate
-- limit CONTANDO las filas de las últimas 1 hora y 24 horas. Si la purga se
-- lleva las filas vencidas, el contador se queda sin historia y el límite
-- diario deja de existir — alguien pediría códigos sin tope y nadie se
-- enteraría hasta ver la factura del proveedor de SMS.
--
-- Por eso la purga corre a las 48 HORAS: el doble de la ventana más larga del
-- rate limit (24 h), con margen. Una fila vencida sólo guarda un hash inútil y
-- un teléfono; a las 48 h ya no sirve para nada y sí es dato personal.
--
-- Si alguien alguna vez alarga la ventana del rate limit, tiene que alargar
-- este intervalo en el mismo commit.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Códigos de verificación vencidos (48 h — ver la advertencia de arriba)
-- ---------------------------------------------------------------------------
select cron.schedule(
  'purge-expired-phone-codes',
  '15 3 * * *',
  $cron$
    delete from public.phone_verification_codes
     where created_at < now() - interval '48 hours'
  $cron$
);

-- ---------------------------------------------------------------------------
-- 2. Alertas de integridad ya resueltas (365 días)
-- ---------------------------------------------------------------------------
-- Mismo horizonte que moderation_queue y audit_log: una decisión de moderación
-- de hace más de un año no se vuelve a mirar, y sigue siendo un registro que
-- ata a una persona con una acusación. Las abiertas y las que están en
-- investigación NO vencen — todavía son trabajo pendiente.
--
-- Los `content_assets` NO se purgan y no es un olvido: son el libro de
-- procedencia del contenido. La fecha de primera carga es justamente lo que
-- sirve para defender a alguien de una reclamación futura, y borrarla a los N
-- días destruiría la única evidencia a favor del que subió primero. Se van
-- solos cuando se borra la cuenta que los subió (on delete cascade).
select cron.schedule(
  'purge-resolved-content-alerts',
  '25 4 * * *',
  $cron$
    delete from public.content_integrity_alerts
     where status in ('aprobado', 'bloqueado', 'descartada')
       and resolved_at is not null
       and resolved_at < now() - interval '365 days'
  $cron$
);

commit;

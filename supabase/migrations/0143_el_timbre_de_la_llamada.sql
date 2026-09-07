-- =============================================================================
-- 0143_el_timbre_de_la_llamada.sql — Comunidad Latina
--
-- Publica `calls` y `call_participants` en Realtime para que el teléfono suene
-- cuando suena, y no cuando el otro ya cortó.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Las dos tablas entran a la publicación
--
-- Es el PRIMER uso de Realtime en este proyecto: hasta hoy todas las pantallas
-- vivas se refrescaban con `router.refresh()` cada 15 segundos. Para una bandeja
-- eso alcanza; para un timbre no. Una llamada dura menos que el intervalo del
-- sondeo, así que con el mecanismo viejo el aviso llegaba cuando ya no servía.
--
-- El modo de falla que hace necesaria esta migración es traicionero y conviene
-- dejarlo escrito: sin la tabla en la publicación, `subscribe()` del cliente
-- CONECTA igual y devuelve `SUBSCRIBED` — simplemente no llega ningún evento
-- nunca. Es indistinguible de "no pasó nada", y por eso el cliente trae un
-- sondeo de respaldo que arranca si en cuatro segundos no hubo confirmación.
-- Cuando esta migración esté aplicada, ese respaldo se apaga solo.
--
-- No hace falta tocar RLS: `postgres_changes` evalúa las policies de la 0139
-- tal como están, así que cada quien recibe únicamente los eventos de las
-- llamadas de las que ya es participante.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'call_participants'
  ) then
    alter publication supabase_realtime add table public.call_participants;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2 · Identidad de réplica completa
--
-- `call_participants` tiene clave primaria compuesta `(call_id, profile_id)`.
-- Con la identidad por defecto, el `old` de un UPDATE o un DELETE llega
-- recortado a esa clave: el cliente ve que la fila cambió pero no puede saber
-- desde qué estado, y colgar deja de distinguirse de salirse.
--
-- El costo normalmente sería la razón para no hacerlo, y acá no aplica: las dos
-- tablas se purgan a los 90 días y son de las más chicas del esquema.
-- ---------------------------------------------------------------------------
alter table public.calls             replica identity full;
alter table public.call_participants replica identity full;

commit;

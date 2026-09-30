-- =============================================================================
-- 0176_avisos_en_vivo.sql — Comunidad Latina
--
-- Publica `notifications` en Realtime para que la campana se entere del aviso
-- cuando llega, y no en la próxima navegación.
--
-- Queja del dueño (2026-09-30): le mandó una solicitud a Nacho y "no le llegó
-- de una". Además de que la solicitud directa no emitía aviso (se arregla en la
-- app), el globito lo pintaba sólo el servidor al navegar: sin esta tabla en la
-- publicación, `subscribe()` del cliente conecta y devuelve SUBSCRIBED igual,
-- pero no llega ningún evento — un silencio indistinguible de "no pasó nada"
-- (mismo modo de falla que documenta la 0143).
--
-- RLS no se toca: `postgres_changes` evalúa `notifications_select` (0011) con
-- el JWT de la sesión, así que cada quien recibe sólo sus propias filas, de su
-- comunidad. La identidad de réplica queda por defecto: el cliente usa el
-- evento como señal para volver a contar, no lee el `old`.
-- =============================================================================

begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Realtime evalúa la policy como `authenticated`: sin el GRANT de tabla la
-- policy ni se evalúa y el canal queda mudo sin error. Ya pasó en este repo.
grant select on public.notifications to authenticated, service_role;
grant insert, update on public.notifications to service_role;

commit;

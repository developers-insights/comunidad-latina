begin;

-- =============================================================================
-- 0169 — La pantalla de la colaboración se actualiza sola.
--
-- Cada cambio de estado (firma de la otra parte, pago confirmado por el
-- webhook, entrega, aprobación automática, transferencia) deja una fila en
-- gig_contract_events. Publicando esa tabla, la pantalla escucha los INSERT de
-- su contrato y se refresca: nada de polling. Realtime respeta la RLS de
-- gig_contract_events (sólo las partes y el staff de la comunidad).
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'gig_contract_events'
  ) then
    alter publication supabase_realtime add table public.gig_contract_events;
  end if;
end;
$$;

commit;

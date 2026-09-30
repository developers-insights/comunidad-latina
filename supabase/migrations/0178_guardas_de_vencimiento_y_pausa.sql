-- =============================================================================
-- 0178_guardas_de_vencimiento_y_pausa.sql — Comunidad Latina
--
-- La 0124 re-creó `app.protect_listing_counters()` partiendo de la 0050 y no de
-- la 0118: sumó `like_count` y se llevó puestas dos guardas vigentes.
--   · 0098: `renewal_count`, `expires_at`, `expiry_warn_at`, `expiry_warned_at`,
--     `expired_at`, `renewed_at` (con la puerta de `public.renovar_publicacion`
--     vía la bandera transaccional `app.renovando_publicacion`).
--   · 0118: `attrs.paused_reason` / `attrs.paused_at`.
-- Desde entonces el dueño, con su JWT, podía resetear `renewal_count` (saltear
-- el tope de renovaciones), forjar su vencimiento y escribir o borrar la marca
-- de la auto-pausa por denuncias.
--
-- Ésta es la lista ÚNICA otra vez, completa: todo lo de la 0124 + 0098 + 0118.
--
-- La guarda de pausa NO vuelve palabra por palabra: después de la 0124 la app
-- sumó la pausa del dueño (`publicaciones/editar-actions.ts`, `'owner'`), que
-- escribe esas claves con el JWT del dueño. La 0118 textual la rompería. Se
-- permite exactamente ese camino y nada más:
--   · pausar: `published → paused` con `paused_reason = 'owner'`. `paused_at`
--     lo pisa el trigger con `now()`: la fecha no la decide el cliente.
--   · reactivar/limpiar: sacar las dos claves, sólo si la marca previa NO era
--     `'reports'`. Borrar `'reports'` es justamente el ataque.
-- Cualquier otra escritura de esas dos claves (poner `'reports'`, tocar
-- `paused_at` suelto, cambiar el motivo) se rechaza.
--
-- service_role y los updates internos (pg_trigger_depth > 1) siguen exentos:
-- por ahí escriben moderación, `republicarAvisoEditado`, el cron de
-- vencimiento y la auto-pausa de la 0118.
-- =============================================================================

begin;

create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renovando boolean :=
    coalesce(current_setting('app.renovando_publicacion', true), 'off') = 'on';
  v_motivo_viejo text := old.attrs ->> 'paused_reason';
  v_motivo_nuevo text := new.attrs ->> 'paused_reason';
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.like_count is distinct from old.like_count then
    raise exception 'PROTECTED_COLUMNS: like_count solo se actualiza por triggers';
  end if;
  if new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: comment_count solo se actualiza por triggers';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'PROTECTED_COLUMNS: view_count solo se actualiza por triggers';
  end if;
  if new.store_verified is distinct from old.store_verified then
    raise exception 'PROTECTED_COLUMNS: store_verified solo se actualiza por triggers';
  end if;
  if new.store_active is distinct from old.store_active then
    raise exception 'PROTECTED_COLUMNS: store_active refleja la membresía de la tienda y solo se actualiza por triggers';
  end if;
  if new.tier is distinct from old.tier then
    raise exception 'PROTECTED_COLUMNS: tier lo escribe el flujo de pago (service_role), no el dueño del aviso';
  end if;

  if not v_renovando then
    if new.renewal_count is distinct from old.renewal_count then
      raise exception 'PROTECTED_COLUMNS: renewal_count solo lo escribe public.renovar_publicacion() — resetearlo saltearía el tope de renovaciones de la comunidad';
    end if;
    if new.expires_at is distinct from old.expires_at
       or new.expiry_warn_at is distinct from old.expiry_warn_at
       or new.expiry_warned_at is distinct from old.expiry_warned_at
       or new.expired_at is distinct from old.expired_at
       or new.renewed_at is distinct from old.renewed_at then
      raise exception 'PROTECTED_COLUMNS: las fechas de vencimiento las escriben el trigger de publicación, el cron y public.renovar_publicacion(); nunca el dueño del aviso';
    end if;
  end if;

  if v_motivo_nuevo is distinct from v_motivo_viejo
     or new.attrs ->> 'paused_at' is distinct from old.attrs ->> 'paused_at' then
    if v_motivo_nuevo = 'owner'
       and old.status = 'published'
       and new.status = 'paused'
       and v_motivo_viejo is distinct from 'reports' then
      new.attrs := jsonb_set(new.attrs, '{paused_at}', to_jsonb(now()));
    elsif v_motivo_nuevo is null
          and not coalesce(new.attrs ? 'paused_at', false)
          and v_motivo_viejo is distinct from 'reports' then
      null;
    else
      raise exception 'PROTECTED_COLUMNS: attrs.paused_reason y attrs.paused_at los escribe la auto-pausa por denuncias (0118); el dueño sólo puede pausar (''owner'') o quitar su propia pausa';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.protect_listing_counters() is
  'BEFORE UPDATE en listings: la lista ÚNICA de lo que un JWT de usuario no puede escribir — like_count (0124), comment_count/view_count (0004/0038), store_verified/store_active/tier (0048), fechas de vencimiento y renewal_count (0098, con la puerta de renovar_publicacion vía bandera transaccional) y attrs.paused_reason/paused_at (0118). Desde 0178 el dueño puede pausar (published→paused con motivo ''owner''; paused_at lo fija el trigger con now()) y quitar su propia pausa, nunca escribir ni borrar ''reports''. La 0124 había perdido las guardas de 0098 y 0118; la 0178 las repone. Exime a pg_trigger_depth > 1 y a service_role.';

revoke execute on function app.protect_listing_counters() from public, anon;

commit;

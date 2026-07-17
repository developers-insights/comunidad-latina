-- =============================================================================
-- 0022_harden_blindaje.sql — Comunidad Latina
-- Endurecimiento post-review de 0020/0021 (hallazgos del pase adversarial):
--   1. El bloqueo global era evadible por la vía de "conversaciones directas":
--      conversations_insert (0006) permite INSERT sin pasar por request_contact,
--      y messages_insert deja escribir al creador mientras está pending. Un
--      bloqueado podía abrir un hilo directo y seguir escribiendo. Trigger
--      app.enforce_pair_not_blocked() BEFORE INSERT en conversations: ninguna
--      vía (RPC, PostgREST directo, lo que sea) crea hilos entre un par
--      bloqueado. Mismo mensaje USER_BLOCKED en ambas direcciones (0020).
--   2. app.enforce_account_active() solo cubría INSERTs en 6 tablas. Una cuenta
--      suspendida/baneada podía seguir dando likes (reactions se inserta con el
--      cliente del browser) y "publicando por edición" (UPDATE de posts/comments
--      ya publicados; listings al menos vuelve a draft, posts/comments no).
--      Se suma: BEFORE INSERT en reactions y BEFORE UPDATE en posts, comments
--      y listings. El actor sancionado es auth.uid(): staff y service_role
--      siguen pasando (moderación y seeds no cambian).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bloqueo global también en la vía directa de conversations
-- ---------------------------------------------------------------------------
create or replace function app.enforce_pair_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null
     and new.counterpart_id is not null
     and app.pair_blocked(new.created_by, new.counterpart_id) then
    -- Mismo copy que request_contact (0020): no se filtra quién bloqueó a quién.
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  return new;
end;
$$;

comment on function app.enforce_pair_not_blocked() is
  'BEFORE INSERT en conversations: cierra la vía "directa" (sin RPC) que dejaba a un par bloqueado abrir hilos nuevos. Corre para TODO rol (un seed tampoco debería crear hilos entre bloqueados).';

create trigger conversations_enforce_pair_not_blocked
before insert on public.conversations
for each row execute function app.enforce_pair_not_blocked();

-- ---------------------------------------------------------------------------
-- 2. Sanciones: cubrir likes y ediciones
-- ---------------------------------------------------------------------------
create trigger reactions_enforce_account_active
before insert on public.reactions
for each row execute function app.enforce_account_active();

create trigger posts_update_enforce_account_active
before update on public.posts
for each row execute function app.enforce_account_active();

create trigger comments_update_enforce_account_active
before update on public.comments
for each row execute function app.enforce_account_active();

create trigger listings_update_enforce_account_active
before update on public.listings
for each row execute function app.enforce_account_active();

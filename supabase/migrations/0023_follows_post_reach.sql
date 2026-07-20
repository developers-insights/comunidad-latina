-- =============================================================================
-- 0023_follows_post_reach.sql — Comunidad Latina
-- Feedback del cliente (2026-07-19): el News Feed es de la GENTE.
--   * follows — seguir negocios/eventos/profesionales/tiendas (listings) y
--     creadores (profiles). Lo orgánico de una entidad llega SOLO a sus
--     seguidores; lo pagado (post_promotions) llega a todos. FTC honesto:
--     lo promocionado se marca "Publicidad" (mismo principio que boosts 0016).
--   * posts.entity_listing_id — publicar COMO tu negocio/evento/etc.
--   * Foto obligatoria en posts nuevos (kind='post'): feed visual, no periódico.
--   * post_promotions — campaña paga de un post (patrón boosts: el estado lo
--     escribe solo el server; sin Stripe configurado corre en modo demo).
-- El bucket post-media va en 0025 (storage.objects puede requerir dashboard).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- follows — grafo social polimórfico (listing | profile)
-- ---------------------------------------------------------------------------
create table public.follows (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  target_kind  text not null check (target_kind in ('listing', 'profile')),
  target_id    uuid not null,
  created_at   timestamptz not null default now(),
  constraint follows_one_per_target unique (follower_id, target_kind, target_id),
  constraint follows_no_self check (target_kind <> 'profile' or target_id <> follower_id)
);

comment on table public.follows is
  'Seguidores de entidades (listing: negocio/evento/profesional/propiedad/producto-tienda/aviso de creadores) y de creadores (profile). Sin FK física al sujeto (patrón reactions 0007): integridad por policy de INSERT + cleanup al borrar el sujeto. Regla de alcance (feedback cliente 2026-07-19): post orgánico de entidad → solo seguidores; post promocionado → todos.';
comment on column public.follows.target_kind is
  'listing = cualquier vertical de listings; profile = perfil de creador. El feed filtra posts de entidad por follows del lector (capa app, no es frontera de seguridad: el contenido published sigue siendo público en la página de la entidad).';

create index follows_follower_idx on public.follows (tenant_id, follower_id, target_kind);
create index follows_target_idx on public.follows (tenant_id, target_kind, target_id);

alter table public.follows enable row level security;
alter table public.follows force row level security;

-- Lectura tenant-wide (patrón reactions): counts de seguidores y "¿lo sigo?"
-- son sociales y visibles. Nada sensible: quién sigue a quién es público en app.
create policy follows_select on public.follows
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  or (select app.is_global_admin())
);

-- Seguirse es en primera persona; el sujeto debe existir en MI tenant.
-- profile: no seguir bloqueados (pair_blocked es SECURITY DEFINER: ve ambas
-- direcciones aunque "quién te bloqueó" no sea consultable).
-- listing: debe estar published; tampoco seguir entidades de un bloqueado.
create policy follows_insert on public.follows
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and follower_id = (select auth.uid())
  and (
    (target_kind = 'profile' and exists (
      select 1 from public.profiles p
      where p.id = follows.target_id
        and p.tenant_id = follows.tenant_id
    ) and not app.pair_blocked((select auth.uid()), follows.target_id))
    or (target_kind = 'listing' and exists (
      select 1 from public.listings l
      where l.id = follows.target_id
        and l.tenant_id = follows.tenant_id
        and l.status = 'published'
        and (l.created_by is null or not app.pair_blocked((select auth.uid()), l.created_by))
    ))
  )
);

-- Un follow no se edita: se quita y se pone (patrón reactions).
create policy follows_update on public.follows
for update to authenticated
using (false)
with check (false);

create policy follows_delete on public.follows
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and follower_id = (select auth.uid())
);

-- Cuentas suspendidas no arman grafo social (paridad 0021/0022: tampoco likean).
create trigger follows_enforce_account_active
before insert on public.follows
for each row execute function app.enforce_account_active();

-- Al borrar el sujeto, borrar follows huérfanos (no hay FK polimórfica).
create or replace function app.cleanup_follows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where f.target_kind = tg_argv[0]
     and f.target_id = old.id;
  return old;
end;
$$;

comment on function app.cleanup_follows() is
  'AFTER DELETE en listings/profiles: elimina follows huérfanos del sujeto borrado (espejo de app.cleanup_reactions).';

create trigger listings_cleanup_follows
after delete on public.listings
for each row execute function app.cleanup_follows('listing');

create trigger profiles_cleanup_follows
after delete on public.profiles
for each row execute function app.cleanup_follows('profile');

-- ---------------------------------------------------------------------------
-- posts.entity_listing_id — publicar como entidad (negocio/evento/etc.)
-- ---------------------------------------------------------------------------
alter table public.posts
  add column entity_listing_id uuid references public.listings(id) on delete cascade;

comment on column public.posts.entity_listing_id is
  'NULL = post personal (llega a toda la comunidad). Con valor = post publicado COMO esa entidad (dueño verificado por policy): orgánico llega solo a seguidores de la entidad; con post_promotions active llega a todos con chip "Publicidad" (feedback cliente 2026-07-19).';

create index posts_entity_idx
  on public.posts (tenant_id, entity_listing_id, created_at desc)
  where entity_listing_id is not null;

-- Reescritura de INSERT: condiciones originales de 0007 + ownership de la
-- entidad (solo publicás como un listing TUYO y published).
drop policy posts_insert on public.posts;
create policy posts_insert on public.posts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status in ('published', 'pending_review')
  and like_count = 0
  and comment_count = 0
  and (
    entity_listing_id is null
    or exists (
      select 1 from public.listings l
      where l.id = posts.entity_listing_id
        and l.tenant_id = posts.tenant_id
        and l.created_by = (select auth.uid())
        and l.status = 'published'
    )
  )
);

-- Reescritura de UPDATE (0007): el autor no puede "mudar" el post a una
-- entidad ajena por edición. Staff modera igual que antes.
drop policy posts_update on public.posts;
create policy posts_update on public.posts
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    (author_id = (select auth.uid()) and status <> 'removed')
    or (select app.is_staff())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (
      author_id = (select auth.uid())
      and status in ('published', 'pending_review')
      and (
        entity_listing_id is null
        or exists (
          select 1 from public.listings l
          where l.id = posts.entity_listing_id
            and l.tenant_id = posts.tenant_id
            and l.created_by = (select auth.uid())
        )
      )
    )
    or (select app.is_staff())
  )
);

-- ---------------------------------------------------------------------------
-- Foto obligatoria (kind='post'): "como Instagram, o se vuelve un periódico".
-- Solo INSERT (los posts viejos de texto siguen moderables/editables) y solo
-- clientes con JWT (seed/service pasan, pero el seed nuevo SIEMPRE trae foto).
-- kind='question' queda exento: preguntar a la comunidad es texto por naturaleza.
-- ---------------------------------------------------------------------------
create or replace function app.posts_require_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.kind = 'post'
     and (new.media is null or coalesce(array_length(new.media, 1), 0) = 0) then
    raise exception 'MEDIA_REQUIRED: un post necesita al menos una foto';
  end if;
  return new;
end;
$$;

comment on function app.posts_require_media() is
  'Feedback cliente 2026-07-19: feed visual tipo Instagram — todo post nuevo lleva foto. Se aplica en la capa de datos (ninguna UI lo evade). questions exentas; service_role exento (seed curado).';

create trigger posts_require_media
before insert on public.posts
for each row execute function app.posts_require_media();

-- ---------------------------------------------------------------------------
-- post_promotions — campaña paga de un post (espejo de boosts 0016)
-- ---------------------------------------------------------------------------
create table public.post_promotions (
  id                         uuid primary key default app.uuid_v7(),
  tenant_id                  uuid not null references public.tenants(id),
  post_id                    uuid not null references public.posts(id) on delete cascade,
  buyer_id                   uuid not null references public.profiles(id) on delete cascade,
  package                    text not null check (package in ('7d', '14d', '30d')),
  duration_days              int not null check (duration_days in (7, 14, 30)),
  amount_cents               int not null check (amount_cents > 0),
  currency                   text not null default 'usd',
  audience                   jsonb not null default '{"scope": "all"}'::jsonb,
  status                     text not null default 'pending_payment'
                               check (status in ('pending_payment', 'active', 'expired', 'canceled')),
  stripe_checkout_session_id text,
  starts_at                  timestamptz,
  ends_at                    timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.post_promotions is
  'Campaña paga de un post (feedback cliente 2026-07-19): lo promocionado llega al feed de TODOS (según audience) con chip "Publicidad" (FTC honesto, como "Destacado" de boosts). status lo escribe SOLO el server (webhook Stripe o activación demo cuando Stripe no está configurado — services.ts). Pagar visibilidad jamás toca Trust Score.';
comment on column public.post_promotions.audience is
  'Alcance elegido en la campaña: {"scope":"all"} o {"scope":"zones","zones":["Queens","Bronx"]}. Zonas = area_label aproximado (§5.4), nunca geo exacta.';
comment on column public.post_promotions.stripe_checkout_session_id is
  'Checkout Session asociada (cs_...). NULL en activación demo. No es PII.';

create index post_promotions_tenant_active_idx
  on public.post_promotions (tenant_id, status, ends_at desc);
create index post_promotions_post_idx on public.post_promotions (post_id, status);
create index post_promotions_buyer_idx on public.post_promotions (tenant_id, buyer_id, created_at desc);
create unique index post_promotions_checkout_session_uniq
  on public.post_promotions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create trigger post_promotions_set_updated_at
before update on public.post_promotions
for each row execute function extensions.moddatetime(updated_at);

alter table public.post_promotions enable row level security;
alter table public.post_promotions force row level security;

-- Activas = públicas (el chip "Publicidad" y el orden del feed deben ser
-- auditables). El comprador ve las suyas en cualquier estado.
create policy post_promotions_select on public.post_promotions
for select to anon, authenticated
using (
  status = 'active'
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      buyer_id = (select auth.uid())
      or (select app.current_user_role()) in ('domain_admin', 'global_admin')
    )
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role (server action gateada + webhook/demo).
create policy post_promotions_insert on public.post_promotions
for insert to authenticated
with check (false);

create policy post_promotions_update on public.post_promotions
for update to authenticated
using (false)
with check (false);

create policy post_promotions_delete on public.post_promotions
for delete to authenticated
using (false);

-- pg_cron: expirar y purgar (patrón exacto de 0016).
do $$
begin
  perform cron.unschedule('expire-finished-post-promotions');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'expire-finished-post-promotions',
  '35 4 * * *',
  $$update public.post_promotions
       set status = 'expired'
     where status = 'active'
       and ends_at is not null
       and ends_at < now()$$
);

do $$
begin
  perform cron.unschedule('purge-abandoned-post-promotions');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-abandoned-post-promotions',
  '45 4 * * *',
  $$delete from public.post_promotions
     where status = 'pending_payment'
       and created_at < now() - interval '7 days'$$
);


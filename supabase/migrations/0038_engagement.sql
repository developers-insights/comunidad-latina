-- =============================================================================
-- 0038_engagement.sql — Comunidad Latina
-- Engagement del feed y del marketplace (call con el cliente 2026-07-24):
--   * saves — "guardar" un post o un aviso (espejo polimórfico de reactions 0007),
--     pero PRIVADO: la lista de guardados es solo del dueño.
--   * post_views + posts.view_count — vistas de reel/video, UNA por persona y día.
--     El counter lo escribe un trigger (patrón app.reactions_bump_counters) y
--     app.protect_post_counters se extiende para blindarlo.
--   * listing_comments + listings.comment_count — comentar avisos (espejo de
--     comments 0007) + app.protect_listing_counters (listings no tenía blindaje
--     de contadores porque hasta hoy no tenía ninguno).
--   * post_promotions.cta_whatsapp — WhatsApp del anunciante para el CTA de la
--     campaña (opt-in explícito, dato PÚBLICO por decisión de quien lo carga).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- saves — guardados polimórficos (post | listing)
-- ---------------------------------------------------------------------------
create table public.saves (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  subject_kind text not null check (subject_kind in ('post', 'listing')),
  subject_id   uuid not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint saves_one_per_subject unique (subject_kind, subject_id, profile_id)
);

comment on table public.saves is
  'Guardados (post/listing). Sin FK física al sujeto: la integridad la dan la policy de INSERT (sujeto del mismo tenant y published) y app.cleanup_saves() al borrar el sujeto — mismo patrón que reactions (0007). DIFERENCIA con reactions: guardar es PRIVADO, no una señal social; la fila solo la ve su dueño (criterio de user_blocks 0020). No alimenta ningún counter público: guardar algo no lo hace más visible ni toca Trust Score.';
comment on column public.saves.subject_kind is
  'post | listing. Sin ''comment'': no se guardan comentarios sueltos.';

-- La pantalla "Guardados" lista lo mío, lo último primero.
create index saves_profile_idx on public.saves (profile_id, created_at desc);

alter table public.saves enable row level security;
alter table public.saves force row level security;

-- Solo filas propias, en mi tenant. Sin rama de staff ni de global_admin: la
-- lista de guardados de una persona no es consultable por nadie más.
create policy saves_select on public.saves
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Guardar en primera persona, en mi tenant, sobre un sujeto published del MISMO
-- tenant (mismos checks que reactions_insert, sin la rama de 'comment').
create policy saves_insert on public.saves
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and (
    (subject_kind = 'post' and exists (
      select 1 from public.posts p
      where p.id = saves.subject_id
        and p.tenant_id = saves.tenant_id
        and p.status = 'published'
    ))
    or (subject_kind = 'listing' and exists (
      select 1 from public.listings l
      where l.id = saves.subject_id
        and l.tenant_id = saves.tenant_id
        and l.status = 'published'
    ))
  )
);

-- Un guardado no se edita: se quita y se pone (patrón reactions).
create policy saves_update on public.saves
for update to authenticated
using (false)
with check (false);

create policy saves_delete on public.saves
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Cuentas suspendidas no acumulan engagement (paridad con reactions en 0022 y
-- follows en 0023).
create trigger saves_enforce_account_active
before insert on public.saves
for each row execute function app.enforce_account_active();

-- Al borrar el sujeto, borrar sus guardados (no hay FK física polimórfica).
create or replace function app.cleanup_saves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.saves s
   where s.subject_kind = tg_argv[0]
     and s.subject_id = old.id;
  return old;
end;
$$;

comment on function app.cleanup_saves() is
  'AFTER DELETE en posts/listings: elimina guardados huérfanos del sujeto borrado (espejo de app.cleanup_reactions).';

create trigger posts_cleanup_saves
after delete on public.posts
for each row execute function app.cleanup_saves('post');

create trigger listings_cleanup_saves
after delete on public.listings
for each row execute function app.cleanup_saves('listing');

-- ---------------------------------------------------------------------------
-- post_views + posts.view_count — cuántas personas vieron el reel
-- ---------------------------------------------------------------------------
alter table public.posts
  add column view_count int not null default 0 check (view_count >= 0);

comment on column public.posts.view_count is
  'Personas-día que vieron el post (video/reel). Mantenido por app.post_views_bump_counter(); update directo bloqueado por app.protect_post_counters(). NO es "reproducciones": post_views deduplica por (post, persona, día) para que el número signifique algo y no se pueda inflar recargando.';

create table public.post_views (
  tenant_id uuid not null references public.tenants(id),
  post_id   uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_on date not null default current_date,
  constraint post_views_one_per_day primary key (post_id, viewer_id, viewed_on)
);

comment on table public.post_views is
  'Una fila por (post, persona, DÍA): la clave primaria es la deduplicación, no un id sintético. MINIMIZACIÓN §5.4: se guarda el día, no el timestamp — "quién vio qué a qué hora" no es un dato que queramos retener. Nadie lee filas ajenas (ni staff): el dato agregado y público es posts.view_count.';
comment on column public.post_views.viewed_on is
  'Fecha (no timestamp) a propósito: granularidad mínima suficiente para deduplicar.';

-- Purga/uso por post (el listado por persona no existe: no hay pantalla de "lo
-- que viste" y no queremos habilitarla por accidente).
create index post_views_post_idx on public.post_views (tenant_id, post_id, viewed_on desc);

alter table public.post_views enable row level security;
alter table public.post_views force row level security;

-- Solo mis propias vistas (y solo para que el cliente pueda evitar reinsertar):
-- el historial de visualización de otra persona no lo lee nadie.
create policy post_views_select on public.post_views
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and viewer_id = (select auth.uid())
);

-- Registrar en primera persona, en mi tenant, sobre un post published del MISMO
-- tenant (mismos checks que reactions_insert rama 'post').
-- `viewed_on = current_date` NO es cosmético: la deduplicación es por día, así
-- que sin este check bastaría con mandar fechas distintas (2020-01-01,
-- 2020-01-02, …) para meter mil filas legales y sumar mil vistas.
create policy post_views_insert on public.post_views
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and viewer_id = (select auth.uid())
  and viewed_on = current_date
  and exists (
    select 1 from public.posts p
    where p.id = post_views.post_id
      and p.tenant_id = post_views.tenant_id
      and p.status = 'published'
  )
);

-- Append-only: una vista no se edita ni se "des-ve". Borrar tampoco (si se
-- pudiera, alcanzaría con borrar y reinsertar para inflar view_count).
create policy post_views_update on public.post_views
for update to authenticated
using (false)
with check (false);

create policy post_views_delete on public.post_views
for delete to authenticated
using (false);

create or replace function app.post_views_bump_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
     set view_count = view_count + 1
   where id = new.post_id
     and tenant_id = new.tenant_id;
  return new;
end;
$$;

comment on function app.post_views_bump_counter() is
  'Mantiene posts.view_count en INSERT de post_views (espejo de app.reactions_bump_counters). Sin rama DELETE: post_views es append-only. SECURITY DEFINER: el update del counter no depende de las policies del lector, y al correr dentro de un trigger pasa el gate pg_trigger_depth() de app.protect_post_counters().';

create trigger post_views_bump_counter
after insert on public.post_views
for each row execute function app.post_views_bump_counter();

-- Re-creación COMPLETA de la guarda de counters de posts (base: 0007) sumando
-- view_count: si quedara fuera, cualquier cliente autenticado podría escribirlo
-- por PostgREST y el número dejaría de significar algo.
create or replace function app.protect_post_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno de counters (trigger sobre trigger)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.like_count is distinct from old.like_count
     or new.comment_count is distinct from old.comment_count
     or new.view_count is distinct from old.view_count then
    raise exception 'PROTECTED_COLUMNS: like_count/comment_count/view_count solo se actualizan por triggers';
  end if;
  return new;
end;
$$;

comment on function app.protect_post_counters() is
  'Bloquea manipulación directa de counters de posts (like_count, comment_count, view_count) por clientes autenticados.';

-- Re-creación de posts_insert (base: 0023) sumando `view_count = 0`: la guarda
-- de arriba es BEFORE UPDATE, así que sin esto un post podría NACER con 9.999
-- vistas por PostgREST. Mismo espíritu que like_count/comment_count en 0007.
drop policy posts_insert on public.posts;
create policy posts_insert on public.posts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status in ('published', 'pending_review')
  and like_count = 0
  and comment_count = 0
  and view_count = 0
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

-- ---------------------------------------------------------------------------
-- listing_comments + listings.comment_count — comentar avisos
-- ---------------------------------------------------------------------------
create table public.listing_comments (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  listing_id uuid not null references public.listings(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null,
  status     text not null default 'published' check (status in ('published', 'removed', 'pending_review')),
  created_at timestamptz not null default now()
);

comment on table public.listing_comments is
  'Comentarios de avisos (espejo de comments 0007 contra listings). El INSERT valida por policy que el aviso es del MISMO tenant y está published (anti FK cross-tenant). Comentar NO es contactar: el contacto sigue pasando por request_contact (§9.2).';
comment on column public.listing_comments.author_id is
  'NULL = autor borró su cuenta (misma estrategia que comments en 0015): el comentario sobrevive anonimizado.';

create index listing_comments_thread_idx on public.listing_comments (tenant_id, listing_id, created_at, id);
create index listing_comments_listing_fk_idx on public.listing_comments (listing_id);
create index listing_comments_author_idx on public.listing_comments (tenant_id, author_id, created_at desc);

alter table public.listing_comments enable row level security;
alter table public.listing_comments force row level security;

create policy listing_comments_select on public.listing_comments
for select to anon, authenticated
using (
  status = 'published'
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      author_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy listing_comments_insert on public.listing_comments
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and exists (
    select 1 from public.listings l
    where l.id = listing_comments.listing_id
      and l.tenant_id = listing_comments.tenant_id
      and l.status = 'published'
  )
);

create policy listing_comments_update on public.listing_comments
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
    (author_id = (select auth.uid()) and status = 'published')
    or (select app.is_staff())
  )
);

create policy listing_comments_delete on public.listing_comments
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    author_id = (select auth.uid())
    or (select app.is_staff())
  )
);

-- Paridad con comments (0021 insert / 0022 update): una cuenta suspendida no
-- comenta ni "publica por edición".
create trigger listing_comments_enforce_account_active
before insert on public.listing_comments
for each row execute function app.enforce_account_active();

create trigger listing_comments_update_enforce_account_active
before update on public.listing_comments
for each row execute function app.enforce_account_active();

alter table public.listings
  add column comment_count int not null default 0 check (comment_count >= 0);

comment on column public.listings.comment_count is
  'Mantenido por app.listing_comments_bump_count(). Update directo bloqueado por app.protect_listing_counters().';

create or replace function app.listing_comments_bump_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.listings
       set comment_count = comment_count + 1
     where id = new.listing_id
       and tenant_id = new.tenant_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.listings
       set comment_count = greatest(comment_count - 1, 0)
     where id = old.listing_id
       and tenant_id = old.tenant_id;
    return old;
  end if;
  return null;
end;
$$;

comment on function app.listing_comments_bump_count() is
  'Mantiene listings.comment_count en INSERT/DELETE de listing_comments (espejo de app.comments_bump_post_count).';

create trigger listing_comments_bump_count
after insert or delete on public.listing_comments
for each row execute function app.listing_comments_bump_count();

-- listings no tenía guarda de contadores (no tenía contadores). Mismo mecanismo
-- que app.protect_post_counters: los updates internos llegan con
-- pg_trigger_depth() > 1 (disparados por el trigger de listing_comments).
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno de counters (trigger sobre trigger)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: comment_count solo se actualiza por triggers';
  end if;
  return new;
end;
$$;

comment on function app.protect_listing_counters() is
  'Bloquea manipulación directa de listings.comment_count por clientes autenticados (espejo de app.protect_post_counters).';

create trigger listings_protect_counters
before update on public.listings
for each row execute function app.protect_listing_counters();

-- Re-creación de listings_insert (base: 0004) sumando `comment_count = 0`: la
-- guarda de arriba es BEFORE UPDATE — sin esto un aviso podría nacer con 300
-- comentarios falsos en el contador. Todo lo demás queda igual.
drop policy listings_insert on public.listings;
create policy listings_insert on public.listings
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and source = 'user'
  and status in ('draft', 'pending_review')
  and publisher_name is null
  and publisher_kind is null
  and published_at is null
  and comment_count = 0
);

-- Un comentario NO "edita" el aviso: sin esta guarda, cada comentario movería
-- listings.updated_at y el aviso aparecería como recién modificado (lastmod del
-- sitemap incluido). Mismo criterio que posts_set_updated_at en 0007, expresado
-- por exclusión para que futuras columnas sigan bumpeando sin tocar el trigger.
drop trigger listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
before update on public.listings
for each row
when (old.comment_count is not distinct from new.comment_count)
execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- post_promotions.cta_whatsapp — CTA de WhatsApp en la campaña (opt-in)
-- ---------------------------------------------------------------------------
alter table public.post_promotions
  add column cta_whatsapp text;

comment on column public.post_promotions.cta_whatsapp is
  'WhatsApp PÚBLICO del anunciante para el CTA de la campaña. Opt-in explícito de quien paga la promoción: lo carga a mano sabiendo que se muestra en el aviso. NO es el teléfono privado de profiles_private (0030) ni sale de ahí — el contacto protegido §9.2 sigue igual para todo lo demás. Las filas active ya son de lectura pública (post_promotions_select), así que el dato viaja con la campaña.';

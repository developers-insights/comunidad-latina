-- =============================================================================
-- 0007_social.sql — Comunidad Latina
-- posts + comments + reactions (con counters por trigger) + guides.
-- Contenido published = público (SEO); todo lo demás tenant + owner/rol.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table public.posts (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants(id),
  author_id     uuid not null references public.profiles(id),
  body          text not null,
  media         text[] not null default '{}'::text[],
  kind          text not null default 'post' check (kind in ('post', 'question')),
  status        text not null default 'published' check (status in ('published', 'removed', 'pending_review')),
  like_count    int not null default 0 check (like_count >= 0),
  comment_count int not null default 0 check (comment_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.posts is
  'Feed social (post | question). published = contenido público. Counters denormalizados mantenidos por triggers (no confiar en el cliente).';
comment on column public.posts.like_count is
  'Mantenido por app.reactions_bump_counters(). Update directo bloqueado por app.protect_post_counters().';

create index posts_feed_idx on public.posts (tenant_id, created_at desc, id desc) where status = 'published';
create index posts_author_idx on public.posts (tenant_id, author_id, created_at desc);

-- updated_at solo cuando cambia contenido real (un like no "edita" el post).
create trigger posts_set_updated_at
before update on public.posts
for each row
when (
  old.body is distinct from new.body
  or old.media is distinct from new.media
  or old.kind is distinct from new.kind
  or old.status is distinct from new.status
)
execute function extensions.moddatetime(updated_at);

-- Counters inmunes a manipulación: updates internos llegan con
-- pg_trigger_depth() > 1 (disparados por triggers de reactions/comments).
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
     or new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: like_count/comment_count solo se actualizan por triggers';
  end if;
  return new;
end;
$$;

comment on function app.protect_post_counters() is
  'Bloquea manipulación directa de counters de posts por clientes autenticados.';

create trigger posts_protect_counters
before update on public.posts
for each row execute function app.protect_post_counters();

alter table public.posts enable row level security;
alter table public.posts force row level security;

create policy posts_select on public.posts
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

-- Autor = yo, en mi tenant, counters en cero, nunca nace "removed".
create policy posts_insert on public.posts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status in ('published', 'pending_review')
  and like_count = 0
  and comment_count = 0
);

-- Autor edita lo suyo mientras no esté removed (un post moderado NO se
-- auto-resucita: la fila removed no matchea el USING del autor). Staff del
-- tenant modera cualquier post del tenant.
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
    (author_id = (select auth.uid()) and status in ('published', 'pending_review'))
    or (select app.is_staff())
  )
);

create policy posts_delete on public.posts
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    author_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid not null references public.profiles(id),
  body       text not null,
  status     text not null default 'published' check (status in ('published', 'removed', 'pending_review')),
  created_at timestamptz not null default now()
);

comment on table public.comments is
  'Comentarios de posts. El INSERT valida por policy que el post es del MISMO tenant y está published (anti FK cross-tenant).';

create index comments_post_thread_idx on public.comments (tenant_id, post_id, created_at, id);
create index comments_post_fk_idx on public.comments (post_id);
create index comments_author_idx on public.comments (tenant_id, author_id, created_at desc);

alter table public.comments enable row level security;
alter table public.comments force row level security;

create policy comments_select on public.comments
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

create policy comments_insert on public.comments
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id
      and p.tenant_id = comments.tenant_id
      and p.status = 'published'
  )
);

create policy comments_update on public.comments
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

create policy comments_delete on public.comments
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    author_id = (select auth.uid())
    or (select app.is_staff())
  )
);

-- ---------------------------------------------------------------------------
-- reactions
-- ---------------------------------------------------------------------------
create table public.reactions (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  subject_kind text not null check (subject_kind in ('post', 'comment', 'listing')),
  subject_id   uuid not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  kind         text not null default 'like',
  created_at   timestamptz not null default now(),
  constraint reactions_one_per_subject unique (subject_kind, subject_id, profile_id)
);

comment on table public.reactions is
  'Reacciones polimórficas (post/comment/listing). Sin FK física al sujeto: la integridad la dan la policy de INSERT (sujeto del mismo tenant y published) y app.cleanup_reactions() al borrar el sujeto.';

create index reactions_subject_idx on public.reactions (tenant_id, subject_kind, subject_id);
create index reactions_profile_idx on public.reactions (tenant_id, profile_id);

alter table public.reactions enable row level security;
alter table public.reactions force row level security;

create policy reactions_select on public.reactions
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  or (select app.is_global_admin())
);

create policy reactions_insert on public.reactions
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and (
    (subject_kind = 'post' and exists (
      select 1 from public.posts p
      where p.id = reactions.subject_id
        and p.tenant_id = reactions.tenant_id
        and p.status = 'published'
    ))
    or (subject_kind = 'comment' and exists (
      select 1 from public.comments c
      where c.id = reactions.subject_id
        and c.tenant_id = reactions.tenant_id
        and c.status = 'published'
    ))
    or (subject_kind = 'listing' and exists (
      select 1 from public.listings l
      where l.id = reactions.subject_id
        and l.tenant_id = reactions.tenant_id
        and l.status = 'published'
    ))
  )
);

-- Una reacción no se edita: se quita y se pone (insert/delete).
create policy reactions_update on public.reactions
for update to authenticated
using (false)
with check (false);

create policy reactions_delete on public.reactions
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- Triggers de counters (INSERT y DELETE, contrato) + limpieza de huérfanas
-- ---------------------------------------------------------------------------
create or replace function app.reactions_bump_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.subject_kind = 'post' and new.kind = 'like' then
      update public.posts
         set like_count = like_count + 1
       where id = new.subject_id
         and tenant_id = new.tenant_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.subject_kind = 'post' and old.kind = 'like' then
      update public.posts
         set like_count = greatest(like_count - 1, 0)
       where id = old.subject_id
         and tenant_id = old.tenant_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

comment on function app.reactions_bump_counters() is
  'Mantiene posts.like_count en INSERT/DELETE de reactions (kind=like). SECURITY DEFINER: el update de counter no depende de policies del lector.';

create trigger reactions_bump_counters
after insert or delete on public.reactions
for each row execute function app.reactions_bump_counters();

create or replace function app.comments_bump_post_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
       set comment_count = comment_count + 1
     where id = new.post_id
       and tenant_id = new.tenant_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts
       set comment_count = greatest(comment_count - 1, 0)
     where id = old.post_id
       and tenant_id = old.tenant_id;
    return old;
  end if;
  return null;
end;
$$;

comment on function app.comments_bump_post_count() is
  'Mantiene posts.comment_count en INSERT/DELETE de comments.';

create trigger comments_bump_post_count
after insert or delete on public.comments
for each row execute function app.comments_bump_post_count();

-- Al borrar el sujeto, borrar sus reacciones (no hay FK física polimórfica).
create or replace function app.cleanup_reactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reactions r
   where r.subject_kind = tg_argv[0]
     and r.subject_id = old.id;
  return old;
end;
$$;

comment on function app.cleanup_reactions() is
  'AFTER DELETE en posts/comments/listings: elimina reacciones huérfanas del sujeto borrado.';

create trigger posts_cleanup_reactions
after delete on public.posts
for each row execute function app.cleanup_reactions('post');

create trigger comments_cleanup_reactions
after delete on public.comments
for each row execute function app.cleanup_reactions('comment');

create trigger listings_cleanup_reactions
after delete on public.listings
for each row execute function app.cleanup_reactions('listing');

-- ---------------------------------------------------------------------------
-- guides — Guías "Cómo hacer X siendo latino aquí" (moat §3.④ + SEO)
-- tenant_id NULLABLE: null = guía GLOBAL visible en todas las comunidades.
-- ---------------------------------------------------------------------------
create table public.guides (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid references public.tenants(id),
  slug            text not null,
  title           text not null,
  summary         text,
  body_md         text not null,
  topics          text[] not null default '{}'::text[],
  city            text,
  sources         jsonb not null default '[]'::jsonb,
  status          text not null default 'draft'
                    check (status in ('draft', 'pending_review', 'published', 'removed')),
  reading_minutes int check (reading_minutes is null or reading_minutes > 0),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Sin fuentes oficiales citadas NO se publica (moat legal-safe §3/§11).
  constraint guides_published_need_sources check (
    status <> 'published'
    or (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) > 0)
  ),
  constraint guides_slug_per_tenant unique nulls not distinct (tenant_id, slug)
);

comment on table public.guides is
  'Base de conocimiento hiperlocal (ITIN, licencia sin SSN, derechos). tenant_id null = guía global. CHECK: no se publica sin sources (citas oficiales). Las guías informan con cita textual de fuente oficial; nunca asesoran (UPL §11).';
comment on column public.guides.tenant_id is
  'NULLABLE a propósito: null = contenido global multi-comunidad. El enumerador RLS la exige igual (la columna existe).';
comment on column public.guides.sources is
  'OBLIGATORIAS para publicar: [{"name":"IRS — ITIN","url":"https://www.irs.gov/...","checked_at":"2026-07-01"}].';

create index guides_public_idx on public.guides (status, published_at desc) where status = 'published';
create index guides_tenant_idx on public.guides (tenant_id, status, created_at desc);
create index guides_topics_idx on public.guides using gin (topics);

create trigger guides_set_updated_at
before update on public.guides
for each row execute function extensions.moddatetime(updated_at);

alter table public.guides enable row level security;
alter table public.guides force row level security;

-- Published es público (globales incluidas: tenant_id null entra por esta rama).
-- Drafts: domain_admin del tenant; drafts globales solo global_admin/service.
create policy guides_select on public.guides
for select to anon, authenticated
using (
  status = 'published'
  or (
    tenant_id is not null
    and tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Curaduría: domain_admin crea guías DE SU tenant. Las globales (tenant_id
-- null) solo via service_role (no matchean el claim).
create policy guides_insert on public.guides
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy guides_update on public.guides
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy guides_delete on public.guides
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

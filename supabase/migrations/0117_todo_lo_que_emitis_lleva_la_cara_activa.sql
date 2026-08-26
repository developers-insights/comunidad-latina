-- =============================================================================
-- 0117_todo_lo_que_emitis_lleva_la_cara_activa.sql — Comunidad Latina
--
-- «que en todos lados todo —ya sean me gusta, comentarios, todos— vaya del lado
-- de la cuenta que esté, ya sea dueño o personal.» (Manuel, 2026-08-26.)
--
-- La 0116 dejó firmadas las publicaciones y los comentarios del feed. Esta
-- termina el trabajo con las tres superficies que faltaban: los "me gusta", los
-- comentarios de avisos y las reseñas de negocios.
--
-- Las tres reciben la MISMA columna con el MISMO nombre y el MISMO predicado que
-- `posts_insert` (0023), copiado y no aproximado: la ficha tiene que ser del
-- tenant, creada por quien escribe y estar publicada. Cinco tablas escriben hoy
-- «a nombre de quién»; que las cinco lo digan igual es lo único que evita que
-- dentro de seis meses haya cinco reglas distintas y que la equivocada sea la
-- que manda.
--
-- ── LO QUE NO CAMBIA: UN SER HUMANO, UN VOTO ────────────────────────────────
-- Las restricciones de unicidad quedan EXACTAMENTE como estaban:
--
--     reactions_one_per_subject      unique (subject_kind, subject_id, profile_id)
--     listing_reviews_one_per_author unique (listing_id, author_id)
--
-- Es la decisión de diseño de esta migración y conviene decirla fuerte, porque
-- la alternativa parece más "completa" y es peor. Si la unicidad incluyera la
-- ficha, la misma persona podría poner dos me gusta en la misma publicación
-- —uno como ella, otro como su local— y dejar dos reseñas en el mismo negocio.
-- El contador diría 2 donde hay una sola persona, y cada dueño de comercio
-- tendría el doble de peso que un vecino en el feed y en las estrellas. Eso no
-- es representar mejor la identidad activa: es romper el contador.
--
-- Entonces `entity_listing_id` acá es ATRIBUCIÓN, no una segunda cuenta: dice a
-- nombre de quién salió el me gusta o la reseña, no cuántos hubo. Tocás me gusta
-- actuando como tu negocio y el aviso que le llega al autor dice el nombre de tu
-- negocio; volvés a ser vos, sacás el me gusta y ponés otro, y pasa a decir el
-- tuyo. Lo que no podés es contar dos veces.
--
-- ── POR QUÉ `listing_comments` VA APARTE Y NO CON `comments` ────────────────
-- Porque son dos tablas: `comments` cuelga de `posts` y `listing_comments` de
-- `listings` (0038, «espejo de comments 0007»). El espejo tiene que seguir
-- siéndolo — un comentario firmado por tu negocio en el feed y otro sin firmar
-- en un aviso, con la misma app y el mismo interruptor, es la clase de
-- inconsistencia que hace que la persona deje de confiar en el interruptor.
--
-- ── LO QUE ESTA MIGRACIÓN NO TOCA, Y POR QUÉ ────────────────────────────────
--   · `follows`. Seguir no es una cosa que DECÍS, es un vínculo, y su unicidad
--     es `(follower_id, target_kind, target_id)`. Atribuir el vínculo a la
--     ficha sin más lo dejaría a medio camino: aparecería el negocio en la
--     lista de seguidores de una persona, pero la pestaña "Siguiendo" de ese
--     negocio no existe, y el alcance del feed (`feedPostVisibilityFilter`) se
--     calcula sobre `follower_id`, o sea que lo que el negocio siguiera lo
--     seguirías viendo vos y no él. Es una feature —"tu negocio también sigue
--     gente", con su propia pestaña y su propio feed—, no una columna.
--   · `messages` / `conversations`. Una conversación es entre dos personas y su
--     RLS está escrita sobre eso. Escribirle a un vecino a nombre del local es
--     una bandeja aparte, con sus avisos y sus permisos de quién la lee.
--   · `post_poll_votes`. Nadie ve quién votó — sólo el conteo. Una columna de
--     atribución que ninguna pantalla puede mostrar es letra muerta.
--   · `saves`. Guardar es privado por definición (0038): no lo ve nadie más.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. "Me gusta" — feed, videos e interés en eventos
--    Una sola tabla para las tres cosas (`reactions`, 0007/0038), así que una
--    sola columna las cubre.
-- ---------------------------------------------------------------------------
alter table public.reactions
  add column if not exists entity_listing_id uuid
    references public.listings(id) on delete set null;

comment on column public.reactions.entity_listing_id is
  'Ficha a nombre de la cual se puso el me gusta, o NULL = lo puso la persona. ATRIBUCIÓN, no una segunda cuenta: la unicidad sigue siendo (subject_kind, subject_id, profile_id), o sea un ser humano un voto — ver el encabezado de la 0117. on delete set null: borrar la ficha no borra el me gusta.';

create index if not exists reactions_entity_idx
  on public.reactions (tenant_id, entity_listing_id)
  where entity_listing_id is not null;

-- La policy se REESCRIBE ENTERA y por eso las tres ramas de `subject_kind`
-- están copiadas literales de la versión anterior: un `drop policy` que se
-- olvide una rama no rompe nada visible — deja de exigir que el sujeto exista y
-- esté publicado, y eso no se nota hasta que alguien reacciona contra una fila
-- borrada. Lo único que se agrega es el último `and`.
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and (
    (
      subject_kind = 'post'
      and exists (
        select 1 from public.posts p
        where p.id = reactions.subject_id
          and p.tenant_id = reactions.tenant_id
          and p.status = 'published'
      )
    )
    or (
      subject_kind = 'comment'
      and exists (
        select 1 from public.comments c
        where c.id = reactions.subject_id
          and c.tenant_id = reactions.tenant_id
          and c.status = 'published'
      )
    )
    or (
      subject_kind = 'listing'
      and exists (
        select 1 from public.listings l
        where l.id = reactions.subject_id
          and l.tenant_id = reactions.tenant_id
          and l.status = 'published'
      )
    )
  )
  -- Lo nuevo: el predicado de firma de `posts_insert`, copiado literal.
  and (
    reactions.entity_listing_id is null
    or exists (
      select 1
      from public.listings f
      where f.id = reactions.entity_listing_id
        and f.tenant_id = reactions.tenant_id
        and f.created_by = (select auth.uid())
        and f.status = 'published'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2. Comentarios de avisos — el espejo de `comments` (0038)
-- ---------------------------------------------------------------------------
alter table public.listing_comments
  add column if not exists entity_listing_id uuid
    references public.listings(id) on delete set null;

comment on column public.listing_comments.entity_listing_id is
  'Ficha con la que se firmó el comentario, o NULL = lo dijo la persona. Espejo de comments.entity_listing_id (0116), con el mismo predicado — un comentario firmado en el feed y otro sin firmar en un aviso, con el mismo interruptor puesto, sería el interruptor mintiendo.';

create index if not exists listing_comments_entity_idx
  on public.listing_comments (tenant_id, entity_listing_id, created_at desc)
  where entity_listing_id is not null;

drop policy if exists listing_comments_insert on public.listing_comments;
create policy listing_comments_insert on public.listing_comments
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and exists (
    select 1
    from public.listings l
    where l.id = listing_comments.listing_id
      and l.tenant_id = listing_comments.tenant_id
      and l.status = 'published'
  )
  and (
    listing_comments.entity_listing_id is null
    or exists (
      select 1
      from public.listings f
      where f.id = listing_comments.entity_listing_id
        and f.tenant_id = listing_comments.tenant_id
        and f.created_by = (select auth.uid())
        and f.status = 'published'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3. Reseñas de negocios
--    Con la unicidad intacta: una reseña por persona y por negocio. Poder
--    calificar dos veces el mismo local —una como vos y otra como tu comercio—
--    sería exactamente el fraude de estrellas que las reseñas existen para
--    evitar.
-- ---------------------------------------------------------------------------
alter table public.listing_reviews
  add column if not exists entity_listing_id uuid
    references public.listings(id) on delete set null;

comment on column public.listing_reviews.entity_listing_id is
  'Ficha a nombre de la cual se dejó la reseña, o NULL = la dejó la persona. La unicidad sigue siendo (listing_id, author_id): una reseña por ser humano y por negocio, se firme como se firme (0117).';

create index if not exists listing_reviews_entity_idx
  on public.listing_reviews (tenant_id, entity_listing_id)
  where entity_listing_id is not null;

-- Igual que arriba: la policy vieja va copiada literal —incluidas las tres
-- columnas de respuesta del dueño, que el autor NO puede escribir al crear, y
-- `app.can_review_listing()`, que es la regla de quién puede reseñar qué— y
-- sólo se le suma el predicado de firma.
drop policy if exists listing_reviews_insert on public.listing_reviews;
create policy listing_reviews_insert on public.listing_reviews
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and owner_reply is null
  and owner_reply_by is null
  and owner_reply_at is null
  and app.can_review_listing(listing_id, (select auth.uid()))
  and (
    listing_reviews.entity_listing_id is null
    or exists (
      select 1
      from public.listings f
      where f.id = listing_reviews.entity_listing_id
        and f.tenant_id = listing_reviews.tenant_id
        and f.created_by = (select auth.uid())
        and f.status = 'published'
    )
  )
);

commit;

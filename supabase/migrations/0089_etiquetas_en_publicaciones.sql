-- =============================================================================
-- 0089_etiquetas_en_publicaciones.sql — Comunidad Latina
--
-- ETIQUETAR PERSONAS EN UNA PUBLICACIÓN. Hasta hoy, quien quería nombrar a
-- alguien en una foto lo escribía en el cuerpo del post. Eso tiene dos defectos
-- que no son de comodidad: la persona nombrada NO se entera (no hay aviso), y
-- —peor— NO puede sacarse el nombre de encima, porque el texto es del autor.
-- Una etiqueta arregla las dos: notifica y se puede quitar unilateralmente.
--
-- LA DECISIÓN QUE GOBIERNA TODO EL ARCHIVO: una etiqueta es un dato sobre DOS
-- personas (quien publica y quien queda asociada), así que ninguna de las dos
-- manda sola. El autor decide a quién agrega; la persona etiquetada decide si
-- se la puede etiquetar (`profiles_private.tag_policy`) y puede irse cuando
-- quiera (`post_tags_delete` incluye su propia fila). Ese reparto explica cada
-- policy de abajo.
--
-- CÓMO SE PARECE AL RESTO DEL ESQUEMA (a propósito, no por costumbre):
--   * `tenant_id` DENORMALIZADO en la tabla, igual que reactions/saves/follows.
--     Nunca se confía en el join: la fila trae su tenant y TODA policy exige que
--     coincida con el del post (`p.tenant_id = post_tags.tenant_id`). Una fila
--     con el tenant forjado no matchea ninguna policy y se vuelve invisible.
--   * `update` en `false` (patrón reactions 0007 / follows 0023): una etiqueta
--     no se edita, se pone y se saca.
--   * EXACTAMENTE 4 policies con el nombre canónico — es lo que exige el
--     enumerador (`scripts/rls-enumerator.mjs`), y con razón.
--
-- Dependencias: 0003 (profiles, profiles_private), 0007 (posts), 0020
-- (app.pair_blocked), 0023 (follows), 0052 (app.unaccent_immutable).
--
-- ⚠️ NO APLICADA. La decisión de correrla es de Manuel.
-- =============================================================================


-- =============================================================================
-- 1 · La preferencia de privacidad: ¿quién puede etiquetarme?
-- =============================================================================

-- Vive en `profiles_private` y no en `profiles` porque `profiles_select` es
-- `using (true)`: en la tabla pública, la preferencia sería consultable por
-- cualquiera y se convertiría en un dato de targeting ("a quién puedo nombrar
-- sin que se defienda"). Acá sólo la lee su dueño… y `app.tagging_allowed()`,
-- que es `security definer` y devuelve un booleano — nunca la preferencia.
--
-- DEFAULT 'everyone', Y ES LA OPCIÓN SEGURA. Un default 'nobody' suena más
-- prudente y es peor: dejaría la función muerta para el 100% de las cuentas
-- existentes y empujaría a la gente de vuelta a escribir el nombre en el
-- cuerpo del post — texto que la persona nombrada NO puede borrar, no recibe
-- aviso, y no respeta bloqueos. El riesgo real (quedar asociada a algo que no
-- querés) ya está cubierto por cuatro candados que sí son duros: sólo dentro de
-- tu comunidad, nunca desde alguien con quien hay bloqueo, aviso inmediato, y
-- retiro unilateral. La preferencia existe para quien quiera MÁS que eso.
alter table public.profiles_private
  add column tag_policy text not null default 'everyone'
    check (tag_policy in ('everyone', 'following', 'nobody'));

comment on column public.profiles_private.tag_policy is
  'Quién puede etiquetar a esta persona en una publicación (0089): everyone (default) | following (sólo gente que ELLA sigue) | nobody. Vive en profiles_private —y no en profiles, que es using(true)— para que la preferencia no sea consultable por terceros; se lee SOLO vía app.tagging_allowed(), que devuelve un booleano y nunca el valor. Sin fila en profiles_private el resultado es el mismo que ''everyone'' (ver la función).';


-- ¿`p_actor` puede etiquetar a `p_target`? El único lector de `tag_policy`.
--
-- `security definer` es obligatorio: `profiles_private` es solo-dueño, así que
-- el JWT del autor jamás vería la fila de la otra persona. La función devuelve
-- un booleano y nada más — no filtra la preferencia, ni siquiera indirectamente
-- por mensaje de error.
--
-- Sin fila en `profiles_private` ⇒ `true`. La fila la crea el onboarding
-- "Recién Llegado" y muchas cuentas no la tienen; leer "ausencia" como 'nobody'
-- apagaría la función para ellas sin que nadie lo haya pedido.
create or replace function app.tagging_allowed(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_actor is null or p_target is null then false
    -- Etiquetarse a uno mismo siempre se puede: es tu propia publicación y tu
    -- propio nombre. (No genera notificación; eso lo resuelve la app.)
    when p_actor = p_target then true
    else coalesce(
      (
        select case pp.tag_policy
                 when 'everyone' then true
                 when 'nobody'   then false
                 -- 'following': la persona etiquetada tiene que seguir a quien
                 -- la etiqueta. La dirección importa — es "gente que YO elegí
                 -- seguir", no "gente que me sigue" (eso lo elige cualquiera).
                 when 'following' then exists (
                   select 1
                     from public.follows f
                    where f.follower_id = p_target
                      and f.target_kind = 'profile'
                      and f.target_id   = p_actor
                 )
               end
          from public.profiles_private pp
         where pp.profile_id = p_target
      ),
      true
    )
  end;
$$;

comment on function app.tagging_allowed(uuid, uuid) is
  'Puerta de privacidad de las etiquetas (0089): ¿p_actor puede etiquetar a p_target? Lee profiles_private.tag_policy, que es solo-dueño — por eso es SECURITY DEFINER, y por eso devuelve un booleano y NUNCA el valor de la preferencia. Sin fila en profiles_private se comporta como ''everyone'' (el default de la columna). No chequea tenant ni bloqueos: eso lo hace la policy post_tags_insert, que es quien la llama.';

revoke all on function app.tagging_allowed(uuid, uuid) from public;
grant execute on function app.tagging_allowed(uuid, uuid) to authenticated;


-- =============================================================================
-- 2 · post_tags
-- =============================================================================

create table public.post_tags (
  post_id    uuid not null references public.posts(id)    on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  -- Quién etiquetó. Anulable con `on delete set null` a propósito: si esa
  -- cuenta se borra (0015), la etiqueta NO tiene por qué desaparecer del post
  -- —el post sigue existiendo y su autor sigue siendo `posts.author_id`—, sólo
  -- se pierde el dato de auditoría. Borrar la etiqueta en cascada sería
  -- reescribir publicaciones ajenas por un evento que no las toca.
  tagged_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- PK COMPUESTA en vez de id + unique: la identidad de la fila ES el par. Da
  -- gratis el "no se etiqueta dos veces a la misma persona" y el índice de la
  -- lectura más caliente (todas las etiquetas de un post).
  constraint post_tags_pkey primary key (post_id, profile_id)
);

comment on table public.post_tags is
  'Personas etiquetadas en una publicación (0089). tenant_id DENORMALIZADO (patrón reactions/saves/follows): toda policy exige que coincida con el tenant del post, así que una fila con el tenant forjado no la ve nadie. Tope duro de 20 por publicación en app.post_tags_enforce_cap() — el cliente no es la frontera. La etiqueta la pone el AUTOR del post y la puede sacar tanto el autor como la persona etiquetada: sacarse una etiqueta de encima es un derecho, no una cortesía.';
comment on column public.post_tags.tagged_by is
  'Quién puso la etiqueta. Hoy es siempre el autor del post (lo exige post_tags_insert), pero queda explícito para que abrir el etiquetado a terceros más adelante no obligue a adivinar el origen de las filas viejas. NULL = la cuenta que etiquetó se borró.';
comment on column public.post_tags.tenant_id is
  'Comunidad de la etiqueta. Redundante con posts.tenant_id A PROPÓSITO: las policies comparan las dos y una divergencia vuelve la fila invisible en vez de confiar en el join (regla multi-tenant del proyecto).';

-- La PK ya cubre "todas las etiquetas de estos posts" (el feed pide en batch
-- con `in (...)`, prefijo `post_id`). Faltan los dos accesos por persona:
--   * "¿dónde me etiquetaron?", siempre acotado por comunidad;
--   * el barrido del `on delete cascade` de profiles, que necesita el prefijo
--     `profile_id` puro (el índice de arriba arranca por tenant y no le sirve).
create index post_tags_profile_idx on public.post_tags (tenant_id, profile_id, created_at desc);
create index post_tags_profile_fk_idx on public.post_tags (profile_id);
-- FK sin cascada: sin índice, borrar una cuenta escanea la tabla entera.
create index post_tags_tagged_by_fk_idx on public.post_tags (tagged_by);


-- ---------------------------------------------------------------------------
-- Tope de 20 etiquetas por publicación — en la BASE, no en el cliente
-- ---------------------------------------------------------------------------
-- 20 alcanza para una foto grupal y le pone piso a "etiquetar a media
-- comunidad para que le llegue un aviso a todos", que es spam con otro nombre.
--
-- Por qué un trigger y no un CHECK: un CHECK ve UNA fila; el tope es sobre el
-- conjunto de filas del post.
--
-- Por qué el lock de aviso: `count(*)` en dos transacciones concurrentes puede
-- leer 19 las dos veces y dejar 21. El advisory lock por post_id serializa
-- únicamente los inserts de ESE post (no toca la fila de `posts`, que ya tiene
-- sus propios triggers de contadores) y se libera solo al terminar la
-- transacción. Es la diferencia entre un tope y una sugerencia.
create or replace function app.post_tags_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.post_id::text, 60)
  );

  select count(*) into v_count
    from public.post_tags t
   where t.post_id = new.post_id;

  if v_count >= 20 then
    raise exception 'POST_TAGS_LIMIT: una publicación admite hasta 20 personas etiquetadas'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.post_tags_enforce_cap() is
  'Tope duro de 20 etiquetas por publicación (0089). Trigger y no CHECK porque la regla es sobre el CONJUNTO de filas del post. Serializa con pg_advisory_xact_lock(post_id) para que dos inserts simultáneos no lean ambos 19 y dejen 21. Levanta 23514 (check_violation) para que PostgREST lo devuelva como 400 y la action lo distinga de un error real.';

create trigger post_tags_cap
before insert on public.post_tags
for each row execute function app.post_tags_enforce_cap();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.post_tags enable row level security;
alter table public.post_tags force row level security;

-- LECTURA. La etiqueta se ve exactamente donde se ve la publicación que la
-- lleva: si el post está `published`, la etiqueta es pública igual que él
-- (anon incluido — la card del feed y /feed/[id] se renderizan sin sesión).
-- Nunca es MÁS visible que su post: un post `pending_review` o `removed` sólo
-- muestra sus etiquetas al autor, a la persona etiquetada y a staff.
--
-- `p.tenant_id = post_tags.tenant_id` en las dos ramas es el candado
-- cross-tenant: la fila tiene que hablar de un post de SU MISMA comunidad o no
-- existe para nadie.
create policy post_tags_select on public.post_tags
for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
     where p.id = post_tags.post_id
       and p.tenant_id = post_tags.tenant_id
       and p.status = 'published'
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      profile_id = (select auth.uid())
      or exists (
        select 1 from public.posts p
         where p.id = post_tags.post_id
           and p.tenant_id = post_tags.tenant_id
           and p.author_id = (select auth.uid())
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- INSERCIÓN. Cinco condiciones, y ninguna sobra:
--   1. la fila es de MI comunidad y la firmo yo (`tagged_by = auth.uid()`);
--   2. el post es MÍO, de esta misma comunidad, y está vivo (published o
--      pending_review — se puede etiquetar mientras espera moderación; un
--      `removed` no vuelve a la vida por una etiqueta);
--   3. la persona etiquetada es miembro de ESTA comunidad (sin esto, el
--      `profile_id` podría apuntar a cualquier perfil del planeta: la FK sola
--      no sabe de tenants);
--   4. no hay bloqueo en NINGUNA dirección (app.pair_blocked es definer: ve el
--      bloqueo aunque "quién te bloqueó" no sea consultable);
--   5. su preferencia lo permite.
create policy post_tags_insert on public.post_tags
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and tagged_by = (select auth.uid())
  and exists (
    select 1 from public.posts p
     where p.id = post_tags.post_id
       and p.tenant_id = post_tags.tenant_id
       and p.author_id = (select auth.uid())
       and p.status in ('published', 'pending_review')
  )
  and exists (
    select 1 from public.profiles pr
     where pr.id = post_tags.profile_id
       and pr.tenant_id = post_tags.tenant_id
  )
  and not app.pair_blocked((select auth.uid()), post_tags.profile_id)
  and app.tagging_allowed((select auth.uid()), post_tags.profile_id)
);

-- Una etiqueta no se edita: se pone y se saca (patrón reactions 0007 /
-- follows 0023). Cambiar `profile_id` con un UPDATE sería etiquetar a otra
-- persona salteando TODOS los chequeos del insert.
create policy post_tags_update on public.post_tags
for update to authenticated
using (false)
with check (false);

-- BORRADO. El autor del post Y la persona etiquetada, sin jerarquía entre los
-- dos. Que sólo el autor pudiera quitarla convertiría "sacame de ahí" en un
-- favor que hay que pedir; el dato es sobre la persona etiquetada tanto como
-- sobre el post. Staff del tenant también, porque modera.
create policy post_tags_delete on public.post_tags
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
       where p.id = post_tags.post_id
         and p.tenant_id = post_tags.tenant_id
         and p.author_id = (select auth.uid())
    )
    or (select app.is_staff())
  )
);


-- =============================================================================
-- 3 · Buscador de personas para el selector
-- =============================================================================

-- Por qué una RPC y no un `.ilike()` desde la app: la búsqueda tiene que ser
-- INSENSIBLE A LOS ACENTOS (0052 midió que "pena" no encontraba a "Peña"), y
-- eso pide `app.unaccent_immutable()` de los dos lados de la comparación —
-- una función del esquema `app`, que PostgREST no expone ni puede nombrar.
-- Encima corre contra `profiles_display_name_unaccent_trgm_idx` (0052) sólo si
-- la expresión del WHERE es IDÉNTICA a la indexada.
--
-- Devuelve TRES columnas y punto: id, nombre y avatar. Ninguna de las columnas
-- privadas de `profiles` (0058) sale por acá, ni siquiera para el propio tenant.
--
-- SECURITY INVOKER: `profiles_select` es `using(true)`, así que no hace falta
-- definer para leer; el filtro de comunidad lo pone la RPC (mismo criterio que
-- global_search en 0044/0052).
--
-- DECISIÓN CONSCIENTE: quien no permite ser etiquetado NO APARECE en los
-- resultados, en vez de aparecer y fallar al guardar. Sí, eso hace la
-- preferencia inferible por ausencia — pero con 'following' la ausencia depende
-- del vínculo y no dice nada, y la alternativa es que la persona que etiqueta
-- reciba un error incomprensible al publicar. Se elige la UX honesta.
create or replace function public.search_taggable_members(
  q           text,
  max_results int default 8
)
returns table (
  id           uuid,
  display_name text,
  avatar_url   text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_limit  int  := least(greatest(coalesce(max_results, 8), 1), 10);
  v_q      text;
  v_qu     text;
  v_like   text;
begin
  -- Sin sesión no hay a quién etiquetar (y no hay tenant que filtrar).
  if v_uid is null or v_tenant is null then
    return;
  end if;

  v_q := btrim(coalesce(q, ''));
  if char_length(v_q) < 2 then
    return; -- vacío, sin escanear nada
  end if;
  v_q := left(v_q, 80);

  -- Se saca el acento ANTES de escapar los comodines, para que el escape siga
  -- cubriendo lo que tiene que cubrir (idéntico a global_search, 0052).
  v_qu   := app.unaccent_immutable(v_q);
  v_like := '%' || replace(replace(replace(v_qu, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.id, p.display_name, p.avatar_url
    from public.profiles p
   where p.tenant_id = v_tenant
     and p.id <> v_uid
     and coalesce(p.account_status, 'active') = 'active'
     and app.unaccent_immutable(p.display_name) ilike v_like escape '\'
     and not app.pair_blocked(v_uid, p.id)
     and app.tagging_allowed(v_uid, p.id)
   order by extensions.similarity(app.unaccent_immutable(p.display_name), v_qu) desc,
            p.display_name
   limit v_limit;
end;
$$;

comment on function public.search_taggable_members(text, int) is
  'Personas de MI comunidad que puedo etiquetar en una publicación (0089). Devuelve SÓLO id/display_name/avatar_url — ninguna columna privada de profiles (0058). Insensible a acentos vía app.unaccent_immutable de los dos lados, contra profiles_display_name_unaccent_trgm_idx (0052); la expresión del WHERE tiene que quedar TAL CUAL o el índice no se usa. Excluye: a uno mismo, cuentas no activas, bloqueos en cualquier dirección (app.pair_blocked) y a quien su tag_policy no lo permita (app.tagging_allowed). Devuelve VACÍO —no error— sin sesión, sin tenant en el JWT o con menos de 2 caracteres. max_results se clampa a [1,10].';

revoke execute on function public.search_taggable_members(text, int) from public;
revoke execute on function public.search_taggable_members(text, int) from anon;
grant execute on function public.search_taggable_members(text, int) to authenticated;


-- =============================================================================
-- 4 · Estadísticas
-- =============================================================================

analyze public.post_tags;

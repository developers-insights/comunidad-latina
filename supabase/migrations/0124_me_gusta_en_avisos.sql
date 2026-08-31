-- =============================================================================
-- 0124_me_gusta_en_avisos.sql — Comunidad Latina
--
-- «Falta la barra completa en las fichas: me gusta, comentar, compartir,
--  guardar.» (Cliente, 2026-08-31, circulado en verde sobre una tarjeta de
--  negocio.)
--
-- De las cuatro, TRES ya estaban y sólo había que llamarlas: guardar
-- (`saves`, polimórfica desde la 0038), comentar (`listing_comments` +
-- `listings.comment_count`, 0038) y compartir (`record_listing_share`, 0050).
-- La cuarta es la que trae esta migración, y el hueco es más raro de lo que
-- parece:
--
--   `reactions` YA acepta `subject_kind = 'listing'` desde la 0007. Está en el
--   CHECK, está en el índice, está en el unique (una reacción por persona) y
--   está en la policy de INSERT, con su rama propia que exige que el aviso sea
--   del mismo tenant y esté `published`. O sea: el me gusta a un aviso se puede
--   ESCRIBIR desde hace 117 migraciones.
--
--   Lo que nunca existió es cómo LEER cuántos hay.
--   `app.reactions_bump_counters()` sólo toca `posts`, y `listings` no tiene
--   `like_count`. Contarlos en vivo sería un `count(*)` sobre `reactions` por
--   cada aviso de cada página del feed — el defecto que `posts.like_count`
--   evita desde la 0007.
--
-- Así que esto NO abre una función nueva: termina una que estaba abierta por la
-- mitad, con el mismo mecanismo que ya usa su gemela.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ NO SE TOCA LA POLICY `listings_insert`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El patrón de este repo, cuando `listings` estrena un contador, fue re-crear
-- `listings_insert` sumándole `and <contador> = 0` — lo hicieron la 0038 con
-- `comment_count` y la 0050 con `view_count`. La razón es correcta y sigue
-- valiendo: la guarda de contadores es BEFORE UPDATE, así que sin esa cláusula
-- un aviso puede NACER con 9.999 me gusta por PostgREST.
--
-- Acá se resuelve lo mismo por otro camino, y no por gusto. La 0121 dejó
-- escrito el motivo con todas las letras:
--
--     «Se cambia el CUERPO y no la policy listings_insert porque la 0109 en
--      espera la reescribe entera: tocar el texto de la policy haría que
--      aplicar la 0109 revirtiera esta regla en silencio.»
--
-- `0109_activar_gate_identidad.sql` no está en el repo todavía y, cuando entre,
-- va a re-crear la policy a partir del texto de la 0106. Una cláusula agregada
-- acá desaparecería sin que falle nada: el mejor de los mundos para un agujero
-- de integridad. Un TRIGGER BEFORE INSERT no lo puede revertir una policy, y
-- además es más fuerte —fuerza el valor en vez de rechazar la fila—, así que
-- no hay que decidir qué hacer con el error.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE NO HACE FALTA
-- ═══════════════════════════════════════════════════════════════════════════
--
--   · GRANTS. La 0107 hace `grant select on public.listings to anon,
--     authenticated` a nivel TABLA, no columna: una columna nueva queda
--     cubierta. (Si alguna vez se pasa a grants por columna, esta línea deja de
--     ser cierta — está dicho acá a propósito.)
--   · POLICIES DE `reactions`. Ya cubren 'listing' desde la 0007, las cuatro.
--   · LIMPIEZA DE HUÉRFANAS. `app.cleanup_reactions()` (0007) borra por
--     (subject_kind, subject_id) sin saber de qué tipo es el sujeto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · LA COLUMNA
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.listings
  add column like_count int not null default 0 check (like_count >= 0);

comment on column public.listings.like_count is
  'Me gusta del aviso. Espejo exacto de posts.like_count (0007). Mantenido por app.reactions_bump_counters(); update directo bloqueado por app.protect_listing_counters() e insert con valor propio bloqueado por app.listings_like_count_nace_en_cero().';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · EL TRIGGER QUE LO MANTIENE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Re-creación COMPLETA de app.reactions_bump_counters() (base: 0007) sumando la
-- rama de listings. La rama de posts queda EXACTAMENTE como estaba — se copia
-- entera y no se toca, que es el contrato de este repo cuando se re-crea una
-- función: quien lea esta migración tiene que ver el cuerpo final, no un diff.
--
-- `kind = 'like'` en las dos ramas: `reactions.kind` tiene default 'like' pero
-- la columna es libre, y el día que entren los emojis de la comunidad (60,
-- pedidos por el cliente el 2026-08-26) van a ser otros `kind` sobre esta misma
-- tabla. Sin el filtro, cada emoji sumaría al contador de me gusta.

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
    elsif new.subject_kind = 'listing' and new.kind = 'like' then
      update public.listings
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
    elsif old.subject_kind = 'listing' and old.kind = 'like' then
      update public.listings
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
  'Mantiene posts.like_count y listings.like_count en INSERT/DELETE de reactions. Sólo kind=''like'': los otros kinds (emojis de comunidad) no suman al contador de me gusta. SECURITY DEFINER para que el update no dependa de las policies del lector, y al correr dentro de un trigger pasa el gate pg_trigger_depth() de las guardas de contadores.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · LA GUARDA DE UPDATE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Re-creación COMPLETA de app.protect_listing_counters() (base: 0050 ← 0048 ←
-- 0039 ← 0038) sumando like_count. Si quedara afuera, cualquier cliente
-- autenticado lo escribiría por PostgREST y el número dejaría de significar
-- algo — y éste, como view_count, se muestra en público.

create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno (reacciones, comentarios, vistas, espejos, membresía)
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
  return new;
end;
$$;

comment on function app.protect_listing_counters() is
  'Bloquea manipulación directa de listings.like_count, comment_count, view_count, store_verified, store_active y tier por clientes autenticados (espejo de app.protect_post_counters). tier y store_active son estado PAGO: los escribe el webhook/cron via service_role.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · LA GUARDA DE INSERT (en vez de la cláusula en la policy — ver arriba)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un aviso nace con cero me gusta, siempre y para todos. Se fuerza el valor en
-- lugar de rechazar la fila: no hay nada que decidir ni error que traducir a
-- una pantalla, y el importador de avisos externos (service_role) tampoco puede
-- inventar reputación por accidente.

create or replace function app.listings_like_count_nace_en_cero()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.like_count := 0;
  return new;
end;
$$;

comment on function app.listings_like_count_nace_en_cero() is
  'Un aviso nace con 0 me gusta. Vive como trigger y no como cláusula de la policy listings_insert porque 0109_activar_gate_identidad.sql (sin aplicar) re-crea esa policy entera desde el texto de la 0106: una cláusula agregada ahí desaparecería en silencio. Ver el encabezado de la 0124 y el de la 0121.';

create trigger listings_like_count_nace_en_cero
before insert on public.listings
for each row execute function app.listings_like_count_nace_en_cero();


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · BACKFILL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los me gusta a avisos que ya existen. Hoy deberían ser cero o casi —nunca
-- hubo UI que los escribiera— pero la policy los permite desde la 0007, así que
-- el número honesto es el que hay, no el que se supone.
--
-- Corre en la migración (sin JWT → `coalesce(...) = 'service_role'` es cierto),
-- así que la guarda del punto 3 lo deja pasar. Y va DESPUÉS del trigger del
-- punto 2 a propósito: si entrara un me gusta entre medio, el trigger ya lo
-- sumó y este update lo vuelve a contar desde la fuente. No se puede duplicar.

update public.listings l
   set like_count = coalesce((
         select count(*)
           from public.reactions r
          where r.subject_kind = 'listing'
            and r.subject_id = l.id
            and r.tenant_id = l.tenant_id
            and r.kind = 'like'
       ), 0)
 where exists (
         select 1
           from public.reactions r
          where r.subject_kind = 'listing'
            and r.subject_id = l.id
            and r.tenant_id = l.tenant_id
            and r.kind = 'like'
       );


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · LO QUE FALTA DEL LADO DE LA APP (no es SQL, pero se anota acá)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Con esta migración aplicada, el corazón de la tarjeta de ficha necesita tres
-- cosas más, todas en archivos que esta tanda no tocó:
--
--   1. `LISTING_COLUMNS` (feed/queries.ts) suma `like_count, comment_count`.
--   2. `fetchViewerListingLikes()` — espejo literal de `fetchViewerLikes`, con
--      `.eq("subject_kind", "listing")`.
--   3. `useOptimisticLike` (feed/card-like-context.tsx) acepta
--      `subjectKind: "post" | "listing"` (default "post") y saltea
--      `notifyPostReactionAction` cuando no es un post — no existe aviso de
--      "le gustó tu aviso", y mandar el de post con un id de listing sería
--      notificar por algo que no pasó.
--
-- Hasta entonces `ListingActions` no dibuja el corazón: prefiere no estar antes
-- que mostrar un número que vuelve a cero al recargar.

-- =============================================================================
-- 0051_ad_video_href.sql — Comunidad Latina
--
-- Cierra la deuda que la propia 0044 se anotó: `app.video_post_href` mandaba
-- TODO resultado de video al reel (`/videos?start=<id>`), y su comentario decía
-- que 0046 la iba a re-crear cuando existiera el video publicitario. 0046 trajo
-- las columnas pero no volvió a esta función, así que un anuncio encontrado por
-- búsqueda seguía abriendo el scroll de Videos Cortos.
--
-- Eso no es un detalle de ruteo: es EXACTAMENTE lo que el cliente reportó en la
-- call del 29/7 (1:19) — «cuando cierras el video se regresa de nuevo a la
-- publicación… no puedes ir scrolling, tiene que quedarse dentro del anuncio».
-- Y la spec nº4 §6 lo pone como regla dura: el video publicitario NO forma parte
-- del feed infinito, ni siquiera como destino. Un anuncio que abre el reel
-- rompe las dos cosas a la vez: mete al espectador en un scroll donde ese video
-- por contrato no existe, y le hace perder el anuncio que estaba mirando.
--
-- La app ya se defendía por su lado (src/components/search/helpers.ts corrige el
-- destino del patrocinado), pero dejar la RPC mintiendo significa que la
-- próxima superficie que consuma `href` —y el punto de que el href salga de la
-- RPC es justamente que nadie tenga que re-inventar el ruteo— hereda el bug.
-- Se arregla en la fuente y la corrección de la app queda como cinturón.
--
-- Sigue siendo `stable` y no `immutable`: ahora lee `posts`.
-- =============================================================================

create or replace function app.video_post_href(p_post_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           -- Las tres señales, con la misma unión que usa la tarjeta en la app
           -- (`isPaidAdvertising` en src/components/feed/helpers.ts). Se miran
           -- las tres y no sólo `video_type` porque una promo puede vencer y
           -- dejar `is_paid_ad` en true con el tipo sin declarar: el destino
           -- tiene que seguir siendo el anuncio igual. De las tres, la que
           -- manda es la más restrictiva.
           when p.is_paid_ad
             or p.video_type = 'advertising_video'
             or not p.eligible_for_short_feed
           then '/feed/' || p_post_id::text
           else '/videos?start=' || p_post_id::text
         end
    from public.posts p
   where p.id = p_post_id;
$$;

comment on function app.video_post_href(uuid) is
  'Destino de un resultado de búsqueda de tipo ''videos''. Video orgánico ⇒ el reel (/videos?start=id). Video publicitario, o cualquiera vetado del scroll por eligible_for_short_feed ⇒ su publicación (/feed/id), porque la spec nº4 §6 lo saca del feed infinito incluso como destino. Re-creada por 0051: la 0044 la dejó apuntando siempre al reel y anotó esta deuda en su propio comentario.';

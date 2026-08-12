-- =============================================================================
-- 0095_resenas_cuatro_policies_canonicas.sql — Comunidad Latina
--
-- La 0093 dejó `listing_reviews` con SIETE policies: dos de SELECT y tres de
-- UPDATE, cada una para un actor distinto (autor, negocio, staff). Funciona,
-- pero rompe el gate: `scripts/rls-enumerator.mjs` exige EXACTAMENTE cuatro
-- policies canónicas por tabla —`_select`, `_insert`, `_update`, `_delete`— y
-- con esto el gate quedaba rojo, o sea que ninguna migración podía avanzar.
--
-- La regla del enumerador no es burocracia. Con una policy por actor, los
-- permisos de una tabla se leen sumando expresiones repartidas en varias filas
-- de `pg_policies`, y ahí es donde se cuela el agujero que nadie ve: alcanza
-- con que UNA de las tres de UPDATE se olvide del filtro de tenant. Con una
-- sola policy por comando, "quién puede escribir esto" se responde leyendo un
-- solo predicado.
--
-- LO QUE ESTA MIGRACIÓN NO HACE: cambiar quién puede qué. Es una consolidación
-- literal —la disyunción de los tres UPDATE es la misma que ya regía— y sigue
-- apoyada en el trigger `app.listing_reviews_guard_columns` de la 0093, que es
-- el que reparte las COLUMNAS: el autor corrige puntaje y texto y no toca la
-- respuesta; el negocio responde y no toca el puntaje; nadie mueve la reseña de
-- aviso, autor ni comunidad. Esa parte no se toca y sigue siendo la que
-- realmente separa a los actores.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- SELECT — lo publicado se lee, y cada quien ve además lo suyo
-- -----------------------------------------------------------------------------
-- Une la rama pública de `listing_reviews_select` con la privada de
-- `listing_reviews_select_propia`: una reseña oculta por moderación la siguen
-- viendo su autor y el staff de esa comunidad, que es justo lo que permite
-- decirle a alguien "tu reseña está en revisión" en vez de que desaparezca sin
-- explicación.
drop policy if exists listing_reviews_select on public.listing_reviews;
drop policy if exists listing_reviews_select_propia on public.listing_reviews;
create policy listing_reviews_select on public.listing_reviews
for select to authenticated, anon
using (
  (
    status = 'published'
    and exists (select 1 from public.listings l where l.id = listing_reviews.listing_id)
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and author_id = (select auth.uid())
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
);

comment on policy listing_reviews_select on public.listing_reviews is
  'Lo publicado se lee (la ficha de un negocio es pública). Además, el autor y el staff de la comunidad ven las suyas aunque estén ocultas por moderación, para poder explicar por qué no aparecen. La rama de staff lleva su filtro de tenant: un moderador de una comunidad no lee las reseñas ocultas de otra.';

-- -----------------------------------------------------------------------------
-- UPDATE — las tres ramas, en un solo predicado
-- -----------------------------------------------------------------------------
drop policy if exists listing_reviews_update on public.listing_reviews;
drop policy if exists listing_reviews_update_autor on public.listing_reviews;
drop policy if exists listing_reviews_update_negocio on public.listing_reviews;
drop policy if exists listing_reviews_update_staff on public.listing_reviews;
create policy listing_reviews_update on public.listing_reviews
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      author_id = (select auth.uid())
      or app.can_manage_listing(listing_id, (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      author_id = (select auth.uid())
      or app.can_manage_listing(listing_id, (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy listing_reviews_update on public.listing_reviews is
  'Tres actores en un solo predicado: el autor de la reseña, quien administra el aviso (para responder) y el staff de la comunidad. QUÉ columna puede tocar cada uno lo decide el trigger app.listing_reviews_guard_columns (0093), no esta policy — acá sólo se resuelve quién entra. El `with check` repite el `using` para que nadie pueda mover una reseña fuera de su comunidad al editarla.';

commit;

-- =============================================================================
-- LIMPIEZA DE LINKS DE COMPRA GUARDADOS (QA F03 / F04)
-- =============================================================================
--
-- La app ya no muestra ni deja guardar estos links (src/lib/url/purchase-link.ts).
-- Esto limpia los que ya están en la base. Es requisito de la migración
-- 0183_links_de_compra_reales.sql: un CHECK se evalúa en CUALQUIER update de la
-- fila, así que una fila sucia dejaría de poder actualizar hasta sus contadores.
--
-- CÓMO SE USA (SQL Editor de Supabase, con el archivo ENTERO cada vez, porque la
-- función de abajo es temporal y vive sólo en esa sesión):
--
--   1. Correrlo tal cual. Sólo lee: devuelve la lista para revisar.
--   2. Revisar la lista. Lo marcado `http_real` es un link que parece de verdad
--      pero sin https: acá se pasa a https, no se borra. Si alguno no debe
--      tocarse, resolverlo a mano antes.
--   3. Sacar las dos marcas `LIMPIEZA` para activar el bloque del paso 2 y correrlo.
--      Es idempotente: una segunda pasada no cambia nada.
--   4. Correrlo de nuevo como en el paso 1: la lista tiene que salir vacía.
--
-- Dónde hay links de compra:
--   · listings.cta_purchase_url            (0048) productos
--   · listings.cta_tickets_url             (0048) eventos, premium
--   · listings.attrs ->> 'tickets_url'            eventos, enlace base
--   · listing_premiums.ctas_snapshot       (0054) botones guardados en una baja de
--     premium. Se limpian también: al reactivar vuelven a `listings`, y con el
--     CHECK puesto un link de ejemplo haría fallar el webhook de Stripe.

-- Copia exacta de app.es_link_de_compra_valido (0183), que todavía no existe.
create or replace function pg_temp.link_valido(p_url text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_url text := btrim(p_url);
  v_autoridad text;
  v_host text;
  v_etiquetas text[];
  v_terminacion text;
begin
  if v_url is null or char_length(v_url) > 500 or v_url !~* '^https://' then
    return false;
  end if;
  v_autoridad := lower(substring(v_url from '^[^:]+://([^/?#]*)') collate "C");
  -- SQL no normaliza la URL como el navegador, que lee `\` como `/`, decodifica `%61`
  -- y pliega los caracteres de ancho completo. Por eso se rechaza toda autoridad que
  -- no sea un host ASCII pelado: usuario, barra invertida, `%` y Unicode no pasan.
  -- `collate "C"`: `lower()` sólo toca ASCII, y un Unicode no se convierte en letra.
  if v_autoridad is null or v_autoridad !~ '^[a-z0-9.-]+(:[0-9]+)?$' then
    return false;
  end if;
  v_host := regexp_replace(regexp_replace(v_autoridad, ':[0-9]+$', ''), '\.$', '');
  v_etiquetas := string_to_array(v_host, '.');
  if coalesce(array_length(v_etiquetas, 1), 0) < 2 then
    return false;
  end if;
  v_terminacion := v_etiquetas[array_length(v_etiquetas, 1)];
  if v_terminacion !~ '^([a-z]{2,}|xn--[a-z0-9-]+)$' then
    return false;
  end if;
  if v_terminacion = any (array['invalid', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'arpa', 'onion']) then
    return false;
  end if;
  return not v_etiquetas && array['example', 'ejemplo', 'test', 'prueba', 'localhost', 'placeholder', 'dummy'];
end;
$$;

-- null = está bien · http_real = se pasa a https · invalido = se borra
create or replace function pg_temp.motivo(p_url text)
returns text
language sql
immutable
as $$
  select case
    when p_url is null then null
    when pg_temp.link_valido(p_url) then null
    when p_url ~* '^\s*http://'
      and pg_temp.link_valido(regexp_replace(btrim(p_url), '^http://', 'https://', 'i'))
      then 'http_real'
    else 'invalido'
  end;
$$;

create or replace function pg_temp.corregido(p_url text)
returns text
language sql
immutable
as $$
  select case pg_temp.motivo(p_url)
    when 'http_real' then regexp_replace(btrim(p_url), '^http://', 'https://', 'i')
    when 'invalido' then null
    else p_url
  end;
$$;

-- -----------------------------------------------------------------------------
-- PASO 2 — limpiar. Va antes del SELECT para que la lista final refleje el
-- resultado. Desactivado: sacar las dos marcas LIMPIEZA para activarlo.
-- -----------------------------------------------------------------------------
/* LIMPIEZA
begin;

update public.listings
   set cta_purchase_url = pg_temp.corregido(cta_purchase_url),
       cta_tickets_url  = pg_temp.corregido(cta_tickets_url)
 where pg_temp.motivo(cta_purchase_url) is not null
    or pg_temp.motivo(cta_tickets_url) is not null;

update public.listings
   set attrs = case
         when pg_temp.corregido(attrs ->> 'tickets_url') is null then attrs - 'tickets_url'
         else jsonb_set(attrs, '{tickets_url}', to_jsonb(pg_temp.corregido(attrs ->> 'tickets_url')))
       end
 where pg_temp.motivo(attrs ->> 'tickets_url') is not null;

-- `jsonb_strip_nulls` saca la clave cuando el link se borró, y el `nullif` respeta
-- el contrato de 0054: NULL = nunca hubo baja con botones cargados.
update public.listing_premiums
   set ctas_snapshot = nullif(
         jsonb_strip_nulls(
           ctas_snapshot || jsonb_build_object(
             'cta_purchase_url', pg_temp.corregido(ctas_snapshot ->> 'cta_purchase_url'),
             'cta_tickets_url',  pg_temp.corregido(ctas_snapshot ->> 'cta_tickets_url')
           )
         ),
         '{}'::jsonb
       )
 where pg_temp.motivo(ctas_snapshot ->> 'cta_purchase_url') is not null
    or pg_temp.motivo(ctas_snapshot ->> 'cta_tickets_url') is not null;

commit;
LIMPIEZA */

-- -----------------------------------------------------------------------------
-- PASO 1 — revisar. Sólo lee.
-- -----------------------------------------------------------------------------
with links as (
  select 'listings.cta_purchase_url' as origen, l.tenant_id, l.id as listing_id, l.kind,
         l.status, l.title, l.cta_purchase_url as url
    from public.listings l
   where l.cta_purchase_url is not null
  union all
  select 'listings.cta_tickets_url', l.tenant_id, l.id, l.kind, l.status, l.title, l.cta_tickets_url
    from public.listings l
   where l.cta_tickets_url is not null
  union all
  select 'listings.attrs.tickets_url', l.tenant_id, l.id, l.kind, l.status, l.title, l.attrs ->> 'tickets_url'
    from public.listings l
   where l.attrs ->> 'tickets_url' is not null
  union all
  select 'listing_premiums.ctas_snapshot.cta_purchase_url', p.tenant_id, p.listing_id, l.kind, l.status,
         l.title, p.ctas_snapshot ->> 'cta_purchase_url'
    from public.listing_premiums p
    left join public.listings l on l.id = p.listing_id
   where p.ctas_snapshot ->> 'cta_purchase_url' is not null
  union all
  select 'listing_premiums.ctas_snapshot.cta_tickets_url', p.tenant_id, p.listing_id, l.kind, l.status,
         l.title, p.ctas_snapshot ->> 'cta_tickets_url'
    from public.listing_premiums p
    left join public.listings l on l.id = p.listing_id
   where p.ctas_snapshot ->> 'cta_tickets_url' is not null
)
select pg_temp.motivo(url) as motivo, pg_temp.corregido(url) as queda_como, origen,
       tenant_id, listing_id, kind, status, title, url
  from links
 where pg_temp.motivo(url) is not null
 order by motivo, origen, tenant_id, title;

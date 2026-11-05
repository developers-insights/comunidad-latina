-- Un botón de compra tiene que llevar a un lugar donde se pueda comprar.
--
-- El QA encontró botones reales de "Comprar" y "Sacar boletos" que llevaban a
-- example.com. El CHECK de la 0048 sólo pedía `^https?://`. La app ya lo valida
-- (src/lib/url/purchase-link.ts); esto lo vuelve imposible también para cualquier
-- camino que no pase por la app, incluidas las funciones SQL y el service role.
--
-- ANTES DE APLICAR: correr docs/decisiones/limpieza-links-compra.sql. Un CHECK se
-- evalúa en cualquier UPDATE de la fila, así que `NOT VALID` no alcanzaría: una
-- fila sucia ya no podría actualizar ni sus contadores. Por eso esta migración
-- valida las filas existentes y frena con un mensaje claro si queda alguna.
--
-- La función va en `app` para no sumarle una RPC a la API. El EXECUTE para los
-- roles de la app es obligatorio: Postgres lo chequea contra quien hace el
-- INSERT o UPDATE, también dentro de un CHECK.

begin;

-- Espejo de `linkDeCompraValido`. `src/lib/url/purchase-link.test.ts` falla si las
-- dos listas se separan.
create or replace function app.es_link_de_compra_valido(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
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

comment on function app.es_link_de_compra_valido(text) is
  'true si la URL lleva a un sitio público con https, y no a un dominio de ejemplo, una IP o un nombre interno. Espejo de linkDeCompraValido (src/lib/url/purchase-link.ts).';

revoke all on function app.es_link_de_compra_valido(text) from public;
grant execute on function app.es_link_de_compra_valido(text) to anon, authenticated, service_role;

do $$
declare
  v_listings bigint;
  v_snapshots bigint;
begin
  select count(*) into v_listings
    from public.listings l
   where (l.cta_purchase_url is not null and not app.es_link_de_compra_valido(l.cta_purchase_url))
      or (l.cta_tickets_url is not null and not app.es_link_de_compra_valido(l.cta_tickets_url))
      or (l.attrs ->> 'tickets_url' is not null and not app.es_link_de_compra_valido(l.attrs ->> 'tickets_url'));

  -- No los frena ningún CHECK, pero al reactivar un premium vuelven a `listings`,
  -- y ahí el CHECK de abajo haría fallar el webhook de Stripe.
  select count(*) into v_snapshots
    from public.listing_premiums p
   where (p.ctas_snapshot ->> 'cta_purchase_url' is not null
          and not app.es_link_de_compra_valido(p.ctas_snapshot ->> 'cta_purchase_url'))
      or (p.ctas_snapshot ->> 'cta_tickets_url' is not null
          and not app.es_link_de_compra_valido(p.ctas_snapshot ->> 'cta_tickets_url'));

  if v_listings > 0 or v_snapshots > 0 then
    raise exception 'Quedan % avisos y % respaldos de premium con links de compra inválidos. Corré primero docs/decisiones/limpieza-links-compra.sql.',
      v_listings, v_snapshots;
  end if;
end;
$$;

alter table public.listings
  add constraint listings_cta_purchase_url_real
    check (cta_purchase_url is null or app.es_link_de_compra_valido(cta_purchase_url)),
  add constraint listings_cta_tickets_url_real
    check (cta_tickets_url is null or app.es_link_de_compra_valido(cta_tickets_url)),
  add constraint listings_attrs_tickets_url_real
    check (attrs ->> 'tickets_url' is null or app.es_link_de_compra_valido(attrs ->> 'tickets_url'));

commit;

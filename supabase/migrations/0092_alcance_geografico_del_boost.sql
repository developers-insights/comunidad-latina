-- =============================================================================
-- 0092_alcance_geografico_del_boost.sql — Comunidad Latina
--
-- EL IMPULSO SE VENDÍA POR TIEMPO Y NADA MÁS. La 0016 creó `boosts` con tres
-- paquetes de DURACIÓN (7d/14d/30d) y escribió en su encabezado que "el alcance
-- es la zona del listing". Eso nunca se implementó: el bloque boosted-first de
-- /propiedades, /negocios, /profesionales y /empleos levanta los boosts activos
-- del tenant y los pone primero PARA TODO EL MUNDO, sin mirar la zona de nadie.
-- El alcance existía en el comentario, no en el producto.
--
-- El cliente lo pidió por escrito y por video: cobrar por ALCANCE GEOGRÁFICO —
-- local, nacional y global. Esta migración le da al alcance las columnas que
-- necesita para ser real, y las claves de precio para que cada comunidad lo
-- tarife desde el panel que ya existe.
--
-- ---------------------------------------------------------------------------
-- QUÉ SIGNIFICA CADA ALCANCE (el contrato que implementa src/lib/boosts)
-- ---------------------------------------------------------------------------
--   local     El lugar pago aplica SOLO para quien está en la zona objetivo:
--             o la declaró en su perfil (`profiles.area_label`) o está mirando
--             la lista filtrada por esa zona. Para el resto, el aviso sigue
--             estando —es un aviso publicado— pero en su orden natural, sin
--             lugar comprado. Es el alcance más chico y el más barato.
--
--   nacional  El lugar pago aplica para TODA la comunidad (cualquier zona), y
--             además el aviso se ofrece a las OTRAS comunidades de la
--             plataforma cuyo `tenants.country_focus` coincida con el país
--             objetivo. Una comunidad es, por definición, el país al que sirve:
--             "nacional" es exactamente eso.
--
--   global    Todo lo de nacional, y además el aviso se ofrece a TODAS las
--             comunidades de la plataforma, sin importar el país.
--
-- Fuera de su comunidad, un aviso impulsado NO se mezcla con los resultados
-- locales: aparece en una tira propia, rotulada "Patrocinado" y con el nombre
-- de la comunidad de origen, y el enlace lleva al sitio de esa comunidad. Un
-- aviso de otra comunidad metido entre los de la casa sería, además de confuso,
-- un link roto: las páginas de detalle exigen `listing.tenant_id = tenant.id`.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EL DEFAULT ES 'nacional' Y NO 'local'
-- ---------------------------------------------------------------------------
-- Las filas que ya existen NO eligieron alcance: se vendieron y se sirvieron
-- antes de que el alcance existiera. Y lo que se les sirvió está medido: el
-- lugar pago les aplicó a TODOS los miembros de la comunidad, en todas las
-- zonas, porque ninguna consulta filtraba por zona. Ese comportamiento tiene un
-- nombre en la escala nueva y es 'nacional'.
--
-- Poner 'local' habría sido más "prudente" en apariencia y más caro de verdad:
-- le habría QUITADO alcance —retroactivamente y sin avisar— a gente que ya
-- pagó. Un default no puede empeorar lo que alguien compró. 'global' tampoco
-- sirve: regalaría un escalón que nadie compró y que a partir de mañana se
-- cobra aparte. 'nacional' es el único valor que describe lo que ya recibieron.
--
-- ---------------------------------------------------------------------------
-- EL OBJETIVO SE MODELA CON LO QUE YA HAY — CERO GEO NUEVA
-- ---------------------------------------------------------------------------
-- La 0016 fue explícita: "acá NO se agrega geo nueva" (minimización §5.4). Se
-- respeta al pie:
--   * la zona objetivo es un `area_label` — el MISMO texto libre aproximado de
--     `listings.area_label`, el que usan las campañas de post (`audience.zones`
--     en post_promotions) y el filtro `?zona=` de /propiedades. No se inventa
--     una taxonomía de barrios ni se guarda una coordenada.
--   * el país objetivo es un `country_focus` — el MISMO texto de `tenants`.
-- No se pide ni se deriva ninguna ubicación nueva de ninguna persona.
--
-- ---------------------------------------------------------------------------
-- IMPRESIONES: LA MÉTRICA QUE FALTABA JUSTO DONDE SE DECIDE EL GASTO
-- ---------------------------------------------------------------------------
-- Vender tres alcances sin decir cuántas veces se mostró el aviso es vender a
-- ciegas: quien paga el escalón global no tiene con qué saber si le sirvió.
-- `boost_impressions` cuenta, por impulso y por día, cuántas veces se sirvió el
-- lugar pago. Es un AGREGADO sin identidad (doctrina de cta_clicks 0048 y
-- listing_shares 0050): no hay viewer_id, no hay hora, no hay forma de
-- reconstruir quién vio qué. Y no es lo mismo que `listings.view_count`, que
-- cuenta personas-día que ABRIERON el aviso: una impresión es que se mostró.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · El alcance en `boosts`
-- ---------------------------------------------------------------------------
alter table public.boosts
  add column if not exists scope text not null default 'nacional'
    check (scope in ('local', 'nacional', 'global'));

-- Texto libre y acotado, igual que `listings.area_label`. Sin FK a un catálogo
-- de zonas porque ese catálogo no existe: las zonas se derivan de los avisos
-- publicados (ver `loadZones` en /buscar y el filtro de /propiedades).
alter table public.boosts
  add column if not exists scope_area text
    check (scope_area is null or char_length(btrim(scope_area)) between 1 and 80);

-- Deliberadamente SIN regex de ISO-3166: `tenants.country_focus` es texto libre
-- y hoy convive 'DO' con nombres escritos a mano. Un CHECK de dos letras habría
-- hecho fallar el backfill de abajo en cualquier comunidad que haya escrito
-- "República Dominicana". La comparación se hace normalizada (upper + btrim) en
-- los dos lados, acá y en src/lib/boosts/scope.ts.
alter table public.boosts
  add column if not exists scope_country text
    check (scope_country is null or char_length(btrim(scope_country)) between 1 and 60);

comment on column public.boosts.scope is
  'Alcance geográfico comprado: local | nacional | global. Default ''nacional'' porque las filas anteriores a esta migración no eligieron alcance y lo que se les sirvió fue exactamente eso —lugar pago para toda la comunidad, sin filtro de zona—. Bajarlas a ''local'' les habría quitado retroactivamente algo ya pagado. El alcance NO altera Trust Score ni verificación (§7): solo decide a quién le aplica el lugar pago.';
comment on column public.boosts.scope_area is
  'Zona objetivo cuando scope=''local''. Es un area_label: el mismo texto aproximado de listings.area_label y de post_promotions.audience.zones. NO se recolecta geo nueva (§5.4). Se compara laxo por token (src/lib/boosts/scope.ts), igual que el matching de "Para vos": "Corona" alcanza a quien declaró "Corona, Queens".';
comment on column public.boosts.scope_country is
  'País objetivo cuando scope=''nacional''. Espeja tenants.country_focus, que es texto libre — por eso no hay CHECK de ISO-3166 y la comparación se hace con upper(btrim(...)) de los dos lados. NULL en una fila nacional significa "el país de la comunidad que la vendió", que es como quedaron las filas viejas del backfill cuando su comunidad no tenía country_focus cargado.';

-- Backfill del país objetivo de las filas que ya existían. No es cosmético: sin
-- esto, las filas viejas quedarían como 'nacional' sin país y no podrían
-- ofrecerse a las comunidades hermanas del mismo país (que es justamente lo que
-- 'nacional' promete a partir de ahora).
update public.boosts b
   set scope_country = t.country_focus
  from public.tenants t
 where t.id = b.tenant_id
   and b.scope = 'nacional'
   and b.scope_country is null
   and t.country_focus is not null;

-- Coherencia alcance ↔ objetivo. Un boost 'local' SIN zona no es local: es un
-- boost que no sabe a quién alcanza, y el código tendría que adivinar. Se
-- prohíbe en el esquema en vez de resolverse en cada consulta (mismo criterio
-- que el UNIQUE de tenant_prices en 0072).
alter table public.boosts
  drop constraint if exists boosts_scope_target_coherente;
alter table public.boosts
  add constraint boosts_scope_target_coherente check (
    (scope = 'local'    and scope_area is not null)
    or (scope = 'nacional' and scope_area is null)
    or (scope = 'global'   and scope_area is null and scope_country is null)
  );

-- Índices. El de abajo cubre las DOS consultas nuevas, que son las que corren
-- en el camino caliente de cada listado:
--   (a) "los impulsos vigentes de MI comunidad" → ya lo cubre
--       boosts_tenant_active_idx (tenant_id, status, ends_at desc) de la 0016.
--   (b) "los impulsos vigentes de OTRAS comunidades que me alcanzan" →
--       filtra por scope y, en el caso nacional, por scope_country.
-- Parcial sobre status='active' porque es el único estado que se sirve: los
-- pending_payment y los expired no se muestran nunca y no tienen por qué pesar
-- en el índice.
create index if not exists boosts_scope_activos_idx
  on public.boosts (scope, scope_country, ends_at desc)
  where status = 'active';

-- Y el de la zona, para la rama local dentro de la propia comunidad.
create index if not exists boosts_tenant_scope_area_idx
  on public.boosts (tenant_id, scope_area, ends_at desc)
  where status = 'active' and scope = 'local';

-- GRANT POR COLUMNA — sin esto la app queda muda en silencio.
-- `boosts` no tiene `grant select` de tabla: la 0018 lo revocó y la 0085 lo
-- volvió a aplicar columna por columna (nada de buyer_id, montos ni la sesión
-- de Stripe). Una columna nueva NO hereda ese grant: sin esta línea, pedir
-- `scope` desde la app devuelve 42501 y el código —que captura y sigue con []—
-- mostraría los listados sin ningún impulso, sin un solo error a la vista. Es
-- exactamente el modo de falla que documenta la 0085.
grant select (scope, scope_area, scope_country)
  on table public.boosts to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · `boost_impressions` — cuántas veces se sirvió el lugar pago
-- ---------------------------------------------------------------------------
-- Una fila por (impulso, día). AGREGADO, no log: el techo de crecimiento es
-- "un renglón por día que el impulso esté vivo" (30 como mucho, por definición
-- del paquete más largo) y no hay nada que anonimizar porque nunca hubo
-- identidad adentro. Es la forma de cta_clicks (0048), no la de listing_views
-- (0050): acá no se deduplica por persona porque una IMPRESIÓN es una
-- exhibición, no una visita — mostrarle el aviso dos veces a la misma persona
-- son dos impresiones, y así se cobra la publicidad en todos lados.
create table if not exists public.boost_impressions (
  boost_id    uuid not null references public.boosts(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  seen_on     date not null default current_date,
  impressions integer not null default 0 check (impressions >= 0),
  constraint boost_impressions_pk primary key (boost_id, seen_on)
);

comment on table public.boost_impressions is
  'Cuántas veces se SIRVIÓ el lugar pago de un impulso, por día. Agregado sin identidad (doctrina de cta_clicks 0048): ni viewer_id ni hora, así que no hay forma de reconstruir quién vio qué. No confundir con listings.view_count, que cuenta personas-día que ABRIERON el aviso: una impresión es que se mostró. Existe porque vender tres alcances sin decir cuántas veces se mostró el aviso es vender a ciegas.';
comment on column public.boost_impressions.tenant_id is
  'La comunidad DUEÑA del impulso (boosts.tenant_id), copiada acá para que la RLS y los índices no necesiten el join. NO es la comunidad donde se mostró: el desglose por comunidad de exhibición se dejó afuera a propósito, porque para tenerlo el cliente tendría que decir dónde está y ese parámetro es falsificable — el número que se muestra es el total, que nadie puede inflar apuntando a otra comunidad.';
comment on column public.boost_impressions.impressions is
  'Contador del día. Lo escribe SOLO public.record_boost_impressions() con service_role: la tabla tiene las cuatro policies de escritura en false, así que ningún JWT de usuario puede inflar las estadísticas de un impulso —ni las propias, que es lo que haría que el número dejara de significar algo—.';

create index if not exists boost_impressions_tenant_idx
  on public.boost_impressions (tenant_id, seen_on desc);

alter table public.boost_impressions enable row level security;
alter table public.boost_impressions force row level security;

-- LECTURA: quien pagó el impulso y el staff de esa comunidad. Nadie más.
-- A diferencia de `boosts` —cuyas filas activas son públicas por transparencia
-- FTC, para que el chip "Patrocinado" sea auditable— el RENDIMIENTO de una
-- campaña es dato comercial del anunciante: cuánto se mostró el aviso del
-- competidor de al lado no es asunto de nadie (misma doctrina que cta_clicks).
create policy boost_impressions_select on public.boost_impressions
for select to authenticated
using (
  exists (
    select 1
      from public.boosts b
     where b.id = boost_impressions.boost_id
       and b.tenant_id = boost_impressions.tenant_id
       and (
         b.buyer_id = (select auth.uid())
         or (
           b.tenant_id = (select app.current_tenant_id())
           and (select app.current_user_role()) in ('domain_admin', 'global_admin')
         )
       )
  )
  or (select app.is_global_admin())
);

-- ESCRITURA: nadie con JWT de usuario. Las cuatro policies nombradas (contrato
-- del enumerador de RLS) con las tres de escritura en false, igual que `boosts`.
create policy boost_impressions_insert on public.boost_impressions
for insert to authenticated
with check (false);

create policy boost_impressions_update on public.boost_impressions
for update to authenticated
using (false)
with check (false);

create policy boost_impressions_delete on public.boost_impressions
for delete to authenticated
using (false);

-- GRANT explícito de tabla: una tabla nueva de este proyecto NACE sin acceso
-- para `anon` (los default privileges del schema están tocados y son
-- compartidos con otro proyecto — ver el cierre de la 0085). Sin esto la
-- policy de arriba ni se evalúa y el panel de estadísticas se ve vacío sin un
-- solo error. Solo SELECT y solo a `authenticated`: la escritura no pasa por
-- PostgREST, y `anon` no tiene policy que lo deje leer nada acá — darle el
-- grant igual sería decir que puede cuando no puede.
grant select on table public.boost_impressions to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El único camino de escritura de las impresiones
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER y REVOCADA de anon/authenticated: la llama el servidor con
-- service_role y nadie más. Es la diferencia entre un contador y un número
-- decorativo — si cualquier cliente pudiera sumar impresiones, el primero en
-- descubrirlo infla las suyas y el dato deja de sostener una decisión de gasto.
--
-- Suma sólo sobre impulsos VIGENTES: un impulso vencido o sin pagar no puede
-- acumular exhibiciones, y ese chequeo vive acá adentro (no en la app) porque
-- es la clase de regla que no puede depender de que el caller se acuerde.
create or replace function public.record_boost_impressions(p_boost_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if p_boost_ids is null or cardinality(p_boost_ids) = 0 then
    return 0;
  end if;

  -- Techo defensivo: una pantalla nunca muestra más de un puñado de impulsos.
  -- Un array gigante sería un error de programación o un intento de abuso, y en
  -- los dos casos lo correcto es no escribir nada en vez de escribir de más.
  if cardinality(p_boost_ids) > 24 then
    raise exception 'record_boost_impressions: demasiados impulsos en una llamada (%)',
      cardinality(p_boost_ids);
  end if;

  insert into public.boost_impressions (boost_id, tenant_id, seen_on, impressions)
  select b.id, b.tenant_id, current_date, 1
    from public.boosts b
   where b.id = any(p_boost_ids)
     and b.status = 'active'
     and b.ends_at is not null
     and b.ends_at > now()
  -- `boost_impressions.impressions` sin schema a propósito: adentro de un
  -- ON CONFLICT DO UPDATE, ese nombre es el alias de la fila existente, no una
  -- resolución por search_path — calificarlo con `public.` es un error de
  -- sintaxis aunque el search_path esté vacío.
  on conflict (boost_id, seen_on)
  do update set impressions = boost_impressions.impressions + 1;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

comment on function public.record_boost_impressions(uuid[]) is
  'Suma UNA impresión del día a cada impulso vigente de la lista. Vive en `public` porque la llama la aplicación (lección de la 0070: lo que se llama por PostgREST va en public), pero con el EXECUTE revocado de anon y authenticated — o sea, solo service_role. Es a propósito: si un cliente pudiera sumar impresiones, el primero que lo descubriera inflaría las propias y el número dejaría de servir para decidir un gasto.';

revoke execute on function public.record_boost_impressions(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · El precio del alcance, configurable por comunidad
-- ---------------------------------------------------------------------------
-- El pliego pide cobrar distinto por local/nacional/global, y los precios ya
-- viven por comunidad en `tenant_prices` (0072) con su historial (0077) y su
-- editor en el panel. Se agrega ahí y no en una tabla nueva.
--
-- POR QUÉ UN RECARGO Y NO NUEVE VARIANTES ('7d_local', '7d_nacional', …)
--   Porque nueve variantes habrían HUÉRFANADO las tres que ya están sembradas y
--   configuradas: una comunidad que hoy tiene su impulso de 14 días en USD 30
--   se habría despertado cobrando la constante del código, en silencio, porque
--   la clave que el Checkout busca habría cambiado de nombre. El recargo deja
--   intactas las filas existentes: el total es duración + alcance, seis números
--   configurables para nueve combinaciones, y ningún precio ya decidido se
--   pierde.
--
-- El recargo de 'local' es CERO y está sembrado igual, con fila propia. Podría
-- no existir (la ausencia de fila cae a la constante), pero entonces el panel
-- mostraría dos escalones y no tres, y quien fija precios no vería que el
-- alcance más chico también es una palanca que puede mover.
-- El CHECK de la 0072 se declaró a nivel de columna, así que Postgres le puso
-- el nombre automático `tenant_prices_product_check`. Se lo dropea POR SU
-- DEFINICIÓN y no sólo por ese nombre: si en alguna base quedó con otro nombre
-- (un restore, un `pg_dump` viejo), un `drop constraint if exists` no lo
-- encontraría, no fallaría, y el constraint viejo seguiría vivo rechazando
-- 'boost_scope' — o sea, la migración "aplicaría bien" y el impulso no se
-- podría cobrar. El silencio es el modo de falla que hay que evitar.
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'tenant_prices'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%product%=%any%'
  loop
    execute format('alter table public.tenant_prices drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.tenant_prices
  drop constraint if exists tenant_prices_product_check;
alter table public.tenant_prices
  add constraint tenant_prices_product_check check (product in (
    'presencia',          -- Presencia Verificada del negocio
    'listing_premium',    -- Aviso premium autoservicio (0054)
    'boost',              -- Impulso de un aviso: la DURACIÓN
    'boost_scope',        -- Impulso de un aviso: el ALCANCE (recargo, 0092)
    'post_promo',         -- Campaña de una publicación
    'store_membership'    -- Membresía de tienda del marketplace
  ));

-- Mismo criterio que arriba para el CHECK de `variant`.
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'tenant_prices'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%variant%=%any%'
  loop
    execute format('alter table public.tenant_prices drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.tenant_prices
  drop constraint if exists tenant_prices_variant_check;
alter table public.tenant_prices
  add constraint tenant_prices_variant_check check (variant in (
    'basico', 'destacado', 'pro',      -- planes de presencia
    '7d', '14d', '30d',                -- paquetes de impulso y de campaña
    'local', 'nacional', 'global',     -- alcances del impulso (0092)
    'estandar'                         -- productos de variante única
  ));

comment on column public.tenant_prices.product is
  'Qué se cobra. Espeja los flujos de Checkout que existen hoy: presencia (suscripción del negocio), listing_premium (aviso premium autoservicio 0054), boost (la DURACIÓN del impulso), boost_scope (el RECARGO por alcance geográfico, 0092), post_promo (campaña de publicación) y store_membership (membresía de tienda). El impulso se cobra con DOS filas —duración + alcance— y el total es la suma: así, extender el producto no invalidó ningún precio ya configurado por una comunidad.';
comment on column public.tenant_prices.variant is
  'El escalón dentro del producto: el plan (basico/destacado/pro), la duración del paquete (7d/14d/30d) o el alcance del impulso (local/nacional/global). "estandar" es para los productos de un solo precio (listing_premium, store_membership) — un NULL acá rompería el UNIQUE, que en Postgres no distingue dos NULL.';

-- Semilla del recargo, con el MISMO criterio de la 0073: los montos son copia
-- literal de las constantes del código (BOOST_SCOPE_SURCHARGES en
-- src/lib/stripe/index.ts) y hay un test que compara este archivo contra ellas
-- fila por fila. `on conflict do nothing`: si alguien ya cargó un recargo a
-- mano, se respeta el suyo — la semilla nunca pisa una decisión comercial.
insert into public.tenant_prices (tenant_id, product, variant, billing_interval, amount_cents, currency)
select t.id, p.product, p.variant, p.billing_interval, p.amount_cents, 'USD'
  from public.tenants t
  cross join (values
    -- Recargo por alcance del impulso — BOOST_SCOPE_SURCHARGES. Cobro único,
    -- se SUMA al precio de la duración.
    ('boost_scope',      'local',     'unico',       0),
    ('boost_scope',      'nacional',  'unico',    1500),
    ('boost_scope',      'global',    'unico',    4000)
  ) as p(product, variant, billing_interval, amount_cents)
on conflict (tenant_id, product, variant, billing_interval) do nothing;

commit;

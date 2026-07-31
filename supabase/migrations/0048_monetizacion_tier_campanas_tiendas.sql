-- =============================================================================
-- 0048_monetizacion_tier_campanas_tiendas.sql — Comunidad Latina
-- MONETIZACIÓN (feedback consolidado 2026-07-30 §3 y §7): tier de publicación,
-- botones de acción, campañas, clics por botón y membresía de tienda.
--
-- QUÉ YA EXISTÍA Y NO SE DUPLICA (se leyó antes de escribir una línea):
--   * boosts (0016) — impulso one-time de un aviso, paquete 7/14/30 días,
--     estado escrito por el webhook. Sigue siendo el camino de un clic.
--   * post_promotions (0023) — campaña paga de un POST, con `audience` jsonb.
--   * business_accounts (0008) — plan "Presencia Verificada" de un negocio, con
--     su espejo público listings.store_verified (0039).
--   * post_views + listings.comment_count (0038) — contadores de engagement.
--
-- `campaigns` es el ESCALÓN AVANZADO del boost, no un sistema paralelo: guarda
-- la CONFIGURACIÓN que el boost no sabe expresar (objetivo, presupuesto libre,
-- países, ciudades, edad, idiomas, intereses). La ENTREGA sigue siendo la misma
-- del boost/post_promotions — el motor de audiencia está FUERA DE ALCANCE por
-- decisión explícita del contrato (§3: "la campaña guarda su configuración
-- completa y la muestra, pero no hay ad server. Construirlo es un proyecto
-- propio"). Por eso `campaigns` NO trae ranking propio ni toca el feed.
--
-- LA DECISIÓN NO OBVIA — CTAs COMO COLUMNAS DE `listings`, NO TABLA APARTE NI
-- `attrs`. La regla que hay que garantizar es "los botones externos sólo existen
-- en premium". Con los CTAs en columnas eso es UN CHECK de tabla: atómico, sin
-- triggers, imposible de violar incluso por service_role, y —lo importante— la
-- BAJADA de premium a free FALLA mientras queden botones cargados, que es
-- exactamente lo que se quiere (el downgrade tiene que limpiarlos en la misma
-- sentencia). En una tabla 1:1 la misma regla necesitaba dos triggers en dos
-- tablas y dejaba una ventana entre ellos; en `attrs` (jsonb) no había forma
-- legible de escribirla y se habría quedado en zod, es decir, en el cliente.
-- Son 7 columnas casi siempre nulas: en Postgres eso cuesta un bit cada una.
--
-- SOBRE §5.4 Y "CÓMO LLEGAR": se guarda `cta_address` (texto que el comercio
-- eligió publicar) y NO se agregan coordenadas. `listings.geo_zone` ya es un
-- geohash TRUNCADO a ~5 km justamente porque el plan prohíbe el punto exacto; un
-- par lat/lng acá reabriría eso para todos los verticales, incluidas las
-- propiedades, que son domicilios de personas. El link a mapas lo arma la app
-- con el texto.
-- =============================================================================


-- =============================================================================
-- 1 · listings: tier, botones de acción y estado de la tienda
-- =============================================================================

alter table public.listings
  add column tier text not null default 'free' check (tier in ('free', 'premium')),
  add column store_active boolean not null default true,
  add column cta_phone        text check (cta_phone       is null or cta_phone    ~ '^[+0-9 ().-]{5,25}$'),
  add column cta_whatsapp     text check (cta_whatsapp    is null or cta_whatsapp ~ '^[+0-9 ().-]{5,25}$'),
  add column cta_website      text check (cta_website     is null or (cta_website     ~* '^https?://' and char_length(cta_website)     <= 500)),
  add column cta_purchase_url text check (cta_purchase_url is null or (cta_purchase_url ~* '^https?://' and char_length(cta_purchase_url) <= 500)),
  add column cta_tickets_url  text check (cta_tickets_url is null or (cta_tickets_url ~* '^https?://' and char_length(cta_tickets_url) <= 500)),
  add column cta_booking_url  text check (cta_booking_url is null or (cta_booking_url ~* '^https?://' and char_length(cta_booking_url) <= 500)),
  add column cta_address      text check (cta_address     is null or char_length(cta_address) between 5 and 300);

comment on column public.listings.tier is
  'free | premium. Gobierna los topes de la publicación (5 fotos y 59 s vs 20 fotos y 5 min — src/lib/monetization/tier.ts) y la EXISTENCIA de los botones externos. Lo escribe SOLO service_role (webhook de pago): app.protect_listing_counters bloquea el UPDATE para authenticated y listings_insert exige nacer ''free''.';
comment on column public.listings.store_active is
  'Espejo público de store_memberships.status (membresía de tienda, USD 10/mes). true = la tienda se muestra. Mantenido por app.mirror_store_active(); escritura directa bloqueada por app.protect_listing_counters(). Default TRUE a propósito: los avisos que ya existen no se apagan por esta migración, y un aviso que nunca tuvo membresía no es una tienda vencida.';
comment on column public.listings.cta_phone is
  'Botón "Llamar". SÓLO premium (listings_cta_premium_only). Formato laxo a propósito: la comunidad escribe números de varios países y un E.164 estricto rechazaría entradas válidas; la normalización para el `tel:` la hace la app.';
comment on column public.listings.cta_address is
  'Dirección que el comercio ELIGIÓ publicar, para "Cómo llegar". SÓLO premium. NO se guardan coordenadas: §5.4 prohíbe el punto exacto (por eso geo_zone es un geohash truncado a ~5 km) y esa regla no se relaja por un botón. El link a mapas lo arma la app con este texto.';

-- ---------------------------------------------------------------------------
-- LA REGLA DEL CONTRATO, EN LA BASE: en `free` el único contacto es el chat de
-- Comunidad Latina. Si el aviso no es premium, no puede ni siquiera GUARDAR un
-- botón externo — no alcanza con no renderizarlo, porque el aviso es contenido
-- público (SEO) y cualquiera puede leer la fila por PostgREST.
--
-- CONSECUENCIA DELIBERADA: bajar de premium a free FALLA mientras queden
-- botones cargados. El camino de baja tiene que limpiarlos en la MISMA
-- sentencia (ver el contrato para el agente de pagos). Preferimos que el
-- downgrade sea explícito y ruidoso antes que un trigger que borre datos del
-- comercio en silencio.
-- ---------------------------------------------------------------------------
alter table public.listings
  add constraint listings_cta_premium_only check (
    tier = 'premium'
    or (
      cta_phone is null
      and cta_whatsapp is null
      and cta_website is null
      and cta_purchase_url is null
      and cta_tickets_url is null
      and cta_booking_url is null
      and cta_address is null
    )
  );

-- ---------------------------------------------------------------------------
-- Re-creación de la guarda de listings (base: 0039) sumando tier y store_active.
-- Misma doctrina que store_verified: el estado PAGO no lo escribe quien lo
-- disfruta.
-- ---------------------------------------------------------------------------
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno (trigger de comentarios, del espejo verificado o de la membresía)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: comment_count solo se actualiza por triggers';
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
  'Bloquea manipulación directa de listings.comment_count, store_verified, store_active y tier por clientes autenticados (espejo de app.protect_post_counters). tier y store_active son estado PAGO: los escribe el webhook/cron via service_role.';

-- ---------------------------------------------------------------------------
-- Re-creación de listings_insert (base: 0039) — un aviso no nace premium ni
-- nace apagado.
--
-- `tier = 'free'`: la guarda de arriba es BEFORE UPDATE, así que sin esto se
-- insertaba premium por PostgREST y se ganaban los botones externos gratis.
-- `store_active = true`: como el UPDATE de esa columna está bloqueado para
-- authenticated, un aviso que naciera en false quedaría apagado para siempre y
-- su dueño no tendría forma de arreglarlo.
-- ---------------------------------------------------------------------------
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
  and store_verified = false
  and tier = 'free'
  and store_active = true
);


-- =============================================================================
-- 2 · Helper de arrays de segmentación
--
-- Mismo problema que app.portfolio_links_ok (0047): un CHECK no admite
-- subconsulta, así que "hasta N ítems, cada uno de a lo sumo M caracteres" se
-- escribe en una función IMMUTABLE que recorre su propio argumento. Sin esto,
-- `interests` sería un text[] sin techo por PostgREST.
-- =============================================================================
create or replace function app.short_text_array_ok(p_items text[], p_max_items int, p_max_len int)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_length(p_items, 1), 0) <= p_max_items
     and not exists (
       select 1
         from unnest(coalesce(p_items, '{}'::text[])) as i
        where i is null or char_length(i) not between 1 and p_max_len
     );
$$;

comment on function app.short_text_array_ok(text[], int, int) is
  'true si el array tiene como mucho p_max_items elementos y ninguno es null ni supera p_max_len caracteres. IMMUTABLE para poder usarse en CHECK. Usada por los arrays de segmentación de campaigns.';


-- =============================================================================
-- 3 · campaigns — la configuración de una campaña
-- =============================================================================

create table public.campaigns (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants(id),
  created_by     uuid not null references public.profiles(id) on delete cascade,
  -- El sujeto es UN aviso o UN post, nunca los dos ni ninguno.
  listing_id     uuid references public.listings(id) on delete cascade,
  post_id        uuid references public.posts(id) on delete cascade,
  objective      text not null
                   check (objective in ('reach', 'traffic', 'messages', 'leads', 'sales')),
  budget_cents   int not null check (budget_cents > 0),
  currency       text not null default 'usd',
  duration_days  int not null check (duration_days between 1 and 90),
  -- Segmentación. Arrays y no jsonb: son listas planas de etiquetas, se filtran
  -- con operadores de array y no hay forma en que se vuelvan un objeto anidado.
  countries      text[] not null default '{}'::text[] check (app.short_text_array_ok(countries, 20, 60)),
  cities         text[] not null default '{}'::text[] check (app.short_text_array_ok(cities, 50, 120)),
  languages      text[] not null default '{}'::text[] check (app.short_text_array_ok(languages, 10, 20)),
  interests      text[] not null default '{}'::text[] check (app.short_text_array_ok(interests, 30, 60)),
  age_min        int check (age_min is null or age_min between 13 and 99),
  age_max        int check (age_max is null or age_max between 13 and 99),
  status         text not null default 'draft'
                   check (status in ('draft', 'pending_review', 'active', 'paused', 'finished', 'rejected')),
  review_note    text check (review_note is null or char_length(review_note) <= 500),
  stripe_checkout_session_id text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint campaigns_one_subject check (num_nonnulls(listing_id, post_id) = 1),
  constraint campaigns_age_range check (age_min is null or age_max is null or age_min <= age_max)
);

comment on table public.campaigns is
  'Campaña publicitaria: el escalón AVANZADO del boost (0016), no un sistema paralelo. Guarda lo que el boost no sabe expresar — objetivo, presupuesto libre, países, ciudades, edad, idiomas, intereses. La ENTREGA (a quién se le muestra) NO vive acá: el motor de audiencia está fuera de alcance por decisión del contrato §3, y mientras tanto el orden lo sigue poniendo el ranking de boosts/post_promotions. El estado de pago (active, starts_at, ends_at, stripe_*) lo escribe SOLO service_role.';
comment on column public.campaigns.status is
  'draft → pending_review → active → paused ⇄ active → finished. `rejected` sale de la moderación y puede volver a draft para corregir. Las transiciones que cuestan plata (pending_review → active) o que cierran la campaña con el dinero adentro son de service_role: app.campaigns_freeze define exactamente cuáles puede hacer el dueño.';
comment on column public.campaigns.countries is
  'Segmentación por país (ISO-3166 alpha-2 en mayúsculas, lo normaliza la app). Array VACÍO = sin restricción, que es distinto de NULL: acá no hay "sin definir", o restringís o no.';
comment on column public.campaigns.interests is
  'Etiquetas de interés elegidas en el armado de la campaña. Texto libre acotado (30 × 60): todavía no hay taxonomía cerrada porque no hay motor de entrega que la consuma — cuando exista, se cierra con un CHECK como el de video_category (0046).';
comment on column public.campaigns.review_note is
  'Motivo de un rechazo, para mostrárselo a quien armó la campaña. Lo escribe la moderación (service_role).';

-- "Mis campañas", las últimas primero.
create index campaigns_owner_idx on public.campaigns (tenant_id, created_by, created_at desc);
-- "¿Este aviso / este post tiene campaña viva?" — la pregunta que hacen el
-- detalle del aviso y app.posts_validate_video().
create index campaigns_listing_idx on public.campaigns (listing_id, status) where listing_id is not null;
create index campaigns_post_idx    on public.campaigns (post_id, status)    where post_id is not null;
-- El cron/moderación buscan las activas vencidas.
create index campaigns_active_idx  on public.campaigns (tenant_id, status, ends_at desc);
create unique index campaigns_checkout_session_uniq
  on public.campaigns (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function extensions.moddatetime(updated_at);

create trigger campaigns_enforce_account_active
before insert on public.campaigns
for each row execute function app.enforce_account_active();

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;

-- ---------------------------------------------------------------------------
-- A DIFERENCIA de boosts y post_promotions, campaigns NO es pública.
-- Aquellas se leen desde anon porque el chip "Destacado"/"Publicidad" tiene que
-- ser AUDITABLE (transparencia FTC): cualquiera puede verificar que lo que se
-- ve destacado está pagado. Esa auditoría se mantiene intacta — sigue saliendo
-- de boosts/post_promotions. Lo que campaigns agrega es presupuesto y
-- segmentación, que son datos COMERCIALES del anunciante: publicarlos no
-- aporta transparencia, le regala su estrategia al competidor de al lado.
-- ---------------------------------------------------------------------------
create policy campaigns_select on public.campaigns
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Se arma en primera persona, siempre como borrador, sobre un sujeto PROPIO y
-- publicado. Sin estado de pago: nace sin checkout, sin fechas y sin nota de
-- revisión.
create policy campaigns_insert on public.campaigns
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'draft'
  and stripe_checkout_session_id is null
  and starts_at is null
  and ends_at is null
  and review_note is null
  and (
    (listing_id is not null and exists (
      select 1 from public.listings l
      where l.id = campaigns.listing_id
        and l.tenant_id = campaigns.tenant_id
        and l.created_by = (select auth.uid())
        and l.status = 'published'
    ))
    or (post_id is not null and exists (
      select 1 from public.posts p
      where p.id = campaigns.post_id
        and p.tenant_id = campaigns.tenant_id
        and p.author_id = (select auth.uid())
        and p.status = 'published'
    ))
  )
);

-- El dueño edita SU campaña; qué columnas y qué transiciones lo decide
-- app.campaigns_freeze (una policy autoriza filas, no columnas).
create policy campaigns_update on public.campaigns
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
);

-- Se borra un BORRADOR. Una campaña que ya salió a revisión o que corrió es
-- constancia de una operación comercial: se termina (status='finished'), no se
-- borra — mismo criterio que "el postulante retira, no borra" (0040).
create policy campaigns_delete on public.campaigns
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    (created_by = (select auth.uid()) and status = 'draft')
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- ---------------------------------------------------------------------------
-- Blindaje de campaigns
--
-- Lo que NUNCA se mueve (ni service_role): identidad y sujeto de la campaña.
-- Cambiar listing_id/post_id después de aprobada sería mostrar como pagado un
-- anuncio distinto del que se revisó — el bait-and-switch que 0004 ya bloquea
-- para los avisos publicados.
--
-- Lo que sólo mueve service_role: el estado PAGO (checkout, fechas, nota de
-- revisión) y las transiciones que cuestan plata.
--
-- Lo que puede el dueño, y nada más: mandar a revisión, pausar, reanudar,
-- terminar, y volver un rechazo a borrador para corregirlo.
-- ---------------------------------------------------------------------------
create or replace function app.campaigns_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Transiciones permitidas al DUEÑO. Todo lo demás es de service_role.
  v_owner_moves constant text[] := array[
    'draft>pending_review',
    'draft>finished',
    'pending_review>draft',
    'rejected>draft',
    'active>paused',
    'paused>active',
    'active>finished',
    'paused>finished'
  ];
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by
     or new.listing_id is distinct from old.listing_id
     or new.post_id is distinct from old.post_id
     or new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: la identidad y el sujeto de una campaña no se modifican — se crea otra';
  end if;

  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.review_note is distinct from old.review_note then
    raise exception 'PROTECTED_COLUMNS: checkout, fechas de corrida y nota de revisión los escribe el servidor';
  end if;

  if new.status is distinct from old.status
     and not (old.status || '>' || new.status = any (v_owner_moves)) then
    raise exception 'PROTECTED_TRANSITION: esa transición de campaña la resuelve el servidor (revisión y activación son pasos de pago)';
  end if;

  -- La plata y la duración se congelan en cuanto la campaña sale del borrador:
  -- si no, se manda a revisión con USD 5 y se sube a USD 500 después de
  -- aprobada, o se estira una campaña ya corriendo sin pagar la diferencia.
  if old.status <> 'draft'
     and (new.budget_cents is distinct from old.budget_cents
          or new.duration_days is distinct from old.duration_days
          or new.currency is distinct from old.currency) then
    raise exception 'PROTECTED_COLUMNS: presupuesto, moneda y duración sólo se editan mientras la campaña es borrador';
  end if;

  return new;
end;
$$;

comment on function app.campaigns_freeze() is
  'Congela identidad y sujeto de la campaña (para todos, incluido service_role: cambiar el aviso de una campaña aprobada es bait-and-switch), reserva a service_role el estado de pago (checkout, fechas, nota de revisión) y las transiciones que cuestan plata, y congela presupuesto/moneda/duración en cuanto la campaña deja de ser borrador. El dueño sólo puede: mandar a revisión, volver un rechazo a borrador, pausar, reanudar y terminar.';

create trigger campaigns_freeze
before update on public.campaigns
for each row execute function app.campaigns_freeze();

-- ---------------------------------------------------------------------------
-- Re-creación de app.posts_validate_video (0046): ahora una campaña también
-- habilita el video publicitario.
--
-- 0046 sólo podía mirar `post_promotions` porque `campaigns` no existía todavía
-- en ese punto de la secuencia. Las dos valen: post_promotions es el mecanismo
-- que ya está en producción desde 0023, campaigns es el nuevo. Se exige que la
-- campaña esté PAGADA o al menos en revisión — un borrador no habilita a
-- ponerle "Patrocinado" a nada.
-- ---------------------------------------------------------------------------
create or replace function app.posts_validate_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.video_type is distinct from 'advertising_video' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'AD_VIDEO_NEEDS_CAMPAIGN: un video publicitario se marca DESPUÉS de crear su campaña, nunca al publicarlo';
  end if;

  if not exists (
    select 1 from public.post_promotions pp
     where pp.post_id = new.id
       and pp.tenant_id = new.tenant_id
  ) and not exists (
    select 1 from public.campaigns c
     where c.post_id = new.id
       and c.tenant_id = new.tenant_id
       and c.status in ('pending_review', 'active', 'paused', 'finished')
  ) then
    raise exception 'AD_VIDEO_NEEDS_CAMPAIGN: no hay campaña para esta publicación — no se puede declarar publicitaria';
  end if;

  return new;
end;
$$;

comment on function app.posts_validate_video() is
  'Un post sólo puede ser video_type=''advertising_video'' si tiene una promoción (post_promotions, 0023) o una campaña que ya salió del borrador (campaigns, 0048). Nacer publicitario se rechaza siempre: la campaña referencia al post, así que en el INSERT no puede existir. Sin bypass de service_role — es la integridad del chip "Patrocinado", no autorización.';


-- =============================================================================
-- 4 · cta_clicks — clics por tipo de botón, agregados por día
-- =============================================================================

-- ---------------------------------------------------------------------------
-- AGREGADO Y NO LOG, por dos razones que apuntan al mismo lado:
--   * techo de crecimiento: como mucho 8 filas por aviso y por día, pase lo que
--     pase. Un log por clic crece con el tráfico y no con el producto.
--   * §5.4: no se guarda QUIÉN hizo clic. Un registro de "esta persona tocó
--     WhatsApp en este aviso a esta hora" es exactamente el tipo de dato
--     subpoenable que el plan prohíbe construir.
--
-- Consecuencia asumida: cuenta CLICS, no personas (a diferencia de post_views,
-- que deduplica por persona-día justamente porque ahí el número público es
-- "cuánta gente vio"). Y como no hay identidad, no se puede deduplicar: alguien
-- podría inflar el contador llamando la RPC en loop. Se acepta porque no hay
-- premio — el número lo lee SÓLO el dueño del aviso: inflar el ajeno le regala
-- una métrica de vanidad a un tercero, e inflar el propio es mentirse a uno
-- mismo. No hay ranking ni cobro atado a esta tabla.
-- ---------------------------------------------------------------------------
create table public.cta_clicks (
  tenant_id  uuid not null references public.tenants(id),
  listing_id uuid not null references public.listings(id) on delete cascade,
  cta_kind   text not null
               check (cta_kind in ('phone', 'whatsapp', 'website', 'purchase', 'tickets', 'booking', 'directions', 'chat')),
  clicked_on date not null default current_date,
  clicks     int not null default 0 check (clicks >= 0),
  -- Sin columna `id`: la PK ES la agregación (mismo criterio que post_views 0038).
  constraint cta_clicks_one_per_day primary key (listing_id, cta_kind, clicked_on)
);

comment on table public.cta_clicks is
  'Clics por tipo de botón de acción de un aviso, agregados por día. Es la estadística PREMIUM del §3 del contrato ("la premium suma clics por cada botón de acción"). Cuenta clics, no personas, y no guarda quién hizo clic (§5.4). La escribe SOLO public.record_cta_click(): las 3 policies de escritura están en false.';
comment on column public.cta_clicks.cta_kind is
  'phone · whatsapp · website · purchase · tickets · booking · directions — los 7 botones externos (premium) — más `chat`, el contacto interno que existe también en free y es el único que la publicación gratuita ofrece. Que `chat` esté acá es lo que hace comparable "cuántos me escribieron" contra "cuántos me llamaron".';

-- La query real es "mi aviso, últimos 30 días, agrupado por botón": la entra el
-- prefijo (listing_id, cta_kind) de la PK y la termina el rango de clicked_on.
-- Sin índice extra.

alter table public.cta_clicks enable row level security;
alter table public.cta_clicks force row level security;

-- Las estadísticas son del DUEÑO del aviso. No son públicas: cuánto convierte
-- un comercio es dato suyo, no del competidor de al lado.
create policy cta_clicks_select on public.cta_clicks
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    exists (
      select 1 from public.listings l
      where l.id = cta_clicks.listing_id
        and l.tenant_id = cta_clicks.tenant_id
        and l.created_by = (select auth.uid())
    )
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Escritura EXCLUSIVA de public.record_cta_click (security definer). Policies en
-- false para cumplir el contrato del enumerador (4 nombradas) — mismo patrón que
-- boosts (0016) y post_promotions (0023).
create policy cta_clicks_insert on public.cta_clicks
for insert to authenticated
with check (false);

create policy cta_clicks_update on public.cta_clicks
for update to authenticated
using (false)
with check (false);

create policy cta_clicks_delete on public.cta_clicks
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- record_cta_click — el único camino de escritura
--
-- SECURITY DEFINER porque las policies de escritura están en false; por eso el
-- gate va EXPLÍCITO acá adentro (regla de la casa de 0014: una RPC definer nunca
-- confía en que "el bypass ya filtró"). Suma exactamente 1: el parámetro de
-- cantidad no existe justamente para que no se pueda pedir +1000.
-- ---------------------------------------------------------------------------
create or replace function public.record_cta_click(p_listing_id uuid, p_cta_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if p_cta_kind not in ('phone', 'whatsapp', 'website', 'purchase', 'tickets', 'booking', 'directions', 'chat') then
    raise exception 'INVALID_CTA_KIND: botón desconocido';
  end if;
  -- El aviso tiene que existir, estar publicado y ser de MI comunidad. Sin este
  -- chequeo, la RPC sembraría filas para avisos de otro tenant.
  if not exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.tenant_id = v_tenant
       and l.status = 'published'
  ) then
    raise exception 'LISTING_NOT_FOUND: el aviso no está disponible en tu comunidad.';
  end if;

  insert into public.cta_clicks (tenant_id, listing_id, cta_kind, clicked_on, clicks)
  values (v_tenant, p_listing_id, p_cta_kind, current_date, 1)
  on conflict (listing_id, cta_kind, clicked_on)
  do update set clicks = public.cta_clicks.clicks + 1;
end;
$$;

comment on function public.record_cta_click(uuid, text) is
  'Suma 1 al contador diario de un botón de acción. Único camino de escritura de cta_clicks (las policies de INSERT/UPDATE/DELETE están en false). Valida sesión, tenant del JWT y que el aviso esté publicado en esa comunidad. No recibe cantidad a propósito: siempre +1.';

revoke execute on function public.record_cta_click(uuid, text) from public;
grant execute on function public.record_cta_click(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 5 · store_memberships — USD 10/mes por tienda
-- =============================================================================

create table public.store_memberships (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants(id),
  -- La tienda ES un listing kind='business' (así lo resuelve
  -- /marketplace/tienda/[storeId] y así lo asume 0039).
  store_id               uuid not null references public.listings(id) on delete cascade,
  owner_id               uuid not null references public.profiles(id) on delete cascade,
  status                 text not null default 'active'
                           check (status in ('active', 'past_due', 'canceled', 'expired')),
  price_cents            int not null default 1000 check (price_cents > 0),
  currency               text not null default 'usd',
  current_period_end     timestamptz,
  stripe_subscription_id text,
  stripe_customer_id     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint store_memberships_one_per_store unique (store_id)
);

comment on table public.store_memberships is
  'Membresía de tienda (USD 10/mes, §7 del contrato). Estado de facturación: lo escribe SOLO el webhook de Stripe via service_role — las 3 policies de escritura están en false, igual que boosts (0016). La tienda se apaga sola al vencer: el cron expire-store-memberships pasa la fila a ''expired'' y el trigger espeja el resultado en listings.store_active, que es la columna que lee el marketplace. price_cents tiene default 1000 y no está hardcodeado en un CHECK porque el "precio fundador de por vida" quedó FUERA DE ALCANCE por ser una decisión comercial todavía no tomada — cuando se tome, es una fila con otro precio, no una migración.';
comment on column public.store_memberships.current_period_end is
  'Fin del período pagado. El cron compara contra now() para expirar. NULL = todavía no llegó el primer webhook con período (o membresía de cortesía): el cron no la toca.';
comment on column public.store_memberships.stripe_subscription_id is
  'Suscripción de Stripe (sub_...). Nullable: sin credenciales de Stripe la app degrada elegante (§5.6) y la membresía puede existir en modo demo.';

create index store_memberships_owner_idx on public.store_memberships (tenant_id, owner_id, created_at desc);
-- El cron busca las vencidas; la moderación, las que están al caer.
create index store_memberships_expiry_idx on public.store_memberships (status, current_period_end);
create unique index store_memberships_subscription_uniq
  on public.store_memberships (stripe_subscription_id)
  where stripe_subscription_id is not null;

create trigger store_memberships_set_updated_at
before update on public.store_memberships
for each row execute function extensions.moddatetime(updated_at);

alter table public.store_memberships enable row level security;
alter table public.store_memberships force row level security;

-- El dueño ve su membresía (fechas y estado); el visitante no necesita verla
-- porque lo que le importa —si la tienda está prendida— viaja en
-- listings.store_active. Exponer la tabla habría filtrado período e ids de
-- Stripe: es el mismo problema que 0039 resolvió con un espejo, y se resuelve
-- igual.
create policy store_memberships_select on public.store_memberships
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    owner_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

create policy store_memberships_insert on public.store_memberships
for insert to authenticated
with check (false);

create policy store_memberships_update on public.store_memberships
for update to authenticated
using (false)
with check (false);

create policy store_memberships_delete on public.store_memberships
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- Espejo: store_memberships.status → listings.store_active
--
-- Calcado de app.mirror_store_verified (0039), y por el mismo motivo: el
-- marketplace lee `listings` y no puede hacer un join por fila contra una tabla
-- que la RLS le esconde. `active` y `past_due` mantienen la tienda prendida —
-- un cobro que rebotó da margen para reintentar, no apaga el negocio de alguien
-- en el acto; `canceled` y `expired` la apagan.
-- ---------------------------------------------------------------------------
create or replace function app.mirror_store_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings
     set store_active = (new.status in ('active', 'past_due'))
   where id = new.store_id
     and tenant_id = new.tenant_id
     and store_active is distinct from (new.status in ('active', 'past_due'));
  return new;
end;
$$;

comment on function app.mirror_store_active() is
  'Copia el estado de la membresía al aviso de la tienda (listings.store_active) cada vez que el webhook de Stripe o el cron tocan store_memberships. active/past_due = prendida; canceled/expired = apagada.';

create trigger store_memberships_mirror_active
after insert or update of status, store_id on public.store_memberships
for each row execute function app.mirror_store_active();

-- ---------------------------------------------------------------------------
-- pg_cron: la tienda se apaga sola (04:50 UTC diario, patrón de 0013/0016).
-- Actualiza store_memberships; el espejo de arriba propaga a listings solo.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('expire-store-memberships');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'expire-store-memberships',
  '50 4 * * *',
  $$update public.store_memberships
       set status = 'expired'
     where status in ('active', 'past_due')
       and current_period_end is not null
       and current_period_end < now()$$
);

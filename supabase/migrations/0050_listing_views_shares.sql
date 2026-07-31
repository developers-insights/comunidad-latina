-- =============================================================================
-- 0050_listing_views_shares.sql — Comunidad Latina
-- LAS TRES MÉTRICAS QUE FALTABAN del panel de estadísticas (§3 del feedback
-- consolidado 2026-07-30): vistas y compartidos de un AVISO, y el alcance
-- (gente distinta) que la publicación premium promete.
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE. El panel se construyó con un hueco declarado:
-- `src/lib/monetization/stats.ts` mostraba likes, comentarios, guardados y
-- chats, y explicaba en su encabezado que "vistas" y "compartidos" NO tenían de
-- dónde salir — `post_views` (0038) cuenta personas-día de un POST, no de un
-- listing, y compartir era un copiar-link del cliente que no persistía nada.
-- Mostrar un cero que parece un dato, en la pantalla que sostiene una decisión
-- de gasto, era peor que el hueco. Esto llena el hueco con fuente real.
--
-- QUÉ SE LEYÓ ANTES DE ESCRIBIR UNA LÍNEA, Y QUÉ SE COPIA DE AHÍ:
--   * post_views (0038) — deduplicación POR PRIMARY KEY (post, persona, día),
--     fecha y no timestamp por minimización §5.4, counter por trigger, guarda
--     de columnas protegidas. `listing_views` es ese diseño, palabra por
--     palabra, contra `listings`.
--   * cta_clicks (0048) — AGREGADO y no log: techo de crecimiento y cero
--     identidad. `listing_shares` es esa forma, con una fila por aviso y día.
--   * app.protect_listing_counters (0038 → 0039 → 0048) — se re-crea una vez
--     más, sumando view_count. Un counter fuera de la guarda es un counter que
--     cualquier cliente autenticado escribe por PostgREST.
--
-- LA ASIMETRÍA DELIBERADA — VISTAS PÚBLICAS, ALCANCE Y COMPARTIDOS PRIVADOS:
--   * `listings.view_count` es PÚBLICO, como `posts.view_count` (0038) y
--     `listings.comment_count`. Es volumen agregado sin identidad, es la
--     convención del marketplace ("lo vieron 245 personas") y sirve a quien
--     COMPRA, no sólo a quien vende.
--   * el ALCANCE (cuánta gente DISTINTA) y los COMPARTIDOS son estadística del
--     dueño, igual que cta_clicks: cuánto convierte un comercio es dato suyo,
--     no del competidor de al lado (doctrina de 0048).
--   * y por encima de todo: NADIE —tampoco el dueño del aviso, tampoco staff—
--     lee las filas de `listing_views` ajenas. "Quién miró tu aviso" no se
--     entrega nunca; el alcance sale de `public.listing_reach()`, que cuenta
--     adentro de la base y devuelve un número pelado.
--
-- SIN SESIÓN NO HAY MÉTRICA, en las dos tablas. `listing_views.viewer_id`
-- referencia a `profiles` (sin persona no hay deduplicación posible) y
-- `record_listing_share` exige `auth.uid()` igual que `record_cta_click`. Se
-- pierden las vistas y los compartidos anónimos, y se asume: la alternativa era
-- un camino de ESCRITURA sin autenticar sobre contenido público, que es un
-- amplificador de spam a cambio de un número más lindo.
-- =============================================================================


-- =============================================================================
-- 1 · listing_views + listings.view_count — cuánta gente vio el aviso
-- =============================================================================

alter table public.listings
  add column view_count int not null default 0 check (view_count >= 0);

comment on column public.listings.view_count is
  'Personas-día que vieron el aviso. Mantenido por app.listing_views_bump_counter(); update directo bloqueado por app.protect_listing_counters(). NO es "aperturas": listing_views deduplica por (aviso, persona, día) para que el número signifique algo y no se pueda inflar recargando. Espejo exacto de posts.view_count (0038) y, como aquel, PÚBLICO: es volumen agregado sin identidad. El dato que NO es público es cuánta gente distinta (public.listing_reach) y quién.';

create table public.listing_views (
  tenant_id  uuid not null references public.tenants(id),
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade,
  viewed_on  date not null default current_date,
  constraint listing_views_one_per_day primary key (listing_id, viewer_id, viewed_on)
);

comment on table public.listing_views is
  'Una fila por (aviso, persona, DÍA): la clave primaria es la deduplicación, no un id sintético. MINIMIZACIÓN §5.4: se guarda el día, no el timestamp — "quién vio qué aviso a qué hora" no es un dato que queramos retener. Nadie lee filas ajenas, tampoco el dueño del aviso ni staff: lo que sale de acá son dos agregados, listings.view_count (público) y public.listing_reach() (del dueño).';
comment on column public.listing_views.viewed_on is
  'Fecha (no timestamp) a propósito: granularidad mínima suficiente para deduplicar.';

-- Purga/uso por aviso. El ALCANCE no necesita este índice: count(distinct
-- viewer_id) filtrado por listing_id lo resuelve la PRIMARY KEY, cuyas dos
-- primeras columnas son exactamente (listing_id, viewer_id).
create index listing_views_listing_idx on public.listing_views (tenant_id, listing_id, viewed_on desc);

alter table public.listing_views enable row level security;
alter table public.listing_views force row level security;

-- Sólo mis propias vistas, y sólo para que el cliente pueda evitar reinsertar.
-- Sin rama de dueño del aviso ni de staff: ver la lista de quiénes miraron un
-- aviso es precisamente lo que esta tabla no habilita.
create policy listing_views_select on public.listing_views
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and viewer_id = (select auth.uid())
);

-- Registrar en primera persona, en mi tenant, sobre un aviso published del
-- MISMO tenant. `viewed_on = current_date` NO es cosmético: la deduplicación es
-- por día, así que sin este check bastaría con mandar fechas distintas
-- (2020-01-01, 2020-01-02, …) para meter mil filas legales y sumar mil vistas.
create policy listing_views_insert on public.listing_views
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and viewer_id = (select auth.uid())
  and viewed_on = current_date
  and exists (
    select 1 from public.listings l
    where l.id = listing_views.listing_id
      and l.tenant_id = listing_views.tenant_id
      and l.status = 'published'
  )
);

-- Append-only: una vista no se edita ni se "des-ve". Borrar tampoco (si se
-- pudiera, alcanzaría con borrar y reinsertar para inflar view_count).
create policy listing_views_update on public.listing_views
for update to authenticated
using (false)
with check (false);

create policy listing_views_delete on public.listing_views
for delete to authenticated
using (false);

create or replace function app.listing_views_bump_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings
     set view_count = view_count + 1
   where id = new.listing_id
     and tenant_id = new.tenant_id;
  return new;
end;
$$;

comment on function app.listing_views_bump_counter() is
  'Mantiene listings.view_count en INSERT de listing_views (espejo de app.post_views_bump_counter). Sin rama DELETE: listing_views es append-only. SECURITY DEFINER para que el update del counter no dependa de las policies del lector, y al correr dentro de un trigger pasa el gate pg_trigger_depth() de app.protect_listing_counters().';

create trigger listing_views_bump_counter
after insert on public.listing_views
for each row execute function app.listing_views_bump_counter();

-- ---------------------------------------------------------------------------
-- Re-creación COMPLETA de la guarda de counters de listings (base: 0048)
-- sumando view_count. Si quedara fuera, cualquier cliente autenticado podría
-- escribirlo por PostgREST y el número dejaría de significar algo — y, a
-- diferencia de los clics, éste SÍ se muestra en público.
-- ---------------------------------------------------------------------------
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno (comentarios, vistas, espejo verificado, membresía)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
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
  'Bloquea manipulación directa de listings.comment_count, view_count, store_verified, store_active y tier por clientes autenticados (espejo de app.protect_post_counters). tier y store_active son estado PAGO: los escribe el webhook/cron via service_role.';

-- ---------------------------------------------------------------------------
-- Re-creación de listings_insert (base: 0048) sumando `view_count = 0`: la
-- guarda de arriba es BEFORE UPDATE, así que sin esto un aviso podría NACER con
-- 9.999 vistas por PostgREST. Mismo espíritu que comment_count en 0038 y que
-- tier en 0048. Todo lo demás queda igual.
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
  and view_count = 0
  and store_verified = false
  and tier = 'free'
  and store_active = true
);

-- ---------------------------------------------------------------------------
-- Una VISTA tampoco "edita" el aviso (base: 0038, que ya había excluido los
-- comentarios por lo mismo). Sin esta línea cada persona que abre el aviso le
-- movería `updated_at` y el aviso figuraría como recién modificado — incluido
-- el lastmod del sitemap, que pasaría a decir que este catálogo entero cambia
-- todos los días. La exclusión se escribe columna por columna a propósito: así
-- una columna futura sigue bumpeando updated_at sin que nadie toque el trigger.
-- ---------------------------------------------------------------------------
drop trigger listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
before update on public.listings
for each row
when (
  old.comment_count is not distinct from new.comment_count
  and old.view_count is not distinct from new.view_count
)
execute function extensions.moddatetime(updated_at);


-- =============================================================================
-- 2 · listing_reach — el "Alcance" de la publicación premium
-- =============================================================================

-- ---------------------------------------------------------------------------
-- POR QUÉ UNA RPC Y NO UNA POLICY MÁS EN listing_views.
--
-- El alcance es "cuánta gente DISTINTA vio tu aviso", así que la cuenta necesita
-- `viewer_id`. Dejar que el dueño del aviso lea sus filas de listing_views daría
-- el número… y de paso le entregaría la LISTA de quiénes miraron su publicación,
-- que es exactamente el dato que §5.4 no quiere que exista al alcance de nadie.
-- Acá la identidad no sale de la base: entra un uuid de aviso, sale un entero.
--
-- SECURITY DEFINER con el gate EXPLÍCITO adentro (regla de la casa de 0014: una
-- RPC definer nunca confía en que "el bypass ya filtró"). El gate es el mismo
-- que la policy de cta_clicks: dueño del aviso, o administración.
-- ---------------------------------------------------------------------------
create or replace function public.listing_reach(p_listing_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_reach  integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Mismo mensaje para "no existe" y para "no es tuyo": confirmar la existencia
  -- de un aviso ajeno ya sería información.
  if not exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.tenant_id = v_tenant
       and (
         l.created_by = auth.uid()
         or app.current_user_role() in ('domain_admin', 'global_admin')
       )
  ) then
    raise exception 'LISTING_NOT_FOUND: el aviso no está disponible en tu comunidad.';
  end if;

  select count(distinct v.viewer_id)::int
    into v_reach
    from public.listing_views v
   where v.listing_id = p_listing_id
     and v.tenant_id = v_tenant;

  return coalesce(v_reach, 0);
end;
$$;

comment on function public.listing_reach(uuid) is
  'Cuánta gente DISTINTA vio un aviso (todo el histórico), para el bloque premium del panel. Único camino de lectura del alcance: las filas de listing_views no las lee nadie más que su propio autor, así que la identidad de quien miró nunca sale de la base. Valida sesión, tenant del JWT y que el aviso sea del solicitante (o de la administración).';

revoke execute on function public.listing_reach(uuid) from public;
grant execute on function public.listing_reach(uuid) to authenticated, service_role;


-- =============================================================================
-- 3 · listing_shares — compartidos, agregados por día
-- =============================================================================

-- ---------------------------------------------------------------------------
-- MISMA FORMA QUE cta_clicks (0048), y por las mismas dos razones:
--   * techo de crecimiento: como mucho UNA fila por aviso y por día, pase lo que
--     pase. Un log por "compartir" crece con el tráfico y no con el producto.
--   * §5.4: no se guarda QUIÉN compartió. "Esta persona difundió este aviso a
--     esta hora" es un mapa de la red de contactos de alguien, y es justo el
--     tipo de dato subpoenable que el plan prohíbe construir.
--
-- Consecuencia asumida, idéntica a la de cta_clicks: cuenta COMPARTIDAS, no
-- personas, y sin identidad no hay forma de deduplicar — alguien podría inflar
-- el contador llamando la RPC en loop. Se acepta porque no hay premio: el número
-- lo lee SÓLO el dueño del aviso, no ordena el feed y no entra en ningún cobro.
--
-- Y por qué una tabla propia en vez de un cta_kind='share' en cta_clicks:
-- compartir NO es un botón de acción. Los cta_kind son los 7 botones externos
-- (premium) más el chat, y esa lista está espejada en el cliente
-- (`CTA_KINDS` en src/lib/monetization/tier.ts) y en el CHECK de la tabla.
-- Meter "share" ahí lo convertiría en un botón de contacto para todo el código
-- que recorre esa lista, y ataría una métrica GRATUITA a la tabla que la RLS
-- reserva a la estadística premium.
-- ---------------------------------------------------------------------------
create table public.listing_shares (
  tenant_id  uuid not null references public.tenants(id),
  listing_id uuid not null references public.listings(id) on delete cascade,
  shared_on  date not null default current_date,
  shares     int not null default 0 check (shares >= 0),
  -- Sin columna `id`: la PK ES la agregación (mismo criterio que cta_clicks).
  constraint listing_shares_one_per_day primary key (listing_id, shared_on)
);

comment on table public.listing_shares is
  'Veces que se compartió un aviso, agregadas por día. Es la métrica "compartidos" del §3, disponible en la publicación GRATUITA (a diferencia de cta_clicks, que es premium). Cuenta compartidas, no personas, y no guarda quién compartió (§5.4). La escribe SOLO public.record_listing_share(): las 3 policies de escritura están en false.';
comment on column public.listing_shares.shares is
  'Contador del día. Lo suma de a 1 la RPC; nunca se escribe desde el cliente.';

-- La query real es "mi aviso, todos sus días": la entra el prefijo listing_id de
-- la PK. Sin índice extra.

alter table public.listing_shares enable row level security;
alter table public.listing_shares force row level security;

-- Del DUEÑO del aviso, igual que cta_clicks: cuánto se difunde una publicación
-- es dato de quien la publicó, no del competidor de al lado.
create policy listing_shares_select on public.listing_shares
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    exists (
      select 1 from public.listings l
      where l.id = listing_shares.listing_id
        and l.tenant_id = listing_shares.tenant_id
        and l.created_by = (select auth.uid())
    )
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Escritura EXCLUSIVA de public.record_listing_share (security definer).
-- Policies en false para cumplir el contrato del enumerador (4 nombradas) —
-- mismo patrón que cta_clicks (0048), boosts (0016) y post_promotions (0023).
create policy listing_shares_insert on public.listing_shares
for insert to authenticated
with check (false);

create policy listing_shares_update on public.listing_shares
for update to authenticated
using (false)
with check (false);

create policy listing_shares_delete on public.listing_shares
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- record_listing_share — el único camino de escritura
--
-- Calcado de public.record_cta_click (0048): SECURITY DEFINER porque las
-- policies de escritura están en false, gate EXPLÍCITO adentro, y suma
-- exactamente 1 — el parámetro de cantidad no existe justamente para que no se
-- pueda pedir +1000.
-- ---------------------------------------------------------------------------
create or replace function public.record_listing_share(p_listing_id uuid)
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

  insert into public.listing_shares (tenant_id, listing_id, shared_on, shares)
  values (v_tenant, p_listing_id, current_date, 1)
  on conflict (listing_id, shared_on)
  do update set shares = public.listing_shares.shares + 1;
end;
$$;

comment on function public.record_listing_share(uuid) is
  'Suma 1 al contador diario de compartidas de un aviso. Único camino de escritura de listing_shares (las policies de INSERT/UPDATE/DELETE están en false). Valida sesión, tenant del JWT y que el aviso esté publicado en esa comunidad. No recibe cantidad a propósito: siempre +1.';

revoke execute on function public.record_listing_share(uuid) from public;
grant execute on function public.record_listing_share(uuid) to authenticated, service_role;

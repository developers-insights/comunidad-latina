-- =============================================================================
-- 0102_paquetes_de_servicio.sql — Comunidad Latina
--
-- El creador puede publicar PAQUETES con precio cerrado en su perfil. Pedido
-- textual del cliente sobre la captura del perfil público: «al lado de
-- instagram, que diga paquetes de servicio», «ofrecer paquetes de servicio en
-- la seccion de creadores».
--
-- ── QUÉ FALTABA, EXACTAMENTE ─────────────────────────────────────────────────
-- Hasta acá un creador tenía DOS formas de hablar de plata, y ninguna servía
-- para que lo contraten:
--
--   · `creator_profiles.skills` (0024) — los chips de «Lo que hago»: texto
--     libre, hasta 12. Dicen QUÉ hace, jamás CUÁNTO cuesta.
--   · `creator_profiles.rate_hint` — UN campo de texto libre, («Desde $150 por
--     reel»). Es una pista, no una oferta: no se puede ordenar, ni comparar, ni
--     contratar, ni calcular la comisión sobre ella, ni saber si sigue vigente.
--     Un string no es un precio.
--
-- Lo que el pedido necesita es una OFERTA: título, qué incluye, cuánto cuesta y
-- en cuánto tiempo se entrega. Eso es una fila, no una frase. De ahí esta tabla.
--
-- `rate_hint` NO se toca ni se deprecia en esta migración: sigue siendo la
-- pista para quien no quiere cerrar un precio, y romperla obligaría a migrar
-- ocho perfiles existentes a un modelo que quizá no quieren. Conviven: la pista
-- orienta, el paquete se contrata.
--
-- ── POR QUÉ TABLA PROPIA Y NO UN `listings` NI UN JSONB ──────────────────────
-- NO es un `listings` con kind nuevo (que es lo que hicieron 0024 para
-- `creator_gig` y 0096 para `lost_found`), y la diferencia es de dirección:
-- un listing es algo que alguien PUBLICA y que se modera, se impulsa, se
-- reporta, vence y aparece en un feed. Un paquete no es una publicación: es un
-- renglón del perfil de su dueño. No tiene vida fuera de ese perfil, no compite
-- en ningún listado, no se impulsa y no vence. Meterlo en `listings` le
-- arrastraría moderación, boosts, FTS, vencimiento (0098) y expiración — seis
-- sistemas que nadie pidió y que habría que apagar uno por uno con `kind`.
--
-- Tampoco es un jsonb dentro de `creator_profiles`. El precio es lo que después
-- se convierte en `gig_contracts.amount_cents`, y sobre él se calcula la
-- comisión de la comunidad (0087). Un número que termina en un contrato no
-- puede vivir en un jsonb sin CHECK: ahí no hay quien impida un precio
-- negativo, un `"1.005"` o un `null`. Acá `price_cents` es integer con CHECK,
-- igual que `gig_contracts.amount_cents`, y esa es toda la diferencia entre un
-- monto y una intención de monto.
--
-- ── LA PLATA, EN CENTAVOS Y CON EL MISMO TECHO QUE EL CONTRATO ───────────────
-- `price_cents integer` (no numeric, no float) con el MISMO tope que
-- `gig_contracts.amount_cents` y que `MAX_AMOUNT_CENTS` de
-- src/lib/pricing/money.ts: USD 1.000.000 en centavos. Es deliberado que sean
-- el mismo número — un paquete que no se pueda convertir en contrato porque su
-- precio no entra sería una trampa que se descubre recién al contratar.
--
-- `currency` espeja `gig_contracts.currency`: minúsculas y default 'usd'. Que
-- las dos tablas escriban la moneda igual es lo que permite comparar y formatear
-- sin traducir en el medio.
--
-- La COMISIÓN no se guarda acá, y es a propósito. La comisión vigente vive en
-- `creator_commission_config` (0087) y se CONGELA recién en el contrato
-- (`gig_contracts.fee_pct`, protegido por el trigger
-- app.gig_contract_fee_pct_congelado). Si un paquete guardara su propio
-- `fee_pct`, un cambio de comisión de la comunidad dejaría paquetes mostrando
-- un neto que ya no es cierto. El paquete guarda el PRECIO; cuánto le queda al
-- creador se calcula al mostrarlo, con la comisión de hoy.
--
-- ── EL TOPE DE PAQUETES ──────────────────────────────────────────────────────
-- SEIS por creador, el mismo criterio de sobriedad que ya rige en el repo
-- (portfolio: 6 fotos; skills: 12 chips). Un perfil con veinte paquetes no es
-- un catálogo: es una pantalla que nadie lee y una decisión que nadie toma.
--
-- El tope lo enforcea un trigger y NO la aplicación, por el mismo motivo que
-- app.post_tags_enforce_cap (0089): el cliente no es la frontera, y dos pestañas
-- abiertas guardando a la vez se saltean cualquier `count()` hecho en la app.
-- El advisory lock por creador cierra esa carrera.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ───────────────────────────────
--   · No toca `gig_contracts` ni su máquina de estados. Contratar un paquete
--     usa el camino que YA existe (proposeContract): el paquete sólo prellena
--     título, alcance, días y monto. No hay un segundo checkout.
--   · No toca `creator_profiles` (ni `rate_hint`, ni `skills`).
--   · No entra a `public.global_search` (0052) ni a ningún feed: un paquete se
--     encuentra entrando al perfil de su dueño, que es donde tiene sentido.
--   · No crea bucket: un paquete es texto y un número. Las fotos que lo
--     ilustran son las del portfolio, que ya existen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table public.creator_service_packages (
  id            uuid primary key default app.uuid_v7(),

  -- DENORMALIZADO igual que creator_portfolio_items / follows / saves: toda
  -- policy exige que coincida con app.current_tenant_id(), así que una fila con
  -- el tenant forjado no la ve nadie.
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  creator_id    uuid not null references public.profiles(id) on delete cascade,

  title         text not null check (char_length(btrim(title)) between 3 and 80),
  -- Qué se entrega, en prosa. Es el "scope" que va a copiarse al contrato, por
  -- eso el techo es el mismo que gig_contracts.scope acepta desde la app (2000).
  description   text check (description is null or char_length(btrim(description)) between 10 and 2000),

  -- Los renglones del "incluye": 3 videos verticales, 1 ronda de cambios, etc.
  -- Array y no prosa porque se pintan como lista y se leen de un vistazo.
  includes      text[] not null default '{}'::text[]
                  check (app.short_text_array_ok(includes, 8, 80)),

  -- ---- Plata. Ver la cabecera: mismo tipo y mismo techo que el contrato.
  price_cents   integer not null check (price_cents > 0 and price_cents <= 100000000),
  currency      text not null default 'usd' check (currency ~ '^[a-z]{3}$'),

  -- Mismo rango que gig_contracts.delivery_days: lo que se promete acá tiene
  -- que poder prometerse igual en el contrato.
  delivery_days integer not null check (delivery_days between 1 and 365),

  -- Apagado ≠ borrado. Un paquete que hoy no se puede tomar (agenda llena,
  -- temporada) se apaga y se vuelve a prender; borrarlo perdería el texto que
  -- costó escribir. Lo apagado sólo lo ve su dueño (ver la policy de SELECT).
  active        boolean not null default true,

  -- Orden que eligió el creador. Sin UNIQUE a propósito: un reordenamiento
  -- escribe varias filas y un UNIQUE obligaría a un baile de valores
  -- temporales. Los empates los rompe created_at, que es estable.
  sort_order    integer not null default 0 check (sort_order between 0 and 99),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.creator_service_packages is
  'Paquetes de servicio con precio cerrado que un creador publica en su perfil (0102). Pedido textual del cliente: «ofrecer paquetes de servicio en la seccion de creadores». No es un listings —no se modera, no se impulsa, no vence, no aparece en ningún feed—: es un renglón del perfil de su dueño. price_cents comparte tipo y techo con gig_contracts.amount_cents porque es el monto que después se propone como contrato. La comisión NO se guarda acá: vive en creator_commission_config (0087) y se congela recién en el contrato.';

comment on column public.creator_service_packages.price_cents is
  'Precio en CENTAVOS, entero. Mismo tipo y mismo tope que gig_contracts.amount_cents (USD 1.000.000) para que todo paquete se pueda convertir en contrato sin sorpresas. Nunca numeric ni float: ver la cabecera de src/lib/pricing/money.ts sobre por qué un precio no pasa por un flotante.';
comment on column public.creator_service_packages.description is
  'Qué se entrega, en prosa. Se copia como alcance (scope) al proponer el contrato, por eso comparte su techo de 2000.';
comment on column public.creator_service_packages.includes is
  'Renglones del "incluye" (hasta 8 de hasta 80 caracteres). Array y no prosa porque se pintan como lista: quien compara dos paquetes lee viñetas, no párrafos.';
comment on column public.creator_service_packages.active is
  'Apagado ≠ borrado. Un paquete apagado conserva su texto y sólo lo ve su dueño; se vuelve a prender sin reescribirlo.';
comment on column public.creator_service_packages.sort_order is
  'Orden elegido por el creador. Sin UNIQUE: reordenar escribe varias filas a la vez y un UNIQUE obligaría a valores temporales. Los empates los rompe created_at.';

-- Lectura del perfil público: los paquetes activos de una persona, en su orden.
create index creator_service_packages_publico_idx
  on public.creator_service_packages (creator_id, sort_order, created_at)
  where active;

-- Lectura del editor (incluye los apagados) y del tope por creador.
create index creator_service_packages_creador_idx
  on public.creator_service_packages (tenant_id, creator_id, sort_order, created_at);

create trigger creator_service_packages_set_updated_at
before update on public.creator_service_packages
for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 2. El tope de 6, enforceado por la base
--
-- Calcado de app.post_tags_enforce_cap (0089), incluido el advisory lock: sin
-- él, dos INSERT simultáneos del mismo creador leen ambos "5" y quedan 7 filas.
-- El lock es por transacción y por creador, así que no serializa a la
-- plataforma entera — sólo a alguien peleando consigo mismo.
--
-- Sólo en INSERT: un UPDATE no puede aumentar la cantidad de filas.
-- ---------------------------------------------------------------------------
create or replace function app.creator_service_packages_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.creator_id::text, 102)
  );

  select count(*) into v_count
    from public.creator_service_packages p
   where p.creator_id = new.creator_id
     and p.tenant_id  = new.tenant_id;

  if v_count >= 6 then
    raise exception 'CREATOR_PACKAGES_LIMIT: podés publicar hasta 6 paquetes de servicio'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.creator_service_packages_enforce_cap() is
  'Tope de 6 paquetes por creador y comunidad (0102). Vive en la base y no en la app por el mismo motivo que app.post_tags_enforce_cap: el cliente no es la frontera y dos pestañas guardando a la vez se saltean cualquier count() hecho en TypeScript. El advisory lock por creador cierra esa carrera.';

revoke all on function app.creator_service_packages_enforce_cap() from public, anon, authenticated;

create trigger creator_service_packages_cap
before insert on public.creator_service_packages
for each row execute function app.creator_service_packages_enforce_cap();

-- ---------------------------------------------------------------------------
-- 3. RLS — las CUATRO policies canónicas, ni una más (gate `npm run check:rls`)
--
-- Forma calcada de `creator_portfolio_items`, que es la tabla hermana: cuelga
-- de un creador, el dueño escribe, el staff de la comunidad puede intervenir.
-- ---------------------------------------------------------------------------
alter table public.creator_service_packages enable row level security;
alter table public.creator_service_packages force row level security;

-- SELECT. Tres audiencias en un predicado:
--
--  1. Lo ACTIVO es público — un precio publicado es contenido público, igual
--     que el perfil que lo contiene (creator_profiles_select). Para quien tiene
--     sesión se filtra por comunidad: es la doctrina de la 0091 («la lectura no
--     cruza comunidades»), la misma rama `auth.uid() is null` que ya usa
--     creator_profiles_select para dejar pasar al visitante anónimo (SEO).
--  2. El DUEÑO ve además los apagados — son suyos y los está editando.
--  3. El STAFF de la comunidad ve todo lo de su comunidad, que es lo que
--     permite atender un reporte sobre un precio.
--
-- Lo apagado NO entra por la rama pública: un paquete a medio escribir, o
-- guardado para el mes que viene, no es una oferta y no se muestra como tal.
create policy creator_service_packages_select on public.creator_service_packages
for select to anon, authenticated
using (
  (
    active
    and (
      (select auth.uid()) is null
      or tenant_id = (select app.current_tenant_id())
    )
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      creator_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy creator_service_packages_select on public.creator_service_packages is
  'Lo activo es público (un precio publicado es contenido público, igual que el perfil que lo contiene), y para quien tiene sesión se acota a su comunidad — doctrina 0091. El dueño ve además los apagados, y el staff de la comunidad ve todo lo de su comunidad para poder atender un reporte. Lo apagado nunca entra por la rama pública: un paquete guardado para más adelante no es una oferta.';

-- INSERT. Sólo el dueño, en su comunidad, y sólo si YA tiene perfil de creador
-- en esa misma comunidad: un precio sin perfil sería una oferta sin nadie
-- detrás — no habría titular, ni portfolio, ni reseñas, ni forma de contratar.
-- El EXISTS es contra la MISMA fila que la app lee para pintar el perfil.
create policy creator_service_packages_insert on public.creator_service_packages
for insert to authenticated
with check (
  tenant_id  = (select app.current_tenant_id())
  and creator_id = (select auth.uid())
  and exists (
    select 1
      from public.creator_profiles cp
     where cp.profile_id = (select auth.uid())
       and cp.tenant_id  = (select app.current_tenant_id())
  )
);

comment on policy creator_service_packages_insert on public.creator_service_packages is
  'Sólo el dueño y sólo en su comunidad. El EXISTS contra creator_profiles es la regla de negocio en la base: un paquete sin perfil de creador sería un precio sin nadie detrás — sin titular, sin portfolio y sin reseñas. La app además valida el tope de 6, pero el que manda es el trigger.';

-- UPDATE. El dueño edita lo suyo; el staff de la comunidad puede intervenir
-- (mismo alcance que creator_portfolio_items_update). El `with check` repite el
-- `using` para que nadie mueva un paquete a otra comunidad —ni a otro dueño—
-- al editarlo.
create policy creator_service_packages_update on public.creator_service_packages
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      creator_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      creator_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy creator_service_packages_update on public.creator_service_packages is
  'El dueño edita lo suyo; el staff de la comunidad puede intervenir sobre un paquete de su comunidad (mismo alcance que creator_portfolio_items_update). El with check repite el using: al editar no se puede mudar un paquete a otra comunidad ni cambiarle el dueño.';

-- DELETE. El dueño, y la administración de la comunidad — mismo alcance que
-- creator_portfolio_items_delete y creator_profiles_delete. Un moderador
-- (`is_staff` incluye moderadores) NO borra: apagar alcanza para que deje de
-- verse, y borrar el trabajo de otro no se deshace.
create policy creator_service_packages_delete on public.creator_service_packages
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    creator_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

comment on policy creator_service_packages_delete on public.creator_service_packages is
  'El dueño y la administración de la comunidad (domain_admin/global_admin), igual que creator_portfolio_items_delete. Un moderador NO borra: para que un paquete deje de verse alcanza con apagarlo, y borrar el trabajo de otro no se deshace.';

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre: los default privileges
-- de este schema (compartido con otro producto) no incluyen a `anon`, así que
-- una tabla nueva NACE sin acceso. Sin grant, Postgres ni llega a evaluar la
-- policy: la sección se ve VACÍA y sin un solo error.
revoke all on table public.creator_service_packages from anon, authenticated;
grant select                         on table public.creator_service_packages to anon;
grant select, insert, update, delete on table public.creator_service_packages to authenticated;
grant all                            on table public.creator_service_packages to service_role;

commit;

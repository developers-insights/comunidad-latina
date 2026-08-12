-- =============================================================================
-- 0087_modalidad_de_trabajo_y_comision_por_comunidad.sql — Comunidad Latina
--
-- Dos huecos del Creator Marketplace que el cliente pidió por nota de voz y que
-- hoy, literalmente, no existen en la base:
--
--   1. MODALIDAD DEL TRABAJO. El pedido fue distinguir "Digital Jobs" de
--      "On-site Jobs". Hoy lo único que hay es `listings.area_label`, texto
--      libre donde alguien escribe "Washington Heights" o "Remoto" según se le
--      ocurra. Eso no es un dato: no se puede filtrar, no se puede contar y no
--      se puede mostrar consistente. Un aviso remoto y otro presencial se ven
--      exactamente igual en la lista.
--
--   2. LA COMISIÓN 20/80 ESTABA ESCRITA EN EL CÓDIGO. `gig_contracts.fee_pct`
--      existe desde 0024 con su CHECK 0..50 y sus columnas generadas, pero
--      nadie la elegía: el INSERT de `src/app/(app)/creadores/actions.ts` la
--      dejaba en el DEFAULT 20 y punto. Mismo argumento del pliego que motivó
--      0064 (umbrales de creador) y 0086 (umbrales de integridad): "los números
--      deben ser configurables desde el panel, no colocados permanentemente en
--      el código". Una comunidad que quiera cobrar 15% o 0% hoy necesita un
--      deploy.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 1 — `work_mode` es NULLABLE y no tiene DEFAULT
-- -----------------------------------------------------------------------------
-- Poner `default 'presencial'` habría sido cómodo y falso: afirmaría, sobre los
-- avisos que ya existen, un dato que nadie eligió. Y `listings` no es la tabla
-- de trabajos: es la tabla de TODOS los avisos (propiedades, negocios, eventos,
-- empleos). La modalidad no aplica a una propiedad en alquiler.
--
-- NULL acá significa exactamente "no se declaró", y la app lo muestra así — no
-- inventa. Un aviso viejo sin modalidad sigue siendo un aviso válido; lo que no
-- hace es aparecer cuando alguien filtra por "a distancia", porque nadie sabe
-- si lo es.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 2 — la comisión del contrato se CONGELA al crearlo
-- -----------------------------------------------------------------------------
-- `creator_commission_config` es la comisión que rige para los contratos NUEVOS.
-- Un contrato ya creado guarda su propio `fee_pct` y no vuelve a mirar la
-- configuración nunca más.
--
-- Esto no es un detalle de implementación, es la regla del negocio: el desglose
-- que las dos partes vieron y aceptaron ("$1000 → $800 para vos, $200 para la
-- plataforma") es parte del acuerdo. Si la comisión de la comunidad subiera de
-- 20 a 30 el martes, un contrato firmado el lunes y liberado el viernes tiene
-- que pagar 20 — si no, la plataforma se estaría cobrando de más sobre plata que
-- ya estaba en garantía, y del lado del creador se vería como un descuento que
-- nadie le avisó.
--
-- La regla se documenta en `comment on column gig_contracts.fee_pct` Y se
-- ENFORCEA con un trigger, porque un comentario no impide nada: basta un
-- `update gig_contracts set fee_pct = ...` desde el panel o desde un script para
-- reescribir el pasado, y las columnas generadas recalcularían el neto solas.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 3 — el overflow que esta migración destapa (y arregla)
-- -----------------------------------------------------------------------------
-- Las columnas generadas de 0024 hacen `(amount_cents * fee_pct) / 100` con
-- aritmética de `integer`. Mientras `fee_pct` fue SIEMPRE 20 el producto máximo
-- posible era 100.000.000 × 20 = 2.000.000.000, apenas por debajo del techo de
-- int4 (2.147.483.647). Con la comisión configurable hasta 50 ese mismo monto
-- máximo da 5.000.000.000 y Postgres aborta con "integer out of range" al
-- INSERTAR el contrato — o sea que el bug no lo vería quien cambia la config,
-- lo vería un cliente al que no le entra un contrato grande, sin explicación.
--
-- Se recrean las dos columnas generadas haciendo la multiplicación en `bigint` y
-- volviendo a `int` recién al final. El resultado final entra siempre (máximo
-- 50.000.000 centavos = US$500.000 de comisión) y la SEMÁNTICA DE REDONDEO no
-- cambia: la división entera de Postgres trunca hacia cero, igual antes que
-- ahora, y ese es el redondeo que la app replica en `src/lib/creators/commission.ts`.
--
-- ⚠️ `drop column` + `add column` reescribe la tabla y manda las dos columnas al
-- final del orden físico. Se verificó que nada depende de eso: ninguna vista,
-- índice, policy ni `grant select (columna)` las menciona, y la app las pide por
-- nombre en el `select`.
--
-- -----------------------------------------------------------------------------
-- GRANTS — sin esto la tabla nueva es invisible (ver 0085)
-- -----------------------------------------------------------------------------
-- Esta base es compartida y sus default privileges quedaron sin `anon`. Una
-- tabla nueva nace sin privilegios, y sin GRANT de tabla Postgres NI SIQUIERA
-- EVALÚA la policy: la app se ve vacía, sin errores. Toda tabla de esta
-- migración termina con su grant explícito.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Modalidad del trabajo
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists work_mode text;

alter table public.listings
  drop constraint if exists listings_work_mode_check;

alter table public.listings
  add constraint listings_work_mode_check
  check (work_mode is null or work_mode in ('remoto', 'presencial', 'hibrido'));

comment on column public.listings.work_mode is
  'Modalidad del trabajo (nota de voz del cliente: "Digital Jobs" vs "On-site Jobs"). Dominio: remoto | presencial | hibrido. NULLABLE Y SIN DEFAULT a propósito: (a) los avisos anteriores a esta migración no declararon modalidad y ponerles una por decreto sería afirmar un dato que nadie eligió; (b) `listings` es la tabla de TODOS los avisos y la modalidad no aplica a una propiedad ni a un evento. NULL significa "no se declaró" — la app lo muestra así y no lo infiere de area_label, que es texto libre. Con work_mode=''remoto'' la zona deja de ser obligatoria al publicar (ver gig-publish-form.tsx).';

-- Índice espejo de `listings_public_feed_idx` (0004): mismo prefijo
-- (tenant_id, kind) y mismo orden de paginación, más la modalidad. Parcial sobre
-- lo publicado y declarado, que es lo único que un filtro por modalidad puede
-- devolver — así el índice no carga con los millones de avisos de otros kinds
-- que nunca van a tener el dato.
create index if not exists listings_work_mode_idx
  on public.listings (tenant_id, kind, work_mode, published_at desc, id desc)
  where status = 'published' and work_mode is not null;

-- ---------------------------------------------------------------------------
-- 2. La comisión, por comunidad
-- ---------------------------------------------------------------------------
create table if not exists public.creator_commission_config (
  tenant_id  uuid primary key references public.tenants(id),

  fee_pct    int not null default 20 check (fee_pct between 0 and 50),

  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.creator_commission_config is
  'Comisión de la plataforma sobre los contratos del Creator Marketplace, POR TENANT y editable desde el panel — mismo patrón y mismo motivo que creator_eligibility_config (0064) y content_integrity_settings (0086): el pliego pide que los números no vivan en el código. Rige para los contratos NUEVOS; los ya creados guardan su propio gig_contracts.fee_pct y no se recalculan jamás. LA AUSENCIA DE FILA SIGNIFICA EL DEFAULT (20%), que es exactamente lo que la app hacía hardcodeado hasta esta migración: un tenant nuevo no necesita que alguien se acuerde de sembrarle la configuración para poder cobrar.';
comment on column public.creator_commission_config.fee_pct is
  'Porcentaje que retiene la plataforma, entero, 0..50. El CHECK repite el de gig_contracts.fee_pct (0024) para que una config imposible se rechace al guardarla en el panel y no al crear el contrato, que es cuando la vería un usuario. 20 = el ejemplo del cliente ($1000 → $800 creador + $200 plataforma). 0 es válido y significa comunidad sin comisión.';
comment on column public.creator_commission_config.updated_by is
  'Quién tocó la comisión por última vez. Cambiar cuánto se le descuenta a cada creador de la comunidad es una decisión que tiene que tener nombre y fecha.';

create index if not exists creator_commission_config_updated_by_idx
  on public.creator_commission_config (updated_by);

drop trigger if exists creator_commission_config_set_updated_at on public.creator_commission_config;
create trigger creator_commission_config_set_updated_at
before update on public.creator_commission_config
for each row execute function extensions.moddatetime(updated_at);

alter table public.creator_commission_config enable row level security;
alter table public.creator_commission_config force row level security;

-- Lee cualquier miembro del tenant: la comisión es una condición comercial que
-- el creador tiene DERECHO a ver antes de aceptar un contrato, no un secreto.
-- No hay policy para `anon` porque hoy ninguna superficie pública muestra el
-- desglose; el día que exista, se agrega acá (y no aflojando el grant).
drop policy if exists creator_commission_config_select on public.creator_commission_config;
create policy creator_commission_config_select on public.creator_commission_config
for select to authenticated
using (tenant_id = (select app.current_tenant_id()));

-- Escribe SOLO el admin del dominio (o el global). Es el "panel" del pliego.
drop policy if exists creator_commission_config_insert on public.creator_commission_config;
create policy creator_commission_config_insert on public.creator_commission_config
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

drop policy if exists creator_commission_config_update on public.creator_commission_config;
create policy creator_commission_config_update on public.creator_commission_config
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- Borrar la fila volvería al 20% en silencio. Se edita, no se borra.
drop policy if exists creator_commission_config_delete on public.creator_commission_config;
create policy creator_commission_config_delete on public.creator_commission_config
for delete to authenticated
using (false);

-- GRANTS EXPLÍCITOS (0085): sin esto la policy de arriba no se evalúa nunca.
revoke all on table public.creator_commission_config from anon, authenticated;
grant select, insert, update on table public.creator_commission_config to authenticated;
grant all on table public.creator_commission_config to service_role;

-- Fila por defecto para cada tenant que ya existe. No hace falta para que el
-- sistema funcione (la lectura tiene default), pero materializarla es lo que
-- hace que el panel muestre un valor editable desde el primer día en vez de un
-- campo vacío que el admin no sabe si está o no aplicando.
insert into public.creator_commission_config (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Lectura de la comisión — nunca NULL, nunca error
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER aunque reciba el tenant por parámetro, mismo criterio que
-- app.content_integrity_settings (0086): si fuera DEFINER, cualquiera podría
-- leer la comisión de otra comunidad pasando su uuid. Siendo invoker, la RLS
-- filtra y un tenant ajeno simplemente "no tiene fila" → devuelve el default,
-- que es público por definición. `service_role` (BYPASSRLS) sigue viendo la fila
-- real, que es lo que necesita cualquier proceso server-side.
create or replace function app.creator_commission_fee_pct(p_tenant uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select c.fee_pct
       from public.creator_commission_config c
      where c.tenant_id = p_tenant),
    20
  );
$$;

comment on function app.creator_commission_fee_pct(uuid) is
  'Comisión configurada del tenant, o 20 si nunca se configuró. Existe para que "no hay fila" y "hay fila" no sean dos caminos distintos en quien la consume. SECURITY INVOKER: la RLS decide qué configuración se puede leer, así que pasar un tenant ajeno no filtra nada — devuelve el default.';

revoke execute on function app.creator_commission_fee_pct(uuid) from public, anon;
grant execute on function app.creator_commission_fee_pct(uuid) to authenticated, service_role;

-- El envoltorio que consume la app. No recibe tenant: lo deriva del JWT.
create or replace function public.get_creator_commission()
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select app.creator_commission_fee_pct((select app.current_tenant_id()));
$$;

comment on function public.get_creator_commission() is
  'Comisión (fee_pct, entero 0..50) del tenant de la sesión actual. NUNCA devuelve NULL ni falla: sin fila —o sin tenant en el JWT— devuelve 20, para que la app no tenga que tener un camino "por si no está configurado". No recibe tenant_id por parámetro A PROPÓSITO: lo deriva de app.current_tenant_id(), que sale del JWT y no del cliente. Ese parámetro sería justo el agujero multi-tenant que el resto del repo evita.';

revoke execute on function public.get_creator_commission() from public, anon;
grant execute on function public.get_creator_commission() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. El split del contrato: aritmética en bigint, redondeo idéntico
-- ---------------------------------------------------------------------------
-- Ver "DECISIÓN DE DISEÑO 3" en la cabecera. Sin este paso, con fee_pct > 42 un
-- contrato de monto alto reventaría con "integer out of range" al insertarse.
alter table public.gig_contracts
  drop column if exists platform_fee_cents,
  drop column if exists creator_net_cents;

alter table public.gig_contracts
  add column platform_fee_cents int
    generated always as (((amount_cents::bigint * fee_pct) / 100)::int) stored,
  add column creator_net_cents int
    generated always as ((amount_cents - ((amount_cents::bigint * fee_pct) / 100))::int) stored;

comment on column public.gig_contracts.platform_fee_cents is
  'Lo que retiene la plataforma, en centavos. COLUMNA GENERADA: es la única fuente de verdad del split — la app la LEE, nunca la calcula para persistirla (components/creators/money.ts). La multiplicación va en bigint para que fee_pct alto sobre montos altos no desborde int4 (era el techo latente de 0024, invisible mientras la comisión fue siempre 20). El redondeo es la división entera de Postgres, que TRUNCA hacia cero; src/lib/creators/commission.ts replica exactamente eso con Math.trunc para que la previsualización no difiera del cargo real ni en un centavo.';
comment on column public.gig_contracts.creator_net_cents is
  'Lo que cobra el creador, en centavos: amount_cents menos la comisión truncada. Se define como la RESTA y no como otro porcentaje para que fee + net sume SIEMPRE amount_cents exacto — con dos truncamientos independientes faltaría o sobraría un centavo, y ese centavo es el que aparece en un reclamo.';

comment on column public.gig_contracts.fee_pct is
  'Comisión de ESTE contrato, congelada al crearlo. Se copia de creator_commission_config (0087) en el momento del INSERT y NO vuelve a mirar la configuración nunca más: el desglose que las dos partes vieron y aceptaron es parte del acuerdo. Si la comunidad sube la comisión el martes, un contrato firmado el lunes se libera el viernes al valor del lunes. La regla la enforcea el trigger gig_contracts_fee_pct_congelado — un UPDATE de esta columna aborta, porque recalcularía las columnas generadas y reescribiría plata ya pactada.';

-- ---------------------------------------------------------------------------
-- 5. El congelamiento, enforceado (un comentario no impide nada)
-- ---------------------------------------------------------------------------
create or replace function app.gig_contract_fee_pct_congelado()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.fee_pct is distinct from old.fee_pct then
    raise exception
      'La comisión de un contrato no se puede cambiar después de crearlo (contrato %: estaba en % y se intentó poner en %).',
      old.code, old.fee_pct, new.fee_pct
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function app.gig_contract_fee_pct_congelado() is
  'Impide reescribir la comisión de un contrato existente. Aplica a TODOS los roles, service_role incluido: las server actions usan el cliente admin para mover el contrato de estado, así que dejar la puerta abierta "solo para el backend" sería dejarla abierta. Si alguna vez hiciera falta corregir un fee_pct mal cargado, es una decisión con nombre y fecha —y una migración— no un update suelto.';

drop trigger if exists gig_contracts_fee_pct_congelado on public.gig_contracts;
create trigger gig_contracts_fee_pct_congelado
before update of fee_pct on public.gig_contracts
for each row execute function app.gig_contract_fee_pct_congelado();

commit;

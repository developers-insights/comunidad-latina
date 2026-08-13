-- =============================================================================
-- 0098_vencimiento_de_publicaciones.sql — Comunidad Latina
--
-- El pedido del cliente, textual: «cuando se postea cualquiera de estas opciones,
-- se debe eliminar despues de 30 dias» y «o dar la opcion cuando se esta llegando
-- a los 30 dias, de seguir la publicacion activa».
--
-- Las dos frases juntas dicen qué problema se está resolviendo, y no es el que
-- la palabra "eliminar" sugiere: el problema es un MURO DE AVISOS VIEJOS —
-- departamentos ya alquilados, empleos ya cubiertos, productos ya vendidos— que
-- hace que la comunidad parezca abandonada y que la gente escriba a avisos
-- muertos. La segunda frase lo confirma: si el objetivo fuera destruir el dato,
-- ofrecer "seguir activa" no tendría sentido.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 1 — VENCER NO ES BORRAR. NUNCA HAY DELETE.
-- -----------------------------------------------------------------------------
-- Un `delete from listings` a los 30 días se lleva por delante, en cascada y sin
-- retorno: las fotos referenciadas, los comentarios (`listing_comments`, 0039),
-- las reseñas y su promedio (`listing_reviews` / `listing_review_stats`, 0093),
-- los seguidores (`follows`, 0023), los guardados (`saves`, 0038), las
-- postulaciones con sus respuestas congeladas (`job_applications`, 0027/0042) y
-- las estadísticas que el dueño pagó por ver (`cta_clicks`, 0048). Y activa
-- `app.cleanup_reactions/saves/follows`, que están escritos para el borrado
-- deliberado de un aviso, no para una limpieza automática nocturna.
--
-- Nada de eso es lo que el cliente pidió. Lo que pidió es que DEJE DE
-- MOSTRARSE. Así que vencer es un cambio de ESTADO:
--
--     status: 'published' → 'expired'
--
-- y listo. Todos los listados, feeds y búsquedas del repo filtran
-- `status = 'published'` (y los índices parciales que los sirven también), así
-- que un aviso vencido desaparece de la comunidad sin tocar una sola query, y
-- sin perder una sola fila. El dueño lo sigue viendo (la rama `created_by` de
-- `listings_select` no mira el status) y lo puede devolver a la vida de un toque.
--
-- POR QUÉ UN ESTADO NUEVO Y NO REUSAR `paused`. Porque son dos cosas distintas
-- y el usuario tiene que poder distinguirlas: `paused` es "yo lo bajé", `expired`
-- es "se cumplió el plazo". Meterlas en el mismo valor haría imposible escribir
-- el aviso correcto ("tu publicación venció" vs "la pausaste vos") y volvería
-- ambiguo el botón de renovar.
--
-- NO HAY JOB DE PURGA DE AVISOS VENCIDOS, y no es un olvido. La doctrina §5.4
-- ("dato viejo = riesgo") gobierna METADATOS de personas —quién le escribió a
-- quién, quién denunció a quién, quién vio qué— y por eso 0013 y 0069 purgan
-- mensajes, conversaciones, reportes y logs. Un aviso es CONTENIDO DEL USUARIO,
-- que es la categoría donde este repo ya decidió lo contrario: `content_assets`
-- «NO se purga y no es un olvido» (0069). Borrarle a alguien lo que escribió,
-- por reloj y sin que lo pida, es exactamente la clase de acción irreversible que
-- esta migración existe para evitar.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 2 — QUÉ VENCE Y QUÉ NO (y por qué no lo decide esta migración)
-- -----------------------------------------------------------------------------
-- Los ocho `kind` de `listings` no son la misma cosa con distinto nombre:
--
--   VENCEN (default) — property, event, job, product, creator_gig, lost_found.
--     Son AVISOS: describen algo que se acaba. Un alquiler se alquila, una
--     vacante se cubre, un producto se vende, una colaboración se cierra, un
--     perro perdido aparece. A los 30 días la probabilidad de que sigan vigentes
--     es baja y el costo de tenerlos arriba es alto (gente escribiendo al vacío).
--
--   NO VENCEN (default) — business, professional.
--     No son avisos: son PRESENCIA. Un negocio tiene horarios de atención
--     (`listing_hours`, 0093), reseñas con promedio mantenido por trigger
--     (`listing_review_stats`, 0093/0095), seguidores y, muchas veces, una
--     suscripción de Presencia Verificada que el §6.3 del contrato define como
--     «se paga aunque no haya listado activo». Apagar un negocio a los 30 días
--     dejaría reseñas colgando de una ficha invisible y contradiría el producto
--     que se le está cobrando. Un profesional es el mismo caso.
--
--   FUERA DE ESTA MIGRACIÓN — Boost.
--     El "Boost" de la lista del cliente NO es una categoría de publicación: es
--     `public.boosts` (0016), que YA vence solo con `ends_at` y su propio cron
--     `expire-finished-boosts`. Tocarlo acá sería construir un segundo
--     vencimiento sobre algo que ya vence. No se toca.
--
-- Y esto NO se hardcodea: `public.listing_expiry_config` lo deja por comunidad y
-- editable desde el panel, igual que 0064 (elegibilidad de creador), 0086
-- (umbrales de integridad) y 0087 (comisión). El pliego lo pide con todas las
-- letras — los números no viven en el código. Una comunidad puede decidir que
-- sus negocios sí caduquen, o que Vivienda dure 45 días, sin un deploy.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 3 — LO QUE SE ESTÁ PAGANDO NO SE APAGA. SE RENUEVA SOLO.
-- -----------------------------------------------------------------------------
-- Un aviso Premium (`listing_premiums`, 0049/0054 → espejado en `listings.tier`)
-- se cobra TODOS LOS MESES. Un aviso impulsado (`boosts`) se pagó por 7, 14 o 30
-- días de visibilidad. Apagarlos por reloj sería cobrar por un aviso que la
-- plataforma escondió — el peor bug posible de este módulo, y de los que
-- terminan en un reembolso y un reclamo.
--
-- Por eso el cron NO los vence: les EXTIENDE el plazo otro ciclo completo. Es
-- deliberadamente auto-sanador. Cuando el pago se cae (`mirror_listing_tier`
-- baja el tier a 'free', o el boost termina), el aviso ya no está exento y
-- arranca una ventana NUEVA y entera, con su aviso previo. Nunca puede pasar que
-- alguien deje de pagar el lunes y su aviso desaparezca el martes por un
-- `expires_at` que quedó viejo mientras estaba exento.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 4 — LAS DOS FECHAS SE CALCULAN AL PUBLICAR, NO AL VENCER
-- -----------------------------------------------------------------------------
-- `expires_at` y `expiry_warn_at` se escriben en el momento en que el aviso pasa
-- a `published` (trigger) y cada vez que se renueva. El cron sólo compara
-- `columna <= now()`.
--
-- Es lo que permite que las dos consultas nocturnas sean un RANGE SCAN sobre un
-- índice parcial diminuto en vez de un scan de toda la tabla con un join a la
-- configuración de cada tenant para resolver "¿cuántos días le tocan a éste?".
-- Con 8 kinds, N comunidades y configuración editable, esa segunda forma es un
-- seq scan garantizado el día que la tabla crezca.
--
-- Consecuencia (buscada): cambiar la configuración rige para lo que se publica o
-- se renueva DESPUÉS, no reescribe los plazos ya prometidos. Es la misma
-- doctrina que `gig_contracts.fee_pct` en 0087 — «rige para los contratos
-- NUEVOS; los ya creados guardan el suyo y no se recalculan jamás».
--
-- -----------------------------------------------------------------------------
-- DECISIÓN 5 — RENOVAR NO ES VOLVER A PUBLICAR
-- -----------------------------------------------------------------------------
-- `public.renovar_publicacion()` NO toca `published_at`. Un aviso renovado
-- vuelve a ser visible en el lugar cronológico que le corresponde; no salta al
-- tope del listado.
--
-- Es a propósito y es importante: si renovar bumpeara, sería un impulso gratis e
-- infinito, competiría de frente con `boosts` (que es un producto PAGO) y el
-- primer vivo que renueve cada 29 días tendría el aviso arriba para siempre. El
-- plazo se compra con un click; la posición se compra con un boost.
--
-- Tampoco se puede renovar en cualquier momento: la función exige que el aviso
-- ESTÉ POR VENCER (dentro de la ventana de aviso) o que YA HAYA VENCIDO. Es
-- literalmente lo que pidió el cliente («cuando se esta llegando a los 30 dias»)
-- y evita que "renovar" se convierta en un botón que la gente aprieta sin
-- sentido para acumular meses.
--
-- -----------------------------------------------------------------------------
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- -----------------------------------------------------------------------------
--   · No toca `posts` (el feed social). El pedido enumera categorías de
--     PUBLICACIÓN (Vivienda, Eventos, Negocios, Profesionales, Empleos,
--     Marketplace, Influencers, Comunidad); una publicación del feed no es un
--     aviso clasificado y hacerla desaparecer a los 30 días convertiría el feed
--     en un chat. Si se quiere, es otra decisión y otra migración.
--   · No borra nada, nunca. Ver la Decisión 1.
--   · No agrega una policy nueva a `listings` ni relaja las que hay. Vencer lo
--     hace el cron (postgres, bypassa RLS) y renovar lo hace una función
--     `security definer` que verifica dueño + tenant adentro. El WITH CHECK de
--     `listings_update` —que le prohíbe al dueño dejar un aviso en `published`
--     al editarlo, el anti bait-and-switch de 0004— queda intacto, y de yapa
--     hace que un dueño no pueda auto-otorgarse el estado `expired` ni salir de
--     él por su cuenta.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Configuración por comunidad
-- ---------------------------------------------------------------------------
-- LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS de `app.listing_expiry_config()`
-- (criterio de 0045, 0063, 0064, 0086 y 0087): un tenant nuevo no depende de que
-- alguien se acuerde de sembrarle la configuración para que sus avisos venzan.
create table if not exists public.listing_expiry_config (
  tenant_id            uuid primary key references public.tenants(id),

  -- Los 30 días del pedido. Configurable porque «30» es una decisión comercial
  -- de cada comunidad, no una constante de la naturaleza.
  dias_de_vigencia     int not null default 30
                         check (dias_de_vigencia between 1 and 365),

  -- Cuántos días ANTES se avisa. 3 es el default: suficiente para que alguien
  -- que entra un par de veces por semana lo vea, y no tanto como para que el
  -- aviso llegue cuando todavía no importa y se ignore.
  dias_de_aviso        int not null default 3
                         check (dias_de_aviso between 1 and 60),

  -- null = sin tope. Es el default a propósito: poner un tope por defecto
  -- significaría que un aviso legítimo y vigente muere en silencio a la N-ésima
  -- renovación, y la persona no tendría forma de entender por qué el botón dejó
  -- de funcionar. Si una comunidad quiere limitarlo, lo pone y lo comunica.
  renovaciones_maximas int check (renovaciones_maximas is null or renovaciones_maximas >= 0),

  -- QUÉ vence. Ver la Decisión 2 de la cabecera: business y professional NO
  -- están, porque son presencia y no avisos.
  kinds_que_vencen     text[] not null
                         default array['property','event','job','product','creator_gig','lost_found'],

  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Avisar el mismo día que vence (o después) es no avisar. El CHECK lo impide
  -- desde la base: es la clase de configuración que se rompe sin que nada falle.
  constraint listing_expiry_config_aviso_antes_del_vencimiento
    check (dias_de_aviso < dias_de_vigencia),

  -- El array sólo puede contener kinds que existan. Sin esto, un typo en el
  -- panel ('propiedad' en vez de 'property') apaga el vencimiento de una
  -- categoría entera y no falla nada: los avisos simplemente no vencerían nunca.
  constraint listing_expiry_config_kinds_validos
    check (kinds_que_vencen <@ array[
      'property','business','professional','event','job',
      'product','creator_gig','lost_found'
    ]::text[])
);

comment on table public.listing_expiry_config is
  'Vencimiento de publicaciones por comunidad (0098): cuántos días dura un aviso, con cuántos de anticipación se avisa, cuántas veces se puede renovar y QUÉ categorías vencen. Editable desde el panel — el pliego pide que los números no vivan en el código, igual que creator_eligibility_config (0064), content_integrity_settings (0086) y creator_commission_config (0087). LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS de app.listing_expiry_config(). Los cambios rigen para lo que se publique o renueve DESPUÉS: los plazos ya prometidos no se recalculan (doctrina de gig_contracts.fee_pct, 0087).';

comment on column public.listing_expiry_config.dias_de_vigencia is
  'Días que un aviso permanece publicado antes de vencer. Default 30 = el pedido textual del cliente. Se aplica al publicar y al renovar, nunca retroactivamente.';
comment on column public.listing_expiry_config.dias_de_aviso is
  'Con cuánta anticipación se notifica "tu publicación vence pronto". Default 3. El CHECK exige que sea menor que dias_de_vigencia: avisar el mismo día del vencimiento es no avisar.';
comment on column public.listing_expiry_config.renovaciones_maximas is
  'Tope de renovaciones por aviso. null = sin tope, y es el default a propósito: un tope por defecto mataría avisos legítimos en silencio. Rige al momento de renovar; subirlo o bajarlo no reescribe el renewal_count de nadie.';
comment on column public.listing_expiry_config.kinds_que_vencen is
  'Qué categorías caducan. Por default los seis que son AVISOS (algo que se acaba: se alquila, se cubre, se vende, aparece). business y professional quedan afuera porque son PRESENCIA —horarios, reseñas y suscripción de Presencia Verificada, que el §6.3 define como "se paga aunque no haya listado activo"—. Una comunidad puede sumarlos si quiere; es una decisión suya, no un default que le imponemos.';
comment on column public.listing_expiry_config.updated_by is
  'Quién cambió las reglas por última vez. Acortar la vigencia de toda una comunidad es una decisión con consecuencias para gente que pagó; tiene que tener nombre.';

create index if not exists listing_expiry_config_updated_by_idx
  on public.listing_expiry_config (updated_by);

drop trigger if exists listing_expiry_config_set_updated_at on public.listing_expiry_config;
create trigger listing_expiry_config_set_updated_at
before update on public.listing_expiry_config
for each row execute function extensions.moddatetime(updated_at);

alter table public.listing_expiry_config enable row level security;
alter table public.listing_expiry_config force row level security;

-- Las CUATRO policies canónicas, ni una más (gate `npm run check:rls`).

-- Cualquier miembro del tenant LEE las reglas: la pantalla de "Mis
-- publicaciones" necesita poder decir "vence en 30 días y podés renovarlo" con
-- el número REAL de esta comunidad. Son reglas del muro, no datos de personas
-- (mismo criterio que 0064 y 0086).
drop policy if exists listing_expiry_config_select on public.listing_expiry_config;
create policy listing_expiry_config_select on public.listing_expiry_config
for select to authenticated
using (tenant_id = (select app.current_tenant_id()));

-- Escribe SOLO administración del dominio. No alcanza con ser staff: un
-- `moderator` resuelve casos; poner en 1 la vigencia de toda la comunidad
-- vaciaría el sitio en una noche.
drop policy if exists listing_expiry_config_insert on public.listing_expiry_config;
create policy listing_expiry_config_insert on public.listing_expiry_config
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

drop policy if exists listing_expiry_config_update on public.listing_expiry_config;
create policy listing_expiry_config_update on public.listing_expiry_config
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- Borrar la fila volvería a los defaults en silencio. Se edita, no se borra.
drop policy if exists listing_expiry_config_delete on public.listing_expiry_config;
create policy listing_expiry_config_delete on public.listing_expiry_config
for delete to authenticated
using (false);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre: los default privileges
-- de este schema no incluyen a `anon`, y una tabla nueva nace sin acceso. Sin
-- GRANT, Postgres ni evalúa la policy: la pantalla se ve vacía y sin un error.
revoke all on table public.listing_expiry_config from anon, authenticated;
grant select, insert, update on table public.listing_expiry_config to authenticated;
grant all                    on table public.listing_expiry_config to service_role;

-- Fila materializada para cada tenant existente: no hace falta para funcionar
-- (la lectura tiene defaults), pero hace que el panel muestre valores editables
-- desde el primer día en vez de campos vacíos que el admin no sabe si aplican.
insert into public.listing_expiry_config (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Lectura de la configuración, con defaults
-- ---------------------------------------------------------------------------
-- ⚠️ DESVÍO CONSCIENTE DE 0086: acá es SECURITY DEFINER, no invoker.
--
-- En 0086 el argumento para invoker es bueno y sigue siendo bueno PARA ESA
-- TABLA: si un tenant ajeno "no tiene fila", devolver defaults no filtra nada.
-- Acá ese mismo comportamiento es un BUG SILENCIOSO: quien lee esta función es
-- un TRIGGER que corre bajo el rol de quien escribe (el dueño renovando, el
-- admin client publicando, pg_cron de noche). Si la RLS le escondiera la fila a
-- alguno de esos caminos, el aviso recibiría 30 días cuando la comunidad
-- configuró 60 — y nadie se enteraría nunca, porque no falla nada.
--
-- El riesgo del otro lado es nulo: lo que devuelve son las reglas del muro
-- ("30 días, aviso a 3, vencen estos kinds"), que la app le muestra a cualquier
-- miembro igual. No hay dato de ninguna persona acá.
--
-- ⚠️ El row() depende del ORDEN de las columnas de la tabla. Si se agrega una,
-- hay que agregarla acá también (misma trampa que 0064 y 0086).
create or replace function app.listing_expiry_config(p_tenant uuid)
returns public.listing_expiry_config
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.listing_expiry_config;
begin
  select * into v_cfg
    from public.listing_expiry_config
   where tenant_id = p_tenant;

  if found then
    return v_cfg;
  end if;

  return row(
    p_tenant,
    30,
    3,
    null::int,
    array['property','event','job','product','creator_gig','lost_found']::text[],
    null::uuid,
    '-infinity'::timestamptz,
    '-infinity'::timestamptz
  )::public.listing_expiry_config;
end;
$$;

comment on function app.listing_expiry_config(uuid) is
  'Reglas de vencimiento de un tenant, o los defaults si nunca se configuró. Existe para que "no hay fila" y "hay fila" no sean dos caminos distintos en quien la consulta. SECURITY DEFINER a propósito (desvío de 0086, explicado en 0098): la consulta un trigger que corre bajo cualquier rol, y una lectura que falla a los defaults por RLS le daría al aviso un plazo distinto del configurado sin que falle nada.';

revoke all    on function app.listing_expiry_config(uuid) from public, anon;
grant execute on function app.listing_expiry_config(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Las columnas del vencimiento en `listings`
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists expires_at       timestamptz,
  add column if not exists expiry_warn_at   timestamptz,
  add column if not exists expiry_warned_at timestamptz,
  add column if not exists expired_at       timestamptz,
  add column if not exists renewal_count    int not null default 0,
  add column if not exists renewed_at       timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.listings'::regclass
       and conname  = 'listings_renewal_count_check'
  ) then
    alter table public.listings
      add constraint listings_renewal_count_check check (renewal_count >= 0);
  end if;
end;
$$;

comment on column public.listings.expires_at is
  'Cuándo deja de mostrarse este aviso. NULL = no vence (kind fuera de kinds_que_vencen del tenant, o aviso que nunca llegó a publicarse). Se calcula al publicar y al renovar, NUNCA retroactivamente: cambiar la configuración no reescribe plazos ya prometidos (0098).';
comment on column public.listings.expiry_warn_at is
  'Cuándo hay que avisarle al dueño que se le vence. Es una columna y no un cálculo en la query del cron a propósito: así el job nocturno es un range scan sobre listings_expiry_warn_idx en vez de un scan completo con join a la configuración de cada tenant.';
comment on column public.listings.expiry_warned_at is
  'Cuándo se emitió el aviso previo. Es LA garantía de idempotencia del cron: si corre dos veces la misma noche, la segunda no encuentra filas y nadie recibe dos notificaciones. Se limpia al renovar, porque el ciclo nuevo merece su propio aviso.';
comment on column public.listings.expired_at is
  'Cuándo venció efectivamente. Distinto de expires_at (que es la fecha PROMETIDA): si el cron corrió tarde, o si el aviso estuvo exento por estar pago, las dos fechas no coinciden y la que cuenta para explicarle algo a alguien es ésta.';
comment on column public.listings.renewal_count is
  'Cuántas veces se renovó. Lo escribe SOLO public.renovar_publicacion(); app.protect_listing_counters() lo protege del dueño — si no, resetearlo a 0 desde una edición cualquiera saltearía el tope de renovaciones de la comunidad.';
comment on column public.listings.renewed_at is
  'Última renovación. Es lo que le permite a la pantalla decir "renovado hace 3 días" en vez de sólo un contador sin contexto.';

-- ---------------------------------------------------------------------------
-- 4. status += 'expired'
-- ---------------------------------------------------------------------------
-- Se busca la constraint por su DEFINICIÓN y no por su nombre: es el mismo
-- do-block que usaron 0024 y 0096 para `kind`, por el mismo motivo (una
-- constraint creada anónima en 0004 y rebautizada después no se puede asumir).
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.listings'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) like '%status = ANY%';
  if v_name is not null then
    execute format('alter table public.listings drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.listings
  add constraint listings_status_check
  check (status in (
    'draft', 'pending_review', 'published', 'paused', 'removed', 'expired'
  ));

comment on column public.listings.status is
  'draft → pending_review → published; paused (lo bajó el dueño), removed (lo bajó moderación) y expired (se cumplió el plazo, 0098). expired es un estado propio y no un `paused` reutilizado porque el usuario tiene que poder distinguir "lo pausé yo" de "se me venció": son dos avisos distintos y dos botones distintos. Ningún JWT de usuario puede escribir ni salir de expired — el WITH CHECK de listings_update no lo admite; entra el cron y sale public.renovar_publicacion().';

-- ---------------------------------------------------------------------------
-- 5. Los índices que hacen que el cron no escanee la tabla
-- ---------------------------------------------------------------------------
-- Los dos jobs nocturnos son, exactamente, "dame las filas cuya fecha X ya pasó".
-- Con estos índices parciales eso es un range scan que toca sólo las filas que
-- van a cambiar; sin ellos, cada noche se leen TODOS los avisos publicados de
-- todas las comunidades para descartar el 99%.
--
-- Los predicados están calcados de las cláusulas WHERE de las funciones de la
-- sección 7: si alguien cambia una, tiene que cambiar el índice en el mismo
-- commit o el plan se cae a seq scan sin que nada falle.

-- Cron de vencimiento: status='published' and expires_at <= now()
create index if not exists listings_expiry_due_idx
  on public.listings (expires_at)
  where status = 'published' and expires_at is not null;

-- Cron de aviso previo: status='published' and expiry_warned_at is null
--                       and expiry_warn_at <= now()
-- `expiry_warned_at is null` en el predicado hace que el índice se VACÍE solo:
-- una fila ya avisada sale del índice y no se vuelve a mirar nunca.
create index if not exists listings_expiry_warn_idx
  on public.listings (expiry_warn_at)
  where status = 'published' and expiry_warned_at is null and expiry_warn_at is not null;

-- Pantalla "Mis publicaciones": los vencidos del dueño, primero los más
-- recientes. `listings_tenant_owner_idx` (0004) ya cubre "todo lo mío", pero la
-- lista de recuperación filtra por status y ordena por fecha de vencimiento.
create index if not exists listings_expired_owner_idx
  on public.listings (tenant_id, created_by, expired_at desc)
  where status = 'expired';

-- ---------------------------------------------------------------------------
-- 6. Cálculo de las dos fechas — una sola definición para todo el sistema
-- ---------------------------------------------------------------------------
create or replace function app.listing_expiry_dates(
  p_tenant  uuid,
  p_kind    text,
  p_desde   timestamptz default now(),
  out expires_at     timestamptz,
  out expiry_warn_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.listing_expiry_config;
begin
  v_cfg := app.listing_expiry_config(p_tenant);

  -- El kind no vence en esta comunidad: las dos fechas quedan NULL y ni el cron
  -- de aviso ni el de vencimiento van a ver nunca esta fila (los dos índices
  -- parciales exigen `is not null`).
  if not (p_kind = any (v_cfg.kinds_que_vencen)) then
    expires_at     := null;
    expiry_warn_at := null;
    return;
  end if;

  expires_at     := p_desde + make_interval(days => v_cfg.dias_de_vigencia);
  expiry_warn_at := expires_at - make_interval(days => v_cfg.dias_de_aviso);
end;
$$;

comment on function app.listing_expiry_dates(uuid, text, timestamptz) is
  'Las dos fechas del ciclo (vencimiento y aviso previo) para un aviso de un tenant y un kind. Una sola definición: la usan el trigger que publica, la función que renueva y el cron que extiende lo pago. Devuelve (null, null) cuando el kind no vence en esa comunidad — que es lo que saca la fila de los dos índices parciales del cron.';

revoke all    on function app.listing_expiry_dates(uuid, text, timestamptz) from public, anon;
grant execute on function app.listing_expiry_dates(uuid, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. El trigger: publicar arranca el reloj
-- ---------------------------------------------------------------------------
-- Se dispara SÓLO en la transición a `published`, venga de donde venga: el
-- admin client que publica tras moderar (que es como publican TODOS los módulos
-- de este repo: ver finalizeLostFoundCase y sus gemelas), un seed, o un staff
-- desde el panel. No hay un camino de publicación que pueda olvidarse de setear
-- el plazo, porque el plazo no lo setea el que publica.
create or replace function app.listings_set_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
  v_warn    timestamptz;
begin
  if new.status is distinct from 'published' then
    return new;
  end if;

  -- En UPDATE, sólo la TRANSICIÓN. Un aviso que ya estaba publicado y recibe
  -- cualquier otro update (contador de vistas, espejo de tier, moderación) no
  -- puede reiniciar su reloj: si lo hiciera, un aviso muy visto no vencería
  -- jamás.
  if tg_op = 'UPDATE' and old.status is not distinct from 'published' then
    return new;
  end if;

  select d.expires_at, d.expiry_warn_at
    into v_expires, v_warn
    from app.listing_expiry_dates(new.tenant_id, new.kind) d;

  new.expires_at       := v_expires;
  new.expiry_warn_at   := v_warn;
  new.expiry_warned_at := null;  -- ciclo nuevo, aviso nuevo
  new.expired_at       := null;

  return new;
end;
$$;

comment on function app.listings_set_expiry() is
  'Arranca el reloj de vencimiento cuando un aviso pasa a published (0098). Sólo en la transición: un update cualquiera sobre un aviso ya publicado no reinicia el plazo, o un aviso con mucho tráfico no vencería nunca.';

drop trigger if exists listings_set_expiry on public.listings;
create trigger listings_set_expiry
before insert or update on public.listings
for each row execute function app.listings_set_expiry();

-- ---------------------------------------------------------------------------
-- 8. Protección de columnas: el dueño no escribe su propio vencimiento
-- ---------------------------------------------------------------------------
-- Se EXTIENDE `app.protect_listing_counters()` (0004/0048) en vez de agregar un
-- trigger nuevo, para que la lista de columnas que el cliente no puede tocar
-- viva en un solo lugar.
--
-- POR QUÉ HACE FALTA, si el WITH CHECK de `listings_update` ya impide que el
-- dueño conserve `published` al editar: porque el dueño SÍ puede editar un aviso
-- pausado, y en esa misma sentencia podría poner `renewal_count = 0` y saltearse
-- el tope de renovaciones de la comunidad. El resto de las columnas se protegen
-- por coherencia: un `expires_at` forjado es inerte hoy (para volver a publicar
-- hay que pasar por el trigger o por renovar, y los dos recalculan), pero
-- depender de eso es depender de que nadie relaje la policy en el futuro.
--
-- LA PUERTA LEGÍTIMA es la bandera transaccional `app.renovando_publicacion`,
-- que enciende y apaga `public.renovar_publicacion()`. Es `set_config(..., true)`
-- = LOCAL a la transacción: no sobrevive al statement de PostgREST, así que
-- nadie puede dejarla prendida para el resto de la sesión.
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renovando boolean :=
    coalesce(current_setting('app.renovando_publicacion', true), 'off') = 'on';
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

  -- ---- Vencimiento (0098). La única puerta desde un JWT de usuario es
  -- public.renovar_publicacion(), que enciende la bandera transaccional.
  if not v_renovando then
    if new.renewal_count is distinct from old.renewal_count then
      raise exception 'PROTECTED_COLUMNS: renewal_count solo lo escribe public.renovar_publicacion() — resetearlo saltearía el tope de renovaciones de la comunidad';
    end if;
    if new.expires_at is distinct from old.expires_at
       or new.expiry_warn_at is distinct from old.expiry_warn_at
       or new.expiry_warned_at is distinct from old.expiry_warned_at
       or new.expired_at is distinct from old.expired_at
       or new.renewed_at is distinct from old.renewed_at then
      raise exception 'PROTECTED_COLUMNS: las fechas de vencimiento las escriben el trigger de publicación, el cron y public.renovar_publicacion(); nunca el dueño del aviso';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Renovar — la respuesta a «dar la opcion de seguir la publicacion activa»
-- ---------------------------------------------------------------------------
-- Devuelve jsonb y no boolean porque los motivos de rechazo son distintos entre
-- sí y la pantalla tiene que poder decir cuál fue: "todavía no se puede" no es
-- lo mismo que "llegaste al tope" ni que "este tipo de aviso no vence". Un
-- boolean obligaría a la app a adivinar y a mostrar un error genérico.
--
-- SECURITY DEFINER con el chequeo de propiedad ADENTRO (dueño + tenant), igual
-- que public.marcar_caso_resuelto (0096): quien puentee la app y llame a esto
-- desde PostgREST con su token se topa con las mismas reglas.
create or replace function public.renovar_publicacion(p_listing uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := app.current_tenant_id();
  v_cfg     public.listing_expiry_config;
  v_row     public.listings;
  v_expires timestamptz;
  v_warn    timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para renovar una publicación.';
  end if;

  -- La propiedad se verifica acá y no con la RLS: la función es definer.
  select * into v_row
    from public.listings
   where id         = p_listing
     and tenant_id  = v_tenant
     and created_by = v_uid;

  -- No se distingue "no existe" de "no es tuyo": confirmarle a alguien que un
  -- aviso ajeno existe ya es información (criterio de 0096).
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;

  if v_row.status not in ('published', 'expired') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'status', v_row.status);
  end if;

  v_cfg := app.listing_expiry_config(v_tenant);

  if not (v_row.kind = any (v_cfg.kinds_que_vencen)) then
    return jsonb_build_object('ok', false, 'motivo', 'no_vence');
  end if;

  if v_cfg.renovaciones_maximas is not null
     and v_row.renewal_count >= v_cfg.renovaciones_maximas then
    return jsonb_build_object(
      'ok', false, 'motivo', 'tope_alcanzado',
      'renovaciones_maximas', v_cfg.renovaciones_maximas
    );
  end if;

  -- Todavía falta mucho: no se renueva. Ver la Decisión 5 de la cabecera — sin
  -- esta puerta, "renovar" es un botón para acumular meses el día 1.
  if v_row.status = 'published'
     and (v_row.expiry_warn_at is null or v_row.expiry_warn_at > now()) then
    return jsonb_build_object(
      'ok', false, 'motivo', 'todavia_no',
      'expires_at', v_row.expires_at,
      'renovable_desde', v_row.expiry_warn_at
    );
  end if;

  select d.expires_at, d.expiry_warn_at
    into v_expires, v_warn
    from app.listing_expiry_dates(v_tenant, v_row.kind) d;

  -- Bandera LOCAL a la transacción: es lo único que le permite a un JWT de
  -- usuario mover las columnas de vencimiento, y se apaga sola al terminar.
  perform set_config('app.renovando_publicacion', 'on', true);

  update public.listings
     set status           = 'published',
         expires_at       = v_expires,
         expiry_warn_at   = v_warn,
         expiry_warned_at = null,
         expired_at       = null,
         renewal_count    = renewal_count + 1,
         renewed_at       = now()
   where id        = p_listing
     and tenant_id = v_tenant;

  perform set_config('app.renovando_publicacion', 'off', true);

  -- `published_at` NO se toca: renovar devuelve el plazo, no la posición. Ver la
  -- Decisión 5 — bumpear sería un boost gratis e infinito.
  return jsonb_build_object(
    'ok', true,
    'expires_at', v_expires,
    'renewal_count', v_row.renewal_count + 1,
    'dias_de_vigencia', v_cfg.dias_de_vigencia
  );
end;
$$;

comment on function public.renovar_publicacion(uuid) is
  'Renueva una publicación propia por otro ciclo completo (0098): reinicia expires_at, limpia el aviso previo y, si estaba vencida, la devuelve a published. NO toca published_at — renovar da plazo, no posición (bumpear sería un boost gratis e infinito, y boosts es un producto pago). Sólo dentro de la ventana de aviso o ya vencida, que es literalmente lo que pidió el cliente. Devuelve jsonb con el motivo cuando no se puede: la pantalla necesita distinguir "todavía no" de "llegaste al tope".';

revoke all    on function public.renovar_publicacion(uuid) from public, anon;
grant execute on function public.renovar_publicacion(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. El aviso previo
-- ---------------------------------------------------------------------------
-- IDEMPOTENCIA: la marca `expiry_warned_at` se escribe en la MISMA sentencia que
-- lee las filas. Si el job corre dos veces (reintento, doble agendado, alguien
-- que lo ejecuta a mano para probar), la segunda corrida no encuentra nada: las
-- filas ya salieron del índice parcial. Nadie recibe dos notificaciones.
create or replace function app.avisar_vencimientos(p_lote int default 5000)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_avisadas int;
begin
  with por_vencer as (
    select l.id
      from public.listings l
     where l.status           = 'published'
       and l.expiry_warned_at is null
       and l.expiry_warn_at   is not null
       and l.expiry_warn_at  <= now()
       -- Ya vencida: no se avisa "va a vencer" de algo que vence hoy mismo; de
       -- eso se encarga app.vencer_publicaciones() con su propio aviso.
       and l.expires_at       > now()
     order by l.expiry_warn_at
     limit p_lote
  ),
  marcadas as (
    update public.listings l
       set expiry_warned_at = now()
      from por_vencer p
     where l.id = p.id
    returning l.id, l.tenant_id, l.created_by, l.title, l.expires_at
  )
  insert into public.notifications (
    tenant_id, profile_id, kind, title, body, href, category, priority
  )
  select
    m.tenant_id,
    m.created_by,
    'listing_expiring',
    'Tu publicación vence pronto',
    left(m.title, 80)
      || ' deja de mostrarse en '
      || greatest(1, ceil(extract(epoch from (m.expires_at - now())) / 86400))::int
      || case
           when greatest(1, ceil(extract(epoch from (m.expires_at - now())) / 86400))::int = 1
           then ' día. Renovala y sigue activa.'
           else ' días. Renovala y sigue activa.'
         end,
    '/publicaciones',
    'vencimientos',
    'high'
    from marcadas m
   where m.created_by is not null
     -- Se respeta la preferencia de la persona (0045). Se puede: vencer es
     -- reversible y no destruye nada, así que silenciar el aviso no le cuesta a
     -- nadie el contenido. La ausencia de fila significa TODO PRENDIDO, por eso
     -- esto es un NOT EXISTS y no un join.
     and not exists (
       select 1
         from public.notification_prefs np
        where np.profile_id = m.created_by
          and np.category   = 'vencimientos'
          and (np.in_app = false or np.frequency = 'off')
     );

  get diagnostics v_avisadas = row_count;
  return v_avisadas;
end;
$$;

comment on function app.avisar_vencimientos(int) is
  'Aviso previo de vencimiento (0098): notifica a los dueños de los avisos que entran en la ventana de aviso de su comunidad y los marca con expiry_warned_at en la MISMA sentencia. Esa marca es la garantía de idempotencia: una segunda corrida no encuentra las filas porque ya salieron del índice parcial. Devuelve cuántas notificaciones emitió (puede ser menor que las filas marcadas: no se notifica a avisos sin dueño ni a quien silenció la categoría).';

-- ---------------------------------------------------------------------------
-- 11. El vencimiento
-- ---------------------------------------------------------------------------
-- Dos caminos, y el primero es el importante:
--
--  (a) EXENTOS — Premium vigente o impulso activo. NO se vencen: se les extiende
--      el plazo un ciclo entero. Ver la Decisión 3 de la cabecera. Es lo que
--      hace que el sistema se auto-sane: cuando el pago se corta, el aviso
--      arranca una ventana nueva y completa en vez de morir esa misma noche por
--      un expires_at que quedó viejo mientras estaba pago.
--  (b) EL RESTO — pasa a 'expired' y se avisa.
--
-- IDEMPOTENCIA: los dos updates tienen `status = 'published'` en el WHERE, y (b)
-- lo saca de ahí. Correr el job dos veces no vence nada dos veces ni emite dos
-- notificaciones. (a) es idempotente por otro motivo: recalcular la fecha de
-- algo que sigue pago da el mismo resultado y no notifica a nadie.
create or replace function app.vencer_publicaciones(p_lote int default 5000)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_vencidas int;
begin
  -- (a) Lo pago no se apaga: se le extiende el ciclo.
  --
  -- ⚠️ El cálculo va en una SUBCONSULTA con LATERAL y no directo en el FROM del
  -- UPDATE: Postgres no deja referenciar la tabla que se está actualizando desde
  -- los argumentos de una función del from_list ("invalid reference to
  -- FROM-clause entry"). El join por id es la forma canónica de rodearlo.
  update public.listings l
     set expires_at       = d.expires_at,
         expiry_warn_at   = d.expiry_warn_at,
         expiry_warned_at = null
    from (
      select x.id, f.expires_at, f.expiry_warn_at
        from public.listings x
        cross join lateral app.listing_expiry_dates(x.tenant_id, x.kind) f
       where x.status      = 'published'
         and x.expires_at is not null
         and x.expires_at <= now()
         and (
           x.tier = 'premium'
           or exists (
             select 1
               from public.boosts b
              where b.listing_id = x.id
                and b.status     = 'active'
                and b.ends_at    > now()
           )
         )
    ) d
   where l.id = d.id;

  -- (b) El resto vence.
  with vencibles as (
    select l.id
      from public.listings l
     where l.status      = 'published'
       and l.expires_at is not null
       and l.expires_at <= now()
     order by l.expires_at
     limit p_lote
  ),
  vencidas as (
    update public.listings l
       set status     = 'expired',
           expired_at = now()
      from vencibles v
     where l.id = v.id
    returning l.id, l.tenant_id, l.created_by, l.title
  )
  insert into public.notifications (
    tenant_id, profile_id, kind, title, body, href, category, priority
  )
  select
    v.tenant_id,
    v.created_by,
    'listing_expired',
    'Tu publicación dejó de mostrarse',
    left(v.title, 80)
      || ' cumplió su tiempo en la comunidad. No se borró nada: renovala y vuelve a estar visible.',
    '/publicaciones',
    'vencimientos',
    'normal'
    from vencidas v
   where v.created_by is not null
     and not exists (
       select 1
         from public.notification_prefs np
        where np.profile_id = v.created_by
          and np.category   = 'vencimientos'
          and (np.in_app = false
               or np.frequency = 'off'
               -- 'important' entrega sólo high/critical, y este aviso es normal.
               -- Se espeja shouldDeliverInApp() de src/lib/notifications/prefs.ts.
               or np.frequency = 'important')
     );

  get diagnostics v_vencidas = row_count;
  return v_vencidas;
end;
$$;

comment on function app.vencer_publicaciones(int) is
  'Vencimiento nocturno de publicaciones (0098). Lo que está PAGO (tier premium vigente o boost activo) no se apaga: se le extiende el ciclo, para que cuando el pago se corte el aviso arranque una ventana nueva y completa en vez de morir esa noche. El resto pasa a status=expired —jamás delete: no se pierde ni una foto, ni un comentario, ni una reseña— y su dueño recibe el aviso. Idempotente: los updates exigen status=published y el vencimiento lo saca de ahí.';

-- ---------------------------------------------------------------------------
-- 12. Los dos jobs de pg_cron
-- ---------------------------------------------------------------------------
-- Horarios libres (05:20 y 05:30 UTC): la franja 03:10–05:10 ya está tomada por
-- los 20 jobs de 0013, 0016, 0017, 0023, 0031, 0033, 0036, 0037, 0048, 0054 y
-- 0069. El aviso corre ANTES que el vencimiento por prolijidad; en la práctica
-- nunca se pisan, porque expiry_warn_at es días anterior a expires_at.
--
-- El do-block de unschedule es el patrón de 0013: re-aplicar esta migración
-- sobre una base que ya la tiene no duplica el job.
do $$
begin
  perform cron.unschedule('avisar-vencimiento-de-publicaciones');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'avisar-vencimiento-de-publicaciones',
  '20 5 * * *',
  $cron$select app.avisar_vencimientos()$cron$
);

do $$
begin
  perform cron.unschedule('vencer-publicaciones');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'vencer-publicaciones',
  '30 5 * * *',
  $cron$select app.vencer_publicaciones()$cron$
);

-- ---------------------------------------------------------------------------
-- 13. La categoría de notificación `vencimientos`
-- ---------------------------------------------------------------------------
-- Es una categoría propia y no se reparte en las de cada módulo (propiedades,
-- trabajos, marketplace…) porque el hecho es transversal: la persona tiene un
-- aviso en Vivienda, dos en Marketplace y uno en Empleos, y lo que necesita es
-- UNA pestaña donde estén todos los que se le vencen. Repartirlos obligaría a
-- recorrer cinco pestañas para no perder nada.
--
-- NO se suma al trío intocable (seguridad/pagos/cuenta): vencer es reversible y
-- no destruye contenido, así que silenciarlo es una elección legítima. Si el
-- vencimiento fuera un borrado, esta decisión sería la contraria — otro motivo
-- por el que no lo es.
--
-- Espeja src/lib/notifications/categories.ts (y su test lo verifica leyendo
-- ESTE archivo, igual que hace con 0045).
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) like '%category = ANY%'
  loop
    execute format('alter table public.notifications drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'social', 'mensajes', 'trabajos', 'creator', 'marketplace', 'propiedades',
    'eventos', 'negocios', 'publicidad', 'pagos', 'seguridad', 'cuenta',
    'plataforma', 'vencimientos'
  ));

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.notification_prefs'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) like '%category = ANY%'
  loop
    execute format('alter table public.notification_prefs drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.notification_prefs
  add constraint notification_prefs_category_check
  check (category in (
    'social', 'mensajes', 'trabajos', 'creator', 'marketplace', 'propiedades',
    'eventos', 'negocios', 'publicidad', 'pagos', 'seguridad', 'cuenta',
    'plataforma', 'vencimientos'
  ));

-- ---------------------------------------------------------------------------
-- 14. Backfill: el reloj arranca HOY, no retroactivo
-- ---------------------------------------------------------------------------
-- Los avisos que ya están publicados reciben un ciclo COMPLETO desde el día que
-- esta migración corre, no desde su published_at.
--
-- Calcularlo desde published_at sería técnicamente más "correcto" y sería un
-- desastre: los avisos de más de 30 días vencerían todos esa misma noche, sin
-- aviso previo (su expiry_warn_at ya habría pasado), y la comunidad amanecería
-- vacía sin que nadie hubiera podido apretar "renovar". Nadie aceptó un plazo
-- que todavía no existía cuando publicó.
--
-- El precio es que durante los primeros 30 días no vence nada. Es exactamente el
-- precio correcto.
-- (Mismo LATERAL que en app.vencer_publicaciones: el from_list de un UPDATE no
-- puede referenciar la tabla que se actualiza.)
update public.listings l
   set expires_at     = d.expires_at,
       expiry_warn_at = d.expiry_warn_at
  from (
    select x.id, f.expires_at, f.expiry_warn_at
      from public.listings x
      cross join lateral app.listing_expiry_dates(x.tenant_id, x.kind) f
     where x.status      = 'published'
       and x.expires_at is null
  ) d
 where l.id = d.id;

commit;

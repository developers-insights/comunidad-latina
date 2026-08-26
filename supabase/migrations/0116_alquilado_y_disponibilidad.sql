-- =============================================================================
-- 0116_alquilado_y_disponibilidad.sql — Comunidad Latina
--
-- Las dos reglas de la spec de módulos (§4, «Requisitos para publicar
-- alquileres») que todavía no estaban en la base:
--
--   A. «Deben marcarse como ALQUILADO cuando dejen de estar disponibles.»
--   B. «Deben confirmar nuevamente su DISPONIBILIDAD después de 60 días.»
--
-- La 0098 ya había bajado las otras tres —30 días de vigencia, renovación y
-- vencimiento automático— y esta migración se apoya entera en aquella: no
-- inventa un segundo reloj, le pone una puerta al que ya existe.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A · «ALQUILADO» ES UN ESTADO, NO UNA ETIQUETA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La alternativa era `attrs.rented = true`, que es más barata de escribir y
-- peor en todo lo demás: un aviso alquilado seguiría siendo `status =
-- 'published'`, o sea que seguiría saliendo en el listado, en la búsqueda, en
-- el feed y en las recomendaciones, y habría que acordarse de filtrarlo en cada
-- una de esas superficies. La primera que se olvide manda a alguien a llamar
-- por un cuarto que ya se alquiló.
--
-- Como estado, en cambio, desaparece SOLO de todos lados: cada superficie
-- pública ya filtra `status = 'published'`. Y sigue siendo del dueño, visible
-- en «Mis publicaciones», con su historial intacto.
--
-- ── POR QUÉ NO ALCANZABA `paused` ───────────────────────────────────────────
-- El mismo argumento que la 0098 usó para no reciclar `paused` como `expired`:
-- «lo pausé yo» y «se alquiló» son dos hechos distintos con dos botones
-- distintos y dos futuros distintos. Y para la comunidad importa la diferencia:
-- cuántos alquileres se concretan es el único dato con el que un módulo de
-- vivienda puede demostrar que sirve.
--
-- ── SÓLO PROPIEDADES ────────────────────────────────────────────────────────
-- Un empleo no se «alquila». El CHECK lo impide en la base para que ninguna
-- pantalla futura pueda inventar un empleo alquilado por copiar y pegar.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- B · LOS 60 DÍAS SON UNA PUERTA A LA RENOVACIÓN, NO UN TERCER RELOJ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tentación es un cron que a los 60 días baje el aviso. Se descartó: la 0098
-- YA lo baja a los 30 si nadie lo renueva, así que un segundo cron sobre las
-- mismas filas sería dos mecanismos peleándose por el mismo hecho, con dos
-- notificaciones y dos formas de que el aviso desaparezca.
--
-- Lo que hace esta migración es más chico y más fuerte: `renovar_publicacion()`
-- —el único camino para que un aviso viva más de 30 días— se niega a renovar
-- una PROPIEDAD cuya disponibilidad no se confirmó en los últimos 60 días, y
-- devuelve el motivo `confirma_disponibilidad` para que la pantalla ofrezca el
-- botón correcto en vez de un error.
--
-- La línea de tiempo real queda así:
--
--   día  0  se publica            → `availability_confirmed_at` = ahora
--   día 30  vence                 → renueva (hace 30 días que confirmó: pasa)
--   día 60  vence otra vez        → renovar pide CONFIRMAR primero
--   confirma → renueva → el reloj de los 60 vuelve a cero
--
-- Que es, literal, «deben confirmar nuevamente su disponibilidad después de 60
-- días».
--
-- ── LA CONFIRMACIÓN NO PUEDE SER UN EFECTO SECUNDARIO ───────────────────────
-- Por eso `renovar_publicacion()` NO estampa la columna. Si renovar confirmara,
-- la regla no existiría: bastaría con apretar el mismo botón de siempre. Son
-- dos actos distintos —«dame más plazo» y «sigue disponible»— y el segundo es
-- el único que le sirve a quien está buscando dónde vivir.
--
-- ── POR QUÉ 60 DÍAS ESTÁ EN EL CÓDIGO Y NO EN `listing_expiry_config` ───────
-- La 0098 sacó los plazos al panel porque son política de cada comunidad. Este
-- número no lo es: es la promesa que la app le hace a quien busca alquiler
-- («ningún aviso de más de dos meses sin que alguien diga que sigue en pie»), y
-- una comunidad que lo pusiera en 3650 días no estaría configurando nada,
-- estaría apagando la garantía. Si alguna vez tiene que ser configurable, el
-- lugar es esa tabla y con un techo.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Las columnas
-- ---------------------------------------------------------------------------

alter table public.listings
  add column if not exists rented_at timestamptz,
  add column if not exists availability_confirmed_at timestamptz;

comment on column public.listings.rented_at is
  'Cuándo se marcó el aviso como alquilado (0116). Lo estampa el trigger app.listings_stamp_rented al entrar en status = rented y lo limpia al salir — el dueño nunca escribe esta columna. Sirve para medir cuántos alquileres se concretan, que es el único dato con el que el módulo puede demostrar que funciona.';

comment on column public.listings.availability_confirmed_at is
  'Última vez que el anunciante confirmó que la propiedad SIGUE disponible (0116, spec §4: «deben confirmar nuevamente su disponibilidad después de 60 días»). Se estampa en la primera publicación y después SÓLO por public.confirmar_disponibilidad(). Renovar NO la toca a propósito: si renovar confirmara, la regla de los 60 días no existiría. Null en avisos que no son propiedades y en los publicados antes de esta migración (ver la nota de retrocompatibilidad).';

-- RETROCOMPATIBILIDAD. Los avisos de propiedad ya publicados no tienen fecha de
-- confirmación, y `null` significaría "hace infinito" — o sea que el próximo
-- intento de renovar los frenaría a todos de golpe, incluidos los que se
-- publicaron ayer. Se los siembra con su `published_at` (o su `created_at`, para
-- los que no tienen), que es la verdad: el día que se publicó, alguien dijo que
-- estaba disponible.
update public.listings
   set availability_confirmed_at = coalesce(published_at, created_at)
 where kind = 'property'
   and availability_confirmed_at is null;

-- ---------------------------------------------------------------------------
-- 2. El estado `rented` en el CHECK
-- ---------------------------------------------------------------------------
-- El do-block que busca el constraint por su definición es el patrón de la 0098:
-- el nombre puede haber cambiado entre entornos, la forma no.

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
    'draft', 'pending_review', 'published', 'paused', 'removed', 'expired', 'rented'
  ));

comment on column public.listings.status is
  'draft → pending_review → published; paused (lo bajó el dueño), removed (lo bajó moderación), expired (se cumplió el plazo, 0098) y rented (se alquiló, 0116). Los cuatro finales son estados PROPIOS y no un paused reutilizado porque la persona tiene que poder distinguir "lo pausé yo" de "se me venció" y de "se alquiló": son tres avisos distintos y tres botones distintos. expired no lo escribe ningún JWT de usuario (entra el cron, sale renovar_publicacion); rented sí lo escribe el dueño, que es el único que sabe que alquiló.';

-- Un empleo no se alquila. La regla vive en la base y no en la pantalla para
-- que ninguna copia futura pueda inventarla.
alter table public.listings
  drop constraint if exists listings_rented_solo_propiedades;
alter table public.listings
  add constraint listings_rented_solo_propiedades
  check (status <> 'rented' or kind = 'property');

-- ---------------------------------------------------------------------------
-- 3. El dueño puede marcar ALQUILADO — y sólo eso cambia en la policy
-- ---------------------------------------------------------------------------
-- `listings_update` sigue igual salvo por el estado nuevo en la lista de los que
-- un dueño puede escribir. Sigue SIN poder escribir `published` (eso lo decide
-- moderación) ni `expired` (eso lo decide el cron): marcar alquilado es lo único
-- que se agrega, porque es lo único que sólo él sabe.
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (created_by = (select auth.uid()) or (select app.is_staff()))
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (
        created_by = (select auth.uid())
        and source = 'user'
        and status in ('draft', 'pending_review', 'paused', 'removed', 'rented')
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy listings_update on public.listings is
  'Base de 0004/0050 SIN cambios, más el estado `rented` en la lista de los que el dueño puede escribir (0116). El dueño sigue sin poder ponerse `published` (lo decide moderación) ni `expired` (lo decide el cron de 0098): "se alquiló" es el único hecho que sólo él conoce. `source = user` sigue cerrando la puerta a que alguien edite un aviso importado.';

-- ---------------------------------------------------------------------------
-- 4. `rented_at` lo estampa un trigger, no el dueño
-- ---------------------------------------------------------------------------
-- Misma doctrina que las fechas de vencimiento (0098): una fecha que el cliente
-- puede escribir es una fecha que puede mentir, y acá esa fecha es la métrica de
-- cuántos alquileres se concretan.

create or replace function app.listings_stamp_rented()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.rented_at := case when new.status = 'rented' then now() else null end;
    return new;
  end if;

  if new.status = 'rented' and old.status is distinct from 'rented' then
    new.rented_at := now();
  elsif new.status is distinct from 'rented' and old.status = 'rented' then
    -- Vuelve a estar disponible (el inquilino se cayó, se relista): la marca se
    -- borra. Dejarla puesta haría que un aviso vivo figure como alquilado en
    -- cualquier conteo que mire la columna en vez del estado.
    new.rented_at := null;
  else
    -- Cualquier otro update NO puede tocarla, venga de donde venga. Es la misma
    -- guarda que `protect_listing_counters` aplica a los contadores, resuelta
    -- acá porque el valor correcto se deriva del estado y no hay nada que
    -- validar: se pisa y listo.
    new.rented_at := old.rented_at;
  end if;

  return new;
end;
$$;

comment on function app.listings_stamp_rented() is
  'Deriva listings.rented_at del estado (0116): lo estampa al entrar en rented, lo limpia al salir y lo deja intacto en cualquier otro update. El dueño escribe el ESTADO; la fecha la escribe la base, por la misma razón que las fechas de vencimiento de la 0098.';

drop trigger if exists listings_stamp_rented on public.listings;
create trigger listings_stamp_rented
before insert or update on public.listings
for each row execute function app.listings_stamp_rented();

-- ---------------------------------------------------------------------------
-- 5. La primera confirmación viaja con la primera publicación
-- ---------------------------------------------------------------------------
-- Publicar un alquiler ES decir que está disponible. Estampar la columna en ese
-- momento evita que el aviso nazca debiendo una confirmación que nadie pidió.

create or replace function app.listings_stamp_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'property' then
    return new;
  end if;
  -- Sólo la PRIMERA vez. Después, la única puerta es
  -- public.confirmar_disponibilidad(): si cada transición a published
  -- reconfirmara, alcanzaría con pausar y despublicar para saltear la regla.
  if new.status = 'published' and new.availability_confirmed_at is null then
    new.availability_confirmed_at := now();
  end if;
  return new;
end;
$$;

comment on function app.listings_stamp_availability() is
  'Estampa listings.availability_confirmed_at en la PRIMERA publicación de una propiedad (0116). Sólo si está en null: reconfirmar en cada transición a published dejaría que pausar y volver a publicar saltee la regla de los 60 días.';

drop trigger if exists listings_stamp_availability on public.listings;
create trigger listings_stamp_availability
before insert or update on public.listings
for each row execute function app.listings_stamp_availability();

-- ---------------------------------------------------------------------------
-- 6. Confirmar disponibilidad
-- ---------------------------------------------------------------------------
-- `security definer` con el chequeo de propiedad ADENTRO, igual que
-- `renovar_publicacion` (0098) y `marcar_caso_resuelto` (0096): quien puentee la
-- app y llame a esto desde PostgREST con su token se topa con las mismas reglas.
--
-- Devuelve jsonb y no boolean por el mismo motivo que su hermana: los motivos de
-- rechazo son distintos entre sí y la pantalla tiene que poder decir cuál fue.

create or replace function public.confirmar_disponibilidad(p_listing uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_row    public.listings;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para confirmar tu publicación.';
  end if;

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

  if v_row.kind <> 'property' then
    return jsonb_build_object('ok', false, 'motivo', 'no_aplica');
  end if;

  -- Un aviso alquilado o dado de baja no tiene disponibilidad que confirmar.
  -- `expired` SÍ entra: confirmar y después renovar es exactamente el camino
  -- que la pantalla ofrece cuando se venció.
  if v_row.status not in ('published', 'expired', 'paused') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'status', v_row.status);
  end if;

  update public.listings
     set availability_confirmed_at = now()
   where id        = p_listing
     and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'confirmada_el', now());
end;
$$;

comment on function public.confirmar_disponibilidad(uuid) is
  'El anunciante declara que su propiedad SIGUE disponible (0116, spec §4). Es el único camino para mover availability_confirmed_at después de la primera publicación — renovar no la toca a propósito, porque si renovar confirmara la regla de los 60 días no existiría. security definer con el chequeo de propiedad adentro (dueño + comunidad), igual que renovar_publicacion.';

revoke all    on function public.confirmar_disponibilidad(uuid) from public, anon;
grant execute on function public.confirmar_disponibilidad(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. La puerta: renovar una propiedad exige haber confirmado
-- ---------------------------------------------------------------------------
-- Se reescribe `renovar_publicacion()` ENTERA (no un wrapper) porque el chequeo
-- va en el medio de su secuencia de validaciones y partirla en dos funciones
-- dejaría dos lugares donde entender por qué una renovación se rechaza.
--
-- Todo lo demás es idéntico a la 0098, línea por línea. El único agregado es el
-- bloque marcado «0116».

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

  select * into v_row
    from public.listings
   where id         = p_listing
     and tenant_id  = v_tenant
     and created_by = v_uid;

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

  -- ---- 0116: los 60 días de la spec §4 ------------------------------------
  -- Va DESPUÉS del tope y ANTES de "todavía no": quien llegó al tope no tiene
  -- nada que confirmar, y quien todavía no puede renovar tampoco necesita que
  -- le pidan confirmar hoy. Devuelve la fecha para que la pantalla pueda decir
  -- desde cuándo está sin confirmar en vez de un "confirmá" sin contexto.
  if v_row.kind = 'property'
     and coalesce(v_row.availability_confirmed_at, v_row.published_at, v_row.created_at)
         < now() - interval '60 days' then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'confirma_disponibilidad',
      'confirmada_el', coalesce(v_row.availability_confirmed_at, v_row.published_at, v_row.created_at)
    );
  end if;

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

  return jsonb_build_object(
    'ok', true,
    'expires_at', v_expires,
    'renewal_count', v_row.renewal_count + 1,
    'dias_de_vigencia', v_cfg.dias_de_vigencia
  );
end;
$$;

comment on function public.renovar_publicacion(uuid) is
  'Renueva una publicación propia por otro ciclo completo (0098): reinicia expires_at, limpia el aviso previo y, si estaba vencida, la devuelve a published. NO toca published_at — renovar da plazo, no posición. Desde la 0116, una PROPIEDAD cuya disponibilidad no se confirmó en los últimos 60 días se rechaza con motivo confirma_disponibilidad: es la puerta que hace cumplir la spec §4 sin agregar un segundo cron sobre las mismas filas. Devuelve jsonb con el motivo cuando no se puede: la pantalla necesita distinguir "todavía no" de "llegaste al tope" y de "confirmá primero".';

revoke all    on function public.renovar_publicacion(uuid) from public, anon;
grant execute on function public.renovar_publicacion(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Índice de lo que la pantalla del dueño pregunta
-- ---------------------------------------------------------------------------
-- "¿Cuáles de mis propiedades publicadas están sin confirmar?" es la consulta de
-- /publicaciones. Parcial sobre las publicadas: las alquiladas y las vencidas no
-- entran en esa pregunta, y sin el predicado el índice cubriría toda la tabla.
create index if not exists listings_disponibilidad_idx
  on public.listings (tenant_id, created_by, availability_confirmed_at)
  where kind = 'property' and status = 'published';

commit;

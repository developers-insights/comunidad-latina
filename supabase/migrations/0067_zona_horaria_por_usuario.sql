-- =============================================================================
-- 0067_zona_horaria_por_usuario.sql — Comunidad Latina
--
-- Bug de origen: publicar a las 22:00 en Los Ángeles muestra la fecha del día
-- siguiente. La premisa con la que se venía trabajando era falsa: `tenants` no
-- tiene ninguna columna de zona horaria (0002 sólo trae locale, currency,
-- country_focus, city_seed, theme).
--
-- Y aunque la tuviera, no alcanzaría. Un tenant atiende a la MISMA diáspora
-- repartida entre NY, NJ, Miami, Houston, Chicago y LA: una zona por comunidad
-- le seguiría mostrando el día equivocado a todo el que esté en la costa oeste.
-- La zona horaria es un atributo de la PERSONA, no del dominio.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ VA EN `profiles` Y NO EN `profiles_private`
-- -----------------------------------------------------------------------------
-- Se lee en cada render para formatear fechas, y siempre es la del PROPIO
-- usuario que mira (la fecha de un post se muestra en la zona de quien lee, no
-- en la de quien escribió). O sea que el acceso es "mi propia fila, con
-- sesión", que `profiles` ya resuelve sin un join extra por página.
--
-- -----------------------------------------------------------------------------
-- GRANTS — no se le da a `anon`
-- -----------------------------------------------------------------------------
-- 0058 le sacó a `anon` el SELECT de tabla y le devolvió una lista explícita de
-- columnas públicas; 0062 le sumó username y cover_url. `timezone` NO entra en
-- esa lista, y es una decisión, no un olvido: una zona horaria es geolocalización
-- gruesa, y un visitante sin cuenta no tiene ningún motivo para saber en qué
-- huso vive un usuario. Tampoco hace falta para el bug: el anónimo no tiene
-- perfil, así que su formateo sale del navegador.
--
-- `authenticated` la lee porque ya tiene SELECT de tabla desde antes de 0058
-- (que sólo tocó a anon). Queda anotado como exposición residual conocida:
-- un usuario con sesión puede leer la zona horaria de otro. Cerrarlo exige la
-- misma cirugía de grants por columna que 0058 dejó pendiente para
-- `authenticated`, y esa cirugía hoy rompe `perfil/(lista)/page.tsx:74`, que
-- todavía hace `select("*")`.
--
-- -----------------------------------------------------------------------------
-- VALIDACIÓN — por qué NO hay un CHECK contra pg_timezone_names
-- -----------------------------------------------------------------------------
-- Un CHECK no puede contener subconsultas: Postgres lo rechaza de plano, así
-- que `check (timezone in (select name from pg_timezone_names))` ni siquiera
-- compila. Y aunque se pudiera, `pg_timezone_names` no es inmutable (la base de
-- datos de zonas cambia con las actualizaciones del sistema) ni barata (es una
-- vista respaldada por una función que recorre ~1200 zonas).
--
-- La validación queda en dos capas:
--   1. CHECK SINTÁCTICO, inmutable y barato: exige forma `Area/Ubicacion`
--      (o los sueltos `UTC`/`GMT`). Ataja el dedazo y el string arbitrario.
--   2. TRIGGER que resuelve el valor de verdad contra la base de zonas del
--      motor, probando `now() AT TIME ZONE <valor>`. Es O(1) —no recorre
--      pg_timezone_names— y usa exactamente la misma tabla de zonas que después
--      va a usar el formateo, que es la definición correcta de "válido". Sólo
--      corre cuando la columna cambia, así que no cuesta nada en el caso normal.
-- =============================================================================

begin;

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'Zona horaria IANA del usuario (ej. America/Los_Angeles, America/New_York). NULLABLE: null significa "no la eligió todavía" y la app debe caer a la zona del navegador. Es por USUARIO y no por tenant a propósito — la misma comunidad tiene gente en NY y en LA, y una zona por dominio le muestra el día equivocado a media diáspora. Validación en dos capas: un CHECK sintáctico (profiles_timezone_formato) y el trigger profiles_validate_timezone, que resuelve el valor contra la base de zonas real del motor. NO se le concede a `anon`: una zona horaria es geolocalización gruesa.';

-- Capa 1: forma. Inmutable y barato.
alter table public.profiles
  drop constraint if exists profiles_timezone_formato;
alter table public.profiles
  add constraint profiles_timezone_formato
  check (
    timezone is null
    or timezone in ('UTC', 'GMT')
    or timezone ~ '^[A-Za-z]+(?:[_-][A-Za-z]+)*/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*(?:/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*)?$'
  );

-- Capa 2: existencia real, contra la base de zonas del motor.
create or replace function app.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_probe timestamp;
begin
  if new.timezone is null then
    return new;
  end if;

  -- Sólo si cambió: en un UPDATE normal esto no corre.
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;

  begin
    -- Si la zona no existe, Postgres levanta invalid_parameter_value. Es una
    -- resolución directa contra la base de zonas: no recorre pg_timezone_names.
    v_probe := now() at time zone new.timezone;
  exception when others then
    raise exception 'ZONA_HORARIA_INVALIDA: % no es una zona horaria conocida', new.timezone
      using hint = 'Usá un identificador IANA, por ejemplo America/New_York.';
  end;

  return new;
end;
$$;

comment on function app.validate_profile_timezone() is
  'Verifica que profiles.timezone sea una zona que el motor reconoce, resolviendo `now() at time zone <valor>` y atrapando el error. Es O(1) y usa la MISMA base de zonas que después usará el formateo — que es la única definición de "válida" que importa. No se hizo con un CHECK contra pg_timezone_names porque un CHECK no admite subconsultas y esa vista además no es inmutable. Sólo corre en INSERT o cuando el valor cambia.';

drop trigger if exists profiles_validate_timezone on public.profiles;
create trigger profiles_validate_timezone
before insert or update of timezone on public.profiles
for each row execute function app.validate_profile_timezone();

-- Índice: NO se crea. Nadie filtra ni agrupa por zona horaria — se lee siempre
-- junto con la fila del propio usuario, que ya entra por la PK. Un índice acá
-- sería costo de escritura sin ninguna lectura que lo aproveche.

commit;

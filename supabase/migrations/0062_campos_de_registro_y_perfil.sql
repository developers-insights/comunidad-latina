-- =============================================================================
-- 0062_campos_de_registro_y_perfil.sql — Comunidad Latina
--
-- El pliego exige, además de lo que ya hay: apellido, nombre de usuario, fecha
-- de nacimiento, país de residencia, ciudad, idiomas y foto de portada.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN — dónde va cada campo, y por qué NO van todos en `profiles`
-- -----------------------------------------------------------------------------
-- `profiles` es público por diseño (SEO) y su policy de SELECT es `using(true)`.
-- RLS filtra FILAS, no columnas, así que todo lo que se agregue a `profiles`
-- queda legible por cualquier usuario autenticado. Y no se puede cerrar por
-- GRANT de columna sin romper la app: `perfil/(lista)/page.tsx:74` todavía hace
-- `select("*")` como `authenticated`, y revocarle una columna lo tira con 42501
-- (es la misma razón por la que 0058 tocó sólo a `anon`).
--
-- Entonces el reparto se hace por sensibilidad, no por comodidad:
--
--   → `profiles` (público de verdad):   username, cover_url
--        Un handle y un banner. Son identidad pública: ocultarlos no tendría
--        sentido y no hay nada que proteger.
--
--   → `profiles_private` (dueño y nadie más, por RLS):
--        last_name, birthdate, country_residence, city, languages
--        Acá la privacidad NO es cosmética: la tabla ya es solo-dueño desde
--        0003 (ni anon, ni otros miembros, ni staff, ni global_admin), así que
--        el default de estos campos es "nadie los ve". Lo que los revela es
--        `public.profile_card()` (0063), aplicando los controles de privacidad
--        del usuario. O sea: cerrado por defecto y abierto sólo por la puerta
--        que sabe de permisos, en vez de abierto por defecto y tapado en la UI.
--
-- La fecha de nacimiento merece un párrafo: NUNCA sale completa. `profile_card`
-- devuelve la EDAD en años, jamás el día exacto — la DOB completa es dato de
-- verificación de identidad y de robo de identidad, y ya estaba marcada como
-- "nunca pública" en 0030. Sólo el dueño ve su propia fecha.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles — lo que sí es público
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username  text,
  add column if not exists cover_url text;

comment on column public.profiles.username is
  'Nombre de usuario (handle). ÚNICO POR TENANT, no global: dos comunidades distintas son dos espacios de nombres distintos, y exigir unicidad global le regalaría a quien llegó primero el handle en todos los dominios futuros. Se guarda normalizado en minúsculas por app.normalize_profile_username(); la unicidad la aplica profiles_username_tenant_uniq.';
comment on column public.profiles.cover_url is
  'Foto de portada del perfil (banner). Pública, como el avatar. Vive en el bucket `avatars` ya auditado por el enumerador de RLS — no se crea bucket nuevo a propósito, porque scripts/rls-enumerator.mjs tiene la lista de buckets fija y un bucket fuera de esa lista sería exactamente el modo de falla que ese script existe para evitar.';

-- Normalización en la base: el handle es identidad, y "Manuel" vs "manuel" no
-- pueden ser dos personas distintas. Lowercase + trim antes de cualquier
-- comprobación de unicidad.
create or replace function app.normalize_profile_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));
    if new.username = '' then
      new.username := null;
    end if;
  end if;
  return new;
end;
$$;

comment on function app.normalize_profile_username() is
  'Pasa el handle a minúsculas y recorta espacios antes de guardarlo, y convierte el string vacío en NULL (para que "sin username" sea un solo valor y no dos). Vive en la base porque de eso depende la unicidad: si la normalización viviera en la app, "Manuel" y "manuel" pasarían el índice único como dos handles distintos.';

drop trigger if exists profiles_normalize_username on public.profiles;
create trigger profiles_normalize_username
before insert or update of username on public.profiles
for each row execute function app.normalize_profile_username();

-- Formato: se valida DESPUÉS de normalizar. Sin punto/guión bajo al principio
-- ni al final, para que no existan handles visualmente ambiguos.
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$');

-- Único DENTRO del tenant (requisito explícito del pliego), no global.
create unique index if not exists profiles_username_tenant_uniq
  on public.profiles (tenant_id, username)
  where username is not null;

-- ---------------------------------------------------------------------------
-- 2. profiles_private — lo que no es de nadie más
-- ---------------------------------------------------------------------------
alter table public.profiles_private
  add column if not exists last_name         text,
  add column if not exists birthdate         date,
  add column if not exists country_residence text,
  add column if not exists city              text,
  add column if not exists languages         text[] not null default '{}'::text[];

comment on column public.profiles_private.last_name is
  'Apellido. Vive acá y no en `profiles` porque `profiles` es público por diseño y RLS no filtra columnas: en `profiles` el apellido sería legible por cualquier autenticado, sin importar lo que el usuario elija en sus controles de privacidad. Se revela vía public.profile_card() según profile_privacy.show_last_name.';
comment on column public.profiles_private.birthdate is
  'Fecha de nacimiento completa. SOLO la ve su dueño: profile_card() devuelve la EDAD en años, nunca el día — la DOB exacta es material de verificación de identidad y de suplantación, y ya estaba marcada como "nunca pública" en 0030. Habilita el gate de edad mínima del creador (0064) sin exponer nada.';
comment on column public.profiles_private.country_residence is
  'País de residencia (ISO-3166 alpha-2 o nombre). Distinto de profiles.country_origin, que es de dónde venís y sí es público (es el eje de la comunidad). Dónde vivís HOY es dato de localización: default no público.';
comment on column public.profiles_private.city is
  'Ciudad de residencia. Junto con country_residence forma el bloque "ubicación" de los controles de privacidad. No reemplaza a profiles.area_label, que es la zona aproximada que el usuario elige mostrar (§5.4: nunca dirección exacta).';
comment on column public.profiles_private.languages is
  'Idiomas que habla la persona. Array y no texto libre para que sea filtrable. Tope de 10 ítems / 40 caracteres via app.short_text_array_ok, mismo criterio que el resto de los arrays del repo.';

alter table public.profiles_private
  drop constraint if exists profiles_private_languages_ok;
alter table public.profiles_private
  add constraint profiles_private_languages_ok
  check (app.short_text_array_ok(languages, 10, 40));

-- Rango estático a propósito: un CHECK no puede usar current_date (no es
-- inmutable, y Postgres lo rechaza). Esto sólo ataja el dedazo grosero
-- (año 1300, año 2999). Que la fecha no sea futura y que cumpla la edad mínima
-- lo decide app.creator_activation_eligible (0064), que sí evalúa contra
-- current_date en tiempo de consulta.
alter table public.profiles_private
  drop constraint if exists profiles_private_birthdate_sane;
alter table public.profiles_private
  add constraint profiles_private_birthdate_sane
  check (birthdate is null or birthdate between date '1900-01-01' and date '2030-01-01');

-- Búsqueda de personas por ubicación / idioma (la usa el directorio). Los dos
-- índices son parciales: la enorme mayoría de las filas no tiene el dato.
create index if not exists profiles_private_ubicacion_idx
  on public.profiles_private (tenant_id, country_residence, city)
  where country_residence is not null;
create index if not exists profiles_private_languages_idx
  on public.profiles_private using gin (languages);

-- ---------------------------------------------------------------------------
-- 3. Grants: sólo lo público se le agrega a `anon`
-- ---------------------------------------------------------------------------
-- 0058 le sacó a `anon` el SELECT de tabla y le devolvió 8 columnas. Las dos
-- nuevas públicas se suman a esa lista. Nada de profiles_private se agrega:
-- `anon` no tiene NINGUNA policy ahí (todas son `to authenticated`), que es
-- justamente lo que hace que el default sea "no se ve".
grant select (username, cover_url) on public.profiles to anon;

commit;

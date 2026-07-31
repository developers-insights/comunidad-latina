-- =============================================================================
-- 0053_rls_gaps_ctas_y_consentimiento.sql — Comunidad Latina
--
-- Dos derechos que la app OFRECE y la RLS no deja ejercer. Los encontró una
-- auditoría que cruzó cada migración contra el código que la consume, y los
-- dos son del mismo tipo: una policy escrita para un flujo (moderación de
-- avisos, embudo de postulaciones) que después quedó gobernando otro flujo que
-- nadie previó. El síntoma en las dos es idéntico y engañoso — un `42501` que
-- la UI muestra como "algo salió mal" — así que ni siquiera se leen como
-- permisos.
--
-- POR QUÉ FUNCIONES `security definer` Y NO POLICIES NUEVAS:
--   1. El enumerador (`scripts/rls-enumerator.mjs`) exige EXACTAMENTE 4
--      policies por tabla. Una quinta rompe el gate, y con razón: la forma de
--      abrir un agujero es agregar una policy permisiva "de más".
--   2. Aflojar el `with check` existente sería mucho peor. `listings_update`
--      excluye `published` A PROPÓSITO: es lo que impide que alguien publique
--      un aviso limpio, pase moderación y después le reescriba el contenido.
--      Ese candado se queda.
--   3. Lo que hace falta no es "poder escribir la fila", es "poder escribir
--      DOS o SIETE columnas concretas". Eso una policy no lo sabe expresar —
--      autoriza filas, no columnas — y una función sí.
-- Las dos revalidan identidad y pertenencia adentro, y tocan sólo sus columnas.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1 · Botones de acción de un aviso PREMIUM ya publicado
--
-- `listings_update` (0004) sólo deja al dueño escribir filas cuyo status quede
-- en ('draft','pending_review','paused','removed'). Un aviso publicado no está
-- en esa lista, así que `saveListingCtasAction` —que parchea sólo las 7
-- columnas cta_* y no toca el status— rebotaba con 42501 en los 27 avisos
-- publicados de la base. O sea: el comercio que paga premium entra al editor,
-- carga su teléfono, toca Guardar y recibe un error genérico. Nunca puede
-- cargar un botón. Es exactamente lo que compró.
--
-- Los CHECK de la 0048 (`listings_cta_premium_only`) siguen gobernando: esta
-- función no los saltea, sólo consigue llegar hasta ellos.
-- ---------------------------------------------------------------------------
create or replace function public.save_listing_ctas(
  p_listing_id      uuid,
  p_phone           text default null,
  p_whatsapp        text default null,
  p_website         text default null,
  p_purchase_url    text default null,
  p_tickets_url     text default null,
  p_booking_url     text default null,
  p_address         text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_owned  boolean;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Ownership y tenant se revalidan ACÁ dentro. Es lo que reemplaza a la
  -- policy: una función definer sin este chequeo es una policy borrada.
  select exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.tenant_id = v_tenant
       and l.created_by = v_uid
       and l.source = 'user'
  ) into v_owned;

  if not v_owned then
    raise exception 'NOT_OWNER' using errcode = '42501';
  end if;

  update public.listings
     set cta_phone        = p_phone,
         cta_whatsapp     = p_whatsapp,
         cta_website      = p_website,
         cta_purchase_url = p_purchase_url,
         cta_tickets_url  = p_tickets_url,
         cta_booking_url  = p_booking_url,
         cta_address      = p_address
   where id = p_listing_id
     and tenant_id = v_tenant;
end;
$$;

comment on function public.save_listing_ctas is
  'Guarda los 7 botones de acción de un aviso propio. Existe porque listings_update (0004) excluye status=''published'' a propósito —para que un aviso no se reescriba después de pasar moderación— y eso también bloqueaba el ÚNICO parche legítimo sobre un aviso vivo. Revalida tenant + created_by + source=''user'' adentro; el CHECK listings_cta_premium_only (0048) sigue rigiendo, así que en tier free rebota igual.';

revoke all on function public.save_listing_ctas from public;
grant execute on function public.save_listing_ctas to authenticated;


-- ---------------------------------------------------------------------------
-- 2 · Retirar el consentimiento del perfil en una postulación
--
-- `job_applications_update` (0047) parte el `with check` en dos ramas: el
-- postulante sólo puede dejar la fila en ('submitted','withdrawn'), y el dueño
-- del aviso sólo en los cinco estados del embudo. Consecuencia no buscada: en
-- cuanto el empleador mueve la postulación a `reviewing`, NINGUNA de las dos
-- ramas es verdadera para un UPDATE del postulante, y su botón "Ocultar mi
-- perfil" empieza a fallar.
--
-- El trigger `app.job_applications_freeze` (0040/0047) sí lo permitía —
-- share_profile es la única columna del postulante que queda editable— y el
-- comentario de la 0047 lo dice con todas las letras. La policy nunca lo dejó
-- llegar.
--
-- Importa más que un botón roto: es dato personal. La persona que ya no quiere
-- que su nombre, su foto y su zona se vean no puede retirarlos, y la UI le
-- promete que sí ("El consentimiento se puede retirar SIEMPRE").
-- ---------------------------------------------------------------------------
create or replace function public.set_application_share_profile(
  p_application_id uuid,
  p_share          boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_rows   int;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Sólo el postulante, en cualquier estado del embudo. Que la postulación
  -- esté cerrada no le devuelve al empleador un derecho sobre datos ajenos.
  update public.job_applications
     set share_profile = p_share
   where id = p_application_id
     and tenant_id = v_tenant
     and applicant_id = v_uid;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'NOT_APPLICANT' using errcode = '42501';
  end if;
end;
$$;

comment on function public.set_application_share_profile is
  'El postulante prende o apaga el compartir su perfil en UNA postulación, en cualquier estado. Existe porque el with check de job_applications_update (0047) limita la rama del postulante a submitted/withdrawn, y a partir de ''reviewing'' bloqueaba el retiro del consentimiento — un derecho sobre dato personal que la app promete y la RLS negaba. Toca UNA columna y sólo sobre filas propias.';

revoke all on function public.set_application_share_profile from public;
grant execute on function public.set_application_share_profile to authenticated;

-- =============================================================================
-- 0181_telefono_obligatorio.sql — Comunidad Latina
--
-- Regla: correo y teléfono verificados antes del acceso completo (hallazgo F06).
-- Una cuenta sin teléfono verificado LEE, pero no publica ni chatea.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APLICARLA NO CAMBIA NADA PARA NADIE
-- ═══════════════════════════════════════════════════════════════════════════
-- Instala los triggers con `tenants.phone_required` en FALSE. El bloqueo arranca
-- recién con un UPDATE explícito, por comunidad, DESPUÉS de comprobar con un SMS
-- real que el flujo anda. Prender el gate acá mismo sería dejar en modo lectura a
-- las 37 cuentas sin verificar antes de saber si pueden salir de ahí.
--
--   Prender:  update public.tenants set phone_required = true  where slug = '…';
--   Apagar:   update public.tenants set phone_required = false where slug = '…';
--
-- El trigger lee la columna en cada escritura: apagarlo vale al instante y sin
-- deploy. Ese UPDATE es la salida de emergencia si Twilio se cae. La app lo ve
-- con hasta 5 minutos de demora (caché de `getTenant`), la base no.
--
-- ⚠️ `phone_required = true` con `PHONE_VERIFICATION_ENABLED` apagada deja a las
-- cuentas sin verificar sin forma de verificar: la base no puede leer env de
-- Vercel. La app lo detecta y alerta (`lib/phone/gate.ts`). Orden de apagado:
-- primero esta columna, después la env.
--
-- ── QUÉ QUEDA AFUERA, A PROPÓSITO ────────────────────────────────────────────
--   · scam_reports, appeals: denunciar una estafa y apelar una sanción son
--     seguridad. No se le pide nada a nadie para eso.
--   · reactions, follows, saves, post_poll_votes: no llevan contenido ni llegan
--     al privado de nadie. Además esas tablas actualizan contadores en `posts`.
--   · community_registrations: va a una lista privada de la plataforma.
--   · perfil, notificaciones, leer, marcar como leído: no son publicar.
--
-- ── LAS TABLAS DE CREADORES Y DE PAGOS, UNA POR UNA ──────────────────────────
-- El criterio es el de toda esta migración: entra lo que es texto público o
-- contenido entre personas. Lo demás no se corta.
--   · creator_profiles — ADENTRO. `headline`, `bio`, `skills`, `rate_hint` y las
--     fotos se publican en "Buscar creadores". Va en INSERT y en el UPDATE de esas
--     columnas: los contadores de reputación no pasan por acá. La app guarda con
--     `upsert`, que dispara el BEFORE INSERT aunque la fila exista.
--   · creator_portfolio_items — ADENTRO. `caption` y `url` son públicos. La app no
--     escribe esta tabla hoy, pero la RLS deja al dueño hacerlo por REST.
--   · creator_service_packages — ADENTRO. `title`, `description` e `includes` son
--     la oferta pública del creador. `active` y `sort_order` quedan libres.
--   · job_deliverables, job_revisions — ADENTRO. La nota viaja a la otra parte del
--     contrato. OJO: la app inserta con service_role, así que esto corta el camino
--     por REST y NO el de la pantalla. Es a propósito: una entrega de un contrato ya
--     en curso, con la plata adentro, no se traba porque la comunidad prendió el
--     gate después.
--   · campaigns — AFUERA. Es la configuración privada de un pago: objetivo,
--     presupuesto y segmentación, que no le llega a nadie. Lo que se muestra es el
--     aviso o el post de la campaña, y esos ya pasan por acá.
--   · business_accounts — AFUERA. Es la fila de facturación: sólo la leen el dueño y
--     el admin (`business_accounts_select`), y lo público del negocio es su aviso
--     `kind = 'business'`, que ya pasa por acá. Además `negocios/presencia` la crea
--     justo antes del checkout: cortarla acá cortaría un pago. Esa fila dispara
--     `business_accounts_ficha_al_alta`, que inserta el aviso: SECURITY DEFINER no
--     cambia `auth.uid()`, así que `app.asegurar_ficha_de_negocio` levanta la marca
--     `app.ficha_sistema` alrededor de ese insert, o comprar rebotaría antes de Stripe.
--
-- ── EL CORREO NO SE CHEQUEA ACÁ ──────────────────────────────────────────────
-- Sin correo confirmado no hay sesión (el proyecto rechaza el login con
-- `email_not_confirmed`), así que todo `auth.uid()` que llega acá ya lo tiene.
-- `profiles.email_verified` es una copia derivada que recién se escribe desde la
-- ruta /confirmar: exigirla acá bloquearía cuentas viejas con el correo al día.
--
-- ── LO QUE ESTE TRIGGER NO VE ────────────────────────────────────────────────
-- `auth.uid()` nulo pasa, igual que en `enforce_account_active`: es service_role.
-- Las escrituras del admin client no pasan por acá.
--
-- `app.ficha_sistema` no se puede prender desde afuera: `set_config` vive en
-- `pg_catalog`, que PostgREST no expone, y ninguna función de `public` la recibe
-- como parámetro. Es la misma técnica que `app.renovando_publicacion` (0098).
-- =============================================================================

begin;

alter table public.tenants
  add column if not exists phone_required boolean not null default false;

comment on column public.tenants.phone_required is
  'Si esta comunidad exige teléfono verificado para publicar y chatear (0181). Default false. Solo lo cambia global_admin o SQL. Antes de prenderlo: PHONE_VERIFICATION_ENABLED=true, un SMS real probado y, si hay números de fuera de EE.UU./Canadá, WhatsApp configurado. Apagarlo es la salida de emergencia si el SMS se cae: vale al instante, sin deploy.';

-- ---------------------------------------------------------------------------
-- ¿Esta cuenta cumple con lo que exige su comunidad?
-- ---------------------------------------------------------------------------
-- Perfil inexistente → true, mismo criterio que `app.account_active`: no romper
-- flujos de service_role, seeds ni el alta.
create or replace function app.telefono_al_dia(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (not t.phone_required) or p.phone_verified
        from public.profiles p
        join public.tenants t on t.id = p.tenant_id
       where p.id = p_profile
    ),
    true
  );
$$;

comment on function app.telefono_al_dia(uuid) is
  'true si la comunidad de la cuenta no exige teléfono, o si ya lo verificó. Perfil inexistente → true (no romper service_role/seed).';

revoke execute on function app.telefono_al_dia(uuid) from public, anon, authenticated;
grant execute on function app.telefono_al_dia(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- El corte
-- ---------------------------------------------------------------------------
create or replace function app.enforce_phone_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin JWT (service_role, seed, cron) pasa. El staff también: un moderador o un
  -- admin no puede quedar afuera de su propia comunidad por esto.
  if auth.uid() is null or app.is_staff() then
    return new;
  end if;

  -- La ficha que crea el alta de un negocio: ver `app.asegurar_ficha_de_negocio`.
  if coalesce(current_setting('app.ficha_sistema', true), 'off') = 'on' then
    return new;
  end if;

  if not app.telefono_al_dia(auth.uid()) then
    raise exception 'PHONE_VERIFICATION_REQUIRED: para publicar y escribir, primero confirmá tu teléfono.';
  end if;

  return new;
end;
$$;

comment on function app.enforce_phone_verified() is
  'BEFORE INSERT (y UPDATE del contenido en las tablas que lo admiten): corta publicar y chatear a las cuentas sin teléfono verificado cuando su comunidad lo exige (tenants.phone_required). Sin JWT, staff o la marca local app.ficha_sistema pasa. Hermano de app.enforce_account_active.';

-- ---------------------------------------------------------------------------
-- La ficha que nace con un negocio no es publicar
--
-- Misma función que la 0121 salvo las dos líneas de `set_config`. Es `true` (local
-- a la transacción) y se apaga enseguida: la marca cubre ese insert y nada más. Si
-- el insert falla, el rollback también se la lleva.
-- ---------------------------------------------------------------------------
create or replace function app.asegurar_ficha_de_negocio(p_business uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cuenta  public.business_accounts%rowtype;
  v_listing uuid;
begin
  select * into v_cuenta from public.business_accounts where id = p_business;
  if not found then
    return null;
  end if;
  if v_cuenta.listing_id is not null then
    return v_cuenta.listing_id;
  end if;

  -- ¿Hizo una a mano que TODAVÍA NO RECLAMÓ NINGUNA CUENTA? Se adopta.
  --
  -- El `not exists` es lo único que cambia respecto de la 0116, y es lo que
  -- hace posible el segundo negocio: sin él, la cuenta nº 2 se adoptaba la
  -- ficha de la nº 1 y los dos negocios quedaban con la misma cara pública.
  -- Con una sola cuenta por persona el resultado es idéntico al de antes.
  select l.id into v_listing
  from public.listings l
  where l.tenant_id = v_cuenta.tenant_id
    and l.created_by = v_cuenta.owner_id
    and l.kind = 'business'
    and l.status = 'published'
    and not exists (
      select 1 from public.business_accounts otra
       where otra.listing_id = l.id
    )
  order by l.created_at
  limit 1;

  if v_listing is null then
    perform set_config('app.ficha_sistema', 'on', true);

    insert into public.listings (
      tenant_id, kind, title, status, created_by, attrs, source, published_at
    )
    values (
      v_cuenta.tenant_id,
      'business',
      v_cuenta.name,
      'published',
      v_cuenta.owner_id,
      case
        when v_cuenta.category is null then '{}'::jsonb
        else jsonb_build_object('category', v_cuenta.category)
      end,
      'user',
      now()
    )
    returning id into v_listing;

    perform set_config('app.ficha_sistema', 'off', true);
  end if;

  update public.business_accounts
     set listing_id = v_listing
   where id = p_business
     and listing_id is null;

  return v_listing;
end;
$fn$;

-- Con `drop … if exists`: el archivo se puede volver a correr.
do $$
declare
  v_tabla text;
begin
  for v_tabla in
    select unnest(array[
      'posts', 'comments', 'listings', 'listing_comments', 'listing_reviews',
      'post_offers', 'gig_reviews', 'gig_applications', 'job_applications',
      'community_help_notices', 'community_help_replies',
      'conversations', 'messages', 'calls',
      'chat_groups', 'chat_group_messages', 'chat_group_join_requests',
      'creator_profiles', 'creator_portfolio_items', 'creator_service_packages',
      'job_deliverables', 'job_revisions'
    ])
  loop
    execute format('drop trigger if exists %I on public.%I', v_tabla || '_exigir_telefono', v_tabla);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function app.enforce_phone_verified()',
      v_tabla || '_exigir_telefono',
      v_tabla
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Editar es publicar: si no, alcanza con reescribir algo viejo. Sólo cuando cambia
-- el CONTENIDO, nunca en cualquier UPDATE: los contadores de `posts` se mueven con
-- el `auth.uid()` de quien da "me gusta", y eso sigue libre.
-- ---------------------------------------------------------------------------

-- Lo que el sistema anota en `listings.attrs` y no es contenido. Pausar, cerrar,
-- renovar y marcar resuelto no publican nada, y `paused_*` además lo escribe el
-- trigger de la 0118 con el `auth.uid()` de quien DENUNCIA: sin esta resta, una
-- denuncia de una cuenta sin verificar rebotaría, y denunciar nunca se corta.
-- Una marca nueva que no se sume acá queda detrás del gate: falla para el lado
-- seguro.
create or replace function app.attrs_de_contenido(p_attrs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_attrs, '{}'::jsonb) - array[
    'paused_reason', 'paused_at',
    'closed_reason', 'closed_at',
    'lf_resolved_at',
    'availability_confirmed_at'
  ]::text[];
$$;

comment on function app.attrs_de_contenido(jsonb) is
  'listings.attrs sin las marcas que escribe el sistema (pausa, cierre, resuelto, reconfirmación). Lo usa el trigger listings_editar_exigir_telefono para distinguir editar el aviso de cambiarle el estado.';

-- El trigger evalúa su WHEN con el rol de quien hace el UPDATE.
revoke execute on function app.attrs_de_contenido(jsonb) from public;
grant execute on function app.attrs_de_contenido(jsonb) to anon, authenticated, service_role;

-- `media` y `status` también: un video de Mux nace como borrador sin texto, y se
-- publica sin que cambie `body` si la persona no escribe pie. `/api/mux/subida` crea
-- ese borrador con service_role, así que publicarlo es el primer momento en que el
-- gate lo ve.
drop trigger if exists posts_editar_exigir_telefono on public.posts;
create trigger posts_editar_exigir_telefono
before update of body, status, media on public.posts
for each row
when (
  old.body is distinct from new.body
  or old.media is distinct from new.media
  or (old.status = 'draft' and new.status in ('published', 'pending_review'))
)
execute function app.enforce_phone_verified();

drop trigger if exists comments_editar_exigir_telefono on public.comments;
create trigger comments_editar_exigir_telefono
before update of body on public.comments
for each row
when (old.body is distinct from new.body)
execute function app.enforce_phone_verified();

-- `republicarAvisoEditado` y el resto de lo que corre con service_role pasan: sin
-- JWT, `auth.uid()` es nulo y `enforce_phone_verified` no corta.
drop trigger if exists listings_editar_exigir_telefono on public.listings;
create trigger listings_editar_exigir_telefono
before update of
  title, description, attrs, photos, area_label,
  video_path, video_poster_path,
  cta_phone, cta_whatsapp, cta_website, cta_purchase_url, cta_tickets_url,
  cta_booking_url, cta_address
on public.listings
for each row
when (
  old.title is distinct from new.title
  or old.description is distinct from new.description
  or old.photos is distinct from new.photos
  or old.area_label is distinct from new.area_label
  or old.video_path is distinct from new.video_path
  or old.video_poster_path is distinct from new.video_poster_path
  or old.cta_phone is distinct from new.cta_phone
  or old.cta_whatsapp is distinct from new.cta_whatsapp
  or old.cta_website is distinct from new.cta_website
  or old.cta_purchase_url is distinct from new.cta_purchase_url
  or old.cta_tickets_url is distinct from new.cta_tickets_url
  or old.cta_booking_url is distinct from new.cta_booking_url
  or old.cta_address is distinct from new.cta_address
  or app.attrs_de_contenido(old.attrs) is distinct from app.attrs_de_contenido(new.attrs)
)
execute function app.enforce_phone_verified();

-- `pg_trigger_depth() = 0`: cuando se levantan las denuncias, la 0118 devuelve el
-- aviso de `paused` a `published` desde un trigger, con el `auth.uid()` de quien
-- tocó la denuncia. Eso no es publicar, y lo de denunciar nunca se corta.
drop trigger if exists listings_publicar_exigir_telefono on public.listings;
create trigger listings_publicar_exigir_telefono
before update of status on public.listings
for each row
when (
  pg_trigger_depth() = 0
  and old.status in ('draft', 'paused')
  and new.status in ('pending_review', 'published')
)
execute function app.enforce_phone_verified();

drop trigger if exists listing_comments_editar_exigir_telefono on public.listing_comments;
create trigger listing_comments_editar_exigir_telefono
before update of body on public.listing_comments
for each row
when (old.body is distinct from new.body)
execute function app.enforce_phone_verified();

drop trigger if exists listing_reviews_editar_exigir_telefono on public.listing_reviews;
create trigger listing_reviews_editar_exigir_telefono
before update of body, rating, owner_reply on public.listing_reviews
for each row
when (
  old.body is distinct from new.body
  or old.rating is distinct from new.rating
  or old.owner_reply is distinct from new.owner_reply
)
execute function app.enforce_phone_verified();

drop trigger if exists post_offers_editar_exigir_telefono on public.post_offers;
create trigger post_offers_editar_exigir_telefono
before update of titulo, terminos, codigo_cupon on public.post_offers
for each row
when (
  old.titulo is distinct from new.titulo
  or old.terminos is distinct from new.terminos
  or old.codigo_cupon is distinct from new.codigo_cupon
)
execute function app.enforce_phone_verified();

drop trigger if exists chat_groups_editar_exigir_telefono on public.chat_groups;
create trigger chat_groups_editar_exigir_telefono
before update of name, description, avatar_url on public.chat_groups
for each row
when (
  old.name is distinct from new.name
  or old.description is distinct from new.description
  or old.avatar_url is distinct from new.avatar_url
)
execute function app.enforce_phone_verified();

-- `new.deleted_at is null`: bajar un mensaje vacía `body`, y borrar lo propio nunca
-- se corta. Marcar leído y las reacciones no tocan esta columna.
drop trigger if exists messages_editar_exigir_telefono on public.messages;
create trigger messages_editar_exigir_telefono
before update of body on public.messages
for each row
when (old.body is distinct from new.body and new.deleted_at is null)
execute function app.enforce_phone_verified();

drop trigger if exists chat_group_messages_editar_exigir_telefono on public.chat_group_messages;
create trigger chat_group_messages_editar_exigir_telefono
before update of body on public.chat_group_messages
for each row
when (old.body is distinct from new.body and new.deleted_at is null)
execute function app.enforce_phone_verified();

drop trigger if exists creator_profiles_editar_exigir_telefono on public.creator_profiles;
create trigger creator_profiles_editar_exigir_telefono
before update of headline, bio, skills, portfolio_photos, rate_hint on public.creator_profiles
for each row
when (
  old.headline is distinct from new.headline
  or old.bio is distinct from new.bio
  or old.skills is distinct from new.skills
  or old.portfolio_photos is distinct from new.portfolio_photos
  or old.rate_hint is distinct from new.rate_hint
)
execute function app.enforce_phone_verified();

drop trigger if exists creator_portfolio_items_editar_exigir_telefono on public.creator_portfolio_items;
create trigger creator_portfolio_items_editar_exigir_telefono
before update of url, caption on public.creator_portfolio_items
for each row
when (old.url is distinct from new.url or old.caption is distinct from new.caption)
execute function app.enforce_phone_verified();

drop trigger if exists creator_service_packages_editar_exigir_telefono on public.creator_service_packages;
create trigger creator_service_packages_editar_exigir_telefono
before update of title, description, includes on public.creator_service_packages
for each row
when (
  old.title is distinct from new.title
  or old.description is distinct from new.description
  or old.includes is distinct from new.includes
)
execute function app.enforce_phone_verified();

-- ---------------------------------------------------------------------------
-- Las verificaciones no pueden nacer prendidas
--
-- `protect_profile_fields` guarda estas columnas en UPDATE, no en INSERT, y este
-- rol tiene grant de INSERT sobre ellas. Sin esto, quien no tiene perfil podía
-- crearlo por REST con `phone_verified = true` y saltear todo el gate, o con el
-- check azul puesto. El alta de la app usa service_role y no pasa por acá.
--
-- `created_at` por lo mismo: desde la 0182 es la fuente de la antigüedad, así que
-- nacer con una fecha vieja regalaría años en la comunidad.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
for insert to authenticated
with check (
  id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
  and role = 'member'
  and identity_verified = false
  and identity_verified_at is null
  and phone_verified = false
  and verified_badge = false
  and created_at >= now() - interval '1 minute'
  and created_at <= now() + interval '1 minute'
);

commit;

-- =============================================================================
-- 0127_negocio_servicios_y_fotos.sql — Comunidad Latina
--
-- Call del 3/9 (59:00–1:00:30, punto 14 del feedback): usando la app como
-- «Compañía de construcción» faltan tres cosas —editar la información del
-- negocio, ponerle la foto, y cargar LOS SERVICIOS QUE DA— y el botón «Subir la
-- foto» del perfil-como-negocio llevaba a una página donde no había ningún
-- campo para subir nada (`perfil/perfil-de-negocio.tsx:65`, un `<Link>` a la
-- ficha pública). La subida nunca existió: no es un bug de la UI, es una
-- función que faltaba entera.
--
-- ── LO QUE ESTA MIGRACIÓN AGREGA, Y POR QUÉ ASÍ ─────────────────────────────
--
-- 1 · `listings.services text[]` con CHECK de forma (hasta 12, cada uno de 1 a
--     60 caracteres). Una TABLA aparte sería el reflejo automático y acá sería
--     peor: son doce cadenas cortas, sin metadatos, sin fecha, sin autor, que
--     se leen SIEMPRE junto a la ficha y nunca solas. Una tabla obligaría a un
--     join en cada perfil de negocio, más RLS, más grants y más índices para
--     guardar lo que entra en una columna. El orden es el que cargó el dueño y
--     el array lo conserva; una tabla necesitaría una columna `position` para
--     lo mismo. Si algún día un servicio necesita precio, foto o disponibilidad
--     —o si hay que BUSCAR por servicio— deja de ser una lista y ahí sí es una
--     tabla: queda dicho para que ese día no se discuta.
--
--     Sin índice a propósito: ninguna consulta filtra ni ordena por `services`
--     (se lee con la fila del aviso que ya se busca por id). Un GIN sin
--     consumidor es peso muerto en cada INSERT. El día que Buscar mire adentro
--     de los servicios, el índice entra con esa consulta.
--
-- 2 · `listings.logo_path` y `listings.cover_path`. NO se reusa `photos` y el
--     motivo es la 0116: la ficha del negocio nace SIN fotos justamente para
--     que «ninguna imagen sin moderar entre al directorio por la puerta del
--     alta» — `photos` es la GALERÍA del aviso y su contenido pasa por la cola
--     de /publicar. El logo y la portada son otra cosa: son la CARA DE LA
--     IDENTIDAD, el equivalente exacto de `profiles.avatar_url` y
--     `profiles.cover_url` de una persona, que en este repo se suben y se ven
--     sin cola (0062, 0100). Mezclarlos en `photos` habría hecho las dos cosas
--     mal: el logo aparecería como primera foto de la galería en el hero, y una
--     imagen de identidad entraría por la puerta que la 0116 cerró.
--
--     Guardan el PATH del bucket público `listing-photos` (nunca una URL): la
--     arma el cliente con `listingPhotoUrl()`, igual que el resto de las fotos.
--
-- 3 · Dos funciones `security definer` para escribir esas columnas, y no una
--     policy nueva. Mismo razonamiento —textual— que la 0053: `listings_update`
--     (0004) sólo deja al dueño escribir filas cuyo status quede en
--     ('draft','pending_review','paused','removed'), a propósito, para que un
--     aviso no se reescriba después de pasar moderación. Ese candado se queda.
--     Sin estas funciones, «editar la página de mi negocio» tendría dos finales
--     posibles y los dos malos: un 42501 opaco, o bajar la ficha del directorio
--     cada vez que el dueño corrige un teléfono.
--     Además el enumerador (`scripts/rls-enumerator.mjs`) exige EXACTAMENTE 4
--     policies por tabla: una quinta rompe el gate, y con razón.
--
--     El permiso lo decide `app.can_manage_listing` (0093), que ya es el
--     predicado de esta app para «quién habla en nombre de este negocio»: el
--     dueño del aviso o un miembro ACTIVO con rol de gestión
--     (propietario/administrador/editor). No se inventa una regla nueva de
--     permisos para esta pantalla — eso es exactamente cómo empiezan a
--     divergir la UI y la base.
--
-- 4 · `identidades_disponibles()` pasa a devolver `coalesce(logo_path,
--     photos[1])`. Sin esto el logo recién subido no se vería en el cambiador
--     ni en el avatar del header, que es donde el cliente lo va a buscar
--     primero. Es la MISMA consulta de la 0121 con una expresión cambiada.
--
-- SIN TABLAS NUEVAS → sin RLS ni grants nuevos que declarar. El `grant select`
-- de tabla completa (0107) ya cubre las columnas que se agregan hoy; se
-- re-emite igual al final, explícito e idempotente, porque en esta base ya
-- pasó que los grants se perdieran y el síntoma es la app entera vacía SIN un
-- solo error (una policy sobre una tabla sin GRANT ni se evalúa).
--
-- REVERSIBLE:
--   alter table public.listings drop column if exists services, drop column if
--     exists logo_path, drop column if exists cover_path;
--   drop function if exists public.guardar_pagina_de_negocio(uuid, text, text, text, text, text[], text, text, text, text);
--   drop function if exists public.guardar_fotos_de_negocio(uuid, text, text);
--   drop function if exists app.servicios_de_negocio_validos(text[]);
--   -- y volver a crear identidades_disponibles() como la dejó la 0121.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · La forma de la lista de servicios, en la base
--
-- Un CHECK no admite subconsultas, así que «cada elemento mide entre 1 y 60»
-- no se puede escribir inline: necesita una función IMMUTABLE. Es la misma
-- razón por la que existe `app.uuid_v7()` y no un default con subquery.
-- ---------------------------------------------------------------------------
create or replace function app.servicios_de_negocio_validos(p_servicios text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(pg_catalog.cardinality(p_servicios), 0) <= 12
    and coalesce(
      (
        select pg_catalog.bool_and(
          t.valor is not null
          and pg_catalog.length(pg_catalog.btrim(t.valor)) between 1 and 60
        )
        from pg_catalog.unnest(coalesce(p_servicios, '{}'::text[])) as t(valor)
      ),
      true
    );
$$;

comment on function app.servicios_de_negocio_validos(text[]) is
  'Forma de listings.services: hasta 12 ítems, cada uno de 1 a 60 caracteres una vez recortado, ninguno nulo. IMMUTABLE porque la usa un CHECK (que no admite subconsultas). El array vacío es válido: un negocio sin servicios cargados es el estado normal del día uno. NO lleva revoke de PUBLIC a propósito: quien hace un UPDATE sobre listings necesita EXECUTE para que su CHECK se pueda evaluar.';

-- ⚠️ ACÁ NO VA UN `revoke ... from public`. Es la excepción a la regla que
-- siguen todas las demás funciones de este repo, y tiene un motivo mecánico: un
-- CHECK que llama a una función exige EXECUTE al rol que escribe la fila. Si se
-- le revoca a `public`, TODO update de `listings` empieza a fallar con
-- "permission denied for function" — incluidos los del webhook de pagos y los
-- de moderación. La función no revela nada: recibe un array y devuelve un
-- booleano sobre ese mismo array.

alter table public.listings
  add column if not exists services text[] not null default '{}'::text[];

comment on column public.listings.services is
  'Servicios que ofrece el negocio, en el orden que los cargó su dueño (call 3/9: «agregar los servicios que da cada perfil»). Hasta 12 de hasta 60 caracteres — listings_services_shape. Es una LISTA, no una entidad: si algún día un servicio necesita precio o foto propia, se muda a su tabla. Sólo tiene sentido en kind business/professional; en el resto queda vacío.';

alter table public.listings drop constraint if exists listings_services_shape;
alter table public.listings
  add constraint listings_services_shape
  check (app.servicios_de_negocio_validos(services));

-- ---------------------------------------------------------------------------
-- 2 · La cara del negocio: logo y portada
--
-- Los dos guardan un path DENTRO del bucket público `listing-photos`, bajo el
-- prefijo canónico `{tenant_id}/{listing_id}/` (0012). El CHECK de acá abajo
-- es de forma —largo y nada de recorridos de directorio—; que el path caiga
-- bajo el prefijo del propio aviso lo verifica `guardar_fotos_de_negocio`,
-- que es la única puerta de escritura y sí conoce el tenant y el listing.
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists logo_path  text,
  add column if not exists cover_path text;

comment on column public.listings.logo_path is
  'Foto del negocio (su «avatar»), path del bucket público listing-photos. Separada de `photos` a propósito: photos es la galería del aviso y se modera en la cola de /publicar (0116), mientras que el logo es la cara de la IDENTIDAD —el equivalente de profiles.avatar_url— y sigue el camino de esa: subida validada en el servidor (tipo real, peso, dimensiones), sin cola. Es lo que devuelve identidades_disponibles() como foto del perfil de negocio.';
comment on column public.listings.cover_path is
  'Foto de portada del negocio (banner apaisado de su página), path del bucket público listing-photos. Mismo criterio que logo_path y mismo paralelo: profiles.cover_url (0062).';

alter table public.listings drop constraint if exists listings_business_images_shape;
alter table public.listings
  add constraint listings_business_images_shape
  check (
    (
      logo_path is null
      or (
        pg_catalog.length(logo_path) between 1 and 300
        and pg_catalog.strpos(logo_path, '..') = 0
      )
    )
    and (
      cover_path is null
      or (
        pg_catalog.length(cover_path) between 1 and 300
        and pg_catalog.strpos(cover_path, '..') = 0
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3 · Editar la página del negocio SIN bajarla del directorio
--
-- Devuelve un CÓDIGO estable y no lanza excepciones para los casos previstos
-- (mismo criterio que `verificar_identidad_de_negocio`, 0121): la app traduce
-- el código a copy en español y nadie tiene que leer un SQLSTATE.
--
--   ok · sin_sesion · sin_permiso · datos_invalidos · contacto_premium
--
-- `contacto_premium` es el CHECK `listings_cta_premium_only` (0048) rebotando:
-- en tier free el aviso no puede ni GUARDAR un botón externo. Se atrapa acá
-- para que el comercio lea «los botones de contacto son parte del plan» y no
-- un error genérico. El CHECK NO se saltea — esta función sólo consigue llegar
-- hasta él y contarlo bien.
--
-- Lo que esta función NO toca, y es lo importante: `status`, `tier`,
-- `created_by`, `photos` y los contadores. Editar la página no publica, no
-- despublica y no cambia de dueño.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_pagina_de_negocio(
  p_listing_id  uuid,
  p_title       text,
  p_description text default null,
  p_category    text default null,
  p_area_label  text default null,
  p_services    text[] default '{}'::text[],
  p_phone       text default null,
  p_whatsapp    text default null,
  p_website     text default null,
  p_address     text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant    uuid := app.current_tenant_id();
  v_uid       uuid := auth.uid();
  v_tier      text;
  v_title     text := pg_catalog.btrim(coalesce(p_title, ''));
  v_desc      text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_category  text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_area      text := nullif(pg_catalog.btrim(coalesce(p_area_label, '')), '');
  v_services  text[];
  v_restriccion text;
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  -- Ownership, tenant y kind se revalidan ACÁ dentro: una función definer sin
  -- este chequeo es una policy borrada. `can_manage_listing` (0093) es el mismo
  -- predicado que decide quién edita el horario y quién responde reseñas.
  select l.tier into v_tier
    from public.listings l
   where l.id = p_listing_id
     and l.tenant_id = v_tenant
     and l.kind = 'business';

  if v_tier is null or not app.can_manage_listing(p_listing_id, v_uid) then
    -- "No existe" y "no sos miembro" devuelven lo mismo a propósito:
    -- distinguirlos sería un detector de ids de negocio (0121).
    return 'sin_permiso';
  end if;

  if pg_catalog.length(v_title) < 2 or pg_catalog.length(v_title) > 80 then
    return 'datos_invalidos';
  end if;
  if v_desc is not null and pg_catalog.length(v_desc) > 2000 then
    return 'datos_invalidos';
  end if;
  if v_area is not null and pg_catalog.length(v_area) > 80 then
    return 'datos_invalidos';
  end if;

  -- Cinturón sobre los tirantes de la app: se recorta, se descarta lo vacío y
  -- se corta en 12 CONSERVANDO EL ORDEN (`with ordinality`), que es el orden en
  -- que el dueño los escribió. El CHECK vuelve a validar la forma al escribir.
  v_services := array(
    select pg_catalog.btrim(s.valor)
      from pg_catalog.unnest(coalesce(p_services, '{}'::text[])) with ordinality as s(valor, orden)
     where pg_catalog.btrim(s.valor) <> ''
     order by s.orden
     limit 12
  );

  if not app.servicios_de_negocio_validos(v_services) then
    return 'datos_invalidos';
  end if;

  begin
    update public.listings
       set title        = v_title,
           description  = v_desc,
           area_label   = v_area,
           -- `attrs` se PARCHEA, no se reemplaza: ahí viven también los datos
           -- de otros verticales y un `= jsonb_build_object(...)` los borraría.
           attrs        = case
                            when v_category is null
                              then attrs - 'category'
                            else pg_catalog.jsonb_set(
                                   coalesce(attrs, '{}'::jsonb),
                                   '{category}',
                                   pg_catalog.to_jsonb(v_category),
                                   true
                                 )
                          end,
           services     = v_services,
           -- Los cuatro botones del comercio. En `free` el CHECK de la 0048
           -- los prohíbe: se mandan igual y se traduce el rebote, en vez de
           -- guardarlos «en silencio» y que el dueño crea que cargó algo.
           cta_phone    = nullif(pg_catalog.btrim(coalesce(p_phone, '')), ''),
           cta_whatsapp = nullif(pg_catalog.btrim(coalesce(p_whatsapp, '')), ''),
           cta_website  = nullif(pg_catalog.btrim(coalesce(p_website, '')), ''),
           cta_address  = nullif(pg_catalog.btrim(coalesce(p_address, '')), '')
     where id = p_listing_id
       and tenant_id = v_tenant;
  exception
    when check_violation then
      -- CUÁL check rebotó, no "alguno": `listings_cta_premium_only` (0048) es
      -- el único que esta función puede disparar por una razón que le importa a
      -- la persona («los botones son del plan»). Devolver ese mensaje ante
      -- cualquier otro CHECK sería mandar a alguien a comprar un plan por un
      -- servicio mal escrito.
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'listings_cta_premium_only' then
        return 'contacto_premium';
      end if;
      return 'datos_invalidos';
  end;

  return 'ok';
end;
$fn$;

comment on function public.guardar_pagina_de_negocio(uuid, text, text, text, text, text[], text, text, text, text) is
  'Guarda la página de un negocio (nombre, descripción, rubro, zona, servicios y los cuatro botones de contacto) SIN tocar status, tier ni photos. Existe porque listings_update (0004) le prohíbe al dueño conservar status=published al editar —anti bait-and-switch— y editar la ficha no puede significar bajarla del directorio. Revalida tenant + kind + app.can_manage_listing(0093) adentro. Devuelve ok | sin_sesion | sin_permiso | datos_invalidos | contacto_premium.';

revoke all    on function public.guardar_pagina_de_negocio(uuid, text, text, text, text, text[], text, text, text, text) from public, anon;
grant execute on function public.guardar_pagina_de_negocio(uuid, text, text, text, text, text[], text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Guardar (o quitar) el logo y la portada
--
-- Recibe SIEMPRE los dos valores finales: `null` en uno significa «quitala»,
-- no «dejala como está». Es a propósito — con una sentinela de «no tocar» no
-- habría forma de borrar una foto, que es justo lo que alguien va a querer
-- hacer si subió la equivocada.
--
-- El prefijo del path se verifica ACÁ: la policy `listing_photos_insert` (0012)
-- ya impide subir dentro de la carpeta de otro aviso, pero nada impediría
-- GUARDAR en la ficha propia el path de una foto ajena, que es adivinable si se
-- conocen los dos uuid. Es la misma defensa que `isWithinOwnStoragePrefix` hace
-- para el avatar de una persona (0100), aplicada del lado de la base.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_fotos_de_negocio(
  p_listing_id uuid,
  p_logo       text default null,
  p_cover      text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_uid     uuid := auth.uid();
  v_existe  boolean;
  v_prefijo text;
  v_logo    text := nullif(pg_catalog.btrim(coalesce(p_logo, '')), '');
  v_cover   text := nullif(pg_catalog.btrim(coalesce(p_cover, '')), '');
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  select true into v_existe
    from public.listings l
   where l.id = p_listing_id
     and l.tenant_id = v_tenant
     and l.kind = 'business';

  if v_existe is not true or not app.can_manage_listing(p_listing_id, v_uid) then
    return 'sin_permiso';
  end if;

  v_prefijo := v_tenant::text || '/' || p_listing_id::text || '/';

  if (v_logo is not null and pg_catalog.strpos(v_logo, v_prefijo) <> 1)
     or (v_cover is not null and pg_catalog.strpos(v_cover, v_prefijo) <> 1) then
    return 'ruta_invalida';
  end if;

  update public.listings
     set logo_path  = v_logo,
         cover_path = v_cover
   where id = p_listing_id
     and tenant_id = v_tenant;

  return 'ok';
end;
$fn$;

comment on function public.guardar_fotos_de_negocio(uuid, text, text) is
  'Guarda el logo y la portada de un negocio (paths del bucket listing-photos) sin tocar status ni photos. Recibe los DOS valores finales: null = quitar esa foto. Verifica adentro tenant + kind + app.can_manage_listing (0093) y que cada path caiga bajo el prefijo {tenant}/{listing}/ — la policy de Storage impide subir a la carpeta ajena, pero no impediría guardar en la ficha propia el path de una foto ajena. Devuelve ok | sin_sesion | sin_permiso | ruta_invalida.';

revoke all    on function public.guardar_fotos_de_negocio(uuid, text, text) from public, anon;
grant execute on function public.guardar_fotos_de_negocio(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · La foto del cambiador de perfil ahora sale del LOGO
--
-- `create or replace` y no `drop` + `create`: el tipo de retorno no cambia (son
-- las mismas ocho columnas de la 0121), sólo la expresión de `foto`. El
-- `coalesce` conserva lo que ya se veía: los negocios cuya ficha tiene fotos de
-- galería siguen mostrando la primera hasta que suban un logo de verdad.
--
-- Igual que en la 0116 y la 0121: el REVOKE va JUNTO al create, porque
-- recrearla vuelve a dejarla ejecutable por PUBLIC (o sea también por `anon`) y
-- separarlos es exactamente cómo se perdió la primera vez.
-- ---------------------------------------------------------------------------
create or replace function public.identidades_disponibles()
returns table (
  business_id    uuid,
  nombre         text,
  categoria      text,
  listing_id     uuid,
  foto           text,
  rol            text,
  es_propietario boolean,
  verificada     boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    ba.id,
    ba.name,
    ba.category,
    ba.listing_id,
    (
      select coalesce(l.logo_path, l.photos[1])
        from public.listings l
       where l.id = ba.listing_id
    ),
    bm.role,
    ba.owner_id = (select auth.uid()),
    coalesce(
      (select bv.stripe_status = 'verified'
         from public.business_verifications bv
        where bv.business_id = ba.id),
      false
    )
  from public.business_members bm
  join public.business_accounts ba on ba.id = bm.business_id
  where bm.profile_id = (select auth.uid())
    and bm.status = 'active'
    and ba.tenant_id = (select app.current_tenant_id())
  order by (ba.owner_id = (select auth.uid())) desc, ba.name;
$fn$;

comment on function public.identidades_disponibles() is
  'Negocios con los que quien pregunta puede actuar AHORA, con su ficha, su foto y si su identidad está verificada (0121). Columnas de IDENTIDAD únicamente: los ids de Stripe de business_accounts NO salen de acá (0103), y de business_verifications sale un booleano y no los cinco niveles con sus rechazos. La foto es coalesce(listings.logo_path, listings.photos[1]) desde la 0127 — path del bucket público listing-photos, la resuelve el cliente.';

revoke all on function public.identidades_disponibles() from public, anon;
grant execute on function public.identidades_disponibles() to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · Los grants de la tabla, otra vez y a propósito
--
-- `grant select on public.listings` (sin lista de columnas, 0107) ya alcanza a
-- las columnas nuevas, así que esto es idempotente y no cambia nada hoy. Va
-- igual porque en esta base los grants de tabla ya se perdieron una vez y el
-- modo de falla es el peor que hay: sin GRANT la policy ni se evalúa, la app se
-- ve entera vacía y no aparece un solo error en ningún log.
-- ---------------------------------------------------------------------------
grant select         on public.listings to anon, authenticated;
grant insert, update on public.listings to authenticated;

commit;

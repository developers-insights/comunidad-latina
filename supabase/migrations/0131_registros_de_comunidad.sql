-- =============================================================================
-- 0131_registros_de_comunidad.sql — Comunidad Latina
--
-- «El voluntario tiene que poder registrarse, pero esa lista no la ve nadie,
--  solo la plataforma.»  (Cliente, call del 2026-09-03, 39:20 y 45:40–47:50.)
--
-- Cuatro formularios que la 0130 dejó pendientes, y los cuatro son la MISMA
-- cosa desde el punto de vista de los datos: alguien deja sus datos para que
-- Comunidad Latina lo llame. Nada de esto se publica.
--
--   1. `volunteer`         — me anoto como voluntario (zona, disponibilidad,
--                            en qué puedo ayudar) y acepto una regla corta.
--   2. `volunteer_request` — necesito voluntarios (quién pide, para qué,
--                            cuándo, dónde, cuántas personas).
--   3. `place`             — registro mi lugar: centro de acopio, banco de
--                            comida o comedor.
--   4. `space`             — presto una parte de mi local para actividades de
--                            la comunidad («Espacio comunitario», 1:00:45).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ UNA TABLA Y NO CUATRO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Porque las cuatro tienen el mismo CICLO DE VIDA y el mismo riesgo:
--
--   · nacen `new` cuando una persona autenticada las escribe;
--   · las mira una sola persona del equipo, que las mueve por los mismos
--     cuatro estados (nuevo → contactado → aprobado/descartado);
--   · llevan teléfono y correo de una persona real — el MISMO dato personal,
--     con la misma retención y la misma regla de quién puede leerlo;
--   · ninguna se publica.
--
-- Cuatro tablas serían cuatro copias de las mismas cuatro policies, los mismos
-- grants, el mismo trigger de cupo y cuatro consultas de admin que dicen lo
-- mismo. El día que haya que apretar una regla de privacidad —y en una tabla
-- con teléfonos ese día llega— habría que apretarla en cuatro lugares y
-- acordarse de los cuatro. Lo que de verdad cambia entre los formularios son
-- tres o cuatro campos, y eso vive en `details`.
--
-- Lo que NO se hace por ahorrar tabla: `details` no es un cajón. Su forma la
-- valida el servidor por `kind` (zod, en src/lib/comunidad/registros.ts) y el
-- trigger de acá le pone un techo genérico de tamaño y de tipos, así que ni un
-- INSERT directo por PostgREST puede meter una novela adentro. Escribir la
-- forma por kind TAMBIÉN en SQL sería una segunda copia del zod que se
-- desincroniza en el primer campo nuevo; el techo genérico, en cambio, nunca
-- queda viejo.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ESTO ES PII, Y SE TRATA COMO PII
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El resto del módulo Comunidad es texto público sin datos de contacto: el
-- tablón de pedidos (0120/0130) tiene un detector que RECHAZA un teléfono
-- escrito en el cuerpo, justamente para que la tabla no junte «persona +
-- barrio + necesidad + teléfono». Acá el teléfono es el punto: sin él no hay
-- forma de avisarle a un voluntario que hay algo cerca suyo.
--
-- Tres consecuencias, y las tres están más abajo en código:
--
--   a. LO LEE `domain_admin`, NO `moderator` (§6). La cola de "Pedir ayuda" la
--      abre cualquier moderador porque ahí se decide sobre un TEXTO público;
--      acá se lee el teléfono de un vecino. Es el mismo criterio que ya usa
--      /admin/empleos con los currículums y el mismo rol que exige
--      `community_resources` (0096) para curar el directorio.
--   b. `anon` no recibe NADA — ni grant ni policy. Las dos cosas dicen lo
--      mismo y que lo digan las dos es deliberado (0085).
--   c. RETENCIÓN §5.4: lo descartado se purga a los 180 días por pg_cron (§7).
--      Lo que sigue vivo NO se purga por edad, y es una decisión, no un olvido:
--      la lista de voluntarios ES el producto que pidió el cliente («les
--      avisamos a los voluntarios de la zona»), y una purga por antigüedad la
--      vaciaría sola. Quien se anotó puede retirar sus datos cuando quiera —
--      la policy de DELETE se lo permite (§6) y la app le da el botón.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LO QUE ESTA MIGRACIÓN NO HACE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No crea listado público de nada. El cliente fue explícito con voluntarios
-- («esa lista no la ve nadie») y con Espacio comunitario («al principio no se
-- van a registrar, pero por lo menos ya tenemos el botón»).
--
-- No toca `community_resources` (0096/0099/0105). Cuando el equipo aprueba un
-- `place`, la app crea la ficha ALLÁ con las policies que aquella tabla ya
-- tiene, y acá sólo queda `resource_id` apuntando a lo que se creó. El
-- directorio sigue siendo lo que era: fichas curadas con fuente verificable —
-- y por eso aprobar un lugar exige que alguien del equipo escriba de dónde
-- confirmó los datos, en vez de fabricar una fuente que diga «lo dijo él».
-- =============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · LA TABLA
-- ═══════════════════════════════════════════════════════════════════════════

create table public.community_registrations (
  id             uuid primary key default app.uuid_v7(),

  -- DENORMALIZADO como en todo el módulo: toda policy exige que coincida con
  -- app.current_tenant_id(), así que una fila con el tenant forjado no la ve
  -- nadie. NOT NULL, al revés que community_resources: un consulado le sirve a
  -- todas las comunidades, pero «me anoto de voluntario en Corona» es de UNA
  -- comunidad y lo atiende el equipo de esa comunidad.
  tenant_id      uuid not null references public.tenants(id) on delete cascade,

  -- Quién lo escribió. `on delete cascade`: si la cuenta se va, su teléfono se
  -- va con ella. Un registro huérfano sería un dato de contacto de alguien que
  -- ya no está en la plataforma — exactamente lo que §5.4 no quiere guardar.
  created_by     uuid not null references public.profiles(id) on delete cascade,

  -- Cuál de los cuatro formularios. Cerrado a propósito: es lo que decide qué
  -- pestaña del panel lo muestra y qué forma tiene `details`.
  kind           text not null check (kind in (
                   'volunteer', 'volunteer_request', 'place', 'space'
                 )),

  -- Quién se anota / quién pide / cómo se llama el lugar o el negocio. Un solo
  -- campo para los cuatro: en los cuatro casos la primera línea de la ficha del
  -- panel es «de quién es esto».
  name           text not null check (char_length(btrim(name)) between 2 and 140),

  -- ---- Contacto. Al menos UNO, por el constraint de más abajo: un registro
  -- al que no se puede contestar no es un registro, es una carta sin remitente.
  contact_phone  text check (contact_phone is null
                             or char_length(btrim(contact_phone)) between 5 and 40),
  contact_email  text check (contact_email is null
                             or (char_length(btrim(contact_email)) between 5 and 160
                                 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),

  -- El barrio o la zona, en los cuatro. Es el campo por el que el equipo va a
  -- filtrar de verdad: lo que el cliente describió es «avisarle a los
  -- voluntarios DE LA ZONA». La dirección exacta de un lugar, cuando existe,
  -- va en `details.address`.
  area_label     text not null check (char_length(btrim(area_label)) between 2 and 80),

  -- El texto libre del formulario: en qué puedo ayudar · para qué necesito
  -- voluntarios · qué reciben o dan · cómo es el espacio.
  body           text not null check (char_length(btrim(body)) between 10 and 1000),

  -- Lo propio de cada `kind`. Ver §1: la forma la valida el servidor; acá sólo
  -- se garantiza que sea un objeto y que no crezca sin control.
  details        jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(details) = 'object'
                          and pg_column_size(details) <= 4000),

  -- new       → nadie del equipo lo miró todavía.
  -- contacted → alguien del equipo ya se comunicó.
  -- approved  → sirve. En `place` además existe la ficha del directorio.
  -- discarded → no va (no era voluntariado real, era un trabajo disfrazado,
  --             el lugar no existe). Se conserva 180 días y se purga (§7).
  status         text not null default 'new'
                   check (status in ('new', 'contacted', 'approved', 'discarded')),

  -- Quién del equipo lo movió por última vez y cuándo. Los escribe el TRIGGER,
  -- jamás la app — misma regla que reviewed_by/reviewed_at en la 0120.
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,

  -- Notas internas del equipo («llamé el martes, no atendió»). NO se le
  -- muestran a quien se registró: no hay nada que corregir de su lado, así que
  -- mostrárselas sería sólo hacerlo sentir juzgado. Mismo criterio que
  -- moderation_note en la 0130.
  admin_notes    text check (admin_notes is null
                             or char_length(btrim(admin_notes)) between 2 and 2000),

  -- La ficha del directorio que salió de este registro. Sólo `place` puede
  -- tenerla: los otros tres no se publican en ningún lado.
  -- `on delete set null`: si el equipo baja la ficha, el registro se queda —
  -- es la evidencia de quién la pidió y cuándo se aprobó.
  resource_id    uuid references public.community_resources(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Sin contacto no hay registro: ver el comentario de las columnas.
  constraint community_registrations_need_contact check (
    contact_phone is not null or contact_email is not null
  ),

  -- Revisado a medias no existe: o hay firma y fecha, o nadie lo miró.
  -- Espeja community_help_notices_revision_completa (0120).
  constraint community_registrations_revision_completa check (
    (reviewed_by is null) = (reviewed_at is null)
  ),

  -- Una ficha del directorio sólo puede colgar de un lugar. Un voluntario
  -- «publicado» sería exactamente lo que el cliente pidió que no pasara.
  constraint community_registrations_recurso_solo_de_lugar check (
    resource_id is null or kind = 'place'
  )
);

comment on table public.community_registrations is
  'Los cuatro registros PRIVADOS de Comunidad (0131): voluntario, pedido de voluntarios, lugar (centro de acopio / banco de comida) y espacio comunitario. Nada de esto se publica: lo lee SOLO quien se registró y el equipo de esa comunidad (domain_admin+), y su razón de ser es que Comunidad Latina llame a la persona. Es PII (teléfono/correo): RETENCIÓN §5.4 → lo descartado se purga a los 180 días vía pg_cron (0131, purge-discarded-community-registrations); lo que sigue vivo no se purga por edad porque la lista de voluntarios ES el producto, y quien se anotó puede borrar su propia fila cuando quiera (policy de DELETE). La forma de `details` la valida el servidor por kind (src/lib/comunidad/registros.ts); acá sólo hay un techo de tamaño y de tipos.';

comment on column public.community_registrations.kind is
  'volunteer → me anoto de voluntario. volunteer_request → necesito voluntarios (Comunidad Latina revisa que sea voluntariado real y no trabajo disfrazado antes de avisarle a nadie). place → centro de acopio o banco de comida/comedor. space → negocio que presta parte de su local para clases o charlas. Espeja REGISTRATION_KINDS en src/lib/comunidad/types.ts.';
comment on column public.community_registrations.details is
  'Lo propio de cada kind, como objeto JSON. volunteer: {skills[], availability[], rules_version}. volunteer_request: {requester_type, when_label, people_needed, org_name?}. place: {place_type, address, hours_label}. space: {address, capacity, days_label, activities[]}. NO hay validación por kind en SQL a propósito: sería una segunda copia del zod del servidor que se desincroniza en el primer campo nuevo. Lo que SÍ hay es un techo que nunca queda viejo (objeto, ≤4 KB, valores escalares o arreglos de textos cortos) — ver app.community_registrations_guard().';
comment on column public.community_registrations.admin_notes is
  'Notas internas del equipo. NO se le muestran a quien se registró: a diferencia de community_help_notices.review_note, acá no hay nada que la persona pueda corregir y volver a mandar, así que el texto sería un reproche sin acción posible.';
comment on column public.community_registrations.resource_id is
  'La ficha de community_resources que se creó al aprobar un `place`. Sólo kind=place la puede tener (constraint). El directorio sigue exigiendo fuente verificable: la ficha se crea desde el panel con la fuente que el equipo confirmó, nunca con una fuente fabricada a partir del propio registro.';

-- ---------------------------------------------------------------------------
-- 4.1 · Índices
-- ---------------------------------------------------------------------------

-- La pantalla del panel: una pestaña por kind, filtro por estado, lo más nuevo
-- primero. Es la ÚNICA consulta de listado que existe sobre esta tabla.
create index community_registrations_panel_idx
  on public.community_registrations (tenant_id, kind, status, created_at desc);

-- «¿Ya me registré?» — lo que el formulario pregunta antes de dibujarse, y el
-- conteo del cupo. Por persona dentro de su comunidad.
create index community_registrations_persona_idx
  on public.community_registrations (tenant_id, created_by);

-- EL CUPO, de verdad. El trigger de más abajo también lo verifica, pero un
-- trigger que cuenta y después inserta pierde contra dos envíos simultáneos
-- (doble toque en el botón, reintento de la red): los dos cuentan cero y los
-- dos entran. Este índice no puede perder esa carrera.
--
-- Y no es sólo higiene: sin él, cualquiera puede llenarle la cola al equipo con
-- cien copias del mismo formulario. UNO abierto por formulario y por persona es
-- exactamente lo que el flujo necesita — cuando el equipo lo cierra (aprobado o
-- descartado), la persona puede volver a anotarse.
create unique index community_registrations_abierto_unico
  on public.community_registrations (tenant_id, created_by, kind)
  where status in ('new', 'contacted');

create trigger community_registrations_set_updated_at
before update on public.community_registrations
for each row execute function extensions.moddatetime(updated_at);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · EL GUARDIÁN
--
-- Una policy autoriza FILAS, no COLUMNAS: puede decir «esta fila es tuya»,
-- pero no «no te toques el estado». Todo eso vive acá.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.community_registrations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid    := auth.uid();
  v_admin  boolean := coalesce(
                        app.current_user_role() in ('domain_admin', 'global_admin'),
                        false);
  v_claves int;
  v_clave  text;
  v_valor  jsonb;
  v_item   jsonb;
begin
  -- ---- Techo genérico de `details` (INSERT y UPDATE) ---------------------
  -- No valida la forma por kind (§1): valida que no pueda usarse como depósito
  -- de texto arbitrario, que es lo único que un INSERT directo por PostgREST
  -- podría intentar sin pasar por el zod del servidor.
  if new.details is not null then
    select count(*) into v_claves from jsonb_object_keys(new.details);
    if v_claves > 14 then
      raise exception 'DETAILS_SHAPE: el detalle del formulario tiene demasiados campos.';
    end if;

    for v_clave, v_valor in select * from jsonb_each(new.details) loop
      if jsonb_typeof(v_valor) = 'string' then
        if char_length(v_valor #>> '{}') > 400 then
          raise exception 'DETAILS_SHAPE: el campo % es demasiado largo.', v_clave;
        end if;
      elsif jsonb_typeof(v_valor) = 'array' then
        if jsonb_array_length(v_valor) > 12 then
          raise exception 'DETAILS_SHAPE: el campo % tiene demasiadas opciones.', v_clave;
        end if;
        for v_item in select * from jsonb_array_elements(v_valor) loop
          if jsonb_typeof(v_item) <> 'string' or char_length(v_item #>> '{}') > 400 then
            raise exception 'DETAILS_SHAPE: el campo % tiene un valor que no se puede guardar.', v_clave;
          end if;
        end loop;
      elsif jsonb_typeof(v_valor) not in ('number', 'boolean') then
        raise exception 'DETAILS_SHAPE: el campo % tiene un valor que no se puede guardar.', v_clave;
      end if;
    end loop;
  end if;

  -- ---- Alta ---------------------------------------------------------------
  if tg_op = 'INSERT' then
    -- Nada de la decisión del equipo se puede sembrar desde el alta, ni por
    -- accidente ni a propósito: un registro no nace aprobado ni con notas.
    new.status      := 'new';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.admin_notes := null;
    new.resource_id := null;

    -- Con auth.uid() null (service_role, seed, cron) las reglas de autoría no
    -- aplican: mismo contrato que el resto del módulo.
    if v_uid is not null then
      if new.created_by <> v_uid then
        raise exception 'FORBIDDEN: un registro se deja en primera persona.';
      end if;
      if new.tenant_id is distinct from app.current_tenant_id() then
        raise exception 'FORBIDDEN: ese registro no es de tu comunidad.';
      end if;

      -- El cupo, otra vez. El índice único de arriba es el que gana la carrera;
      -- esto existe para poder contestar con una frase en castellano en vez de
      -- con un 23505, que es lo que la persona va a ver el 99% de las veces.
      if exists (
        select 1
          from public.community_registrations r
         where r.tenant_id  = new.tenant_id
           and r.created_by = new.created_by
           and r.kind       = new.kind
           and r.status in ('new', 'contacted')
      ) then
        raise exception 'ALREADY_OPEN: ya tenés un registro de este tipo esperando respuesta.';
      end if;
    end if;

    return new;
  end if;

  -- ---- Modificación -------------------------------------------------------
  -- Lo que la persona escribió es INMUTABLE. Un registro no es una publicación
  -- que se corrige: es lo que se le dijo al equipo, y el equipo ya puede
  -- haberlo leído y llamado. Si algo salió mal se retira (DELETE) y se vuelve a
  -- mandar — que además libera el cupo.
  new.id            := old.id;
  new.tenant_id     := old.tenant_id;
  new.created_by    := old.created_by;
  new.kind          := old.kind;
  new.name          := old.name;
  new.contact_phone := old.contact_phone;
  new.contact_email := old.contact_email;
  new.area_label    := old.area_label;
  new.body          := old.body;
  new.details       := old.details;
  new.created_at    := old.created_at;

  if v_uid is not null then
    if not v_admin then
      raise exception 'FORBIDDEN: sólo el equipo de la comunidad resuelve un registro.';
    end if;

    -- A `new` no se vuelve: «nuevo» significa «nadie del equipo lo miró
    -- todavía», y una vez que alguien lo miró eso deja de ser cierto. Todo lo
    -- demás sí: descartar por error tiene vuelta, aprobar tarde también.
    if new.status is distinct from old.status and new.status = 'new' then
      raise exception 'BAD_TRANSITION: un registro no vuelve a estar sin mirar.';
    end if;
  end if;

  -- La firma la pone el trigger, nunca la app: así no queda pegada a una
  -- decisión que no se tomó.
  if v_uid is not null and new.status is distinct from old.status then
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;

comment on function app.community_registrations_guard() is
  'Guardián de community_registrations (0131): techo genérico de `details` (objeto, ≤14 claves, valores escalares o arreglos de textos ≤400); alta siempre en primera persona, en la propia comunidad, en estado `new` y con UNO abierto por formulario y por persona; contenido CONGELADO en el update (un registro no se edita: se retira y se vuelve a mandar); sólo domain_admin+ lo resuelve, nunca vuelve a `new`, y la firma reviewed_by/reviewed_at la escribe este trigger. Con auth.uid() null (service_role/seed/cron) las reglas de autoría no aplican.';

revoke execute on function app.community_registrations_guard() from public, anon;

create trigger community_registrations_guard
before insert or update on public.community_registrations
for each row execute function app.community_registrations_guard();

-- Cuenta suspendida no se anota — mismo trigger que job_applications (0040),
-- listing_comments (0038) y community_help_notices (0120).
create trigger community_registrations_enforce_account_active
before insert on public.community_registrations
for each row execute function app.enforce_account_active();


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · RLS — las cuatro policies canónicas (gate `npm run check:rls`)
--
-- ⚠️ SIN `anon`, y acá pesa más que en ninguna otra tabla del módulo: una fila
-- de ésta es «nombre + barrio + teléfono» de una persona concreta. El tablón de
-- pedidos ya se cierra a quien no tiene cuenta y ahí lo que hay es texto sin
-- datos de contacto; esto es directamente una agenda.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.community_registrations enable row level security;
alter table public.community_registrations force row level security;

-- Lo propio (para que el formulario pueda decir «ya te registraste» y para que
-- la persona pueda retirarlo) y, para el equipo de la comunidad, todo.
--
-- `domain_admin` y no `is_staff()`: ver §2.a. Es la MISMA condición que
-- community_resources (0096) — la sección se opera, no se modera.
create policy community_registrations_select on public.community_registrations
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      created_by = (select auth.uid())
      or (select app.current_user_role()) in ('domain_admin', 'global_admin')
    )
  )
  or (select app.is_global_admin())
);

-- Se deja en primera persona y en la propia comunidad. El trigger vuelve a
-- exigirlo y agrega lo que una policy no puede decir: el estado inicial y el
-- cupo de uno abierto por formulario.
create policy community_registrations_insert on public.community_registrations
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'new'
);

-- Sólo el equipo resuelve. Quien se registró NO puede editar lo que mandó: si
-- se equivocó, lo retira y lo vuelve a escribir (ver el trigger).
create policy community_registrations_update on public.community_registrations
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- Y acá sí borra la persona, no sólo el equipo.
--
-- Es lo contrario de lo que hace el resto del módulo, donde nada se borra de
-- verdad porque la fila es la evidencia de una moderación. Acá no hay nada que
-- auditar: es el teléfono de alguien que quiso que lo llamaran y ya no quiere.
-- El derecho a retirarlo no puede depender de que exista un botón — vive en la
-- policy, y la app le da el botón.
create policy community_registrations_delete on public.community_registrations
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre y la 0120 y la 0130 lo
-- repitieron: los default privileges de este esquema —compartido con otro
-- producto— no alcanzan a `anon` ni garantizan nada para `authenticated`, así
-- que una tabla nueva NACE sin acceso y sin un solo error visible: la app se ve
-- vacía y no falla nada. `anon` no recibe NADA a propósito; el grant que falta
-- y la policy que falta dicen lo mismo, y que lo digan las dos es deliberado.
revoke all on table public.community_registrations from anon, authenticated;
grant select, insert, update, delete on table public.community_registrations to authenticated;
grant all                            on table public.community_registrations to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · RETENCIÓN (§5.4) — lo descartado no se guarda para siempre
--
-- Un registro descartado es un teléfono que ya se decidió no usar. Se conserva
-- 180 días para poder revisar una decisión y para que el mismo pedido no vuelva
-- a entrar sin que nadie se acuerde de por qué se bajó; pasado eso, no hay
-- ninguna razón para tenerlo.
--
-- Lo vivo (new / contacted / approved) NO se purga por edad: ver §2.c.
--
-- Mismo patrón idempotente que 0013: si el job ya existe se re-agenda igual, y
-- corre como `postgres`, que bypassa RLS.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  perform cron.unschedule('purge-discarded-community-registrations');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'purge-discarded-community-registrations',
  '50 3 * * *',
  $$delete from public.community_registrations
     where status = 'discarded'
       and coalesce(reviewed_at, created_at) < now() - interval '180 days'$$
);

commit;

-- =============================================================================
-- 0133_grupos_de_chat.sql — Comunidad Latina
--
-- GRUPOS DE CHAT: que la gente se junte por interés y hable adentro.
--
-- Pedido textual del cliente (call del 3/9, 23:50–29:30, punto 7 del feedback):
--
--   «En el contrato teníamos que ellos iban a hacer grupos» — grupos para ir
--   en bici, esquiar, real estate, emprendedores; crear o unirse, chatear
--   adentro, «como hace WhatsApp al momento de crear un grupo».
--
-- Nacho mandó un mockup (bandeja, buscador, crear grupo con nombre /
-- descripción / foto / público-privado, chat 1-a-1 y de grupo, info del grupo
-- con miembros, admin y salir) y el cliente lo aprobó.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ TABLAS NUEVAS Y NO `conversations` + `messages`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tentación obvia era hacer que `conversations` acepte N participantes con
-- una tabla puente y reusar `messages`. Se descartó por tres cosas concretas
-- que están escritas en la 0006 y que un grupo rompe de raíz:
--
--   · `conversations` es una relación de DOS con nombre y apellido:
--     `created_by` / `counterpart_id` NOT NULL, `conversations_no_self`, y una
--     máquina de estados pending → accepted que existe para el CONTACTO
--     PROTEGIDO (§9.2): «el interesado solicita y la contraparte acepta». Un
--     grupo público al que te unís de un toque no tiene contraparte que
--     acepte. Convertir esas dos columnas en nullables apagaría el invariante
--     que protege todo el contacto por avisos — el 95% del tráfico real de
--     mensajería — para habilitar el 5% nuevo.
--
--   · `messages_select` (0006) resuelve la pertenencia con un EXISTS contra
--     `conversations` comparando dos columnas escalares. Con N participantes
--     ese EXISTS pasa a ser un join contra una tabla puente en CADA fila de
--     CADA lectura del chat 1-a-1. Se paga en la superficie más caliente de la
--     app por una función que ni siquiera la usa.
--
--   · La privacidad no es la misma. Un mensaje directo lo leen dos personas y
--     nadie más — ni staff ni global_admin, por policy (§5.4, «no somos un
--     honeypot de chats»). Un grupo de 40 personas ya es semipúblico: quien
--     entra sabe que lo leen 40. Son dos contratos distintos y colapsarlos en
--     una tabla obliga a que el más laxo mande.
--
-- Lo que SÍ se hereda, palabra por palabra: el TTL de 90 días con trigger que
-- lo fuerza (no un DEFAULT evadible por PostgREST), la purga por pg_cron, el
-- gate de cuenta activa, y la regla de que la RLS es la frontera real.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LAS TRES TABLAS Y POR QUÉ SON TRES
-- ═══════════════════════════════════════════════════════════════════════════
--
--   chat_groups          — la ficha del grupo (nombre, de qué se trata, si es
--                          público, quién lo creó, si sigue abierto).
--   chat_group_members   — quién está adentro y con qué rol. Es la tabla de
--                          AUTORIZACIÓN: todas las policies de las otras dos
--                          se resuelven mirando acá.
--   chat_group_messages  — lo que se dice. TTL 90 días como `messages`.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA RECURSIÓN QUE HABRÍA ROTO TODO (y por qué hay funciones DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La policy natural de `chat_group_members` es «ves la lista si sos miembro»,
-- o sea: un EXISTS de `chat_group_members` DENTRO de una policy de
-- `chat_group_members`. Postgres evalúa la policy de la subconsulta, que
-- vuelve a evaluar la policy… y aborta con `infinite recursion detected in
-- policy for relation`. No es un caso raro: es el primer error que aparece el
-- día que se prueba la app.
--
-- Por eso la pertenencia se pregunta SIEMPRE por `app.es_miembro_de_grupo()`,
-- que es SECURITY DEFINER y por lo tanto NO evalúa RLS al leer la tabla. Las
-- tres funciones de §5 son la única forma de preguntar "¿este soy yo adentro?"
-- en este archivo. Si mañana alguien escribe un EXISTS directo en una policy
-- de members, la app se cae entera en la primera lectura.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LOS BLOQUEOS ENTRE PERSONAS NO SILENCIAN UN GRUPO (y sí una invitación)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `user_blocks` (0020) corta el contacto DIRECTO. En un grupo de 30 personas,
-- esconder los mensajes de una sola dejaría una conversación con agujeros:
-- respuestas a algo que no se ve, hilos que no cierran. Peor: le avisaría a
-- quien bloqueó que la otra persona sigue ahí, sin darle ninguna herramienta.
--
-- La decisión: en un grupo PÚBLICO al que entrás por tu cuenta, ves todo lo
-- que se dice adentro — entrar es tu decisión y podés salir de un toque. Lo
-- que el bloqueo SÍ corta es que te metan: nadie puede invitarte a un grupo si
-- hay bloqueo en cualquier dirección entre los dos (policy de INSERT de
-- members). Así el bloqueo sigue significando "esta persona no me puede
-- alcanzar", que es lo que promete.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 5. GRANTS EXPLÍCITOS — la lección de la 0085
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Este schema es compartido con otro producto y sus default privileges no
-- alcanzan a `authenticated`: una tabla nueva NACE sin acceso y la app se ve
-- vacía SIN UN SOLO ERROR (sin GRANT de tabla la policy ni se evalúa). Las
-- tres tablas de acá llevan su grant escrito a mano, y `anon` no recibe nada:
-- un grupo de la comunidad no es contenido público de SEO.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · chat_groups — la ficha del grupo
-- ---------------------------------------------------------------------------
create table public.chat_groups (
  id            uuid primary key default app.uuid_v7(),

  -- DENORMALIZADO como en el resto del repo: toda policy exige que coincida
  -- con app.current_tenant_id(), así que una fila con el tenant forjado no la
  -- ve nadie.
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  created_by    uuid not null references public.profiles(id) on delete cascade,

  name          text not null check (char_length(btrim(name)) between 3 and 60),
  description   text check (description is null
                            or char_length(btrim(description)) between 1 and 300),

  -- CATÁLOGO CERRADO. Un `category` de texto libre convierte el descubrimiento
  -- en una lista de sinónimos ("bici", "bicicleta", "ciclismo") y rompe el
  -- filtro que es la única forma de encontrar un grupo cuando hay cien.
  -- src/lib/messaging/grupos.ts espeja esta lista y hay un test que lo cuida.
  category      text not null check (category in (
                  'deportes', 'emprendedores', 'real_estate', 'padres',
                  'fe', 'musica', 'comida', 'barrio', 'otro'
                )),

  -- public  = aparece en Descubrir y cualquiera de la comunidad entra solo.
  -- private = no aparece en ningún listado; se entra sólo por invitación de
  --           quien administra.
  visibility    text not null default 'public'
                  check (visibility in ('public', 'private')),

  -- URL pública de la foto, no una ruta de Storage. Es lo que consume
  -- `<Avatar src>` en toda la app y lo mismo que guarda `profiles.avatar_url`:
  -- guardar una ruta obligaría a que cada pantalla supiera de qué bucket sale.
  -- La foto se sube al bucket `avatars` con el prefijo del propio usuario, que
  -- la policy `avatars_insert` (0012) valida contra el JWT.
  avatar_url    text,

  -- active = se puede escribir. closed = queda para leer, nadie escribe más.
  -- No hay DELETE: cerrar preserva lo conversado hasta que lo purgue el TTL,
  -- y borrar de un toque un grupo de 40 personas es un botón que no se puede
  -- deshacer.
  status        text not null default 'active'
                  check (status in ('active', 'closed')),

  -- Contador denormalizado, lo mantiene un trigger. Existe porque la pantalla
  -- de Descubrir muestra "12 miembros" en CADA tarjeta: sin esto es un count()
  -- por fila y el listado pasa a ser N+1.
  member_count  integer not null default 0 check (member_count >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.chat_groups is
  'Grupos de chat por interés (0133). Pedido del cliente: "grupos para que la gente se junte — ir en bici, esquiar, real estate, emprendedores". NO reutiliza conversations/messages: esa pareja es el contacto protegido de DOS personas con máquina de estados pending/accepted, y un grupo público no tiene contraparte que acepte (ver §1 de la migración). Sin DELETE por diseño: se cierra (status=closed) y el TTL de los mensajes hace el resto.';
comment on column public.chat_groups.category is
  'Catálogo CERRADO de nueve temas. Texto libre convertiría el filtro de Descubrir en una lista de sinónimos ("bici" / "bicicleta" / "ciclismo") y haría imposible encontrar un grupo cuando haya cien. src/lib/messaging/grupos.ts espeja esta lista.';
comment on column public.chat_groups.visibility is
  'public = aparece en Descubrir y cualquiera de la comunidad entra de un toque. private = no aparece en ningún listado y sólo se entra por invitación de quien administra. La policy de SELECT es la que lo hace cierto, no la UI.';
comment on column public.chat_groups.avatar_url is
  'URL pública de la foto del grupo, no una ruta de Storage — es lo que consume <Avatar src> en toda la app, igual que profiles.avatar_url. Se sube al bucket `avatars` bajo el prefijo {tenant}/{uid}/ del creador, que la policy avatars_insert (0012) valida contra el JWT.';
comment on column public.chat_groups.status is
  'active = se escribe. closed = queda para leer. No existe DELETE: borrar de un toque un grupo de cuarenta personas es una acción que nadie puede deshacer, y lo conversado ya tiene su propio TTL de 90 días.';
comment on column public.chat_groups.member_count is
  'Denormalizado, lo mantiene app.recontar_miembros_del_grupo(). La pantalla de Descubrir lo muestra en CADA tarjeta: resolverlo con count() por fila convierte el listado en N+1.';

-- Descubrir: los públicos y activos de una comunidad, lo más nuevo primero.
-- Cubre también el filtro por categoría porque `category` va antes del orden.
create index chat_groups_descubrir_idx
  on public.chat_groups (tenant_id, category, created_at desc, id desc)
  where visibility = 'public' and status = 'active';

-- El mismo listado SIN filtro de categoría ("Todos los grupos").
create index chat_groups_descubrir_todos_idx
  on public.chat_groups (tenant_id, created_at desc, id desc)
  where visibility = 'public' and status = 'active';

create index chat_groups_creador_idx on public.chat_groups (created_by);

-- DOS grupos con el mismo nombre en la misma comunidad hacen que Descubrir
-- sea imposible de usar: nadie sabe a cuál entrar. Parcial sobre los activos
-- a propósito — un grupo cerrado no debería reservar el nombre para siempre.
create unique index chat_groups_nombre_unico_idx
  on public.chat_groups (tenant_id, lower(btrim(name)))
  where status = 'active';

create trigger chat_groups_set_updated_at
before update on public.chat_groups
for each row execute function extensions.moddatetime(updated_at);


-- ---------------------------------------------------------------------------
-- 2 · chat_group_members — quién está adentro (y la tabla de autorización)
-- ---------------------------------------------------------------------------
create table public.chat_group_members (
  group_id   uuid not null references public.chat_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  -- owner  = quien lo creó. Uno solo, no puede salir (cierra el grupo).
  -- admin  = puede invitar, expulsar y editar la ficha.
  -- member = escribe y lee.
  role       text not null default 'member'
               check (role in ('owner', 'admin', 'member')),

  joined_at  timestamptz not null default now(),

  primary key (group_id, profile_id)
);

comment on table public.chat_group_members is
  'Membresía de un grupo de chat (0133). Es LA TABLA DE AUTORIZACIÓN del módulo: las policies de chat_groups y chat_group_messages se resuelven mirando acá, siempre a través de app.es_miembro_de_grupo() / app.rol_en_grupo(). Nunca con un EXISTS directo: una policy de esta tabla que consulte esta tabla explota con "infinite recursion detected in policy" (ver §3 de la migración).';
comment on column public.chat_group_members.role is
  'owner = quien creó el grupo; hay exactamente uno y NO puede salir (si ya no va más, cierra el grupo — así nadie queda con un grupo sin dueño). admin = invita, expulsa y edita la ficha. member = lee y escribe.';

-- La PK (group_id, profile_id) ya cubre "la lista de miembros de un grupo" y
-- garantiza que nadie entre dos veces. Este índice cubre la otra dirección:
-- "mis grupos", que es la pestaña que más se abre.
create index chat_group_members_mios_idx
  on public.chat_group_members (profile_id, joined_at desc);

create index chat_group_members_tenant_idx
  on public.chat_group_members (tenant_id);

-- UN solo owner por grupo. Sin esto, un UPDATE de rol podría dejar dos (o
-- ninguno) y "el creador administra" dejaría de tener sujeto.
create unique index chat_group_members_un_solo_owner_idx
  on public.chat_group_members (group_id)
  where role = 'owner';


-- ---------------------------------------------------------------------------
-- 3 · chat_group_messages — lo que se dice adentro
-- ---------------------------------------------------------------------------
create table public.chat_group_messages (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  group_id   uuid not null references public.chat_groups(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,

  body       text not null check (char_length(btrim(body)) between 1 and 2000),

  -- MISMO TTL que `messages` (0006, §5.4): lo que se borra rápido no es
  -- subpoenable después. Y por la misma razón que allá, lo fuerza un trigger
  -- y no el DEFAULT: un INSERT por PostgREST con un expires_at lejano evadiría
  -- la purga para siempre.
  expires_at timestamptz not null default now() + interval '90 days',

  -- Borrado suave: lo baja su autor o quien administra. La policy de SELECT
  -- esconde los borrados, así que la fila sobrevive sólo hasta la purga y
  -- nadie la lee mientras tanto.
  deleted_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.chat_group_messages is
  'Mensajes de un grupo de chat (0133) con el MISMO TTL de 90 días que public.messages: pg_cron los purga (purge-expired-group-messages). Los lee sólo quien es miembro; los escribe sólo quien es miembro de un grupo activo. Sin edición: un mensaje se baja, no se reescribe.';
comment on column public.chat_group_messages.expires_at is
  'TTL duro NO NEGOCIABLE, igual que messages.expires_at: app.forzar_ttl_de_mensaje_de_grupo() lo pisa a now()+90d en cada INSERT. Sin el trigger, un INSERT vía PostgREST con expires_at lejano crearía un mensaje imborrable.';
comment on column public.chat_group_messages.deleted_at is
  'Borrado suave. Lo escribe su autor o quien administra el grupo; la policy de SELECT esconde la fila desde ese instante. No se hace DELETE físico para que la moderación pueda ver qué se bajó mientras el reporte esté abierto.';

-- El chat: la última página de un grupo. Cubre el ORDER BY del keyset.
create index chat_group_messages_hilo_idx
  on public.chat_group_messages (group_id, created_at desc, id desc);

-- La purga diaria.
create index chat_group_messages_expira_idx
  on public.chat_group_messages (expires_at);

-- "¿Qué escribió esta persona?" — lo usa la moderación al resolver un reporte.
create index chat_group_messages_autor_idx
  on public.chat_group_messages (sender_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 4 · Las tres preguntas de autorización, como funciones DEFINER
--
-- SON LA ÚNICA FORMA de preguntar por la pertenencia en este archivo. Ver §3
-- de la cabecera: un EXISTS directo dentro de una policy de
-- chat_group_members se aborta con "infinite recursion detected in policy".
--
-- SECURITY DEFINER + `search_path = ''` + todo calificado, como cada función
-- de este repo que consulta otra tabla desde una policy.
-- ---------------------------------------------------------------------------
create or replace function app.es_miembro_de_grupo(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_group_members m
     where m.group_id = p_group
       and m.profile_id = auth.uid()
  );
$$;

comment on function app.es_miembro_de_grupo(uuid) is
  '¿auth.uid() está adentro de este grupo? SECURITY DEFINER a propósito: es lo único que rompe la recursión de policies sobre chat_group_members (§3 de la 0133). Devuelve false sin sesión.';

create or replace function app.rol_en_grupo(p_group uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = auth.uid();
$$;

comment on function app.rol_en_grupo(uuid) is
  'Rol de auth.uid() en el grupo (owner | admin | member) o NULL si no es miembro. Misma razón de SECURITY DEFINER que app.es_miembro_de_grupo().';

create or replace function app.grupo_abierto(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_groups g
     where g.id = p_group
       and g.status = 'active'
  );
$$;

comment on function app.grupo_abierto(uuid) is
  '¿El grupo sigue aceptando mensajes? Se pregunta desde la policy de INSERT de chat_group_messages: sin esto, "cerrar el grupo" sería sólo un cartel en la pantalla.';

revoke execute on function app.es_miembro_de_grupo(uuid) from public, anon;
revoke execute on function app.rol_en_grupo(uuid)       from public, anon;
revoke execute on function app.grupo_abierto(uuid)      from public, anon;
grant execute on function app.es_miembro_de_grupo(uuid) to authenticated, service_role;
grant execute on function app.rol_en_grupo(uuid)        to authenticated, service_role;
grant execute on function app.grupo_abierto(uuid)       to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5 · Triggers
-- ---------------------------------------------------------------------------

-- 5.1 · Quien lo crea queda adentro como owner, en la misma transacción.
--
-- Sin esto habría una ventana —entre el INSERT del grupo y el INSERT de la
-- membresía desde la app— en la que el grupo existe y NADIE lo administra: si
-- la segunda escritura falla, queda un grupo huérfano que ni su creador puede
-- editar ni cerrar. Va en un trigger y no en la server action justamente para
-- que las dos filas nazcan juntas o no nazca ninguna.
create or replace function app.grupo_nace_con_su_dueno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_group_members (group_id, profile_id, tenant_id, role)
  values (new.id, new.created_by, new.tenant_id, 'owner')
  on conflict (group_id, profile_id) do nothing;
  return new;
end;
$$;

comment on function app.grupo_nace_con_su_dueno() is
  'AFTER INSERT en chat_groups: mete a su creador como owner en la MISMA transacción. Sin esto existe una ventana donde el grupo está creado y nadie lo administra — un grupo huérfano que ni su autor puede cerrar.';

revoke execute on function app.grupo_nace_con_su_dueno() from public, anon;

create trigger chat_groups_nace_con_su_dueno
after insert on public.chat_groups
for each row execute function app.grupo_nace_con_su_dueno();


-- 5.2 · El contador de miembros.
create or replace function app.recontar_miembros_del_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := coalesce(new.group_id, old.group_id);
begin
  update public.chat_groups g
     set member_count = (
           select count(*)
             from public.chat_group_members m
            where m.group_id = v_group
         )
   where g.id = v_group;
  return null;
end;
$$;

comment on function app.recontar_miembros_del_grupo() is
  'Mantiene chat_groups.member_count. Recuenta en vez de sumar/restar: un recuento es idempotente y sobrevive a un backfill o a un borrado en cascada, mientras que un +1/-1 se desincroniza para siempre en cuanto una fila entra por un camino que no pasó por el trigger.';

revoke execute on function app.recontar_miembros_del_grupo() from public, anon;

create trigger chat_group_members_recuento
after insert or delete on public.chat_group_members
for each row execute function app.recontar_miembros_del_grupo();


-- 5.3 · El TTL de 90 días no lo negocia el cliente. Mismo patrón, palabra por
--       palabra, que app.messages_force_ttl() en la 0006.
create or replace function app.forzar_ttl_de_mensaje_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  new.expires_at := now() + interval '90 days';
  return new;
end;
$$;

comment on function app.forzar_ttl_de_mensaje_de_grupo() is
  'BEFORE INSERT en chat_group_messages: fuerza expires_at = now()+90d ignorando el valor del cliente (§5.4). service_role exento, para seed y migraciones. Gemelo de app.messages_force_ttl() (0006).';

revoke execute on function app.forzar_ttl_de_mensaje_de_grupo() from public, anon;

create trigger chat_group_messages_ttl
before insert on public.chat_group_messages
for each row execute function app.forzar_ttl_de_mensaje_de_grupo();


-- 5.4 · Columnas congeladas: de un grupo se edita la ficha, nunca su identidad.
create or replace function app.proteger_columnas_del_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'PROTECTED_COLUMNS: de un grupo se edita la ficha, no quién lo creó ni de qué comunidad es';
  end if;

  return new;
end;
$$;

comment on function app.proteger_columnas_del_grupo() is
  'Congela tenant_id / created_by / created_at de chat_groups. Mismo criterio que app.protect_conversation_columns() (0006): una policy autoriza FILAS, no COLUMNAS, así que el candado por columna va en un trigger.';

revoke execute on function app.proteger_columnas_del_grupo() from public, anon;

create trigger chat_groups_proteger_columnas
before update on public.chat_groups
for each row execute function app.proteger_columnas_del_grupo();


-- 5.5 · Una cuenta suspendida no crea grupos ni escribe en ellos. Mismo
--       trigger que ya cubre posts, comments, messages y conversations (0021).
create trigger chat_groups_enforce_account_active
before insert on public.chat_groups
for each row execute function app.enforce_account_active();

create trigger chat_group_messages_enforce_account_active
before insert on public.chat_group_messages
for each row execute function app.enforce_account_active();


-- ---------------------------------------------------------------------------
-- 6 · RLS
-- ---------------------------------------------------------------------------
alter table public.chat_groups         enable row level security;
alter table public.chat_groups         force  row level security;
alter table public.chat_group_members  enable row level security;
alter table public.chat_group_members  force  row level security;
alter table public.chat_group_messages enable row level security;
alter table public.chat_group_messages force  row level security;

-- ── chat_groups ─────────────────────────────────────────────────────────────

-- Ver: los públicos de MI comunidad, y los privados donde estoy adentro.
-- Un privado del que no soy miembro no existe: ni su nombre, ni su descripción,
-- ni el hecho de que exista.
create policy chat_groups_select on public.chat_groups
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    visibility = 'public'
    or app.es_miembro_de_grupo(id)
  )
);

-- Crear: yo, en mi comunidad, y nace abierto. El owner lo pone el trigger 5.1.
create policy chat_groups_insert on public.chat_groups
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and status = 'active'
);

-- Editar la ficha y cerrarlo: sólo quien administra.
create policy chat_groups_update on public.chat_groups
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.rol_en_grupo(id) in ('owner', 'admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and app.rol_en_grupo(id) in ('owner', 'admin')
);

-- Sin DELETE para nadie salvo staff de la comunidad: cerrar es la operación de
-- producto, borrar es la de moderación.
create policy chat_groups_delete on public.chat_groups
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- ── chat_group_members ──────────────────────────────────────────────────────

-- Ver la lista de miembros: sólo desde adentro. `profile_id = auth.uid()` va
-- aparte para que una persona siempre pueda leer SU propia fila —es lo que
-- necesita la app para saber si sos miembro y con qué rol— incluso si mañana
-- la primera rama cambia.
create policy chat_group_members_select on public.chat_group_members
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or app.es_miembro_de_grupo(group_id)
  )
);

-- Entrar. Dos caminos y ninguno más:
--   (a) ME UNO YO a un grupo PÚBLICO y ACTIVO de mi comunidad, como member.
--       No puedo auto-asignarme owner ni admin.
--   (b) ME SUMA quien administra, a cualquier grupo activo suyo, como member —
--       y NO si hay bloqueo entre los dos en cualquier dirección (§4).
create policy chat_group_members_insert on public.chat_group_members
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and role = 'member'
  and exists (
    select 1 from public.chat_groups g
     where g.id = chat_group_members.group_id
       and g.tenant_id = chat_group_members.tenant_id
       and g.status = 'active'
       and (
         -- (a) auto-alta en un público
         (
           chat_group_members.profile_id = (select auth.uid())
           and g.visibility = 'public'
         )
         -- (b) invitación de quien administra
         or (
           app.rol_en_grupo(g.id) in ('owner', 'admin')
           and not app.pair_blocked((select auth.uid()), chat_group_members.profile_id)
         )
       )
  )
  and exists (
    select 1 from public.profiles p
     where p.id = chat_group_members.profile_id
       and p.tenant_id = chat_group_members.tenant_id
  )
);

-- Cambiar el rol: sólo quien administra, y NUNCA sobre el owner (el índice
-- único de §2 ya impide un segundo owner; esto impide degradar al que hay).
create policy chat_group_members_update on public.chat_group_members
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and role <> 'owner'
  and app.rol_en_grupo(group_id) in ('owner', 'admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and role in ('admin', 'member')
  and app.rol_en_grupo(group_id) in ('owner', 'admin')
);

-- Salir o expulsar. El owner NO sale: si ya no quiere el grupo, lo cierra —
-- así nadie queda administrando algo que no eligió, y ningún grupo queda sin
-- dueño. La app lo dice con esas palabras.
create policy chat_group_members_delete on public.chat_group_members
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and role <> 'owner'
  and (
    profile_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
  )
);

-- ── chat_group_messages ─────────────────────────────────────────────────────

-- Leer: miembro, no vencido, no borrado. Los tres a la vez.
create policy chat_group_messages_select on public.chat_group_messages
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and expires_at > now()
  and deleted_at is null
  and app.es_miembro_de_grupo(group_id)
);

-- Escribir: soy yo, soy miembro, y el grupo está abierto. Quien fue expulsado
-- deja de ser miembro en el acto y por lo tanto deja de escribir — no hace
-- falta una lista de silenciados.
create policy chat_group_messages_insert on public.chat_group_messages
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
  and deleted_at is null
  and app.es_miembro_de_grupo(group_id)
  and app.grupo_abierto(group_id)
);

-- Un mensaje NO se edita: se baja. `using` pide la fila viva y `with check`
-- sólo deja pasar el marcado de borrado — el cuerpo no se puede reescribir.
create policy chat_group_messages_update on public.chat_group_messages
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and deleted_at is null
  and (
    sender_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and deleted_at is not null
);

-- Sin DELETE físico para usuarios: el borrado suave de arriba ya esconde la
-- fila, y conservarla mientras el reporte está abierto es lo que le permite a
-- la moderación ver qué se bajó.
create policy chat_group_messages_delete on public.chat_group_messages
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);


-- ---------------------------------------------------------------------------
-- 7 · GRANTS EXPLÍCITOS (§5 de la cabecera). Sin esto, la app se ve VACÍA y
--     sin un solo error: sin GRANT de tabla la policy ni llega a evaluarse.
--     `anon` no recibe nada — un grupo de la comunidad no es contenido de SEO.
-- ---------------------------------------------------------------------------
revoke all on table public.chat_groups         from anon, authenticated;
revoke all on table public.chat_group_members  from anon, authenticated;
revoke all on table public.chat_group_messages from anon, authenticated;

grant select, insert, update, delete on table public.chat_groups         to authenticated;
grant select, insert, update, delete on table public.chat_group_members  to authenticated;
grant select, insert, update, delete on table public.chat_group_messages to authenticated;

grant all on table public.chat_groups         to service_role;
grant all on table public.chat_group_members  to service_role;
grant all on table public.chat_group_messages to service_role;


-- ---------------------------------------------------------------------------
-- 8 · Por qué acá NO se toca Realtime
--
-- El pedido original de este frente decía "sumar la tabla de mensajes de grupo
-- a la publicación que ya use `messages`". Esa publicación NO EXISTE: en todo
-- el repo no hay un solo `alter publication`, ni una sola llamada a
-- `.channel()` o `postgres_changes` en `src/`. El chat 1-a-1 se actualiza con
-- polling suave cada 15 s (`src/components/messaging/thread-refresh.tsx`, que
-- lo deja escrito: «Realtime de Supabase queda para R2»).
--
-- Sumar la tabla a `supabase_realtime` acá habría prendido replicación lógica
-- para una publicación que ningún cliente escucha: costo sin efecto. Y montar
-- Realtime de verdad es una decisión de infraestructura —la propia
-- documentación de Supabase hoy desaconseja `postgres_changes` y empuja a
-- Broadcast from Database, que necesita triggers, canales privados y RLS sobre
-- `realtime.messages`— que no se toma de costado dentro de la migración de una
-- feature.
--
-- El grupo se refresca con el MISMO mecanismo que el chat 1-a-1, con un
-- intervalo más corto porque hay más gente escribiendo
-- (`src/components/messaging/group-live.tsx`). Cuando Realtime entre, entra
-- para los dos chats a la vez y en su propia migración.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 9 · Reportar un mensaje de grupo
--
-- Se sigue el precedente EXPLÍCITO de la 0093 (report_listing_review): se
-- amplía el CHECK de `scam_reports.target_kind` y se agrega una RPC propia, en
-- vez de meterle un `elsif` a `report_scam()` — esa función la usan hoy el
-- Escudo y Mensajes en producción y reescribirla entera para sumar un tercer
-- caso es tocar dos flujos vivos. Escribe en la MISMA tabla, así que hereda el
-- trigger de peso por Trust Score y la cola de moderación sin pedirle nada al
-- código existente.
--
-- Reportar el GRUPO como tal no lleva tipo nuevo: se reporta a quien lo creó
-- (target_kind = 'profile', que ya existe) o el mensaje concreto que molesta.
-- Un "grupo" no es un objeto que la moderación pueda suspender hoy —no hay
-- pantalla de admin para eso— y un tipo de reporte que nadie sabe resolver es
-- una cola que se llena y no se vacía.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.scam_reports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%target_kind%';
  if v_name is not null then
    execute format('alter table public.scam_reports drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.scam_reports
  add constraint scam_reports_target_kind_check
  check (target_kind in ('listing', 'profile', 'message', 'review', 'group_message'));

comment on column public.scam_reports.target_kind is
  'listing | profile | message | review | group_message. "review" (0093) apunta a listing_reviews.id y entra por public.report_listing_review(); "group_message" (0133) apunta a chat_group_messages.id y entra por public.reportar_mensaje_de_grupo(); el resto sigue entrando por public.report_scam().';

create or replace function public.reportar_mensaje_de_grupo(
  p_message_id uuid,
  p_reason     text,
  p_details    text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_report_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para reportar.';
  end if;

  -- Mismo cupo diario que el resto de las denuncias (0118): el presupuesto es
  -- de la persona, no de la pantalla desde la que reporta.
  perform app.exigir_cupo_de_denuncias(v_tenant, v_uid);

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: contanos brevemente qué pasó.';
  end if;

  -- Tenés que PODER VER el mensaje para reportarlo: mismo criterio que
  -- report_scam() con los mensajes directos. Sin esto, alguien podría barrer
  -- ids y confirmar por diferencia de errores qué mensajes existen.
  if not exists (
    select 1
      from public.chat_group_messages m
     where m.id = p_message_id
       and m.tenant_id = v_tenant
       and app.es_miembro_de_grupo(m.group_id)
  ) then
    raise exception 'TARGET_NOT_FOUND: ese mensaje no existe o no es de un grupo tuyo.';
  end if;

  -- Idempotente ante el duplicado, igual que report_scam() desde la 0118.
  select r.id into v_report_id
    from public.scam_reports r
   where r.tenant_id   = v_tenant
     and r.reporter_id = v_uid
     and r.target_kind = 'group_message'
     and r.target_id   = p_message_id
     and r.status in ('open', 'reviewing');

  if found then
    return v_report_id;
  end if;

  insert into public.scam_reports (tenant_id, reporter_id, target_kind, target_id, reason, details, status)
  values (v_tenant, v_uid, 'group_message', p_message_id,
          btrim(p_reason), nullif(btrim(coalesce(p_details, '')), ''), 'open')
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.reportar_mensaje_de_grupo(uuid, text, text) is
  'Reporta un mensaje de grupo hacia scam_reports (0005). Existe aparte de report_scam() por el mismo motivo que report_listing_review() (0093): esa función la usan el Escudo y Mensajes en producción. Exige ser miembro del grupo —no se reporta lo que no se puede ver— comparte el cupo diario de denuncias y contesta con el id existente si ya hay una pendiente.';

revoke all    on function public.reportar_mensaje_de_grupo(uuid, text, text) from public, anon;
grant execute on function public.reportar_mensaje_de_grupo(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10 · Retención (pg_cron)
--
-- Mismo criterio y mismo horario-vecino que la 0013: lo que se borra rápido no
-- es subpoenable después. Idempotente igual que allá: se desagenda y se vuelve
-- a agendar.
-- ---------------------------------------------------------------------------

-- Mensajes de grupo: TTL 90 días (03:15 UTC, entre los mensajes directos y las
-- notificaciones).
do $$
begin
  perform cron.unschedule('purge-expired-group-messages');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'purge-expired-group-messages',
  '15 3 * * *',
  $$delete from public.chat_group_messages where expires_at < now()$$
);

-- Grupos cerrados y vacíos de contenido (03:45 UTC, DESPUÉS de la purga de
-- mensajes). Exactamente el razonamiento de purge-stale-conversations: sin
-- esto, el TTL de los mensajes quedaría vacío de sentido porque sobreviviría
-- para siempre el metadato de quién se juntó con quién y sobre qué tema.
-- Sólo alcanza a los CERRADOS: un grupo activo sin mensajes recientes es un
-- grupo tranquilo, no un grupo muerto.
do $$
begin
  perform cron.unschedule('purge-closed-empty-chat-groups');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-closed-empty-chat-groups',
  '45 3 * * *',
  $$delete from public.chat_groups g
     where g.status = 'closed'
       and g.updated_at < now() - interval '90 days'
       and not exists (
         select 1 from public.chat_group_messages m where m.group_id = g.id
       )$$
);

commit;

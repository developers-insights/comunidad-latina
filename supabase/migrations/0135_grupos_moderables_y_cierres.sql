-- =============================================================================
-- 0135_grupos_moderables_y_cierres.sql — Comunidad Latina
--
-- LOS CIERRES DE LA AUDITORÍA DEL 2026-09-03 sobre el trabajo del feedback del
-- cliente. No estrena ninguna feature: arregla cosas que la 0133 y la 0134
-- dejaron a medias, más dos cierres viejos de la 0127 y de Storage.
--
-- Cada bloque dice qué hallazgo cierra y CÓMO se comprobó. Los tres primeros
-- son del módulo de grupos y se explican juntos, porque el segundo existe
-- únicamente porque el primero destraba el UPDATE.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EL BUG QUE HACÍA QUE NADIE PUDIERA BAJAR UN MENSAJE (H-1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `chat_group_messages_update` (0133) está bien escrita mirándola sola: el
-- `using` pide la fila viva y el `with check` sólo deja pasar el marcado de
-- borrado. El problema es que NO ESTÁ SOLA.
--
-- Cuando una tabla tiene policies de SELECT, Postgres las suma como chequeo
-- sobre la FILA NUEVA de un UPDATE. Y `chat_group_messages_select` exigía
-- `deleted_at is null`. O sea: la fila nueva de "bajar un mensaje" —que por
-- definición tiene `deleted_at` NO nulo— nunca podía existir. La operación
-- fallaba SIEMPRE, con 42501, tanto para el autor como para quien administra.
--
-- Verificado en vivo contra el esquema de producción antes de escribir este
-- archivo (dry-run con rollback, sesiones simuladas con `set role
-- authenticated` + claims de JWT):
--
--   autor baja su propio mensaje  → 42501 new row violates row-level security
--   admin baja un mensaje ajeno   → 42501 new row violates row-level security
--   miembro común, mensaje ajeno  → 0 filas   (correcto: no le corresponde)
--
-- El arreglo es el patrón que ya usa `community_help_replies_select` (0130):
-- lo borrado no desaparece para TODOS, desaparece para el resto. Quien lo
-- escribió y quien administra lo siguen viendo, que es lo que hace que
-- "borrar" sea una acción con resultado y no un botón que no contesta.
--
-- La app, en cambio, filtra `deleted_at is null` en la consulta del hilo
-- (`listarMensajesDelGrupo`): en el chat 1-a-1 un mensaje borrado se va y no
-- deja lápida, y dos chats de la misma app no pueden borrar de dos maneras
-- distintas. La policy habilita; la consulta decide qué se pinta.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LO QUE SE ABRE AL DESTRABAR EL UPDATE (H-7)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Con el UPDATE finalmente posible, el `with check` de la 0133 garantiza QUIÉN
-- puede tocar la fila y que quede borrada — pero una policy autoriza FILAS, no
-- COLUMNAS. El mismo UPDATE que baja un mensaje podía además reescribir
-- `body`, o correr `expires_at` cien años y volverlo imborrable.
--
-- El candado por columna va donde ya va en este repo: en un trigger. Es el
-- gemelo exacto de `app.proteger_columnas_del_grupo()` (0133 §5.4) y de
-- `app.protect_conversation_columns()` (0006).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. EXPULSAR NO EXPULSABA (H-3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La rama (a) de `chat_group_members_insert` (0133) deja que cualquiera de la
-- comunidad se auto-agregue a un grupo PÚBLICO y activo. Sacar a alguien
-- borraba su fila… y la persona volvía a entrar con el mismo toque con el que
-- había entrado la primera vez. Verificado en vivo, con el mismo dry-run:
--
--   owner expulsa a la persona             → 1 fila
--   la persona vuelve a entrar de un toque → 1 fila   ← el agujero
--
-- La expulsión sin memoria no es una herramienta de moderación: es un mensaje
-- que se borra solo. Por eso hay una tabla de vetos, y por eso expulsar pasa a
-- ser UNA operación (`public.expulsar_de_grupo`) y no dos escrituras que la app
-- encadena y que pueden quedar por la mitad.
--
-- El veto NO es para siempre y no hace falta una pantalla nueva para levantarlo:
-- invitar a alguien es el acto explícito de traerlo de vuelta, así que la action
-- de invitar borra su veto antes de sumarlo. Un veto que sólo se pudiera quitar
-- desde el SQL Editor sería una condena.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. UN REPORTE DE UN MENSAJE DE GRUPO SIN NINGUNA ACCIÓN POSIBLE (H-2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La 0133 estrenó `target_kind = 'group_message'` y la RPC para reportarlo,
-- pero el panel de Dominio no podía ni LEER el mensaje (el SELECT era sólo para
-- miembros del grupo) ni bajarlo en suave (el UPDATE, sólo autor o admin del
-- grupo). Una cola de reportes que sólo se puede descartar es una cola que se
-- llena.
--
-- Se abren las dos, y las dos ACOTADAS AL MENSAJE REPORTADO: el staff no lee
-- grupos, lee lo que la comunidad le puso arriba del escritorio. Es una
-- diferencia que importa —§1 de la 0133 dice que un grupo es semipúblico, no
-- que sea de lectura libre para el equipo— y es lo que separa esto de un
-- honeypot de conversaciones.
--
-- El DELETE físico que la 0133 ya le daba al staff se queda como está: es la
-- opción nuclear. Bajar el mensaje en suave conserva la fila hasta que la purga
-- de 90 días se la lleve, que es exactamente lo que pide el comentario de
-- `chat_group_messages.deleted_at`.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · chat_group_messages_select — H-1 (lo borrado sigue siendo visible para
--     quien lo escribió y quien administra) + H-2 (rama de staff, acotada a lo
--     reportado).
--
--     Va en UN solo `alter policy` porque una policy tiene una sola expresión:
--     los dos hallazgos tocan la misma y separarlos sería pisar el primero con
--     el segundo.
--
--     ORDEN DE LAS RAMAS, a propósito. La primera es la del 99,9% de las
--     lecturas y no consulta ninguna tabla más. La segunda arranca con
--     `app.current_user_role()`, que es un InitPlan de una sola evaluación
--     sobre el JWT: para un miembro común muere ahí y nunca llega al EXISTS
--     contra `scam_reports`.
-- ---------------------------------------------------------------------------
alter policy chat_group_messages_select on public.chat_group_messages
using (
  (
    tenant_id = (select app.current_tenant_id())
    and expires_at > now()
    and app.es_miembro_de_grupo(group_id)
    and (
      deleted_at is null
      or sender_id = (select auth.uid())
      or app.rol_en_grupo(group_id) in ('owner', 'admin')
    )
  )
  or (
    -- El equipo de la comunidad, y SÓLO sobre un mensaje que alguien reportó.
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
    and exists (
      select 1
        from public.scam_reports r
       where r.target_kind = 'group_message'
         and r.target_id   = chat_group_messages.id
         and r.tenant_id   = chat_group_messages.tenant_id
    )
  )
);

comment on policy chat_group_messages_select on public.chat_group_messages is
  'Leen los miembros del grupo (0133). Un mensaje BORRADO lo siguen viendo su autor y quien administra — patrón de community_help_replies_select (0130) — porque además de ser lo correcto en pantalla, el USING de un SELECT se aplica también a la fila nueva de un UPDATE: con "deleted_at is null" acá, bajar un mensaje era imposible para todos (H-1). La segunda rama es del equipo de la comunidad y llega SÓLO al mensaje que alguien reportó (H-2): un grupo es semipúblico, no de lectura libre para el staff.';


-- ---------------------------------------------------------------------------
-- 2 · chat_group_messages_update — H-2: el equipo puede BAJAR el mensaje
--     reportado, con el mismo borrado suave que usan el autor y quien administra.
--
--     La rama se repite en el `using` y en el `with check` por lo mismo que la
--     0133 repetía la de autoría: el `using` dice qué filas puedo tocar y el
--     `with check`, cómo pueden quedar.
-- ---------------------------------------------------------------------------
alter policy chat_group_messages_update on public.chat_group_messages
using (
  tenant_id = (select app.current_tenant_id())
  and deleted_at is null
  and (
    sender_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and deleted_at is not null
  and (
    sender_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

comment on policy chat_group_messages_update on public.chat_group_messages is
  'Un mensaje no se edita: se baja. Lo bajan su autor, quien administra el grupo, y —desde la 0135— el equipo de la comunidad al resolver un reporte (H-2). Que no se pueda reescribir el cuerpo no lo garantiza esta policy sino el trigger app.proteger_columnas_del_mensaje_de_grupo(): una policy autoriza filas, no columnas.';


-- ---------------------------------------------------------------------------
-- 3 · H-7 · Columnas congeladas de un mensaje de grupo.
--
--     Mismo criterio que app.proteger_columnas_del_grupo() (0133 §5.4), con una
--     diferencia deliberada: acá se PISA el valor en vez de lanzar. Un cliente
--     que manda de más no tiene por qué recibir un error —su intención real es
--     bajar el mensaje— y pisar es la forma que no depende de que quien llama
--     mande exactamente las columnas que esperábamos.
--
--     `auth.uid() is null` = service_role, seed, cron y migraciones: pasan
--     enteros, igual que en app.enforce_account_active() (0021).
-- ---------------------------------------------------------------------------
create or replace function app.proteger_columnas_del_mensaje_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.id         := old.id;
  new.tenant_id  := old.tenant_id;
  new.group_id   := old.group_id;
  new.sender_id  := old.sender_id;
  new.body       := old.body;
  new.created_at := old.created_at;
  -- El TTL es el candado de §5.4 de la 0006: si se pudiera correr desde un
  -- UPDATE, el trigger que lo fuerza en el INSERT no serviría de nada.
  new.expires_at := old.expires_at;

  return new;
end;
$$;

comment on function app.proteger_columnas_del_mensaje_de_grupo() is
  'BEFORE UPDATE en chat_group_messages: de un mensaje de grupo lo ÚNICO que se puede cambiar es deleted_at. Todo lo demás se pisa con el valor viejo. Existe porque destrabar el UPDATE (H-1) abría la puerta a reescribir el cuerpo, mudar el mensaje de grupo o correr expires_at cien años — una policy autoriza filas, no columnas. Sin JWT (service_role / cron / migraciones) no se toca nada.';

revoke execute on function app.proteger_columnas_del_mensaje_de_grupo() from public, anon;

create trigger chat_group_messages_proteger_columnas
before update on public.chat_group_messages
for each row execute function app.proteger_columnas_del_mensaje_de_grupo();


-- ---------------------------------------------------------------------------
-- 4 · H-3 · chat_group_bans — la memoria que le faltaba a expulsar.
--
--     Tabla mínima a propósito: es una lista de "esta persona no vuelve sola a
--     este grupo", no un historial de moderación. `banned_by` está porque una
--     medida sin autor no se puede revisar después; `created_at`, porque
--     "¿desde cuándo?" es la primera pregunta cuando alguien reclama.
--
--     Sin `updated_at` ni columna de motivo: un veto no se edita (se levanta y,
--     si hace falta, se vuelve a poner), y el motivo ya vive en el reporte o en
--     la conversación que lo originó.
-- ---------------------------------------------------------------------------
create table public.chat_group_bans (
  group_id   uuid not null references public.chat_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)    on delete cascade,

  -- DENORMALIZADO como en todo el repo: toda policy lo compara contra
  -- app.current_tenant_id(), así que una fila con el tenant forjado no la ve
  -- nadie y no bloquea a nadie.
  tenant_id  uuid not null references public.tenants(id)     on delete cascade,

  banned_by  uuid not null references public.profiles(id)    on delete cascade,
  created_at timestamptz not null default now(),

  primary key (group_id, profile_id)
);

comment on table public.chat_group_bans is
  'Quién NO puede volver a entrar solo a un grupo público (0135). Existe porque expulsar de un grupo público no expulsaba: la rama (a) de chat_group_members_insert deja que cualquiera de la comunidad se auto-agregue, así que borrar la membresía duraba hasta el toque siguiente (H-3). No es un historial de moderación: es una lista de dos columnas con autor y fecha. Se levanta borrando la fila — y la action de invitar lo hace sola, porque invitar a alguien ES traerlo de vuelta.';
comment on column public.chat_group_bans.banned_by is
  'Quién decidió el veto. Una medida sin autor no se puede revisar el día que la persona reclama.';

-- "¿Estoy vetado en algún grupo?" y el borrado en cascada cuando alguien se va
-- de la comunidad. La PK ya cubre la otra dirección (los vetos de un grupo).
create index chat_group_bans_persona_idx on public.chat_group_bans (profile_id);

create index chat_group_bans_tenant_idx  on public.chat_group_bans (tenant_id);


-- 4.1 · "¿Esta persona es la dueña de este grupo?" — DEFINER por la misma razón
--       que las tres funciones de §4 de la 0133: se pregunta desde una policy y
--       la respuesta no puede depender de si la fila del otro es visible.
--       app.rol_en_grupo() no sirve acá: esa contesta por auth.uid().
--
--       Va ANTES de las policies porque una de ellas la usa.
create or replace function app.es_dueno_del_grupo(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_group_members m
     where m.group_id   = p_group
       and m.profile_id = p_profile
       and m.role       = 'owner'
  );
$$;

comment on function app.es_dueno_del_grupo(uuid, uuid) is
  '¿p_profile creó este grupo? Gemela de app.rol_en_grupo() (0133) pero por una persona CUALQUIERA, no por auth.uid(). SECURITY DEFINER por lo mismo: resolverlo con un EXISTS visible desde la policy haría que "no veo su fila" y "no es el dueño" contesten igual, y lo segundo es una autorización.';

revoke execute on function app.es_dueno_del_grupo(uuid, uuid) from public, anon;
grant execute on function app.es_dueno_del_grupo(uuid, uuid) to authenticated, service_role;


-- 4.2 · RLS de los vetos.
alter table public.chat_group_bans enable row level security;
alter table public.chat_group_bans force  row level security;

-- Ver: quien administra el grupo (para saber a quién vetó) y la propia persona
-- vetada. Lo segundo no es una concesión: es lo que le permite a la app decirle
-- "te sacaron" en vez de un "no pudimos sumarte, probá de nuevo" que la manda a
-- reintentar para siempre.
create policy chat_group_bans_select on public.chat_group_bans
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or app.rol_en_grupo(group_id) in ('owner', 'admin')
  )
);

-- Vetar: quien administra, en su comunidad, firmando con su propio nombre, y
-- NUNCA al dueño del grupo ni a sí mismo.
create policy chat_group_bans_insert on public.chat_group_bans
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and banned_by  = (select auth.uid())
  and profile_id <> (select auth.uid())
  and app.rol_en_grupo(group_id) in ('owner', 'admin')
  and not app.es_dueno_del_grupo(group_id, profile_id)
  and exists (
    select 1 from public.chat_groups g
     where g.id = chat_group_bans.group_id
       and g.tenant_id = chat_group_bans.tenant_id
  )
);

-- NADIE. Un veto no se edita: se levanta (delete) y, si hace falta, se vuelve a
-- poner. La policy existe igual porque el contrato de scripts/rls-enumerator.mjs
-- exige las cuatro, y ese contrato es justamente el que evita "la policy que
-- nunca se escribió". Mismo `using (false)` que messages_update (0006).
create policy chat_group_bans_update on public.chat_group_bans
for update to authenticated
using (false)
with check (false);

-- Levantar el veto: quien administra el grupo.
create policy chat_group_bans_delete on public.chat_group_bans
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.rol_en_grupo(group_id) in ('owner', 'admin')
);

-- GRANTS EXPLÍCITOS — §5 de la 0133 y la lección de la 0085: en este schema
-- compartido una tabla nueva NACE sin acceso y la app se ve vacía sin un solo
-- error. `update` NO se otorga: la policy ya dice que no, y no dar el permiso
-- es el candado de afuera.
revoke all on table public.chat_group_bans from anon, authenticated;
grant select, insert, delete on table public.chat_group_bans to authenticated;
grant all on table public.chat_group_bans to service_role;


-- 4.3 · La rama (a) de la entrada mira el veto.
--
--       Sólo la rama (a) —la del auto-alta en un grupo público—. La (b), la
--       invitación de quien administra, queda intacta a propósito: invitar es
--       el acto deliberado de traer a alguien de vuelta, y que el veto lo
--       bloqueara obligaría a levantarlo primero desde una pantalla que no
--       existe.
alter policy chat_group_members_insert on public.chat_group_members
with check (
  tenant_id = (select app.current_tenant_id())
  and role = 'member'
  and exists (
    select 1 from public.chat_groups g
     where g.id = chat_group_members.group_id
       and g.tenant_id = chat_group_members.tenant_id
       and g.status = 'active'
       and (
         -- (a) auto-alta en un público, salvo que me hayan vetado
         (
           chat_group_members.profile_id = (select auth.uid())
           and g.visibility = 'public'
           and not exists (
             select 1 from public.chat_group_bans b
              where b.group_id   = chat_group_members.group_id
                and b.profile_id = (select auth.uid())
           )
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

comment on policy chat_group_members_insert on public.chat_group_members is
  'Dos caminos: (a) me auto-agrego a un grupo PÚBLICO y activo de mi comunidad —salvo que quien lo administra me haya vetado (chat_group_bans, 0135)— o (b) me suma quien administra, y no si hay bloqueo entre los dos (§4 de la 0133). El veto no toca la rama (b) porque invitar a alguien ES traerlo de vuelta.';


-- 4.4 · Expulsar: UNA operación, no dos.
--
--       Si la app hiciera el delete de la membresía y el insert del veto por
--       separado, un fallo en el medio dejaría a la persona afuera sin veto (y
--       vuelve entrando) o vetada pero adentro. Acá las dos escrituras son una
--       sola transacción, y el rol de quien expulsa se vuelve a verificar
--       ADENTRO: es SECURITY DEFINER, así que sin ese chequeo cualquiera podría
--       vaciar cualquier grupo.
create or replace function public.expulsar_de_grupo(p_group uuid, p_profile uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_mi_rol text;
  v_su_rol text;
begin
  if v_uid is null or v_tenant is null then
    return 'sin_sesion';
  end if;

  -- Nadie se expulsa a sí mismo: para eso está salir del grupo, que además no
  -- deja veto.
  if p_group is null or p_profile is null or p_profile = v_uid then
    return 'sin_permiso';
  end if;

  -- El grupo tiene que ser de MI comunidad. Se pregunta antes que el rol para
  -- que un id de otro tenant conteste lo mismo que uno inexistente.
  if not exists (
    select 1 from public.chat_groups g
     where g.id = p_group
       and g.tenant_id = v_tenant
  ) then
    return 'sin_permiso';
  end if;

  select m.role into v_mi_rol
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = v_uid;

  if v_mi_rol is null or v_mi_rol not in ('owner', 'admin') then
    return 'sin_permiso';
  end if;

  select m.role into v_su_rol
    from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = p_profile;

  -- Ya no estaba: no es un error, es el resultado que se quería.
  if v_su_rol is null then
    return 'no_estaba';
  end if;

  -- Al dueño no lo saca nadie, ni siquiera quien administra (mismo invariante
  -- que chat_group_members_delete en la 0133).
  if v_su_rol = 'owner' then
    return 'sin_permiso';
  end if;

  -- EL VETO PRIMERO. Si esto fallara, la excepción aborta la función entera y
  -- la persona sigue adentro: preferimos no expulsar antes que expulsar sin
  -- memoria, que es exactamente el bug que este archivo cierra.
  insert into public.chat_group_bans (group_id, profile_id, tenant_id, banned_by)
  values (p_group, p_profile, v_tenant, v_uid)
  on conflict (group_id, profile_id) do nothing;

  delete from public.chat_group_members m
   where m.group_id = p_group
     and m.profile_id = p_profile;

  return 'ok';
end;
$$;

comment on function public.expulsar_de_grupo(uuid, uuid) is
  'Saca a alguien de un grupo Y lo veta, en la MISMA transacción (0135). Existe porque hacerlo en dos escrituras desde la app deja estados que la pantalla no puede arreglar: afuera sin veto (vuelve a entrar de un toque, que es el bug H-3) o vetado pero adentro. SECURITY DEFINER con el rol de quien expulsa re-verificado adentro. Devuelve ok | no_estaba | sin_permiso | sin_sesion. Al dueño del grupo no lo saca nadie.';

revoke all    on function public.expulsar_de_grupo(uuid, uuid) from public, anon;
grant execute on function public.expulsar_de_grupo(uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5 · H-4 · El tope de 200 MB, del lado del servidor.
--
--     La 0132 dejó el bucket en 250 MB a propósito: el tope que ve la persona
--     eran 200 MB (MAX_VIDEO_BYTES) y el del bucket iba POR ENCIMA para que un
--     archivo apenas más grande lo rechazara el composer con un mensaje escrito
--     y no Storage con un error HTTP crudo.
--
--     El razonamiento valía mientras el composer fuera la única puerta. Con
--     `adjuntarVideoPublicitario` apareció una segunda que sube directo al
--     bucket desde el navegador y después manda sólo la RUTA: el tope de 200 MB
--     vivía únicamente en el JavaScript que hace la subida, y saltearlo era
--     escribir un `fetch` a mano. Los 50 MB de margen eran, en esa ruta, 50 MB
--     de nada.
--
--     Ahora hay dos candados y ninguno reemplaza al otro: Storage rechaza a los
--     200 MB (esto), y la action mide el objeto YA SUBIDO antes de colgarlo de
--     la publicación. El mensaje escrito lo sigue dando el navegador, que mide
--     el archivo antes de empezar; lo de acá es la red por si alguien no pasa
--     por ahí.
--
--     El número es el mismo que `MAX_VIDEO_BYTES` en
--     src/lib/media/video-upload-limits.ts (200 * 1024 * 1024). Si uno cambia,
--     cambian los dos.
--
--     Igual que la 0132 y la 0025: puede necesitar correrse a mano desde el SQL
--     Editor si el rol de migraciones no puede tocar el esquema storage.
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 209715200 -- 200 MB = MAX_VIDEO_BYTES
where id = 'post-media';


-- ---------------------------------------------------------------------------
-- 6 · H-6 · La última SECURITY DEFINER con search_path mutable.
--
--     `solicitar_contacto_directo` (0134) quedó con `set search_path = public,
--     app` mientras el resto de las funciones privilegiadas del repo van con
--     `= ''`. El cuerpo ya califica todo (`public.profiles`,
--     `public.conversations`, `app.pair_blocked`, `auth.uid()`), así que el
--     search_path no le hace falta para nada — y dejarlo es dejar la única
--     función privilegiada cuya resolución de nombres depende de algo que no
--     está en su propio cuerpo.
--
--     `alter function` y no `create or replace`: no cambia una sola línea de
--     lógica, y reescribir el cuerpo entero para tocar un atributo es la forma
--     más fácil de introducir una diferencia sin querer.
-- ---------------------------------------------------------------------------
alter function public.solicitar_contacto_directo(uuid) set search_path = '';


-- ---------------------------------------------------------------------------
-- 7 · H-8 · El prefijo se chequeaba, el `..` no.
--
--     `guardar_fotos_de_negocio` (0127) verifica que el path empiece con
--     `{tenant}/{listing}/`, que es lo que impide guardar en la ficha propia la
--     foto de otro aviso. Pero `strpos(...) = 1` mira el ARRANQUE y nada más:
--     `{tenant}/{listing}/../../otro/foto.jpg` empieza bien y sale del prefijo.
--
--     Es el MISMO par de chequeos que ya hacen el CHECK de la 0132 y
--     `own-media-path.ts` del lado de la app, y por el mismo motivo: el charset
--     de un nombre de archivo tiene que permitir el punto (lo necesita la
--     extensión), así que prohibir el traversal no entra en la misma condición
--     que el prefijo.
--
--     `create or replace` con el cuerpo de la 0127 tal cual, más la condición
--     nueva: es la única forma de cambiar el cuerpo de una función.
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

  -- El prefijo Y el traversal. `strpos(...) <> 1` sólo mira por dónde empieza:
  -- sin la segunda mitad, `{tenant}/{listing}/../../otro/foto.jpg` pasaba.
  if (v_logo is not null
       and (pg_catalog.strpos(v_logo, v_prefijo) <> 1 or v_logo like '%..%'))
     or (v_cover is not null
       and (pg_catalog.strpos(v_cover, v_prefijo) <> 1 or v_cover like '%..%')) then
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
  'Guarda el logo y la portada de un negocio (paths del bucket listing-photos) sin tocar status ni photos. Recibe los DOS valores finales: null = quitar esa foto. Verifica adentro tenant + kind + app.can_manage_listing (0093), que cada path caiga bajo el prefijo {tenant}/{listing}/ y —desde la 0135— que no contenga "..": el prefijo solo mira el arranque, así que {tenant}/{listing}/../../otro.jpg empezaba bien. Devuelve ok | sin_sesion | sin_permiso | ruta_invalida.';

revoke all    on function public.guardar_fotos_de_negocio(uuid, text, text) from public, anon;
grant execute on function public.guardar_fotos_de_negocio(uuid, text, text) to authenticated;

commit;

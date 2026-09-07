-- =============================================================================
-- 0145_la_ultima_vez_que_estuvo.sql — Comunidad Latina
--
-- PRESENCIA: "En línea" y "Última vez hace 20 min" en la bandeja de mensajes.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DÓNDE VIVE `last_seen_at`, Y POR QUÉ NO EN `profiles`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El pedido nombraba `public.profiles.last_seen_at`. No va ahí, y no es una
-- preferencia de estilo: en esta base esa columna nacería pública el mismo
-- segundo en que se crea.
--
--   · `profiles_select` (0091) tiene una rama `auth.uid() is null` que le
--     devuelve TODAS las filas a un visitante sin sesión. Lo único que contiene
--     a `anon` ahí es el GRANT POR COLUMNA de la 0058/0085: hoy son 10 de las
--     25 columnas que tiene la tabla.
--   · Para `authenticated` NO hay grant por columna: tiene `select` sobre la
--     tabla entera. La 0091 §"LO QUE NO SE TOCA" documenta por qué y lo dejó
--     escrito con todas las letras: revocarle el select de tabla a
--     `authenticated` rompe `getViewerAccount()` (viewer-zone.ts), que en CADA
--     request del shell `(app)` lee `timezone, account_status, suspended_until`
--     con el cliente de usuario. Ese fue un rechazo razonado de una auditoría,
--     no un olvido.
--
-- O sea que las dos alternativas sobre `profiles` eran:
--
--   (a) `revoke select on public.profiles from authenticated` + volver a
--       otorgarle a mano las otras veintiséis columnas. Además de revertir la
--       decisión de la 0091, deja una trampa permanente: la PRÓXIMA
--       migración que le agregue una
--       columna a `profiles` la deja sin grant, y la app se cae con 42501 —o se
--       ve vacía sin un solo error— en el camino más caliente que tiene. Es
--       exactamente el modo de falla de la 0114 y de la 0133 §7.
--   (b) Dejar la columna en una tabla aparte.
--
-- Se elige (b), y la tabla aparte YA EXISTE: `public.profiles_private` (0003)
-- es literalmente "lo sensible del perfil, separado a propósito", con RLS
-- solo-dueño y sin rama de staff. Ahí `last_seen_at` queda cerrado POR
-- ESTRUCTURA y no por una lista de columnas que hay que mantener: aunque
-- `authenticated` tenga grant de tabla, `profiles_private_select` sólo deja
-- pasar `profile_id = auth.uid()`. Nadie lee el `last_seen_at` de otro por
-- REST. Ni un miembro de la misma comunidad, ni de otra, ni el staff, ni
-- global_admin. La única puerta al dato ajeno es `public.presencia_de()`, que
-- aplica la preferencia de privacidad antes de devolver nada — el mismo patrón
-- que `public.profile_card()` (0063), que ya es "la única puerta a
-- profiles_private".
--
-- `mostrar_ultima_vez` SÍ va en `profiles`, como pedía el contrato, y también
-- es a propósito: es una preferencia que su dueño prende y apaga desde
-- ajustes, y `profiles_update` (solo-dueño) ya la deja escribir sin código
-- nuevo. Que un miembro de la misma comunidad pueda leerla no agrega nada:
-- `presencia_de()` ya revela lo mismo devolviendo null para siempre.
--
-- 🔴 NO APLICADA. Este archivo se escribe y se revisa; lo aplica una persona.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Las dos columnas, cada una donde su exposición corresponde
-- ---------------------------------------------------------------------------

-- Sin default: null significa "nunca lo vimos", que NO es lo mismo que "estuvo
-- hace mucho". La UI necesita poder distinguirlos para no inventar una última
-- vez que nadie registró.
alter table public.profiles_private
  add column last_seen_at timestamptz;

-- `not null default true` porque el estado inicial tiene que ser el que la
-- gente espera de una bandeja de mensajes; quien no quiere mostrarlo lo apaga.
-- Postgres 11+ no reescribe la tabla al agregar una columna con default, así
-- que esto no bloquea `profiles` mientras corre.
alter table public.profiles
  add column mostrar_ultima_vez boolean not null default true;

comment on column public.profiles_private.last_seen_at is
  'INVARIANTE: este dato NUNCA sale por REST hacia otra persona. Vive acá y no en `profiles` porque profiles_select (0091) le entrega todas las filas a un visitante sin sesión y `authenticated` tiene grant de SELECT sobre la tabla entera — una columna de presencia ahí sería un rastreador público. En profiles_private la RLS es solo-dueño (0003): cada quien lee el suyo y el de nadie más. La ÚNICA puerta al dato ajeno es public.presencia_de(), que aplica profiles.mostrar_ultima_vez y el filtro de tenant antes de devolver algo. Lo escribe public.tocar_presencia() como mucho una vez por minuto. Si alguna vez hace falta leerlo desde otra pantalla, la respuesta es una función definer más, nunca mover la columna a profiles.';

comment on column public.profiles.mostrar_ultima_vez is
  'Preferencia de privacidad de cada persona (0145). En false, public.presencia_de() devuelve en_linea = false y ultima_vez = null para esa persona: apagarlo esconde las DOS cosas, porque "no muestro cuándo estuve pero sí que estoy conectada ahora" no es privacidad, es media. No se deja de registrar last_seen_at —la persona puede volver a prenderlo— simplemente deja de salir. Vive en profiles y no en profiles_private a propósito: es una preferencia que su dueño edita desde ajustes con profiles_update, y saber que alguien la apagó no revela nada que presencia_de() no revele ya.';


-- ---------------------------------------------------------------------------
-- 2 · La presencia no puede estar en el futuro
--
--     `profiles_private_update` es solo-dueño y sigue estando: una persona
--     puede escribir su propio `last_seen_at` por REST sin pasar por
--     tocar_presencia(). Escribir `now()` a mano es indistinguible de tener la
--     app abierta, así que no hay nada que impedir ahí; escribir el año 2100 sí
--     es otra cosa — deja a alguien "En línea" para siempre sin volver a
--     entrar nunca.
--
--     Se acota en un trigger y no en un CHECK porque `now()` no es inmutable y
--     un CHECK no puede llamarla. Y se ACOTA en vez de lanzar: quien manda de
--     más no necesita un error, necesita que el valor sea verdad.
-- ---------------------------------------------------------------------------
create or replace function app.acotar_presencia_al_presente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_seen_at is not null and new.last_seen_at > now() then
    new.last_seen_at := now();
  end if;
  return new;
end;
$$;

comment on function app.acotar_presencia_al_presente() is
  'BEFORE INSERT/UPDATE en profiles_private: baja cualquier last_seen_at futuro a now(). Existe porque profiles_private_update es solo-dueño y deja a una persona escribir su propia presencia por REST: mandar now() es lo mismo que tener la app abierta y no molesta a nadie, pero una fecha futura la dejaría "En línea" para siempre sin volver a entrar. No es un CHECK porque now() no es inmutable.';

revoke execute on function app.acotar_presencia_al_presente() from public, anon;

drop trigger if exists profiles_private_acotar_presencia on public.profiles_private;
create trigger profiles_private_acotar_presencia
before insert or update on public.profiles_private
for each row execute function app.acotar_presencia_al_presente();


-- ---------------------------------------------------------------------------
-- 3 · tocar_presencia() — barata o no sirve
--
--     La llama la app en cada request/navegación, así que el costo por llamada
--     es el diseño entero. El acelerador vive en el `where` del ON CONFLICT: si
--     la marca tiene menos de 60 segundos, la sentencia hace una sola sonda por
--     PK, no escribe ninguna versión nueva de la fila y termina. Sin eso, una
--     persona con la app abierta genera un UPDATE por request sobre una tabla
--     que además tiene un índice GIN (`profiles_private_languages_idx`, 0062).
--
--     60 segundos y no 30: la ventana de "en línea" de §4 es de 2 minutos, así
--     que con un minuto de resolución nadie aparece desconectado estando adentro.
--
--     La fila puede no existir todavía (profiles_private se crea en el
--     onboarding, y no todo el mundo lo completó), por eso es un upsert y no un
--     update. El `tenant_id` sale de public.profiles y NO del claim del JWT: es
--     una columna NOT NULL con FK y la fila del perfil es la fuente de verdad.
-- ---------------------------------------------------------------------------
create or replace function public.tocar_presencia()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- En silencio a propósito: esto se llama de fondo desde pantallas que ya
  -- funcionan sin sesión. Un AUTH_REQUIRED acá sería un error en la consola de
  -- cada visitante y ninguna acción del usuario que corregirlo.
  if v_uid is null then
    return;
  end if;

  insert into public.profiles_private (profile_id, tenant_id, last_seen_at)
  select p.id, p.tenant_id, now()
    from public.profiles p
   where p.id = v_uid
  on conflict (profile_id) do update
     set last_seen_at = now()
   where public.profiles_private.last_seen_at is null
      or public.profiles_private.last_seen_at < now() - interval '60 seconds';
end;
$$;

comment on function public.tocar_presencia() is
  'Marca que quien llama está acá, ahora (0145). SECURITY DEFINER porque escribe profiles_private, que está cerrada por RLS, y sólo toca la fila de auth.uid() — nunca recibe un id por parámetro. Idempotente y BARATA: el `where` del ON CONFLICT es un acelerador de 60 segundos, así que una marca fresca no genera una versión nueva de la fila por más veces que se llame. Sin sesión no hace nada y no lanza: la llaman pantallas que también se sirven sin cuenta.';

revoke all    on function public.tocar_presencia() from public, anon;
grant execute on function public.tocar_presencia() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4 · presencia_de() — la única puerta al dato ajeno
--
--     Tres candados, y ninguno se puede sacar sin abrir el otro:
--       · el tenant sale de la FILA del perfil de quien llama, no del claim.
--         Con DEFINER la RLS de profiles no interviene, así que el filtro de
--         comunidad lo tiene que poner la función; tomarlo de la fila y no del
--         JWT es lo que hace que un claim viejo o cruzado no alcance para leer
--         la presencia de otra comunidad (la lección de la 0091).
--       · quien apagó `mostrar_ultima_vez` sale con false/null. No se lo
--         excluye del resultado: la fila viaja igual para que la UI no tenga
--         que adivinar si la persona no existe, no comparte comunidad o
--         simplemente no lo muestra.
--       · un perfil de otro tenant NO devuelve fila. No devuelve tampoco un
--         "false": la ausencia no confirma ni desmiente que ese id exista.
--
--     El tope de 100 es el mismo criterio de fue_leido_por_el_otro_en_lote()
--     (0141): sin él, un array fabricado convierte un RPC liviano en un join
--     sobre una cantidad arbitraria de filas. La bandeja parte lotes mayores
--     del lado de la app.
--
--     SIN ÍNDICE en `last_seen_at`, y es una decisión, no un olvido: las dos
--     únicas consultas del contrato llegan a la fila por clave primaria
--     (profiles.id / profiles_private.profile_id). Nada filtra ni ordena por la
--     marca, así que un índice ahí no lo usaría nadie y sí encarecería cada
--     escritura de tocar_presencia(), que es justamente lo que se quiso barato.
-- ---------------------------------------------------------------------------
create or replace function public.presencia_de(ids uuid[])
returns table (
  profile_id uuid,
  en_linea   boolean,
  ultima_vez timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
begin
  if v_uid is null or ids is null then
    return;
  end if;

  if coalesce(pg_catalog.cardinality(ids), 0) > 100 then
    raise exception 'TOO_MANY_PROFILES: el máximo por consulta es 100.';
  end if;

  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_uid;

  if v_tenant is null then
    return;
  end if;

  return query
  with pedidos as (
    select distinct u.id_pedido
      from pg_catalog.unnest(ids) as u(id_pedido)
     where u.id_pedido is not null
  )
  select p.id,
         case
           when p.mostrar_ultima_vez
             then coalesce(pp.last_seen_at > now() - interval '2 minutes', false)
           else false
         end,
         case
           when p.mostrar_ultima_vez then pp.last_seen_at
           else null
         end
    from pedidos q
    join public.profiles p
      on p.id = q.id_pedido
     and p.tenant_id = v_tenant
    left join public.profiles_private pp
      on pp.profile_id = p.id;
end;
$$;

comment on function public.presencia_de(uuid[]) is
  'La presencia de hasta 100 personas en UNA consulta (0145): (profile_id, en_linea, ultima_vez). "En línea" es haber tocado presencia en los últimos 2 minutos. Es la ÚNICA puerta al last_seen_at ajeno —la columna vive en profiles_private, cerrada por RLS solo-dueño— y por eso aplica acá los tres filtros: quien tiene mostrar_ultima_vez en false sale con en_linea = false y ultima_vez = null (apagarlo esconde las dos cosas); sólo se devuelven perfiles del MISMO tenant que quien llama, y ese tenant sale de la fila del perfil y no del claim del JWT, porque con SECURITY DEFINER la RLS de profiles no interviene; un id de otra comunidad o inexistente no devuelve fila, así que la ausencia no confirma que exista. El tope de 100 es el mismo de fue_leido_por_el_otro_en_lote() (0141): un array fabricado no puede convertir un RPC liviano en un join sobre una cantidad arbitraria de filas.';

revoke all    on function public.presencia_de(uuid[]) from public, anon;
grant execute on function public.presencia_de(uuid[]) to authenticated, service_role;

commit;

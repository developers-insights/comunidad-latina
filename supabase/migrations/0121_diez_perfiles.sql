-- =============================================================================
-- 0121_diez_perfiles.sql — Comunidad Latina
--
-- «Falta agregar otro negocio, ya que la persona puede crear hasta 10 perfiles
-- diferentes.» · «Y según cada perfil, debería de hacerse la verificación de
-- stripe si quieren abrir negocios/empleos/creador.» · «Para vender dentro de
-- la plataforma, tenés que estar verificado sí o sí.» (Cliente, 2026-08-26.)
--
-- Son tres pedidos y una sola raíz: hasta hoy "la identidad" de una persona era
-- una sola cosa y por eso todo lo que colgaba de ella —la cuenta, la ficha del
-- directorio, la verificación— se podía atar al DUEÑO. Con diez, no: cada cosa
-- tiene que colgar del NEGOCIO. Esta migración mueve esos tres anclajes.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · EL TOPE DE DIEZ — POR QUÉ UN TRIGGER Y NO UN ÍNDICE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Lo que se va es `business_accounts_one_per_owner` (0103), un índice único
-- sobre (tenant_id, owner_id). Su comentario decía la verdad de su momento:
-- «no es una restricción de producto inventada acá: es lo que el código YA
-- asumía». Ahora el producto pide diez, así que el candado cambia de forma.
--
-- Las tres formas de escribir "hasta diez", y por qué gana la tercera:
--
--   1. CHECK CONSTRAINT. No existe: un CHECK no puede llevar subconsultas, y
--      contar filas hermanas es exactamente una subconsulta. No es que sea peor,
--      es que Postgres lo rechaza. Queda descartada por el motor, no por gusto.
--
--   2. ÍNDICE PARCIAL + COLUMNA `slot`. Se agrega `slot smallint check (slot
--      between 1 and 10)` y un unique (tenant_id, owner_id, slot). Es la que
--      parece más "de base de datos" y es la peor de las tres:
--        · Obliga a la APP a elegir el número libre antes de insertar. Dos
--          altas simultáneas eligen el mismo, chocan con un 23505, y hay que
--          escribir un reintento — o sea que la carrera vuelve, disfrazada.
--        · Borrar el negocio 3 deja un agujero. O se reciclan los números (y
--          entonces el `slot` no identifica nada) o se agotan a los diez altas
--          aunque queden dos negocios vivos.
--        · Es una columna que ningún formulario escribe y que ninguna pantalla
--          muestra. La 0103 ya rechazó exactamente eso («una columna que ningún
--          formulario escribe es letra muerta», con `business_verifications`
--          como escarmiento) y la 0116 lo repitió.
--        · Y el error resultante es un 23505 mudo: "clave duplicada". La app no
--          puede distinguirlo de cualquier otro choque para traducirlo a
--          «llegaste al tope de diez».
--
--   3. TRIGGER BEFORE INSERT QUE CUENTA. ←— el elegido.
--      Cuenta las cuentas del par (tenant, dueño) y rechaza la número once con
--      un mensaje propio y reconocible. Sin columnas nuevas, sin agujeros, sin
--      reintentos en la app, y con un error que se puede traducir a una frase.
--
-- ── LA CARRERA, QUE ES LA PARTE QUE SE OLVIDA ───────────────────────────────
-- Un trigger que cuenta tiene una ventana real: dos INSERT simultáneos leen 9
-- los dos y entran los dos, y queda una persona con once. `for update` sobre las
-- filas contadas NO sirve —Postgres no bloquea el hueco donde va a nacer la
-- fila número once—, así que el candado va donde sí se puede cerrar: un
-- `pg_advisory_xact_lock` sobre el par (tenant, dueño). Es un lock de una sola
-- clave, se libera solo al terminar la transacción, y sólo serializa altas DEL
-- MISMO dueño en la MISMA comunidad — que son, como mucho, diez en la vida de
-- una persona. No toca a nadie más.
--
-- ── EL TOPE ES POR PERSONA *Y POR COMUNIDAD* ────────────────────────────────
-- Igual que el índice que reemplaza. Diez en Comunidad Latina y diez en la otra
-- comunidad no son veinte para nadie: son dos vecindarios distintos, y el
-- aislamiento por `tenant_id` es la línea que este proyecto no cruza. Contar
-- cross-tenant además obligaría a leer filas de otra comunidad para autorizar
-- una escritura en ésta, que es justo lo que la RLS existe para impedir.
--
-- ── ADMINISTRAR NEGOCIOS AJENOS SIGUE SIN TOPE ──────────────────────────────
-- Sin cambios respecto de la 0103: el tope cuenta `owner_id`, no membresías.
-- Ser `administrador` de veinte negocios de otros no consume ni un lugar. Lo
-- que se limita es FABRICAR cuentas propias, «que es el vector de spam».
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · LA FICHA DEL DIRECTORIO DEJA DE SER DEL DUEÑO Y PASA A SER DEL NEGOCIO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ésta es la parte que NO se ve en el pedido del cliente y sin la cual el
-- pedido no funciona. Hay que decirla entera porque es un cambio de invariante.
--
-- La 0116 hizo que toda cuenta de negocio naciera con su ficha del directorio,
-- porque la cara pública de un negocio —y la llave con la que firma lo que
-- publica, `posts.entity_listing_id`— es esa ficha. Su función
-- `app.asegurar_ficha_de_negocio()` tiene una rama de REUSO: si el dueño ya
-- tenía una ficha `kind='business'` publicada hecha a mano, la adopta en vez de
-- crear otra. Con una sola cuenta por persona eso era exactamente lo correcto.
--
-- Con diez es un bug de identidad: la segunda cuenta de negocio encontraría la
-- MISMA ficha de la primera y se la adoptaría. Dos negocios distintos, un solo
-- rostro público. Todo lo que la persona publicara como "Panadería" y como
-- "Barbería" saldría firmado por la misma ficha, y ninguna pantalla podría
-- distinguirlas — porque en la base no habría nada que distinguir.
--
-- Y si se arregla el reuso sin tocar nada más, aparece el segundo candado:
-- `listings_una_ficha_business_por_dueno` (0106), único sobre
-- (tenant_id, created_by) para las fichas publicadas. La ficha de la segunda
-- cuenta chocaría con él y el alta entera fallaría con un 23505 ilegible.
--
-- ── LO QUE SE HACE ──────────────────────────────────────────────────────────
-- El anclaje se muda del dueño a la cuenta, en tres movimientos que van juntos:
--
--   a) `business_accounts_una_ficha_por_cuenta`: único sobre
--      `business_accounts (listing_id)` donde no es null. ES la invariante que
--      importa ahora — una comunidad no puede ver dos veces el mismo negocio se
--      convierte en DOS CUENTAS NO PUEDEN COMPARTIR UNA CARA. Y a diferencia
--      del índice que reemplaza, éste sí se puede escribir como índice, porque
--      es una unicidad y no un conteo.
--
--   b) `app.asegurar_ficha_de_negocio()` sólo adopta fichas HUÉRFANAS: las que
--      todavía no reclamó ninguna cuenta. La primera cuenta de una persona se
--      comporta EXACTAMENTE como hoy (adopta la ficha que hizo a mano); la
--      segunda ya no puede robársela.
--
--   c) `listings_una_ficha_business_por_dueno` se cae. No queda un agujero: lo
--      que impedía —fabricar fichas de negocio en serie desde
--      `/publicar?kind=business`— lo sigue impidiendo la rama C de
--      `listings_insert`, con la función de abajo.
--
-- ── POR QUÉ SE CAMBIA EL CUERPO DE `ya_tiene_ficha_de_negocio()` Y NO LA POLICY
-- La policy `listings_insert` NO SE TOCA en esta migración, y es deliberado.
-- `supabase/migraciones-en-espera/0109_activar_gate_identidad.sql` la reescribe
-- entera cuando se aplique; si yo la reescribiera ahora, el día que alguien
-- corra la 0109 mi cambio se perdería en silencio y la regla volvería a la
-- versión vieja sin que falle nada. Cambiando el CUERPO de la función que la
-- policy invoca, las dos versiones del texto de la policy —la de hoy y la de la
-- 0109— quedan correctas sin coordinación.
--
-- La regla nueva de la función: se bloquea crear una ficha de negocio cuando ya
-- hay tantas fichas vivas como cuentas de negocio, con piso en uno:
--
--     bloquear  ⟺  fichas_vivas >= greatest(cuentas_de_negocio, 1)
--
-- El `greatest(..., 1)` reproduce EXACTAMENTE la conducta de la 0106 para quien
-- no tiene ninguna cuenta de negocio: podía hacerse una ficha a mano y una sola.
-- Sin ese piso, cero cuentas daría cero fichas permitidas y le romperíamos el
-- alta a todo el que publica su negocio sin pasar por /negocios/cuenta.
--
-- El nombre de la función queda como está —`ya_tiene_ficha_de_negocio`— porque
-- lo nombra la 0109 en espera y renombrarlo obligaría a editar dos archivos que
-- tienen que poder aplicarse en cualquier orden. Su comentario dice la regla
-- nueva con todas las letras.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · VERIFICACIÓN POR PERFIL — SE RESUCITA `business_verifications` (0031)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy la verificación de identidad es un booleano de la PERSONA
-- (`profiles.identity_verified`, 0003), lo escribe el webhook de Stripe
-- Identity y lo leen unas treinta pantallas. El cliente pide que sea POR
-- PERFIL. Eso es un cambio de cardinalidad, así que la primera decisión es qué
-- pasa con esos treinta lectores.
--
-- ── DECISIÓN: `profiles.identity_verified` NO SE TOCA ───────────────────────
-- Sigue siendo la fuente ÚNICA del perfil personal. Ni se migra, ni se copia,
-- ni se deriva. Los treinta lectores —el escudo verde del perfil, las tarjetas
-- de creadores, el marketplace, el Trust Score, el webhook del check azul—
-- siguen leyendo exactamente lo mismo y siguen teniendo razón, porque lo que
-- preguntan es "¿esta PERSONA verificó su documento?" y esa pregunta no cambió.
--
-- Lo que se agrega es la otra mitad: "¿este NEGOCIO verificó su identidad?".
--
-- ── DÓNDE SE GUARDA: EN LA TABLA QUE YA EXISTÍA ─────────────────────────────
-- `public.business_verifications` (0031) es una fila por negocio, con
-- `tenant_id`, RLS enabled + FORCE, SELECT para miembros y staff, y las tres
-- policies de escritura en `false` — o sea, sólo la escribe `service_role` o
-- una función `security definer`. Es EXACTAMENTE la forma que hace falta, y
-- tiene ya la columna con el nombre correcto (`stripe_status`, con
-- 'pending'/'submitted'/'verified'/'restricted'/'rejected').
--
-- Es además la tabla que la 0103 y la 0116 citaron DOS VECES como el ejemplo de
-- letra muerta del esquema («cero referencias en la app»). Darle su primer
-- consumidor real es mejor que agregar al lado una tabla nueva con el mismo
-- propósito y un nombre parecido, que es como se llega a tener dos.
--
-- Se le agregan dos columnas y nada más: quién reclamó la verificación y
-- cuándo. Sin foto, sin número de documento, sin nombre legal — la doctrina
-- anti-honeypot de §5.4 no se afloja porque el sujeto sea un negocio.
--
-- ── CÓMO SE VERIFICA UN NEGOCIO: EL RECLAMO, NO UNA SEGUNDA FOTO ────────────
-- Stripe Identity verifica el documento de UNA PERSONA. No existe "el documento
-- de una panadería". Entonces hay dos caminos posibles:
--
--   · Abrir una sesión de Stripe Identity NUEVA por cada negocio. Le pide a la
--     misma persona la misma foto del mismo documento hasta diez veces, y cada
--     una factura (~USD 1,50 la procesada, ver el rate limit de
--     perfil/verificar/actions.ts). Se le cobra a la plataforma diez veces por
--     comprobar diez veces al mismo ser humano.
--
--   · EL RECLAMO. ←— el elegido.
--     La identidad del negocio se verifica con la identidad de la persona
--     RESPONSABLE de ese negocio. Quien ya tiene su documento validado y es
--     `propietario` o `administrador` reclama la verificación del negocio con un
--     acto explícito, que queda registrado con su nombre y su fecha
--     (`identity_claimed_by` / `identity_claimed_at`) y en el log del negocio.
--
-- El reclamo NO es automático y ahí está el punto: un negocio del que sos
-- administrador y nunca reclamaste queda SIN verificar, aunque vos lo estés.
-- Es lo que el cliente pidió —«según cada perfil»—: cada perfil pasa por su
-- puerta, con un responsable con nombre y apellido detrás de cada una.
--
-- Y no afloja nada respecto de hoy: para reclamar hay que tener el documento
-- validado por Stripe, o sea que la llave sigue siendo la misma que la del
-- escudo verde. Lo que se evita es cobrarla diez veces.
--
-- ── QUÉ NO CONCEDE EL RECLAMO ──────────────────────────────────────────────
-- `verification_status` queda en 'partial', NO en 'verified'. Los cinco niveles
-- de la 0031 (información comercial, documental, Stripe, revisión de plataforma)
-- siguen pendientes; sólo se cumplió uno. Importa porque
-- `app.recalc_business_score()` (0037) le da +40 puntos al negocio cuando ese
-- campo dice 'verified': marcarlo entero regalaría cuarenta puntos de Business
-- Score por una foto de documento. 'partial' es el valor honesto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · EL GATE PASA A PREGUNTAR POR LA CARA ACTIVA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public.puedo_publicar_vertical()` (0106) contestaba mirando
-- `app.identidad_verificada(auth.uid())`: la persona. Ahora mira
-- `app.identidad_verificada_activa()`: la identidad con la que se está actuando
-- AHORA (`active_identities`, 0103).
--
-- Es la doctrina de la 0116 y la 0117 llevada a su conclusión: «todo lo que
-- emitís lleva la cara activa». Si publicar un artículo actuando como tu local
-- sale firmado por tu local, la pregunta de si se puede publicarlo tiene que
-- ser sobre tu local. La alternativa —gatear por la persona y firmar por el
-- negocio— deja pasar exactamente el caso que el cliente quiere cerrar: vender
-- a nombre de un negocio que nadie verificó.
--
-- Sin fila en `active_identities` la respuesta es la de siempre, la de la
-- persona. Nadie que no haya tocado el cambiador nota la diferencia.
--
-- ── LA POLICY, OTRA VEZ, NO SE TOCA ────────────────────────────────────────
-- El gate en `listings_insert` sigue APAGADO: lo enciende la 0109, que espera
-- en `supabase/migraciones-en-espera/` por los motivos de su encabezado (0
-- identidades verificadas sobre 20 perfiles y Stripe sin claves: un candado sin
-- llave). Esta migración actualiza la 0109 para que, cuando se aplique, use el
-- mismo predicado que la UI — no la enciende.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · No publica la verificación del negocio hacia afuera. El escudo verde de
--     una persona es público porque `profiles.identity_verified` es una columna
--     de una tabla pública; `business_verifications` la ven sólo los miembros y
--     el staff, y ampliarla a todo el mundo expondría de paso los otros cuatro
--     niveles y sus rechazos. Mostrar la insignia en la ficha pública es una
--     columna espejo en `listings` —el patrón de `store_verified` (0039)— y esa
--     tabla la está tocando otro equipo ahora mismo.
--   · No migra `profiles.identity_verified` a ningún lado. Ver la sección 3.
--   · No toca `verification_subscriptions` (el check azul, 0101). Son cosas
--     distintas: el escudo es gratis y dice quién sos; el check azul se paga.
--   · No borra `business_accounts_stripe_customer_uniq`. Un dueño con diez
--     negocios va a tener diez customers de Stripe distintos, que es lo
--     correcto: son diez suscripciones separables.
-- =============================================================================

begin;

-- ===========================================================================
-- 1 · EL TOPE DE DIEZ
-- ===========================================================================

-- El número, en un solo lugar del lado de la base. `immutable` y sin cuerpo que
-- lea tablas: Postgres la inlinea. El espejo del lado de la app vive en
-- `src/lib/perfil-activo/tope.ts` y sólo sirve para decir "te quedan N" — quien
-- decide es esto.
create or replace function app.tope_de_negocios()
returns integer
language sql
immutable
as $$ select 10 $$;

comment on function app.tope_de_negocios() is
  'Cuántas cuentas de negocio propias puede tener una persona en UNA comunidad. Pedido textual del cliente (2026-08-26): «la persona puede crear hasta 10 perfiles diferentes». Administrar negocios AJENOS (business_members) no tiene tope y no consume lugares. El espejo de este número en TypeScript (src/lib/perfil-activo/tope.ts) es cosmético: sirve para el cartel de "te quedan N" y no autoriza nada.';

revoke all    on function app.tope_de_negocios() from public, anon;
grant execute on function app.tope_de_negocios() to authenticated, service_role;

-- El índice de la 0103 se va. Con él se va también la premisa de la que colgaba
-- media app: `.maybeSingle()` sobre business_accounts filtrado por owner_id
-- ahora puede devolver hasta diez filas y fallar. Los lectores están listados
-- en el reporte de esta migración; los de /negocios/cuenta ya están arreglados.
drop index if exists public.business_accounts_one_per_owner;

create or replace function app.business_accounts_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tope  integer := app.tope_de_negocios();
  v_actual integer;
begin
  -- Serializa las altas del MISMO par (comunidad, dueño) dentro de esta
  -- transacción. Sin esto, dos INSERT simultáneos leen el mismo conteo y entran
  -- los dos: `for update` no sirve porque no hay fila que bloquear donde va a
  -- nacer la número once. Se libera solo al terminar la transacción.
  --
  -- Una sola clave de 64 bits, no dos de 32: `pg_advisory_xact_lock` sólo tiene
  -- las variantes (bigint) y (int, int), y `hashtextextended` devuelve bigint —
  -- pasarle dos bigint da un 42883 en el primer alta. Se comprobó contra la
  -- base real (2026-08-26): la versión de dos argumentos no existe con estos
  -- tipos. Concatenar los dos uuid antes de hashear evita el cast a int, que
  -- tiraría la mitad de los bits del hash.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.tenant_id::text || ':' || new.owner_id::text, 0)
  );

  select count(*) into v_actual
    from public.business_accounts ba
   where ba.tenant_id = new.tenant_id
     and ba.owner_id  = new.owner_id;

  if v_actual >= v_tope then
    -- Prefijo estable: es lo que la server action busca para traducirlo a
    -- «llegaste al tope». Un 23505 mudo no se puede distinguir de otro choque.
    raise exception 'TOPE_DE_NEGOCIOS: ya hay % cuentas de negocio para este dueño en esta comunidad (tope %)', v_actual, v_tope
      using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

comment on function app.business_accounts_enforce_cap() is
  'Tope de app.tope_de_negocios() cuentas de negocio propias por persona y por comunidad. Es un trigger y no un CHECK porque un CHECK no admite subconsultas, y no es un índice porque un índice expresa unicidad y esto es un conteo (ver el encabezado de la 0121). Toma un advisory lock por (tenant, dueño) para que dos altas simultáneas no lean el mismo conteo. El mensaje empieza con TOPE_DE_NEGOCIOS: para que la app lo traduzca en vez de mostrar un error crudo.';

drop trigger if exists business_accounts_enforce_cap on public.business_accounts;
create trigger business_accounts_enforce_cap
before insert on public.business_accounts
for each row execute function app.business_accounts_enforce_cap();

comment on trigger business_accounts_enforce_cap on public.business_accounts is
  'El tope de diez, aplicado EN LA BASE. La server action lo chequea antes para poder decir una frase en español, pero PostgREST está expuesto: quien puentee la app se topa con esto.';

-- El conteo del trigger recorre (tenant_id, owner_id). El índice ya existe
-- desde 0008 (`business_accounts_tenant_owner_idx`) y ahora deja de ser
-- redundante con el único que se acaba de borrar: pasa a ser el que sostiene
-- el chequeo del tope y la lista de "mis negocios".
comment on index public.business_accounts_tenant_owner_idx is
  'Las cuentas de negocio de una persona en una comunidad. Desde la 0121 también sostiene el conteo del tope de diez (app.business_accounts_enforce_cap) — antes lo cubría el único business_accounts_one_per_owner, que se borró al abrir el tope.';


-- ===========================================================================
-- 2 · LA FICHA PASA A COLGAR DE LA CUENTA
-- ===========================================================================

-- (a) Dos cuentas nunca comparten cara.
create unique index if not exists business_accounts_una_ficha_por_cuenta
  on public.business_accounts (listing_id)
  where listing_id is not null;

comment on index public.business_accounts_una_ficha_por_cuenta is
  'Una ficha del directorio pertenece a UNA sola cuenta de negocio. Reemplaza a listings_una_ficha_business_por_dueno (0106), que ataba la unicidad al DUEÑO y por eso hacía imposible el segundo negocio de una misma persona. La invariante que importa no cambió de fondo —una comunidad no ve dos veces el mismo negocio—: cambió de anclaje, del dueño a la cuenta.';

-- (b) Adoptar sólo fichas huérfanas.
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
  end if;

  update public.business_accounts
     set listing_id = v_listing
   where id = p_business
     and listing_id is null;

  return v_listing;
end;
$fn$;

comment on function app.asegurar_ficha_de_negocio(uuid) is
  'Devuelve la ficha del directorio con la que este negocio firma sus publicaciones, creándola si no existe. Idempotente. Desde la 0121 sólo ADOPTA fichas huérfanas (las que ninguna otra cuenta reclamó): con diez cuentas por persona, adoptar la primera ficha publicada del dueño le daba a todos sus negocios la misma cara. Sin fotos a propósito — lo único que publica es el nombre y el rubro, ya moderados en el alta (0116).';

-- (c) El índice que ataba la ficha al dueño se va. Lo reemplaza (a) para la
--     unicidad y `app.ya_tiene_ficha_de_negocio()` para el tope de cuántas.
drop index if exists public.listings_una_ficha_business_por_dueno;

-- (d) La regla de cuántas fichas de negocio puede tener una persona.
create or replace function app.ya_tiene_ficha_de_negocio(
  p_tenant uuid,
  p_owner  uuid,
  p_excepto uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant is not null and p_owner is not null and (
    (
      select count(*)
        from public.listings l
       where l.tenant_id = p_tenant
         and l.created_by = p_owner
         and l.kind = 'business'
         and l.status <> 'removed'
         and (p_excepto is null or l.id <> p_excepto)
    )
    >=
    greatest(
      (
        select count(*)
          from public.business_accounts ba
         where ba.tenant_id = p_tenant
           and ba.owner_id = p_owner
      ),
      1
    )
  );
$$;

comment on function app.ya_tiene_ficha_de_negocio(uuid, uuid, uuid) is
  'true si el perfil YA AGOTÓ sus fichas kind=business: tiene tantas fichas vivas (cualquier estado salvo removed) como cuentas de negocio, con piso en 1. El nombre quedó de la 0106, cuando el tope era siempre uno; la regla la abrió la 0121 al permitir diez cuentas. El piso de 1 reproduce exactamente la conducta anterior para quien no tiene ninguna cuenta de negocio: podía hacerse una ficha a mano, y una sola. El borrador cuenta a propósito (una ficha nace en draft). Se cambia el CUERPO y no la policy listings_insert porque la 0109 en espera la reescribe entera: tocar el texto de la policy haría que aplicar la 0109 revirtiera esta regla en silencio. security definer: sin eso, consultar listings desde una policy de listings es recursión infinita.';


-- ===========================================================================
-- 3 · VERIFICACIÓN POR PERFIL
-- ===========================================================================

alter table public.business_verifications
  add column if not exists identity_claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists identity_claimed_at timestamptz;

comment on column public.business_verifications.identity_claimed_by is
  'Quién reclamó la verificación de identidad de este negocio: una persona con el documento ya validado por Stripe Identity y rol propietario/administrador. Es el responsable con nombre y apellido detrás del perfil. on delete set null — si la cuenta se borra, el hecho de que el negocio fue verificado sobrevive, pero deja de haber a quién señalar.';
comment on column public.business_verifications.identity_claimed_at is
  'Cuándo se reclamó. Junto con identity_claimed_by es TODO lo que se guarda del acto: ni foto, ni número de documento, ni nombre legal (§5.4 anti-honeypot, igual que en la verificación de personas).';

comment on column public.business_verifications.stripe_status is
  'Estado de la verificación de identidad del negocio ante Stripe. Desde la 0121 esta columna tiene por fin un consumidor: la escribe public.verificar_identidad_de_negocio() al reclamar, y la lee app.identidad_verificada_de_negocio(). verified = hay una persona identificada responsable de este perfil.';

-- ¿Este NEGOCIO tiene su identidad verificada?
create or replace function app.identidad_verificada_de_negocio(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bv.stripe_status = 'verified'
       from public.business_verifications bv
      where bv.business_id = p_business),
    false
  );
$$;

comment on function app.identidad_verificada_de_negocio(uuid) is
  'Espejo de app.identidad_verificada(uuid) para el otro tipo de identidad. false ante negocio inexistente o sin fila. security definer porque business_verifications sólo la leen sus miembros: una policy que la consulte no puede depender de quién esté preguntando.';

revoke all    on function app.identidad_verificada_de_negocio(uuid) from public, anon;
grant execute on function app.identidad_verificada_de_negocio(uuid) to authenticated, service_role;

-- ¿Está verificada la CARA CON LA QUE SE ESTÁ ACTUANDO AHORA?
--
-- Ésta es la función que hace que "por perfil" signifique algo. Sin fila en
-- active_identities contesta lo de siempre —la persona—, así que para quien
-- nunca tocó el cambiador no cambia nada.
--
-- Revalida la membresía igual que src/lib/perfil-activo/identidad.ts: una fila
-- que quedó apuntando a un negocio del que a la persona la echaron NO puede
-- seguir prestándole su verificación. Ninguna policy borra esa fila sola.
create or replace function app.identidad_verificada_activa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when v.business_id is null then app.identidad_verificada((select auth.uid()))
    else app.identidad_verificada_de_negocio(v.business_id)
  end
  from (
    select (
      select ai.business_id
        from public.active_identities ai
       where ai.profile_id = (select auth.uid())
         and ai.tenant_id = (select app.current_tenant_id())
         and app.business_role(ai.business_id, (select auth.uid())) is not null
    ) as business_id
  ) v;
$$;

comment on function app.identidad_verificada_activa() is
  'Si la identidad ACTIVA (active_identities, 0103) es un negocio, su verificación; si no, la de la persona. Es la doctrina de la 0116/0117 —«todo lo que emitís lleva la cara activa»— aplicada al gate: publicar firmado por un negocio y que la puerta pregunte por la persona dejaba entrar exactamente el caso que hay que cerrar. Revalida la membresía: la fila que quedó de un negocio del que te echaron no presta su verificación.';

revoke all    on function app.identidad_verificada_activa() from public, anon;
grant execute on function app.identidad_verificada_activa() to authenticated, service_role;

-- El gate de la UI pasa a preguntar por la cara activa. La policy no se toca:
-- ver el encabezado, sección 4.
create or replace function public.puedo_publicar_vertical(p_kind text, p_price numeric default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.vertical_exige_identidad(p_kind, p_price)
      or app.identidad_verificada_activa();
$$;

comment on function public.puedo_publicar_vertical(text, numeric) is
  'Contesta si QUIEN PREGUNTA puede publicar en esa vertical con ese precio, según el gate de identidad. Desde la 0121 mira la identidad ACTIVA (app.identidad_verificada_activa()) y no la persona: si el aviso va a salir firmado por tu negocio, la puerta pregunta por tu negocio. Existe para que el formulario avise antes de que la persona lo llene entero, preguntándole al MISMO lugar que la policy. Nunca acepta el perfil por parámetro: eso sería enumerar el estado de verificación ajeno.';

revoke all      on function public.puedo_publicar_vertical(text, numeric) from public;
revoke execute  on function public.puedo_publicar_vertical(text, numeric) from anon;
grant execute   on function public.puedo_publicar_vertical(text, numeric) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- EL RECLAMO — verificar la identidad de un negocio
--
-- No abre una sesión de Stripe: exige que quien reclama YA tenga su documento
-- validado (misma llave, sin cobrarla diez veces — ver el encabezado). Devuelve
-- un código estable que la server action traduce a copy; nunca lanza para el
-- caso esperable, porque un rechazo previsto no es un error del sistema.
-- ---------------------------------------------------------------------------
create or replace function public.verificar_identidad_de_negocio(p_business uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_tenant  uuid := (select app.current_tenant_id());
  v_cuenta  public.business_accounts%rowtype;
  v_rol     text;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;

  select * into v_cuenta from public.business_accounts where id = p_business;
  -- Mismo código para "no existe" y "no sos miembro": distinguirlos convertiría
  -- esta función en un detector de qué ids de negocio existen.
  if not found or v_cuenta.tenant_id is distinct from v_tenant then
    return 'sin_permiso';
  end if;

  v_rol := app.business_role(p_business, v_uid);
  -- Editor, atención y analista NO reclaman: reclamar es afirmar que sos el
  -- responsable del negocio, y eso son los dos roles de arriba (mismo criterio
  -- que ROLES_QUE_PUBLICAN en src/lib/perfil-activo/identidad.ts, un escalón
  -- más arriba porque acá se firma una declaración, no una publicación).
  if v_rol is null or v_rol not in ('propietario', 'administrador') then
    return 'sin_permiso';
  end if;

  -- Ya está verificado: se contesta que sí y NO se escribe nada.
  --
  -- Sin esta salida, tocar el botón dos veces deja dos filas en
  -- `business_audit_log` y dispara dos recálculos de Business Score por una
  -- acción que no cambió un solo dato. Se comprobó contra la base real
  -- (2026-08-26): dos llamadas seguidas producían `filas_de_auditoria = 2`.
  -- Un log de acciones tiene que poder distinguir lo que pasó de lo que se
  -- intentó, y un doble clic no es un hecho.
  if app.identidad_verificada_de_negocio(p_business) then
    return 'ok';
  end if;

  if not app.identidad_verificada(v_uid) then
    return 'identidad_personal_pendiente';
  end if;

  insert into public.business_verifications as bv (
    business_id, tenant_id, stripe_status, verification_status,
    verification_updated_at, identity_claimed_by, identity_claimed_at
  )
  values (
    p_business, v_cuenta.tenant_id, 'verified', 'partial',
    now(), v_uid, now()
  )
  on conflict (business_id) do update
    set stripe_status           = 'verified',
        -- 'partial' y no 'verified': quedan los otros cuatro niveles de la 0031
        -- y verification_status='verified' vale +40 de Business Score (0037).
        -- Si otro camino ya lo había puesto en 'verified', no se degrada.
        verification_status     = case when bv.verification_status = 'verified'
                                       then 'verified' else 'partial' end,
        verification_updated_at = now(),
        identity_claimed_by     = coalesce(bv.identity_claimed_by, v_uid),
        identity_claimed_at     = coalesce(bv.identity_claimed_at, now())
    -- Se queda aunque la salida temprana de arriba ya cubra el caso normal:
    -- dos pestañas apretando a la vez pasan las dos por el `if`. Acá la que
    -- llega segunda no pisa `identity_claimed_by` (de ahí los `coalesce`).
    where bv.stripe_status is distinct from 'verified';

  -- El log por-negocio de la 0031, que es donde tiene que quedar constancia de
  -- una acción administrativa. Sin PII: el actor es un id, no un nombre.
  insert into public.business_audit_log (tenant_id, business_id, actor_id, action, target_type, target_ref)
  values (v_cuenta.tenant_id, p_business, v_uid, 'identidad_verificada', 'business_verification', p_business::text);

  -- El Business Score lee verification_status (0037). Recalcularlo acá evita
  -- que el número quede viejo hasta el próximo evento que lo dispare.
  perform app.recalc_business_score(p_business);

  return 'ok';
end;
$fn$;

comment on function public.verificar_identidad_de_negocio(uuid) is
  'Reclama la verificación de identidad de un negocio en nombre de quien pregunta. Exige rol propietario/administrador Y documento ya validado por Stripe Identity: la llave es la misma que la del escudo verde de la persona, sin abrir (ni cobrar) una segunda sesión de Stripe por cada uno de los diez negocios. Deja constancia de quién reclamó y cuándo, en la fila y en business_audit_log. Devuelve ok | sin_sesion | sin_permiso | identidad_personal_pendiente — códigos estables que la app traduce a copy. "No existe" y "no sos miembro" devuelven lo mismo a propósito: distinguirlos sería un detector de ids de negocio.';

revoke all      on function public.verificar_identidad_de_negocio(uuid) from public;
revoke execute  on function public.verificar_identidad_de_negocio(uuid) from anon;
grant execute   on function public.verificar_identidad_de_negocio(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- LA LISTA DE IDENTIDADES AHORA DICE TAMBIÉN SI CADA UNA ESTÁ VERIFICADA
--
-- `drop` + `create` porque cambia el tipo de retorno. Es la MISMA consulta de
-- la 0116 con una columna más: que el cambiador sepa qué perfiles están
-- verificados no puede costar una consulta por fila (N+1 en el header, que se
-- pinta en cada navegación).
-- ---------------------------------------------------------------------------
drop function if exists public.identidades_disponibles();

create function public.identidades_disponibles()
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
    (select l.photos[1] from public.listings l where l.id = ba.listing_id),
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
  'Negocios con los que quien pregunta puede actuar AHORA, con su ficha, su foto y si su identidad está verificada (0121). Columnas de IDENTIDAD únicamente: los ids de Stripe de business_accounts NO salen de acá (0103), y de business_verifications sale un booleano y no los cinco niveles con sus rechazos. La foto es listings.photos[1] — path del bucket público listing-photos, la resuelve el cliente (0116).';

-- Igual que en la 0116: `create function` la deja ejecutable por PUBLIC (o sea
-- también por `anon`), y recrearla borra el REVOKE anterior. Va JUNTO al create
-- porque separarlos es exactamente cómo se perdió la primera vez.
revoke all on function public.identidades_disponibles() from public, anon;
grant execute on function public.identidades_disponibles() to authenticated;


-- ===========================================================================
-- CENSO — qué se encontró al aplicar. Números, no supuestos.
-- ===========================================================================
do $$
declare
  v_max_por_dueno int;
  v_fichas_huerfanas int;
  v_negocios int;
begin
  select coalesce(max(n), 0) into v_max_por_dueno
    from (select count(*) as n from public.business_accounts group by tenant_id, owner_id) d;

  select count(*) into v_negocios from public.business_accounts;

  select count(*) into v_fichas_huerfanas
    from public.listings l
   where l.kind = 'business' and l.status = 'published'
     and not exists (select 1 from public.business_accounts ba where ba.listing_id = l.id);

  raise notice '0121 · cuentas de negocio: % · máximo por dueño y comunidad: % (tope nuevo: %)',
    v_negocios, v_max_por_dueno, app.tope_de_negocios();
  raise notice '0121 · fichas kind=business publicadas sin cuenta que las reclame: % — las puede adoptar la próxima cuenta de negocio de su dueño.',
    v_fichas_huerfanas;

  if v_max_por_dueno > app.tope_de_negocios() then
    raise warning '0121 · YA HAY un dueño con % cuentas, por encima del tope de %. El trigger sólo rige para las NUEVAS: las existentes no se tocan (aplicar una regla nueva hacia atrás vacía catálogos).',
      v_max_por_dueno, app.tope_de_negocios();
  end if;
end;
$$;

commit;

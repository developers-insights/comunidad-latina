-- =============================================================================
-- 0106_ofertas_y_verificacion.sql — Comunidad Latina
--
-- Tres cosas que el modelo hoy NO permite, y que comparten una misma raíz: la
-- regla existía en la cabeza del producto y en algún `if` de una server action,
-- pero no en la base. Las tres bajan acá.
--
--   A. OFERTAS de negocios — una oferta que se ve en Publicaciones y en Ofertas
--      SIN ser dos filas.
--   B. GATE DE IDENTIDAD reusable — se crean las FUNCIONES (la UI ya puede
--      preguntar), pero la condición NO se enchufa a la policy todavía: eso lo
--      hace `0109_activar_gate_identidad.sql`, que se aplica aparte y más
--      tarde. Ver su encabezado, y la nota en la rama B de la policy.
--   C. UNA SOLA FICHA POR NEGOCIO — hoy `/publicar?kind=business` hace INSERT
--      ciego y una persona puede terminar con dos fichas del mismo negocio.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A · OFERTAS — POR QUÉ UNA TABLA SATÉLITE Y NO UN `kind` MÁS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El requisito del cliente es textual y es una restricción de INTEGRIDAD, no de
-- pantalla: «Una oferta puede mostrarse en Publicaciones y en Ofertas, pero debe
-- continuar siendo UNA SOLA publicación dentro de la base de datos.»
--
-- Las tres formas de resolverlo, y por qué gana la tercera:
--
--   1. `posts.kind = 'offer'`. Es la que parece obvia y es la que rompe el
--      requisito por el lado equivocado. `posts.kind` es el FORMATO de la
--      publicación —'post' | 'question' | 'text', o sea con qué se pinta la
--      tarjeta—, no su destino. Una oferta con foto es un 'post'; una oferta
--      escrita es un 'text'. Meter 'offer' ahí obliga a elegir entre ser oferta
--      o tener foto, y el día que exista la oferta-encuesta el enum vuelve a
--      quedar corto. Además no hay dónde poner el vencimiento ni el cupón.
--
--   2. Una tabla `offers` propia, con su título, su cuerpo y sus fotos. Es la
--      que rompe el requisito de frente: la oferta pasaría a ser una publicación
--      PARALELA a la de `posts`, y el negocio que quiere que su oferta también
--      aparezca en el feed tendría que publicarla dos veces. Exactamente lo que
--      el cliente pidió que no pasara.
--
--   3. TABLA SATÉLITE 1:1, PK = `post_id`. ←— la elegida.
--      La oferta no es un tipo de publicación: es una publicación que ADEMÁS
--      tiene condiciones comerciales. La fila de `posts` sigue siendo una y
--      sola, con su cuerpo, sus fotos, sus likes y sus comentarios, y aparece
--      en Negocios → Publicaciones sin que nadie haga nada especial. La pestaña
--      Ofertas es el MISMO conjunto filtrado por un join. Nada se duplica
--      porque no hay una segunda fila que pueda desincronizarse: si la
--      publicación se borra, la oferta se va con ella por `on delete cascade`;
--      si se edita el texto, la oferta ya lo tiene, porque el texto nunca
--      estuvo acá.
--
-- El precedente en este esquema es `listing_reviews` → `listing_review_stats`
-- (0093) y `listing_hours` → `listing_hours_slots`: lo que es 1:1 y siempre se
-- lee junto va en la misma fila; lo que es 1:1 pero tiene OTRO dueño de
-- escritura y otro ciclo de vida va en una tabla al lado. Acá aplica el segundo
-- caso, y con un motivo más fuerte todavía: `posts` es la tabla más caliente del
-- producto (la lee el feed entero, en cada scroll). Ocho columnas comerciales
-- que sólo le importan a un puñado de filas de negocio harían más ancha cada
-- fila del feed para siempre, y `posts` ya viene creciendo (0041 encuestas, 0046
-- video, 0089 etiquetas, 0090 música, 0104 filtros).
--
-- ── LO QUE NO SE GUARDA ACÁ, A PROPÓSITO ────────────────────────────────────
-- `listing_id`. Sería cómodo para "las ofertas de este negocio" y sería un
-- SEGUNDO lugar donde vive el hecho "de quién es esta publicación" — el primero
-- es `posts.entity_listing_id` (0023). La 0103 ya rechazó exactamente esto con
-- estas palabras: «agregar acá una columna paralela sería inventar un segundo
-- modelo de autoría para el mismo hecho». Cuando los dos se separen —y se
-- separan— la que mande va a ser la equivocada. El negocio de una oferta se
-- pregunta con `app.negocio_del_post()`, que lo deriva del único lugar donde
-- está escrito.
--
-- `tenant_id` SÍ se guarda, y es la excepción que confirma la regla: no es un
-- dato de negocio sino la frontera de aislamiento. Lo exige el gate
-- (`scripts/rls-enumerator.mjs` falla contra toda tabla de `public` sin
-- `tenant_id` que no esté whitelisteada), lo necesita el índice de la pestaña
-- Ofertas para no barrer las ofertas de las otras comunidades antes de
-- descartarlas, y lo copia el trigger DESDE la publicación — nunca se acepta por
-- parámetro. Es el mismo trato que le da `listing_reviews` al suyo.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- B · EL GATE DE IDENTIDAD — POR QUÉ EN LA POLICY Y NO EN LA SERVER ACTION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy la verificación de identidad se chequea —cuando se chequea— dentro de la
-- server action que publica. Eso no es una defensa: PostgREST está expuesto y
-- cualquiera con un token válido de la comunidad puede insertar en `listings`
-- sin pasar por Next.js. Un gate que vive en el `page.tsx` protege el formulario,
-- no la tabla.
--
-- ── DÓNDE SE ENGANCHA: INSERT, Y NO ES UNA CONCESIÓN ────────────────────────
-- Es la única bisagra que tiene el dueño. Mirando `listings_update` (0075), el
-- WITH CHECK del dueño lo deja mover su aviso sólo entre 'draft',
-- 'pending_review', 'paused' y 'removed': **el dueño no puede escribir
-- 'published'**. Eso lo hace staff o una función `security definer` (es el anti
-- bait-and-switch de 0004, y la 0098 se apoya explícitamente en él). O sea que
-- "publicar" no es un UPDATE que se pueda gatear desde el lado del usuario.
-- Poner el gate en INSERT no es la opción cómoda: es la única que existe, y es
-- además la correcta, porque corta el aviso al nacer en vez de dejarlo llegar
-- hasta la cola de moderación para rebotarlo ahí.
--
-- ── QUÉ PASA CON LO QUE YA ESTÁ PUBLICADO: NADA. Y ES LA DECISIÓN ───────────
-- El gate rige SÓLO para INSERT. `listings_update` no se toca ni una coma.
-- Consecuencias, escritas para que nadie tenga que deducirlas:
--
--   · Quien ya publicó un alquiler sin verificar identidad LO SIGUE TENIENDO
--     publicado, lo sigue pudiendo editar, pausar, despublicar y renovar. No
--     hay ninguna fila que esta migración deje inaccesible para su dueño.
--   · Lo que no va a poder es publicar el SIGUIENTE sin verificarse.
--   · No hay backfill, no hay barrido, no hay nada que despublique retroactivo.
--     Aplicar una regla nueva hacia atrás sobre gente que cumplió las reglas que
--     había es la forma más rápida de vaciar un catálogo y de que el soporte no
--     sepa explicar por qué.
--
-- Gatear también el UPDATE se evaluó y se descartó: como el dueño no puede
-- publicar por UPDATE, lo único que lograría es que alguien no verificado no
-- pueda CORREGIR el aviso que ya tiene arriba —dejándole un aviso vivo con un
-- precio viejo y sin forma de arreglarlo—. Eso no protege a nadie; sólo empeora
-- lo que ya está publicado.
--
-- ── QUÉ VERTICALES, Y POR QUÉ EN UNA FUNCIÓN APARTE ─────────────────────────
-- property (alquileres), product (marketplace), job (empleos) y event SÓLO
-- cuando cobra entrada. La lista vive en `app.vertical_exige_identidad()` y no
-- inline en la policy por un motivo concreto: la UI necesita hacer la MISMA
-- pregunta para poder decir "verificá tu identidad" ANTES de que la persona
-- llene el formulario entero. Con la regla escrita en dos lados, el día que
-- cambie una de las dos copias vamos a tener un formulario que se completa
-- entero y revienta al final. Es la doctrina de `puedo_administrar_aviso()`
-- (0093): la pantalla y la policy preguntan lo mismo al mismo lugar.
--
-- El evento GRATIS queda afuera a propósito. La spec pide identidad donde hay
-- plata de por medio; una juntada de vecinos sin entrada no es eso, y pedirle
-- documento a quien organiza un asado es el tipo de fricción que apaga el
-- módulo Comunidad entero.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- C · UNA SOLA FICHA POR NEGOCIO — DOS CANDADOS, PORQUE EL ÍNDICE LLEGA TARDE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `business_accounts.listing_id` es nullable desde 0008 y NADIE lo llena, así
-- que la relación cuenta-de-negocio ↔ ficha-del-directorio no existe en los
-- datos. Mientras tanto `/publicar?kind=business` inserta sin preguntar. El
-- resultado es una persona con dos fichas del mismo negocio, cada una con sus
-- reseñas y sus horarios, y ninguna forma de decir cuál es "la buena".
--
-- El índice único parcial sobre las fichas PUBLICADAS es la invariante que
-- importa de cara al público: una comunidad no puede ver dos veces el mismo
-- negocio. Pero llega tarde para el problema real, porque una ficha NACE en
-- 'draft' (lo exige `listings_insert`): el índice sobre 'published' no vería
-- pasar el INSERT ciego, y el choque aparecería recién cuando moderación intenta
-- publicar la segunda — un error críptico, lejos de donde se cometió.
--
-- Por eso van los dos:
--   1. Rama nueva en `listings_insert`: no se puede CREAR una segunda ficha de
--      negocio mientras haya una viva (cualquier estado salvo 'removed') del
--      mismo dueño en la misma comunidad. Corta el INSERT ciego en el acto y da
--      un error que la UI puede traducir a "ya tenés tu ficha, editala".
--   2. Índice único parcial sobre las publicadas: la red por debajo, para
--      cualquier camino que no pase por esa policy.
--
-- ── EL ÍNDICE NO PUEDE HACER FALLAR LA MIGRACIÓN ────────────────────────────
-- Si hoy ya existen duplicados, `create unique index` aborta y con él la
-- migración entera. Por eso va envuelto en un bloque con manejo de excepción:
-- si no puede crearse, deja un WARNING con el número exacto de dueños en
-- conflicto y la migración SIGUE. La alternativa —despublicar automáticamente
-- "la de más" para que el índice entre— se descartó: elegir por su cuenta cuál
-- de las dos fichas de un negocio real se apaga, sin que nadie mire, es tomar
-- una decisión de producto disfrazada de migración. El candado 1 impide que el
-- problema crezca; los duplicados que ya existen se limpian mirándolos.
--
-- ── EL BACKFILL ES DELIBERADAMENTE COBARDE ──────────────────────────────────
-- Se llena `business_accounts.listing_id` SÓLO cuando la inferencia es única:
-- la cuenta no tiene ficha asignada y su dueño tiene EXACTAMENTE UNA ficha de
-- negocio viva en esa comunidad. Con dos, no se elige: se deja en null. Un
-- backfill que adivina es peor que un null, porque el null se ve y la
-- adivinanza se hereda.
--
-- No es una precaución teórica. En la base de desarrollo, al escribir esto, de
-- las dos cuentas de negocio existentes la única sin `listing_id` —«Panadería La
-- esperanza»— es justamente la de un dueño con DOS fichas vivas. Un backfill con
-- `limit 1` la habría atado a una de las dos en silencio, con 50% de chance de
-- elegir la equivocada y sin dejar rastro de que hubo una elección.
--
-- ── LO QUE ESTA REGLA DA POR DECIDIDO ───────────────────────────────────────
-- Que una persona no puede tener dos negocios DISTINTOS en la misma comunidad
-- con ficha propia. No lo decide esta migración: lo decidió la 0103 con
-- `business_accounts_one_per_owner`, y su propio comentario explica la salida —
-- se pueden ADMINISTRAR cuantos negocios ajenos se quiera vía `business_members`;
-- lo que no se puede es fabricar cuentas propias en serie, «que es el vector de
-- spam». Esta migración sólo hace que la ficha del directorio siga la misma
-- regla que la cuenta, que hasta hoy no la seguía.
-- =============================================================================

begin;


-- ===========================================================================
-- 0 · HELPERS
--
-- Todos `security definer`: se usan DENTRO de policies. Sin eso, un predicado
-- que consulta `listings` desde una policy de `listings` es recursión infinita
-- (Postgres la detecta y aborta), y uno que consulta `posts` dependería de que
-- quien escribe pueda además LEER esa fila. Es el mismo motivo por el que la
-- 0093 declaró `app.can_manage_listing()` definer —«para poder usarse dentro de
-- policies sin recursión»— y la 0103 hizo lo propio con `app.business_tenant()`.
-- `set search_path = ''` en todas: una función definer con search_path abierto
-- es escalada de privilegios esperando el momento.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ¿Esta persona tiene la identidad verificada?
--
-- Lee `profiles.identity_verified` (0003), que es el flag que escribe el webhook
-- de Stripe Identity y que SÓLO service_role puede tocar (lo blinda el trigger
-- `protect_profile_columns` desde 0003, reforzado en 0021 y 0030). O sea: es un
-- dato que el usuario no puede escribirse a sí mismo, que es la condición para
-- que sirva como gate.
--
-- NO confundir con el check azul (`profiles.verified_badge`, 0101): ese es una
-- SUSCRIPCIÓN PAGA y es una insignia de reputación. Esto es identidad real
-- comprobada contra un documento, es gratis, y es lo que la spec exige para
-- publicar. Gatear con el check azul sería cobrar por publicar un alquiler.
--
-- Devuelve `false` —nunca null— para un uuid inexistente o para `auth.uid()`
-- null: un gate que devuelve null se evalúa como "no true" en el WITH CHECK y
-- funcionaría igual, pero cualquiera que lo use fuera de una policy con un
-- `not` adelante se llevaría una sorpresa.
-- ---------------------------------------------------------------------------
create or replace function app.identidad_verificada(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.identity_verified from public.profiles p where p.id = p_profile),
    false
  );
$$;

comment on function app.identidad_verificada(uuid) is
  'true si el perfil tiene identidad verificada (profiles.identity_verified, 0003 — Stripe Identity, gratis). NO es el check azul de pago (profiles.verified_badge, 0101): gatear con aquel sería cobrar por publicar. Devuelve false ante uuid inexistente o null. security definer para usarse dentro de policies sin depender de los grants por columna de profiles (0085).';

revoke all    on function app.identidad_verificada(uuid) from public, anon;
grant execute on function app.identidad_verificada(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ¿Esta vertical exige identidad verificada para publicar?
--
-- ÚNICA fuente de la lista. La consultan la policy de INSERT y la UI (vía
-- `public.puedo_publicar_vertical()`), para que el formulario avise antes y no
-- después. Es `immutable` y no toca tablas: es un catálogo, no un estado.
--
-- ES LA ÚNICA FUNCIÓN DE ESTA MIGRACIÓN SIN `set search_path = ''`, y es a
-- propósito. No es `security definer` y su cuerpo no nombra ni una tabla, ni un
-- operador de un schema ajeno: no hay nada que un search_path hostil pueda
-- secuestrar. A cambio, sin la cláusula `SET` Postgres puede INLINEARLA dentro
-- del WITH CHECK de `listings_insert` en vez de llamarla, que es lo que uno
-- quiere de un predicado que se evalúa en cada alta de aviso. Las otras cuatro
-- sí la llevan porque todas leen tablas.
-- ---------------------------------------------------------------------------
create or replace function app.vertical_exige_identidad(p_kind text, p_price numeric)
returns boolean
language sql
immutable
as $$
  select p_kind in ('property', 'product', 'job')
      or (p_kind = 'event' and coalesce(p_price, 0) > 0);
$$;

comment on function app.vertical_exige_identidad(text, numeric) is
  'Qué verticales exigen identidad verificada para publicar: property (alquileres), product (marketplace), job (empleos) y event SÓLO si cobra entrada (price_amount > 0). El evento gratuito queda afuera a propósito: la spec pide identidad donde hay dinero, y pedirle documento a quien organiza una juntada apagaría el módulo Comunidad. Única fuente de la lista — la leen la policy listings_insert y la UI.';

revoke all    on function app.vertical_exige_identidad(text, numeric) from public, anon;
grant execute on function app.vertical_exige_identidad(text, numeric) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- El gate, preguntable desde la app.
--
-- No toma el perfil por parámetro A PROPÓSITO: sale de `auth.uid()`. Una
-- función que contesta "¿Fulano puede publicar?" es un enumerador del estado de
-- verificación de terceros servido en bandeja (misma regla que
-- `puedo_administrar_aviso()`, 0093).
-- ---------------------------------------------------------------------------
create or replace function public.puedo_publicar_vertical(p_kind text, p_price numeric default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.vertical_exige_identidad(p_kind, p_price)
      or app.identidad_verificada((select auth.uid()));
$$;

comment on function public.puedo_publicar_vertical(text, numeric) is
  'Contesta si QUIEN PREGUNTA puede publicar en esa vertical con ese precio, según el gate de identidad. Existe para que el formulario de /publicar avise antes de que la persona lo llene entero, preguntándole al MISMO lugar que la policy — con la regla escrita en dos lados terminamos con un formulario que revienta al final. Nunca acepta el perfil por parámetro: eso sería enumerar el estado de verificación ajeno.';

revoke all      on function public.puedo_publicar_vertical(text, numeric) from public;
revoke execute  on function public.puedo_publicar_vertical(text, numeric) from anon;
grant execute   on function public.puedo_publicar_vertical(text, numeric) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ¿De qué NEGOCIO es esta publicación?
--
-- Devuelve el id de la ficha `kind='business'` bajo la que se publicó el post, o
-- null si el post es personal, si la entidad es de otra vertical, o si el post
-- no existe. Es el único lugar donde se deriva ese hecho, y por eso `post_offers`
-- no necesita guardarse una copia de `listing_id`.
--
-- Exige además que la ficha sea de la MISMA comunidad que el post. No debería
-- poder pasar lo contrario —`posts_insert` lo verifica—, pero un helper que se
-- usa para autorizar no confía en que otra policy ya filtró: es la regla de la
-- casa desde 0014.
-- ---------------------------------------------------------------------------
create or replace function app.negocio_del_post(p_post uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
    from public.posts p
    join public.listings l on l.id = p.entity_listing_id
   where p.id = p_post
     and l.kind = 'business'
     and l.tenant_id = p.tenant_id;
$$;

comment on function app.negocio_del_post(uuid) is
  'Ficha de negocio (listings.kind = business) bajo la que se publicó un post, derivada de posts.entity_listing_id (0023). null si el post es personal, si la entidad no es un negocio o si el post no existe. Es la ÚNICA derivación de ese hecho: por eso post_offers no guarda una copia de listing_id (la 0103 ya rechazó duplicar la autoría de una publicación).';

revoke all    on function app.negocio_del_post(uuid) from public, anon;
grant execute on function app.negocio_del_post(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ¿Este dueño ya tiene una ficha de negocio VIVA en esta comunidad?
--
-- "Viva" = cualquier estado menos 'removed'. Un borrador cuenta: si no contara,
-- la forma de tener dos fichas sería dejar la primera sin publicar, que es
-- justamente el camino que hace hoy `/publicar?kind=business`.
--
-- `p_excepto` permite preguntar "¿hay OTRA además de esta?", que es lo que
-- necesita cualquier chequeo sobre una fila que ya existe.
-- ---------------------------------------------------------------------------
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
  select p_tenant is not null and p_owner is not null and exists (
    select 1
      from public.listings l
     where l.tenant_id = p_tenant
       and l.created_by = p_owner
       and l.kind = 'business'
       and l.status <> 'removed'
       and (p_excepto is null or l.id <> p_excepto)
  );
$$;

comment on function app.ya_tiene_ficha_de_negocio(uuid, uuid, uuid) is
  'true si el perfil ya tiene una ficha kind=business VIVA (cualquier estado salvo removed) en esa comunidad. El borrador cuenta a propósito: una ficha nace en draft, así que ignorarlo dejaría abierto exactamente el camino que hoy usa /publicar?kind=business para crear la segunda. security definer: sin eso, consultar listings desde una policy de listings es recursión infinita.';

revoke all    on function app.ya_tiene_ficha_de_negocio(uuid, uuid, uuid) from public, anon;
grant execute on function app.ya_tiene_ficha_de_negocio(uuid, uuid, uuid) to authenticated, service_role;


-- ===========================================================================
-- A · post_offers — LA OFERTA, COLGADA DE LA PUBLICACIÓN QUE YA EXISTE
-- ===========================================================================

create table if not exists public.post_offers (
  -- PK = FK. Es lo que hace que la relación sea 1:1 por construcción y no por
  -- convención: no hay forma de escribir dos ofertas para la misma publicación
  -- ni de que quede una huérfana (cascade).
  post_id      uuid primary key references public.posts(id) on delete cascade,

  -- Copiado DESDE el post por el trigger de guarda, nunca aceptado por
  -- parámetro. Está acá porque es la frontera de aislamiento (y porque el gate
  -- `scripts/rls-enumerator.mjs` no admite tablas de `public` sin él), no porque
  -- sea un dato de la oferta.
  tenant_id    uuid not null references public.tenants(id),

  -- Los cinco formatos del pedido: descuento, cupón, promo por tiempo limitado,
  -- menú especial y paquete. Es un CHECK y no una tabla de catálogo porque la
  -- lista la fija el producto, no cada comunidad — y una tabla de catálogo que
  -- ningún panel edita es letra muerta (el precedente a no repetir es
  -- `business_verifications`, 0031: cero referencias en la app).
  tipo         text not null check (tipo in ('descuento', 'cupon', 'promo', 'menu', 'paquete')),

  -- La etiqueta que se lee en la tarjeta: "2x1 en empanadas", "20% en cortes".
  -- Corta y obligatoria: una oferta sin titular es una publicación común.
  titulo       text not null check (char_length(btrim(titulo)) between 1 and 120),

  -- El descuento en número, OPCIONAL: un menú especial o un paquete puede no
  -- tener porcentaje ni monto, y forzar un 0 ahí haría que la vidriera diga
  -- "0% de descuento". Cuando hay valor, hay tipo, y viceversa (CHECK abajo).
  valor_tipo   text check (valor_tipo is null or valor_tipo in ('porcentaje', 'monto')),
  valor        numeric(12, 2),

  -- La moneda la pone el trigger desde `tenants.currency` (0002). No se acepta
  -- por parámetro: es un dato de la comunidad, y una oferta que declara su
  -- propia moneda es una oferta que puede mentir el precio.
  moneda       text not null default 'USD',

  -- Opcional por definición: hay ofertas con código y ofertas que se muestran.
  codigo_cupon text check (
                 codigo_cupon is null
                 or char_length(btrim(codigo_cupon)) between 3 and 40
               ),

  starts_at    timestamptz not null default now(),

  -- NOT NULL, sin default. Es el pedido explícito del cliente y es lo que
  -- distingue una oferta de un anuncio: una promoción sin fecha de fin es un
  -- precio. Sin default a propósito — que la app tenga que decidir el plazo en
  -- vez de heredar un número que nadie eligió.
  expires_at   timestamptz not null,

  -- La letra chica: "no acumulable", "hasta agotar stock", "sólo para llevar".
  -- Que exista la columna es la mitad del punto: sin un lugar previsto, las
  -- condiciones terminan escritas en el cuerpo del post y nadie las puede
  -- mostrar al lado del precio.
  terminos     text check (terminos is null or char_length(terminos) <= 2000),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Una ventana al revés no es un error de tipeo: es una oferta que no existe
  -- nunca y que igual ocupa lugar en la pestaña.
  constraint post_offers_ventana_valida check (expires_at > starts_at),

  -- Valor y tipo viajan juntos o no viajan. Sin esto entra un `valor = 20` sin
  -- tipo y la UI tiene que adivinar si son 20% o 20 dólares.
  constraint post_offers_valor_completo check (
    (valor_tipo is null and valor is null)
    or (valor_tipo is not null and valor is not null)
  ),

  -- Un porcentaje vive entre 0 y 100. Un monto es positivo. Un "descuento del
  -- 300%" pasa por la app sin que nada falle y aparece en la vidriera.
  constraint post_offers_valor_coherente check (
    valor is null
    or (valor_tipo = 'porcentaje' and valor > 0 and valor <= 100)
    or (valor_tipo = 'monto' and valor > 0)
  )
);

comment on table public.post_offers is
  'Condiciones comerciales de una publicación de negocio: descuento, cupón, promo por tiempo limitado, menú o paquete, con vencimiento obligatorio. Es una tabla SATÉLITE 1:1 (PK = post_id) y no un kind de posts ni una tabla de ofertas propia — el requisito del cliente es que la oferta se vea en Publicaciones y en Ofertas siendo UNA SOLA publicación en la base. Acá no hay texto, fotos ni likes: todo eso sigue viviendo en la fila de posts, que es la única que existe. La pestaña Ofertas es esta tabla joineada con posts.';

comment on column public.post_offers.post_id is
  'PK y FK a la vez: la relación es 1:1 por construcción. on delete cascade — si la publicación se borra, la oferta no puede sobrevivirla.';
comment on column public.post_offers.tenant_id is
  'Copiado DESDE posts por app.post_offers_guard(): frontera de aislamiento, nunca aceptado por parámetro. No es un dato de la oferta — está para el índice de la pestaña y porque el gate de RLS lo exige en toda tabla de public.';
comment on column public.post_offers.tipo is
  'descuento | cupon | promo | menu | paquete. Los cinco formatos del pedido. Es un CHECK y no un catálogo por tenant porque la lista la fija el producto.';
comment on column public.post_offers.valor is
  'El descuento en número, OPCIONAL: un menú o paquete especial puede no tener porcentaje ni monto, y un 0 forzado haría que la vidriera anuncie "0% de descuento". Va siempre acompañado de valor_tipo.';
comment on column public.post_offers.moneda is
  'Moneda del monto, tomada de tenants.currency por el trigger. No se acepta por parámetro: una oferta que declara su propia moneda es una oferta que puede mentir el precio.';
comment on column public.post_offers.expires_at is
  'Cuándo deja de valer. NOT NULL y sin default: es el pedido explícito del cliente y es lo que separa una oferta de un precio. Que no tenga default es deliberado — el plazo lo elige quien publica, no un número heredado.';
comment on column public.post_offers.terminos is
  'Letra chica ("no acumulable", "hasta agotar stock"). Existe para que las condiciones no terminen enterradas en el cuerpo del post, donde nadie las puede mostrar al lado del precio.';

-- ---------------------------------------------------------------------------
-- El índice de la consulta que realmente se hace
--
-- La pestaña Ofertas pregunta: "ofertas VIGENTES de esta comunidad, la que
-- vence primero arriba" —
--     where tenant_id = $1 and expires_at > now() and starts_at <= now()
--     order by expires_at
--
-- `(tenant_id, expires_at)` sirve al filtro de comunidad, al rango de vigencia
-- y al ORDER BY con el mismo recorrido, sin sort. `post_id` va de tercero para
-- que la búsqueda de los ids a joinear con `posts` salga del índice sin tocar
-- la tabla.
--
-- NO es un índice parcial `where expires_at > now()`: `now()` no es immutable y
-- Postgres no la admite en un predicado de índice. Sería además una trampa —
-- el predicado se congelaría en el instante de la migración. El filtro de
-- vigencia lo resuelve el rango sobre la segunda columna, que es exactamente
-- para lo que sirve un B-tree.
--
-- `starts_at` no entra: es una re-verificación barata sobre un conjunto ya
-- reducido a las ofertas vigentes de UNA comunidad. Meterla partiría el rango
-- y le costaría más al índice de lo que ahorra.
-- ---------------------------------------------------------------------------
create index if not exists post_offers_vigentes_idx
  on public.post_offers (tenant_id, expires_at, post_id);

comment on index public.post_offers_vigentes_idx is
  'La consulta de la pestaña Ofertas: vigentes de esta comunidad ordenadas por vencimiento. Cubre filtro, rango y ORDER BY en un solo recorrido. No es parcial sobre now() porque now() no es immutable —y un predicado así quedaría congelado en la fecha de la migración—.';

drop trigger if exists post_offers_set_updated_at on public.post_offers;
create trigger post_offers_set_updated_at
before update on public.post_offers
for each row execute function extensions.moddatetime(updated_at);

-- Cuenta suspendida no publica ofertas, igual que no publica posts ni reseñas
-- (paridad con 0021 y 0093).
drop trigger if exists post_offers_enforce_account_active on public.post_offers;
create trigger post_offers_enforce_account_active
before insert on public.post_offers
for each row execute function app.enforce_account_active();


-- ---------------------------------------------------------------------------
-- GUARDA — lo que la policy no puede decir
--
-- Tres trabajos, todos por el mismo motivo: hay datos que NO se aceptan del
-- cliente y hay una invariante que un CHECK no puede expresar porque necesita
-- mirar otra tabla.
--
--   1. DERIVA `tenant_id` y `moneda` del servidor. Se ignora lo que venga en el
--      INSERT. Es el trato que la 0093 le dio a `owner_reply_by`/`owner_reply_at`:
--      «la autoría de una respuesta no se acepta por parámetro».
--   2. EXIGE QUE LA PUBLICACIÓN SEA DE UN NEGOCIO. Una oferta sin negocio no
--      existe. La policy de INSERT ya lo pide, y esto lo pide OTRA VEZ para los
--      caminos que no pasan por RLS —service_role, seeds, cron—, que son
--      justamente los que nadie mira cuando algo sale mal.
--   3. CONGELA `post_id`. Es la PK, pero un UPDATE podría moverla y con eso una
--      oferta ya publicada pasaría a colgar de otra publicación, heredando sus
--      likes y su audiencia. Se bloquea explícito.
--
-- Duplicar la regla 2 entre policy y trigger es deliberado y tiene precedente
-- textual en 0046: «el rechazo lo hace además el trigger; acá va también porque
-- la policy es la barrera que el enumerador audita».
-- ---------------------------------------------------------------------------
create or replace function app.post_offers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_moneda text;
begin
  if tg_op = 'UPDATE' and new.post_id is distinct from old.post_id then
    raise exception 'OFERTA_INMUTABLE: una oferta no se muda de publicación';
  end if;

  select p.tenant_id into v_tenant
    from public.posts p
   where p.id = new.post_id;

  if not found then
    raise exception 'OFERTA_SIN_PUBLICACION: la publicación % no existe', new.post_id;
  end if;

  -- La comunidad sale de la publicación. Punto.
  new.tenant_id := v_tenant;

  if app.negocio_del_post(new.post_id) is null then
    raise exception
      'OFERTA_SIN_NEGOCIO: una oferta sólo cuelga de una publicación hecha como ficha de negocio (posts.entity_listing_id → listings.kind = business)';
  end if;

  -- La moneda es la de la comunidad; lo que mande el cliente se descarta.
  select t.currency into v_moneda
    from public.tenants t
   where t.id = new.tenant_id;
  new.moneda := coalesce(v_moneda, 'USD');

  return new;
end;
$$;

comment on function app.post_offers_guard() is
  'BEFORE INSERT/UPDATE en post_offers. Deriva tenant_id (del post) y moneda (de tenants.currency) ignorando lo que mande el cliente, exige que la publicación sea de una ficha kind=business —una oferta sin negocio no existe— y congela post_id para que una oferta no se mude a otra publicación heredándole la audiencia. La misma regla del negocio está en la policy de INSERT: acá se repite para los caminos que NO pasan por RLS (service_role, seeds, cron), que son los que nadie mira cuando algo sale mal.';

drop trigger if exists post_offers_guard on public.post_offers;
create trigger post_offers_guard
before insert or update on public.post_offers
for each row execute function app.post_offers_guard();


-- ---------------------------------------------------------------------------
-- RLS — las CUATRO policies canónicas, ni una más
--
-- El gate `scripts/rls-enumerator.mjs` exige exactamente `_select`, `_insert`,
-- `_update` y `_delete`, y la 0095 explicó por qué no es burocracia: con una
-- policy por actor los permisos se leen sumando expresiones repartidas, y ahí
-- se cuela el agujero que nadie ve —alcanza con que UNA se olvide del filtro de
-- tenant—. Cada rama va como un OR dentro de un solo predicado.
-- ---------------------------------------------------------------------------
alter table public.post_offers enable row level security;
alter table public.post_offers force row level security;

-- SELECT — la oferta es tan pública como la publicación de la que cuelga.
--
-- La rama pública se apoya en `posts.status = 'published'` y NO reimplementa
-- nada: una oferta de un post en revisión o removido no se ve, y sigue el mismo
-- criterio de `posts_select` (0091) — el visitante sin sesión lee lo publicado
-- (SEO) y con sesión se acota a su comunidad. Una oferta vencida SIGUE siendo
-- legible a propósito: quien reclama un cupón de ayer tiene que poder ver qué
-- decía, y esconderlo no lo hace menos exigible. Filtrar por vigencia es trabajo
-- de la consulta, no de la RLS.
--
-- ⚠ ESTA POLICY NO PUEDE LLAMAR A `app.can_manage_listing()` NI A
-- `app.negocio_del_post()`, y por eso la rama privada se escribe con un EXISTS
-- sobre `posts` en lugar de con el helper que sería más expresivo.
--
-- Las expresiones de una policy se evalúan con los privilegios de QUIEN
-- CONSULTA, y la 0081 le revocó a `anon` el EXECUTE sobre todo el schema `app`
-- salvo ocho funciones (current_tenant_id, current_user_role, is_staff,
-- is_global_admin, unaccent_immutable, media_has_video, video_post_href,
-- pair_blocked). Una policy `to anon` que llame a cualquier otra no devuelve
-- `false`: tira «permission denied for function» y se lleva puesta la página
-- pública del negocio. Es la misma razón por la que `listing_reviews_select`
-- (0095) no llama a `can_manage_listing` y `listing_reviews_update` sí — aquella
-- es `to anon, authenticated` y ésta es sólo `to authenticated`.
--
-- Consecuencia conocida y aceptada: antes de que el post esté publicado, la
-- oferta la ve su AUTOR, no cualquier administrador del negocio. Hoy no cambia
-- nada — `posts_insert` (0046) exige `l.created_by = auth.uid()` para publicar
-- como entidad, así que el autor de un post de negocio ES el dueño de la ficha.
-- Si algún día un co-administrador puede postear como el negocio, esa ventana
-- previa a la publicación hay que revisarla acá.
drop policy if exists post_offers_select on public.post_offers;
create policy post_offers_select on public.post_offers
for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
     where p.id = post_offers.post_id
       and p.status = 'published'
       and (
         (select auth.uid()) is null
         or p.tenant_id = (select app.current_tenant_id())
       )
  )
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      exists (
        select 1 from public.posts p
         where p.id = post_offers.post_id
           and p.author_id = (select auth.uid())
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy post_offers_select on public.post_offers is
  'La oferta es tan pública como su publicación: la rama abierta se apoya en posts.status = published con el mismo criterio de posts_select (0091) —sin sesión lee lo publicado por SEO, con sesión se acota al tenant—. El autor del post y el staff de la comunidad la ven aunque esté en revisión, para poder explicar por qué todavía no aparece. NO llama a app.can_manage_listing ni a app.negocio_del_post a propósito: la 0081 le revocó a anon el EXECUTE sobre esas funciones y una policy to anon que las invoque tira permission denied en vez de false (mismo motivo por el que listing_reviews_select no las usa y listing_reviews_update sí). Una oferta VENCIDA se sigue leyendo: esconder un cupón de ayer no lo hace menos exigible. La vigencia la filtra la consulta, no la policy.';

-- INSERT — la oferta la crea quien ADMINISTRA el negocio, no quien tipeó el post.
--
-- `app.can_manage_listing()` (0093) cubre al dueño de la ficha y a los miembros
-- activos con rol de gestión (0031). No se exige `posts.author_id = auth.uid()`
-- a propósito: la oferta es del NEGOCIO, y en un negocio con varios
-- administradores el que carga la promo del mes no tiene por qué ser el mismo
-- que escribió la publicación.
--
-- Y como `can_manage_listing(null, …)` es false, este único predicado también
-- garantiza que el post sea de una ficha de negocio: sin negocio no hay a quién
-- administrar. Una condición, dos invariantes.
--
-- ── EL AISLAMIENTO SE COMPRUEBA SOBRE `post_id`, NO SOBRE `tenant_id` ───────
-- Las dos líneas de tenant que siguen parecen una repetición y no lo son.
--
-- `tenant_id = (select app.current_tenant_id())` es la comparación de rutina que
-- lleva toda tabla del esquema. Pero `tenant_id` es una columna que el BEFORE
-- trigger reescribe, y Postgres evalúa el WITH CHECK después de los BEFORE ROW
-- triggers — o sea que esa línea está mirando un valor DERIVADO. Apoyar el
-- aislamiento entero en ella es apoyarlo en un detalle de orden de ejecución, y
-- el día que alguien mueva la derivación a otro lado se convierte en un
-- chequeo de "declaraste bien tu tenant", que no protege de nada.
--
-- El EXISTS es el que no depende de nada de eso: mira la comunidad DE LA
-- PUBLICACIÓN, buscada por `post_id`, que el trigger tiene prohibido tocar
-- (`OFERTA_INMUTABLE`). Colgar una oferta de un post de otra comunidad falla ahí
-- sin importar en qué orden corra el resto.
drop policy if exists post_offers_insert on public.post_offers;
create policy post_offers_insert on public.post_offers
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.posts p
     where p.id = post_offers.post_id
       and p.tenant_id = (select app.current_tenant_id())
  )
  and app.can_manage_listing(app.negocio_del_post(post_id), (select auth.uid()))
  and expires_at > now()
);

comment on policy post_offers_insert on public.post_offers is
  'La crea quien ADMINISTRA el negocio (app.can_manage_listing: dueño de la ficha o miembro activo con rol de gestión, 0031), no necesariamente quien escribió el post — en un negocio con varios administradores el que carga la promo no tiene por qué ser el que publicó. Como can_manage_listing(null, …) es false, el mismo predicado garantiza que el post sea de una ficha de negocio. El aislamiento se comprueba DOS veces y a propósito: sobre tenant_id (la columna, que el BEFORE trigger deriva del post) y sobre post_id vía EXISTS — esta última es la que no depende del orden trigger/WITH CHECK, porque post_id es inmutable. expires_at > now(): no se nace vencido.';

-- UPDATE — mismos actores, más el staff. El `with check` repite el `using` para
-- que nadie mueva una oferta fuera de su comunidad al editarla (0095).
drop policy if exists post_offers_update on public.post_offers;
create policy post_offers_update on public.post_offers
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      app.can_manage_listing(app.negocio_del_post(post_id), (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      app.can_manage_listing(app.negocio_del_post(post_id), (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy post_offers_update on public.post_offers is
  'Editan quienes administran el negocio y el staff de la comunidad. El with check repite el using para que nadie mueva una oferta fuera de su comunidad al editarla (doctrina 0095). Qué NO se puede cambiar —post_id, tenant_id, moneda— lo cierra el trigger app.post_offers_guard, no esta policy: la RLS autoriza filas, no columnas.';

-- DELETE — borrar la oferta deja viva la publicación, que es el punto de toda
-- la decisión de diseño: bajar una promo vencida no borra el posteo ni sus
-- comentarios.
drop policy if exists post_offers_delete on public.post_offers;
create policy post_offers_delete on public.post_offers
for delete to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      app.can_manage_listing(app.negocio_del_post(post_id), (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy post_offers_delete on public.post_offers is
  'Borrar la oferta deja VIVA la publicación, que es el punto de la tabla satélite: bajar una promo vencida no se lleva puesto el posteo, sus fotos ni sus comentarios.';

-- ---------------------------------------------------------------------------
-- GRANTS — sin esto todo lo de arriba es letra muerta
--
-- En esta base los default privileges del schema `public` NO incluyen a `anon`
-- y no garantizan nada para tablas nuevas: es la secuela documentada en el
-- encabezado de 0085, donde `anon`/`authenticated` habían perdido los
-- privilegios sobre las 74 tablas y la app entera se veía VACÍA sin un solo
-- error —porque sin privilegio de tabla, Postgres ni llega a evaluar la policy—.
-- Toda tabla nueva termina con su grant explícito.
--
-- `anon` recibe SELECT y nada más: la ficha de un negocio y sus ofertas son
-- contenido público (SEO), pero sin sesión no se escribe nada.
-- ---------------------------------------------------------------------------
revoke all on table public.post_offers from anon, authenticated;
grant select                         on table public.post_offers to anon;
grant select, insert, update, delete on table public.post_offers to authenticated;
grant all                            on table public.post_offers to service_role;


-- ===========================================================================
-- C · listings_insert — LA FICHA ÚNICA (el gate de identidad va en la 0109)
--
-- Re-creación completa sobre la base de 0050 (que a su vez venía de 0048 ← 0039
-- ← 0038 ← 0004). TODAS las condiciones anteriores quedan idénticas, palabra por
-- palabra; se suma UNA rama al final (la ficha única). Se re-escribe entera y no se "agrega"
-- porque una policy es un predicado único: no hay forma de extenderla sin
-- volver a declararla, y dejarla escrita completa es lo que permite auditarla
-- leyendo un solo lugar.
-- ===========================================================================

drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings
for insert to authenticated
with check (
  -- ── Base intacta (0050) ──────────────────────────────────────────────────
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and source = 'user'
  and status in ('draft', 'pending_review')
  and publisher_name is null
  and publisher_kind is null
  and published_at is null
  and comment_count = 0
  and view_count = 0
  and store_verified = false
  and tier = 'free'
  and store_active = true

  -- ── B · Gate de identidad ── NO ESTÁ ACÁ. Vive en la 0109, sin aplicar. ──
  -- Las funciones que lo implementan (`app.vertical_exige_identidad`,
  -- `app.identidad_verificada`, `public.puedo_publicar_vertical`) SÍ se crean en
  -- esta migración, porque la UI las necesita para poder avisar antes de que la
  -- persona llene el formulario. Lo que no se enchufa todavía es la condición en
  -- esta policy. El porqué, y qué tiene que pasar antes, están en el encabezado
  -- de `0109_activar_gate_identidad.sql`. Resumido: hoy hay 0 identidades
  -- verificadas sobre 20 perfiles y la verificación va por Stripe Identity, que
  -- está sin claves — enchufarlo ahora es un candado sin llave.

  -- ── C · Una sola ficha de negocio (0106) ─────────────────────────────────
  -- Corta el INSERT ciego de /publicar?kind=business en el acto. El `or` de
  -- adelante hace que la subconsulta ni se evalúe para las otras verticales.
  and (
    kind <> 'business'
    or not app.ya_tiene_ficha_de_negocio(
      (select app.current_tenant_id()),
      (select auth.uid())
    )
  )
);

comment on policy listings_insert on public.listings is
  'Base de 0050 (0048 ← 0039 ← 0038 ← 0004) SIN cambios, más UN gate de 0106: una sola ficha kind=business viva por dueño y comunidad, para cerrar el INSERT ciego de /publicar?kind=business. El gate de identidad verificada NO está acá: se aplica por separado en 0109_activar_gate_identidad.sql, que todavía no se corrió — ver su encabezado.';


-- ===========================================================================
-- C · BACKFILL DE business_accounts.listing_id
--
-- Sólo donde la inferencia es ÚNICA: la cuenta no tiene ficha asignada y su
-- dueño tiene exactamente UNA ficha de negocio viva en esa comunidad. Con dos,
-- se deja en null — un backfill que adivina es peor que un null, porque el null
-- se ve y la adivinanza se hereda.
--
-- Idempotente: la segunda corrida no encuentra nada que hacer (el
-- `listing_id is null` ya no se cumple para las que llenó la primera).
-- ===========================================================================

do $$
declare
  v_llenadas int;
begin
  -- `(array_agg(l.id))[1]` y no `min(l.id)`: el `having count(*) = 1` garantiza
  -- que hay una sola fila, así que cualquier agregado sirve para extraerla — y
  -- `min()` sobre `uuid` no está en la lista de tipos que la documentación de
  -- Postgres garantiza para min/max. `array_agg` funciona con cualquier tipo.
  with unicas as (
    select ba.id as business_id, (array_agg(l.id))[1] as listing_id
      from public.business_accounts ba
      join public.listings l
        on l.created_by = ba.owner_id
       and l.tenant_id  = ba.tenant_id
       and l.kind       = 'business'
       and l.status <> 'removed'
     where ba.listing_id is null
     group by ba.id
    having count(*) = 1
  )
  update public.business_accounts ba
     set listing_id = u.listing_id
    from unicas u
   where ba.id = u.business_id;

  get diagnostics v_llenadas = row_count;
  raise notice '0106 · business_accounts.listing_id backfilleadas sin ambigüedad: %', v_llenadas;
end;
$$;


-- ===========================================================================
-- C · EL ÍNDICE ÚNICO — Y EL CENSO DE LO QUE YA ESTÁ DUPLICADO
--
-- Se cuenta ANTES de intentar, para que el número quede en el log aunque el
-- índice entre sin problema (es el dato que hay que mirar) y sobre todo para
-- que quede si NO entra.
--
-- El `create unique index` va dentro de su propio bloque con manejo de
-- excepción: si hoy existen duplicados publicados, abortaría la transacción
-- entera y la migración no se podría aplicar. Preferimos que se aplique todo lo
-- demás y que el conflicto quede gritado en el log a que nada avance. El
-- candado de `listings_insert` ya impide que el problema CREZCA mientras tanto.
-- ===========================================================================

do $$
declare
  v_duenos_en_conflicto int;
  v_fichas_de_mas       int;
begin
  select count(*), coalesce(sum(n - 1), 0)
    into v_duenos_en_conflicto, v_fichas_de_mas
    from (
      select l.tenant_id, l.created_by, count(*) as n
        from public.listings l
       where l.kind = 'business'
         and l.status = 'published'
         and l.created_by is not null
       group by l.tenant_id, l.created_by
      having count(*) > 1
    ) d;

  if v_duenos_en_conflicto = 0 then
    raise notice '0106 · fichas de negocio publicadas duplicadas: ninguna.';
  else
    raise warning '0106 · % dueño(s) con MÁS DE UNA ficha de negocio publicada (% ficha(s) de más). Hay que resolverlo a mano: elegir cuál queda y pausar la otra. Esta migración NO elige por nadie.',
      v_duenos_en_conflicto, v_fichas_de_mas;
  end if;

  begin
    create unique index if not exists listings_una_ficha_business_por_dueno
      on public.listings (tenant_id, created_by)
      where kind = 'business' and status = 'published' and created_by is not null;

    raise notice '0106 · índice listings_una_ficha_business_por_dueno activo.';
  exception
    when unique_violation then
      raise warning '0106 · NO se pudo crear listings_una_ficha_business_por_dueno: ya hay duplicados publicados. La invariante NO está enforced en la base todavía; sí lo está la de listings_insert (no se pueden crear nuevas). Volver a correr esta migración después de limpiar.';
  end;
end;
$$;

comment on column public.business_accounts.listing_id is
  'Ficha del directorio (listings.kind = business) de esta cuenta de negocio. Nullable desde 0008 porque una cuenta puede existir sin ficha publicada —Presencia Verificada se paga aunque no haya listado activo, §6.3—. La 0106 la backfilleó SÓLO donde la inferencia era única (un dueño con exactamente una ficha viva): con dos, queda en null a propósito. Que una persona no pueda tener dos fichas vivas lo garantizan la rama de listings_insert y el índice listings_una_ficha_business_por_dueno.';

commit;

-- =============================================================================
-- 0146_derechos_y_fuente_de_la_foto.sql — Comunidad Latina
--
-- «La pantalla "Contá de qué se trata" … permite escribir la descripción y
-- declarar derechos y fuente de la foto.» (Pliego del cliente, 2026-09-07,
-- punto 11, sobre la captura donde el campo aparece marcado *Opcional* justo
-- debajo de la descripción.)
--
-- Era el único punto del pliego que había quedado sin escribir.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE YA EXISTÍA, Y POR QUÉ NO ALCANZABA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La pregunta ya se hacía. El composer tiene desde la 0061 el bloque "Sobre
-- esta foto" (`OriginalityFields`): un selector de origen, una aclaración libre
-- y un link a la fuente. Todo eso se guarda en `content_assets.originality_*` y
-- `license_*`, una fila POR ARCHIVO.
--
-- El problema es a dónde iba a parar: `content_assets` es una tabla de
-- moderación. La declaración se veía en el panel de integridad y en ningún otro
-- lado. Quien abre la publicación —que es exactamente quien podría reconocer
-- una foto suya y reclamarla— nunca vio nada.
--
-- Una declaración de derechos que sólo lee el equipo de moderación no cumple la
-- función que el cliente le pidió. Por eso la 0146 no agrega una pregunta nueva:
-- agrega el lugar donde la respuesta que ya existe queda ATADA A LA PUBLICACIÓN
-- y puede pintarse debajo de la foto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ DOS COLUMNAS EN `posts` Y NO UNA TABLA NUEVA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El crédito es un atributo de la publicación, no una entidad: hay como mucho
-- uno, no tiene historia propia, nadie lo consulta por separado y muere con el
-- post. Una tabla sería una fila por publicación con su FK, su RLS y su JOIN en
-- cada lectura del feed, a cambio de nada.
--
-- Y sobre todo: `posts` YA tiene la RLS correcta. Quién puede ver el crédito es
-- exactamente quién puede ver la publicación — no hay una segunda pregunta que
-- responder, y por lo tanto no hay una segunda policy que se pueda escribir mal.
--
-- SE DUPLICA A PROPÓSITO CON `content_assets`, y conviene que quede escrito. Son
-- dos proyecciones de la MISMA respuesta con dos lectores distintos:
--
--   · `content_assets.license_kind` — seis valores, para moderación. Distingue
--     una licencia comprada de una Creative Commons porque a quien resuelve un
--     reclamo esa diferencia le importa.
--   · `posts.photo_rights` — cuatro valores, para la tarjeta. Debajo de una foto
--     en el feed esa diferencia no le sirve a nadie y sólo suma ruido legal.
--
-- No pueden contradecirse porque el composer NO pregunta dos veces: la app
-- deriva ésta de aquélla (`creditoDesdeDeclaracion` en
-- `src/lib/feed/creditos-de-foto.ts`) y la traducción va en un solo sentido, del
-- vocabulario grande al chico. Al revés estaría inventando un detalle que la
-- persona nunca dio.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ NULL ES EL DEFAULT Y NO SE MUEVE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NULL significa «no declaró», y NO puede leerse como «es propia». Es la misma
-- regla que la 0061 escribió para `license_kind = 'desconocido'`, y por eso
-- ninguna de las dos columnas lleva default: elegir uno sería poner una
-- afirmación en boca de alguien que no la hizo.
--
-- De ahí también que las publicaciones que ya existen no necesiten backfill: su
-- NULL YA es la respuesta correcta. Se siguen viendo igual que ayer, sin línea
-- de crédito, que es exactamente lo que corresponde a una foto sobre la que
-- nadie declaró nada.
--
-- Y por eso el campo entero es OPCIONAL, como lo marcó el cliente. Bloquear la
-- publicación por no completarlo convertiría la declaración en un trámite que
-- todo el mundo miente para pasar, y una declaración mentida vale menos que
-- ninguna.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTO NO ES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No es una verificación. Es lo que AFIRMA quien publica. Mismo criterio legal
-- que `verification_checks` (§11 del plan) y que el panel de integridad: la UI
-- que pinte estas columnas TIENE que decir que la plataforma no lo comprobó
-- (`CREDITO_COPY.disclaimer`). Una declaración del usuario mostrada como un
-- sello de la plataforma es peor que no mostrar nada.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL CHECK QUE DELIBERADAMENTE NO ESTÁ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Falta el obvio: «sólo una publicación con media puede declarar derechos»
-- (`photo_rights is null or coalesce(array_length(media, 1), 0) > 0`). Se probó
-- y se sacó, y el motivo importa más que la regla.
--
-- La 0097 dejó QUITAR fotos de una publicación ya publicada. Con ese CHECK, la
-- persona que saca la última foto de un post que había declarado su origen no
-- recibe «te quedaste sin fotos»: recibe un 23514 opaco desde Postgres, en una
-- pantalla que no tiene nada que ver con derechos de imagen. Un chequeo que
-- convierte una edición legítima en un error incomprensible cuesta más de lo
-- que protege.
--
-- La regla vive donde puede explicarse: `createPostAction` sólo manda estas
-- columnas cuando el post lleva archivos. Lo peor que puede pasar sin el CHECK
-- es una fila con un crédito y sin foto — un dato que no se pinta en ningún
-- lado, no un agujero.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE NO HACE FALTA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- · SIN ÍNDICE: ninguna consulta filtra ni ordena por el crédito. Se lee con la
--   fila del post, que ya se busca por id (`fetchPhotoCredits` hace un `in` de
--   la página que se está por pintar). Un índice sin consumidor es peso muerto
--   en cada INSERT.
-- · SIN POLICY NUEVA: son dos columnas más de `posts`, que ya tiene sus cuatro
--   policies — y `scripts/rls-enumerator.mjs` exige exactamente cuatro por
--   tabla, así que una quinta rompería el gate. Quién puede escribir una
--   publicación no cambia porque la publicación diga de quién es la foto.
-- · SIN GRANT NUEVO: los grants de este repo son a nivel de TABLA (0114) y no
--   por columna, así que una columna nueva queda cubierta sola. Vale la pena
--   dejarlo escrito porque en esta base ya pasó lo contrario y costó caro: sin
--   grant, la policy ni se evalúa y la app se ve entera vacía, sin un error.
-- · SIN BACKFILL: ver arriba. NULL ya es la respuesta correcta para todo lo
--   publicado hasta hoy.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Las dos columnas
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists photo_rights text;

comment on column public.posts.photo_rights is
  'Derechos de la foto DECLARADOS por quien publica (0146). Vocabulario cerrado de src/lib/feed/creditos-de-foto.ts, derivado de content_assets.license_kind. NULL = no declaró, que NO es lo mismo que "es propia". No es una verificación: es una afirmación del usuario y la UI tiene que decirlo.';

alter table public.posts
  add column if not exists photo_credit text;

comment on column public.posts.photo_credit is
  'Fuente o atribución de la foto en palabras de quien publica (0146): autor, medio o URL. NULL = declaró el origen pero no aclaró la fuente. Se guarda como TEXTO y jamás se pinta como link: una URL que llega del cliente y se vuelve clickeable en el feed de todos es una superficie de phishing.';

-- ---------------------------------------------------------------------------
-- 2) El vocabulario cerrado
-- ---------------------------------------------------------------------------

-- Esta lista y `PHOTO_RIGHTS` en `src/lib/feed/creditos-de-foto.ts` son la MISMA
-- lista. Si divergen: un valor nuevo sólo acá se guarda y no lo pinta nadie; un
-- valor nuevo sólo allá rebota con un 23514 al publicar.
--
-- Los cuatro, y qué afirma cada uno:
--   · propia          — la foto es mía.
--   · con_permiso     — tengo permiso de quien la tomó.
--   · libre           — dominio público o licencia libre (colapsa las tres
--                       variantes de licencia de la 0061).
--   · de_otra_fuente  — la compartí de otra fuente. Es el que MENOS reclama:
--                       cita un origen y no se atribuye ningún derecho.
alter table public.posts
  drop constraint if exists posts_photo_rights_catalog;

alter table public.posts
  add constraint posts_photo_rights_catalog check (
    photo_rights is null
    or photo_rights in (
      'propia',
      'con_permiso',
      'libre',
      'de_otra_fuente'
    )
  );

-- ---------------------------------------------------------------------------
-- 3) La fuente cuelga de la declaración, no flota sola
-- ---------------------------------------------------------------------------

-- Un `photo_credit` sin `photo_rights` sería una atribución sin nadie que la
-- haga: no se puede pintar (la línea arranca por el origen) y seis meses después
-- alguien la lee como si significara algo. Al revés SÍ vale —declarar "es mía"
-- sin escribir una fuente es la respuesta completa y más común—, así que la
-- implicación va en un solo sentido.
alter table public.posts
  drop constraint if exists posts_photo_credit_needs_rights;

alter table public.posts
  add constraint posts_photo_credit_needs_rights check (
    photo_credit is null or photo_rights is not null
  );

-- ---------------------------------------------------------------------------
-- 4) Forma del crédito
-- ---------------------------------------------------------------------------

-- El tope son los mismos 500 de `license_statement` (0061) y no un número más
-- chico: lo que la persona escribió una sola vez tiene que llegar entero a los
-- dos destinos. Que la línea se lea corta en pantalla lo resuelve el
-- `line-clamp` de la tarjeta, que es donde ese problema realmente vive.
--
-- El mínimo importa tanto como el máximo: un input opcional que nadie tocó manda
-- la cadena vacía, y `''` guardado es indistinguible de un dato real al leerlo.
-- La app ya lo normaliza a NULL; este CHECK es la misma regla en el único lugar
-- donde sigue valiendo aunque mañana alguien escriba en `posts` por fuera de
-- `createPostAction`.
alter table public.posts
  drop constraint if exists posts_photo_credit_shape;

alter table public.posts
  add constraint posts_photo_credit_shape check (
    photo_credit is null
    or (length(btrim(photo_credit)) between 1 and 500)
  );

commit;

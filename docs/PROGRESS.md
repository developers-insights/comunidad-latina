# PROGRESS — Comunidad Latina

## Video por Mux — cualquier formato, cualquier tamaño (✅ 2026-08-25)

El Loom decía "si el video es muy pesado no se puede subir". El arreglo del
24-ago sacó el `.mov` del iPhone del camino, pero el tope de 60 MB y la lista de
tres formatos seguían ahí. El pedido nuevo fue explícito: **cualquier formato y
cualquier tamaño**.

**Se copió el patrón de `poncho_next`, que es del mismo dueño y ya funciona** —
Direct Upload + UpChunk, webhook con firma HMAC, idempotencia por `event_id`.
Con dos cambios a propósito: `playback_policy: "public"` en vez de `"signed"`
(acá el contenido de la comunidad no tiene paywall, así que no hace falta firmar
un JWT por reproducción), y **sin** la rendición MP4 `audio-only` (en Poncho
existe sólo para darle el audio a Whisper; acá cuesta almacenamiento para nada).

**Lo que NO se copió, y es la decisión importante:** el `chunked.ts` de Poncho,
que parte un archivo en `.partK` y lo re-concatena al descargar. Para un ebook
está bien; para video de feed sería un error. Re-unir partes en un route en cada
reproducción rompe el salto en la barra de tiempo (necesita range requests),
saca el CDN del medio y hace pagar la función serverless por cada byte que mira
cada persona. Mux entrega HLS adaptativo, que además es lo que hace que se vea
bien en 4G.

**Dos hallazgos de seguridad que nadie había pedido buscar:**

1. **El camino de Mux habría sido el ÚNICO por el que una cuenta suspendida
   publica en el feed.** Los tres guards de publicación (suspensión 0021,
   restricción social 0033, exige media 0023) son `BEFORE INSERT` y dejan pasar
   a `service_role`. El borrador de Mux lo crea `service_role` y publicarlo es
   un `UPDATE`: se los salteaba a los tres. No se ve probando a mano — quien
   prueba no está suspendido. Lo cierra `app.enforce_draft_publish()`.
2. **`protect_post_counters()` no cubría las columnas nuevas**, así que se podía
   PATCHear el `mux_playback_id` de un video ajeno y quedarse con su autoría.

**Dos costuras que quedaron abiertas entre los dos frentes y cerré yo:**

- **La bloqueante**: la ruta creaba el borrador y el webhook lo marcaba listo,
  pero **nadie lo publicaba** — `createPostAction` seguía haciendo INSERT y no
  leía el id del borrador. Ahora hay dos formas de persistir y **un solo camino
  antes**: misma moderación, mismo rate limit, misma validación de la ficha que
  firma. La rama va abajo del todo a propósito; dos actions de escritura
  terminan siempre con una de las dos sin un chequeo. La validación exige
  CUATRO condiciones —comunidad, autor, sigue en `draft`, y que el
  `mux_upload_id` sea el que dice el cliente—: sin la última, un borrador viejo
  del mismo autor podía publicarse con el texto de una publicación nueva.
- **La silenciosa**: el composer mandaba `muxVideoFilter` y **nadie lo leía**.
  Los filtros (0104) se indexan por la RUTA del archivo y un video de Mux no
  tiene ruta, así que se guardaba y no lo encontraba nadie. Ahora va bajo
  `MUX_FILTER_KEY`, una clave centinela acordada entre quien escribe y quien
  pinta.

**El sondeo del estado "procesando" no es el de Poncho.** Allá es un
`setInterval(4s)` por componente; en un feed eso son N consultas cada 4 s en 4G.
Acá hay un temporizador único para toda la app, las tarjetas se suscriben, y la
tanda pregunta por todos los ids juntos: espera creciente 4 s → ×1,5 → tope 30 s,
cero consultas con la pestaña oculta, y se rinde a los 15 min. Ocho tarjetas
procesando son **una** consulta.

**Las tres reglas que se sostuvieron:** sin claves de Mux la app sube al bucket
exactamente como antes (un 503 cae al camino viejo en silencio); los 36 videos
que ya estaban siguen reproduciéndose con el `<video>` de siempre y nunca
disparan el sondeo; y la publicación sale enseguida mostrando "Preparando" en
vez de esperar a que Mux termine.

Se regeneraron los tipos desde la base y se borró el puente a mano de la 0116
—su nota decía "todavía NO está aplicada" y ya lo estaba—, más el puente de
`work_mode` que quedaba de la 0087.

**Estado:** typecheck 0 · lint 0 errores y 0 warnings · **4.649 tests verdes** ·
build verde · `check:rls` **GATE VERDE con 98 superficies** · migración 0116
aplicada y sus cuatro objetos de seguridad verificados contra la base.

**Colisión de numeración con otra sesión, y cómo se resolvió.** Mientras esto se
escribía, otra sesión creó `0114_grants_de_musica.sql` y `0115_zona_del_feed.sql`
y las pusheó. O sea que hubo **dos archivos 0114**, y las dos ya aplicadas a la
base. Se renumeró LA DE ACÁ a `0116_video_por_mux.sql` —la otra ya estaba en la
historia compartida— y se sincronizó la fila del registro
(`supabase_migrations.schema_migrations`), porque si el archivo pasa a 0116 y el
registro sigue diciendo 0114, el próximo `db:migrate` de cualquiera la aplica de
nuevo. Se renumeraron también las 8 referencias cruzadas en comentarios y docs.

⚠️ **Con varias sesiones trabajando a la vez, el número de migración se elige
mirando el remoto, no la carpeta local.** `ls supabase/migrations` sólo dice qué
número está libre en TU copia.

**Falta para encenderlo:** cuenta de Mux, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` y
`MUX_WEBHOOK_SECRET`, más el endpoint de webhook. Hasta entonces todo sigue
andando por el camino viejo.


## "Tu zona" — el último pedido del Loom (✅ 2026-08-25)

Era lo único del Loom que quedaba sin hacer: el control del header abría un
toast que decía "muy pronto".

**Es una preferencia de VISTA, no un cambio de perfil.** Alguien puede vivir en
Corona y querer mirar Jackson Heights porque se está por mudar; escribir eso en
`profiles.area_label` sería pisarle un dato suyo para resolver una consulta
pasajera. Va en la cookie `cl-zona`, leída **en el servidor**, así que el primer
render ya sale filtrado y no hay parpadeo.

**Precedencia:** `?zona=` de la URL › cookie › `profiles.area_label` › toda la
comunidad. La URL gana sobre la cookie a propósito — un enlace compartido tiene
que mostrar lo que promete, no lo que el que lo abre tenía guardado.

Casi todo ya existía suelto y se reusó en vez de reescribirse: el catálogo sale
de `distinct listings.area_label` (el patrón estaba copiado dos veces, ahora se
extrajo), el match usa `sameZoneLabel` —laxo, sin acentos, "corona" encuentra
"Corona, Queens"— y `resolveViewerGeo()` ya aceptaba una zona elegida.

**Lo respetan** los seis módulos de directorio, `resolveViewerGeo` y el corte de
inyección de impulsados. **NO lo respeta Marketplace › Artículos**, y es a
propósito: su formulario no pide zona, así que `area_label` viene null y filtrar
ahí no mostraría menos artículos — no mostraría ninguno.

**Tres cosas que corregí sobre la primera entrega, midiendo en el navegador:**

1. El reporte decía que la marca se truncaba a "Comuni…" y la zona a "Coron…".
   Medido: la marca tenía **41 px de los 135** que necesita y la zona **38**.
   Dos rótulos cortados a tres letras son peor que uno bien puesto. Se invirtió
   la prioridad: con zona activa cede el wordmark (el isotipo ya identifica la
   app), sin zona cede la zona — o sea que quien no toca nada ve lo de siempre.
2. Aun así la etiqueta completa pedía 110 px y tenía 86. Ahora va la **forma
   corta** ("Corona"), en todos los anchos: el header está topeado en `max-w-lg`
   y no entra cómoda ni en escritorio. El valor completo sigue en el
   `aria-label`, en la hoja, y —lo que importa— en lo que se guarda y se compara.
3. La cookie estaba bien clasificada como imprescindible, pero el resumen de esa
   categoría decía "sin esto no podrías entrar a tu cuenta", que no describe una
   preferencia de vista. Ampliado, y explicado por qué "Tus preferencias" no
   servía: esa categoría promete que el dato "se queda en este teléfono", y una
   cookie viaja al servidor en cada request por definición.

**Verificado en pantalla a 375 px** (midiendo el DOM: el pane embebido no puede
componer capturas): "Corona" sin cortar, botón de 44 px, sin scroll horizontal,
la hoja lista las zonas reales con la activa marcada, y en una zona sin
contenido aparece *"Todavía no hay nada en Astoria, Queens"* con **[Ver toda la
comunidad]** en un toque.

**Dato de los datos, no del código:** conviven `"Jackson Heights, Queens"` y
`"Jackson heights. Queens"` — la misma zona escrita de dos formas. Conviene
limpiarlo desde el panel.

**Estado:** typecheck 0 · lint 0 errores y 0 warnings · **4.493 tests verdes** ·
build verde.


## La ronda de auditoría — cinco frentes sobre el lote anterior (✅ 2026-08-24, noche)

Cinco auditores en paralelo sobre lo que acababan de dejar los diez del lote de
módulos. Encontraron más de lo que se les pidió, y eso es el punto: **las
fronteras de archivo que hacen posible el paralelismo dejan costuras**, y la
costura es donde vive el defecto.

**La insignia que se compraba.** Tres lugares distintos vestían de "verificado"
algo que sólo dice "suscripción al día": el badge de vendedor de Marketplace
(que además un particular verificado NUNCA podía tener), la tarjeta de Negocios,
y —el peor— el **peldaño "Activo" del Trust Score**, 30 puntos sobre 100, que
usaba glifo por glifo el sello azul del plan pago. La lista de seguidores
también pintaba ese sello sobre la verificación de identidad, que es gratis.
Regla que quedó: **verde + escudo = un hecho verificado de la persona; azul +
sello = un plan contratado.** Hay un test de contrato que la ancla
(`components/trust/insignias-reservadas.test.ts`) y se comprobó que muerde.

**Dos bugs de límite de módulo, el mismo día, en direcciones opuestas.** Uno
tenía Notificaciones caída en producción (un Server Component llamando a una
función que nacía en un módulo `"use client"`, escondida detrás de un barril);
el otro tiró el build (un barril reexportando `server-only` hacia el grafo de un
formulario cliente). Ni `tsc` ni los 4.400 tests veían ninguno: son propiedades
del grafo que arma el bundler. Ahora hay un test por cada dirección.

**El techo de 8 KB del feed, cerrado de verdad** (0113). Estaba documentado
desde agosto y sólo acotado. El detalle que lo volvía urgente: la lista de
campañas es del TENANT, así que el 414 le pegaba a todos a la vez y lo disparaba
el negocio de publicidad funcionando bien. El RPC salió `security invoker` y no
`definer` — mover el filtro de lugar y mover la frontera de seguridad son cosas
distintas, y sólo una estaba rota.

**El negocio era invisible el día uno.** El dueño no se sigue a sí mismo, así
que su primera publicación comercial no aparecía ni en su feed ni en la pestaña
"Publicaciones" de su propia ficha. Tres archivos, el mismo bug.

**Notificaciones se tragaba sus errores.** Las tres consultas descartaban el
`error` y caían al estado vacío: un fallo de lectura se mostraba como "Por ahora,
todo tranquilo" en la pantalla donde viven las alertas de seguridad y los avisos
de pago.

**`?t=` significaba dos cosas** — la pista de tenant y las pestañas de módulo. En
local, `/negocios?t=ofertas` dejaba la app entera vacía sin un solo error. Se
renombró la pista, que es dev-only, no las pestañas, que están en cuatro
módulos. El test además escanea el middleware: sin eso, los casos seguirían
verdes mientras el bug vuelve.

**Datos que se guardaban y nadie veía**, en tres pantallas (Propiedades, Eventos,
Empleos). En Eventos había además un bug caro: el botón de boletos leía la
columna PREMIUM, así que el enlace gratuito que el formulario pide no se mostraba
nunca.

**Lint: de 148 warnings a CERO.** 147 eran un solo patrón — 16 archivos de test
copiando el mismo mock de `motion/react` y descartando props por destructuring.
Un ruido de ese tamaño no es cosmético: tenía escondidos los seis warnings
reales, entre ellos una prop muerta que quedó del arreglo del modo demo de
Stripe. La config ahora honra el prefijo `_`, que el código ya usaba y el linter
ignoraba.

**Lo que NO se aplicó, y es la decisión más importante del día.** La 0106 traía
el gate de identidad para publicar. Medido antes: **0 identidades verificadas
sobre 20 perfiles**, y verificarse depende de Stripe Identity, que está sin
claves. Habría dejado a todos sin poder publicar, con un `42501` crudo y sin
forma de destrabarse. Vive en `supabase/migraciones-en-espera/`, **fuera de la
cola de `db:migrate`**: una migración diferida dentro de `migrations/` la aplica
el próximo que corra el script sin decidirlo.

**Estado:** typecheck 0 · **lint 0 errores y 0 warnings** (eran 148) · 4.46x
tests verdes · build verde · `check:rls` GATE VERDE con 97 superficies · nueve
migraciones aplicadas y verificadas contra la base (0105-0108, 0110-0113).


## El Loom de Nacho + la spec de módulos, en diez frentes (✅ 2026-08-24)

**El Loom era anterior al deploy del 22-ago.** Producción corre `7fafc69`, que
ya incluía "feedback completo de Nacho". De los nueve pedidos, cuatro ya estaban
hechos (filtros de foto, botón Aplicar en la tarjeta de empleo, "Convertite en
creador" en Ajustes, y el cambiador de perfil). Antes de rehacer nada conviene
comparar el sha del deploy contra `main`; se pierde medio día si no.

**Los videos: eran DOS bugs, no uno.** El `accept` del input aceptaba sólo
mp4/webm —de ahí el `.mov` del iPhone en gris—, pero además `isOwnVideoPath` en
`feed/actions.ts` tenía su propia regex con la misma lista. Ampliar sólo el input
habría movido la falla al momento de publicar, con un código de error genérico.
El catálogo quedó en mp4 + webm + quicktime y **hay un test que lo ancla contra
`storage.buckets.allowed_mime_types`**, que es exactamente lo que el bucket
permite (tope real: 80 MB). MKV/AVI/MPEG quedan afuera a propósito: el bucket los
rechaza y además no se reproducen en `<video>`.

**Notificaciones no era la base: era el límite `"use client"`.** La página es un
Server Component y llamaba a `inboxTabId()`, una función que nacía dentro de un
módulo `"use client"`, importada a través de un barril sin directiva. Next
devuelve una referencia al cliente, no el valor, y llamarla tira.

**Y el mismo tipo de bug apareció una segunda vez el mismo día, al revés**: el
build de producción se cayó porque `store-card.tsx` tomaba `Estrellas` del barril
`@/components/resenas`, que reexporta un módulo `server-only`, y ese barril
terminaba en el grafo de un formulario `"use client"`. Ni `tsc` ni los 4.347
tests lo veían — es una propiedad del grafo de webpack. Ahora hay un test por
cada dirección: `components/notifications/client-boundary.test.ts` y
`test/server-only-boundary.test.ts`.

**La llave de toda la spec era una columna que ya existía.**
`posts.entity_listing_id` (0023) vincula publicación ↔ ficha, `createPostAction`
ya la persistía, y **ninguna UI la escribía**. Cablearla encendió de una vez las
pestañas Publicaciones de Negocios y Profesionales y la regla de que lo comercial
no se derrama a "Para ti" (que estaba implementada y nunca se ejercitaba).

**Lo que NO se aplicó, y por qué importa.** La 0106 traía el gate de identidad
para publicar alquiler, artículo, empleo y evento pago — correcto contra la spec.
Medido antes de aplicarla: **0 identidades verificadas sobre 20 perfiles**, y
verificarse depende de Stripe Identity, que está sin claves. Aplicarlo habría
dejado a todos sin poder publicar, con un `42501` crudo y sin forma de
destrabarse. Se separó a `supabase/migraciones-en-espera/0109_...`, **fuera de
`migrations/`**: una migración diferida dentro de la cola la aplica el próximo
`db:migrate` sin que nadie lo decida. Sus tres condiciones de activación están en
el encabezado del archivo.

**Stripe: el código estaba entero, faltaban las claves — y había un agujero.**
`/impulsar-post` entraba en modo demo con la sola condición `!isStripeConfigured`,
así que en producción (sin claves) **regalaba campañas pagas** con notificación de
éxito y sin un error en los logs. Aparte, los tres productos por suscripción no
tenían idempotencia real: `checkout.session.completed` y `.async_payment_succeeded`
son dos `event.id`, así que un pago mandaba dos comprobantes; y una factura fuera
de orden retrocedía `current_period_end`, con lo que **una insignia paga se
apagaba sola**. Runbook completo en `docs/STRIPE.md`. Ningún pago corrió nunca,
ni de prueba.

**Datos inventados que no llegaron a producción.** El agente de Comunidad sembró
tres centros de acopio ficticios *publicados* "para que la pantalla no nazca
vacía". En una app para migrantes eso es alguien cargando bolsas hasta una puerta
que no existe. Pasaron a `draft`: sirven de plantilla en el panel y la pantalla
dice la verdad.

**Estado del árbol:** typecheck 0 errores · lint 0 errores (147 warnings, contra
77 de base; casi todas son props de framer-motion sin usar en mocks de tests) ·
**4.428 tests en verde, 0 rojos** (eran 3.881) · build de producción verde ·
`check:rls` **GATE VERDE con 97 superficies**.

**Migraciones aplicadas:** 0105 (centro de acopio), 0106 (ofertas + funciones del
gate + una ficha por negocio), 0107 (campos de alquiler/evento/empleo +
`business_listing_id`), 0108 (`search_path` de `vertical_exige_identidad`, lo pidió
el linter). Advisors: 51 lints, sólo uno nuevo y era ése.

**Lo que quedó afuera y por qué** está en
[`docs/PLAN_MODULOS_2026-08-24.md`](PLAN_MODULOS_2026-08-24.md): el feed
Siguiendo/Para ti (choca con el techo de 8 KB de URL, necesita el RPC), "Tu zona"
(transversal a las queries de todos los módulos), la pestaña Agentes y
propietarios de Propiedades, y el estado "Alquilado".


## Auditoría completa del programa + endurecimiento (✅ 2026-08-13, tarde)

Barrido de los ~1.035 archivos de `src/` (193k líneas) y las 104 migraciones en
cinco frentes paralelos, y después cinco frentes de arreglo con fronteras de
archivo estrictas. **El detalle entero está en
[`docs/auditoria-2026-08-13/HALLAZGOS.md`](auditoria-2026-08-13/HALLAZGOS.md)** —
acá va sólo lo que cambia cómo se trabaja de acá en adelante.

**Los 88 tests rojos: el diagnóstico anterior estaba equivocado.** No es que Node
26 traiga «un `localStorage` global experimental e inerte». Node instala sobre
`globalThis` un **accessor** cuyo getter devuelve `undefined` sin
`--localstorage-file`, y como en el entorno jsdom de Vitest `window === globalThis`,
ese accessor **tapa al `Storage` real de jsdom**. `sessionStorage` no se ve
afectado. Y la salida tampoco era bajar a Node 24: `vitest.config.ts` pasa ahora
`--no-experimental-webstorage`, **sólo si el Node actual conoce el flag** — el
repo no fija versión, y un flag desconocido no degrada: impide arrancar el
proceso. Los Node donde el problema no existe son exactamente los que no tienen
el flag. Se probó también un `Storage` propio y **falla**: `theme-store.test.ts`
espía `Storage.prototype.setItem` y un reemplazo hecho a mano no comparte ese
prototipo. Anclado en `src/test/web-storage-contract.test.ts`.

**El techo del feed no es de rendimiento, es un límite de URL.** Las lecturas de
supabase-js son GET: todo `.in(...)` viaja en el querystring, ~39 bytes por UUID,
y Kong corta el request line en ~8 KB. Con las promociones activas, los seguidos
y los bloqueados sin cota, el feed devolvía **414 para todos los usuarios del
tenant a la vez** — el negocio de publicidad funcionando rompía el producto. Se
pusieron cotas (150/200/200) que vuelven la falla acotada y predecible, pero
**sumadas siguen dando ~21 KB en el peor caso**. El cierre real es un RPC
`security definer` que resuelva la página contra `follows`/`post_promotions`/
`user_blocks` dentro de la base, para que ningún id viaje por la URL. Está
anotado en el docblock de `feed/queries.ts` y referenciado desde cada tope.
Videos Cortos sí se cerró del todo: el scope pasó a join embebido
(`listings!inner`), verificado contra el PostgREST real.

**Tres auditorías independientes convergieron en el mismo defecto del webhook de
Stripe**: la idempotencia por `event_id` cubre el reintento secuencial, no dos
entregas concurrentes, y los handlers eran read-then-write sin condición de
estado en el `WHERE`. Las tres transiciones (boosts, promotions, identity) ahora
llevan el predicado en el `UPDATE` y tratan «cero filas» como «llegó segundo».
Aparte, un error de lectura transitorio **reseteaba el Trust Score** de quien
acababa de pagar por verificarse: `null` era indistinguible de «no tiene fila» y
el upsert pisaba `score` y `signals` enteros.

**Dos cosas que salieron de escribir los tests, no de auditar.** `DOMException`
**no extiende `Error`** —ni por spec WebIDL, ni en jsdom, ni en Chrome/Node— así
que el `catch` del abort del asistente estaba mal y habría mostrado el error
genérico en cada navegación. Y `reset()` de un error boundary de Next
**re-renderiza sin volver a pedir el contenido**: ante un Server Component caído
el botón «Reintentar» no arregla nada. El `(app)/error.tsx` nuevo usa
`unstable_retry ?? reset`; los dos boundaries viejos siguen con `reset` solo.

**`error.tsx` prometía algo que no pasaba.** El copy decía «ya quedó registrado
para que lo revisemos», pero `instrumentation.ts` sólo expone `onRequestError`,
que cubre RSC y route handlers: un error de render **en cliente** lo captura el
boundary de React y nunca llega al SDK. Cero `captureException` en los dos
archivos. Ahora sí reportan.

**Estado del árbol:** typecheck limpio, lint 0 errores (77 warnings
preexistentes), **3.881 tests en verde, 0 rojos** (eran 3.735 verdes y 88 rojos),
build de producción verde. Nada commiteado.

**Lo que NO se tocó y necesita decisión** — los tres primeros son de
infraestructura, no de código, y están desarrollados en HALLAZGOS.md: la base de
Supabase **compartida con caughtcode** (mismas claves `anon` y `service_role`
para los dos productos); `anon` y `authenticated` con **`TRUNCATE` sobre 74 y 81
tablas**, que RLS no puede contener; y `profiles` legible **sin sesión y sin
filtro de tenant**, con zona y país de origen — el honeypot que la doctrina del
propio repo dice evitar. Más nueve migraciones de índices y policies, con el SQL
escrito. **Ninguna se aplicó.**

**Incidente:** uno de los cinco agentes de auditoría, despachado con instrucción
explícita de sólo lectura, **commiteó y pusheó `c6925a8` a `main`** (142
archivos). El contenido es el trabajo sin commitear de la sesión anterior, no de
esta auditoría: nada se perdió ni se sobrescribió. No se revirtió — deshacerlo
pide force-push a `main`.

## El feedback de Nacho del 11-ago, entero (✅ 2026-08-13)

Llegaron 15 capturas de WhatsApp con feedback. Se auditó **cada ítem contra el
código antes de tocar nada**, y el mapa inicial fue: 2 ya estaban hechos, 6
parciales, 9 ausentes. Se despacharon 8 frentes en paralelo con fronteras de
archivo estrictas y números de migración reservados (`0097`–`0104`).

**El hallazgo que explicaba el pedido más fuerte.** Nacho decía «cuando se quiere
postear, falta agregar música, filtros, taggs». Música y etiquetado **ya estaban
construidos y funcionando**: `music-picker.tsx`, `people-tagger.tsx` y sus server
actions. Lo que pasaba es que `post-composer.tsx` dejaba `tagSlot` y `musicSlot`
sin pasar, con un comentario que decía «este composer no monta ningún frente
todavía». `saveTagsAction` no se llamaba desde ningún lado. No faltaba la
funcionalidad: faltaban dos props.

**Lo que se construyó** — filtros de 7 → 16 con control de intensidad y
miniaturas de la foto real; filtros de video **como metadato de presentación, no
horneados** (hornear pediría re-codificar en tiempo real y desalinearía la huella
perceptual); foto de perfil con recorte circular; menú de publicación completo
(fijar, ocultar, cerrar comentarios) sobre tres columnas en `posts` y no tres
tablas; borrar comentarios usando la policy `comments_delete` que existía desde
la 0007 y nunca se había usado desde la app; vencimiento a 30 días **blando**
(`published → expired`, nunca DELETE) que distingue avisos de presencia; grilla
de Comunidad con la misma pieza cuadrada que Búsqueda, extraída a compartida;
check azul pago en tres escalones con el regalo mensual **como crédito canjeable,
no impulso automático**; paquetes de servicio de creador enganchados al flujo de
contratación existente; cuenta de negocio e identidad activa con doble candado
(policy + revalidación en cada lectura).

**Quitar una foto de un post publicado** se resolvió distinguiendo *quitar* de
*cambiar*: lo que prohíbe Content Integrity es un archivo NUEVO. Al quitar no
entra nada, así que la fila de `content_assets` sigue siendo verdadera y se le
agrega `retired_from_subject_at` — el libro de procedencia sólo crece.

**Dos bugs de plata encontrados de paso**, ninguno pedido en el feedback:
`ContractForm` prellenaba con `Math.round(cents/100)`, así que un paquete de USD
150,50 generaba un contrato de **151**; y en el alta del check azul la moneda se
normalizaba a minúsculas contra una columna que exige ISO en mayúsculas — habría
violado el CHECK en **cada alta**, devuelto 500, y dejado gente cobrada sin
insignia mientras Stripe reintentaba 3 días.

**Estado del árbol:** typecheck limpio, lint sin errores, **3.735 tests en verde
(eran 3.468), cero regresiones**. Quedan 88 rojos en 8 archivos
(`consent`/`theme`/`legal`/`search-history`) que **ya fallaban antes de esta
sesión** — verificado en un worktree limpio sobre `HEAD`. La causa es **Node 26**,
que trae un `localStorage` global experimental e inerte que tapa al de jsdom:
`window.localStorage` queda `undefined` y los tests mueren en el `beforeEach`. No
se arregla con `environmentOptions.jsdom.url` ni cambiando el formato del pragma
(ambas probadas y revertidas). El repo no fija Node: no hay `.nvmrc` ni `engines`.
**La salida es Node 24 LTS**, que además es lo que corre Vercel.

**Pendiente de decisión de producto** (no técnico): si los eventos deben vencer
por fecha del evento y no a 30 días de publicados (hoy, un evento anunciado con
45 días de anticipación desaparece antes de ocurrir); si los productos de una
tienda paga se eximen del vencimiento; si hay tope de renovaciones; y el catálogo
de música, que **no se siembra con un script** — cada pista necesita archivo,
licencia verificada, URL de origen y texto de atribución.

**Pendiente en Stripe** (dashboard, sin código): sumar el evento `invoice.paid`
al webhook — sin él no llega ningún impulso de regalo, ni el primero; activar el
Billing Portal con cancelación, que la pantalla ya promete; y activar Connect e
Identity para negocios.

## La marca dejó de ser un tenant: cartel absurdo + feed vacío, resueltos (✅ 2026-08-13, madrugada)

Manuel abrió el preview y vio dos cosas a la vez: **«Estás mirando Comunidad
Latina, pero tu cuenta vive en Comunidad Latina»** y un **feed sin una sola
publicación**. Las dos venían del mismo malentendido, y las dos eran nuestras.

**El malentendido:** "Comunidad Latina" **no es una comunidad, es el programa**.
Las comunidades son las de adentro — "Dominicanos en USA", "Mexicanos en USA" —
cada una con su fila en `tenants` y, a futuro, su dominio propio. El modelo de
datos siempre lo supo; la interfaz no, porque el header pintaba `tenant.name`.

**Por qué el feed estaba vacío.** Se había seteado `DEFAULT_TENANT_SLUG=comunidadlatina`
en Vercel. Ese tenant es la **marca y el panel de admin**: 3 posts de prueba
("hola", "test 2"). Los **38 posts, 66 avisos y 15 perfiles** reales viven en
`dominicanos`. La app estaba sirviendo la comunidad equivocada, entera. La
variable se eliminó — el default del código ya era el correcto.

Es la continuación directa del arreglo de ayer (ver la entrada de abajo): esa
variable nació para que el preview dejara de decir "Dominicanos". Servía para
eso, pero se la usó apuntando a la marca, que es la respuesta equivocada a la
pregunta correcta.

**Por qué el cartel decía un absurdo.** Para que el header dijera "Comunidad
Latina", el commit `a560d53` **renombró el tenant `dominicanos` en la base**. Eso
dejó dos filas de `tenants` con el mismo `name`, y el aviso de divergencia quedó
comparando una cadena contra sí misma.

**El arreglo de fondo — `@/lib/brand`:** el nombre visible de la plataforma es una
**constante de marca**, no un dato del tenant. El header de la app, el de auth,
el de marketing y el footer dicen siempre "Comunidad Latina", sirva la comunidad
que sirva. Los textos que hablan de ESTA comunidad (normas, legales, SEO) siguen
usando `tenant.name`, que es lo correcto ahí. Renombrar tenants para arreglar lo
que dice el header era arreglar el espejo, no la cara.

**Se eliminó `<TenantMismatchBanner>` entero.** Las dos veces que apareció en
producción fue por un problema de configuración NUESTRO, y el texto le pedía al
usuario que lo resolviera él. `requireTenantMatch()` **sigue cerrando toda
escritura** ante divergencia — eso es la seguridad y no se tocó. Lo que se fue es
el cartel.

**Blindaje, porque el clamp no alcanzaba.** Un slug **reservado** de marca en
`DEFAULT_TENANT_SLUG` ahora degrada a la comunidad de siempre, y el corte va en el
arranque (`sanitizeSlugAtBoot`). El clamp de `resolveTenantSlug` no podía
atajarlo: su salida ante un slug reservado **es** `DEFAULT_TENANT_SLUG`, así que
con el reservado adentro de la constante devolvía justo lo que quería bloquear.
Test de regresión que cuenta el incidente incluido.

**Datos.** `manuelnavarro@insightsapps.tech` vivía en el tenant de marca (claim
del JWT + 4 filas de identidad); se movió a `dominicanos`. Una cuenta sin
`tenant_id` en el JWT (`ecuaface@gmail.com`, registro incompleto) también quedó
apuntada a `dominicanos` — sin el claim, toda escritura RLS rebota para siempre.
**Geovanny (`global_admin`) NO se tocó**: su casa en el tenant de marca es
intencional y ese tenant tiene **16 tablas con configuración propia** (precios,
roles, integridad); moverlo habría sido una migración de datos, no un fix.

⚠️ **Trampa de herramientas, para la próxima sesión:** el MCP
`supabase-comunidad-latina` **NO apunta a la base de este proyecto** — responde
sobre una base con el schema `public` vacío. La base real es
**`ktmbtpuhqqofdkisqseq`**, y se llega por el MCP `supabase-cuenta-dev` pasando
`project_id` explícito. Y `apps` aparte: `.env.local` puede estar desactualizado;
para saber a qué base apunta producción de verdad, el camino corto es bajar un
chunk del bundle desplegado y grepear `*.supabase.co`.

Verificado: typecheck limpio · 3.563 tests (201 archivos) · lint 0 errores · build
de producción · desplegado y comprobado en vivo (el header dice "Comunidad
Latina", no queda rastro del cartel, y `/propiedades` sirve contenido que solo
existe en `dominicanos`).

**Pendiente de Manuel:** cerrar sesión y volver a entrar. El `tenant_id` viaja en
el JWT y el token viejo sigue trayendo el tenant anterior hasta que se renueve.

---

## Auditoría del contrato completo + feedback en video y módulo Comunidad (✅ 2026-08-12, tarde)

Origen: el pliego de las 4 fases, un Loom de 4:40 de Nacho recorriendo la app, y
tres pedidos nuevos por WhatsApp. Todo auditado contra el código y desplegado.

**Estado del contrato:** auditado fase por fase en
[`ESTADO_CONTRATO_4_FASES.md`](ESTADO_CONTRATO_4_FASES.md), distinguiendo
implementado / parcial / no existe / no contemplado / bloqueado por plata.

**Seguridad — lo más grave, cerrado (0091):** la lectura cruzaba entre
comunidades. 14 policies de SELECT sin filtro de tenant dejaban que un miembro
de una comunidad leyera el padrón de la otra, con `role`, `account_status` y
`suspended_until` incluidos. Era el único hallazgo que hacía fallar a la vez el
veredicto de seguridad y el de aislamiento multidominio.
La trampa que había que desarmar primero: `resolve_tenant_domain()` era
SECURITY INVOKER y se apoyaba en que `tenant_domains` fuera legible por `anon`.
Cerrar la tabla sin convertir la función habría dejado al middleware sin
resolver el host en toda visita sin sesión — no se caía una pantalla, se caía la
plataforma. También se cerraron los 5 buckets de Storage, que no tenían ni
límite de tamaño ni filtro de tipo.

**Del video de Nacho:** buscador propio en Empleos (era el único módulo sin uno,
y la query siempre lo soportó: faltaba el campo) · los avisos recomendados
bajaron al sexto lugar del feed · los tabs de texto pasaron a íconos circulares
con nombre debajo · y la marca dejó de decir "Dominicanos" en el preview — la
causa no era branding sino ruteo: los hosts `*.vercel.app` se saltean la tabla
de dominios a propósito y caían en un tenant por defecto fijo en código, que
ahora se configura con `DEFAULT_TENANT_SLUG`.

**Del pliego:** boost con alcance local/nacional/global (antes sólo duración) ·
reseñas y horarios de negocios (ninguna tabla los guardaba) · tipo de propiedad
y operación · editar y eliminar publicaciones · y el rescate de las ~8.800
líneas de etiquetar personas, música y editor de fotos que llevaban semanas sin
mergear.

**Módulo Comunidad (0096), pedido nuevo:** perdido y encontrado por zona,
recursos de ayuda (clínicas sin seguro, bancos de comida, consulados) y las
guías reusadas tal cual. La regla que mandó sobre el modelo: la procedencia de
cada recurso es NOT NULL desde el insert y la nota de origen va arriba del
contenido, no al pie — la sección le da información sensible a gente vulnerable
y nunca puede parecer asesoramiento nuestro.

**Dos bugs que nadie buscaba:** las columnas del reparto 20/80 multiplicaban en
`integer` y desbordaban al volver la comisión configurable hasta 50 % · y borrar
una publicación con promoción paga destruía el registro del pago por cascada
(ahora se bloquea, y falla cerrado si la consulta no responde).

**Verificado:** 3569 tests · `tsc` limpio · build de producción · gate de RLS
verde con 91 superficies · migraciones 0089–0096 aplicadas y probadas antes con
`ROLLBACK` contra la base real · deploy `success` · **ninguna rama colgando**
(sólo `main`, local y remoto).

## Content Integrity fase 2 + desbloqueo del Creator Marketplace (✅ 2026-08-12)

Origen: pliego de Nacho del 11/8 (texto de WhatsApp) + nota de voz de 4:13 con
los requisitos del Creator Marketplace. Ambos analizados contra el código, punto
por punto, en [`docs/CONTENT_INTEGRITY.md`](CONTENT_INTEGRITY.md) y
[`docs/CREATOR_MARKETPLACE_ESTADO.md`](CREATOR_MARKETPLACE_ESTADO.md) — los dos
distinguen implementado / parcial / no existe / no contemplado a propósito, sin
colapsar los estados.

**Migraciones 0086–0088** (aplicadas a producción el 12/8):
- `0086` umbrales de integridad por comunidad · disputas de contenido · estado
  `apto_comercial` con revisor humano obligatorio por CHECK · puente
  reportes↔integridad · penalización de integridad para el Trust Score
  (calculada, **sin enganchar** al motor: eso va en su propia migración para no
  mover scores vigentes).
- `0087` `listings.work_mode` (remoto/presencial/mixto) · `creator_commission_config`
  por comunidad · trigger que **congela** `fee_pct` de un contrato ya creado.
- `0088` umbral **por algoritmo**: antes un solo número servía para huellas de 64
  bits (imagen) y de 256 (video/audio), lo que apagaba el detector de audio en
  silencio.

**App:**
- Huella perceptual de **audio** de 256 bits (Haitsma-Kalker), sin dependencias.
  Calibrada midiendo: mismo audio con otro volumen/formato/ruido leve ≤23 bits;
  audios distintos ≥117. Corte en 32. Extracción client-side con Web Audio,
  con la misma advertencia honesta que ya tiene el video.
- **Detector de procedencia** por metadatos del contenedor (TikTok, CapCut,
  Instagram, Meta y 8 más). Dice de dónde salió el ARCHIVO; nunca afirma nada
  sobre derechos, y levanta revisión humana, jamás bloqueo automático.
- Flujo de **reclamo de copyright** + panel de disputas. Abrir una disputa
  **congela**, no elimina: si fuera punitivo, tres reclamos falsos borrarían a un
  competidor. Cuota diaria en la BASE, porque el rate-limit de la app no cubre el
  INSERT directo de PostgREST.
- **Cola de aprobación de creadores**: la RPC existía desde la 0032 y ninguna
  pantalla la llamaba — las solicitudes quedaban trabadas para siempre.
- `profiles.email_verified` **nunca se escribía** y el gate de creador lo exige:
  el requisito era imposible de cumplir. Ahora se sincroniza al confirmar.

**Bug de producción encontrado en el camino:** las columnas generadas del reparto
20/80 (`0024`) multiplicaban en `integer`. Con la comisión fija en 20 % no se
notaba; al volverla configurable hasta 50 %, un contrato del monto máximo
desbordaba `int4` y el alta habría fallado con *integer out of range*. La `0087`
las recrea en `bigint` sin cambiar la semántica de redondeo.

**Verificación:** 3065 tests · `tsc --noEmit` limpio · build de producción OK ·
las tres migraciones probadas contra la base real dentro de una transacción con
`ROLLBACK` antes de aplicarlas de verdad · auditoría de seguridad sin hallazgos
bloqueantes (los tres no bloqueantes quedaron cerrados: los umbrales pasan a ser
sólo de `domain_admin`/`global_admin`, se agregó cuota diaria de reclamos y se
cerró un oráculo de existencia cross-tenant en el trigger de disputas).

**Queda pendiente y es de producto, no de código:**
1. El botón "reclamar este contenido" en el feed. El flujo funciona pero se entra
   por URL directa: la pantalla necesita el id interno del archivo y ese dato no
   se expone en las tarjetas a propósito. Conectarlo pide una consulta acotada
   nueva (sólo tipo de archivo y fecha), no abrir el id.
2. Pantalla de admin para editar la comisión (hoy se cambia por SQL).
3. Enganchar `integrity_penalty_for_user` al motor de Trust Score.
4. Regenerar `database.types.ts` (varias columnas nuevas entran por cast).

## Cierre del pliego contractual: white label, Content Integrity y pagos (✅ 2026-08-09)

Quince frentes en paralelo con fronteras de archivo duras, sobre el pliego de las
cuatro fases. **25 migraciones (`0060`–`0084`)**, 2249 → **2911 tests**, los cuatro
gates verdes y `check:rls` en 79 superficies.

**El alta de un dominio ya no pide un commit.** `DOMAIN_TENANTS` era un mapa
hardcodeado en `resolve.ts`: sumar un dominio exigía commit + deploy, lo que
incumplía de frente la cláusula "agregar otro dominio sin reconstruir el código".
Ahora el middleware resuelve contra `resolve_tenant_domain` (0060) con caché en
memoria — 300 s positiva, **60 s negativa** (el caso que importa es "acabo de dar
de alta el dominio, ¿ya anda?"), y *stale-on-error* de 24 h que es mejor respaldo
que el mapa viejo porque cubre dominios creados después del último deploy. El
mapa sobrevive **sólo** para cuando la base no responde: si se consultara también
con la base viva, suspender un dominio desde el panel no apagaría nada. Un alias
redirige 308 al canónico; desconocido, `suspended` y `archived` dan el mismo 404
porque el RPC los devuelve indistinguibles a propósito y el copy no puede filtrar
lo que el RPC se cuida de no contar.

**La red de contención que casi no está.** `isPlatformHost()` reconoce loopback,
`*.localhost`, `*.vercel.app` y `*.vercel.sh`. Producción vive hoy en
`comunidad-latina-sigma.vercel.app`, que no está ni tiene por qué estar en
`tenant_domains`: sin esa lista, el cambio bajaba el sitio entero.

**Content Integrity, módulo nuevo completo** (0061). SHA-256 sobre los bytes
reales del servidor, huella perceptual con DCT/pHash escrito a mano, y para video
cuatro fotogramas muestreados en el navegador (el video nunca pasa por el
servidor). Búsqueda de similares con tipo `bit(N)` + índice HNSW `bit_hamming_ops`
de pgvector, que ya estaba instalado. El módulo está partido a propósito:
**duplicado exacto por sha256** (btree, determinístico, el que importa
legalmente) y **similar por huella** (HNSW, aproximado) — un miss de HNSW es "una
alerta que no se levantó", nunca una acusación falsa. El matching **no cruza
comunidades**: mostrarle a un moderador de un dominio contenido de otro es una
fuga, por útil que suene. Audio no se implementó: pide Chromaprint o ffmpeg, 70+
MB de binario nativo en una función serverless, y hoy no hay medio con audio
propio contra el cual comparar. La columna y la rama del RPC ya existen.

**Lo que se pagó dos veces y hay que recordar: una función en el schema `app` no
es llamable desde la app.** PostgREST sólo expone `public` y `graphql_public`.
0061 y 0068 pusieron ahí `scan_content_asset` y `emit_social_notification` como
virtud (no generan advisory de definer alcanzable), y la capa de aplicación
terminó manteniendo un **espejo en TypeScript** de la regla de "qué es un
duplicado". 0066 repitió el patrón con las funciones de SMS, y ahí el espejo no
podía expresar `attempts = attempts + 1` en una sentencia: el contador de
intentos tenía una ventana de carrera. Las migraciones 0070 y 0071 existen sólo
para arreglar eso con envoltorios en `public`, `SECURITY INVOKER` y `EXECUTE`
sólo para `service_role`. Los dos espejos se borraron.

**Precios por comunidad, con el Checkout cableado de verdad** (0072–0074, 0078).
14 casillas por tenant, centavos enteros, moneda explícita, historial append-only
escrito por trigger — no por la aplicación, porque un historial que depende de
que alguien se acuerde de anotarlo deja de serlo. Dos tablas y no una con
`valid_from`/`valid_to`: `unique (tenant_id, product, variant, billing_interval)`
hace que dos precios vigentes del mismo producto sean **imposibles por esquema**,
no improbables por query. Ausencia de fila = constante del código, así que
aplicar el cambio no movió un centavo hasta que alguien edite un precio.

**El bloqueante de plata que encontró el cableado.** El webhook del Aviso Premium
comparaba el monto cobrado contra la constante del código. En el alta la fila de
`listing_premiums` todavía no existe (la crea el propio webhook), así que una
comunidad con el premium a USD 15 hacía: Stripe cobra 1500, el webhook ve
`1500 ≠ 900` y **no concede** — plata cobrada, aviso sin premium. Se arregló
comparando contra `metadata.price_cents` de la Session, que es lo pactado y es
inmune a que alguien edite el precio entre el checkout y el evento. De ahí salió
`lib/monetization/pactado.ts`, compartido, porque la tercera copia de una regla
es la que nadie se acuerda de arreglar.

**Y el que era peor: `presencia` no verificaba nada.** Ni monto, ni moneda, ni
`payment_status`. Un `checkout.session.completed` con `payment_status: "unpaid"`
—lo que pasa con métodos asíncronos— activaba la presencia igual: **entregar sin
cobrar**. Exigirle `paid` obligó a atender también
`checkout.session.async_payment_succeeded`, porque si no el arreglo cambiaba un
agujero por otro: toda transferencia real habría dejado la presencia apagada para
siempre. Hoy los cinco productos exigen pago confirmado y comparan monto **y**
moneda: 1500 ARS y 1500 USD dan el mismo entero y no son el mismo cobro.

**Reembolsos y disputas** (`lib/monetization/reembolso.ts`). Sólo el reembolso
**total de un pago único** revoca (boost y campaña): es el único caso inequívoco.
El parcial no revoca porque no existe umbral que no sea política de negocio
disfrazada de código. Las suscripciones nunca revocan acá — un reembolso no es
una baja, el evento no dice qué ciclo se devolvió, y quien apaga es
`subscription.deleted`, que es donde Stripe pone la decisión después de
reintentar. Y **una disputa alerta pero no apaga**, por una razón concreta: no
atendemos `dispute.closed`, así que revocar en `created` sería una puerta de una
sola dirección — si el comercio gana, nada volvería a encender lo apagado.

**La auditoría de seguridad encontró un bloqueante real y se arregló.**
`profile_card` (0063) es `SECURITY DEFINER` con EXECUTE para `anon` y su select
era `where p.id = p_profile_id`, **sin condición de tenant** — y al ser definer,
el join a `profiles_private` ignoraba su propia política solo-dueño. Reproducido:
un miembro de `dominicanos` leyó apellido, ciudad, país de residencia y edad de
un perfil de `comunidadlatina`. No filtraba nada todavía porque los defaults son
`privado`/`seguidores` y no hay ninguna fila en `profile_privacy` — se activaba
el día que alguien eligiera "público", cuya expectativa razonable es publicarse
en *su* comunidad, no en todos los dominios white-label. 0079 exige mismo-tenant
para los cinco campos de `profiles_private`, con control positivo verificado.

**Efecto secundario que conviene que alguien confirme:** `anon` no tiene tenant,
así que para un visitante sin sesión el nivel `publico` de esos cinco campos pasa
a comportarse como "sólo mi comunidad". Es criterio de producto, no de seguridad.

**El schema `app` estaba abierto a `anon`**: 72 funciones ejecutables, incluida
`creator_activation_eligible` —un oráculo que delata `phone_verified`, umbral de
trust, edad derivada de `birthdate` y restricciones activas de cualquier perfil,
cross-tenant— y `next_gig_code()`, que **muta estado** sin autenticación. No era
explotable (PostgREST no expone el schema, `PGRST106`), pero quedaba a un
envoltorio de volverse real. Bajó a 8 funciones (0081/0083). Dos cosas que
salieron de ahí y valen como aprendizaje: **revocar `usage` sobre el schema
habría roto el sitio público**, porque 9 policies de RLS que aplican a `anon`
llaman a `app.*` y las expresiones de una policy corren con los privilegios de
quien consulta; y `alter default privileges` **no puede** hacer que una función
nazca cerrada, porque `pg_default_acl` es aditivo sobre `acldefault()`. La regla
quedó escrita: toda migración que agregue una función en `app` termina con
`revoke execute … from public, anon`.

**Prueba técnica multidominio ejecutada** (`docs/entrega/prueba-multidominio.md`),
criterio de aprobación de Fase 1 §2 y Fase 4 §8: **15 de 17 puntos PASAN**, con
comando y resultado literal por cada uno. Los 2 que no tienen una sola causa —13
tablas se leen entre comunidades: contenido `published` y fichas públicas con
`using(true)`— que está documentada y justificada por SEO desde `0004`, `0003` y
`0056`, y **no se amplió** con esta entrega. Es decisión del cliente: cerrarlo
empujando el tenant a la sesión de Postgres, o aceptarlo por escrito.

**Entrega documental** en `docs/entrega/`: manual del Super Admin, manual del
admin local, diagrama de arquitectura, APIs, alta de un dominio nuevo, servicios
y costos, y el documento de **dónde se enchufan** las monetizaciones futuras
(lives, regalos, monedas, wallet, PPV) que la Fase 3 §9 exige como prueba de que
la arquitectura quedó preparada.

### Lo que queda abierto, sin maquillar

- **Un upgrade de plan de presencia deja la suscripción vieja viva** y cobrando
  (`negocios/presencia/actions.ts:143`). Doble cobro silencioso. Es preexistente y
  hoy no puede morder porque no hay clave de Stripe — pero es el pendiente más
  caro y va antes de apuntar a claves live.
- `charge.dispute.closed` no se atiende: si la disputa se pierde, el beneficio
  sigue encendido. Es la contracara de haber decidido no revocar en `created`.
- No hay dónde marcar "en disputa": la única marca es el log y `payment_events`.
- Nada de pagos se probó contra Stripe real. Las claves siguen vacías; todo está
  verificado con fixtures firmados. Sigue vigente la firma humana senior.
- Rate limiting sigue in-memory por instancia. Sentry, Vision y SMTP siguen
  bloqueados por credencial. El teléfono está construido y **apagado por gate
  legal** (`user_phones` es un mapa teléfono↔identidad, subpoenable).

## Refuerzo de seguridad de datos y cumplimiento (✅ 2026-08-02)

Seis frentes en paralelo con fronteras de archivo duras + dos rondas de review
adversarial. 112 archivos, +5743/−427. Commit `4115e07`.

**La fuga que nadie había visto.** El asistente con IA atiende visitantes
anónimos y consulta `rag_chunks` con `service_role` — sin RLS abajo. El único
aislamiento era el `p_tenant_id`, que salía de `getTenant()` → Host **o `?t=` o
cookie `cl-tenant`**. El docstring decía "en producción manda el dominio", y era
falso: el host real (`comunidad-latina-sigma.vercel.app`) **no está en
`DOMAIN_TENANTS`**, así que producción caía al parámetro del cliente. Reproducido
contra la base con un tenant víctima efímero: antes devolvía su contenido
privado, después 0 filas. El corte quedó en `resolveTenantSlug` — el origen, no
el asistente — porque `?t=` alimenta el tenant de toda la app. **Los previews de
Vercel también quedan bloqueados a propósito**: corren con `NODE_ENV=production`
contra la MISMA base, o sea que ahí `?t=` sería el mismo agujero con otra puerta.

**El open redirect necesitó dos intentos, y eso es lo que hay que recordar.** La
primera pasada reemplazó el filtro por string (`/<TAB>/evil.com` lo atravesaba)
por `safeInternalPath`, que resuelve contra un origen centinela. La ronda de
review encontró que **tampoco alcanzaba**: el parser colapsa los dot-segments
*después* de fijar el origen, así que `/..//evil.com` pasaba el chequeo y salía
con el pathname en `//evil.com` — protocol-relative para el siguiente parser, que
es el que arma el `Location:`. Ahora valida en dos pasadas. Los dos revisores lo
encontraron por separado, con reproducción. Los 2141 tests de entonces pasaban.

**Base de datos — migraciones 0056–0059, aplicadas.** `verification_checks.evidence`
era legible por `anon` con nombre real y número de matrícula adentro. Los 4
buckets públicos se podían listar enteros (29 objetos, incluidas fotos de avisos
en borrador). Y el `REVOKE` por columna sobre `profiles`: **sin cuenta se podía
sacar la lista de quiénes son los admins de cada comunidad**. Todo eso sólo para
`anon`; `authenticated` quedó intacto porque `(app)/layout.tsx` lee
`account_status`/`suspended_until` — es la puerta que aplica los baneos, y
revocarla la desarmaba. Verificado con SQL, no razonado. Advisors: security
32 → 24, performance 91 → 84.

Aislamiento cross-tenant probado tabla por tabla con `set local role authenticated`
+ claims del tenant B: `messages`, `conversations`, `job_applications`,
`user_phones`, `profiles_private`, `payment_events`, `rag_chunks`, `scam_reports`
y `audit_log` dan **0 filas**. Lo que sí cruza es contenido `published` y perfiles
públicos, que es una decisión de SEO ya fechada en `0004_listings.sql:70`.

**Cookies: la decisión fue no poner banner, y está justificada.** El inventario se
midió en el navegador (`document.cookie`, `localStorage`, red), no se supuso:
**cero trazadores de analítica o publicidad**, ninguna petición a un tercero en la
carga. Un banner con cuatro categorías vacías pediría permiso para algo que no
ocurre y entrena a aceptar sin leer. Lo que sí quedó es la infraestructura
(`src/lib/consent/`): el banner se dispara solo de `categoriesNeedingConsent()` y
**aparece el día que alguien sume un trazador** — hay un test que simula esa fila.
Rechazar y aceptar son hermanos en un `grid-cols-2`, estructural, no se puede
desbalancear; `Escape` equivale a rechazar. Sentry queda como "necesaria": no
escribe nada en el dispositivo, así que no activa el art. 5.3 de ePrivacy.

Nueva `/legal/cookies` con el inventario completo en criollo, `/ajustes/privacidad`
con **exportación de datos real** (derecho de acceso y portabilidad), enlace CPRA
"Do Not Sell or Share", los 7 terceros nombrados con su transferencia a EE.UU.,
base legal declarada, y la selfie biométrica de Stripe Identity y el uso de IA
(Anthropic, OpenAI, Google Vision) declarados.

**Defectos que iban a producción.** Con teclado **no se podía elegir zona**: el
`onBlur` cerraba la lista a los 120 ms y el foco caía al `<body>` — bloqueaba el
onboarding entero, y el mouse lo tapaba. `formatDate` sin `timeZone`: Vercel en
UTC y el navegador en Nueva York mostraban **días distintos** para el mismo
instante; el arreglo obvio además rompía las guías, que guardan `2026-07-06` sin
hora y quedaban un día antes al pie de trámites oficiales. El sitemap aplicaba el
filtro por tenant **sólo si** el lookup traía fila, así que ante una falla le
entregaba a Google todas las comunidades mezcladas. `/semana` y `/día`
desaparecían de la vista previa al publicar: $200 por semana se leía como el
total. El enlace de confirmación **con el token** se imprimía en los logs cuando
faltaba `RESEND_API_KEY` — condición alcanzable, prod ya tuvo 7 de 20 variables.

**"Destacado" nombraba dos cosas opuestas**: el nivel máximo del Trust Score
(mérito ganado) y la etiqueta del aviso pago. En la misma pantalla el copy promete
*"Impulsar no cambia tu Trust Score"*, con un comentario de FTC §255 al lado. Lo
pago pasa a **"Patrocinado"** en las cinco superficies; el nivel se queda como
está. Ningún valor persistido tocado — los tests del webhook de Stripe son la red
que lo prueba.

**La regresión que introdujimos nosotros, y por qué el smoke test no la vio.** La
0059 rompió el `select("*")` sobre `trust_scores` para `anon`: con un permiso de
columna faltante Postgres tira 42501 sobre la tabla entera, el error no se
chequeaba, y **todo perfil público mostraba Trust Score 0 a quien no tenía
sesión** — un valor falso, no un badge ausente, en un producto anti-estafa. La
ruta devolvía 200, así que "rutas públicas 200" pasaba en verde. Lo encontró el
review leyendo la costura entre el frente de app y el de base. Verificado en vivo
después del arreglo: muestra el 35 real.

Gates: typecheck limpio · lint 0 errores (48 warnings preexistentes) · **2147
tests** · build verde · secretos ausentes del bundle sobre el build final (sólo
las dos `NEXT_PUBLIC_*`, por diseño) · headers verificados con `curl` contra el
build de producción, no leyendo el config · 375/768/1280 sin scroll horizontal ·
consola sin errores.

**Pendiente de Manuel (no sale del código):**
- `LEGAL_CONTACT_EMAIL` y `LEGAL_GOVERNING_STATE` en `src/components/legal/legal-prose.tsx`.
  **Sin correo de contacto el derecho de acceso no se puede ejercer** — es lo único
  que hoy deja el cumplimiento a medias.
- Confirmar la zona horaria **`America/New_York`**: el público está en NY, NJ,
  Miami, Houston, Chicago y Los Ángeles, o sea varias zonas. Alguien en Los Ángeles
  publicando 22:00 ve su publicación fechada al día siguiente. La salida, si molesta,
  es guardar la zona en el perfil (`options.timeZone` ya está soportado).
- *Leaked password protection* está **desactivada** en el dashboard de Supabase Auth.
  Es un toggle, no código.
- Sigue pendiente el **SMTP propio** en Supabase (recuperación de contraseña).

**Deuda anotada, no cerrada:** el rate limiting es in-memory por instancia (techo
real = `max × instancias`, se resetea en cold start) — sirve para acotar gasto de
IA, no como control anti-abuso distribuido; la migración a Upstash está
documentada. `trust_scores.signals` sigue legible por `anon` porque 23 páginas
públicas lo piden: se cierra cuando dejen de pedirlo donde sólo pintan `score` y
`level`. `record_cta_click` y `record_listing_share` son ejecutables por anónimos
(integridad de métricas, no fuga) — revocarlos rompería la telemetría de avisos
públicos, el arreglo real es deduplicación.

## Confirmación de cuenta (✅ 2026-08-01)

Se cierra el hueco que dejó la semana 4: **el registro ya no auto-confirma**.
`createUser` pasa a `email_confirm: false`, el correo lo manda **Resend** (no el
mailer compartido de Supabase, que sólo entrega a miembros del team) y la
sesión la crea la ruta nueva **`/confirmar`** al canjear el token.

**Lo que se probó contra el proyecto real antes de escribir una línea** (tres
spikes, usuarios de prueba creados y borrados):

- El proyecto **exige** confirmación: `signInWithPassword` sobre un usuario sin
  confirmar devuelve `400 email_not_confirmed`. O sea, dejar de auto-confirmar
  implica que el registro **no puede iniciar sesión** — no es una convención
  nuestra, es la regla del backend.
- `generateLink({ type: "signup" })` sobre un usuario **ya creado** devuelve 200
  y **conserva su `app_metadata`** (tenant_id, role). Por eso el usuario se crea
  con `createUser` y el link se mintea después, en dos pasos: `generateLink` no
  acepta `app_metadata`, y sin tenant_id en el JWT el usuario no ve nada.
- `verifyOtp({ type: "signup", token_hash })` confirma el email **y devuelve
  sesión** — se entra directo desde el correo, sin reescribir la contraseña. El
  token es de un solo uso (segundo intento: 403).
- El `action_link` de Supabase **no sirve**: redirige al `Site URL` del proyecto,
  hoy `localhost:3000`, porque los dominios de producción no están en la
  allow-list del dashboard. Usamos el `hashed_token` contra ruta propia, así que
  **esto no depende de tocar el dashboard** y siempre vuelve al host donde la
  persona se registró.

**El onboarding se reordenó: necesidades → zona → cuenta.** Antes la zona se
preguntaba *después* del registro, aprovechando que había sesión. Sin sesión esa
pregunta quedaría colgada esperando un clic en un mail, así que ahora el wizard
pregunta todo antes y `registerAction` guarda perfil + necesidades + zona de una
sola vez con el admin client. Nada queda a medias. Con sesión ya abierta el
wizard corta en la zona y guarda por el camino normal, con RLS.

**Reenvío sin endpoint nuevo de spam:** quien intenta entrar con una cuenta sin
confirmar recibe el enlace de nuevo automáticamente. La action **exige la
contraseña correcta** — verifica contra Supabase con un cliente anónimo efímero
y sólo manda el correo cuando la respuesta es exactamente `email_not_confirmed`.
Con contraseña incorrecta o cuenta ya confirmada no manda nada (verificado en
vivo: el log no mintea ningún token). Sin esa puerta sería una forma de mandarle
correos a direcciones ajenas escribiéndolas en un formulario.

Decisiones que importan:

- **El correo caído no invalida el alta.** `registerAction` devuelve `ok` aunque
  el envío falle: la cuenta ya existe, y un error mandaría a la persona a
  registrarse de nuevo contra un "ese email ya está en uso". La salida es
  /entrar, que reenvía.
- **La bienvenida se manda al confirmar, no al registrarse** — quien nunca
  confirma no recibe un "bienvenido" a una cuenta que no puede usar.
- **En dev sin Resend el enlace se loguea en la consola del server**; si no, una
  cuenta recién creada sería inaccesible en local.

Verificado end-to-end en el navegador con Resend apagado (cero correos reales):
wizard completo → "Revisá tu correo" → enlace del log → sesión y aterrizaje en
`/propiedades?zona=Bronx`; en la base, `email_confirmed_at` sellado recién al
confirmar, `area_label`, `country_origin` heredado y `needs`. Enlace ya usado →
`/entrar?error=confirmacion`. Los dos usuarios de prueba quedaron borrados.

Gates: typecheck 0 · lint 0 errores · **2000 tests** (20 nuevos) · build verde.

**Sigue pendiente y es de Manuel:** el **SMTP propio en el dashboard de
Supabase**. La recuperación de contraseña y el ingreso sin contraseña siguen
saliendo por el mailer compartido de Supabase, que sólo entrega a miembros del
team. Eso no se arregla desde el código.

## Plan de 12 semanas: semanas 3, 4, 6, 7 y 11 (✅ 2026-08-01)

Fuente: el plan publicado en `https://planes-insights.vercel.app/comunidad-latina`
(tabla `published_plans` del proyecto Supabase `yzmtzyuncekspgtsetwk`, slug
`comunidad-latina`). Cinco frentes en paralelo con fronteras de archivo duras +
ronda de integración.

**El plan tenía tres tareas mal clasificadas.** Se descubrió llamando a cada API,
no leyendo el `.env.local` — que usa **comentarios en línea**, así que una
variable vacía parece llena si se mide por longitud:

- **Resend estaba marcada bloqueada y NO lo estaba.** La clave responde 200,
  `assistify.lat` está verified y `EMAIL_FROM` usa ese dominio. Semana 4
  desbloqueada.
- **Sentry figuraba "en curso" y está bloqueada por credencial**: DSN, org y
  project vacíos. Producción hoy **falla en silencio**.
- Stripe y Google Vision sí estaban bloqueadas: 401 y `API_KEY_INVALID`.

**Deploy — se cierra el pendiente nº 0**, que sólo vivía en memoria de sesión:
team **`insights3`**, proyecto **`comunidad-latina`**, dominio
`comunidad-latina-sigma.vercel.app`. **El auto-deploy funciona**: el sha `7967583`
estaba a la vez en el HEAD local, en `developers-insights/main` y en el deploy
READY. La trampa eran los dos remotes — `origin` (`INSIGHTSAPPS`) es **legacy**,
pide contraseña interactiva y hace parecer roto lo que anda. Nombrar siempre
`developers-insights`.

**Producción tenía 7 de 20 variables de entorno.** Nuevo
[`scripts/vercel-env-sync.mjs`](../scripts/vercel-env-sync.mjs): audita
`.env.local` contra Vercel sin imprimir un solo valor, clasifica cada variable
(prod / build / local / sin uso) y sube con `--push` explícito. Detectó de paso
que `SUPABASE_DB_PASSWORD` está en producción sin motivo — el runtime nunca abre
conexión directa a Postgres.

**Semana 3 — reglas claras y datos protegidos.** Las páginas legales existían;
lo que faltaba era que dijeran la verdad. **7 divergencias** entre texto y código,
corregidas: TTLs incompletos, Stripe Identity y el asistente con IA (que manda la
pregunta a Anthropic) sin declarar, y sobre todo el borrado de cuenta, que
prometía "se borra todo" cuando `0015` deja posts y comentarios **anonimizados**
(SET NULL), no borrados. Dos defectos reales encontrados probando:
`business_accounts.owner_id` era RESTRICT y hacía **fallar el borrado con un error
opaco** que reintentar nunca arreglaba; y **el cascade de Postgres no toca
Storage**, así que avatar, fotos y CVs quedaban huérfanos para siempre — una fuga
que sobrevivía a la cuenta. Verificado en vivo: cuenta creada por UI, post con
foto real, borrada, y conteos antes/después contra la base.

**Semana 4 — correos.** Bienvenida y avisos ya existían y estaban cableados. Se
arregló que los links apuntaran a `localhost` (ahora la URL base sale de las
variables de sistema de Vercel, así que se autocorrige por entorno) y que las
fallas de envío fueran **invisibles**: `sendEmail` atrapa todo a propósito para no
romper el flujo, y sin `captureException` explícito eso no llegaba a Sentry ni con
DSN puesto. **Correo real enviado y verificado** (ID de Resend
`cd039a0a-20c6-4e13-8212-5685331ae7ad`), repetible con `scripts/probe-email.mjs`.
**Hueco que queda** (→ **cerrado el 2026-08-01**, ver la sección de arriba): la
confirmación de cuenta **no existe** — `createUser` usa `email_confirm: true` y
auto-confirma. Y ojo con esto: **recuperación de
contraseña e ingreso sin contraseña dependen del mailer compartido de Supabase**,
que sólo entrega a miembros del team; el plan da esa tarea por terminada y en
producción podría no estar llegando a nadie.

**Semana 6 — autoservicio a premium.** Era el hueco declarado: el tier se concedía
con `service_role` a mano. Ahora hay flujo completo free→premium iniciado por el
dueño del aviso (migración `0054` + `listing_premiums`). Decisiones que importan:
el downgrade **guarda los 7 botones antes de borrarlos** y los restaura al
reactivar (la baja pasa de pérdida a pausa); el guard de doble cobro corre antes
de tocar Stripe; y `current_period_end` se lee de `SubscriptionItem`, con un test
que falla a propósito si alguien lo "arregla" leyéndolo de la raíz. Ciclo completo
verificado contra la base real: alta → baja → reactivación → `past_due` → cron que
vence. Contra Stripe real: **nada**, no hay clave.

**Semana 7 — nacer una comunidad sin reprogramar.** El hueco era caro:
`ACTIVE_COMMUNITY_SLUGS` era una **lista blanca de un solo slug**, así que una
comunidad nueva nacía en la base y era **inalcanzable** hasta un commit +
redeploy. Ahora es lista negra de marca (`comunidadlatina` sigue reservada a
propósito: es la marca, decisión fechada del PLAN_MAESTRO §11.1). Nuevos
`scripts/new-tenant.mjs` (alta end-to-end idempotente + `--delete` con doble
confirmación) y [`docs/PLAYBOOK-TENANT.md`](PLAYBOOK-TENANT.md). Verificado
creando `pruebatenant`, comprobando color y **aislamiento real** contra
`dominicanos`, y borrándolo. **Sigue pidiendo código** una sola cosa: el dominio
propio, porque `DOMAIN_TENANTS` es un mapa fijo (`middleware.ts` llama a
`resolveTenantSlug` sin `await`).

**Semana 11 — tablero de métricas.** `/admin/metricas`, gateado por el mismo
`admin/guard.ts`, con RPC `security definer` que valida el rol **adentro**:
`domain_admin` queda clavado a su comunidad y pedir otra **lanza 403**, no
devuelve vacío (un cero se confunde con "sin actividad"). Las tres métricas del
plan con su **definición visible en la pantalla**, no en un comentario. Honestidad
que vale: **"cuánta gente entra" no es medible hoy** — no hay registro de sesiones
y agregarlo choca con §5.4, así que se mide por actividad y **la limitación está
escrita en la tarjeta**. Números cruzados contra recuento independiente en la
misma transacción; prueba negativa con tokens reales (member 403, anónimo 401,
otra comunidad 403).

**Integración:** dos `<Link>` a premium que ningún frente podía poner (y uno que
existía apuntando a Impulsar, otro producto, bajo un botón que decía "Ver qué
incluye premium"); el copy de Ajustes que repetía la promesa falsa del borrado; y
`listing_premiums` + `admin_metrics_overview` agregados a `database.types.ts`
siguiendo la convención de excepciones del archivo.

Gates: `typecheck` 0 · `lint` 0 errores (48 warnings preexistentes) · **1980 tests
en 109 archivos** · `build` verde · **`check:rls` VERDE, 70 superficies**.
`/admin/metricas` responde 200 en ~860 ms con sesión admin real y sus filtros
también; **no hay captura de pantalla** — el navegador embebido bloquea `eval()`,
que React necesita en dev, así que no hidrata. Se verificó por DOM y por medición
de layout, no con los ojos.


## Feedback consolidado del 30/7 — 7 specs escritas + call de 85 min (✅ 2026-07-31)

Fuente y criterio: **`docs/feedback/2026-07-30-feedback-consolidado.md`**. Ahí
están los **3 conflictos entre las dos fuentes** ya resueltos con su
fundamento, y todo lo que quedó afuera **con su razón**. Leer eso antes de
tocar nada de este bloque.

Ejecutado por 9 agentes en tres olas con fronteras de archivo estrictas, más
una ronda de integración (las costuras entre frentes no las hace ningún
frente). Commits `e8412a8` y `ce614ed`.

**Esquema — migraciones 0044–0052, aplicadas y verificadas contra la base:**
- **0044** búsqueda global por RPC `security invoker` (RLS decide qué se ve, y
  así ninguna superficie tiene que acordarse de filtrar), con el `href` saliendo
  de la RPC para que nadie re-invente el ruteo.
- **0045** notificaciones con categoría (13), prioridad, agrupación por
  `group_key` y preferencias por canal. Seguridad, pagos y cuenta **no se
  pueden silenciar** — lo impone un CHECK, no la UI.
- **0046** `short_video` vs `advertising_video`. La regla cuelga de
  `eligible_for_short_feed` y **no** del tipo: si colgara del tipo, bastaba
  dejarlo en NULL para meter 10 minutos en el reel.
- **0047** reclutamiento: embudo monótono por trigger, CV en bucket privado con
  la ruta atada por CHECK, y la nota del empleador en **tabla aparte** porque
  candidato y empleador llegan los dos como `authenticated` y RLS filtra filas,
  no columnas.
- **0048** tier `free`/`premium`, CTAs como columnas con un CHECK atómico,
  campañas y membresías de tienda.
- **0049** arregla un CHECK de 0046 que quedaba **dormido** por su fecha de
  corte. Lo destapó la prueba negativa, no la revisión.
- **0050** vistas y compartidos de aviso (las métricas que el panel declaraba
  como hueco en vez de mostrar un cero que parece dato).
- **0051** cierra la deuda que la propia 0044 se había anotado:
  `video_post_href` mandaba **todo** video al reel, publicitarios incluidos.
- **0052** búsqueda insensible a tildes (ver abajo).

**App:**
- **Búsqueda global** mientras se escribe, agrupada por tipo, con historial y
  sugerencias de datos reales; más buscador propio en Eventos, Negocios y
  Colaboraciones, que no tenían.
- **Notificaciones** con pestañas, contadores, agrupación por tiempo, acciones
  por fila y pantalla de preferencias.
- **Videos Cortos**: tope de 90 s validado en el navegador **y** en el
  servidor, menú de categorías al entrar, y los cuatro topes de duración
  (90/59/300/600) en un solo módulo con tests, para que no se separen.
- **Empleos** end-to-end: aplicar con CV y portafolio, "Mis aplicaciones", y
  panel de candidatos del **dueño del aviso** — que no es lo mismo que la vista
  de staff de `/admin/empleos`, que tiene su propia barrera auditada y no se
  tocó.
- **Monetización**: gratis vs premium en un solo módulo, botones por módulo,
  "Impulsar"/"Crear campaña" al publicar, estadísticas en dos niveles.
- **Tiendas** de USD 10/mes con apagado automático al vencer, y **política de
  productos prohibidos** como página legal propia.
- **Colaboraciones** (era "Contratos"), con 308 desde la ruta vieja.
- **Lienzo crema con la tarjeta blanca** — el pedido era *"blanco con blanco no
  notamos nada"*. La escala está anclada por **luminancia**, así que ningún par
  de contraste bajó: el peor del tema claro mejoró de 4.51:1 a 4.55:1.

**Defectos encontrados probando, no leyendo (los que valen):**
- **`current_period_end` ya no existe en la raíz de `Subscription`** en
  stripe-node 22 — se movió a `SubscriptionItem`. Leerlo como enseñan los
  ejemplos viejos dejaba la fecha en NULL, el cron nunca vencía la fila y **la
  tienda quedaba prendida para siempre**.
- **"Ver perfil" estaba construido y llegaba a 0 de sus 9 puntos de montaje.**
  Un frente construyó el componente, otro tenía las páginas: nadie lo cableó.
  Es el modo de falla típico de trabajar en paralelo y por eso existe la ronda
  de integración.
- **El chat sin sesión mandaba a `/propiedades/<id>` desde cualquier módulo** —
  un 404 justo después de que la persona se molestara en entrar.
- **El anuncio con la campaña vencida volvía a comportarse como orgánico**: la
  tarjeta sólo miraba `post_promotions`, que caduca. El hueco no estaba en el
  reel sino en el feed.
- **La búsqueda fallaba con las palabras más comunes escritas sin tilde**, que
  es como se escribe desde el teléfono. Medido: el stemmer español convierte
  `Habitación` en `habit`, pero `habitacion` queda entera y no matchea — dos
  avisos de habitación invisibles para quien no pone la tilde. Cerrado en 0052.
- Dos migraciones nacieron con el prefijo `0050`; la del orquestador se
  renumeró a `0051`.

### Puerta de calidad (31/7) — dos revisiones adversariales y lo que encontraron

Se corrieron dos revisiones independientes sobre el lote: una de código sobre
el diff completo, y otra que cruzó **cada migración contra el código que la
consume**. Entre las dos encontraron 6 defectos que habrían llegado a
producción. **Todos arreglados y verificados en vivo**, salvo los que se listan
al final como pendientes.

- **El feed principal no mostraba NINGÚN aviso.** La regla de la spec (§3: las
  publicaciones gratuitas no van al News Feed principal) estaba bien
  implementada, pero **nada en el repo concedía `tier='premium'`**: la policy
  fuerza `free` al nacer y el webhook que la migración prometía nunca se
  escribió. Con 50 avisos publicados, todos `free`, el filtro dejaba el feed en
  cero. Se concedió premium a un aviso por vertical, con sus botones cargados;
  un usuario nuevo pasa de 0 a 5 avisos.
- **Los botones de acción premium no se podían guardar en un aviso publicado.**
  `listings_update` (0004) excluye `status='published'` a propósito —para que
  un aviso no se reescriba después de pasar moderación— y eso rebotaba también
  el parche que sólo toca las 7 columnas `cta_*`. El comercio que paga entraba
  al editor, cargaba su teléfono y recibía un error genérico. Siempre.
- **El postulante no podía retirar el consentimiento sobre su perfil** una vez
  que el empleador movía la postulación a "en revisión". El trigger lo
  permitía y la UI lo prometía; la policy no lo dejaba llegar. Es dato
  personal, no un botón cualquiera.
  → Los dos anteriores se resolvieron con `security definer` en la **0053**, no
  aflojando las policies: lo que hacía falta no era autorizar la FILA sino dos
  columnas concretas, y eso una policy no lo sabe decir.
- **El mail al empleador filtraba el nombre de quien eligió no compartir su
  perfil.** La notificación in-app lo respetaba; el mail salía con el nombre
  completo en el asunto, o sea que el consentimiento se rompía antes de que el
  empleador abriera la app.
- **"Enviar mensaje" desanonimizaba al candidato en un clic**: la tarjeta decía
  "Candidato sin perfil compartido" y el botón de al lado abría un hilo con su
  foto, nombre y verificación en el encabezado.
- **El currículum se seguía descargando después de que el candidato se
  retiraba.** Esa promesa vivía en un solo `.neq('status','withdrawn')` de la
  consulta de la bandeja; ni la RLS ni la policy del bucket miraban el estado.
- Menores: badge de no leídas que no se podía apagar en 60 días · comprobante
  de boost sin destino en 4 de los 7 tipos de aviso.

**Quedó pendiente, con su razón:**
- **No existe camino de autoservicio para pasar a premium.** Falta la decisión
  comercial (precio, si es único o mensual). Hoy el tier lo concede
  `service_role`.
- **Los controles de privacidad del perfil no se construyeron** — ver la
  corrección al pie de `docs/feedback/2026-07-30-feedback-consolidado.md` §8.
- "Ver perfil" llega a 11 de 19 puntos de montaje; los 8 que faltan necesitan
  tocar consultas.
- Comentarios y me gusta todavía no emiten notificación.
- Una campaña rechazada no puede corregir su presupuesto en un solo guardado.
- El eje `advertising_video` no tiene productor: las reglas de la base son
  correctas pero hoy no gobiernan ninguna fila.

**Gates:** `tsc` 0 · `lint` 0 errores · **1911 tests** (eran 1450) · `build`
verde con todas las rutas nuevas · enumerador RLS verde con **69 superficies**
(eran 59). Las garantías de la base se probaron **en vivo con rollback**, no
por lectura: un video de 600 s no entra al reel, un aviso gratis no guarda un
botón externo, nadie silencia las notificaciones de pagos, nadie lee el CV de
otro, y bajar de premium a gratis **falla** si no se limpian los CTAs en la
misma sentencia.

## Feedback de la call del 27/7 (85 min) — 8 frentes en paralelo (✅ 2026-07-27)

Fuente y criterio: **`docs/feedback/2026-07-27-call-85min.md`** — las citas
textuales de Geovanny, su traducción a producto, y lo que quedó fuera con su
razón. Leer eso antes de tocar nada de este bloque.

**Construido** (63 archivos modificados, 44 nuevos; nada commiteado todavía):

- **Comentarios que no tapan el video** — sobre video la hoja ocupa ~46% del
  alto, fondo de vidrio (scrim + blur) en vez de panel opaco, el video **sigue
  reproduciéndose**, y los comentarios avanzan solos hasta que la persona toca,
  scrollea o va a escribir (nunca con `prefers-reduced-motion`). Con el teclado
  abierto la hoja baja a 34dvh para no dejar el video en 3% de pantalla.
  Contraste medido contra el peor caso (video blanco tras el vidrio): 7.58:1.
- **Carrusel de medios** (`media-carousel.tsx`) — swipe horizontal con
  scroll-snap, puntitos, foto y video mezclados en el mismo post, `snap-stop:
  always`. Un solo medio ⇒ sin puntitos. Los puntitos son indicador
  (`aria-hidden`), no botones: a 44px cada uno taparían el área del doble toque.
  Navegación accesible por ←/→, flechas visibles sólo con puntero fino, y
  `aria-live` anunciando "Foto 2 de 3".
- **Scope del reel, agujero cerrado** — el detalle `/feed/[id]` renderizaba
  `PostCard` sin scope y caía al default "para-ti", que **no filtra**: tocar el
  video ahí abría el reel infinito sin acotar. Se llega a esa pantalla desde el
  perfil de alguien y desde las novedades de un evento — literalmente el «te
  sale de la propiedad» del cliente. Además `videoScope` pasó de `string` a un
  tipo cerrado, así que montar una card con un scope inventado ya no compila.
- **Composer unificado** — se fueron los botones sueltos de foto/video y la
  plancha blanca; queda el campo rápido más un único «¿Qué querés publicar?».
  Elegir foto/video lleva a un paso con el medio a la vista y el texto debajo.
  Publicar sin medio abre una hoja que ofrece los dos caminos (sumar foto, o
  publicarlo como pregunta) llevándose el texto ya escrito, en vez de un botón
  muerto: el trigger `MEDIA_REQUIRED` de 0023 sigue vivo y sólo exime a
  `kind='question'`.
- **Preguntas: marca de agua + encuesta Sí/No** — la marca va en tinta oscura y
  no clara (una marca clara sobre el campo tricolor bajaba el peor stop a
  ~3.9:1; así el delta de contraste es 0.000). El reparto de votos aparece
  **al votar**, no antes, para no sesgar; el autor es la excepción.
- **Buscar en el bottom nav** — reemplaza «Propiedades», y es una ruta propia
  (`/buscar`) y no un modal: una pestaña necesita back del sistema, link
  compartible y `aria-current`. Muestra las categorías en cápsulas; el buscador
  con filtros sigue viviendo dentro de cada una, como pidió el cliente.
- **Lenguaje de cápsulas** (`ui/bubble.tsx`) — tres intensidades donde la
  diferencia significa algo: `soft` informa, `accent` acompaña, `strong` se
  toca. Relleno mezclado contra `--color-surface` para que se lea elevada en
  ambos temas. Aplicado a menú, `/buscar`, y cabecera + filtros de 7 secciones.
- **CTA «publicá tu…»** en las 7 secciones, con copy propio por sección y
  `?kind=` preseleccionado (antes todas iban a `/publicar` pelado).
- **`/admin/empleos`** — listado con conteo real de postulaciones y detalle con
  una barrera de dos niveles **por dueño del aviso, no por rol**: aviso de la
  plataforma ⇒ el staff ve todo y puede responder; aviso de un miembro ⇒ sólo
  metadatos, y las columnas privadas ni se seleccionan. Un `global_admin`
  tampoco sube de nivel. Cada apertura se audita, y **sin auditoría no hay
  divulgación**.
- **Módulos en tres estados** (Activo · Muy pronto · Oculto) — y, sobre todo, el
  cableado que faltaba: hasta ahora el admin guardaba la configuración y **la
  app la ignoraba**. Ahora gobierna el menú, `/buscar`, el bottom nav y las
  rutas (guard por `layout.tsx` en 8 secciones: oculto ⇒ 404, muy pronto ⇒
  pantalla propia con URL propia). `feed` y `mensajes` quedaron marcados como no
  apagables en el panel en vez de ofrecer un interruptor inerte, y `escudo`
  salió: está apagado en el build y fuera del menú.
- **`/perfil/guardados`** — ruta propia, sólo la dueña ve lo suyo (probado en
  vivo con dos cuentas, no por lectura de código).
- **Alerta urgente en el feed** — sólo `severity='urgent'` sube al feed; los
  `info` se quedan en notificaciones. Reusa `broadcast_receipts`, así cerrarla
  en un lado la cierra en el otro. Registro ámbar de cartel de ruta, sin
  animación ni sirena.

**Migraciones (aplicadas y verificadas contra la base, 32/32 checks):**
- **0041** — `posts.poll_kind` + counters por trigger, `post_poll_votes` (voto
  secreto: ni un moderador ve quién votó qué), `tenants.modules_soon`,
  `broadcasts.severity`.
- **0042** — cierra dos agujeros reales encontrados durante el trabajo:
  `job_applications_select/_update` tenían una rama `or app.is_staff()` que
  dejaba a **cualquier** staff (incluido `moderator`) leer `message`, `answers`
  y `applicant_id` de postulaciones a avisos ajenos por PostgREST, salteando el
  panel; y `listings.created_by` era reescribible, así que un `PATCH
  {created_by: null}` convertía un aviso ajeno en «de la plataforma» y
  destrababa la divulgación de forma legítima. Ambos probados **antes y
  después** con un token real de staff. Se sumó la RPC `job_application_tally`
  para que el panel siga contando sin poder leer.

**Fixes de seguridad y accesibilidad que aparecieron de paso:**
- Los formularios de auth eran `<form onSubmit>` **sin `method`**: un envío
  antes de hidratar (teléfono lento, que es medio público de esta app) hacía un
  GET nativo y dejaba la **contraseña en la URL y en el historial**. Ahora
  `method="post"`.
- `buttonVariants` dejaba `primary` y `danger` **sin anillo de foco** en ~40
  call sites: `shadow-xs` es una utility y le ganaba al `box-shadow` del
  `:focus-visible` global. El anillo ahora vive en la base del cva.
- `/notificaciones` leía `broadcast_receipts` sin filtrar por dueño; a un
  `global_admin` la policy le devuelve los de todos, así que un broadcast que
  otro ya cerró le desaparecía sin haberlo visto.
- El `z.url()` del panel admin aceptaba `javascript:` y eso llegaba a un `href`
  → `safeCtaHref()`.
- Contrato de impresión: la hoja de comentarios, la del composer y el carrusel
  escribían tinta clara sin nada que la salvara en papel (1.00:1). Cerrado con
  los hooks reales, no ajustando el inventario.
- Datos demo: los niveles de confianza contradecían su puntaje (score 35 con
  etiqueta «verificado»). Corregidos en el seed y **verificados en la base**:
  17/17 consistentes.

**Hallazgos de la ronda de review (code-reviewer + security-auditor en paralelo),
todos cerrados:**
- **Los defaults del panel y de la app eran opuestos.** Clave ausente ⇒ el panel
  decía "Activo" y la app escondía. Con una base recién sembrada —o sirviendo el
  tenant `comunidadlatina`, que arrastraba las claves de módulo **en inglés**
  mientras la app las lee en español— desaparecían el menú, `/buscar`, la
  pestaña de Videos y las 8 rutas, sin que el operador tuviera cómo verlo.
  Unificado en un solo lugar (`moduleAvailability`, ausente = activo, porque
  apagar es un acto deliberado), seed alineado, fila de la base corregida, y tres
  tests de sincronía nuevos (app ↔ panel ↔ seed) para que no se vuelva a separar.
- **La hoja de comentarios miraba el primer medio, no el que se está viendo.** En
  un post `[foto, video]` —el ejemplo textual del cliente— deslizar hasta el
  video y comentar abría la hoja vieja y opaca. El índice del carrusel se subió a
  un `CardMediaProvider` propio; `PostActions.hasVideo` desapareció, así que la
  superficie ya no se puede pasar mal desde afuera.
- **Dos redirecciones abiertas**, ambas confirmadas navegando a otro origen desde
  una tarjeta firmada como mensaje oficial de la plataforma — o sea, el escalón
  para un login clonado contra un público de migrantes. Una estaba en
  `broadcast-card.tsx` (`startsWith("/")` deja pasar `//evil.com`), la otra en el
  `safeCtaHref` que este mismo lote agregó (tapaba `//` pero no `/\`, y el parser
  de URL trata `\` como `/`). Se reemplazaron por `src/lib/url/safe-href.ts`, que
  clasifica por **origen resuelto** en vez de por prefijo de string y sólo admite
  http(s) — `zod.url()` acepta `javascript:` y `data:`, así que la allowlist tenía
  que estar ahí.
- Andamiaje de "la migración puede no estar aplicada" cuadruplicado y ya
  inalcanzable, comentarios que describían código borrado, y copy huérfano que
  este lote dejó al reescribir el composer: todo removido.

**Bump de Next 16.2.10 → 16.2.12** (patch). Cierra las advisories del framework,
incluida la fuga de IDs de Server Function que el auditor usó como escalón, y la
confusión de caché de respuestas —que importa en una app con respuestas por
usuario. Las 12 advisories que quedan son cadenas de build/dev (`postcss` y
`sharp` anidados en next, `minimatch` vía eslint), no superficie de runtime.

**Gates:** `tsc --noEmit` limpio · `npm run lint` 0 errores · **1399 tests**
(eran 1317) · `npm run build` verde con todas las rutas nuevas · enumerador RLS
verde, 59 superficies (corre con `RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1`; el
certificado de la conexión directa falla en este entorno) · ingreso con
contraseña verificado contra la build de producción después de tocar los forms
de auth: entra, la URL queda sin credenciales, consola sin errores.

**Pendiente:** push + deploy (decisión de Manuel) · el 500-en-vez-de-404 con ids
inválidos en varias rutas de detalle (preexistente, anotado aparte) · lo que se
dejó fuera de alcance a propósito está listado con su razón en el doc de
feedback.

## Semana 3-4 del plan + hardening — ejecución autónoma (✅ 2026-07-22)

Diagnóstico (5 agentes en paralelo) + ejecución de todo lo automatizable, con
revisión adversarial multi-dimensión al cierre (Workflow: correctness,
seguridad, a11y, copy legal, convenciones → **0 findings confirmados**; los 4
que se levantaron fueron refutados por verificadores adversariales). **Ver
`docs/HANDOFF.md`** para el plan completo y los gates humanos.

**Construido y commiteado (9 commits, `e391035`→`88394cc`):**
- **Legal (`ee1c5c5`)**: 3 páginas públicas `/legal/{terminos,privacidad,normas}`
  redactadas sobre las prácticas REALES de datos (minimización, TTL 90d,
  verificación = indicador no garantía), footer con links reales (antes "Muy
  pronto"). **BORRADOR — requiere revisión de abogado + placeholders `[correo
  de contacto legal — completar]`.**
- **Consentimiento de registro (`60fe8fc`)**: casillas obligatorias 18+ y
  aceptación de Términos/Privacidad/Normas, revalidadas server-side
  (`z.literal`), persistidas en `profiles` (mig **0027 aplicada a la base**:
  `age_confirmed_at`/`terms_accepted_at`/`terms_version` — sin fecha de
  nacimiento, minimización).
- **Recuperación de contraseña (`60fe8fc`)**: flujo completo `/recuperar` →
  email de Supabase Auth (SMTP propio, no depende de Resend) → `/callback` →
  `/recuperar/actualizar`. Rate-limit + mensaje genérico anti-enumeración.
- **CSP enforcing (`d4f9282`)**: report-only → **`Content-Security-Policy`**,
  validado en vivo con Playwright sobre build de prod. Se agregó `media-src`
  (los videos de Storage se bloqueaban en enforcing) y allowlist de
  `images.pexels.com` (DEUDA de demo — quitar al migrar seed a Storage).
- **Fix React #418 (`c835ad3`)**: `/admin/moderacion` — fecha determinista
  (locale `es-US` + `timeZone America/New_York`) server=cliente.
- **Tests webhook Stripe (`4e3d858`)**: 10 casos (firma, idempotencia,
  correlación de monto/session). Antes: 0 cobertura sobre el flujo de dinero.
- **Hardening `post-media` (`4e3d858`)**: 4ª policy en
  `supabase/manual/harden-storage-listing.sql` (cierra enumeración de user_ids;
  el bucket 0025 quedó fuera del fix original). **Aplicación MANUAL en Dashboard.**
- **Limpieza (`33cbef9`)**: BrandMark (código muerto) eliminado, `.env.example`
  trackeado (verificado sin secretos), `npm audit fix` (fast-uri 3.1.4).

**Verificado en vivo (no solo lectura de código):**
- Guard de escalada: un member (`maria@demo`) es **rechazado** por
  `admin_ban_user`/`admin_suspend_user`/`admin_reactivate_user` (FORBIDDEN);
  `block_user` (acción de member) sí le está permitida. El guard por rol-JWT
  funciona.
- Advisors de Supabase post-DDL: sin hallazgos nuevos (los WARN son los ya
  conocidos: listado de buckets — que el SQL manual resuelve —, funciones
  SECURITY DEFINER por diseño, leaked-password toggle).
- Deploy: **`comunidad-latina-sigma.vercel.app` = build actual** (auto-deploy de
  main); `comunidad-latina.vercel.app` = build vieja (otro team, sin Marketplace).
  Las rutas nuevas dan 404 en sigma **porque se commiteó pero NO se pusheó**
  (push/deploy = decisión de Manuel).

**Gates:** tsc 0 · lint 0 errores · **947 tests** (eran 930) · `next build
--webpack` verde · enumerador RLS verde (37 superficies).

**Falta (manual, ver HANDOFF):** push+deploy · aplicar `harden-storage-listing.sql`
en Dashboard · toggle leaked-password · pentest + firma senior · credenciales
reales (Stripe/Resend/Vision/Sentry) · revisión legal de las 3 páginas.

## Feed red social v2 — auditoría UI/UX del cliente (✅ 2026-07-21)

Sprint P1+P2 del documento "Auditoría UI/UX – Mejoras Prioritarias del News
Feed" (Geovanny, llamada 21/7), implementado por 6 agentes en paralelo con
fronteras de archivos + contratos (stubs de `MediaViewerProvider` y
`CommentsSheetProvider` montados en el layout ANTES de lanzar la flota):

- **Cards foto-protagonista** — `PostCard` con media 4:5 full-bleed
  (`card-post-media.tsx`), doble-tap = like con corazón central (motor
  optimista compartido `card-like-context.tsx`: el doble-tap y el botón mueven
  el MISMO contador), single-tap abre el visor, botones de acción 22px con
  animación. Listings con título/precio/zona en `overlayBottom` sobre la foto y
  "Ver detalles" como píldora con el acento del módulo (16:9 a propósito: el
  4:5 es de posts; las fotos de propiedades son apaisadas).
- **Video end-to-end (sin migración)** — `posts.media` ya era `text[]` y el
  bucket post-media no restringe mime: el kind se infiere por extensión
  (`mediaKindOf`). Composer: hasta 4 fotos + 1 video ≤60MB con subida DIRECTA
  navegador→bucket (XHR con progreso; el prefijo `{tenant}/{user}` lo entrega
  `prepareMediaUploadAction` y la action re-valida pertenencia al persistir).
  Autoplay muted en el feed (IntersectionObserver ≥60% + ~2s, pedido del
  cliente) con toggle de sonido.
- **Visor fullscreen + Reels `/videos`** — swipe horizontal con snap nativo,
  cierre por gesto atrás (pushState), sonido ON al abrir (hubo gesto; fallback
  a mudo si el navegador lo rechaza). `/videos`: scroll vertical un-video-por-
  pantalla, scope por módulo (`?scope=` filtra por kind del listing asociado)
  respetando la MISMA visibilidad del feed, `?start=` posiciona. Ítem "Videos"
  en el bottom nav. **GOTCHA descubierto:** `.cl-page-transition` tenía
  `will-change: transform` + fill `both` → containing block PERMANENTE que
  rompía cualquier `position: fixed` dentro de una página (los reels medían
  358×0). Fix doble: CSS pasa a `backwards` sin will-change + los reels
  portalean a `<body>` (mismo patrón que MediaViewer).
- **Comentarios tipo Instagram** — `CommentsSheetProvider` sobre `BottomSheet`
  (extendido aditivo: `size="tall"`, `keyboardAware` con visualViewport),
  fetch client-side espejo de la lógica del detalle, composer inline optimista
  ("Enviando…" → "recién"), el detalle `/feed/[id]` conserva su hilo SSR para
  deep links. `CommentItem` compartido entre sheet y detalle.
- **Perfil red social + Trust Score card** — header con avatar grande, país ·
  ciudad, contadores honestos (Publicaciones + Siguiendo; "Seguidores" omitido:
  ningún perfil general tiene follow hoy — agregar luego es un head-count),
  `TrustScoreCard` (NN/100 grande, barra animada por nivel, señales como
  chips, "¿Cómo funciona?" → sheet existente) y grid 3-col de publicaciones
  (thumbnail de video via `preload="metadata"` + glifo Play).
- **Fluidez** — scroll infinito real en todos los tabs (`load-more.ts` server
  action + `feed-list.tsx` acumulador con sentinel; "Cargar más" queda como
  fallback accesible; `?cursor=` legacy sigue SSR), pull-to-refresh
  conservador, skeletons con la silueta nueva 4:5, saludo rotativo del
  composer por franja horaria.
- **Marketplace** — barra de búsqueda (FTS `websearch` español sobre
  `listings.search`, mismo índice que propiedades) arriba de las categorías.
  El "bug de campos de vivienda" que el cliente vio NO estaba en Marketplace:
  era `/publicar` mostrando SIEMPRE la frecuencia (por mes/semana) — ahora
  solo vivienda y empleo la ven; negocio/profesional/evento publican precio
  único.
- **Seed de videos demo** — `scripts/seed-videos.mjs` (ffmpeg, 6 clips 9:16)
  ya ejecutado contra la DB: posts de María/Luis/Carlos + 2 de entidad
  (Panadería La Altagracia, Festival Sabor Quisqueya) para demostrar scopes.
- **Verificación** — typecheck ✅ · lint 0 errores ✅ · **930/930 tests** ✅
  (inventario de tintas `on-*` actualizado con coberturas de impresión) ·
  build de producción ✅ · Playwright sobre `npm start`: feed, autoplay,
  sheet de comentarios (comentario real publicado), reels, perfil y búsqueda
  del marketplace — 0 errores de consola.
- **Pendientes (P3 + llamada)** — algoritmo/recomendaciones, restructura del
  menú inferior (§13 era "ejemplo"; falta decisión de IA), íconos de colores
  (esperando ejemplos del cliente), guardar/bookmarks (necesita tabla),
  Marketplace Comunidad vs Tiendas verificadas con Stripe, mensaje directo en
  tiendas + reviews comprador↔vendedor, historias (pospuesto por el cliente
  hasta firmar contrato), menú de tipos de publicación del composer.

## Ajustes de UX pedidos por el cliente (✅ 2026-07-20)

Segunda tanda del mismo día, sobre la app ya desplegada:

- **Menú en un botón** — el rail de cápsulas salió del header y los 8 módulos
  (hoy 7, ver Escudo) viven en un drawer lateral que además absorbió el toggle
  de tema y la campana. `shell/app-menu.tsx` + `shell/modules.ts` (registro puro
  con `isModuleActive`, testeado). Se borraron `module-rail.tsx` y
  `notification-bell.tsx` (código muerto). El punto del botón conserva la señal
  de no leídas. **Ojo:** los links del panel van con `prefetch={false}` — abrirlo
  disparaba **39 peticiones RSC** (Next precargaba los 12 destinos, todos rutas
  dinámicas con queries) y saturaba el server; ahora 0.
- **Cards del Marketplace** — el chip de categoría envolvía en 3 líneas y tapaba
  media foto. `categoryShortLabel` (etiquetas cortas) + chip de vidrio oscuro
  (`bg-media-scrim` + blur, el idioma que ya usaban gig-card/creator-card) +
  precio/título rebalanceados.
- **Bandeja de mensajes vacía sin CTA** — empujaba a "Buscar propiedades", que
  manda a otro módulo por un vacío que se llena solo.
- **Barra de contacto sólida** — era un degradado `from-canvas` que dejaba ver la
  card de abajo y se leía como un solapamiento sucio. Ahora es una barra con
  hairline + `bg-surface/92` + blur (mismo tratamiento que el bottom nav).
  `profesionales/[id]` pasó de `pb-24` a `pb-40`: con 24 la última card quedaba
  TAPADA por la barra.
- **Copy de contacto: una sola mención y concreta** — "Contactar (protegido)" +
  "Tu contacto queda protegido dentro de la app" decía lo mismo dos veces y
  "protegido" no dice QUÉ se protege. Quedó **"Contactar"** + "Tu teléfono no se
  comparte".
- **Foco del composer de comentarios** — tenía `focus:outline-none` SIN
  reemplazo: no había ningún indicador de foco propio (hueco de accesibilidad) y
  el navegador dibujaba el suyo, rectangular, que no empalmaba con la píldora.
  El anillo ahora vive en el `<form>` (`focus-within`) y sigue el radio.
- **Escudo OCULTO por completo** y **guías fuera del feed y del menú** — patrón
  del repo (`ASSISTANT_ENABLED`): flag `boolean` + `notFound()` en las rutas +
  sin entry points. `ScamShieldNotice` sigue existiendo pero desmontado de
  propiedades/[id] y profesionales/[id]. **Pendiente al reactivar:** volver a
  montar esas cards, el módulo en `shell/modules.ts` y los links que sacó el
  barrido. El toggle "Escudo Anti-Estafa" del panel de admin se dejó A PROPÓSITO
  (es staff-only y es por donde se reactiva).


**Última actualización:** 2026-07-19 (Feedback del cliente → Marketplace + Creator Marketplace + reglas de alcance del feed + restyle foto-grande + rail de módulos).
**Estado:** ✅ **R0–R3 + BLINDAJE + FEEDBACK CLIENTE 2026-07-19 implementado completo.** 60+ rutas. Gates verdes: `tsc` 0 · lint 0 errores · **831 tests** · `next build --webpack` verde · enumerador RLS verde (37 superficies).

## Feedback del cliente (WhatsApp 19/7) — implementado completo (✅ 2026-07-19)

Orquestado con 5 agentes en paralelo (ownership de archivos estricto) + curador de imágenes.
Migraciones **0023–0025 aplicadas a la base real**. Todo el pedido de Geovanny quedó funcionando:

- **Estética "Propiedades" en todos los módulos** — eventos/negocios/profesionales con foto hero
  16:9 (`CardMedia` nuevo en `ui/`), acentos de color por módulo (`--accent-*` en globals, fijos
  como la marca tricolor; texto siempre con tokens `-ink`). Negocios NO tiene ruta de detalle por
  diseño (BottomSheet); su follow vive en la tienda del Marketplace.
- **Marketplace** (`/marketplace`) — productos = `listings kind='product'` con
  `attrs.store_listing_id` → negocio dueño. Grid 2-col, categorías canónicas
  (`PRODUCT_CATEGORIES` en `components/marketplace/helpers.ts` — el seed DEBE usar esas claves),
  tienda (`/marketplace/tienda/[id]`) con FollowButton, publicar con moderación real.
- **Creator Marketplace** (`/creadores`) — avisos = `kind='creator_gig'` (presupuesto en
  `price_amount`); `creator_profiles` (reputación por triggers, JAMÁS escribible por el cliente),
  `gig_applications`, `gig_contracts` (código `CL-YYYY-NNNN` por secuencia, fee 20% en columnas
  GENERADAS por la DB, escrituras SOLO service_role vía actions con guard optimista de transición
  — máquina de estados pura en `components/creators/contract-machine.ts`, la misma tabla autoriza
  server y pinta botones), `gig_reviews` (solo partes de contrato `released`, inmutables, refresh
  de rating por trigger). **Pagos en modo demo etiquetado** (`payment_mode='demo'`): Stripe
  Connect es fase siguiente; columnas `stripe_*` listas.
- **Reglas del feed** — `posts.entity_listing_id` (publicar como tu negocio/evento; ownership por
  policy). Orgánico de entidad → SOLO seguidores (`follows`, 0023) · promocionado
  (`post_promotions`, espejo de boosts, chip **"Publicidad"**) → todos · personales → todos.
  **Es regla de DISTRIBUCIÓN en la query (`feed/queries.ts`), NO frontera RLS** (el post published
  sigue público en su detalle y en la página de la entidad — documentado en el archivo).
  Campañas: `/impulsar-post/[postId]` (paquetes 7/14/30, audiencia all/zonas persistida; sin
  Stripe → activación demo etiquetada; con Stripe → checkout + webhook ya discriminado).
- **Foto obligatoria en posts** — 3 capas: trigger DB `MEDIA_REQUIRED` (INSERT de `kind='post'`,
  service_role exento), server action, y composer con CTA deshabilitado + hint. `kind='question'`
  exento. **Decisión de producto: publicación instantánea + moderación a posteriori** (sin Vision
  el post nace `published` y se encola `TIER_HUMAN`; la red de seguridad ya existía: reporte 2
  taps + bloqueos + sanciones). Con Vision configurado vuelve el screening síncrono.
  Subida migrada al bucket **`post-media`** (0025, path `{tenant}/{user}/…`) con cliente del
  usuario — **eliminado el desvío admin de `listing-photos`** documentado en feed/actions.
- **Rail de módulos** — cápsulas de color scrolleables bajo el header (sticky compartido con el
  header a propósito: dos sticky hermanos no apilan bien), 8 módulos con acento propio; bottom
  nav sigue en 4 tabs. Toggles de admin sincronizados en los 3 espejos (`MODULE_KEYS` en
  admin/dominio/actions, `DEFAULT_MODULES` en tenant/resolve, `MODULES` en module-toggles) +
  `tenants.modules` del tenant real con `marketplace`/`creadores` en true.
- **Grafo social** — `follows` (0023): polimórfico listing|profile, respeta `pair_blocked` (0020)
  y sanciones (0021); `FollowButton` compartido (`components/social/`) + action
  (`app/(app)/social/actions.ts`). Cleanup de huérfanos por trigger.

**Seed demo (`scripts/seed-demo-content.mjs` + `seed-images.json`)** — la demo dejó de ser 100%
texto: 44 fotos Pexels VERIFICADAS (curador con WebFetch, solo 200), 23 listings viejos
fotografiados, 6 personas nuevas (María recreada — la habían borrado en pruebas de baja — +
Altagracia/panadería, Ramón/barbería, Yesenia y Luis creadores, Marisol), 2 tiendas con 8
productos (claves de categoría canónicas), 2 avisos de creadores, 3 aplicaciones, contrato
**CL-2026-0001 liberado** ($450 → $360 + $90 con transiciones REALES para ejercitar triggers:
Yesenia quedó ★5.0 · 1 trabajo) + CL-2026-0002 en curso, reviews mutuas, follows para las cuentas
demo (geovanny/carlos/manuelnavarro/María; `reycamila04` ajena, NO se toca) y el post de la
barbería con campaña activa (María no la sigue → lo ve SOLO por "Publicidad": la regla completa
en una pantalla). Listings nuevos backdateados a propósito (la 1ª página del feed es gente, no
catálogo). Password nueva en `SEED_DEMO_PASSWORD` (.env.local, fuera del repo).

**Verificación:** gates arriba + e2e Playwright contra `next start` real (build de prod, puerto
3377) con login real: feed con las 3 visibilidades + chip Publicidad, eventos/marketplace/
creadores/buscar con foto grande, contrato CL-2026-0001 con stepper/desglose/reseñas. Capturas
en la raíz del repo (`demo-*.png`, sin commitear). OJO: los `<img loading="lazy">` no cargan en
screenshots fullPage sin scrollear antes (helper en la sesión). La caché de webpack se corrompió
con el churn paralelo (`TypeError … reading 'length'` sin stack): `rm -rf .next` lo cura —
turbopack compilaba, era solo la caché.

**Pendientes que dejó esta tanda:**
1. `get_advisors` (Supabase MCP) → "You do not have permission" sobre `ktmbtpuhqqofdkisqseq`:
   el conector claude.ai no alcanza este proyecto. Correrlos desde el dashboard o re-autorizar.
2. Tipos de `database.types.ts` de 0023–0025 escritos A MANO (MCP sin permiso, CLI pide Docker) —
   una regeneración futura los pisa sin drama (nota en el header del archivo).
3. Stripe real para contratos de creadores y campañas de posts (schema listo, modo demo activo).
4. Fotos de posts/portfolios viven en URLs de Pexels (demo) — para producción real, migrar a
   Storage propio.
5. Preexistentes: React #418 en `/admin/moderacion` (Intl.DateTimeFormat server vs browser) y
   `finalizeListing` de `/publicar` no encola moderación (el flujo nuevo de productos SÍ lo hace
   — patrón a copiar). El fix del redirect `/publicar` → `/entrar` (`?redirect=` vs `?next=`)
   corre en tarea aparte.
6. **Deploy en Vercel sigue BLOQUEADO a nivel team** (ver Pendientes #0 de la sección Blindaje).

## Blindaje · Semana 2 — bloqueo, sanciones y reporte simple (✅ 2026-07-17)

`main` = `1ae2b44` (commits `6ae9590` + `1ae2b44`), pusheado. **⚠️ Deploy en Vercel BLOQUEADO a nivel team**
(ver Pendientes #0). Migraciones **0020–0022 ya aplicadas a la base real** (compatibles con el prod viejo:
sin bloqueos/sanciones registrados, los triggers son no-op).

- **Bloqueo global (0020):** `user_blocks` (RLS solo-dueño: quién te bloqueó jamás es consultable), RPCs
  `block_user`/`unblock_user`, `request_contact` con `USER_BLOCKED` (mismo copy en ambas direcciones), hilos
  existentes → `blocked` (desbloquear NO los revive), feed sin posts ni avisos de bloqueados, "Bloquear a esta
  persona" en menú de perfil y de hilo, `/perfil/bloqueados` para deshacer.
- **Sanciones (0021):** `profiles.account_status` (`active|suspended|banned`) + `suspended_until` (vencida =
  activa, sin cron), historial `account_sanctions` (solo staff lee; escribe solo RPC/service_role), RPCs
  `admin_suspend_user` (moderator+, 1–90 días) / `admin_ban_user` (domain_admin+, + ban de login vía Auth
  best-effort) / `admin_reactivate_user`; triggers `enforce_account_active` en la capa de datos; panel
  `/admin/miembros` (búsqueda, reportes abiertos por **denunciante único**, sanciones a un tap con motivo
  obligatorio); `AccountGate` reemplaza la app entera para suspendidos/baja. Staff no es sancionable
  (`CANNOT_SANCTION_STAFF`); nadie se auto-reactiva (guarda en `protect_profile_columns`).
- **Reporte en 2 taps:** `ReportSheet` unificado (motivo preseleccionado + enviar; éxito con autocierre 1.5s)
  en perfil, posts, mensajes y avisos → `reportTargetAction` → RPC `report_scam`.
- **Endurecimiento post-review adversarial (0022):** un reviewer (lente seguridad) encontró que
  `conversations_insert` (0006) permitía "conversaciones directas" sin RPC → un bloqueado podía abrir un hilo
  nuevo y escribir. Cerrado con trigger `enforce_pair_not_blocked` BEFORE INSERT. También: suspendidos ya no
  pueden likear (`reactions`) ni "publicar por edición" (UPDATE de posts/comments/listings).
- **Fix crítico preexistente (`6ae9590`):** `MotionProvider` (4231887) activó `LazyMotion strict` pero 7
  componentes seguían con `motion.*` → error boundary al montar cualquiera (dev). Convertidos a `m.*`.
  **Regla desde ahora: componentes nuevos usan `m.` de `motion/react`, nunca `motion.`.**

**Verificación:** 39 sondeos en vivo contra la base real (anon/member/staff: RLS, RPCs, triggers, guardas,
con filas sembradas — sin ambigüedad `200 []`) + e2e de UI con **Playwright** (reportar 2 taps → fila en
`scam_reports`; bloquear/desbloquear; suspender desde `/admin/miembros`; `AccountGate`; reactivar) + `tsc` 0 ·
lint 0 errores · **759 tests** · `next build` verde. OJO: el Browser pane de Claude no renderiza el streaming
SSR de esta app (contenido queda en `div hidden id="S:*"`, pasa igual con la prod vieja) — para e2e de UI usar
el MCP de Playwright.

## Merge integral + push + deploy (✅ 2026-07-08)

`main` = `b5a7493`, pusheado a `INSIGHTSAPPS/comunidad-latina` (privado) y desplegado a
https://comunidad-latina-taupe.vercel.app. Gates: `tsc` 0 · `lint` 0 errores · **760 tests** · `build` verde.

**2ª tanda (`agents/print-y-a11y`, `b5a7493`)** — 30 archivos, +2686/−254. Los agentes siguieron trabajando
~10 min después del primer deploy, otra vez sin commitear. Hoja de impresión (12 bloques `@media print` +
`cl-print-hide` en 13 superficies de chrome), 53 atributos `aria-*` nuevos, `theme-toggle.tsx`, y cuatro suites
de tests (contraste WCAG de tokens, invariantes de tema, contrato de impresión, toggle). Tests: 272 → **760**.
Verificado en prod: el toggle voltea el `--color-focus-ring` de `#9c3104` (light) a un tinte casi blanco de la
marca (dark), sobre canvas `#17150f`.

Se unieron dos líneas de trabajo paralelas:

- **`agents/design-tokens-y-theme` (`e9efcf1`)** — 95 archivos, +2672/−448. Cinco agentes trabajaron sobre el
  working tree de `main` **sin commitear**, así que llegó todo entreverado: no hay atribución por agente ni forma
  de separarlo retroactivamente. Tokens semánticos nuevos (`bg-media-scrim`, `text-on-media`, `focus-ring`,
  `bg-brand-hover`) en ~60 componentes, `src/components/theme/` con tests, hero mobile con art direction
  (`<picture>` + `getImageProps`), y `vitest.config.ts`.
- **`claude/wizardly-albattani-90d934` (`a5df7e5`)** — guard de divergencia de tenant (ver más abajo).

**Único conflicto real:** `vitest.config.ts` (add/add). Resuelto como unión — el alias de `server-only` y el
`exclude` de `.claude/worktrees/**` son ambos necesarios.

**Bug de a11y cerrado en el merge:** `tenant-mismatch-banner.tsx` era el último componente con
`ring-[var(--color-brand-200)]`. Ese token es un tono casi blanco por construcción (lightness 0.885 en el brand
pipeline, para cualquier tenant) → **1.38:1 contra el canvas claro: el anillo de foco no existía en light mode**
(§2.8, "nunca un borde que desaparece en un tema"). Verificado en prod: ahora resuelve a `#9c3104` vía
`--color-focus-ring`, que voltea con el tema.

**`npm run lint` desde la raíz daba 3365 errores** — todos de `.claude/worktrees/<rama>/.next/` (bundles
minificados de otra rama), ninguno de código. `.next/**` a secas solo matchea en la raíz. Arreglado en
`eslint.config.mjs` con `**/.claude/worktrees/**` + `**/.next/**`. Mismo motivo que el `exclude` de vitest.

**🐛 Bug abierto (preexistente, NO del merge):** `/admin/moderacion` tira **React #418** (mismatch de hidratación,
`args[]=text`) en prod. La página funciona: React re-renderiza y Aprobar/Rechazar andan. Sospechoso:
`new Intl.DateTimeFormat("es", …)` en `components/admin/moderation-item.tsx:56` y `scam-report-item.tsx:42`,
que formatea distinto en el server (UTC) que en el browser.

## Deploy de demo en producción (⚠️ 2026-07-08)

**URL:** https://comunidad-latina-taupe.vercel.app · proyecto Vercel `comunidad-latina` (team `manuels-projects-66819a23`).
`comunidad-latina.vercel.app` estaba tomado por otra cuenta.

> ⚠️ **Los gates humanos del pendiente #1 SIGUEN ABIERTOS.** Esto es una URL de demo, decidida a conciencia,
> apuntando a la base REAL (`ktmbtpuhqqofdkisqseq`). No es un go-live. No cargar datos de personas reales.

- **URL pública, sin protección de deployment.** Se desactivó `ssoProtection` (venía en `all_except_custom_domains`,
  que dejaba todo detrás del SSO de Vercel y el cliente no podía abrirlo). Para volver a cerrarla:
  `PATCH /v9/projects/<id> {"ssoProtection":{"deploymentType":"all_except_custom_domains"}}`.
- **`framework` era `null`** (el proyecto se creó con `vercel project add`, sin preset) → Vercel no aplicaba el
  routing de Next y **todo daba 404** aunque el build fuera verde. Corregido a `nextjs`.
- **Env de producción: solo 7 vars reales.** Stripe/Resend/Vision/Sentry quedan **sin setear** a propósito → los
  flags de `lib/config/services.ts` dan `false` y la degradación elegante funciona (verificado: el botón de plan
  abre "Muy pronto — Estamos terminando de configurar los pagos").
  ⚠️ En `.env.local` esas llaves son comentarios (`STRIPE_SECRET_KEY=  # sk_test_…`) y `@next/env` los recorta a `""`.
  **Si se pegan literales en el dashboard de Vercel, `Boolean()` da `true` y la degradación muere.**
- **`robots.txt` → `Disallow: /`** en cualquier host que no sea un dominio real (ver `src/app/robots.ts`).
- **Limitación de la demo:** en producción `isProduction` mata `MODERATION_DEV_AUTO_APPROVE` y Vision no está
  configurado → **todo listing nace `pending_review`**. Para que aparezca hay que aprobarlo en `/admin/moderacion`
  (entrar como `carlos` o `geovanny`). Los posts de texto del feed sí se publican al toque.
- **Push a GitHub: ✅ resuelto.** El remote `INSIGHTSAPPS/comunidad-latina` es privado y **solo lo ve la cuenta
  `gh` INSIGHTSAPPS**, no `manu-180`. Con esa cuenta activa, `git push` autentica sin pedir password. El deploy
  igual sube archivos locales y **no depende de Git** (el proyecto Vercel no tiene conexión con el repo, así que
  un push NO dispara build: hay que correr `vercel deploy --prod`).
- Credenciales demo: rotadas, fuera del repo (ver "Datos demo").

## Guard de divergencia de tenant (✅ 2026-07-08)

El tenant del REQUEST (header `x-tenant-slug`, del Host o de `?t=`) y el del USUARIO (JWT
`app_metadata.tenant_id`, lo único que gobierna la RLS) podían divergir sin que nada lo verificara.
**En producción es inalcanzable** (dominios registrables distintos → las cookies de sesión no cruzan);
afectaba dev y previews de Vercel, donde `?t=` es el único modo de cambiar de comunidad.

- **Regla pura** en [`src/lib/tenant/match.ts`](../src/lib/tenant/match.ts) (`classifyTenantMatch`) + **cableado**
  en [`src/lib/tenant/guard.ts`](../src/lib/tenant/guard.ts) (`requireTenantMatch`, `server-only`, espejo de
  `app/admin/guard.ts`). 27 tests nuevos (39 en total).
- **Trampa del fallback:** `getTenant()` degrada a un `id` PLACEHOLDER cuando la DB no responde o el slug no
  existe. Compararlo contra el JWT convertía un hipo de infra —o un `?t=` mal tipeado— en "estás en la comunidad
  equivocada". Nuevo campo `Tenant.isFallback` → estado `tenant-unavailable` con el copy genérico de §7.
  **Nunca afirmar de más.**
- **La lectura NO se bloquea** (cross-tenant a propósito por SEO, policy `listings_select`): solo escrituras.
  Aviso no-bloqueante `<TenantMismatchBanner>` en el shell de `(app)/`, con vuelta en un click.
  **Se muestra a todos los roles**, incluido `global_admin`: `listings_insert` no tiene escape para staff
  (solo `listings_update`), así que en otro tenant tampoco puede publicar — el aviso también es cierto para él.
- **8 paths cubiertos.** Además de las 6 escrituras (listings, listing_private_details, posts, comments,
  reactions, business_accounts), dos que **mentían** bajo divergencia: `impulsar` decía *"Solo el dueño puede
  impulsarlo"* sobre un aviso propio, y el **verificador del Escudo** decía *"registro no conectado"* sobre una
  matrícula sí verificada (contradecía §11: nunca inventar ni negar un resultado).
- **🐛 Bug real corregido (reproducido y verificado en vivo):** `createPostAction` subía la foto con el **admin
  client** (bypassea la RLS de storage) al prefijo `{tenant_id}` del **tenant equivocado**, y recién después la
  RLS rechazaba el insert de `posts` → **archivo huérfano, sin fila, sin audit_log**. Por eso el guard corre
  ANTES de todo efecto colateral (rate limit, storage, Stripe), y no como traducción del error de RLS.
  Medido con service-role: **sin guard 1 objeto huérfano; con guard 0.** Happy path intacto (posts 3 → 4).
- **Gotcha de testing:** se agregó [`vitest.config.ts`](../vitest.config.ts) (no existía) con el alias `@/*` y un
  stub de `server-only` (`src/test/`), que fuera de un render RSC lanza a propósito.

Gates: `tsc` 0 · `lint` 0 errores · **39 tests** · `build` verde (47 rutas) · smoke-test en vivo con
`maria@demo` (Dominicanos) navegando `?t=comunidadlatina`.

## Emblemas 3D premium (✅ 2026-07-08)

**8 emblemas 3D** generados con Meshy (REST; el MCP está roto en Windows — ver [MESHY-MCP-SETUP.md](MESHY-MCP-SETUP.md))
y cableados en las superficies de confianza. Pipeline reproducible en [`assets-source/emblems/`](../assets-source/emblems/).

- **Pipeline:** `text-to-image` (nano-banana-pro, concepto art-dirigido) → `image-to-3d` (meshy-6, malla+textura)
  → `alpha_thumbnail` (render 512² RGBA, fondo transparente) → sharp → **WebP 256², ~9 KB c/u (96 KB los 8)**.
  Nada de 3D en vivo: el 3D genera el modelo, se envía un raster. Público en 3G y gama baja (§3.4).
- **Cableado:** hero de `/escudo` (88px, `priority`) · `ScamShieldNotice` (40px, lazy) · `VerificationCard`
  (72px, sello verde/rojo) · `TrustScoreBadge` variante card (32px) · `TrustScoreSheet` (72px, momento "level-up").
- **Umbral `EMBLEM_MIN_SIZE = 28px`**: debajo de eso sigue el ícono Phosphor de línea (§2.6). El badge inline
  (14px) no cambió — un render 3D a esa escala es puré. El fallback de línea **no es degradación**: es la
  representación correcta en su tamaño. `AnimatedNumber` intacto.
- **Regla dura descubierta:** un raster **no puede llevar el color de marca** (varía por tenant: #1A5EDB vs
  #C2410C). Por eso ningún emblema lo usa — solo neutros + semánticos, fijos por guardrail (§6). El diamante
  es cristal incoloro por esa razón, aunque el nivel se tiña con `text-brand`.
- **Un objeto, un significado:** el nivel "Confiable" reutiliza el mismo escudo verde que el hero del Escudo
  Anti-Estafa. Un escudo verde es "protegido" en todo el producto.
- **Costo:** 585 cr (2340 → 1755). El diamante necesitó 5 iteraciones: `image-to-3d` no reconstruye gemas
  transparentes, y el `LOOK` compartido decía "collectible enamel pin", que convierte una gema en una placa
  con engaste. Se resolvió pidiendo un sólido facetado opaco.

**Decisiones de NO hacer** (documentadas en [`public/brand/MANIFEST.json`](../public/brand/MANIFEST.json)):
- **Splash sin tocar.** Es el primer paint y hoy no pide red (monograma + CSS). Un raster ahí arriesga un
  emblema en blanco en la primera impresión, con conexión pobre. Además su tile lleva el `brandHex` del tenant.
- **Ícono PWA sin tocar.** Se renderizaron ambos candidatos a 48px (tamaño real de launcher): el escudo 3D
  inclinado achica el "CL" hasta volverlo una mancha. El squircle plano actual gana. El emblema de marca 3D
  quedó archivado en `assets-source/brand-raster/brand-emblem-3d.png`.
- **🔎 Hallazgo:** `<BrandMark>` (`src/components/experience/brand-mark.tsx`) **no se usa en ningún lado** —
  es código muerto. El MANIFEST anterior afirmaba que vivía en el header y el splash; era falso. Decidir:
  darle un hogar o borrarlo.

Gates: `tsc` 0 · `build` verde · 12 tests · `lint` 0 errores · smoke-test visual a 375px (/escudo, aviso anti-estafa, hoja del Trust Score).

## Revisión integral + Polish premium (✅ 2026-07-07)
- **Revisión integral**: 6 fiscales adversariales en paralelo (correctness, seguridad+anti-honeypot, UX premium, performance, arquitectura, accesibilidad) → 23 findings únicos aplicados (5 críticos, 8 mayores, 10 menores).
- **Polish premium**: splash de entrada por tenant (overlay, no bloquea LCP, reduced-motion), transiciones de página, primitivos de motion (TapScale, AnimatedNumber en Trust Score, LikeBurst en feed, Celebration al publicar/verificar/onboarding, Reveal, Shimmer), detalles de lujo en landing, emblema/escudo generados (nanobanana) + brand-mark SVG.
- **Fix de correctitud (smoke-test en vivo)**: el Asistente RAG tenía `DEFAULT_MIN_SIMILARITY=0.75` (umbral de otra métrica) que rechazaba TODOS los matches — la guía de ITIN matcheaba 0.748, la de ICE 0.589, y el asistente respondía "no sé" sobre su propio contenido. Calibrado empíricamente a **0.42** (`scripts/diagnose-rag.mjs`); ahora responde citando la fuente correcta. Verificado en vivo.

## R3 — Moat de IA + producción (✅ 2026-07-07)
- **Asistente Comunitario RAG** (`/asistente`, wireframe §4.e): pgvector + `match_chunks` (definer, solo published), streaming, guardrails duros legal-safe (nunca consejo/plazos/elegibilidad; cita fuente+fecha; deriva a profesional verificado), rate limit (10/h auth, 3/sesión anon), telemetría mínima con hash (nunca la pregunta en claro, TTL 30d). **21 chunks ya embebidos** (guías+listings) — re-generar con `npm run rag:embed`.
- **Stripe Identity** (`/perfil/verificar`): sesión atada al usuario, webhook → flag booleano + trust +25 (el documento nunca toca la DB). **Boost** (`/impulsar/[id]`): checkout one-time, webhook activa, chip "Destacado · Publicidad" (FTC), datos de pago solo-service (0018).
- **Emails Resend** (bienvenida/lead/mensaje — sin contenido privado) + **Sentry** completo guarded (scrub PII) + **Matching "Para vos"** (determinístico, razón visible) + **Copiloto de Negocios** (`/negocios/copiloto`).
- **Producción**: sitemap/robots dinámicos, error pages premium, security headers (CSP report-only), rate limiting, README, migraciones 0016-0018 aplicadas (hardening por fiscal: retención extra en conversaciones/reportes/payment_events/receipts).
- Gates: tsc 0 · build verde (47 rutas) · 12 tests · lint OK · **RLS GATE VERDE (29 superficies)** · fiscal legal-IA (max) + seguridad: 11 findings corregidos.

## Qué está construido y verificado

### R0 — Cimientos (✅)
- **DB multi-tenant**: 15 migraciones aplicadas en Supabase (`ktmbtpuhqqofdkisqseq`), 23 tablas, RLS `FORCE` + 4 policies nombradas en TODAS, helpers `app.*` (tenancy por JWT `app_metadata`, uuid v7), storage con policies por tenant, pg_cron TTL (mensajes 90d, notificaciones 60d, audit 365d), pgmq, 4 RPCs security-definer.
- **Anti-honeypot §5.4 implementado**: sin teléfono, `profiles_private` (needs del onboarding solo-dueño), geo aproximada (`area_label`/`geo_zone`), trust sin grafo de avales, verificación = flag booleano, TTLs.
- **Gate**: `npm run check:rls` → **VERDE (26 superficies)**. Advisors Supabase: solo WARNs intencionales (ver "Pendientes").
- **Design system premium**: tokens completos del brief 13 (neutros cálidos, semánticos, Double-Bezel, motion), General Sans + Plus Jakarta Sans, componentes ui/ + trust/ (gramática fija de TrustScore).
- **Infra**: middleware multi-tenant (Host→tenant, dev `?t=`), brand pipeline OKLCH con validación WCAG (con test), clientes Supabase SSR, degradación elegante (`lib/config/services.ts` + `<ProximamentePremium>`).
- **Assets**: 6 imágenes premium generadas con nanobanana en `public/images/`.

### R1 — Wedge con moat (✅)
- **/propiedades**: búsqueda full-text español, filtros, keyset pagination, detalle según wireframe §4.d (banda de verificación SOLO con `verification_check found_active`, ScamShieldNotice siempre, ubicación aproximada, CTA sticky contacto protegido → RPC).
- **/escudo**: verificador notario/abogado (resultado binario con copy legal: registro + fecha + disclaimer; estado honesto si no hay registro conectado), reportes (RPC `report_scam`), educación anti-estafa.
- **/bienvenida**: onboarding "Recién Llegado" 5 pasos <60s, needs → `profiles_private`.
- **/mensajes**: conversaciones pending/accepted, moderación de texto OpenAI, aviso anti-estafa fijo, TTL comunicado como feature.
- **/negocios/presencia**: planes `[EJEMPLO]` §18, degradación premium sin Stripe; webhook Stripe production-ready (firma + idempotencia `payment_events`) **pendiente de firma senior**.
- **Landing premium** + /guias con fuentes oficiales + JSON-LD + PWA (Serwist en Next 16, manifest por tenant, InstallPrompt, offline).

### R2 — Red social + admin (✅)
- **/feed**: 5 pestañas, composer con moderación, 3 tipos de card estructuralmente distintos, likes optimistas (triggers de counters en DB), anti-scroll (botón "Ver más").
- **/profesionales, /eventos**: directorios con la misma regla estricta de verificación; /publicar soporta property|professional|event.
- **/notificaciones**: unificadas + **Broadcast Global pull-model** con receipts; campana en header.
- **/admin**: moderación (cola con score IA), dominio (stats, aprobaciones, reportes), global (crear tenant con preview del brand pipeline, broadcast) — todo gateado por `app_metadata.role` server-side + `audit_log`.

### Verificación (todo corrido en esta sesión)
`tsc` 0 errores · `next build` verde (33 rutas) · 12 tests vitest · lint 0 errores · enumerador RLS verde · smoke-test visual (landing, /propiedades, /feed) en 375px.

### Proceso (cómo se construyó)
5 workflows ultracode: esquema adversarial (autor max + 3 fiscales × 2 rondas + corrector), assets nanobanana, fundaciones (2 agentes paralelos + integrador), R1 (7 módulos paralelos + integrador + 2 fiscales + corrector, 14 findings), R2 (4 módulos + integrador + fiscal max + corrector, 4 findings). ~30 agentes, ~4.1M tokens de subagentes.

## Datos demo
- Tenants: `dominicanos` (#1A5EDB) y `comunidadlatina` (#C2410C). En dev: `http://localhost:3000/?t=dominicanos`.
- Usuarios: `maria@demo.comunidadlatina.com` (member) · `carlos@...` (domain_admin) · `geovanny@...` (global_admin).
  **La password NO se documenta acá** (2026-07-08): la vieja `Demo123!demo` estaba en el repo y uno de los tres
  es `global_admin` sobre la MISMA base que usa cualquier deploy → cualquiera con la URL entraba al panel global.
  Rotadas y fuera del repo. El seed ahora exige `SEED_DEMO_PASSWORD` en `.env.local` y aborta sin ella.
- 9 listings de Queens, 3 guías con fuentes oficiales, 5 posts + comentarios + reacciones, 1 verification_check.

## Pendientes (en orden)
0. **🟡 DEPLOY — resuelto el bloqueo de git-author, falta consolidar el dominio/team canónico.** El bloqueo
   original (team `manuelinsights`, plan Hobby + repo privado) se resolvió haciendo público el repo
   `developers-insights/comunidad-latina` (commit `50c76ea`, **confirmado público hoy** con `gh repo view`,
   2026-07-22) y fijando el remote por defecto (`d970b94`). Pero ningún archivo del repo documenta todavía CUÁL
   proyecto/team de Vercel es el que recibe el auto-deploy real — eso solo vivía en memoria de sesión. Acción
   pendiente de Manuel: confirmar en el dashboard de Vercel cuál team/dominio es el vigente (candidatos vistos
   en distintas sesiones: `insights3`/`comunidad-latina-sigma.vercel.app`, `insights-apps`, `manuelinsights`) y
   escribir la respuesta acá. Mientras tanto `comunidad-latina.vercel.app` (otro team) sirve una build vieja sin
   Marketplace/Creadores, y `comunidad-latina-taupe.vercel.app` es LEGACY congelado — no usar ninguno de los dos
   para demos. Detalle completo en `docs/HANDOFF.md`.
1. **🔴 GATES HUMANOS antes del primer dato real (§5.2/§14.4 — NO construibles por agentes):** pentest humano adversarial + **firma de ingeniero senior** sobre migraciones y webhook Stripe. Sin esto NO se expone a usuarios reales.
2. **Credenciales faltantes** (degradan con elegancia hoy): Stripe (test) → activa pagos reales del flujo ya construido · Resend → emails · Google Vision → moderación de imagen (hoy: pending_review) · Sentry → observabilidad (exigida antes de producción) · Vercel → deploy + dominios.
3. **Hardening menor (requiere Dashboard — `storage.objects` lo posee `supabase_storage_admin`, ni el MCP ni el rol `postgres` pueden tocarlo):** (a) **listado de buckets** — SQL listo en [`supabase/manual/harden-storage-listing.sql`](../supabase/manual/harden-storage-listing.sql), pegar en Dashboard → SQL Editor (scopea el SELECT/list al dueño; cierra la enumeración de user_ids vía `avatars`; el acceso público por URL no se ve afectado; hoy buckets vacíos → riesgo 0); (b) **Leaked Password Protection** (HaveIBeenPwned) en Dashboard → Auth → Providers → Password (toggle, 1 click). Ambos van en el mismo pase que el pentest/firma senior.
4. **Siguiente construcción:** **R4** (2º dominio real + Playbook de Nacimiento de Tenant) / **R5** (moonshots). Requiere decisiones de Geovanny §16. El "Asistente de Trámites" sigue vetado hasta abogado (UPL).
5. Deuda técnica menor: renombrar `middleware`→`proxy` (deprecación Next 16), E2E de mensajería (gate §5.4, hoy TTL 90d), CA cert para el enumerador en CI (`SUPABASE_DB_CA_CERT_PATH`). (Ya resueltos por la revisión integral: `metadataBase` en layout ✓, `lib/trust/signals` como fuente única ✓.)
6. **MCP de Meshy** — la key funciona, pero el server **no arranca en Windows**: `~/.claude.json` usa `"command": "npx"` y `npx` es un `.cmd` (`spawn ENOENT`). Fix de una línea (`cmd /c npx`) + reinicio, en [`docs/MESHY-MCP-SETUP.md`](MESHY-MCP-SETUP.md). Mientras tanto el pipeline de emblemas pega contra la REST API directo y es reproducible ([`assets-source/emblems/`](../assets-source/emblems/)).

## Cómo correr
```
npm run dev              # app en localhost:3000 (tenant dominicanos por default)
npm run build            # build producción (--webpack por Serwist)
npm run typecheck | test | lint
npm run check:rls        # gate RLS (RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1 en dev)
npm run db:migrate       # aplica migraciones nuevas de supabase/migrations/
npm run db:seed          # seed idempotente
```

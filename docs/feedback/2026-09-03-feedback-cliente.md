# Feedback del cliente 2026-09-03 — call de 78 min + WhatsApp de Nacho

> **Estado 2026-09-04:** implementado y desplegado en una sola tanda (12 frentes en paralelo). El detalle de qué quedó cómo, las decisiones que cambiaron sobre la marcha y lo pendiente están en `docs/PROGRESS.md`, sección "El feedback del cliente del 3/9".

**Fuentes:** (a) transcript de la call "Comunidad Latina - Insights" del 3/9
(78 min; el cliente aparece como "CL COM" y "Henry Sarmiento" — es Geovanny);
(b) 20 capturas del WhatsApp de Nacho a Manuel, 15:14–16:47, con el resumen
que Nacho fue escribiendo DURANTE la call; (c) 4 videos: uno es grabación de
pantalla del iPhone de Geovanny (Safari, 3:23 pm), los otros tres son el
celular filmando el monitor de Nacho; (d) 1 audio de Nacho (0:23) que no se
pudo transcribir — su contenido está repetido palabra por palabra en los cuatro
mensajes que lo siguen y en el transcript 21:00–23:44; (e) 3 fotos del monitor
a resolución completa.

**Cuando Nacho y el cliente dicen cosas distintas, manda el cliente.** Los
mensajes de WhatsApp son el resumen de Nacho en tiempo real; el transcript es
la voz del dueño del producto. Los tres casos donde difieren están marcados.

**Contexto de urgencia (1:16–1:18 del transcript):** el cliente está esperando
inversores y necesita "abrir la página y tirarla al mundo para que vean que
está funcionando". Preguntó dos veces "¿para cuándo terminamos?". Prioridad:
primero lo que rompe la experiencia en el celular, después los cambios de
alcance.

**Qué se verificó contra el código:** cada punto de abajo dice qué existe hoy
(archivo) y cuál es la causa probable cuando es un bug. Nada de lo que sigue
está inferido de la captura sola.

---

## Decisiones de producto que CAMBIAN lo escrito antes

1. **Videos largos: ahora SÍ hay sección.** El consolidado del 2026-07-30
   resolvió el conflicto a favor de la spec escrita ("los videos de más de 90 s
   viven dentro del anuncio, no hay sección tipo YouTube") y dejó la nota "si el
   cliente todavía la quiere, es una decisión de producto". El 3/9 el cliente la
   pidió de nuevo, explícita y dos veces (21:44–23:44 y 1:09–1:11): **sección
   "Videos largos" + botón "Ver video completo" al cortar en 59 s**. Decisión
   tomada. La regla de quién puede subir más de 90 s no cambia: solo una
   publicación paga (`video-policy.ts`: 300 s premium, 600 s publicidad).

2. **Tocar un video del feed SÍ lleva al scroll de Videos Cortos.** La memoria
   del 2026-08-04 dice "tocar una card nunca saca del feed" (pedido del cliente
   del 29/7, cuando el detalle "le bloqueó el video"). El 3/9 (17:23–18:20)
   pidió lo contrario para los videos: al tocar el post tiene que **sonar la
   música y poder scrollear a los otros videos cortos**. Hoy `card-video.tsx`
   abre un visor propio (`useMediaViewer`) en el que la música no suena y no
   hay scroll. No es un retroceso de la regla vieja: la queja del 29/7 era
   perder el video y el scroll del feed; la solución es un visor tipo reel que
   se abre ENCIMA del feed (música + scroll vertical) y al cerrar devuelve al
   mismo lugar. Fotos, texto y encuestas siguen resolviéndose en la card.

3. **"Ayuda mutua" se saca.** Módulo 0120 (`/comunidad/ayuda-mutua`, tablón
   "dar y pedir una mano"). Razón del cliente (38:30–41:00): "necesito manos"
   para mudanzas es responsabilidad legal de Comunidad Latina si alguien se
   lastima; además el flujo "Quiero ayudar → ¿sobre qué tema?" lo confundió.
   Nacho lo confirmó por WhatsApp (15:54: "no tiene mucho sentido, vamos a
   sacarlo"). Ver punto 8: el motor del tablón se reaprovecha, la tarjeta y el
   encuadre desaparecen.

---

## Bugs (lo que está roto, con causa)

### 1. Editor de fotos en el celular: emojis, recorte y texto — el gesto cierra la hoja

**Lo que dijo el cliente** (5:06–15:07, y video 3:23 pm): en la compu el emoji
se mueve y agranda; en el teléfono, "si lo mueves un poquitico, boom, se
regresa a la foto normal... se cierra todo, se va de nuevo al paso uno". El
recorte con los dedos tampoco anda ("ni con los dedos"). El texto "no se ve
bien, no sé ni lo que escribes". Nacho: "cuando quiero editar me saca", "el
espacio es muy chico para agregar cosas".

**Lo que muestra el video** (grabación real del iPhone): los 60 emojis SÍ se
renderizan (la tira aparece, buscador incluido — no es el bug de "no se ven"
que Nacho escribió a las 15:16; a las 15:18 lo corrigió: "todas las funciones
del celular"). Al tocar uno, aparece un sticker chico en el centro de la foto.
Al intentar arrastrarlo, el editor desaparece y vuelve el composer "Contá de
qué se trata". Lo mismo al arrastrar en Recortar; el slider de zoom sí
funciona (la foto se ve ampliada en un frame).

**Causa (alta confianza):** el editor vive DENTRO del `BottomSheet` del
composer (`photo-editor.tsx:87-94`: "un panel que reemplaza su contenido...
Escape/scrim/arrastre son un solo gesto"). Ese `BottomSheet`
(`src/components/ui/bottom-sheet.tsx:165-168`) tiene `drag="y"` de
framer-motion sobre TODO el panel con `onDragEnd` que cierra. El stage del
editor usa pointer events con `setPointerCapture` y `touch-none`, pero
`touch-action: none` frena el scroll del navegador, no el `drag` del padre:
en táctil, el mismo arrastre que mueve el sticker mueve la hoja, y al soltar
la hoja se cierra → "me saca al paso uno". En desktop no pasa porque el mouse
no dispara el drag de la hoja de la misma forma.

**Además:** el stage se dimensiona por `min()` de ancho dentro de una hoja
que ya gasta alto en título + tabs + tira de emojis + botones: en un iPhone
queda una foto de ~180 px de alto ("el espacio es muy chico"), y el sticker
por defecto es el 18 % del ancho del stage (`DEFAULT_STICKER_SIZE = 0.18`) →
diminuto. El texto sobre esa miniatura es ilegible.

**Fix:** (a) cortar la propagación del gesto: mientras el editor está
abierto, la hoja no arrastra (`drag={false}` o `onPointerDownCapture` +
`stopPropagation` en el stage); (b) en pantallas angostas el editor ocupa la
hoja entera (alto completo, stage a todo el ancho); (c) tamaño inicial del
sticker relativo a la foto real, no al stage chico; (d) verificar texto en
esa misma pantalla. Se prueba con emulación táctil (Browser pane, preset
mobile) y con el gesto de pellizco.

### 2. "Subir la foto" del negocio no hace nada

**Cliente** (58:11–59:10): "ahí no te dejó subir una foto"; Nacho 16:09: "el
botón de subir foto no funciona todavía".

**Causa:** `perfil/perfil-de-negocio.tsx:65` — el botón "Subir la foto" es un
`<Link>` a la página pública del negocio ("se sube desde la página del
negocio"), y en `negocios/[id]/page.tsx`, `negocios/presencia` y
`negocios/cuenta` **no existe ningún `<input type="file">`**. La subida de
logo nunca se construyó; el botón manda a un lugar donde no hay nada. Hay
que construirla (logo + foto de portada, solo para el dueño, con la misma
política de integridad de contenido que las fotos de posts).

### 3. Sin "volver atrás" en secciones y formularios

**Nacho** (video 4:06 pm y 57:28): en "Publicar un empleo" (wizard de 4 pasos)
no hay forma de volver; hay que tocar "Buscar" en la barra de abajo. "Siempre
que se quiera salir de cualquier cosa, como una vivienda o eventos, no puedo
volver para atrás". El cliente ya lo había dicho la vez anterior.

**Verificado:** el detalle de un aviso tiene `DetailTopBar` con
`router.back()`; las portadas de sección (Vivienda, Eventos, Empleos,
Negocios, Profesionales, Comunidad…) y TODOS los wizards de publicación no
tienen ningún botón de volver. En la app instalada (PWA, sin barra del
navegador) es un callejón. **Fix:** una barra superior con "Volver" en
portadas de sección y wizards, con `router.back()` y fallback a `/buscar`
cuando no hay historial (entrada directa).

### 4. Tocar un video del feed: sin música y sin scroll

Ver decisión de producto nº2. **Causa:** `card-video.tsx:397-431` — el visor
en el lugar reemplazó la navegación a `/videos?start=` (que sí es el reel con
scroll) para no perder el scroll del feed. El visor no monta el `<audio>` de
la música del post (`post-music.tsx` vive en la card, no en el visor). **Fix:**
el visor de video se convierte en reel (lista vertical, empieza en ese post,
con la música), overlay sobre el feed.

### 5. Videos Cortos tardan en cargar; al scrollear "salen en blanco"

**Cliente** (1:07:00) y Nacho (16:15). **Verificado:** `video-reels.tsx` no
tiene posters ni precarga del siguiente video; los `.mp4` se sirven crudos
desde el bucket de Supabase (hasta 60 MB cada uno, sin transcodificar). El
rectángulo blanco es el `<video>` sin poster esperando metadata. **Fix sin
Mux:** poster capturado en el navegador al subir (ya hay `measure-video.ts`
que lee el `<video>`), guardado como jpg junto al video; `preload="auto"` en
el activo y el siguiente; mantener montados activo ±1. **Fix de fondo:** Mux
(punto 13), que transcodifica a HLS y genera thumbnails.

### 6. No se puede subir un video de 1:29 (101 MB)

**Cliente** (21:20, video 3:29 pm): "este video es de 1:29 y me tiraron que es
de 100 y el máximo es 60". Manuel: "pensé que ya estaba eso".

**Verificado:** la duración SÍ está permitida (tope 90 s, `video-policy.ts`).
Lo que frena es el **peso**: `MAX_VIDEO_BYTES = 60 MB`
(`video-upload-limits.ts:101`) y el bucket tiene 80 MB
(`BUCKET_FILE_SIZE_LIMIT_BYTES`). Un video de 90 s de un iPhone en 1080p pesa
90–110 MB, así que el tope de 60 MB **contradice en la práctica** el de 90 s.
El código ya tiene el camino de Mux (0116: "cualquier formato, cualquier
tamaño", tope 5 GB, `services.ts:79`) pero está apagado: no hay
`MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` ni en `.env.local` ni en producción.
**Decisión:** subir el tope del bucket a 200 MB como parche inmediato (sin
Mux, un video crudo de 100 MB en el reel empeora el punto 5), y Mux como fix
real — INPUT PENDIENTE de Manuel (cuenta y costo, ver punto 13).

---

## Cambios de alcance (lo que el cliente quiere distinto)

### 7. Mensajes: buscador por persona + grupos tipo WhatsApp

**Cliente** (23:50–29:30): "yo te quiero mensajear a ti: busco Manuel Navarro
y te mando un mensaje directo". Hoy la bandeja lista una conversación POR
AVISO ("Sobre: Gorra bordada", "Sobre: Barbería El Nítido"), así la misma
persona aparece 4 veces y no hay dónde buscar (foto del monitor). Y grupos:
"en el contrato teníamos que ellos iban a hacer grupos" — grupos para que la
gente se junte por interés (ir en bici, esquiar, real estate,
emprendedores), crear o unirse, chatear adentro, "como hace WhatsApp al
momento de crear un grupo". Nacho mandó un mockup (15:52) con bandeja,
buscador, crear grupo (nombre, descripción, foto, público/privado), chat
1-a-1 y de grupo, info del grupo (miembros, admin, salir), tipos de grupo.
El cliente lo aprobó: "sería para los mensajes y los grupos, bien".

**Verificado:** `conversations` (0006) ya admite `listing_id null` (mensaje
directo desde el perfil), pero la bandeja no agrupa por persona ni busca. No
existe nada de grupos (cero referencias en `mensajes/` ni en migraciones).

**Alcance v1:** bandeja con buscador (personas de la comunidad → abre o crea
el directo; los hilos por aviso se agrupan bajo la persona y el aviso queda
como contexto del mensaje); grupos: crear (nombre, descripción, categoría,
público/privado), descubrir y unirse a los públicos, invitar por buscador a
los privados, chat, lista de miembros, salir, el creador administra (expulsar,
cerrar), reporte. Esquema nuevo con RLS + retención igual que `messages`.

### 8. Comunidad → "Pedir ayuda" pasa a ser un tablón donde la gente se responde

**Cliente** (30:58–41:00, con dos historias): el primo que necesitaba pasaporte
y lo consiguió porque alguien en un grupo de WhatsApp le pasó el número del
consulado; la silla de ruedas, la computadora para los hijos, la clase de OSHA
gratis, el abogado de inmigración barato. "Tiene que ser como un blog: la
gente pone lo que necesita y la gente le contesta; hay mucha gente que tiene
información y mucha que no". Explícito: es **información**, no mano de obra
("no vas a decir 'me estoy mudando, vengan a cargar muebles'").

**Verificado:** la tarjeta "Pedir ayuda" hoy lleva a `/comunidad/recursos`
("Dónde pedir ayuda", directorio por tema con fuente) que está vacío
("Todavía no hay recursos cargados"). El tablón de ayuda mutua (0120,
`community_help_notices`) ya tiene: avisos con título/cuerpo/zona, RLS por
tenant, moderación en `/admin/comunidad/ayuda-mutua`, "me gusta" (0124). Le
falta lo esencial para lo que pide el cliente: **respuestas**.

**Decisión:** la tarjeta "Pedir ayuda" pasa a un tablón público de pedidos
con respuestas, construido sobre el motor de 0120 (misma tabla, se saca el
`direction offer/need` del encuadre y se agrega tabla de respuestas con RLS y
moderación). La tarjeta "Ayuda mutua" desaparece. El directorio de recursos
sigue existiendo solo como destino de Bancos de comida / Voluntarios / Centro
de acopio (`?tema=`), y accesible desde Guías.

### 9. Voluntarios: registro (privado) + pedido de voluntarios (privado)

**Cliente** (39:20 y 45:40–47:50): "el voluntario tiene que poder registrarse,
pero esa lista no la ve nadie, solo la plataforma". Y quien necesita
voluntarios (un grupo chico, no hace falta ser empresa) llena un formulario;
**los voluntarios no responden "yo voy"**: Comunidad Latina revisa que sea
voluntariado real y no trabajo disfrazado ("no va a pedir voluntarios para
poner el sheetrock del baño"), y les avisa a los voluntarios de la zona. El
voluntario acepta una regla corta al registrarse "para que no haya compromiso
con Comunidad Latina".

**Hoy:** la tarjeta lista recursos (`?tema=voluntariado`), vacía. **Alcance:**
dos formularios (registrarme como voluntario: zona, disponibilidad, en qué
puedo ayudar, aceptación de reglas · necesito voluntarios: quién pide, para
qué, cuándo, dónde, cuántos) → dos listas SOLO en admin, con estado
(nuevo/contactado/descartado). El listado público de grupos de voluntarios
queda como está.

### 10. Centro de acopio y Bancos de comida

**Cliente** (39:30 y 45:20): "Centro de acopio igual: los negocios entran ahí,
debe haber una forma de registrarse". Bancos de comida: "está bien, ahí va el
listado de todos los bancos de comida del área de Nueva York; esa información
la sacamos de la alcaldía". ⚠️ Nacho escribió (15:48–15:49) "gente que quiere
un centro de acopio y gente que ofrezca / gente que quiera comida y gente que
ofrezca" — eso es su lectura, no lo que dijo el cliente. Manda el cliente.

**Alcance:** un formulario "Registrar mi lugar" (tipo: centro de acopio ·
banco de comida/comedor; negocio, dirección, horarios, qué reciben o dan) →
cola en admin; al aprobar se convierte en un `community_resource` y aparece
en el listado público del tema. Los bancos de comida de la ciudad los carga
el admin desde esa misma pantalla — INPUT PENDIENTE: la fuente de datos
(NYC Open Data / listado de la alcaldía) la define el cliente.

### 11. Nuevo: "Espacio comunitario" (donación de espacio)

**Cliente** (1:00:45–1:06:00): un botón más en Comunidad: negocios que prestan
una parte de su local (un sábado a la mañana, un warehouse vacío el domingo)
para clases de música para chicos, inglés para las madres, charlas de
inmigración. "Al principio no se van a registrar, pero por lo menos ya tenemos
el botón". Nacho 16:14 lo confirma.

**Alcance:** tarjeta nueva en la grilla de Comunidad + formulario (negocio,
dirección, descripción del espacio, capacidad, días y horarios disponibles,
para qué actividades) → lista SOLO en admin. Sin listado público.

### 12. Empleos: tres pestañas (Empleos · Ocasional · Servicios) y publicar "empleo / servicio"

**Cliente** (48:42–57:00): los chips "Tiempo completo / Medio tiempo /
Ocasional" no son la división que quiere. "Un empleo es full-time, part-time,
todo eso" → pestaña **Empleos** (restaurante busca cocinero y meseros).
**Ocasional** = trabajos cortos de uno o dos días ("gigs", como Craigslist:
"necesito un carpintero sábado y domingo"). **Servicios** = la gente OFRECE lo
que hace ("soy jardinero, disponible sábados y domingos"; "arreglo
computadoras"; "cambio la pantalla del celular"). Distinto de Profesionales,
que son "gente con licencia". Nacho propuso y el cliente aprobó ("excelente"):
en Publicar, arriba, elegir **Empleo o Servicio** y que el formulario cambie.
Nacho 16:05: "cuando se publique sea empleo/servicio".

**Verificado:** `listings.kind in ('property','business','professional',
'event','job')` (0004) y `employment_type` full_time/part_time/one_off. No hay
ningún lugar para publicar un servicio informal ("Servicio de creador" del
menú es otra cosa). **Alcance:** chips → Todos · Empleos (full+part, la
tarjeta conserva su etiqueta) · Ocasional (one_off) · Servicios; nuevo tipo
de aviso "servicio" dentro de Empleos con su formulario corto (qué hacés,
zona, disponibilidad, referencia de precio, contacto por mensajes); el wizard
arranca con el selector Empleo/Servicio; volver atrás (punto 3).

### 13. Videos largos: sección + "Ver video completo" a los 59 s

**Cliente** (19:40–23:44): quien paga publicidad puede subir hasta 5 minutos
(recorrer una propiedad). En el feed y en Videos Cortos se ven **59
segundos**; ahí se frena y aparece **"Ver video completo"**, que lleva a la
sección de **videos largos** donde se reproduce entero. Más adelante (fase 2)
ahí va publicidad tipo YouTube. Nacho (15:30–15:31): "sección de videos
largos, videos de más de 60 segundos; que aparezca un botón y los envíe a ese
lugar".

**Verificado:** la política ya existe en código (`FEED_PREVIEW_MAX_SECONDS =
59`, `PREMIUM_DETAIL_MAX_SECONDS = 300`, `ADVERTISING = 600`) y
`card-video.tsx` calcula un tope de reproducción (`viewerPlaybackCapFor`).
Falta la sección y el botón. **Alcance:** `/videos/largos` (lista de videos
de publicaciones pagas > 90 s, con reproductor completo) + al llegar al tope
en la card, en el reel y en el visor, botón "Ver video completo" que abre ese
video en la sección. Sin cambios en quién puede subir cuánto.

**INPUT PENDIENTE (Mux):** con el bucket crudo, un video de 5 minutos de
celular pesa 300–500 MB y no se reproduce bien en 4G. Subir el tope de tamaño
es un parche; la solución es Mux (código listo desde 0116, solo faltan las
credenciales). Manuel decide: crear la cuenta de Mux (plan pay-as-you-go,
~$0.005/min de streaming + encoding) o postergarlo.

### 14. Perfil de negocio: editar la info, servicios, y el encabezado

**Cliente** (59:00–1:00:30) y Nacho (16:08): usando la app como "Compañía de
construcción" falta poder editar la información del negocio, agregar la foto
(punto 2) y **los servicios que da**. Y arriba a la derecha, cuando estás como
negocio, "debería quedar solamente el nombre de la página", no el avatar de
Geovanny con el de la página encima.

**Verificado:** `identity-switcher.tsx` muestra el avatar personal con un
badge del negocio; la edición del negocio pasa por el flujo de listings
(`/publicar?kind=business`) que no está enlazado desde "Administrar tu cuenta
de negocio". **Alcance:** desde el perfil-como-negocio, "Editar la página"
(nombre, descripción, rubro, zona, horarios, teléfono, servicios que ofrece —
lista corta de chips/texto) + foto; y el encabezado muestra SOLO la identidad
activa (avatar/inicial y nombre del negocio) cuando se actúa como negocio.

### 15. Publicaciones de texto: la letra no se achica, y fondos más lindos

**Cliente** (1:07:33–1:08:57) y Nacho (16:17): "mientras más se escribe, se
van haciendo más pequeñas; parece que hay solo un espacio pequeño en el
centro de la tarjeta". Muestra un post traído de Instagram donde el texto
ocupa toda la tarjeta. "Que cada persona ponga el texto donde quiera". Y
fondos "de colores más llamativos, más bonitos, o que la gente los pueda
cambiar".

**Verificado:** `text-banner.tsx:145-154` baja de `text-3xl` a `text-xl`
según el largo y clampea líneas; el fondo sale de un hash del `postId`
(`VARIANTS`), no lo elige nadie. **Alcance:** tamaño de letra fijo y cómodo,
la tarjeta crece con el texto (con "ver más" pasado un umbral alto, no
achicando), texto a todo el ancho con padding; paleta de fondos (6–8
gradientes con carácter, dentro de la identidad de la marca — sin violeta
genérico) elegible en el composer y guardada en el post. El cuadro de
comentar "cuadriculado" el cliente lo dio por bueno (19:00) — no se toca.

---

## Fuera de alcance AHORA (el cliente lo dijo él mismo: fase 2)

- **Lives** (1:09:15): "nos cuesta mucho y no genera dinero todavía".
- **Marketplace de creadores tipo TikTok Shop** (1:09–1:13): marcas pagan por
  video + comisión, catálogo de marcas por perfil de creador, publicidad en
  videos largos. El módulo `creadores` ya existe como base; se amplía después.
- **"Tarjeta sorpresa"** (1:13:57–1:16:41): gift cards geolocalizadas cerca del
  negocio, se "explota" al tocar, QR para canjear, 30 días de validez.
- **Campañas de marca** con presupuesto que Comunidad Latina reparte entre
  creadores.

Nacho cerró: "enfoquémonos en lo de ahora y lo de la fase 2 lo hablamos cuando
terminemos".

## Lo que NO es de este proyecto

El segundo transcript (Irowing, Leo Pedrosa, 39 min) es la verificación de
Google Play y App Store Connect de Irowing y el pedido del coach por IA.
Único dato accionable: reunión Leo + Manu el **jueves 10/9 a las 6:00**.

---

## Orden de trabajo

| # | Frente | Tipo | Por qué en este orden |
|---|---|---|---|
| 1 | Editor de fotos en celular (punto 1) | bug | Es lo que el cliente probó en vivo y lo que abrió la call |
| 2 | Subir foto del negocio (2) + editar info y servicios (14) + encabezado (14) | bug + cambio | El botón manda a la nada; es visible en cada perfil de negocio |
| 3 | Volver atrás en secciones y wizards (3) | bug | Callejón sin salida en la app instalada; lo pidió dos veces |
| 4 | Video del feed → reel con música y scroll (4) + posters y precarga (5) + tope de peso (6) | bug | Los videos son el centro del producto; hoy fallan en tres lugares |
| 5 | Texto sin achicar + fondos (15) | cambio | Chico y visible; lo mostró con un ejemplo concreto |
| 6 | Empleos: pestañas, servicios, selector empleo/servicio (12) | cambio | Cambia el modelo (nuevo tipo de aviso) — más que un rename |
| 7 | Comunidad: tablón "Pedir ayuda" con respuestas, sacar Ayuda mutua (8) | cambio | Reaprovecha 0120; es el corazón de lo que el cliente describió con dos historias |
| 8 | Comunidad: formularios (voluntarios ×2, registrar lugar, espacio comunitario) + admin (9, 10, 11) | feature | Cuatro formularios con la misma forma; las listas viven en admin |
| 9 | Videos largos: sección + "Ver video completo" (13) | feature | Depende del parche de peso; Mux mejora pero no bloquea |
| 10 | Mensajes: buscador por persona + grupos (7) | feature | El más grande; esquema nuevo con RLS |

## Inputs pendientes de Manuel / Nacho

1. **Mux** (punto 13): ¿creamos la cuenta? Sin eso, el tope queda en un parche
   de tamaño y los videos largos de celular van a cargar lento.
2. **Bancos de comida** (punto 10): de dónde se toma el listado oficial de NYC.
3. **Servicios vs Profesionales** (punto 12): confirmar con el cliente que un
   "servicio" es un aviso simple sin verificación de licencia (así lo describió).

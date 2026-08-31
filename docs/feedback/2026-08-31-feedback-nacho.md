# Feedback de Nacho — 2026-08-31

Fuente: capturas de WhatsApp (conversación del miércoles 27/8 + mensajes de hoy 31/8).
Transcripción fiel de los pedidos, agrupada por bloque. **Este documento es la fuente de
verdad para la ronda de trabajo.** Cada ítem tiene ID estable — usarlo en commits y PRs.

Estado: `FALTA` · `PARCIAL` · `HECHO` · `DECISIÓN` (requiere definición de negocio, no se
construye a ciegas).

---

## A · Ubicación

| ID | Pedido textual | Lectura |
|---|---|---|
| **A1** | "En la ubicación, hace falta el compartir la ubicación - my location" | Botón de geolocalización del navegador para fijar la ubicación real del usuario. |
| **A2** | "en my location un botón al lado donde se puede filtrar por la cantidad de millas a la redonda que la persona le gustaría ver - como standard ponemos un mínimo de 25 millas a la redonda" | Filtro de radio en **millas**, default **25**. Va al lado del selector de ubicación, en el buscador. |

---

## B · Comunidad y pedidos de ayuda

| ID | Pedido textual | Lectura |
|---|---|---|
| **B1** | "Falta un botón en la parte de comunidad / en casi todas las opciones para que la gente pueda aplicar a bancos de comida si quiere ofrecer servicios - voluntarios si quieren ofrecer sus servicios - centro de acopio lo mismo. Tanto de parte de la persona que quiere prestar sus servicios o el lugar donde necesita prestar los servicios" | **Dos lados** en cada recurso comunitario: *ofrezco ayuda* / *necesito ayuda*. Aplica a bancos de comida, voluntariado, centros de acopio. |
| **B2** | "Y todo esto se verifica vía Geovanny con la cuenta de admin" | Toda solicitud pasa por cola de aprobación del admin antes de publicarse. |
| **B3** | "En la parte de pedir ayuda, es una opción para ayudar a las personas con drogas, alcohol, medicinas, etc" | Categoría de ayuda en adicciones y salud. Tema sensible: el copy no puede prometer tratamiento ni dar consejo médico; deriva a recursos. |
| **B4** | "También ayuda comunitaria como iglesias, personal, o algo específico" | Categoría de ayuda comunitaria (iglesias, apoyo personal, pedido específico). |
| **B5** | "Conseguir trabajos" | Categoría de ayuda para conseguir trabajo. |
| **B6** | "Monetariamente no se ayuda" | **Regla dura del producto**: no se puede pedir plata. Necesita guardrail real (no solo un cartel): validación en servidor + moderación. |

---

## C · Perfiles, verificación y pagos

| ID | Pedido textual | Lectura |
|---|---|---|
| **C1** | "Para vender dentro de la plataforma, tenés que estar verificado sí o sí" | Gate **server-side** para publicar en marketplace. Esconder el botón no alcanza. |
| **C2** | "Ser negocio, empleado, creador de contenido" | Los tres tipos de perfil vendedor. |
| **C3** | "Cuando se publica con otro perfil, sacar la parte de 'por Geovanny'" | Al publicar como negocio, la card no muestra el nombre de la persona detrás. |
| **C4** | "Falta agregar otro negocio, ya que la persona puede crear hasta 10 perfiles diferentes" | Alta de negocio adicional, tope 10. *(La captura sugiere que ya existe — verificar.)* |
| **C5** | "Y según cada perfil, debería de hacerse la verificación de Stripe si quieren abrir negocios/empleos/creador" | Verificación **por perfil**, no solo por usuario. |
| **C6** | "¿La verificación de Stripe sale plata? Porque Geovanny me dice que sale $2. Y si sale gratis, no se pueden verificar gratis. Solamente la verificación es gratis para voluntarios, que lo paga Comunidad Latina" | **DECISIÓN de negocio.** Implica cobrar la verificación, con excepción gratuita para voluntarios costeada por CL. No se construye sin confirmación de Manuel. |

---

## D · Música en publicaciones

| ID | Pedido textual | Lectura |
|---|---|---|
| **D1** | "Cuando se publica con música, no se escucha la música" | **Bug.** El catálogo existe y la canción se elige, pero no suena. |
| **D2** | "Si la canción es más de 30 segundos, la persona tiene que elegir cuánto quiere escuchar de la canción, como Instagram" | Selector de fragmento (trimmer) para pistas de más de 30s. |

---

## E · Editor de fotos al publicar

| ID | Pedido textual |
|---|---|
| **E1** | "para publicar una foto falta el editor - medio que sería un crop para las fotos" |
| **E2** | "unos filtros" |
| **E3** | "agregar la chance de ponerle texto a las fotos por encima, sería como un editor" |
| **E4** | "Y agregar emojis también" |
| **E5** | "Los textos que se agregan pueden cambiar de colores, tipografía, etc" |

Un editor de imagen en el composer: recortar, filtros, texto y emojis encima, con control
de color y tipografía del texto.

---

## F · Boost

| ID | Pedido textual | Lectura |
|---|---|---|
| **F1** | "Boost - cuando la gente quiera promocionar, la persona que pague el boost dependiendo la zona les aparece el local/artículo/o lo que estés promocionando" | **Targeting geográfico** del impulso: el contenido pagado se muestra a la gente de la zona elegida. |

---

## G · Chips de categoría

| ID | Pedido textual | Lectura |
|---|---|---|
| **G1** | "Que tengan las mismas funciones que en el buscador" *(sobre los chips Todo / Vivienda / Eventos / Negocios / Profesionales / Empleos en "Tu comunidad")* | Paridad funcional entre los chips del home y el buscador. |

---

## H · Videos e imágenes

| ID | Pedido textual | Lectura |
|---|---|---|
| **H1** | "Que sea solo videos" *(sobre la pestaña Videos Cortos)* | La pestaña no debe mezclar contenido que no sea video. |
| **H2** | "El mismo problema con los videos grandes o el tipo de formato de video pasa con las imágenes" | **Bug.** Falla la subida por tamaño o por formato, en video y en imagen. |

---

## I · Performance

| ID | Pedido textual | Lectura |
|---|---|---|
| **I1** | "los videos/post en el feed principal tardan en cargar cuando se baja viendo los post viejos y demás" | Degradación al paginar hacia atrás en el feed. |

---

## J · Diseño de las publicaciones

| ID | Pedido textual | Lectura |
|---|---|---|
| **J1** | "agregar un poco más de color a los post" *(referencia: barra de reacciones a color de Facebook)* | Las cards se ven monocromas. Sumar color con criterio — sin copiar Facebook ni caer en genérico. |
| **J2** | "cuando se haga un posting agregar esto" *(circula: Me gusta · Comentar · Compartir · Guardar + "Ver detalles")* | Barra de acciones completa también en las cards de listing. |

---

## K · Emojis de Comunidad Latina

| ID | Pedido textual | Lectura |
|---|---|---|
| **K1** | "¿Se podrían agregar estos emojis?" *(2 packs de 30 emojis custom cada uno)* | 60 emojis con identidad latina (KLK, Chévere, Bacán, De una, Qué lo qué, Parranda…). Los assets los manda el cliente. |

---

## L · Empleos

| ID | Pedido textual | Lectura |
|---|---|---|
| **L1** | "agregar trabajos cortos, donde entra la categoría de trabajos por una vez como por ejemplo ir a cortar el pasto el fin de semana" | Nueva categoría de changas / trabajo por única vez, junto a tiempo completo y medio tiempo. |

---

## M · Pantallas rotas

| ID | Pedido textual | Lectura |
|---|---|---|
| **M1** | "intentar de arreglar eso" *(screenshot de "Tus negocios")* | Layout y jerarquía visual de `/negocios/cuenta`. |
| **N1** | "y esto" *(screenshot de "Elegí cómo usás la app")* | La comparativa de planes queda ilegible: columnas demasiado angostas. |

---

## Reglas vigentes que NO se rompen

Decisiones ya tomadas en sesiones anteriores. Si un pedido las contradice, se resuelve
explícitamente antes de codear — no se rompen en silencio.

1. **Tocar una card nunca navega fuera del feed.** Las cards abren hojas, no páginas.
   → Tensión con **J2** ("Ver detalles"): resolver.
2. **"Ver perfil" vive en la hoja del Trust Score**, no en el nombre del autor.
3. **Anti-honeypot**: sin teléfono en claro, geo aproximada, verificación como flag
   booleano, TTLs activos. → Tensión con **A1/A2** (ubicación precisa): el radio se
   resuelve en servidor; la coordenada exacta del usuario no se persiste ni se expone.
4. **Nada de consejo legal ni médico.** → Aplica a **B3**.
5. **Todo gate de permiso se verifica en el servidor.** → Aplica a **C1**.

---

# Estado auditado — 2026-08-31

Resultado de auditar el código real, ítem por ítem. Cuatro auditorías independientes
sobre geo/comunidad/empleos, media, perfiles/pagos y feed/performance.

## Ya estaba hecho — no requiere trabajo

| ID | Hallazgo |
|---|---|
| **D2** | Trimmer de música **completo**: slider real con preview sincronizado, `post_music.start_seconds`, clamp de 30s compartido cliente/servidor. Sin waveform, pero funcionalmente equivalente a Instagram. |
| **E2** | Filtros de foto **completos**: catálogo de presets CSS con intensidad interpolable, y se hornean de verdad en canvas al publicar. |
| **E3** | Texto sobre la foto **completo**: 3 posiciones, 2 fondos, quemado en píxeles (no es capa CSS suelta). |
| **H1** | "Videos Cortos" ya filtra sólo videos, con **doble control**: `.eq("video_type","short_video")` + `.eq("eligible_for_short_feed",true)` en la query, más un chequeo en memoria que exige media de video real. |
| **F1** | Boost geográfico **implementado a fondo**, en dos mecanismos: `boosts.scope/scope_area/scope_country` para fichas y `post_promotions.audience` para posts. Se filtra por espectador en el servidor. Incluso hay recargo de precio por alcance. |
| **C6** | La verificación **ya es gratis para el usuario**: se crea una `VerificationSession`, nunca un cobro. El costo (~USD 1,50 según el propio código) lo paga la plataforma, no la persona. |

## Bugs con causa raíz identificada

| ID | Causa raíz |
|---|---|
| **D1** | El único `<audio>` del repo vive **dentro de `CardVideo`**. La rama de foto del carrusel no recibe la música ni monta reproductor. Como el composer permite adjuntar música a un carrusel de **solo fotos**, ese post muestra la insignia "♪" y es **mudo siempre**. No es autoplay policy. |
| **H2** | **Video ya está resuelto** (acepta `.mov`, 60 MB directo / 5 GB por Mux, con errores accionables). **El bug vive en imagen**: `PHOTO_TYPES` no incluye `image/heic`/`image/heif`, el formato nativo del iPhone — el mismo bug del `.mov` que arreglaron en video y nunca replicaron a fotos. El rechazo además es un toast genérico que no explica cómo resolverlo. |
| **I1** | Tres causas. (1) **`FeedList` acumula todos los batches para siempre**, sin virtualización ni poda: a 10 páginas hay ~80 cards montadas con ~160 `IntersectionObserver` vivos — esto explica la degradación progresiva. (2) **~11 round-trips HTTP por página** (2 RPC + hasta 9 queries), sin cache entre páginas. (3) El video **legacy** pide `preload="metadata"` sin esperar visibilidad (Mux sí está bien gateado). La paginación es keyset, así que **no** se degrada por profundidad de query. |
| **M1** | Caja dentro de caja (banner de estado suelto dentro de un `BezelCard` que ya tiene bisel y padding), sin jerarquía de escala (tres textos casi del mismo tamaño), y dos bloques de color similar apilados sin aire. |
| **N1** | El grid **sí tiene breakpoints**; el problema es otro. El shell capa el contenido a `max-w-lg` (512 px) **siempre**, incluso en desktop. En viewport ancho se activa `lg:grid-cols-3` y reparte ~480 px en 3 columnas de ~152 px; descontando padding quedan ~120 px de texto. Choque entre un shell de ancho fijo y un grid pensado para viewport. |

## Falta construir

| ID | Estado | Nota |
|---|---|---|
| **A1** | FALTA | 🔴 Bloqueador previo: `next.config.ts` manda `Permissions-Policy: geolocation=()` sobre todo el sitio. Sin cambiar eso, ningún botón de ubicación funciona. |
| **A2** | FALTA | No hay lat/lng en el esquema, por diseño anti-honeypot. `geo_zone` es un geohash de ~4,9 km sin consumidores. Se resuelve con centroides de barrio. |
| **B1–B6** | FALTA | `community_resources` es un directorio de **lectura** curado por admins; ningún usuario escribe ahí. No existe nada de adicciones/iglesias/trabajo, ni guardrail de dinero. |
| **E1** | FALTA | Hay crop, pero **sólo para el avatar** (`src/lib/media/avatar-crop.ts`), sin conectar al composer. |
| **E4 / E5** | FALTA | El editor de foto no tiene emojis ni control de color/tipografía del texto. |
| **G1** | PARCIAL | Los chips filtran el feed por una sola dimensión; el módulo dedicado tiene precio, ambientes, operación, texto y orden. |
| **J1** | PARCIAL | La barra de acciones es gris en reposo; el color sólo aparece tras interactuar. Existe una paleta de acentos por vertical **ya usada en la misma card** pero no en la barra. |
| **J2** | PARCIAL | La card de listing sólo tiene "Ver detalles". Guardar y Comentar ya tienen backend listo; Compartir es reusable; **Me gusta no tiene contador para listings**. |
| **K1** | FALTA | No hay sistema de emojis custom. Buena noticia: `reactions.kind` es `text` **sin CHECK**, así que admite valores nuevos sin migrar esquema. Faltan los assets del cliente. |
| **L1** | FALTA | Trivial: `EMPLOYMENT_TYPES` tiene sólo `full_time`/`part_time`, y vive en jsonb sin CHECK — no necesita migración. |
| **C1** | PARCIAL | ⚠️ El gate existe como server action **sólo en marketplace**. Alquileres y empleos **no tienen ningún gate**, ni server action ni RLS. La policy que lo activaría está escrita pero sin aplicar. |
| **C2 / C4** | FALTA | ⚠️ Hoy hay un **unique index que permite 1 solo negocio por persona**. El pedido es 10. La captura del cliente con dos negocios y "te quedan 8 de 10" **no es reproducible con este código**. |
| **C3** | — | Se muestra hoy. Auditado: no hay ninguna justificación de transparencia documentada. Se puede quitar. |
| **C5b** | PARCIAL | Verificar identidad personal **no** verifica ningún negocio: son dos flags en tablas distintas. Existe una tabla `business_verifications` diseñada justo para esto, pero está **inerte** (RLS bloquea toda escritura, cero uso en la app). |

## Para conversar con el cliente

- **C6** — Nacho mezcla dos cosas: lo que Stripe le cobra a Comunidad Latina (primeras 50 verificaciones gratis, después por verificación) y lo que Comunidad Latina le cobra al usuario (hoy **$0**). Verificar gratis ya funciona y no depende de que Stripe sea gratis.
- **C2/C4** — la pantalla que mandó no corresponde a esta versión del código. Conviene confirmar qué build estuvo mirando antes de dar por buena la comparación.
- **K1** — hacen falta los 60 assets individuales; las capturas de los packs no sirven como archivos.

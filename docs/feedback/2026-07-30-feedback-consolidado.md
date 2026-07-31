# Feedback consolidado 2026-07-30 — 7 specs escritas + call de 85 min

**Fuentes:** (a) mail de Manuel del 30/7 17:44 con los 7 documentos que redactó
Nacho a partir de las notas de Geovanny; (b) transcript de la call del 29/7
(84 min, Fathom `765883869`).

Este documento es **el contrato**: lo que se construyó, con qué criterio, y lo
que quedó afuera **con su razón**. Si un agente necesita desviarse, lo escribe
acá. Las decisiones de alcance las tomó el orquestador y están marcadas
`FUERA DE ALCANCE` con motivo — no son olvidos.

---

## Conflictos entre las dos fuentes (resueltos)

1. **Videos largos.** El transcript (1:20) dice que debería existir "otra
   sección donde están solo los videos largos, como YouTube, con publicidad
   entre medio". La spec escrita nº4 (posterior, y mucho más explícita) dice lo
   contrario: **los únicos videos de más de 90 s son los de una publicidad
   pagada, y viven dentro del anuncio**. → **Gana la spec escrita.** La
   sección tipo YouTube no se construye. Nota para Nacho: si el cliente todavía
   la quiere, es una decisión de producto, no un detalle de implementación.

2. **Buscar = catálogo vs. buscador.** En la call del 27/7 el cliente pidió que
   `/buscar` mostrara **categorías**, no una caja de texto. En la call del 29/7
   (9:20–10:00) y en la spec nº1 pide **las dos cosas**: la barra arriba
   siempre visible + los accesos a los módulos debajo. → Se implementa la
   versión de la spec nº1, que es un superconjunto: la grilla de categorías que
   ya existe **no se toca**, y la barra se le suma arriba.

3. **Duración del video en publicación gratuita.** Spec nº3 dice "1 video de
   hasta 59 segundos" para gratis y "hasta 5 minutos" para premium; spec nº4
   dice "90 segundos" como tope orgánico universal y 10 min sólo en anuncios
   pagos. → Se toma **90 s como tope del feed orgánico** (spec nº4, es la regla
   técnica) y **5 min como tope de la publicación premium reproducida dentro
   del detalle**, con vista previa de 59 s en el feed (spec nº3). Los dos
   límites conviven porque aplican a superficies distintas; está codificado en
   un solo lugar (`src/lib/media/video-policy.ts`) para que no se separen.

---

## 1 · Búsqueda

**Construido**

- `/buscar` conserva su grilla de módulos y estrena arriba una **barra
  persistente** ("Buscar personas, negocios, propiedades, eventos y más…").
- **Búsqueda global mientras se escribe** (debounce 250 ms, sin botón), con
  resultados **agrupados por tipo** y un "Ver todas las X" por grupo que lleva
  al buscador del módulo con el término ya cargado.
- Entidades cubiertas: Personas · Propiedades · Negocios · Profesionales ·
  Eventos · Empleos · Marketplace · Videos Cortos · Publicaciones.
- **Historial de búsquedas** local (últimas 8) con opción de borrar, visible
  sólo con la barra vacía.
- **Sugerencias** derivadas de datos reales (nombres de ciudad/categoría que
  matchean el prefijo) + el historial. No hay ranking de "términos populares":
  no hay volumen para calcularlo todavía.
- **Buscadores propios por módulo** donde faltaban: Eventos, Negocios,
  Colaboraciones. Los que ya tenían (Propiedades, Marketplace, Profesionales,
  Empleos) no se tocaron salvo para unificar el copy del placeholder.

**Criterio.** La búsqueda global corre por una RPC (`global_search`) y no por
7 queries desde el cliente: una sola ida, un solo lugar donde se aplica el
tenant, y ordenamiento comparable entre tipos. Respeta RLS — la RPC es
`security invoker`, así que un resultado que la persona no puede ver no
aparece, sin que haya que acordarse de filtrarlo en la UI.

**FUERA DE ALCANCE** — búsqueda geográfica "cerca de mí" con radio real
(necesita geocodificación de los avisos, hoy la ubicación es texto libre) y
autocompletado con aprendizaje de historial global.

---

## 2 · Notificaciones

**Construido**

- **Categorías reales** en la base (`notifications.category`, 13 valores) +
  **prioridad** (`low | normal | high | critical`), con backfill de todo lo
  existente por `kind`.
- Pantalla con **pestañas y contadores** (Todas · Social · Mensajes · Trabajos ·
  Marketplace · Propiedades · Más), scroll horizontal en móvil, y el resto de
  las categorías dentro de "Más".
- **Agrupación por tiempo** (Nuevas · Hoy · Ayer · Esta semana · Anteriores).
- **Acciones por notificación**: marcar leída / no leída / eliminar. Las
  categorías críticas (seguridad, pagos, cuenta) **no se pueden silenciar** —
  el interruptor no existe, no está deshabilitado con un cartel.
- **Marcar todas como leídas** + filtro "No leídas".
- **Pantalla de configuración** (`/ajustes/notificaciones`): por categoría,
  qué canal recibir (en la app / email) y frecuencia (todas / sólo importantes
  / desactivadas).
- **Agrupación de interacciones similares**: "María, José y 18 personas más
  indicaron que les gusta tu video" en vez de 20 filas.

**FUERA DE ALCANCE, con razón**

- **Push al teléfono** — requiere claves VAPID y una tabla de suscripciones;
  las preferencias ya guardan el canal `push` para que cuando existan las
  claves sea cablear y no rediseñar. Gate manual (ver resumen final).
- **SMS** — necesita proveedor (Twilio) y presupuesto por mensaje; no hay
  cuenta.
- **Resumen diario por email** — la preferencia existe y se guarda; el cron que
  lo envía queda pendiente porque depende de Resend con dominio verificado.
- **Bandeja separada de administración** — valor bajo hoy (el panel de admin ya
  muestra su cola); se anota para cuando haya más de un moderador.

---

## 3 · Publicaciones, contacto, promoción y monetización

**Construido**

- **Vista previa antes de publicar** en los 7 módulos, con "Editar" y
  "Publicar".
- Al terminar de publicar, la pantalla de éxito ofrece **"Impulsar"** y
  **"Crear campaña"** además de "Ver publicación" — el pedido literal de la
  call (1:00:07): *"cuando dice publicar aviso, debería haber un botón acá y
  otro acá… crear campaña o impulsar este anuncio"*. Y el aviso ya publicado
  conserva "Impulsar este aviso" en su detalle, que ya existía y gustó.
- **Gratis vs Premium** codificado en un solo lugar
  (`src/lib/monetization/tier.ts`): 5 fotos y 59 s de video contra 20 fotos y
  5 min; los botones de acción externos (Llamar, WhatsApp, Sitio web, Cómo
  llegar, Comprar, Comprar boletos, Reservar cita) **sólo existen en premium**;
  en gratis el único contacto es el **Chat de Comunidad Latina**.
- **Los botones por módulo** son los de la spec, no una lista genérica:
  Propiedades (Llamar · WhatsApp · Cómo llegar), Eventos (Comprar boletos ·
  Cómo llegar), Marketplace (Comprar · Sitio web), Negocios (Llamar · WhatsApp ·
  Sitio web · Cómo llegar), Profesionales (Reservar cita · Llamar · WhatsApp).
  Todos con el chat interno al lado.
- **El chat abre con la tarjeta del aviso arriba**, para que las dos partes
  sepan de qué anuncio hablan.
- **Estadísticas en dos niveles**: la gratuita muestra vistas, me gusta,
  comentarios, compartidos y chats recibidos; la premium suma clics por cada
  botón de acción, alcance, y resultados del boost.
- **"Promocionar"** abre exactamente dos caminos: **Boost** (Local / Nacional /
  Global × 7 o 30 días) y **Campaña** (objetivo, presupuesto, duración, países,
  ciudades, edad, idiomas, intereses).

**Criterio.** El límite de fotos y de duración se valida **en el servidor**, no
sólo en el formulario: el tope de la publicación gratuita es la diferencia que
se cobra, y un tope que sólo vive en el cliente no es un tope.

**FUERA DE ALCANCE** — el **motor de entrega** de campañas (segmentar la
audiencia y decidir a quién se le muestra) queda en el ranking del boost que ya
existe; la campaña guarda su configuración completa y la muestra, pero no hay
ad server. Construirlo es un proyecto propio. Los **cobros reales** siguen
dependiendo de credenciales de Stripe (degradación elegante ya implementada:
el botón nunca rompe, abre "muy pronto").

---

## 4 · Videos Cortos

**Construido**

- El módulo se llama **"Videos Cortos"** en menú, bottom nav, `/buscar` y
  títulos.
- **Tope de 90 s** para todo video orgánico, validado en el navegador (metadata
  del archivo, antes de subir) **y** en el servidor. El mensaje es el de la
  spec, palabra por palabra.
- **Menú de categorías al entrar** a Videos Cortos (pedido de la call, 1:20):
  antes arrancaba a reproducir de una. Ahora se elige antes.
- **Dos tipos de video en la base**: `short_video` (≤90 s, elegible para el
  scroll) y `advertising_video` (≤10 min, atado a una campaña, **nunca**
  elegible para el scroll). Las columnas son las de la spec: `video_type`,
  `duration_seconds`, `is_paid_ad`, `eligible_for_short_feed`.
- **El video largo de un anuncio se reproduce dentro del anuncio y vuelve al
  anuncio** — al cerrar, la posición del feed se conserva y nunca cae en el
  scroll de Videos Cortos.
- Los videos publicitarios **sí aparecen en búsqueda**, marcados
  "Patrocinado".

---

## 5 · Empleos — flujo de reclutamiento completo

**Construido**

- **Aplicar** deja de ser un contacto suelto: mensaje de presentación,
  **currículum adjunto** (PDF o Word, ≤5 MB), enlaces de portafolio, y las
  preguntas que configuró quien publica (esto último ya existía).
- **"Mis aplicaciones"** para el candidato, con los estados de la spec
  (enviada · en revisión · entrevista · contratado · no seleccionado · vacante
  cerrada) y la opción de **retirar** la postulación.
- **"Candidatos"** para quien publicó el aviso: foto, nombre, Trust Score,
  ciudad, fecha, respuestas, currículum, portafolio y mensaje; con acciones
  **ver perfil, enviar mensaje, marcar contratado, marcar rechazado, guardar**.
- **Notificaciones automáticas** en cada transición, para las dos partes.
- **Autocompletado desde el perfil** (nombre, foto, ciudad, idiomas, Trust
  Score) con opción de no compartirlo.

**FUERA DE ALCANCE** — programación de entrevistas por videollamada: la propia
spec la manda a "futuras versiones".

---

## 6 · Creator Marketplace y Colaboraciones

**Construido**

- La tercera pestaña **"Contratos" pasa a llamarse "Colaboraciones"** (pedido
  textual).
- **Requisitos para recibir trabajos** visibles y calculados con datos reales
  (seguidores, videos publicados, vistas acumuladas, antigüedad, Creator
  Score): el creador ve cuánto le falta en vez de un "no calificás" mudo.
- **Bloqueo de datos de contacto** en la negociación: teléfonos, correos,
  enlaces y usuarios de redes se bloquean antes de enviarse — es lo que evita
  que el acuerdo se cierre afuera.
- **Audiencia en redes** se muestra como número, **sin enlace y sin clic**,
  como pide la spec.

**FUERA DE ALCANCE — el más grande de todo el lote, y es deliberado**

**Stripe Connect: escrow, KYC, liberación de pago y comisión.** Hoy no existe
una sola línea de Connect en el repo (está documentado desde el handoff del
22/7). Es una integración de pagos de punta a punta con obligaciones
regulatorias: verificación de identidad de cada creador, cuenta bancaria,
retención de fondos de terceros, disputas y reportes fiscales. No es algo que
se pueda dejar "a medias" y menos sin el pentest firmado que el propio plan
maestro exige antes de cualquier dato real. **Además el cliente mismo dijo en
la call (1:10) que el Creator Marketplace abre en 3-4 meses y que el módulo va
a estar apagado hasta entonces.** El contrato digital y el flujo de propuesta
quedan como están (ya existían); el dinero es el próximo ciclo.

---

## 7 · Marketplace de tiendas

**Construido**

- **Política de productos prohibidos** como página legal propia
  (`/legal/marketplace`), redactada sobre el texto del cliente pero pasada por
  criterio editorial, y enlazada desde la publicación de productos y desde el
  reporte.
- **Motivos de reporte** alineados con la política (producto falso, robado,
  fraude, publicidad engañosa, artículo prohibido, propiedad intelectual).
- **Membresía de tienda de USD 10/mes** — plan, estado y vencimiento en la
  base, checkout por el mismo camino de Stripe que ya existe (degradado
  mientras no haya credenciales), y la tienda se apaga sola al vencer.
- **"Comprar" lleva al checkout externo** del negocio: Comunidad Latina no
  procesa el pago, y el copy lo dice.

**FUERA DE ALCANCE** — el "precio fundador de por vida" y el aumento
escalonado para tiendas nuevas: es una decisión comercial que todavía no está
tomada (el propio texto dice "más adelante").

---

## 8 · Pedidos de la call que no entran en ninguna spec

**Construido**

- **Fondo crema en vez de blanco** — *"blanco con blanco no notamos nada"*. El
  lienzo pasa a un crema muy bajo y las tarjetas quedan blancas: las cajas se
  despegan. Verificado que el contraste de texto sigue cumpliendo en los dos
  temas.
- **El "+" con los colores de Comunidad Latina en pastel** (amarillo, azul,
  rojo), *"que no sea tan chillón"*.
- **Perfil completo**: seguidores (faltaban), "miembro desde", **compartir
  perfil**, y pestañas Publicaciones · Fotos · Videos · Información · Reseñas ·
  Seguidores · Siguiendo.
- **"Ver perfil" en los avisos** — *"si quieres ver el perfil de la gente que
  está posteando, para ver si es una gente confiable"*.

> **Corrección del 31/7 — esta sección decía de más.** Dos cosas quedaron
> anotadas acá como construidas y **no lo están**, y lo detectó la revisión, no
> yo:
>
> 1. **Los controles de privacidad del perfil no existen.** No hay columnas en
>    `profiles`, no hay pantalla, y no hay una sola cadena de UI de "quién puede
>    seguirte / escribirte / comentarte / etiquetarte". El agente que tenía ese
>    frente se quedó sin sesión justo antes de ese punto. El componente que los
>    consumiría ya está listo y documentado (`profileVisible` en
>    `publisher-trust.tsx`, modelado como VETO con default visible), así que
>    cuando existan las columnas se cablea en un solo lugar — pero **hoy nadie
>    puede desactivar que se vea su perfil desde su aviso**.
> 2. **"Ver perfil" llega a 11 de sus 19 puntos de montaje.** Está en los 8
>    detalles, el reel, la tarjeta del feed y la de colaboraciones; **falta** en
>    las tarjetas de listado, evento, profesional, comentario y candidato. No es
>    un olvido de props: esos modelos no traen el id de quien publica, así que
>    hay que tocar sus consultas.
- **Tarjetas del mismo tamaño en todos los módulos** — sólo los videos
  conservan su proporción vertical.
- **Las burbujas de módulos del feed** ahora incluyen Marketplace y
  Colaboraciones, igual que `/buscar`.
- **Publicar el título correcto por módulo** — publicar un evento decía
  "publicar aviso".
- **Al publicar: elegir audiencia** (público / seguidores / sólo yo) y **quién
  puede comentar**.
- **Etiquetar personas y ubicación** en una publicación.
- **Ver el perfil del negocio completo** desde su tarjeta.

**FUERA DE ALCANCE, con razón**

- **Editor de fotos** (texto encima de la imagen, emojis pegados, filtros,
  música de fondo con IA): es un editor de medios completo — canvas,
  exportación, y en el caso del audio una biblioteca musical con derechos. Es
  un proyecto propio, no un detalle del composer. Se anota como pedido vivo.
- **Historias** — el cliente mismo dijo (10:20) que quedaron fuera del
  contrato.
- **Transporte / taxis y alquiler temporal tipo Airbnb** — el cliente los
  planteó explícitamente como ideas a futuro ("eso lo vemos más adelante").
- **Sección de videos largos tipo YouTube con publicidad entre medio** — ver
  el conflicto nº1 arriba.

# Plan — Loom de Nacho + spec de módulos (2026-08-24)

Anclado en disco a propósito: el chat se pierde, esto no.

## Punto de partida verificado

- Producción corre `7fafc69` (deploy del 22-ago), que **es** `developers-insights/main`.
  Comprobado con `gh api .../deployments` contra `git ls-remote`.
- **El Loom es anterior a ese deploy.** Varios pedidos ya están en el código y
  no hay que rehacerlos — hay que *verificarlos en pantalla*.

## Loom — los 9 pedidos, uno por uno

| # | Pedido | Estado real |
|---|---|---|
| 1 | Filtros en fotos | **Ya está**: 16 filtros, `src/lib/media/photo-filters.ts`, horneados con canvas en `bake-photo.ts` |
| 2 | Videos: pesados no suben, formatos raros | **REAL**. `post-composer.tsx:860` acepta sólo `video/mp4,video/webm` → el `.mov` del iPhone queda gris en el selector |
| 3 | Notificaciones no funciona | **REAL**. El Server Component tira y cae al error boundary |
| 4 | "Tu zona" no funciona | **REAL, pero es un placeholder deliberado**: `header-actions.tsx:8` dice "Elegir tu zona, muy pronto" |
| 5 | Falta "convertirte en creador" | **Ya está**: `ajustes/page.tsx:236`, condicionado a `creadoresActivo` — y el módulo está activo en los dos tenants |
| 6 | Falta botón Aplicar en empleos | **Ya está**: `JobApplyInline` en `job-card.tsx:111`, abre la hoja sobre el listado sin navegar |
| 7 | Falta "Centro de acopio" en Comunidad | **REAL**. La grilla tiene 5 tarjetas, ésa no está |
| 8 | Tick azul: para qué perfil aplica | **Parcial**: `/perfil/verificar` existe; falta explicar los tipos (`verified_badge_type`: persona/negocio/profesional) y el de creador |
| 9 | Cambiar de perfil tipo Instagram | **Existe pero invisible**: `identity-switcher.tsx` se monta en el avatar del header **sólo si ya tenés cuenta de negocio** (`header.tsx:129`). Nacho no tiene una. Y lo buscó en el perfil |

## Spec de módulos — el delta contra el código

### El hallazgo que ordena todo lo demás
`posts.entity_listing_id → listings.id` (migración 0023) **ya existe** y es el
vínculo publicación↔ficha que la spec pide. `createPostAction` ya lo acepta y lo
persiste. **Ninguna UI lo escribe.** Cablearlo es lo que enciende, de una sola
vez: Negocios→Publicaciones, Profesionales→Publicaciones, el empleo/evento como
tarjeta vinculada, y la regla de que lo comercial no se derrama a "Para ti".

Cuidado con dos `kind` distintos: `posts.kind` es el FORMATO
(`post|question|text`); `listings.kind` es la VERTICAL
(`property|business|professional|event|job|product|creator_gig`).

### Por módulo

**Negocios** — hoy es sólo el directorio.
Faltan las pestañas Publicaciones y Ofertas; 4 de los 6 filtros (Cerca de mí,
Abiertos ahora, Calificaciones, Destacados); y en la tarjeta: rating, abierto/
cerrado, y los botones Mensaje/Llamar/Cómo llegar.
Ojo: `negocios/(lista)/page.tsx:40-58` afirma que no hay horarios ni reseñas —
**el comentario está desactualizado**, existen desde 0093. La data ya está.
Ojo 2: "Destacado" ya es el nivel máximo del Trust Score (ganado). Un filtro de
pauta con ese nombre confunde reputación con plata.

**Profesionales** — falta la pestaña Publicaciones, los idiomas
(`profiles.languages` existe desde 0062 y no se lee acá), separar identidad de
credenciales, y el botón Contactar en la tarjeta.

**Propiedades** — la venta sigue habilitada y la spec pide sólo alquiler.
Faltan: pestaña Agentes y propietarios; depósito, cargos, servicios incluidos,
requisitos, amueblado, fecha de disponibilidad; el estado "Alquilado"; y la
reconfirmación a los 60 días. La dirección privada ya está bien resuelta
(`listing_private_details`, 0004).

**Marketplace** — falta el directorio de Tiendas entero.
🔴 La insignia de "vendedor verificado" hoy se **compra**: está atada a
`business_accounts.verified_presence` (plan pago), no a `identity_verified`, y un
particular nunca puede tenerla. Es engañosa para quien compra.

**Eventos** — el formulario sólo captura fecha y hora. Faltan portada, físico vs
virtual, gratis/pagado, boletos, capacidad, categoría y público.

**Empleos** — el formulario no captura negocio vinculado, modalidad
(`listings.work_mode` existe desde 0087 y Empleos no la usa), días y horario,
experiencia/idiomas, fecha de inicio ni fecha límite. El flujo de postulación,
en cambio, está completo y sus estados mapean 1:1 con la spec.

**Verificación** — no existe gate reusable. El único lugar donde
`identity_verified` bloquea algo es la activación de Creador. Publicar alquiler,
artículo o empleo hoy no exige nada.

**Feed** — hay 5 pestañas (`para-ti` + 4 verticales), no existe "Siguiendo".
Y seguir a un *perfil* no tiene efecto: `fetchFollowedListingIds` sólo lee
`target_kind='listing'`.
⚠️ Techo conocido: las lecturas de supabase-js son GET y los `.in(...)` viajan en
el querystring; Kong corta en ~8 KB. Con los topes actuales (150/200/200) el peor
caso da ~21 KB. Una pestaña "Siguiendo" pega contra la misma pared. El cierre
real es el RPC `security definer` anotado en el docblock de `feed/queries.ts`.

## Stripe

El sistema está construido: webhook único con validación de firma, 6 handlers
(membresía, presencia, premium, boosts, campañas, verificación, reembolsos,
renovaciones) y 6 archivos de test. La idempotencia concurrente ya se arregló.
**Lo que falta son las claves**: `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`
están vacías en `.env.local` y en producción. Las genera el dueño en su
dashboard; el runbook queda en `docs/STRIPE.md`.

## Numeración de migraciones reservada

`0105` centro de acopio · `0106` ofertas + gate de verificación + una ficha por
negocio · `0107` campos de propiedad/evento · `0108` lo que pida el arreglo de
notificaciones.

## Arrastres de la ronda de módulos (para cerrar antes del deploy)

Cada agente devolvió lo que no podía tocar por fronteras de archivo. Esto es lo
que quedó, con quién lo detectó:

| # | Qué | Dónde |
|---|---|---|
| 1 | N+1 disfrazado: el directorio de Profesionales hace **12 llamadas RPC `profile_card()` por render** porque los idiomas viven en `profiles_private` (RLS de sólo-dueño) y no hay lectura en lote. Necesita `profile_cards(uuid[])` | `src/lib/profesionales/languages.ts` |
| 2 | Falta índice: `fetchActiveListingCounts` y la vidriera de tienda filtran por `attrs->>'store_listing_id'` sin índice — escanean | `listings` |
| 3 | `@stripe/stripe-js` es dependencia sin usar (todos los cobros son Checkout hospedado) | `package.json` |
| 4 | `PERFIL_ACTIVO_COPY.banner` escrito para un lugar que nunca se construyó | `src/lib/perfil-activo/copy.ts` |
| 5 | `videoWrongType` / `videoTooBig` quedaron huérfanas: los mensajes se movieron a `video-upload-limits.ts` con números dinámicos | `src/components/feed/copy.ts` |
| 6 | Comentario que MIENTE: dice que no hay horarios ni reseñas de negocios. Existen desde 0093. Es la trampa que hace que el próximo que lea re-explique por qué "no se puede" en vez de cablear el filtro | `negocios/(lista)/page.tsx:40-58` |
| 7 | Copy desactualizado: el tile dice "Publicá un alquiler o una venta" y la venta ya no existe | `src/components/feed/copy.ts:323-326` |
| 8 | `checkout.session.expired` sin handler → los checkouts abandonados dejan filas `pending_payment` que nadie limpia | webhook de Stripe |
| 9 | Doble checkout = doble suscripción. El SDK cubre reintentos de red, no dos intenciones del usuario | superficies de suscripción |

## Lo que NO se hizo en esta ronda, y por qué

- **Negocios: las 3 pestañas y los 4 filtros faltantes.** La pestaña Ofertas
  depende de `post_offers` (0106, escrita pero sin aplicar) y de que algo
  escriba `entity_listing_id`.
- **Cablear `entity_listing_id` desde el composer.** Es la llave de toda la
  distribución de contenido; sin eso, las pestañas "Publicaciones" de Negocios
  y Profesionales nacen vacías por diseño.
- **Feed Siguiendo / Para ti.** Choca con el techo de 8 KB de URL ya
  documentado; el cierre real es el RPC `security definer`.
- **Propiedades: pestaña Agentes y propietarios**, estado "Alquilado",
  reconfirmación a los 60 días.
- **"Tu zona"** — es transversal a las queries de todos los módulos; hacerlo con
  seis agentes editando en paralelo era garantía de colisión.

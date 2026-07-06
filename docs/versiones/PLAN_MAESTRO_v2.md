# PLAN MAESTRO — Comunidad Latina (alias NYLabel)

**La infraestructura de confianza y llegada del inmigrante latino.**

| | |
|---|---|
| **Cliente** | Geovanny (Global Super Admin, operador de la red) |
| **Desarrollo** | INSIGHTS |
| **Versión** | **2.0** — Plan integrado (técnica + producto + growth + economía + legal + GTM) |
| **Fecha** | 2026-07-06 |
| **Estado** | CANON — fuente de verdad única del proyecto |
| **Ejecutor previsto** | Enjambre de agentes orquestados (Fable 5, modo Workflow) en sesión separada |
| **Insumos** | 7 informes técnicos (`docs/investigacion/01-07`) + 5 power-ups (`docs/investigacion/power-up/08-12`) + V1 técnica detallada (`docs/versiones/PLAN_MAESTRO_v1.md`) |

> **Qué cambió de la V1 a la V2:** la V1 resolvió *cómo construirlo* (arquitectura, datos, seguridad, pagos, IA, infra — todo canon y vigente, referenciado aquí). La V2 agrega *por qué gana*: el concepto que le da alma, el moat que lo hace no-copiable, el modelo económico real, el motor de crecimiento, el go-to-market y el blindaje legal. El detalle técnico profundo **no se repite** — vive en los informes y en la V1 técnica; este documento es el **norte navegable** que los orquesta.

---

## ★ Concepto unificador (leer antes que nada)

**Comunidad Latina NO es una red social. Es la infraestructura de confianza y llegada del inmigrante latino.**

El inmigrante que llega a EE.UU. aterriza **sin historial en el país nuevo**: sin crédito, sin red, sin reputación, sin saber en quién confiar. Cae en Facebook Groups caóticos, en Craigslist lleno de estafas, en un notario que le cobra $6.000 y le arruina el caso migratorio. **Ese vacío de confianza es el problema que resolvemos.**

- La **red social** es el *sustrato* (feeds, perfiles, grupos, stories).
- La **confianza verificable** es el *producto* (Trust Score, Escudo Anti-Estafa, verificación).
- El **comercio local** (negocios, profesionales, inmobiliarias, creadores) es el *motor económico* — el lado que paga.

Todo lo demás —los 5 feeds, los marketplaces, el Boost, la IA— existe para **generar, proteger y monetizar confianza y pertenencia**. Este reencuadre convierte "otro Facebook para latinos" (paridad, imposible de defender) en **una categoría nueva que nadie ocupa**. No cambia el objetivo del proyecto: le da el eje que ordena roadmap, priorización, producto y marketing.

**La frase de una línea** (para inversores, prensa, onboarding): *"El lugar donde el latino que recién llega encuentra a su gente, resuelve su vida y construye su reputación en el país nuevo — sin caer en estafas."*

Cuatro principios de producto derivan de este concepto y son criterio de priorización a lo largo del plan:

1. **Reputación portable** — el Trust Score es un "pasaporte de confianza" que el usuario puede presentar *fuera* de la app (landlords, empleadores, prestamistas). Pilar estratégico, no feature interno.
2. **Onboarding "Recién Llegado / Día 1"** — se diseña para el momento de máxima necesidad del inmigrante, no para el usuario ya establecido. Es el antídoto al churn de semana-0 que mató a Homeis.
3. **Anti-scroll — medir problemas resueltos, no tiempo en pantalla** — el North Star de producto es "resoluciones" (encontró casa, trabajo, abogado confiable), no minutos de adicción. Diferenciación ética con una población vulnerable.
4. **Playbook de Nacimiento de Tenant** — cada comunidad nueva pasa por un proceso automatizado y repetible que la lleva de cero a viva. Hace el modelo multi-tenant *operativamente* escalable, no solo técnicamente.

---

## Índice

1. [Visión del producto](#1-visión-del-producto)
2. [El Moat: por qué nadie nos copia](#2-el-moat-por-qué-nadie-nos-copia)
3. [Arquitectura y seguridad (resumen canónico)](#3-arquitectura-y-seguridad-resumen-canónico)
4. [Modelo de negocio y unit economics](#4-modelo-de-negocio-y-unit-economics)
5. [Monetización](#5-monetización)
6. [IA: moderación + IA como producto](#6-ia-moderación--ia-como-producto)
7. [Growth, cold-start y retención](#7-growth-cold-start-y-retención)
8. [Go-to-Market y lanzamiento](#8-go-to-market-y-lanzamiento)
9. [Legal y compliance](#9-legal-y-compliance)
10. [Roadmap del producto completo](#10-roadmap-del-producto-completo)
11. [Plan de ejecución para el enjambre (Fase 3)](#11-plan-de-ejecución-para-el-enjambre-fase-3)
12. [Riesgos y mitigaciones](#12-riesgos-y-mitigaciones)
13. [Decisiones pendientes de Geovanny](#13-decisiones-pendientes-de-geovanny)
14. [Referencias](#14-referencias)

---

## 1. Visión del producto

### 1.1 Qué estamos construyendo

Un **motor único** (Next.js + Supabase) que sirve **N redes sociales independientes por país de origen** — `dominicanos.com`, `colombianos.com`, `mexicanos.com`, `venezolanos.net`, y el buque insignia `comunidadlatina.com` — cada una con su dominio, branding, moneda e idioma, pero compartiendo el mismo código, la misma base de datos y el mismo ciclo de deploy. Los datos de cada comunidad están **aislados por `tenant_id` + Row Level Security (RLS)**, no por infraestructura separada. Un **Global Super Admin** (Geovanny) administra todas las comunidades desde un panel único y puede emitir **Broadcast Global** (alertas cross-tenant, p. ej. persona desaparecida) que llegan a todos los dominios a la vez.

No es un MVP. Es el **producto completo**: 5 feeds sociales, Trust Score anti-fraude, Stories, Grupos con Q&A, Creator Marketplace con escrow, Marketplace de Tiendas, moderación de IA en 3 niveles, 3 paneles de administración — **más las 4 capas de moat** (§2) que lo separan de cualquier clon de Sngine.

### 1.2 A quién servimos (y por qué duele hoy)

El usuario central es el **latino inmigrante en EE.UU./Europa** — 68M solo en EE.UU. — con foco inicial en el **recién llegado**, que vive tres dolores agudos que ninguna plataforma resuelve bien:

- **No sabe en quién confiar** → cae en estafas de renta, empleo y notarios/"consultores" migratorios.
- **No encuentra a su gente ni sus servicios** → información dispersa en grupos caóticos, en inglés, o inexistente.
- **Es invisible para el sistema** → sin historial local, no accede a vivienda, crédito ni oportunidades aunque sea confiable.

### 1.3 Nuestra respuesta

Una plataforma que **(a) te recibe** el día 1 y te guía (onboarding "Recién Llegado"), **(b) te protege** de estafas con IA y verificación (Escudo Anti-Estafa + Trust Score), **(c) te conecta** con tu comunidad, tu país de origen y el comercio local latino, y **(d) te hace visible** construyendo una reputación portable que podés usar dentro y fuera de la app. Todo en español, mobile-first, instalable sin App Store.

### 1.4 El modelo de negocio, en una línea

Geovanny **opera** las comunidades y **monetiza el comercio local** (el lado oferta: negocios, profesionales, inmobiliarias, creadores, tiendas) vía membresías, Boost, comisión del Creator Marketplace y mensualidad de Tiendas. El usuario común no paga: es la demanda que hace valioso el lado oferta. Vender el motor como SaaS a terceros queda como **oportunidad futura** (backlog), no como el modelo core — pero la arquitectura shared-schema lo habilita sin rehacer nada (§4).

### 1.5 Para quién es este documento

- **Geovanny (cliente):** §1, §2, §4, §8, §10, §12, §13 — visión, ventaja competitiva, economía, lanzamiento, roadmap, riesgos, decisiones.
- **Tech leads/arquitectos:** §3, §6 + los 7 informes técnicos y la V1 técnica (detalle de datos, RLS, pagos, IA).
- **El enjambre que ejecuta (Fable 5):** §11 — el input directo, épica por épica, con agente sugerido, dependencias y criterio de "hecho".

---

## 2. El Moat: por qué nadie nos copia

> **Tesis del power-up 09:** un feed + directorios + marketplace ya existen en Sngine, Facebook y Nextdoor — eso es **paridad**, no ventaja, y se copia en un sprint. La ventaja defendible vive en 3 capas que una red generalista no puede replicar sin **reconstruirse alrededor del inmigrante**: **confianza verificada, utilidad accionable, e IA sobre datos comunitarios propietarios.** Estas capas no son extras: son el núcleo del roadmap (aparecen como épicas en §11).

### 2.1 Las 4 features núcleo del moat

**① 🛡️ Escudo Anti-Estafa** — IA que intercepta el fraude *antes* de que ocurra (renta, empleo, roommate, servicios) + **verificador de notarios/abogados** contra el directorio oficial del DOJ. Dato real (jun-2026): NYC emitió 175 violaciones a "notarios" fraudulentos y aprobó la ley anti-notario más dura del país. Esto literalmente evita que alguien pierda $6.000 y arruine su caso migratorio. Es el *"¿por qué esta app y no Facebook?"* en una frase. **Efecto red:** cada estafa reportada entrena al sistema y protege a los siguientes 68M.

**② 🤖 Asistente Comunitario** — un asistente conversacional (RAG sobre los datos del tenant con pgvector) al que le preguntás cualquier cosa sobre vivir en tu ciudad siendo latino — *"¿dónde compro harina PAN en Queens?"*, *"¿dentista latino barato en Miami?"* — y responde con la data real de la comunidad. **Convierte una app de 12 módulos en "preguntá y ya".** Es el feature que la gente le cuenta a sus amigos.

**③ ⭐ Trust Score 2.0** — de número opaco a **reputación multi-señal, explicable y portable**: identidad verificada por niveles (Google Vision + SMS), transacciones sin disputa, y grafo de *endorsements* de vecinos verificados. La IA explica *por qué* confiar. Es la moneda de toda la red y — elevado a pilar estratégico — el **"pasaporte de confianza" exportable** fuera de la app.

**④ 📖 Guías "Cómo hacer X siendo latino aquí"** — base de conocimiento hiperlocal (país × ciudad × estado) sobre licencia sin SSN, ITIN, banco, taxes, escuela, derechos ante ICE. Google devuelve basura y estafas para estas búsquedas. **Doble golpe:** utilidad real que retiene + **SEO orgánico masivo** (sinergia directa con la estrategia SEO de INSIGHTS).

> **El "moat mínimo viable"** son estas 4 features. Solas ya transforman el clon-de-Sngine en *"la app que protege y ayuda al inmigrante latino"*. Todo lo demás amplifica.

### 2.2 IA como producto (no solo moderación)

La IA no es solo el filtro de contenido de §6 — es superficie de producto, viable en costo en 2026 (router multi-modelo + cache semántico en pgvector = pocos dólares/mes por tenant):

- **Matching inteligente** (roommate, trabajo, servicios, gente de tu mismo pueblo) por compatibilidad semántica real con pgvector + Trust Score — mejora con cada usuario (moat de red + datos).
- **Copiloto de Negocios** — el dueño de la lonchería sube 3 fotos del plato y la IA le escribe el listing y 3 anuncios, y le sugiere Boost. **Diferenciador Y motor de ingresos** (más listings pagos, menos churn B2B).
- **Resúmenes de Comunidad** — digest semanal por IA ("esta semana en dominicanos-NY: 3 aptos nuevos, evento de bachata, alerta de estafa"). Barato, altísimo ROI de reactivación.
- **Asistente de Trámites (Fase 2)** — explica formularios (I-130, I-765, TPS, DACA), genera checklists, traduce cartas de USCIS. **Línea roja legal:** nunca da asesoría (es delito — *unauthorized practice of law*); deriva a abogado verificado. Requiere revisión legal antes de construir.

### 2.3 Los 3 moonshots (lo que lo vuelve icónico)

1. **Reputación portable del inmigrante** — el Trust Score como pasaporte presentable a landlords/empleadores/prestamistas; resuelve la invisibilidad estructural del recién llegado.
2. **Intérprete de bolsillo en vivo** ES↔EN para el doctor/landlord/corte (Gemini Live, <700ms — viable hoy).
3. **Remesas nativas** — comparador transparente del costo real (67% de latinos no conoce el markup oculto de FX) y, a futuro, remesas stablecoin a centavos vs. 6,5% — requiere partner regulado.

### 2.4 Por qué es defendible (la lógica del moat)

Cada capa se refuerza con el uso y **no se puede copiar sin los datos ni el enfoque**: el Escudo mejora con cada reporte; el Asistente y el Matching mejoran con cada usuario y cada dato del tenant; el Trust Score gana valor a medida que más actores lo reconocen. Un Facebook o un Sngine tendrían que **reconstruirse alrededor del inmigrante** —producto, datos, incentivos— para igualarlo. Y como cada tenant tiene sus datos aislados por RLS, **la IA de cada comunidad solo ve lo suyo**: aislamiento y moat de datos en la misma jugada.

---

## 3. Arquitectura y seguridad (resumen canónico)

> Detalle completo en `docs/investigacion/01-arquitectura-multitenant-datos.md`, `02-app-whitelabel-multidominio.md`, `07-infra-devops-admin.md` y la V1 técnica. Aquí van solo las decisiones **canon** que no se discuten.

### 3.1 Los 6 principios innegociables

1. **Multi-tenant en todas las capas.** Un solo proyecto Supabase, **shared schema + `tenant_id` + RLS**. Middleware de Next.js resuelve tenant por hostname; el Storage particiona por `tenant_id/…`; los canales de Realtime se nombran por tenant. Se eligió shared-schema sobre schema/DB-per-tenant porque hace el Broadcast Global trivial, las migraciones O(1), y agregar un tenant cuesta *una fila*, no infraestructura.
2. **Seguridad zero-trust.** El middleware **solo enruta** (lección del CVE-2025-29927). La autorización real vive en Server Actions + **RLS en Postgres como garantía final**. El `tenant_id` sale **siempre** del JWT firmado por Supabase Auth, estampado desde **`app_metadata` (nunca `user_metadata`**, que el usuario puede editar y forjar). RLS `FORCE` + policy reusable con `(select auth_tenant_id())` (initPlan: 1 evaluación por query, no por fila).
3. **PWA-first.** Instalable desde el navegador, sin App Store. Apps nativas = backlog Fase 2+.
4. **Provider-agnostic donde el mercado rota rápido.** Moderación y video detrás de interfaces (`TextModerator`, `VideoProvider`, `StorageProvider`) — cambiar de proveedor es cambiar un adaptador (Perspective API se discontinúa en dic-2026: el riesgo es real).
5. **Fan-out on read, nunca on write masivo.** Feeds con keyset pagination (nunca OFFSET); Realtime con *Broadcast from Database*; Broadcast Global con modelo **pull** (`broadcasts` + `broadcast_targets` + `broadcast_receipts`).
6. **Privacy-by-design para población vulnerable (NUEVO, del power-up 11).** Ver §3.3 — es un principio de arquitectura, no un "nice to have".

### 3.2 Stack canónico y roles

| Capa | Servicio | Nota |
|---|---|---|
| App / hosting | **Next.js + Vercel Pro/Enterprise** | Pro obligatorio: Hobby topa en 50 dominios. Enterprise a cotizar según ambición de dominios |
| Datos / auth / realtime / colas | **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions + pgmq + pg_cron + **pgvector**) | pgvector habilita el Asistente y el Matching del moat |
| Media pública | **Cloudflare R2** (egress $0) | Decisivo para un feed de imágenes |
| Video | **Cloudflare Stream** (grueso) · **Bunny** (solo premium/DRM) | Bunny castiga egress en LATAM → reservado a premium |
| Pagos | **Stripe Connect** (Express) | Única forma de que Geovanny no sea money transmitter |
| Moderación | **OpenAI `omni-moderation`** (gratis) + **Gemini 2.5 Flash** (zona gris) + **Google Vision** (imagen) | NO Perspective |
| SMS / email | **Twilio** · **Resend** | Verificación y transaccional, branding por tenant |
| IA producto | **Router multi-modelo** (Gemini Flash / GPT-5 nano) + cache semántico en pgvector | Costo real: pocos $/mes/tenant al inicio |

**El Riesgo #1 del proyecto es una fuga de datos cross-tenant.** Se combate con defensa en profundidad (RLS FORCE + policy generada + suite de tests de aislamiento en CI + `get_advisors`). Ninguna tabla se mergea sin sus tests de aislamiento en verde — gate de CI, no sugerencia. Skills: `supabase-audit-rls`, `multi-tenant-safety-checker`, `security-auditor`.

### 3.3 Privacy-by-design para inmigrantes (el riesgo humano más grave)

En 2026 hay subpoenas administrativas de DHS/ICE a plataformas sociales pidiendo identidad de usuarios. Para una población de inmigrantes, un dato mal guardado puede destruir una vida. Reglas duras de diseño (del power-up 11):

- **Nunca** preguntar ni inferir estatus migratorio en ningún formulario, perfil o señal.
- **Alias por defecto** en perfiles públicos; nombre legal solo donde sea imprescindible y nunca público.
- **KYC / identidad legal vive solo en Stripe**, jamás replicado en nuestra base.
- **Minimización activa:** el mejor dato para no ser solicitado es el que no existe. Diseñar cada tabla preguntando "¿esto puede ser subpoenado contra el usuario?".
- **"Política de Solicitudes de Autoridades"** definida antes del lanzamiento: proceso legal formal requerido, notificación al usuario salvo prohibición, responsable claro.

---

## 4. Modelo de negocio y unit economics

> Fuente: `docs/investigacion/power-up/10-unit-economics-pricing.md`. Todas las cifras son **hipótesis de trabajo** para ordenar palancas, no pronósticos — recalibrar tras 90 días de piloto (Van Westendorp para willingness-to-pay).

### 4.1 El North Star correcto: cuentas de negocio pagas por tenant (no MAU)

El motor de rentabilidad es el **supply-side** — negocios, profesionales e inmobiliarias que pagan membresía ($29–599/trimestre) generan casi todo el margen. El usuario común (98%+ de la base) es **inventario de atención** que se monetiza indirectamente (Boost, publicidad, GMV). **Perseguir MAU es perseguir la métrica equivocada**; el North Star es **cuentas de negocio pagas por tenant** y % del supply-side que paga.

### 4.2 Unit economics por tenant

| Métrica | Valor (tenant maduro, 10k MAU) | Nota |
|---|---|---|
| Costo de infra + IA + media | **~$247/mes** | El video es ~23% y el único costo que explota no-linealmente (1 viral de 500k views ≈ $250 solo de delivery → alertas obligatorias) |
| Break-even | **~144 MAU ≈ 12–15 negocios pagando** | Regla de bolsillo: *un dominio se paga solo con ~12–15 negocios locales suscritos* |
| Contribución (maduro) | **~$8.800/mes, margen ~97%** | Contribución a nivel tenant — NO margen neto del negocio (no incluye equipo ni tenants inmaduros) |
| CAC vía influencer | **~$12,50/usuario pago** | vs. ~$40 por ads. El canal influencer es el mayor activo económico |
| LTV:CAC | **7:1 a 221:1** por segmento | Muy por encima del 3:1 sano — *si y solo si* se convierte usuario → negocio pago |

### 4.3 El "valle" (lo que hay que decirle a Geovanny sin adornos)

El caso base **quema ~$43k acumulados hasta ~mes 12** antes de girar; break-even de EBIT acumulado ~mes 16–17; ARR base ~$434k a 24 meses (conservador ~$87k, optimista ~$1,36M). **Geovanny necesita financiar 12–15 meses de valle.** La palanca de supervivencia no es la infra (barata) — es **mantener el equipo chico**. El pago anual con 2 meses gratis (§5) adelanta cashflow y es la herramienta #1 para financiar ese valle sin capital externo.

### 4.4 Métricas a instrumentar desde el día 1

Cuentas de negocio pagas/tenant · % supply-side pago · ARPPU supply-side · CAC por canal (separado) · LTV:CAC por segmento · churn por tier · NRR · contribución/tenant · **costo de delivery de video por tenant (con alerta)** · reserva de disputas · burn/runway · EBIT acumulado vs. proyección · y el North Star de producto: **"resoluciones"** (matches/contactos/transacciones que resolvieron una necesidad real).

---

## 5. Monetización

> Fuente técnica: `docs/investigacion/04-monetizacion-stripe-connect.md`. Decisiones de pricing: power-up 10.

### 5.1 Los 4 flujos y su mecanismo Stripe

| Flujo | Mecanismo | Comisión | Hold |
|---|---|---|---|
| **Membresías** (Propiedad, Inmobiliaria, Profesional, Publicidad mensual) | Stripe Billing, sin Connect | 100% plataforma | — |
| **Boost geolocalizado** | Checkout one-time, `price_data` inline (precio dinámico) | 100% plataforma | — |
| **Creator Marketplace** | Destination charge + **transfer diferido (escrow Opción B)** | **20%** | Sí — 72h |
| **Marketplace de Tiendas** | Destination charge simple + **mensualidad** (Billing) | 0% en la venta | No |

- **Escrow Opción B (a confirmar por Geovanny):** captura inmediata en balance de plataforma + `transfer` diferido al confirmar entrega. Evita la expiración de autorización de la tarjeta (7 días). Es su *"queda en Stripe hasta que el creador entrega"*.
- **Una sola cuenta Stripe de plataforma** para toda la red; revenue atribuido por `tenant_id` en `metadata`; la **DB propia es la fuente de verdad** del reporting, no la API de Stripe.
- **Webhooks:** firma vía SDK, body crudo (`request.text()`), idempotencia por `event.id` en la misma transacción, `2xx` <200ms.

### 5.2 Precios pendientes — RESUELTOS (power-up 10)

- **Mensualidad de Tienda:** escalera **$19 / $29⭐ / $49** por mes (ancla en $29, charm pricing). Mensaje: *"más barato que Shopify ($39), sin la comisión de Etsy"*.
- **Video Premium:** **$4.99/mes CON TOPE de minutos entregados** + tier **Pro $14.99** con overage. Hallazgo crítico: **el plan de video ilimitado da margen negativo** (un creador medio cuesta ~$10,60/mes vs $4,75 de ingreso). Se vende **"alcance + calidad"**, no "streaming ilimitado".

### 5.3 Fuentes de revenue nuevas (priorizadas)

1. **Pago anual con ~2 meses gratis** — máxima prioridad, cero desarrollo, adelanta cashflow para financiar el valle (§4.3).
2. **"Destacado del mes"** para negocios (posicionamiento premium rotativo).
3. **Lead-gen premium** estilo Thumbtack ($35–60/lead) — mercado ya educado.
4. **Publicidad geo cross-tenant** que solo el Global Admin vende — escala con la red completa (activo único del multi-tenant).

Ajustes al pricing actual: mantener la escalera inmobiliaria ($149→$299→$599, buen anchoring) y el charm pricing; agregar ancla "Profesional Elite" (~$99); convertir los rangos anchos de Boost en 3 precios charm fijos por tier.

---

## 6. IA: moderación + IA como producto

> Fuentes: `05-ia-moderacion-media.md` (moderación/media) y `power-up/09-diferenciacion-ia-producto.md` (IA producto).

### 6.1 Moderación en 3 niveles (defensa + compliance)

- **Score de riesgo = fusión ponderada:** 70% señales de IA (máx. entre imagen/texto/video) + 20% Trust Score del autor + 10% reincidencia, con **reglas duras** que saltan a revisión manual (CSAM, violencia).
- **Ruteo:** 0–30 auto-aprueba · 31–70 monitorea/segunda opinión (Gemini Flash) · 71–100 cola del Moderador. Latencia: texto/imagen <5s p95; video <3min tras transcode. Async con pgmq + Edge Functions.
- **Proveedores:** texto ES → **OpenAI `omni-moderation` (gratis)**; imagen/frames → **Google Vision SafeSearch** (gratis si corre con Label Detection); zona gris → **Gemini 2.5 Flash**. Copyright por perceptual hash, no Vision.
- **CSAM/NCMEC (obligación legal de día 1):** PhotoDNA/NCMEC hashing en el upload + flujo de reporte separado que **nunca** expone a un Moderador común. No es escalable "después".
- **Costo:** ~$120–253/mes por tenant de 10k MAU (el video domina, no la IA).

### 6.2 IA como producto — el moat en acción

Las features de §2.1–2.2 se apoyan en el mismo stack (pgvector + router multi-modelo + cache semántico), con **RLS por tenant** (la IA de cada comunidad solo ve sus datos):

- **Escudo Anti-Estafa:** clasificador de fraude sobre listings + verificación contra directorio DOJ + señales de la comunidad. Tabla `fraud_signals` y `verifications`.
- **Asistente Comunitario:** RAG sobre embeddings de posts/negocios/guías del tenant (`content_embeddings` en pgvector).
- **Matching:** embeddings de perfiles/necesidades + Trust Score como re-ranker.
- **Copiloto de Negocios / Resúmenes / Trámites (Fase 2):** generación asistida, con las líneas rojas legales de §9.

**Economía IA (2026, verificada):** Gemini 2.5 Flash ~$0,30/$2,50 por 1M tok; GPT-5 nano ~$0,05/$0,40; Gemini Live voz ~$0,037/min. Con router + cache semántico, el costo por tenant al inicio son **pocos dólares/mes** — "IA como producto" ya no es lujo.

---

## 7. Growth, cold-start y retención

> Fuente: `docs/investigacion/power-up/08-growth-retencion-engagement.md`. **Una red social técnicamente perfecta pero vacía se muere** — esta sección es tan crítica como la arquitectura.

### 7.1 Cold-start: el problema que mató a Homeis

Homeis (app de diáspora, cerró) murió por *ghost towns*: comunidades vacías sin razón para volver. Lección: **lanzamiento robusto > lanzamiento rápido**. Cada dominio nuevo arranca con:

- **Seed content pre-lanzamiento (2-3 semanas antes):** 20–30 negocios verificados, 15–20 eventos reales, 50–100 propiedades scrapeadas **éticamente** (respetando robots.txt/ToS, solo agregación con atribución). Nunca abrir un dominio vacío.
- **Cuentas ancla (10–15 "Fundadores"):** periodista local + emprendedor + profesional + creador + moderador. Postean 1–2×/día, responden en <2h. +30–50% engagement inicial.
- **Masa crítica mínima D7:** 500+ usuarios y 20+ negocios activos.

### 7.2 Loops virales (objetivo K-factor ≥ 0,6)

- **Loop #1 — "Invita 3 → desbloqueá Trust Score":** modal post-signup, deeplink a WhatsApp en <3 taps. K ≈ 0,36.
- **Loop #2 — WhatsApp share (natural, no-spam):** compartir listing/evento gana Social Points → desbloquea premium. K ≈ 0,15–0,20.
- **Loop de red (usuarios ↔ negocios):** más usuarios = más demanda para negocios; más negocios = más razón para volver. K ≈ 0,20.

### 7.3 Retención y gamificación (el Trust Score como progresión)

- **Hook Model:** trigger (push con propósito) → action (abrir/ver) → **reward variable** (+1 a +10 Trust Score) → investment (el usuario cuida su score → vuelve).
- **Trust Score como juego:** niveles Bronze→Silver→Gold→Platinum→Diamond; badges visibles (CTR +180%, conversión +60% en benchmarks). Pagar da badge Premium pero **no compra impunidad**.
- **Daily rituals:** 3 momentos con propósito (mañana: ofertas locales; mediodía: reviews; tarde: Q&A/eventos). **Quiet hours 10pm–7am** (anti-spam absoluto). Máx. 2 notificaciones/día.
- **Streaks + FOMO:** 🔥 badge por 7 días de actividad.
- **Benchmarks objetivo:** D1 45% · D7 25% · D30 12% (vs. industria 25-30% / 10-15% / 5-8%). Alcanzarlos = crecimiento compuesto 50–100% MoM sin ads.

### 7.4 ★ Playbook de Nacimiento de Tenant (cold-start sistémico y escalable)

**El diferenciador operativo que hace escalable el multi-tenant.** Abrir un dominio no es "lanzar y rezar": es correr un proceso automatizado, gestionado desde el panel global, con 4 estados:

1. **Gestación** (seed automático): la IA + scraping ético pre-cargan negocios/eventos/propiedades; se generan las cuentas ancla; nano banana genera el kit de branding.
2. **Nacimiento** (activación influencer/embajador): se enciende el tráfico; onboarding "Recién Llegado" activo; loops #1/#2 encendidos.
3. **Crecimiento** (monitoreo): dashboard de masa crítica (usuarios, negocios activos, K-factor, D7). Kill-switch si D7 < 35%.
4. **Graduación** (autosostenido): el dominio alcanza los umbrales → se libera capacidad para abrir el siguiente.

Esto convierte el cold-start de arte en **proceso repetible** — sin esto, 8 dominios = 8 pueblos fantasma. Es una épica propia en §11.

---

## 8. Go-to-Market y lanzamiento

> Fuente: `docs/investigacion/power-up/12-go-to-market-lanzamiento.md`. Metas calibradas con el "valle" real de §4.3 (sin humo).

### 8.1 Resolución de choque: lanzar DOS dominios en paralelo, con roles distintos

El GTM pedía `dominicanos.com` primero (influencers); el legal pedía `comunidadlatina.com` primero (marca). **No son excluyentes — van en paralelo:**

- **`comunidadlatina.com` = buque insignia de MARCA.** Aunque sea en versión mínima, asegura el *specimen* USPTO (sitio vivo bajo el nombre exacto + una transacción real) **antes de octubre 2026**. Su función es legal-estratégica.
- **`dominicanos.com` = motor de TRACCIÓN.** Es donde se activan los influencers y se prueba el modelo de retención/monetización.

### 8.2 Activación de influencers sin "spike y muerte"

1.6M+ seguidores dominicanos (1M, ~1M, 500K, 100K). El riesgo es que lleguen 100k y se vayan. Antídotos:

- **FTUE <60s** (First-Time User Experience): onboarding "Recién Llegado" que muestra valor real (eventos locales + negocios) en 1 tap. Evita el churn semana-0.
- **QR dinámico** en videos → landing con referral tracking. Pago escalado al influencer ($ base + $/usuario registrado activo).
- **Content flywheel inmediato:** primer post = recompensa; creator monetization desde el día 5 (no día 30).
- Secuencia: sem. 1 = 4 influencers grandes; sem. 2 = 10–12 micro; sem. 3 = UGC viral + retención de power users.

### 8.3 Rollout secuencial con kill-switch

Abrir el siguiente dominio **solo** cuando el anterior sea estable (D7 ≥ 40%, moderación a escala, 100+ creadores/negocios activos, revenue real). **Kill-switch** si D7 < 35% o churn W4 > 85%: pausar tráfico, auditar, arreglar, relanzar. Orden sugerido tras dominicanos.com: puertorriqueños → colombianos → mexicanos → resto.

### 8.4 Lado oferta (los que pagan): "monetization engines"

El supply-side no llega solo. Desde el día 1, en paralelo a los influencers:
- **Embajadores locales** (power users con Trust Score alto) reclutan negocios/profesionales a cambio de 20% de referral.
- **3 pilares:** real estate (realtors), small business (barberías, restaurantes, salones), professionals (abogados, contadores, médicos).
- **Alianzas:** remesadoras, delivery, credit unions latinas, asociaciones de realtors.

### 8.5 Hito-marca (octubre 2026) como piedra angular del calendario

El lanzamiento mínimo que asegura la marca **manda la fecha del roadmap**: `comunidadlatina.com` vivo + nombre visible + ≥1 transacción real + evidencia fechada, con el archivo legal presentado **4 semanas antes** del vencimiento. Ver §9.1.

---

## 9. Legal y compliance

> Fuente: `docs/investigacion/power-up/11-legal-compliance-riesgo.md`. Esto **no es asesoría legal** — es un mapa de riesgos para priorizar con el abogado de Geovanny. Hay litigio previo activo: aplicar disciplina de documentación fechada a todo.

### 9.1 🔴 La marca "Comunidad Latina" — prioridad #1 con fecha dura

- **Acción inmediata (esta semana):** confirmar con abogado de marcas, vía TESS/TSDR (uspto.gov), si octubre 2026 es un **deadline de Sección 8** (renovación) o el **umbral de 3 años de no-uso** (abandono impugnable). Cambia toda la estrategia ("renovar" vs. "defender").
- **Specimen mínimo aceptable:** sitio **vivo y funcional bajo el nombre exacto "Comunidad Latina"**, con capturas fechadas y URL visible. No sirve mockup ni dominio de país sin la marca visible → por eso `comunidadlatina.com` se adelanta (§8.1).
- **Specimen fuerte:** además, **≥1 transacción real** bajo el nombre, con recibo archivado.

### 9.2 Moderación y responsabilidad de plataforma

- **Sección 230** protege del contenido de terceros, pero el terreno se endurece (KIDS Act/KOSA, caso Anderson v. TikTok sobre recomendaciones) → diseñar por encima del mínimo legal.
- **CSAM/NCMEC:** reporte obligatorio, hashing día 1 (§6.1).
- **DSA** (si hay tenants en la UE): logs auditables + apelación.

### 9.3 Privacidad (población vulnerable)

Ver §3.3 (privacy-by-design). Además: **GDPR** solo aplica con usuarios reales en la UE; **CCPA/CPRA** probablemente exime al inicio por tamaño, pero monitorear el umbral de 100k usuarios de California. **COPPA** para menores.

### 9.4 Pagos

Stripe Connect cubre el money-transmitter (Geovanny no toca la plata). **La plataforma —no Stripe— emite 1099-NEC** al creador si le pagó ≥$600/año (umbral 1099-K volvió a $20k/200 tx). Stripe Tax para ventas directas. Revenue-share con Domain Admins, si se hiciera, va **por connected account**, nunca pago manual fuera de Stripe.

### 9.5 Multi-tenant legal

- **Un solo ToS/Privacy maestro** para todos los dominios (no uno por país — reduce inconsistencias explotables en litigio).
- **Domain Admin Agreement** separado (indemnización, revocación unilateral, logs auditables): el Domain Admin actuando mal (discriminación, venta de datos, tolerar contenido ilegal por ingresos) es el **mayor riesgo estructural** del modelo. Nunca darle poder para desactivar la moderación legal central.

---

## 10. Roadmap del producto completo

> Medido en **fases con hitos verificables**, no en semanas-hombre (lo ejecuta un enjambre). Dos tracks en paralelo: **Marca** (urgente, para no perder el trademark) y **Producto completo**.

### 10.1 Track MARCA (restricción dura: antes de octubre 2026)

Objetivo: `comunidadlatina.com` vivo bajo el nombre exacto + ≥1 transacción real, para asegurar el specimen. Usa un subconjunto de épicas tempranas (0, 1, 2, 3, 6 + un módulo vertical + un flujo de pago simple). **Este es el mismo entregable "tangible" que se le muestra a Geovanny como avance temprano** (login, branding white-label, PWA instalable, perfil + Trust Score). Hito: **lanzamiento mínimo de marca**, con archivo legal 4 semanas antes del vencimiento.

### 10.2 Track PRODUCTO COMPLETO (fases)

| Fase | Contenido (épicas) | Hito verificable |
|---|---|---|
| **F0 — Fundaciones** | 0–4: plataforma multi-tenant, RLS, Auth Hook, usuarios+Trust Score, white-label, storage, observabilidad | Un tenant vive; tests de aislamiento RLS en verde; se crea un dominio "en minutos" |
| **F1 — Social vivo + base de moat** | 5–6 (social/feed, PWA) + 21 (pgvector/embeddings) + Trust Score 2.0 + onboarding "Recién Llegado" | Feed funcional multi-tenant; app instalable; onboarding Día-1 activo |
| **F2 — Verticales, comunidad y moderación** | 7–11 (propiedades, negocios, profesionales, eventos, grupos, Q&A, stories, moderación IA, notificaciones, realtime) | Los 5 feeds y la moderación 3-niveles operativos |
| **F3 — Monetización** | 12–16 (Stripe Connect, membresías, Boost, Creator Marketplace, Tiendas) | Los 4 flujos cobran; webhooks idempotentes; reporting por tenant |
| **F4 — Moat completo + Admin** | 22–27 (Escudo Anti-Estafa, Asistente Comunitario, Matching, Guías, Copiloto) + 17–18 (paneles, Broadcast Global) | Las 4 features de moat vivas; 3 paneles + Broadcast |
| **F5 — Growth + Lanzamiento** | 28–29 (loops/gamificación, Playbook de Nacimiento de Tenant) + 19–20 (endurecimiento, lanzamiento dual) | Playbook automatizado corre; dominicanos.com + comunidadlatina.com en producción |

---

## 11. Plan de ejecución para el enjambre (Fase 3)

> **Este es el input directo para Fable 5.** Épicas técnicas 0–20: el detalle **tarea-por-tarea** vive en la **V1 técnica** (`docs/versiones/PLAN_MAESTRO_v1.md §11`) — no se repite aquí; se listan objetivo, agente y dependencias. Épicas nuevas de moat/growth (21–29): detalladas abajo, con su fuente en el power-up 09/08.

### 11.1 Grafo de dependencias (actualizado con moat + growth)

```
F0  ÉPICA 0 Fundaciones ─┬─ 1 Usuarios+Trust ─┬─ 5 Social/Feed ─┬─ 7  Verticales
                         ├─ 2 White-label     │                 ├─ 8  Comunidad
                         ├─ 3 Storage/Media   ├─ 6 PWA          ├─ 9  Moderación IA
                         └─ 4 Observabilidad   │                 ├─ 10 Notificaciones
                                               │                 └─ 11 Realtime
                        21 pgvector/embeddings ─┘  (habilita todo el moat IA)
   (F0/F1)
5,7-11 ──► 12 Stripe Connect ─┬─ 13 Membresías
                              ├─ 14 Boost/Ads
                              ├─ 15 Creator Marketplace (escrow)
                              └─ 16 Tiendas
1,21 ──► 25 Trust Score 2.0 ──► 22 Escudo Anti-Estafa
21,5 ──► 23 Asistente Comunitario (RAG)      21,1 ──► 24 Matching IA
5,7  ──► 26 Guías + SEO programático          7,14 ──► 27 Copiloto de Negocios
1,5  ──► 30 Onboarding "Recién Llegado"
12-18,22-27 ──► 17 Paneles Admin ─── 18 Broadcast Global (pull)
todo ──► 28 Growth loops/gamificación ─ 29 Playbook Nacimiento de Tenant ─ 19 Endurecimiento ─ 20 Lanzamiento dual
```

### 11.2 Épicas técnicas 0–20 (resumen; detalle en V1 técnica §11)

| # | Épica | Agente sugerido | Depende de | Criterio de "hecho" |
|---|---|---|---|---|
| 0 | Fundaciones (tenants, RLS base, Auth Hook, scaffold, CI/CD) | database-architect + deployment-engineer | — | Tests de aislamiento RLS en verde en CI |
| 1 | Usuarios + Trust Score (base) | backend-architect | 0 | Registro multi-vía + score 0–100 visible |
| 2 | White-label multi-dominio | frontend-developer | 0 | Un dominio nuevo renderiza con su branding sin deploy |
| 3 | Storage y media base (R2 + Supabase) | backend-architect | 0 | Upload firmado por tenant; egress $0 verificado |
| 4 | Observabilidad (Sentry, logs, alertas) | deployment-engineer | 0 | Errores filtrables por tenant_id |
| 5 | Social base + Feed Principal | backend-architect | 1,2,3 | Feed con keyset + realtime, ads solo en Principal |
| 6 | PWA (manifest dinámico, SW, push, install) | frontend-developer | 2,5 | Instalable por tenant; push funcionando |
| 7 | Verticales (Propiedades, Negocios, Profesionales, Eventos) | backend-architect | 5 | 4 feeds verticales + RSVP |
| 8 | Comunidad (Grupos, Q&A, Stories) | backend-architect | 5 | Grupos con roles; votos anti-doble; stories 24h |
| 9 | Moderación IA (3 niveles) | ai-engineer | 5 | Pipeline async <5s texto/imagen; CSAM día 1 |
| 10 | Notificaciones (outbox, push, email) | backend-architect | 5 | Fan-out desacoplado, idempotente |
| 11 | Realtime avanzado (broadcast from DB) | backend-architect | 5 | Canales por tenant; sin fuga cross-tenant |
| 12 | Stripe Connect (cuentas, webhooks, idempotencia) | payment-integration | 7-11 | Webhook idempotente; connected accounts Express |
| 13 | Membresías/Suscripciones | payment-integration | 12 | Billing trimestral + anual (2 meses gratis) |
| 14 | Boost/Publicidad | payment-integration | 12 | Checkout dinámico; prioridad de feed por tier |
| 15 | Creator Marketplace (escrow Opción B) | payment-integration | 12 | Hold 72h + transfer diferido + disputas |
| 16 | Marketplace de Tiendas | payment-integration | 12 | Mensualidad + destination charge directo |
| 17 | Paneles Admin (Global, Domain, Moderador) | frontend-developer + security-auditor | 12-16, 22-27 | 3 roles por RLS; acciones admin auditadas |
| 18 | Broadcast Global (modelo pull) | backend-architect | 0,17 | Post global aparece en N dominios sin fan-out masivo |
| 19 | Endurecimiento final (auditoría RLS, performance, partición) | security-auditor + database-optimizer | todo | `supabase-audit-rls` + `multi-tenant-safety-checker` en verde |
| 20 | Lanzamiento dual (comunidadlatina.com + dominicanos.com) | deployment-engineer | 19 | Dos dominios en producción con datos aislados |

### 11.3 Épicas NUEVAS de moat, IA-producto y growth (21–30)

| # | Épica | Agente sugerido | Depende de | Criterio de "hecho" | Fuente |
|---|---|---|---|---|---|
| 21 | **Infra de embeddings** (pgvector, `content_embeddings`, pipeline de indexado) | ai-engineer + database-architect | 0 | Búsqueda semántica por tenant con RLS; HNSW | 09 §4 |
| 22 | **Escudo Anti-Estafa** (clasificador fraude + verificador notarios/DOJ + `fraud_signals`) | ai-engineer | 21,25 | Intercepta listing fraudulento en test; verifica notario contra directorio | 09 §2.2 |
| 23 | **Asistente Comunitario** (RAG sobre datos del tenant) | ai-engineer | 21,5 | Responde preguntas con data real del tenant; cache semántico | 09 §4.1 |
| 24 | **Matching inteligente** (roommate/trabajo/servicios por embeddings + Trust) | ai-engineer | 21,1 | Sugerencias por compatibilidad semántica + re-rank por Trust | 09 §4.2 |
| 25 | **Trust Score 2.0** (multi-señal, explicable, portable + endorsements + decay) | backend-architect + ai-engineer | 1 | Score con antigüedad/verificaciones/reportes; "sube lento, baja rápido"; export | 09 §2.1 / 08 |
| 26 | **Guías "Cómo hacer X"** (base de conocimiento hiperlocal + SEO programático) | seo-content-writer + backend-architect | 5,7 | Guías por país×ciudad indexables; SEO on-page | 09 §3.1 |
| 27 | **Copiloto de Negocios** (IA genera listing/anuncios para el dueño) | ai-engineer | 7,14 | Sube 3 fotos → listing + 3 anuncios + sugerencia de Boost | 09 §4.6 |
| 28 | **Growth loops + gamificación** (invita-3, WhatsApp share, streaks, badges, quiet hours) | frontend-developer | 6,25 | Loops medibles (K-factor instrumentado); notif ≤2/día | 08 |
| 29 | **Playbook de Nacimiento de Tenant** (seed engine, cuentas ancla, dashboard masa crítica, kill-switch) | backend-architect + ai-engineer | 2,17,26 | Abrir un tenant corre el pipeline 4-estados desde el panel global | 08 + idea creativa §7.4 |
| 30 | **Onboarding "Recién Llegado / Día 1"** (flujo de máxima necesidad) | frontend-developer | 1,5 | Nuevo usuario ve valor (eventos/negocios) en 1 tap; <60s | idea creativa §1.3 |

> **Nota para el orquestador:** las épicas 7–11 y 21 son paralelizables tras F1; las de moat (22–27) son paralelizables entre sí tras 21+25; 12 (Stripe) sigue siendo el cuello de botella de monetización. Cada épica corre con boundaries de archivo claros y su gate de tests (aislamiento RLS obligatorio en toda tabla nueva).

---

## 12. Riesgos y mitigaciones

| # | Riesgo | Gravedad | Mitigación |
|---|---|---|---|
| 1 | **Fuga de datos cross-tenant** (RLS mal aplicado) | 🔴 Crítica | Defensa en profundidad: RLS FORCE + policy generada + suite de tests de aislamiento como gate de CI + `get_advisors`. Ninguna tabla se mergea sin verde. |
| 2 | **El "valle" financiero** (~$43k, 12–15 meses antes de girar) | 🔴 Crítica | Pago anual (2 meses gratis) para adelantar cashflow; equipo chico; foco en supply-side pago (break-even ~12–15 negocios/tenant), no en MAU. |
| 3 | **Pérdida de la marca "Comunidad Latina"** (oct-2026) | 🔴 Crítica | Adelantar `comunidadlatina.com` vivo + transacción real; confirmar con abogado si es Sección 8 o abandono; archivar 4 semanas antes. |
| 4 | **Daño a usuarios por exposición de estatus migratorio** (subpoenas ICE) | 🔴 Crítica | Privacy-by-design (§3.3): no preguntar/inferir estatus, alias por defecto, KYC solo en Stripe, política de solicitudes de autoridades. |
| 5 | **Concentración de canal** (dependencia de influencers dominicanos) | 🟠 Alta | Validar conversión influencer→negocio-pago en el piloto antes de comprometer los 8 dominios; construir lado oferta (embajadores) en paralelo. |
| 6 | **Explosión de costo de video** (1 viral ≈ $250 de delivery) | 🟠 Alta | Video corto gratis con tope 15s; largo premium con tope de minutos; alerta de costo de delivery por tenant. |
| 7 | **Cold-start → pueblos fantasma** (lo que mató a Homeis) | 🟠 Alta | Playbook de Nacimiento de Tenant (§7.4): seed + cuentas ancla + masa crítica antes de abrir; kill-switch. |
| 8 | **Domain Admin malicioso** (discriminación, venta de datos, contenido ilegal) | 🟠 Alta | Domain Admin Agreement (indemnización, revocación); logs auditables; nunca puede desactivar la moderación legal central. |
| 9 | **Alcance ambicioso** (producto completo = mucho para el enjambre) | 🟠 Alta | Track Marca temprano entrega valor tangible ya; roadmap por fases con hitos verificables; épicas con boundaries claros. |
| 10 | **Dependencia de proveedores de IA** (precios/discontinuación) | 🟡 Media | Diseño provider-agnostic (interfaces); Perspective ya descartado por su cierre 2026. |
| 11 | **Disputas/chargebacks en Creator Marketplace** | 🟡 Media | Escrow Opción B; refunds desde balance plataforma; `transfer reversal` explícito; fee de disputa lo absorbe la plataforma. |
| 12 | **Repetir el patrón de la empresa anterior** (no entregar → cliente quemado + litigio) | 🟠 Alta | Entregable tangible temprano (track Marca); documentación fechada de todo; comunicación de avances concretos, no promesas. |

---

## 13. Decisiones pendientes de Geovanny

Con default razonable para no bloquear al enjambre. Solo estas dependen del dueño del negocio:

1. **Naturaleza del deadline de la marca** (Sección 8 vs. umbral de abandono) — *confirmar con abogado de marcas esta semana*. Sin default: determina la estrategia legal completa. **URGENTE.**
2. **Escrow del Creator Marketplace** — default: **Opción B** (captura + transfer diferido). Confirmar porque define cómo se comunica al negocio ("tu pago está protegido hasta que confirmes").
3. **Ventana de revisión del escrow** — default: **72h**.
4. **Primer(os) tenant(s) a lanzar** — propuesta: **`comunidadlatina.com` (marca) + `dominicanos.com` (tracción) en paralelo**. Confirmar.
5. **¿"Vender el sistema a socios/franquicia" entra al roadmap?** — default: **no** (backlog; la arquitectura ya lo permite a costo marginal si se decide).
6. **Revenue-share con Domain Admins** — default: **no** (100% centralizado; si sí, vía connected account).
7. **Stripe: Express v1 vs. Accounts v2** — default: **Express v1**; resolver con backend antes del sprint de pagos.
8. **Plan Vercel exacto** (según dominios previstos a 12 meses) — default: **Pro** como piso; cotizar Enterprise si se superan los límites prácticos.
9. **Alcance del Asistente de Trámites migratorios** — **Fase 2**, y **requiere revisión legal previa** (línea roja: nunca dar asesoría legal).

> Precios de **mensualidad de Tienda** y **Video Premium**: ya **resueltos** en §5.2 (no requieren decisión, solo validación de willingness-to-pay tras 90 días).

---

## 14. Referencias

**Informes técnicos** (`docs/investigacion/`): 01 arquitectura multi-tenant + datos · 02 app white-label multi-dominio · 03 benchmark Sngine/competidores · 04 monetización Stripe Connect · 05 IA moderación + media · 06 módulos sociales · 07 infra/DevOps/admin.

**Power-ups** (`docs/investigacion/power-up/`): 08 growth/retención · 09 diferenciación/IA-producto · 10 unit economics/pricing · 11 legal/compliance · 12 go-to-market.

**Versiones:** `docs/versiones/PLAN_MAESTRO_v1.md` (V1 técnica, detalle tarea-por-tarea de épicas 0–20). Estado de trabajo: `docs/PROGRESS.md`.

---

*Fin del Plan Maestro V2.0. Documento vivo — se endurece a V3 tras el pase de "abogado del diablo" (§ crítica adversarial) para robustez y escalabilidad.*





# PLAN MAESTRO — Comunidad Latina (alias NYLabel)

**La infraestructura de confianza y llegada del inmigrante latino.**

| | |
|---|---|
| **Cliente** | Geovanny (Global Super Admin, operador de la red) |
| **Desarrollo** | INSIGHTS (Juan · Federico · Lisandro) |
| **Versión** | **4.0** — Orientada a construcción. Integrada, blindada por dos pases adversariales, y lista para que un enjambre de agentes construya el **producto completo**. |
| **Fecha** | 2026-07-06 |
| **Estado** | CANON — fuente de verdad única del proyecto |
| **Ejecutor previsto** | **Fable 5 en modo Workflow (ultracode)** orquestando agentes especializados + revisión humana senior en los gates de seguridad. |
| **Insumos** | 7 informes técnicos + 5 power-ups + diseño (13) + **dos** veredictos del abogado del diablo (V2 y V3), todos en `docs/investigacion/`. Versiones previas en `docs/versiones/`. |

> **Qué cambió de la V3 a la V4.** La V3 era un plan estratégico excelente pero seguía siendo un documento de *decisión*, estructurado alrededor de gates de validación de mercado que **bloqueaban** la construcción. **Decisión del cliente (2026-07-06): construir el producto completo YA**, con Fable 5 orquestando el enjambre, sin frenar por validación de campo. La V4 respeta eso y hace tres cosas: **(1)** reorienta el plan de "validar y después construir" a **"construir el producto completo por rebanadas verticales, con la validación corriendo en paralelo y sin bloquear el código"**; **(2)** integra las correcciones del segundo pase adversarial (`VEREDICTO-V3-segundo-pase.md`) directamente en la arquitectura, la economía y el copy — para que el enjambre construya la versión correcta, no los errores; **(3)** agrega el detalle de ejecución que el enjambre necesita (§14) y los datos de ejemplo que destraban el arranque (§18). El objetivo del cliente está **intacto**: producto completo, red social white-label multi-tenant, diseño premium, salvar la marca.

---

## ★ Concepto unificador (leer antes que nada)

**Comunidad Latina NO es una red social. Es la infraestructura de confianza y llegada del inmigrante latino.**

El inmigrante que llega a EE.UU. aterriza **sin historial en el país nuevo**: sin crédito, sin red, sin reputación, sin saber en quién confiar. Cae en Facebook Groups caóticos, en Craigslist lleno de estafas, en un notario que le cobra $6.000 y le arruina el caso migratorio. **Ese vacío de confianza es el problema que resolvemos.**

- La **red social** es el *sustrato*.
- La **confianza verificable** es el *producto*.
- El **comercio local** (negocios, profesionales, inmobiliarias) es el *motor económico* — el lado que paga.

**La frase de una línea:** *"El lugar donde el latino que recién llega encuentra a su gente, resuelve su vida y construye su reputación en el país nuevo — sin caer en estafas."*

Cuatro principios de producto (criterio de priorización a lo largo del plan): **Reputación portable · Onboarding "Recién Llegado / Día 1" · Anti-scroll (medir resoluciones, no tiempo) · Playbook de Nacimiento de Tenant.**

---

## Índice

1. [Visión del producto](#1-visión-del-producto)
2. [Estrategia de ejecución: producto completo por rebanadas](#2-estrategia-de-ejecución-producto-completo-por-rebanadas) ⭐
3. [El Moat legal-safe (y por qué entra desde la primera rebanada)](#3-el-moat-legal-safe)
4. [Diseño premium y experiencia de usuario](#4-diseño-premium-y-experiencia-de-usuario)
5. [Arquitectura, seguridad y minimización de datos (anti-honeypot)](#5-arquitectura-seguridad-y-minimización-de-datos) ⭐ *reforzado en V4*
6. [Unit economics honesta y modelo de negocio](#6-unit-economics-honesta)
7. [Monetización](#7-monetización)
8. [IA: moderación + IA como producto](#8-ia-moderación--ia-como-producto)
9. [Growth, cold-start y retención](#9-growth-cold-start-y-retención)
10. [Go-to-Market y validación en paralelo](#10-go-to-market-y-validación-en-paralelo)
11. [Legal y compliance](#11-legal-y-compliance)
12. [Paneles de administración + Broadcast Global](#12-paneles-de-administración)
13. [Roadmap del producto completo](#13-roadmap-del-producto-completo)
14. [Plan de ejecución para el enjambre (Fable 5)](#14-plan-de-ejecución-para-el-enjambre) ⭐ *núcleo operativo de la V4*
15. [Riesgos y mitigaciones](#15-riesgos-y-mitigaciones)
16. [Decisiones de Geovanny (en paralelo, no bloquean el código)](#16-decisiones-de-geovanny)
17. [Referencias](#17-referencias)
18. [Datos de ejemplo para destrabar la construcción](#18-datos-de-ejemplo) ⭐ *nuevo en V4*

---

## 1. Visión del producto

Un **motor único** (Next.js + Supabase) que sirve **N redes sociales independientes por país de origen** — `dominicanos.com`, `colombianos.com`, y el buque insignia `comunidadlatina.com` — cada una con su dominio, branding, moneda e idioma, sobre el mismo código y la misma base de datos, con datos **aislados por `tenant_id` + RLS**. Un **Global Super Admin** (Geovanny) administra todas y emite Broadcast Global cross-tenant.

El usuario central es el **latino inmigrante**, con foco en el **recién llegado**, que vive tres dolores agudos: **no sabe en quién confiar** (estafas), **no encuentra a su gente ni sus servicios**, y **es invisible para el sistema** (sin historial local). La plataforma lo **recibe**, lo **protege**, lo **conecta** y lo **hace visible** — en español, mobile-first, instalable sin App Store (PWA), con diseño que transmite seguridad desde el primer segundo (§4).

**Modelo de negocio:** Geovanny opera las comunidades y monetiza el **comercio local (supply-side)** — negocios, profesionales, inmobiliarias. **El usuario común no paga.** El North Star de negocio es **"cuentas de negocio pagas por tenant"**; el North Star de producto es **"resoluciones"** (dolores resueltos, no tiempo en pantalla).

**El destino es el producto completo:** 5 feeds (Principal, Propiedades, Negocios, Profesionales, Eventos), marketplaces, moat de IA, 3 paneles. La §2 explica cómo el enjambre lo construye entero sin ahogarse.

---

## 2. Estrategia de ejecución: producto completo por rebanadas ⭐

### 2.1 La regla del enjambre: rebanadas verticales, no capas horizontales

El objetivo es el **producto completo**. Pero un enjambre que intenta construir 31 épicas en paralelo, todas a medio terminar, produce un pantano inmantenible (evidencia 2026: el código de IA sin integrar es *comprehension debt* que nadie puede rescatar). La disciplina que evita eso **sin recortar el alcance**:

**Construir el producto completo como una secuencia de rebanadas verticales, cada una entregable y demostrable de punta a punta (DB → RLS → API → UI → diseño premium), en un orden que pone valor real en pantalla temprano y deja lo caro/riesgoso para cuando la base esté firme.**

Esto NO es "hacer un MVP". Es **secuenciar la construcción del producto completo** para que cada rebanada compile, pase sus gates de seguridad, y sea demostrable a Geovanny — en vez de un big-bang que nunca llega a verde. El motor multi-tenant se construye bien desde el día 1 (rehacerlo después es caro).

### 2.2 La primera rebanada demostrable (lo que Geovanny ve funcionando primero)

La rebanada #1 es la más chica que entrega una **resolución real** y demuestra que el motor camina de punta a punta:

- **Motor multi-tenant + auth + white-label premium + PWA** (la base sobre la que se monta todo).
- **1 vertical con dolor agudo — Vivienda verificada anti-estafa** en `dominicanos.com`: publicar/buscar un depto, con el **verificador determinístico** y el **Escudo Anti-Estafa** (parte del moat, §3) YA presentes — para que el producto no salga desnudo contra Zillow.
- **1 flujo de pago** (membresía de presencia verificada para el lado oferta, §7).
- **Contacto protegido dentro de la app** (no "copiá el link a WhatsApp") — para no regalar el engagement.
- **Onboarding "Recién Llegado"** honesto sobre lo que ya existe.
- **Moderación básica + minimización de datos anti-honeypot desde el primer registro** (§5).

A partir de ahí, el enjambre **ensancha** al producto completo (feeds sociales, negocios, profesionales, eventos, marketplaces, moat de IA completo, 2º dominio) siguiendo §13 y §14.

### 2.3 "Avance" = una resolución real, nunca "una pantalla de login linda"

Para un cliente ya quemado por progreso falso, la regla se mantiene: el hito que se le muestra a Geovanny no es login+branding+PWA (útil como base, se comunica como *"la base ya camina"*), sino *"un dominicano recién llegado encontró un depto verificado en la app, sin caer en una estafa"*. La base tangible de corto plazo es demo, no "el producto ya resuelve".

### 2.4 La validación corre en paralelo, no bloquea el código

El segundo veredicto mostró supuestos de mercado sin probar (¿pagan los landlords?, ¿vuelve el usuario o se va a WhatsApp?). En vez de frenar la construcción, esas preguntas se convierten en un **track paralelo de Geovanny** (§10) que corre mientras el enjambre construye — y **calibra** los precios/gates con datos reales a medida que llegan, sin detener el desarrollo. El código no espera; el negocio aprende en simultáneo.

---

## 3. El Moat legal-safe

> El moat es lo que hace que un inmigrante *no pueda* obtener el mismo valor en Facebook. **Corrección clave de la V4:** el moat NO se pospone entero a Fase 2 — sus piezas determinísticas y de bajo riesgo legal entran **desde la primera rebanada**, o el producto sale a competir contra Zillow sin diferenciador. Fuente de producto: `power-up/09` (⚠️ ese informe todavía describe el Escudo como "IA que intercepta el fraude antes de que ocurra" — la versión **legalmente tóxica**; rige esta §3, no el 09).

Tres capas que una red generalista no puede copiar sin reconstruirse alrededor del inmigrante:

**① 🛡️ Escudo Anti-Estafa (determinístico + comunitario, NO "IA que promete").** Entra en la rebanada #1. **(a)** Señales de riesgo de la comunidad (reportes ponderados por Trust Score del reportante) + **(b)** **verificación determinística** contra fuentes oficiales fechadas: verificación del que publica vía Stripe Identity (solo flag, §5), cruce con registros públicos de propiedad, y verificador de notarios/abogados con **la palabra correcta** — *"licencia activa según el registro oficial del DOJ al [fecha]; esto NO garantiza conducta, confirmá siempre por tu cuenta"*. **Nunca** un badge mudo "Verificado" que la plataforma no puede respaldar (§11 — riesgo de negligent misrepresentation).

**② 🤖 Asistente Comunitario.** RAG sobre datos del tenant (pgvector), con **guardrails duros a nivel de retrieval**: nunca genera plazos, montos ni interpretación de elegibilidad; devuelve texto citado de fuente oficial + derivación ("hablá con un abogado verificado"). El "Asistente de Trámites" (I-130/I-765/TPS/DACA) es **fase avanzada y requiere revisión de un abogado de inmigración ANTES de construirse** (UPL — FTC v. DoNotPay).

**③ ⭐ Trust Score 2.0 — reputación sin dossier subpoenable.** Reputación multi-señal y explicable, diseñada para **no acumular el grafo identidad-ubicación-red que una subpoena de ICE quiere** (§5): verificación de identidad **fuera de la base** (flag booleano), score computado sin persistir un grafo de endorsements reconstruible. "Reputación portable" = una **prueba firmada puntual** que el usuario exporta, no un historial que retenemos.

**④ 📖 Guías "Cómo hacer X siendo latino aquí".** Base de conocimiento hiperlocal (licencia sin SSN, ITIN, banco, derechos ante ICE) curada de **fuentes oficiales citadas** — utilidad real + **SEO orgánico masivo**. Bajo riesgo legal.

**Moonshots** (fase avanzada, cada uno con su gate legal): reputación portable como prueba puntual · intérprete en vivo ES↔EN · remesas transparentes (comparador informativo, sin tocar dinero). **El costo de la defensa legal del moat (seguro E&O, revisión de abogado, verificación determinística) está en la economía §6.**

---

## 4. Diseño premium y experiencia de usuario

> Requisito del cliente: *"lo más importante"*. Detalle completo: `docs/investigacion/13-diseno-ux-premium.md`. Nivel objetivo: agencia top (Linear, Airbnb, Revolut). Todo el sistema de tokens, tipografía, componentes y wireframes de ese informe rige tal cual.

### 4.1 La tesis: el diseño ES el producto de confianza
Para alguien que ya fue estafado, **el diseño es la primera prueba de confianza** — en 3 segundos decide si "esto parece serio". **Posicionamiento visual:** calidez de comunidad latina + rigor de fintech seria (Revolut/Mercado Pago) + claridad de infraestructura crítica (Linear). Nunca "otro Facebook azul genérico".

### 4.2 Design system white-label premium (el truco que escala a N tenants)
- **3 capas de tokens.** El admin del tenant entrega **un solo hex de marca**, que pasa por un **pipeline automático** (contraste WCAG + escala tonal generada) y se usa **solo en 4 lugares fijos** (CTA, nav activo, acentos, logo) — nunca como fondo masivo. 50 tenants, 50 colores, todos premium.
- **Tipografía:** General Sans / Clash Display (headings) + Plus Jakarta Sans (body/UI) — variables, gratuitas, soporte pleno de ñ. Prohibido Inter/Roboto/Arial.
- **Paleta base:** neutros con **temperatura cálida**; **colores semánticos fijos** (éxito/alerta/peligro) nunca derivados de la marca.
- **Componentes:** patrón **Double-Bezel** en toda tarjeta de confianza. Iconografía **Phosphor**; prohibido emoji como ícono funcional.
- **Motion:** física de resorte, feedback <100ms, skeletons (no spinners); modales de alto riesgo (pagos, borrar cuenta) deliberadamente más lentos.

### 4.3 UX inclusiva
- **Onboarding "Recién Llegado":** 5 pasos, <60s, cero texto libre en los primeros 3, aterriza en un feed **ya poblado y filtrado** (nunca vacío). **En la rebanada #1, honesto sobre lo que existe** (no ofrecer 5 verticales si solo vivienda está viva).
- **Sistema de confianza visible:** Trust Score con gramática visual fija (barra de 5 segmentos + número + nivel + ícono), siempre clickeable. "Reportar estafa" en posición fija idéntica en todas las superficies.
- **Accesibilidad WCAG AA como piso.** Anti-scroll por diseño (CTA de destino sobre scroll infinito).
- **Guardrail de consistencia:** ningún admin de tenant edita tipografía, neutros, espaciado, sombras, iconografía, motion ni layout — solo alimenta el pipeline de marca.

---

## 5. Arquitectura, seguridad y minimización de datos ⭐

> Principios canónicos (informes 01/02/07). La V4 **eleva la minimización de datos anti-honeypot** de un ítem de checklist a un principio de arquitectura de primer nivel, tras el segundo veredicto.

### 5.1 Principios innegociables (canon)
Shared schema + `tenant_id` + RLS `FORCE` (un solo Supabase) · JWT claim `tenant_id` desde **`app_metadata`** (nunca `user_metadata`) vía Custom Access Token Hook · policy reusable con `(select fn())` (initPlan) · **UUID v7** · fan-out on read + keyset · Broadcast Global pull · provider-agnostic · **PWA-first** · Supabase Auth (no NextAuth).

### 5.2 Seguridad multi-tenant reforzada (gates bloqueantes)
El Riesgo #1 es la **fuga cross-tenant**, y el modo de falla real no es "policy mal escrita" sino **"la policy que nunca se escribió"** (CVE-2025-48757; Moltbook fue vulnerada a los 3 días por Supabase sin RLS). Mitigaciones **obligatorias y bloqueantes**:

1. **Enumerador que falla el build:** un check en CI recorre `information_schema` y **rompe el pipeline** ante cualquier tabla con `tenant_id` sin RLS `FORCE` + las 4 policies. Enumera por vos, no confía en una suite escrita a mano por el agente.
2. **Cobertura más allá de Postgres:** el mismo gate valida **Storage policies** (paths `tenant_id/…`), **autorización de canales Realtime** y Edge Functions (que jamás derivan `tenant_id` del body). El veredicto marcó que estos vectores (y fallas de *connection-pool contamination* / *async-context leak*) viven fuera de lo que un enumerador de esquema ve — por eso también el pentest humano (punto 3).
3. **Pentest humano adversarial antes del primer dato real de un usuario.**
4. **Firma humana senior:** un ingeniero con dominio real de Postgres RLS + Stripe Connect **lee y firma cada migración y cada webhook** antes de que toquen datos o dinero. **Su ancho de banda es el verdadero límite de velocidad del proyecto** (§14.4) — el ritmo de migraciones se subordina a su capacidad de lectura, no a la del enjambre.

### 5.3 Migraciones forward-only y versionadas
El enumerador RLS corre en **cada migración incremental**, no solo en el build inicial — la construcción agrega tablas/RLS a un esquema **ya en producción con datos reales de población perseguible**; cada migración pasa el mismo gate + firma senior.

### 5.4 Privacy-by-design anti-honeypot (decisión V4: minimización agresiva) ⭐
El producto agrega población deportable segmentada por nacionalidad — es, por su existencia, un objetivo para subpoenas de ICE (cientos emitidas a plataformas en feb-2026; varias grandes cumplieron voluntariamente). **RLS no protege contra una subpoena.** La única defensa es que el dato valioso **no exista o sea inútil**. Principios que el enjambre implementa **desde el primer registro**:

- **Login sin teléfono por default:** email o passkey. El teléfono es opcional y, si se da, se guarda hasheado/tokenizado, no en claro.
- **Geolocalización siempre aproximada** (zona/barrio, nunca `point` exacto público). La dirección exacta de un listing solo se revela tras contacto confirmado, y no se persiste el historial de "quién vio qué dirección".
- **IP y logs de acceso con TTL corto** (borrado automático vía `pg_cron`): el dato que se borra rápido no es subpoenable después.
- **Mensajería privada cifrada** de forma que la plataforma no pueda descifrar el contenido (E2E o equivalente) — un mensaje que no podemos leer no lo podemos entregar.
- **Verificación de identidad FUERA de la base:** Stripe Identity procesa el documento y devuelve **solo un flag booleano**; la imagen y el dato legal **nunca tocan nuestro Postgres**.
- **Trust Score sin grafo persistente reconstruible.** "Reputación portable" = prueba firmada puntual, no dossier.
- **Análisis de exposure por cada tabla nueva** (checklist legal en cada migración): cualquier vínculo identidad-ubicación se minimiza u ofusca.
- **Política de Solicitudes de Autoridades** definida antes del lanzamiento: litigación por default + notificación al usuario salvo prohibición legal, responsable claro. Presupuestada (§6): seguro E&O + fondo legal, que la V3 omitía.

### 5.5 Stack canónico (resumen)
Next.js + **Vercel Pro** (Hobby topa en 50 dominios y prohíbe uso comercial) · Supabase (Postgres + Auth + Storage + Realtime + Edge Functions + pgmq + pg_cron + **pgvector**) · **Supabase Storage** en F0 → **Cloudflare R2** (media pública, egress $0) cuando el feed escale + **Cloudflare Stream** (video, fase posterior) · **Stripe Connect Express** + **Stripe Identity** · OpenAI `omni-moderation` (gratis) + Gemini 2.5 Flash (zona gris/IA producto) + Google Vision · Resend (email) · Twilio (SMS, fase posterior) · Sentry. Variables en `.env.example`; costos en §6.

### 5.6 Configuración progresiva y degradación elegante (construir sin todas las credenciales)
El enjambre construye con las credenciales que hay; **las que faltan NO rompen la app — degradan con elegancia.** Un helper central (`lib/config/services.ts`) deriva flags de la presencia de cada env var (`isStripeConfigured`, `isResendConfigured`, …) y la UI reacciona. Regla de oro: **nunca un error técnico crudo al usuario; siempre un estado premium coherente con el §4.**

| Servicio | Env var | Estado hoy | Comportamiento si falta |
|---|---|---|---|
| **Supabase** | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ puesto | Obligatorio; sin esto la app no arranca (fallar rápido con mensaje claro en dev). |
| **OpenAI** | `OPENAI_API_KEY` | ✅ puesto | Moderación de texto activa. |
| **Stripe** | `STRIPE_*` | ⏳ falta | Toda acción de pago abre `<ProximamentePremium feature="pagos" />`: cartel con el design system (Double-Bezel, tono cálido) — *"Estamos terminando de configurar los pagos. Va a estar disponible muy pronto."* El botón nunca rompe; loguea el intento. |
| **Resend** | `RESEND_API_KEY` | ⏳ falta | Los emails se saltan/encolan sin romper el flujo; donde el usuario esperaría un email, aviso suave *"por ahora te avisamos dentro de la app"*. |
| **Google Vision** | `GOOGLE_VISION_API_KEY` | ⏳ falta | **Seguridad primero:** sin Vision, las imágenes subidas **NO se publican sin moderar** — van directo a la cola manual (Tier 3) marcadas "pendiente de revisión". En dev, mock configurable que aprueba. Nunca publicar imagen sin moderar en producción. |
| **Sentry** | `NEXT_PUBLIC_SENTRY_DSN` | ⏳ falta | No inicializa; la app corre igual (sin captura de errores). Se agrega antes de exponer a usuarios reales. |
| **Vercel** | `VERCEL_*` | ⏳ falta | Provisión automática de dominios deshabilitada (se hace manual). No bloquea desarrollo local. |

**Componente reusable `<ProximamentePremium feature=… />`** (o `<ServicioPendiente>`): un **estado premium** — no un `alert()` ni un 500 — que comunica "próximamente" con calidez, reutilizable para cualquier integración aún no configurada. Copy en español, tono §4, cero jerga técnica. Es el patrón por default para todo servicio del cuadro que esté en ⏳.

---

## 6. Unit economics honesta

> La V3 corrigió el tamaño del valle pero dejó los "gates" contando mal. La V4 usa los **números honestos del segundo veredicto** — porque un plan que se miente sobre cuándo llega el break-even es el que se queda sin runway creyendo que ya salió del pozo.

### 6.1 North Star: cuentas de negocio pagas por tenant (no MAU)
El supply-side genera casi todo el margen; el usuario común (98%+) es inventario de atención. North Star de negocio: **"cuentas de negocio pagas por tenant"**. North Star de producto: **"resoluciones"**.

### 6.2 El valle real y el break-even honesto
- **Valle a financiar (1 dominio):** ~**$210-235k** (opex real $13.2k/mes con moderación humana CSAM + legal + soporte; influencers $40-60k; adquisición B2B; **seguro E&O + fondo legal** del §5.4).
- **Break-even honesto (corrección del 2º veredicto):** 15 cuentas de negocio pagando **NO** pagan un dominio — cubren **~8,5% del opex** (~$1.125/mes vs $13.200/mes). El break-even real de un dominio es **~160 cuentas pagas**, o **~$8k MRR neto/dominio**. *Esto no cambia si construimos ya — cambia lo que Geovanny debe esperar: el dominio no "camina solo" con 15 negocios; ese es el 8% del camino.* Decirlo ahora evita el corte de capital por sorpresa en el mes 10.
- **CAC B2B real:** cerrar un landlord desconfiado sin marca es **$300-700** (venta humana), no $150. **CAC separado por canal y por lado del mercado** desde el día 1.

### 6.3 Churn estructural del listado (a mitigar por producto, no por optimismo)
Un marketplace de vivienda tiene churn estructural: el landlord que alquiló ya no necesita el listado (LTV de Inmobiliaria Pro cae de ~$2.765 a ~$300 si el ingreso está atado al listado). **Mitigación de diseño (§7):** el ingreso principal es **"presencia verificada"** que el negocio paga aunque no tenga vacante (más un componente pay-per-lead), no una membresía atada a tener un aviso activo.

---

## 7. Monetización

> Fuente técnica: power-up 04. Precios de ejemplo en §18 (calibrar con el track de validación §10).

**Los 4 flujos** (se activan en secuencia): **Membresías / Presencia Verificada** (Stripe Billing — el primero, para el supply-side; **ingreso no atado a tener un listado activo**, para vencer el churn estructural §6.3) · **Boost geolocalizado** (Checkout one-time) · **Creator Marketplace** (destination charge + escrow Opción B: captura + transfer diferido 72h — fase posterior) · **Marketplace de Tiendas** (mensualidad, sin comisión). Una **sola cuenta Stripe de plataforma**; revenue por `tenant_id` en metadata; la DB propia es la fuente de verdad. Webhooks: firma por SDK, body crudo, idempotencia por `event.id`, `2xx` <200ms.

**Pago anual (2 meses gratis)** = prioridad para adelantar cashflow. **Pay-per-lead** como alternativa/complemento a la membresía (referencia: Thumbtack $35-60/lead) — el negocio paga por valor entregado, no por estar. Fuentes nuevas: "Destacado del mes", lead-gen premium, publicidad geo cross-tenant (solo el Global Admin).

---

## 8. IA: moderación + IA como producto

> Fuentes: 05 (moderación/media) + 09 (IA producto — rige §3 para el encuadre legal). Guardrails en §3/§11.

**Moderación 3 niveles:** score = fusión ponderada (70% IA + 20% Trust Score + 10% reincidencia) con reglas duras para CSAM. Ruteo: 0-30 auto · 31-70 monitorea/Gemini Flash · 71-100 cola del Moderador (**humano** — presupuestado §6). Texto ES → OpenAI `omni-moderation` (gratis); imagen → Google Vision; **CSAM/NCMEC día 1** (PhotoDNA, flujo separado). Async con pgmq.

**IA como producto** (Asistente, Matching, Copiloto de Negocios, Resúmenes): pgvector + router multi-modelo + cache semántico (pocos $/mes/tenant), con **RLS por tenant** y los **guardrails legales de §3** (nunca consejo, siempre cita + derivación). Provider-agnostic.

---

## 9. Growth, cold-start y retención

> Fuente: power-up 08. Ajustado por ambos veredictos.

### 9.1 Cold-start LEGAL (no scraping)
El "seed vía scraping" es el método que costó **$60M a RadPad** (Craigslist) — inaceptable con litigio activo. **Seed solo de fuentes legítimas:** data licenciada (MLS/IDX con acuerdo), APIs oficiales (Google Places, Eventbrite), y **opt-in directo**. Nada de scrapear y republicar. + cuentas ancla (10-15 fundadores reales) + masa crítica mínima. **Un dominio con densidad**, no 8 vacíos.

### 9.2 Retención propia, no regalada a WhatsApp
Corrección del 2º veredicto: si el usuario descubre en la app pero cierra en WhatsApp, el engagement se va y el D30 real cae a 8-12%. **Diseño para retener adentro:** **contacto protegido dentro de la app** (no "copiá el link"), el Asistente Comunitario y los Resúmenes de Comunidad como razones de volver, y medir **re-uso por evento** (vuelve en la próxima mudanza/necesidad), no solo D30 diario. La coexistencia (login/share con WhatsApp) es un **canal de entrada**, no el lugar donde vive el valor.

### 9.3 Playbook de Nacimiento de Tenant (honesto: minutos + semanas)
La **infraestructura** de un tenant se crea en minutos (fila + branding + dominio); la **comunidad viva** toma semanas de curación humana. El Playbook automatiza lo automatizable (seed legal, branding por IA, dashboard de masa crítica, kill-switch) y **presupuesta el trabajo humano por dominio** (§6). El 2º dominio se abre tras densidad real del 1º.

---

## 10. Go-to-Market y validación en paralelo

> El track de validación corre **mientras el enjambre construye** — no bloquea el código; calibra precios/metas con datos reales.

- **Track construcción (enjambre):** §14. Arranca ya.
- **Track validación (Geovanny, en paralelo):** (1) **20-30 entrevistas** a landlords/inmobiliarias que sirven inmigrantes: ¿cuánto pagan hoy en lead-gen?, ¿pagarían por leads netos que Zillow no da? → calibra el precio de §18. (2) **Prueba de demanda** (los influencers dominicanos traen usuarios reales al `dominicanos.com` a medida que sale). (3) **Legal de marca** (§11.1) y **consulta de honeypot/UPL** con abogado.
- **`comunidadlatina.com` en paralelo para la MARCA:** asegurar el *specimen* USPTO con **uso genuino** (no una transacción manufacturada — §11.1) antes de octubre.
- **Activación de influencers sin "spike y muerte":** la FTUE <60s que entrega valor real en el primer minuto. QR con referral; pago escalado por usuario **activo**, no por registro.
- **Lado oferta (los que pagan):** embajadores locales reclutan landlords/negocios con **opt-in**. Alianzas: remesadoras, credit unions latinas, asociaciones de realtors.

---

## 11. Legal y compliance

> Fuente: power-up 11. Mapa de riesgos para el abogado de Geovanny, no asesoría. Litigio previo activo: **documentación fechada de todo.**

1. **🔴 Marca "Comunidad Latina" (URGENTE):** confirmar en TSDR/TESS si octubre 2026 es deadline de **Sección 8** o umbral de **abandono** — cambia la estrategia. **El specimen debe ser uso GENUINO** (un puñado de usuarios reales pagando por un servicio real bajo el nombre exacto, sostenido semanas antes del deadline), **no una transacción manufacturada de una cuenta fundadora** — eso es *sham use* y puede gatillar cancelación por fraude (USPTO expandió auditorías de specimens en 2025-26).
2. **Moat legal-safe (§3):** "verificado" = verificación determinística contra fuente oficial fechada; **nunca lenguaje que implique aval o seguridad** ("de confianza", "seguro") — solo descriptor literal + disclaimer ("esto NO garantiza conducta; nunca envíes dinero por adelantado"). Emitir un badge de aval crea deber de cuidado y saca la protección de §230 (Roommates.com) → **negligent misrepresentation**. **Seguro E&O** presupuestado (§6). Asistente de Trámites solo tras revisión de abogado de inmigración (UPL — FTC v. DoNotPay).
3. **Privacidad de población perseguible (§5.4):** minimización agresiva de datos, verificación fuera de la DB, Política de Solicitudes de Autoridades. La única defensa contra subpoena es que el dato no exista.
4. **Seed legal:** solo MLS/IDX licenciado, APIs oficiales u opt-in. Cero scraping+republicación.
5. **CSAM/NCMEC día 1;** Sección 230 + tendencia a más responsabilidad (KOSA); DSA si hay UE.
6. **Pagos:** Stripe Connect cubre money-transmitter; 1099-NEC lo emite la plataforma (≥$600/año); Stripe Tax.
7. **Multi-tenant:** un solo ToS/Privacy maestro; **Domain Admin Agreement** (indemnización, revocación); el Domain Admin nunca puede desactivar la moderación legal central.

---

## 12. Paneles de administración

Tres paneles sobre la misma app, diferenciados por **rol + RLS** (nunca por infraestructura): **Global Super Admin** (Geovanny: todos los tenants, revenue consolidado, crea tenants, Broadcast Global, planes globales) · **Domain Admin** (solo su tenant: módulos on/off, aprobar contenido, stats locales; escritura cross-tenant solo vía RPC `security definer` auditada) · **Moderador** (cola de moderación de su dominio). **Broadcast Global = modelo pull** (`broadcasts` + `broadcast_targets` + `broadcast_receipts`). Todo bajo la firma humana de seguridad (§5.2).

---

## 13. Roadmap del producto completo

> Rebanadas verticales hacia el producto completo. Cada rebanada compila, pasa sus gates de seguridad (§5.2) y es demostrable. El "Track Marca" corre en paralelo por la fecha de octubre. Los porcentajes de negocio (break-even §6.2) se calibran con el track de validación §10 — **no bloquean la construcción**.

| Rebanada | Contenido | Gate técnico para avanzar |
|---|---|---|
| **R0 — Cimientos** | Motor multi-tenant + auth (login sin teléfono §5.4) + white-label premium + PWA + observabilidad + **minimización de datos anti-honeypot** | Enumerador RLS verde + pentest + firma senior |
| **R1 — Wedge con moat** | Vivienda verificada anti-estafa en `dominicanos.com` + **Escudo Anti-Estafa determinístico + verificador notario/abogado** + Trust Score base + 1 pago (presencia verificada) + contacto protegido + onboarding + diseño premium | Gate técnico + "una resolución real" demostrable |
| **R2 — Red social completa** | 5 feeds (Principal/Propiedades/Negocios/Profesionales/Eventos) + grupos/Q&A + stories + notificaciones + realtime + Trust Score 2.0 | Gate técnico por release |
| **R3 — Moat de IA + monetización completa** | Asistente Comunitario (RAG+guardrails) + Matching + Copiloto de Negocios + Guías + Creator Marketplace (escrow) + Tiendas + Boost | Revisión de abogado antes del moat sensible; firma senior en pagos |
| **R4 — Escala multi-tenant** | Playbook de Nacimiento + 2º dominio + Broadcast Global + panel global consolidado | Pentest por dominio nuevo |
| **R5 — Producto completo + moonshots** | N dominios, reputación portable, intérprete en vivo, remesas comparador, i18n/Europa | Gate legal por moonshot |

**Endurecimiento (transversal):** auditoría RLS con enumerador + pentest humano + firma senior antes de cada release que toque datos o dinero.

---

## 14. Plan de ejecución para el enjambre (Fable 5) ⭐

> Núcleo operativo de la V4. Input directo para Fable 5 en modo Workflow/ultracode. El detalle tarea-por-tarea de las épicas técnicas vive en la V1 (`docs/versiones/PLAN_MAESTRO_v1.md §11`) y el catálogo de épicas 0-30 en la V2 (`docs/versiones/PLAN_MAESTRO_v2.md §11`); la V4 los **reordena por rebanadas** y agrega los gates de seguridad humana.

### 14.1 Regla de oro para el orquestador
**Construir por rebanadas verticales, no por capas horizontales.** Cada rebanada llega a verde (compila + gates de seguridad + demostrable) antes de ensanchar. Nada monetizable espera a que "casi todo" esté listo. Ver §2.1.

### 14.2 Secuencia por rebanada (épicas de la V2 reagrupadas)

| Rebanada | Épicas (V2) | Foco | Gate de seguridad |
|---|---|---|---|
| **R0** | 0 (fundaciones+RLS), 1 (auth/Trust base), 2 (white-label), 3 (storage), 4 (observabilidad), 6 (PWA) + **arquitectura anti-honeypot §5.4** + **4 Diseño premium** | motor multi-tenant que camina | **enumerador RLS + pentest + firma senior antes del 1er dato real** |
| **R1** | slice de 7 (Propiedades) + **22-24 slice del Escudo/verificador determinístico** + 9 (moderación básica), 13 (membresía/presencia verificada), 30 (onboarding), contacto protegido | wedge con moat, en 1 dominio | gate técnico + firma senior en el pago |
| **R2** | resto de 7 (negocios/prof./eventos), 5 (feeds), 8 (comunidad), 10 (notif), 11 (realtime), 25 (Trust Score 2.0) | red social completa | firma senior por release |
| **R3** | 21 (pgvector), 26-27 (Asistente/Matching/Copiloto), 12 (Stripe Connect), 14-16 (Boost/Creator/Tiendas) | moat de IA + monetización | **revisión de abogado antes del moat sensible**; firma senior en pagos |
| **R4** | 17 (paneles), 18 (Broadcast pull), 28 (growth), 29 (Playbook), 19 (endurecimiento) | 2º dominio + multi-tenant real | pentest por dominio nuevo |
| **R5** | 20 (lanzamiento) + moonshots | N dominios | gate legal por moonshot |

### 14.3 Agentes sugeridos por dominio
database-architect (datos/RLS), frontend-developer (app/PWA/UI), backend-architect (módulos/realtime), payment-integration (Stripe), ai-engineer (moderación/moat IA), security-auditor (gates), ui-ux-designer (diseño premium), seo-content-writer (guías). Skills de CI en cada PR: `supabase-audit-rls`, `multi-tenant-safety-checker`, `security-auditor`, `secret-leak-detector`.

### 14.4 El cuello de botella a respetar (no negociable)
El **ingeniero senior humano** que firma cada migración RLS y cada webhook es un recurso **serial**; el enjambre produce en paralelo a 3-5× su velocidad y "0% de los PRs de IA son mergeables tal cual". **Regla para Fable 5:** encolar las migraciones para revisión y **subordinar el ritmo a la capacidad de firma del senior** — nunca mergear una migración de datos/dinero sin su firma, por más presión de calendario. Si el senior no está contratado (§16), R0 no arranca la parte de datos reales. El enjambre propone; el humano responsable aprueba.

### 14.5 Modelo y razonamiento sugeridos
```
🤖 MODELO: Fable 5 en ultracode (orquestación del enjambre) · Opus en los gates
   RAZONAMIENTO: Máx en diseño de RLS, webhooks de pago, arquitectura anti-honeypot
   y decisiones de seguridad (código en producción con datos de población vulnerable);
   Sonnet/Medio para implementación mecánica.
   Revisión humana senior OBLIGATORIA en seguridad multi-tenant y en dinero.
```

---

## 15. Riesgos y mitigaciones

| # | Riesgo | Mitigación V4 |
|---|---|---|
| 1 | **Fuga cross-tenant** (RLS por enjambre) | Enumerador que falla el build + cobertura Storage/Realtime + **pentest humano** + firma senior antes de datos reales (§5.2) |
| 2 | **App = honeypot para ICE** (riesgo humano) | **Minimización agresiva de datos** desde el 1er registro: login sin teléfono, geo aproximada, TTL corto, mensajería E2E, verificación fuera de la DB, Política de Autoridades (§5.4) |
| 3 | **Break-even mal entendido** | Números honestos a Geovanny: 15 negocios = 8% del opex; break-even real ~160 cuentas / ~$8k MRR (§6.2); ingreso no atado al listado (§7) |
| 4 | **Wedge desnudo vs Zillow** | Un pedazo del moat (Escudo + verificador determinístico) **dentro de R1** (§3, §13) |
| 5 | **Retención regalada a WhatsApp** | Contacto protegido dentro de la app + Asistente + Resúmenes; medir re-uso por evento (§9.2) |
| 6 | **Marca vence octubre / specimen sham** | Track Marca en paralelo con **uso genuino**, no transacción manufacturada; confirmar Sección 8 vs abandono ya (§11.1) |
| 7 | **Moat = responsabilidad civil** | Verificación determinística, copy sin aval, disclaimers, revisión legal, seguro E&O (§3, §11) |
| 8 | **Senior humano se satura / no existe** | Ritmo subordinado a su firma; contratado antes de R0-datos (§14.4, §16) |
| 9 | **Código IA inmantenible** | Rebanadas verticales a verde; firma senior; simplicidad antes que features; documentación por release |
| 10 | **Cliente quemado / capital no confirmado** | Entregar resolución real rápido (R1); números honestos; confirmar capital antes de escalar gasto (§16) |
| 11 | **Cold-start / pueblos fantasma** | Seed legal + anclas + 1 dominio con densidad; 2º dominio tras densidad real (§9) |
| 12 | **Documentos-fuente contradictorios** | El informe 09 (Escudo "que promete") queda **superado por §3**; el enjambre construye §3, no el 09 |

---

## 16. Decisiones de Geovanny (en paralelo, no bloquean el código)

Estas se resuelven mientras el enjambre construye R0/R1. Solo la #4 bloquea la parte de **datos reales** (no el andamiaje).

1. **🔴 Naturaleza del deadline de la marca** (Sección 8 vs. abandono) — TSDR, esta semana.
2. **Precio del supply-side** — calibrar con las entrevistas (§10); mientras, usar los de ejemplo (§18).
3. **🔴 Capital del valle (~$210-235k)** — confirmar por escrito antes de escalar el gasto (no bloquea R0/R1, sí bloquea influencers/2º dominio).
4. **🔴 Ingeniero senior humano de seguridad** — quién firma RLS y pagos. **Bloquea el primer dato real** (§14.4). No opcional.
5. Escrow Creator Marketplace = Opción B (fase posterior, confirmar).
6. Tenants iniciales: `dominicanos.com` (tracción) + `comunidadlatina.com` (marca) — confirmar.
7. Stripe Express v1 vs. Accounts v2 (default Express); Plan Vercel Pro.
8. Alcance del Asistente de Trámites — fase avanzada, requiere abogado de inmigración.

---

## 17. Referencias

**Técnicos** (`docs/investigacion/`): 01 arquitectura+datos · 02 app white-label · 03 benchmark · 04 pagos · 05 IA/media · 06 módulos sociales · 07 infra/admin · **13 diseño premium+UX**.
**Power-ups** (`docs/investigacion/power-up/`): 08 growth · 09 diferenciación/IA (encuadre legal: rige §3) · 10 economics · 11 legal · 12 GTM.
**Crítica:** `VEREDICTO-abogado-del-diablo.md` (1er pase, sobre V2) · **`VEREDICTO-V3-segundo-pase.md`** (2º pase, sobre V3 — origen de las correcciones de la V4).
**Versiones:** `docs/versiones/` (V1 técnica · V2 integrada · **V3** ruta validada). Estado: `docs/PROGRESS.md`. Handoff: `docs/HANDOFF.md`. Env: `.env.example` + `docs/SETUP-ENV.md`.

---

## 18. Datos de ejemplo para destrabar la construcción ⭐

> Para que el enjambre construya sin esperar decisiones de Geovanny. **Todo lo marcado `[EJEMPLO]` es placeholder** — funciona para desarrollar, se reemplaza con los datos reales/validados antes de cobrar de verdad. Ninguno bloquea el código.

**Tenant piloto `[EJEMPLO]`:** slug `dominicanos`, dominio `dominicanos.com`, marca hex `#1A5EDB`, idioma `es`, moneda `USD`, ciudad seed `Queens, NY`.

**Precios de supply-side `[EJEMPLO]` (calibrar con §10):**
- Presencia Verificada — Negocio: `$19 / $29⭐ / $49` mensual.
- Presencia Verificada — Inmobiliaria: `$149 / $299 / $599` trimestral.
- Pay-per-lead (alternativa): `$35-60 / lead`.
- Boost geolocalizado: `$10-60` one-time por alcance.
- Video Premium: `$4.99` con tope de minutos (+Pro `$14.99`).

**Cuentas ancla `[EJEMPLO]` para seed legal:** 10-15 perfiles fundadores reales (opt-in), nunca listings ficticios que un landlord real detecte.

**Gates numéricos objetivo `[EJEMPLO]`, a recalibrar con datos reales:** ~$8k MRR neto/dominio a mes 6 · D30 8-12% + re-uso por evento · churn <50% a 60 días post-alquiler.

**Contenido seed de Guías `[EJEMPLO]`:** top 15 temas × top 5 ciudades (ITIN, licencia sin SSN, banco con ITIN, derechos ante ICE, alquilar sin crédito…), generado con IA + revisión humana, siempre citando fuente oficial.

---

*Fin del Plan Maestro V4.0 — orientada a construcción. Mismo objetivo que siempre (producto completo multi-tenant, diseño premium, salvar la marca), ahora con los números honestos, el moat desde la primera rebanada, la arquitectura anti-honeypot, el copy legalmente seguro, y un plan de ejecución por rebanadas listo para que Fable 5 lo construya orquestando el enjambre, con la validación de mercado corriendo en paralelo. Listo para la sesión de construcción.*

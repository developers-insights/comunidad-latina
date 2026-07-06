# PLAN MAESTRO — Comunidad Latina (alias NYLabel)

**La infraestructura de confianza y llegada del inmigrante latino.**

| | |
|---|---|
| **Cliente** | Geovanny (Global Super Admin, operador de la red) |
| **Desarrollo** | INSIGHTS |
| **Versión** | **3.0** — Definitiva. Integrada, blindada (abogado del diablo) y pulida a nivel premium |
| **Fecha** | 2026-07-06 |
| **Estado** | CANON — fuente de verdad única del proyecto |
| **Ejecutor previsto** | Enjambre de agentes orquestados (Fable 5, modo Workflow) + revisión humana senior en los gates críticos |
| **Insumos** | 7 informes técnicos + 5 power-ups + informe de diseño (13) + VEREDICTO del abogado del diablo, todos en `docs/investigacion/`. Versiones previas en `docs/versiones/`. |

> **Qué cambió de la V2 a la V3.** La V2 tenía la visión, el moat, la economía y el growth — pero un pase adversarial de 5 fiscales (premisas, mercado, viabilidad técnica-legal, números, ejecución) demostró que estaba *estructurada para no terminar*, con una economía subestimada 5-6×, un moat que era pasivo legal, y una contradicción de raíz entre "confianza verificada" y "privacidad para población perseguible". La V3 **no cambia el objetivo** (producto completo, red social white-label multi-tenant) — cambia la **ruta**: de un big-bang de 31 épicas a una **ruta validada** que pone valor real en manos de usuarios reales rápido, con diseño premium desde el primer pixel, y escala solo sobre evidencia. Misma meta, ruta que no se muere en el camino. El detalle del veredicto que la moldeó vive en `docs/investigacion/VEREDICTO-abogado-del-diablo.md`.

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
2. [Estrategia de ejecución: la ruta validada](#2-estrategia-de-ejecución-la-ruta-validada) ⭐ *núcleo de la V3*
3. [El Moat: por qué nadie nos copia (legal-safe)](#3-el-moat-por-qué-nadie-nos-copia-legal-safe)
4. [Diseño premium y experiencia de usuario](#4-diseño-premium-y-experiencia-de-usuario) ⭐ *nuevo pilar*
5. [Arquitectura y seguridad](#5-arquitectura-y-seguridad)
6. [Unit economics y modelo de negocio (corregido)](#6-unit-economics-y-modelo-de-negocio-corregido)
7. [Monetización](#7-monetización)
8. [IA: moderación + IA como producto](#8-ia-moderación--ia-como-producto)
9. [Growth, cold-start y retención](#9-growth-cold-start-y-retención)
10. [Go-to-Market y lanzamiento](#10-go-to-market-y-lanzamiento)
11. [Legal y compliance](#11-legal-y-compliance)
12. [Paneles de administración + Broadcast Global](#12-paneles-de-administración--broadcast-global)
13. [Roadmap del producto completo](#13-roadmap-del-producto-completo)
14. [Plan de ejecución para el enjambre](#14-plan-de-ejecución-para-el-enjambre)
15. [Riesgos y mitigaciones](#15-riesgos-y-mitigaciones)
16. [Decisiones pendientes de Geovanny](#16-decisiones-pendientes-de-geovanny)
17. [Referencias](#17-referencias)

---

## 1. Visión del producto

Un **motor único** (Next.js + Supabase) que sirve **N redes sociales independientes por país de origen** — `dominicanos.com`, `colombianos.com`, y el buque insignia `comunidadlatina.com` — cada una con su dominio, branding, moneda e idioma, sobre el mismo código y la misma base de datos, con datos **aislados por `tenant_id` + RLS**. Un **Global Super Admin** (Geovanny) administra todas y emite Broadcast Global cross-tenant.

El usuario central es el **latino inmigrante**, con foco en el **recién llegado**, que vive tres dolores agudos que nadie resuelve bien: **no sabe en quién confiar** (estafas), **no encuentra a su gente ni sus servicios**, y **es invisible para el sistema** (sin historial local). La respuesta: una plataforma que lo **recibe**, lo **protege**, lo **conecta** y lo **hace visible** — en español, mobile-first, instalable sin App Store, y con un diseño que transmite seguridad desde el primer segundo (§4).

**Modelo de negocio:** Geovanny opera las comunidades y monetiza el **comercio local (supply-side)** — negocios, profesionales, inmobiliarias. **El usuario común no paga** (es la demanda que hace valioso el lado oferta). *Refinamiento explícito del brief original ("cobrar a usuarios finales"): el análisis económico (§6) mostró que quien paga y sostiene el margen es el supply-side, no el usuario común — de ahí el North Star "cuentas de negocio pagas".* "Vender el motor a terceros" = backlog, no core.

**El destino es el producto completo** (5 feeds —Principal, Propiedades, Negocios, Profesionales, Eventos—, marketplaces, moat de IA, 3 paneles). La §2 explica cómo se llega ahí **sin morir en el intento**.

---

## 2. Estrategia de ejecución: la ruta validada ⭐

> Esta sección es el corazón de la V3 y la respuesta directa a la causa de muerte #1 del veredicto: *"el plan está estructurado para no terminar; decidió el producto completo antes de validar la única pregunta que importa."*

### 2.1 El principio: misma meta, ruta validada

El objetivo no cambia: **el producto completo multi-tenant**. Lo que cambia es cómo se construye. Un producto de 31 épicas construido de una vez, antes de que un solo usuario lo toque, contra una marca que vence en octubre y un cliente ya quemado, es la receta exacta del fracaso anterior. La V3 adopta una regla innegociable:

**Ninguna épica cara (marketplaces, moat de IA, 2º dominio) se construye hasta que una rebanada delgada del producto haya demostrado, con usuarios y dinero reales, que la gente la quiere.**

Esto no es "hacer un MVP en vez del producto completo". Es **secuenciar el producto completo** para que cada tramo se pague (en aprendizaje y en ingresos) el siguiente. El motor multi-tenant se construye bien desde el día 1 (rehacerlo después es caro); lo que se **valida de a uno** es el mercado.

### 2.2 La primera rebanada: un wedge, no una plataforma

La rebanada #1 en producción (meta: **~60 días**, no 10 meses) es lo más chico que entrega una **resolución real** a un usuario real:

- **1 dominio** — `dominicanos.com` (los influencers) con densidad, no 8 en paralelo (evita el cementerio hiperlocal — Patch quemó $200-300M ahí).
- **1 wedge de dolor agudo** — un dolor "hair-on-fire" que Facebook/WhatsApp resuelven MAL. **Recomendado: Vivienda verificada anti-estafa** (ver §2.3).
- **1 flujo de pago simple** — membresía de listado destacado para el lado oferta (landlords/inmobiliarias), sin escrow, sin marketplace complejo.
- **Diseño premium desde el primer pixel** (§4) — porque para un estafado, el diseño es la primera prueba de confianza.
- **Cero features de IA-moat riesgosas** en este corte (nada de "asistente de trámites" ni "verificación por IA" con exposición legal — §3, §11).

### 2.3 Por qué Vivienda anti-estafa es el wedge (decisión a validar con Geovanny)

| Criterio | Por qué gana |
|---|---|
| **Dolor agudo** | Perder el depósito de un alquiler (o caer en un sublet falso) es catastrófico y frecuente para el recién llegado. Es "hair-on-fire", no "nice to have". |
| **Transaccional** | Buscar/publicar un depto es una acción con intención y final claro (una *resolución*), no scroll. |
| **Lado oferta que paga** | Landlords e inmobiliarias son el segmento de **mayor LTV** del modelo (power-up 10: Inmobiliaria hasta $599/3m). Y tienen presupuesto real, a diferencia de la lonchería de $1.000/año. |
| **Moat legal-safe** | La "verificación" acá puede ser **determinística** (identidad del que publica vía Stripe Identity, cruce con registros públicos de propiedad) — no una IA que "promete" y crea responsabilidad. |
| **Coexistencia** | Se integra al comportamiento actual (compartir el listing verificado por WhatsApp) en vez de pedir que abandonen Facebook. |

*Alternativa: Trabajo verificado. Se decide con Geovanny; el resto del plan es agnóstico al wedge exacto.*

### 2.4 Los gates de validación (antes de gastar en lo caro)

La rebanada se considera validada — y recién ahí se libera la siguiente inversión — cuando, en `dominicanos.com`, se cumplen **con datos reales**:

1. **Resolución real:** **≥50 usuarios** (en ~60 días) encontraron/publicaron vivienda y reportan que evitó una estafa o cerró un trato (North Star de "resoluciones", no MAU).
2. **Retención:** **D30 ≥ 25-30%** real (no seed, no cuentas ancla — usuarios de verdad volviendo; benchmark de producto transaccional, no de red social pura).
3. **Willingness-to-pay probado:** **≥12-15 landlords/inmobiliarias pagando** membresía, sostenido **tras el mes 3** (no el spike del lanzamiento).

> Los umbrales son diana a calibrar con los primeros datos, pero **el gate no se cruza sin un número**: un gate sin cifra es una intención, no un gate.

Si no pasa los gates, se itera el wedge — **no se abre un 2º dominio ni se construye el moat de IA**. Esto convierte el kill-switch de "riesgo" en disciplina de capital.

### 2.5 Redefinir "avance" (y qué se le muestra a Geovanny)

El veredicto fue quirúrgico: *login + branding + PWA es "progreso falso"* — las piezas más fáciles y las menos correlacionadas con resolver un dolor. Para un cliente que ya fue víctima de progreso falso, mostrar pantallas es nitroglicerina.

**Regla:** "avance" = **una resolución real de un usuario real**. El primer hito que ve Geovanny no es una pantalla de login — es *"un dominicano recién llegado encontró un depto verificado en la app y no lo estafaron"*. (Nota operativa: el avance tangible de corto plazo —login, branding white-label, PWA instalable— sigue siendo útil como demo, pero se comunica como *"la base ya camina"*, nunca como *"el producto ya resuelve"*. La diferencia la nota un cliente quemado.)

### 2.6 La secuencia completa hacia el producto completo

```
Rebanada #1 (wedge vivienda, 1 dominio, diseño premium)  ──► GATES ──►
  Expandir módulos en el mismo dominio (negocios, profesionales, eventos, feeds sociales)  ──► GATES ──►
    Moat de IA legal-safe + marketplaces + monetización completa  ──► PMF confirmado ──►
      2º dominio (Playbook de Nacimiento) ──► ... ──► Producto completo multi-tenant (el destino)
```

Cada flecha es un gate de validación, no un hito de calendario. El producto completo de la §13 **es el destino**; esta ruta es cómo se llega vivo.

---

## 3. El Moat: por qué nadie nos copia (legal-safe)

> La V2 describía un moat potente pero **legalmente tóxico** (el veredicto lo llamó "responsabilidad civil disfrazada de feature": FTC v. DoNotPay, negligent misrepresentation). La V3 conserva el moat y lo hace **defendible en la práctica y en un tribunal**. Fuente de producto: `power-up/09`.

El moat vive en 3 capas que una red generalista no puede copiar sin reconstruirse alrededor del inmigrante: **confianza verificada, utilidad accionable, e IA sobre datos propietarios del tenant**. Las 4 features núcleo, reformuladas legal-safe:

**① 🛡️ Escudo Anti-Estafa.** NO "IA que intercepta el fraude antes de que ocurra" (eso es vaporware y crea deber de cuidado). SÍ: **(a)** señales de riesgo de la comunidad (reportes ponderados por Trust Score del reportante) + **(b)** **verificación determinística** contra fuentes oficiales fechadas — identidad del que publica vía Stripe Identity, cruce con registros públicos de propiedad, verificación de notarios/abogados **con la palabra correcta**: *"licencia activa según el registro oficial del DOJ al [fecha], confirmá siempre por tu cuenta"* (no un badge "Verificado" mudo que la plataforma no puede respaldar). La diferencia entre esto y la V2 es la diferencia entre una feature y una demanda.

**② 🤖 Asistente Comunitario.** RAG sobre datos del tenant (pgvector), con **guardrails duros a nivel de retrieval**: nunca genera plazos, montos ni interpretación de elegibilidad; devuelve texto citado de fuente oficial + derivación ("hablá con un abogado verificado"). El "Asistente de Trámites" (I-130/I-765/TPS/DACA) es **Fase 2 y requiere revisión de un abogado de inmigración ANTES de construirse** — es UPL (unauthorized practice of law) si cruza de "explicar" a "aconsejar".

**③ ⭐ Trust Score 2.0 — reputación sin dossier subpoenable.** Reputación multi-señal y explicable, PERO diseñada para **no acumular el grafo identidad-ubicación-red que una subpoena de ICE quiere** (ver §5.4): la verificación de identidad se hace **fuera de la base** (Stripe Identity devuelve un *flag booleano*, se descarta el documento), y el score se computa sin persistir un grafo de endorsements reconstruible. La "reputación portable" se entrega como una **prueba puntual** (un certificado firmado que el usuario exporta), no como un historial que la plataforma retiene.

**④ 📖 Guías "Cómo hacer X siendo latino aquí".** Base de conocimiento hiperlocal (licencia sin SSN, ITIN, banco, derechos ante ICE) curada de **fuentes oficiales citadas** — utilidad real + **SEO orgánico masivo**. Bajo riesgo legal (información citada, no consejo).

**Moonshots** (Fase avanzada, cada uno con su gate legal): reputación portable como prueba puntual · intérprete en vivo ES↔EN · remesas transparentes (comparador informativo, sin tocar dinero). **Costo de la defensa legal del moat** (seguro E&O, revisión de abogado, verificación determinística) **está contemplado en la economía §6** — la V2 lo había omitido.

---

## 4. Diseño premium y experiencia de usuario ⭐

> Nuevo pilar (requisito del cliente: *"lo más importante"*). Detalle completo: `docs/investigacion/13-diseno-ux-premium.md`. Nivel objetivo: agencia top (Linear, Airbnb, Revolut).

### 4.1 La tesis: el diseño ES el producto de confianza

Para alguien que ya fue estafado, **el diseño es la primera prueba de confianza** — antes de leer una palabra, en 3 segundos decide si "esto parece serio". El pulido no es cosmético: es parte del producto de seguridad. **Posicionamiento visual:** calidez de comunidad latina + rigor de fintech seria (Revolut/Mercado Pago) + claridad de infraestructura crítica (Linear). **Nunca** "otro Facebook azul genérico" ni "diseño infantilizado para inmigrantes".

### 4.2 Design system white-label premium (el truco que escala a N tenants)

- **Arquitectura de 3 capas de tokens.** El admin del tenant entrega **un solo color de marca (un hex)**, que pasa por un **pipeline automático** (validación de contraste WCAG + generación de escala tonal) y se usa **solo en 4 lugares fijos** (CTA, nav activo, acentos, logo) — nunca como fondo masivo. Resultado: **50 tenants, 50 colores, todos premium**, porque el admin nunca toca el DOM directo.
- **Tipografía:** General Sans / Clash Display (headings) + Plus Jakarta Sans (body/UI) — variables, gratuitas, con soporte pleno de ñ y acentos. Prohibido Inter/Roboto/Arial.
- **Paleta base:** neutros con **temperatura cálida** deliberada (nunca gris frío ni negro puro). **Colores semánticos fijos** (éxito/alerta/peligro), nunca derivados de la marca del tenant.
- **Componentes:** patrón **Double-Bezel** (shell + core, radios concéntricos, sombras cálidas) en toda tarjeta de confianza. Iconografía **Phosphor** (línea 1.5-2px); prohibido emoji como ícono funcional.
- **Motion:** física de resorte, feedback háptico <100ms, skeletons (no spinners), y **modales de alto riesgo (pagos, borrar cuenta) deliberadamente más lentos** — comunican "pensalo antes de confirmar".

### 4.3 UX inclusiva para el inmigrante

- **Onboarding "Recién Llegado":** 5 pasos, **<60s**, cero texto libre en los primeros 3 (selección con ícono+texto), aterriza en un feed **ya poblado y filtrado** (nunca vacío).
- **Sistema de confianza visible:** el Trust Score tiene una **gramática visual fija** (barra de 5 segmentos + número + nivel + ícono, nunca solo color) y **siempre es clickeable** para explicar el "por qué". "Reportar estafa" en **posición fija idéntica** en las 12+ superficies donde aplica.
- **Accesibilidad WCAG AA como piso:** contraste 4.5:1, targets ≥44px, foco visible, ES/EN completo, `prefers-reduced-motion`, color nunca como único indicador.
- **Anti-scroll por diseño:** las tarjetas favorecen un CTA de destino ("Ver detalles") sobre el scroll infinito adictivo — alineado al North Star de **resoluciones**.
- **Guardrail de consistencia:** ningún admin de tenant edita tipografía, neutros, espaciado, sombras, iconografía, motion ni layout — solo alimenta el pipeline de marca. Esto es lo que hace el white-label premium **escalable sin QA manual por tenant**.

---

## 5. Arquitectura y seguridad

> Principios canónicos (detalle en informes 01/02/07 y V1 técnica). La V3 **refuerza la seguridad** tras el veredicto: el enjambre de IA es, según evidencia 2026, la peor herramienta para la capa que no puede fallar.

### 5.1 Principios innegociables (canon)

Shared schema + `tenant_id` + RLS `FORCE` (un solo Supabase) · JWT claim `tenant_id` desde **`app_metadata`** (nunca `user_metadata`) vía Custom Access Token Hook · policy reusable con `(select fn())` (initPlan) · **UUID v7** · fan-out on read + keyset · Broadcast Global pull · provider-agnostic (moderación/video) · **PWA-first** · Supabase Auth (no NextAuth).

### 5.2 Seguridad multi-tenant reforzada (respuesta al veredicto)

El Riesgo #1 es la **fuga cross-tenant**, y el modo de falla real (CVE-2025-48757; 70% de apps hechas con IA con RLS off en ≥1 tabla) no es "policy mal escrita" sino **"la policy que nunca se escribió"** en 1 de ~40 tablas. Mitigaciones **obligatorias y bloqueantes**:

1. **Enumerador que falla el build:** un check en CI recorre `information_schema` y **rompe el pipeline** ante cualquier tabla con `tenant_id` sin RLS `FORCE` + las 4 policies. No es una suite que el agente puebla a mano — es un gate que enumera por vos.
2. **Cobertura más allá de Postgres:** el mismo gate valida **Storage policies** (paths `tenant_id/…`) y **autorización de canales Realtime** y Edge Functions (que jamás derivan `tenant_id` del body). El veredicto marcó que `supabase-audit-rls` solo no cubre estos vectores.
3. **Pentest humano adversarial antes del primer dato real** — una persona (no un agente IA) intenta romper el aislamiento. El atacante real será humano y motivado (un competidor de otro país, o algo peor).
4. **Firma humana senior:** un ingeniero con dominio real de Postgres RLS + Stripe Connect **lee, entiende y firma cada migración y cada webhook** antes de que toquen datos o dinero. El enjambre propone; un humano responsable aprueba. Esto está presupuestado en §6 (no era gratis).

### 5.3 Skills y gates de CI

`supabase-audit-rls`, `multi-tenant-safety-checker`, `security-auditor` corren en cada PR. Ninguna tabla se mergea sin sus tests de aislamiento en verde **y** la firma humana. Gate, no sugerencia. **Migraciones forward-only y versionadas:** el enumerador RLS (§5.2) corre en **cada migración incremental**, no solo en el build inicial — porque la ruta validada agrega tablas/columnas/RLS (F0→F1→F2) a un esquema **ya en producción con datos reales de población perseguible**; cada migración pasa el mismo gate + firma senior.

### 5.4 Privacy-by-design para población perseguible (contradicción resuelta)

El veredicto expuso una contradicción letal: el moat de "confianza verificada" construía el dossier que las subpoenas de ICE (cientos, feb-2026) quieren, y **RLS no protege contra una subpoena** (un juez firma y el dato sale). La V3 la resuelve **sacrificando lo que haga falta del moat por la seguridad de la población**:

- **Verificación de identidad FUERA de la base:** Stripe Identity procesa el documento y devuelve **solo un flag booleano**; la imagen y el dato legal **nunca tocan nuestro Postgres**.
- **Trust Score sin grafo persistente reconstruible:** el score se computa sin retener un historial de endorsements que desanonimice por correlación. La "reputación portable" es una prueba firmada puntual, no un dossier.
- **Análisis de exposure a subpoena por cada tabla nueva** (checklist legal): `profiles.phone`, geolocalización exacta, cualquier vínculo identidad-ubicación se minimiza o se guarda ofuscado (p. ej. geo aproximada, no `point` exacto).
- **Política de Solicitudes de Autoridades** definida antes del lanzamiento (proceso legal formal requerido, notificación al usuario salvo prohibición, responsable claro). El mejor dato para no ser subpoenado es el que no existe.
- **Retención mínima y TTL:** borrado por defecto y expiración de datos sensibles (geolocalización, teléfono, logs de acceso); el dato que se borra rápido no es subpoenable después — la retención complementa la minimización de captura.

### 5.5 Stack canónico (resumen)

Next.js + **Vercel Pro/Enterprise** (Hobby topa en 50 dominios) · Supabase (Postgres + Auth + Storage + Realtime + Edge Functions + pgmq + pg_cron + **pgvector**) · **Cloudflare R2** (media pública, egress $0) + **Cloudflare Stream** (video; Bunny solo premium/DRM) · **Stripe Connect Express** + **Stripe Identity** · OpenAI `omni-moderation` (gratis) + Gemini 2.5 Flash (zona gris) + Google Vision · Twilio · Resend · Sentry. Costos en §6.

---

## 6. Unit economics y modelo de negocio (corregido)

> La V2 usaba los números del power-up 10. El veredicto demostró que estaban subestimados 5-6× y que dos documentos del proyecto se contradecían. La V3 usa los **números honestos** — porque un plan que se miente sobre el capital es el que se queda sin runway en el valle.

### 6.1 North Star: cuentas de negocio pagas por tenant (no MAU)

El supply-side (negocios, profesionales, inmobiliarias) genera casi todo el margen; el usuario común (98%+) es inventario de atención. **La métrica que importa es "cuentas de negocio pagas por tenant", no usuarios.** Y el North Star de *producto* es **"resoluciones"** (§2.5).

### 6.2 El valle real: ~$235k, no $43k (corrección del veredicto)

| Componente | V2 (optimista) | V3 (real) | Por qué |
|---|---:|---:|---|
| Opex/mes | $6.000 | **$13.200** | Founder + **moderación humana** (CSAM obligatorio, no es cron) + soporte a negocios + legal |
| Opex 12 meses | $72k | **$158k** | — |
| Influencers | $5k | **$40-60k** | El propio GTM (power-up 12) lo presupuesta así — la V2 se contradecía |
| Seed (legal, ver §9) | $0 | incluido en opex | Curación humana de contenido local |
| Adquisición supply B2B | ~$0 | **~$14k** | **Cerrar un negocio es venta humana (~$150/cierre), no un signup de influencer** |
| Seguro E&O + revisión legal | $0 | **incluido** | Defensa del moat (§3) — la V2 lo omitió |
| **Total a financiar (1 dominio)** | ~$43k | **~$210-235k** | — |

*(La fila "Seed" es una sub-partida del opex, no un sumando aparte. El rango sale de: opex 12m $158k + influencers $40-60k + adquisición B2B ~$14k + E&O/legal, todo para UN dominio.)*

**La disciplina de la ruta validada (§2) es la principal defensa del valle:** un dominio con densidad —no 8 pueblos fantasma quemando en paralelo— mantiene la quema en el piso del rango mientras se prueba la hipótesis. **Geovanny necesita planificar financiar ~$210-235k, no $43k.** Decirlo ahora es lo que evita el colapso por runway en el mes 10.

### 6.3 CAC: dos máquinas distintas, no una

El error central de la V2: confundir el costo de **traer un consumidor** (barato, ~$12,50 vía influencer, y sube ola a ola por fatiga) con el de **cerrar una suscripción B2B** (venta humana, 3-8 toques, **~$150/cierre**). Un influencer de entretenimiento dominicano trae *consumidores*, no *dueños de negocio*. El modelo instrumenta **CAC separado por canal y por lado del mercado** desde el día 1.

### 6.4 Cómo entra el supply-side (resuelve el cold-start paradox)

El negocio no paga por entrar a una red vacía. Secuencia: **(1)** el wedge de vivienda trae *demanda* real (usuarios buscando depto); **(2)** a los landlords/inmobiliarias se les ofrece **listado gratis** al inicio + **prueba de ROI** (leads reales, visto/contactado); **(3)** se cobra la membresía **solo cuando el negocio ya vio el valor**. Willingness-to-pay se valida con **dinero real** (Van Westendorp tras 90 días), no con la hoja de cálculo. El break-even de "~12-15 negocios" es el **gate de validación** (§2.4), no un supuesto.

---

## 7. Monetización

> Fuente técnica: power-up 04. Precios: power-up 10.

**Los 4 flujos** (se activan en secuencia, no todos de golpe): **Membresías** (Stripe Billing — el primero, para el wedge: listado destacado de vivienda) · **Boost geolocalizado** (Checkout one-time) · **Creator Marketplace** (destination charge + escrow Opción B: captura + transfer diferido 72h — **Fase posterior, tras validar el wedge**) · **Marketplace de Tiendas** (mensualidad, sin comisión). Una **sola cuenta Stripe de plataforma**; revenue por `tenant_id` en metadata; la DB propia es la fuente de verdad. Webhooks: firma por SDK, body crudo, idempotencia por `event.id`, `2xx` <200ms.

**Precios resueltos:** Tienda **$19/$29⭐/$49**; Video Premium **$4.99 con tope de minutos** (+Pro $14.99 — el ilimitado da margen negativo). **Pago anual (2 meses gratis)** = prioridad #1 para adelantar cashflow y financiar el valle. Fuentes nuevas: "Destacado del mes", lead-gen premium, publicidad geo cross-tenant (solo el Global Admin).

---

## 8. IA: moderación + IA como producto

> Fuentes: 05 (moderación/media) + 09 (IA producto). El moat de IA legal-safe está en §3; los guardrails en §3/§11.

**Moderación 3 niveles:** score = fusión ponderada (70% IA + 20% Trust Score + 10% reincidencia) con reglas duras para CSAM. Ruteo: 0-30 auto · 31-70 monitorea/Gemini Flash · 71-100 cola del Moderador (**humano** — presupuestado en §6). Texto ES → OpenAI `omni-moderation` (gratis); imagen → Google Vision; **CSAM/NCMEC día 1** (PhotoDNA, flujo separado). Async con pgmq. Costo ~$120-253/mes/tenant (el video domina).

**IA como producto** (Asistente, Matching, Copiloto, Resúmenes): mismo stack (pgvector + router multi-modelo + cache semántico, pocos $/mes/tenant), con **RLS por tenant** (la IA de cada comunidad solo ve lo suyo) y los **guardrails legales de §3** (nunca consejo, siempre cita + derivación). Provider-agnostic (interfaces) — Perspective descartado por su cierre 2026.

---

## 9. Growth, cold-start y retención

> Fuente: power-up 08. Ajustado por el veredicto (seed legal; densidad de 1 dominio; coexistencia).

### 9.1 Cold-start LEGAL (no scraping)

El veredicto fue tajante: el "seed vía scraping ético" es el método exacto que costó **$60M a RadPad** (Craigslist), y para una empresa con litigio activo es inaceptable. **Seed solo de fuentes legítimas:** data licenciada (MLS/IDX con acuerdo), APIs oficiales (Google Places, Eventbrite), y **opt-in directo** (outreach a negocios/landlords que aceptan entrar). Nada de scrapear y republicar, nada de contactar a dueños de listings ajenos. + cuentas ancla (10-15 fundadores reales) + masa crítica mínima D7. **Un dominio con densidad**, no 8 vacíos.

### 9.2 Loops y retención

Loops virales (invita-3 → Trust Score; WhatsApp share) con K-factor instrumentado. Retención: Hook Model, gamificación del Trust Score (niveles/badges/streaks), daily rituals con **quiet hours** (máx. 2 notif/día), y **anti-scroll por diseño** (§4.3). **Coexistencia, no reemplazo:** login con WhatsApp, compartir a WhatsApp/TikTok — integrarse al comportamiento existente en vez de pedir que abandonen Facebook (el veredicto: "nadie prueba que la gente se vaya de donde ya está").

### 9.3 Playbook de Nacimiento de Tenant (honesto: minutos + semanas)

El veredicto marcó la contradicción "tenant en minutos" vs. "semanas de cold-start humano". La V3 lo dice sin humo: **la infraestructura de un tenant se crea en minutos** (fila + branding + dominio); **la comunidad viva toma semanas** de curación humana (verificar negocios, conseguir anclas, moderar). El Playbook automatiza lo automatizable (seed de fuentes legales, branding por IA, dashboard de masa crítica, kill-switch) y **presupuesta explícitamente el trabajo humano por dominio** (§6). El 2º dominio se abre solo tras PMF del 1º (§2.6).

---

## 10. Go-to-Market y lanzamiento

> Fuente: power-up 12, calibrado por el veredicto (1 dominio con densidad; coexistencia; metas honestas).

- **Un dominio con densidad primero:** `dominicanos.com` (los influencers), no 8 en paralelo. El 2º dominio espera al PMF (§2.6).
- **`comunidadlatina.com` en paralelo, versión mínima, para la MARCA:** asegura el *specimen* USPTO (nombre exacto vivo + 1 transacción real) antes de octubre. Función legal-estratégica, no de tracción.
- **Activación de influencers sin "spike y muerte":** la clave es la **FTUE <60s** del diseño (§4.3) que entrega valor real (un depto verificado) en el primer minuto — no un feed vacío. QR con referral tracking; pago escalado por usuario **activo**, no por registro.
- **Coexistencia:** el contenido se comparte hacia WhatsApp/TikTok; la app no pide abandonar Facebook, se inserta en el flujo existente.
- **Lado oferta (los que pagan):** embajadores locales (Trust Score alto) reclutan landlords/negocios con **opt-in** (nunca scraping). Alianzas: remesadoras, credit unions latinas, asociaciones de realtors.
- **Metas honestas:** calibradas al valle real de §6 — no los MRR agresivos de la V2. El hito que importa no es "$150k MRR en 16 semanas" sino **pasar los gates de validación (§2.4)**.

---

## 11. Legal y compliance

> Fuente: power-up 11. Es un mapa de riesgos para el abogado de Geovanny, no asesoría. Hay litigio previo activo: **documentación fechada de todo.**

1. **🔴 Marca "Comunidad Latina" (URGENTE, esta semana):** confirmar con abogado de marcas, vía TESS/TSDR, si octubre es deadline de **Sección 8** o umbral de **abandono** — cambia la estrategia. Specimen = sitio vivo bajo el nombre exacto + transacción real.
2. **Moat legal-safe (§3):** "verificado" = verificación determinística contra fuente oficial fechada, nunca un match de IA; Asistente con guardrails duros (sin plazos/montos/elegibilidad); Asistente de Trámites solo tras revisión de abogado de inmigración. **Seguro E&O** contemplado (§6).
3. **Privacidad de población perseguible (§5.4):** verificación fuera de la DB, sin dossier subpoenable, Política de Solicitudes de Autoridades. RLS no protege contra subpoena — minimizar el dato es la única defensa.
4. **Seed legal:** solo MLS/IDX licenciado, APIs oficiales u opt-in. Cero scraping+republicación (RadPad/Craigslist $60M).
5. **CSAM/NCMEC día 1;** Sección 230 + tendencia a más responsabilidad (KOSA); DSA si hay UE.
6. **Pagos:** Stripe Connect cubre money-transmitter; 1099-NEC lo emite la plataforma (≥$600/año); Stripe Tax.
7. **Multi-tenant:** un solo ToS/Privacy maestro; **Domain Admin Agreement** (indemnización, revocación) — el Domain Admin es el mayor riesgo estructural; nunca puede desactivar la moderación legal central.

---

## 12. Paneles de administración + Broadcast Global

Tres paneles sobre la misma app, diferenciados por **rol + RLS** (nunca por infraestructura): **Global Super Admin** (Geovanny: todos los tenants, revenue consolidado, crea tenants, Broadcast Global, planes globales) · **Domain Admin** (solo su tenant: módulos on/off, aprobar contenido, stats locales; escritura cross-tenant solo vía RPC `security definer` auditada) · **Moderador** (cola de moderación de su dominio). **Broadcast Global = modelo pull** (`broadcasts` + `broadcast_targets` + `broadcast_receipts`), no fan-out masivo. Todo bajo la firma humana de seguridad (§5.2).

---

## 13. Roadmap del producto completo

> **Reescrito bajo la ruta validada (§2).** Fases con **gates de validación**, no hitos de calendario. El destino es el producto completo; el orden garantiza llegar vivo. El "Track Marca" corre en paralelo por la fecha dura de octubre.

| Fase | Contenido | Gate para avanzar |
|---|---|---|
| **Track Marca** *(paralelo, urgente)* | `comunidadlatina.com` mínimo vivo + 1 transacción real bajo el nombre (ej. una membresía de listado comprada por una cuenta ancla/fundador) | Specimen archivado 4 semanas antes de octubre |
| **F0 — Rebanada #1 (el wedge)** | Motor multi-tenant + auth + **el wedge elegido** (recomendado: vivienda verificada anti-estafa; a confirmar §16.2) en `dominicanos.com` + 1 pago (membresía) + **diseño premium** + moderación básica | **Gates §2.4:** ≥50 resoluciones · D30 ≥25-30% · ≥12-15 landlords pagando post-mes-3 |
| **F1 — Expandir el dominio** | Feeds sociales completos + negocios + profesionales + eventos + grupos/Q&A + stories, todo en `dominicanos.com` | Retención y monetización sostenidas; supply-side creciendo |
| **F2 — Moat + monetización completa** | Moat de IA **legal-safe** (Escudo determinístico, Asistente con guardrails, Trust Score sin dossier) + Creator Marketplace (escrow) + Tiendas + Boost | PMF confirmado en 1 dominio |
| **F3 — Escala multi-tenant** | Playbook de Nacimiento de Tenant + 2º dominio + Broadcast Global + panel global consolidado | 2º dominio pasa sus propios gates |
| **F4 — Producto completo** | N dominios, moonshots (con sus gates legales), i18n/Europa | — |

**Endurecimiento (transversal a todas las fases):** auditoría RLS con enumerador + pentest humano + firma senior antes de cada release que toque datos o dinero (§5.2).

---

## 14. Plan de ejecución para el enjambre

> Input directo para Fable 5. El **detalle tarea-por-tarea de las épicas técnicas** vive en la V1 técnica (`docs/versiones/PLAN_MAESTRO_v1.md §11`) y el catálogo de épicas 0-30 en la V2 (`docs/versiones/PLAN_MAESTRO_v2.md §11`). La V3 **reordena esas épicas bajo la ruta validada** y agrega los gates de seguridad humana.

### 14.1 Regla de oro para el orquestador

**Construir por rebanadas verticales, no por capas horizontales.** El grafo de dependencias de la V2 (0→1→…→20) es correcto técnicamente, pero ejecutarlo por capas posterga todo el valor. En la V3, F0 toma **solo las tablas/épicas que el wedge de vivienda necesita** de cada capa (fundaciones mínimas + auth + un vertical + un pago + diseño), llega a producción, y recién entonces se ensancha. Nada monetizable espera a que "casi todo" esté listo.

### 14.2 Secuencia por fase (épicas de la V2 reagrupadas)

| Fase | Épicas involucradas (V2) | Foco | Gate de seguridad |
|---|---|---|---|
| **Track Marca** | subset de 0,1,2,3 + 1 pago | `comunidadlatina.com` mínimo + specimen | firma senior en el pago |
| **F0 — Wedge** | 0 (fundaciones+RLS), 1 (auth/Trust base), 2 (white-label), 3 (storage), 4 (observabilidad), 6 (PWA), **slice de 7 según el wedge** (Propiedades si es vivienda; si es Trabajo → épica de Empleo **no catalogada aún**, ver §16.2), 9 (moderación básica), 13 (membresía simple), 30 (onboarding), **+ 4 Diseño premium** | el wedge elegido en 1 dominio | **enumerador RLS + pentest humano + firma senior antes del 1er dato real** |
| **F1 — Ensanchar** | resto de 7 (negocios/prof./eventos), 5 (feeds), 8 (comunidad), 10 (notif), 11 (realtime), 25 (Trust Score 2.0) | red social completa en el dominio | firma senior por release |
| **F2 — Moat + \$** | 21 (pgvector), 22-24/26-27 (moat legal-safe), 12 (Stripe Connect), 14-16 (Boost/Creator/Tiendas) | moat defendible + monetización | **revisión de abogado antes del moat de IA**; firma senior en pagos |
| **F3 — Escala** | 17 (paneles), 18 (Broadcast pull), 28 (growth), 29 (Playbook Nacimiento), 19 (endurecimiento) | 2º dominio + multi-tenant real | pentest humano por dominio nuevo |
| **F4 — Completo** | 20 (lanzamiento) + moonshots | N dominios | gate legal por moonshot |

**Agentes sugeridos por dominio** (igual que V2): database-architect (datos/RLS), frontend-developer (app/PWA/UI), backend-architect (módulos/realtime), payment-integration (Stripe), ai-engineer (moderación/moat IA), security-auditor (gates), ui-ux-designer (diseño), seo-content-writer (guías). **Añadido no negociable de la V3:** un **ingeniero humano senior** revisa y firma cada migración RLS y cada webhook de dinero — no es un agente.

---

## 15. Riesgos y mitigaciones

| # | Riesgo | Mitigación V3 |
|---|---|---|
| 1 | **Fuga cross-tenant** (RLS por enjambre IA) | Enumerador que falla el build + cobertura Storage/Realtime + **pentest humano** + firma senior antes de datos reales (§5.2) |
| 2 | **Valle financiero real ~$210-235k** | Decírselo a Geovanny sin adornos (§6.2); 1 dominio no 8; pago anual; cobrar al supply-side solo tras probar ROI |
| 3 | **Scope infinito → no entregar** | Ruta validada con gates (§2); rebanadas verticales (§14.1); "avance" = resolución real |
| 4 | **Marca vence octubre** | Track Marca en paralelo; confirmar Sección 8 vs abandono con abogado ya |
| 5 | **Confianza-verificada ⊥ privacidad ICE** | Verificación fuera de la DB (flag), sin dossier subpoenable, minimización por tabla (§5.4) |
| 6 | **Moat de IA = responsabilidad civil** | Verificación determinística (no "IA que promete"), guardrails duros, revisión legal, seguro E&O (§3, §11) |
| 7 | **Competidor invisible (FB/WhatsApp/TikTok)** | Wedge de dolor agudo que ellos resuelven mal + coexistencia (no reemplazo) (§2, §9.2) |
| 8 | **Cold-start / pueblos fantasma** | Seed legal + cuentas ancla + 1 dominio con densidad; 2º dominio solo tras PMF (§9) |
| 9 | **Seed ilegal (scraping)** | Solo fuentes licenciadas/opt-in (§9.1, §11) |
| 10 | **Código IA no mantenible** | Firma humana senior; superficie de datos sensibles mínima en F0; simplicidad antes que features |
| 11 | **Cliente quemado / repetir litigio** | Entregar una **resolución real** rápido (no un demo de login); documentación fechada; comunicación honesta de avances |
| 12 | **Concentración de canal (influencers)** | Validar conversión influencer→negocio-pago en el piloto antes de comprometer más dominios |

---

## 16. Decisiones pendientes de Geovanny

1. **🔴 Naturaleza del deadline de la marca** (Sección 8 vs. abandono) — con abogado, **esta semana**. Sin default.
2. **🔴 El wedge de la Rebanada #1** — recomendado **Vivienda verificada anti-estafa**; alternativa Trabajo verificado. Define F0.
3. **🔴 Financiar el valle real (~$210-235k, no $43k)** — decisión de negocio central: ¿capital propio, socio, o achicar aún más el alcance de F0?
4. **Ingeniero senior humano de seguridad** — quién firma RLS y pagos (contratar/asignar). No opcional (§5.2).
5. Escrow Creator Marketplace = Opción B (Fase 2, confirmar).
6. Primer(os) tenant(s): `dominicanos.com` (tracción) + `comunidadlatina.com` (marca) en paralelo — confirmar.
7. ¿"Vender a socios" en el roadmap? Default: no (backlog).
8. Revenue-share con Domain Admins. Default: no.
9. Stripe Express v1 vs. Accounts v2 (default Express); Plan Vercel (default Pro).
10. Alcance del Asistente de Trámites — Fase 2, requiere revisión de abogado de inmigración.

> Precios de Tienda y Video Premium: **resueltos** (§7), solo validar willingness-to-pay tras 90 días.

---

## 17. Referencias

**Técnicos** (`docs/investigacion/`): 01 arquitectura+datos · 02 app white-label · 03 benchmark · 04 pagos · 05 IA/media · 06 módulos sociales · 07 infra/admin · **13 diseño premium+UX**.
**Power-ups** (`docs/investigacion/power-up/`): 08 growth · 09 diferenciación/IA · 10 economics · 11 legal · 12 GTM.
**Crítica:** `docs/investigacion/VEREDICTO-abogado-del-diablo.md` (5 ángulos adversariales).
**Versiones:** `docs/versiones/PLAN_MAESTRO_v1.md` (técnica detallada) · `PLAN_MAESTRO_v2.md` (integrada). Estado: `docs/PROGRESS.md`.

---

*Fin del Plan Maestro V3.0 — definitiva. Misma meta que la V1 (producto completo multi-tenant), ruta validada que no se muere en el camino, moat legal-safe, economía honesta, seguridad con humano en el loop, y diseño premium desde el primer pixel. Listo para ejecución por el enjambre (Fable 5) con revisión humana en los gates críticos.*





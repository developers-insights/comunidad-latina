# PROGRESS — Comunidad Latina

**Última actualización:** 2026-07-07 (sesión de construcción con Fable 5 ultracode, continuación).
**Estado:** ✅ **R0 + R1 + R2 + R3 CONSTRUIDOS + REVISIÓN INTEGRAL + POLISH PREMIUM.** Producto completo listo para los gates humanos. 47 rutas.

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
- Usuarios (password `Demo123!demo`): `maria@demo.comunidadlatina.com` (member) · `carlos@...` (domain_admin) · `geovanny@...` (global_admin).
- 9 listings de Queens, 3 guías con fuentes oficiales, 5 posts + comentarios + reacciones, 1 verification_check.

## Pendientes (en orden)
1. **🔴 GATES HUMANOS antes del primer dato real (§5.2/§14.4 — NO construibles por agentes):** pentest humano adversarial + **firma de ingeniero senior** sobre migraciones y webhook Stripe. Sin esto NO se expone a usuarios reales.
2. **Credenciales faltantes** (degradan con elegancia hoy): Stripe (test) → activa pagos reales del flujo ya construido · Resend → emails · Google Vision → moderación de imagen (hoy: pending_review) · Sentry → observabilidad (exigida antes de producción) · Vercel → deploy + dominios.
3. **Hardening menor (requiere Dashboard — `storage.objects` lo posee `supabase_storage_admin`, ni el MCP ni el rol `postgres` pueden tocarlo):** (a) **listado de buckets** — SQL listo en [`supabase/manual/harden-storage-listing.sql`](../supabase/manual/harden-storage-listing.sql), pegar en Dashboard → SQL Editor (scopea el SELECT/list al dueño; cierra la enumeración de user_ids vía `avatars`; el acceso público por URL no se ve afectado; hoy buckets vacíos → riesgo 0); (b) **Leaked Password Protection** (HaveIBeenPwned) en Dashboard → Auth → Providers → Password (toggle, 1 click). Ambos van en el mismo pase que el pentest/firma senior.
4. **Siguiente construcción:** **R4** (2º dominio real + Playbook de Nacimiento de Tenant) / **R5** (moonshots). Requiere decisiones de Geovanny §16. El "Asistente de Trámites" sigue vetado hasta abogado (UPL).
5. Deuda técnica menor: renombrar `middleware`→`proxy` (deprecación Next 16), E2E de mensajería (gate §5.4, hoy TTL 90d), CA cert para el enumerador en CI (`SUPABASE_DB_CA_CERT_PATH`). (Ya resueltos por la revisión integral: `metadataBase` en layout ✓, `lib/trust/signals` como fuente única ✓.)
6. **MCP de Meshy** (3D premium) — NO conectado. Instrucciones en [`docs/MESHY-MCP-SETUP.md`](MESHY-MCP-SETUP.md): key en https://www.meshy.ai/settings/api → `npx add-mcp @meshy-ai/meshy-mcp-server --env MESHY_API_KEY=msy_...`. Placeholder ya en `.env.local`. Alternativa ya activa: Blender MCP (Hyper3D/Hunyuan3D).

## Cómo correr
```
npm run dev              # app en localhost:3000 (tenant dominicanos por default)
npm run build            # build producción (--webpack por Serwist)
npm run typecheck | test | lint
npm run check:rls        # gate RLS (RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1 en dev)
npm run db:migrate       # aplica migraciones nuevas de supabase/migrations/
npm run db:seed          # seed idempotente
```

# Gap analysis + plan — feedback cliente 2026-07-22

> Producido por 4 agentes Explore en paralelo (feed UI · roles+User Score ·
> creador+Creator Score · negocio+Business Score+Stripe), verificado contra código
> vivo (migraciones **0001–0027**). Fuentes crudas: `2026-07-22-uiux-newsfeed.md` y
> `2026-07-22-perfiles-verificaciones-scores.md`. Encuadre de gates: `docs/HANDOFF.md`.

## TL;DR
- **Documento ① (UI/UX feed) ≈ 85% ya construido** en el "Feed red-social v2" del 21/7. Quedan 4 ítems, ninguno enorme.
- **Documento ② (Perfiles/Verificaciones/Scores/Dashboards) es mayormente NUEVO y grande.** La infraestructura (marketplace, contratos demo, Trust Score, consent, sanciones) es buena base, pero el modelo de **roles múltiples + 3 scores calculados + dashboards + verificación** hay que construirlo.
- **Dos tensiones estructurales que NO son bugs**: (a) la DB se diseñó a propósito **sin teléfono ni fecha de nacimiento** (anti-honeypot §5.4) — el spec pide lo contrario; (b) **Stripe Connect = 0 líneas** y está detrás del Hito 1 (pentest). Ambas son **decisiones de negocio/legal**, no tareas.

---

## Documento ① — News Feed: qué falta (lo demás ✅ ya está)
| Ítem | Estado | Trabajo |
|---|---|---|
| §13 Nav inferior (Inicio/Videos/➕/Notificaciones/Perfil) | 🔴 | Reescribir `shell/bottom-nav.tsx`. Rutas `/publicar` y `/notificaciones` ya existen. Chico-medio. |
| §6 Botones por tipo sobre foto en Boost (WhatsApp/Llamar/Website/Reservar…) | 🟡 | La barra solo-publicidad ya existe con 1 CTA genérico. Falta **guardar contacto real del negocio** (hoy no existe en listings, por diseño) + multi-botón. Medio. |
| §8 Contador de seguidores en perfil | 🟡 | Falta el stat "seguidores"; `follows` es entity/listing-oriented, quizá necesite `target_kind='profile'`. Chico. |
| §7 Orden del feed (Amigos→Sigo→Populares→Publicidad) | 🟡 P3 | Hoy cronológico. El cliente dijo "mantené el actual". Lo más bajo. |

Ya ✅ y verificado: fotos 4:5 full-bleed, videos + visor fullscreen, reels `/videos` con scope por módulo (reproductor único), doble-tap like, autoplay muteado + tap-audio, comentarios en bottom sheet, chip "Publicidad", botones de interacción grandes, Trust Score card con barra, animaciones (LikeBurst, page-transition, pull-to-refresh, skeleton), cards compactas, scroll fluido.

---

## Documento ② — Perfiles/Scores: clasificación del trabajo

### A) CONSTRUIBLE YA (sin dinero real, sin teléfono, sin gate) — "modo demo", Connect-ready
1. **Modelo de roles en una cuenta** (`user_roles` o array de roles) + **selector de dashboard** ("Mi perfil / Panel de creador / Mi negocio"). Es el backbone del que cuelga todo.
2. **Motor de User Score real**: extender `trust_scores` (hoy placeholder + un `+25` hardcodeado) a los 6 factores §5, `score_history`, recálculo diario (pg_cron), penalizaciones. **Re-mapear niveles** DB/UI al spec (Nuevo 0-29 / Activo 30-49 / Confiable 50-69 / Verificado 70-84 / Destacado 85-100).
3. **Creator Score** (`creator_scores` + `creator_levels`, 7 componentes, niveles 0-5, provisional-50). NO reusar `trust_scores`.
4. **Business Score** (`business_scores`, 7 componentes, niveles 1-5).
5. **Activación de creador con aprobación** (`creator_profiles.status` + máquina de 9 estados, "Convertirme en creador" gateado) + **requisitos §11** (18+/User Score ≥50/identidad/≥3 samples — la data existe, falta cablear el gate).
6. **Negocio como entidad de primera clase multi-admin**: `business_members` (5 roles) + audit log por negocio + `business_verifications` (5 niveles). Hoy negocio = listing `kind='business'` + `business_accounts` (billing de 1 dueño).
7. **Dashboard de Creador** (11 secciones) y **Dashboard de Negocio** (10 secciones) como UI real con datos demo.
8. **Categorías estructuradas de creador** (23 valores, multi) + **set de insignias distintas** (hoy solo `IdentityBadge`).
9. **Reseñas doble-ciego** (ocultas hasta que ambas partes califiquen o expire) — hoy `gig_reviews` es público al instante.
10. **Entregables/versiones** (`job_deliverables`/`job_revisions`) + estados no-monetarios faltantes (Cambios solicitados, Entrega final).
11. **Apelaciones** (`appeals` + ciclo de 7 estados + UI). Hoy solo un mailto en `legal/normas`.
12. **Suspensiones granulares** (§42): partir la suspensión global en social/marketplace/pagos/publicidad/total.
13. **Anti-manipulación** (§34): capa de detección duplicados/dispositivo/IP/reseñas relacionadas.
14. **Pestañas de perfil + privacidad** (§3): Videos/Fotos/Reseñas/Seguidores/Siguiendo + controles quién-puede-seguir/mensajear/etc.

### B) GATED — Hito 1 (pentest + firma) + credenciales + decisión de negocio
- **Stripe Connect end-to-end (Express)**: `connected_accounts`/`payment_accounts`, onboarding + account links, KYC, campos `charges_enabled/payouts_enabled/details_submitted/requirements_*`, y ~6 webhooks nuevos (`account.updated`, `transfer.*`, `payout.*` incl. fallidos, `charge.dispute.*`, `capability.updated`).
- **Riel de escrow/pago real**: convertir la máquina demo a dinero real (Checkout/Payment Element para fondear, transfers Connect para pagar), tablas `transactions/transfers/payouts/refunds`, estados de pago faltantes (Pago procesándose, Pagado, Reembolsado).
- **Insignias de pago** + componentes de dashboard de Stripe.
> Nota: la máquina de estados, montos y fee 20% (columna generada) ya son reales y **Connect-ready** — el escrow es demo-only hasta que Connect aterrice.

### C) DECISIÓN LEGAL/PRIVACIDAD — la tensión de minimización de datos
- **Teléfono + OTP SMS + "una cuenta por número"**: la DB se construyó a propósito SIN columna de teléfono (`0003` §5.4: "no agregar phone jamás sin checklist legal"). Reintroducirlo es decisión legal; habilita el +10 del User Score, el gate anti-duplicados y el requisito de creador.
- **Fecha de nacimiento** (hoy solo timestamp 18+).
- **OAuth Google/Apple**.

---

## Plan de orquestación propuesto (con modelo óptimo por tarea)

**Fase 0 — Quick wins del feed (sin decisión, arranca cuando se apruebe):** nav inferior + contador de seguidores. `Sonnet · Medio`. (Botones de boost §6 se pliegan a la Fase 2 porque dependen del contacto del negocio.)

**Fase 1 — Fundación de datos (secuencial, NO paralelizar migraciones):** diseñar todas las migraciones (`user_roles`, `user_scores`+`score_history`, `creator_scores`+`creator_levels`, `business_scores`, `business_members`, `business_verifications`, `job_deliverables`/`job_revisions`, `appeals`, suspensiones granulares) con RLS FORCE+4 policies c/u (hard rule del repo), el diseño de los motores de score (factores + re-mapeo de niveles + recálculo pg_cron). Es arquitectura con trade-offs, money-adjacent y RLS → **Opus · Alto/Máx**. Migraciones forward-only.

**Fase 2 — Construcción en paralelo (worktrees, fronteras de archivos, commit sin push):**
- Motor User Score (6 factores + historial + recálculo + penalizaciones) → **Opus · Alto**
- Motores Creator + Business Score (7 comp. c/u, niveles) → **Opus · Alto**
- Modelo de roles + selector de dashboard → **Sonnet · Medio**
- Dashboard de Creador (11 secciones, demo) → **Sonnet · Medio**
- Dashboard de Negocio (10 secciones) + negocio-como-entidad + multi-admin → **Sonnet · Medio**
- Activación de creador + máquina de aprobación + gate de requisitos + insignias + categorías → **Sonnet · Medio**
- Reseñas doble-ciego + apelaciones + suspensiones granulares → **Sonnet · Medio**
- Pestañas de perfil + privacidad + quick wins del feed (§6/§8) → **Sonnet · Medio**

**Gates de cierre (cada fase):** `tsc 0 · lint 0 · tests verdes · build webpack · check:rls verde`. Revisión adversarial multi-dimensión antes de dar por cerrado. Nada se pushea/mergea hasta que Manuel lo pida.

**Decisiones que gatean el plan (de Manuel/Geovanny):** (1) alcance del backbone este ciclo; (2) teléfono/SMS ahora o diferido; (3) Stripe Connect en este ciclo o detrás del Hito 1.

---

## DECISIONES DE MANUEL — 2026-07-22 (cerradas)
1. **Alcance:** Backbone COMPLETO en modo demo (roles + 3 scores + dashboards + activación creador + verificación no-financiera + reseñas doble-ciego + apelaciones + suspensiones granulares + anti-manipulación + pestañas/privacidad de perfil).
2. **Teléfono/SMS:** SÍ este ciclo, con **Twilio** (Verify/OTP). "Si es lo que pide el cliente, hagámoslo." → agregar teléfono + verificación SMS + "una cuenta por número" + fecha de nacimiento. **Restricción de diseño (no negociable):** el teléfono se almacena PRIVADO (tabla separada, RLS self/service-only, nunca en `profiles` público); solo se expone la insignia `phone_verified`. Twilio degrada con elegancia en demo hasta que haya credenciales (Account SID / Auth Token / Verify Service SID en Vercel). Documentar la nota legal/privacidad de reintroducir teléfono (revierte el anti-honeypot §5.4 de `0003` de forma controlada).
3. **Stripe Connect:** DIFERIDO tras el Hito 1 (pentest + firma). Todo se construye Connect-ready en modo demo; el dinero real espera al gate.

## Orden de ejecución acordado
- **Fase 1 (fundación de datos, SECUENCIAL, Opus):** produce primero una **PROPUESTA DE DISEÑO** (modelo de roles, tablas de score + motor, storage privado de teléfono, re-mapeo de niveles, business multi-admin, activación creador, reviews/apelaciones/suspensiones, campos Connect-ready) + SQL borrador de migraciones `0028+` **sin aplicar a la DB**. Se revisa con Manuel (preguntas abiertas) ANTES de aplicar. Es la brainstorming/review gate del feature.
- **Aplicación de migraciones:** paso revisado (Manuel/Claude con `apply_migration` + `get_advisors` tras cada una, `check:rls` verde). No lo hace un agente en paralelo.
- **Fase 2 (flota paralela en worktrees):** recién cuando el esquema esté lockeado. Commit sin push/merge hasta que Manuel lo pida.
- **Fase 0 (independiente del esquema, en paralelo ya):** quick win del nav inferior.


# HANDOFF — Comunidad Latina (post-construcción R0-R2)

**Fecha:** 2026-07-06. La sesión de construcción con Fable 5 (ultracode) terminó con **R0+R1+R2 verdes y commiteados**. Este handoff arranca la próxima sesión.

## Leé primero (en este orden)
1. `docs/PROGRESS.md` — estado real, pendientes priorizados, cómo correr.
2. `docs/PLAN_MAESTRO.md` (V4) — el norte; roadmap §13 (siguen R3/R4).
3. `docs/ARQUITECTURA.md` — contrato técnico vigente (respetarlo en todo código nuevo).

## Hecho y verificado (resumen de una línea por rebanada)
- **R0**: motor multi-tenant + RLS FORCE total + anti-honeypot + design system premium + PWA — enumerador VERDE.
- **R1**: vivienda verificada + Escudo determinístico + onboarding + contacto protegido + pagos degradados + landing/guías.
- **R2**: feed 5 pestañas + directorios + notificaciones/broadcast + 3 paneles admin por rol.
- Gates automáticos: tsc/build(33 rutas)/tests/lint/RLS todos verdes. Smoke visual OK.

## Próxima tarea sugerida (elegir según contexto)
- **Si hay credenciales nuevas** (Stripe test, Resend, Vision, Sentry): ponerlas en `.env.local` — el código ya las consume; probar el flujo de pago end-to-end en modo test y pedir la **firma senior del webhook** antes de cualquier cobro real.
- **Si toca seguir construyendo**: R3 según §13 (Asistente Comunitario RAG con guardrails duros §3 — pgvector ya está instalado; Matching; Copiloto). ⚠️ El "Asistente de Trámites" requiere revisión de abogado ANTES (UPL).
- **Si toca preparar el go-live**: pentest humano + firma senior (bloqueantes §14.4), Vercel Pro + dominios, Sentry, hardening del listado de buckets (PROGRESS pendiente #3), specimen de marca con uso genuino (§11.1, deadline octubre).

## Gotchas para la próxima sesión
- Migraciones: **forward-only**, agregar `00XX_*.sql` nuevas (nunca editar aplicadas) y correr `npm run db:migrate` + `npm run check:rls`. Toda tabla nueva con `tenant_id` necesita RLS FORCE + 4 policies o el gate ROMPE.
- El build usa `--webpack` (Serwist aún no soporta Turbopack build en Next 16). No quitar el flag.
- `.env.local` tiene Supabase + OpenAI reales. `SUPABASE_DB_PASSWORD` da acceso directo a Postgres (scripts db:migrate / check:rls / seed).
- Copy legal: NUNCA "Verificado" a secas ni promesas de seguridad — descriptor literal + fecha + disclaimer (patrón en `components/trust/verification-card`).
- El admin client (`lib/supabase/admin`) solo en: signup, webhooks, notify helper, paneles admin gateados por `app_metadata.role` + audit_log.
- Roles/tenant viven en el JWT (`app_metadata`) — cambiarlos requiere admin API y re-login del usuario.
- Usuarios demo en PROGRESS. En dev el tenant se elige con `?t=dominicanos|comunidadlatina` (cookie persistente).

## Decisiones de Geovanny aún abiertas (§16 — no bloquean R3 salvo indicado)
1. 🔴 Marca octubre (TSDR) — track paralelo. 2. Precios reales (hoy `[EJEMPLO]`). 3. 🔴 Capital. 4. 🔴 **Senior de seguridad: bloquea el primer dato real.** 5-8. Escrow/tenants/Stripe flavor/alcance asistente.

## Modelo y razonamiento sugeridos

```
🤖 MODELO: Fable 5 en ultracode (si es construcción de rebanada completa) | Opus (R3 IA/guardrails, hardening, go-live) | Sonnet (credenciales, contenido, fixes puntuales)
   RAZONAMIENTO: Máx en guardrails del Asistente (RAG legal-safe), webhooks con dinero real y cualquier cambio de RLS; Alto en R3 general; Medio en contenido/config.
```

**Regla de oro:** todo lo que necesita la próxima sesión está en el repo (`docs/` + código + migraciones). Nada vive solo en el chat.

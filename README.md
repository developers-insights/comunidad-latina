# Comunidad Latina

Red social **white-label multi-tenant** para comunidades latinas en EE. UU. Cada tenant es un dominio propio con su marca (logo, color, módulos), sobre una única base de código y una única base de datos con aislamiento por RLS. Tenant piloto: **dominicanos** (Queens, NY).

El corazón del producto es el *wedge* de **vivienda verificada anti-estafa**: avisos de alquiler con Trust Score, Escudo Anti-Estafa (verificador + reportes comunitarios), mensajería con contacto protegido y guías SEO para recién llegados.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, `src/`, TypeScript estricto) |
| Estilos | Tailwind CSS v4 (tokens en `globals.css` vía `@theme`) |
| DB / Auth / Storage / Realtime | Supabase (Postgres 17, RLS FORCE en 23+ tablas) |
| Pagos | Stripe (Checkout + Identity + webhooks) |
| Email | Resend |
| IA | OpenAI (moderación omni-moderation + RAG con embeddings) |
| Observabilidad | Sentry |
| PWA | Serwist (service worker, offline) |
| Tests | Vitest + Testing Library |

Documentos rectores: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) (contrato técnico), [`docs/PLAN_MAESTRO.md`](docs/PLAN_MAESTRO.md) (estrategia), [`docs/PROGRESS.md`](docs/PROGRESS.md) (estado), [`docs/investigacion/13-diseno-ux-premium.md`](docs/investigacion/13-diseno-ux-premium.md) (design system — rige tal cual).

## Cómo correr el proyecto

```bash
npm install
cp .env.example .env.local   # completar BLOQUE A como mínimo (ver docs/SETUP-ENV.md)
npm run dev                  # http://localhost:3000  (?t=<slug> para cambiar de tenant)
```

### Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Turbopack; service worker deshabilitado en dev) |
| `npm run build` | Build de producción — **`next build --webpack`** (Serwist necesita webpack para emitir `public/sw.js`) |
| `npm run start` | Sirve el build de producción |
| `npm run test` | Tests con Vitest |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run check:rls` | Enumerador RLS: verifica que ninguna tabla quede sin políticas (correr tras cada migración) |
| `npm run db:migrate` | Aplica migraciones de `supabase/migrations/` |
| `npm run db:seed` | Siembra tenants demo + contenido de ejemplo |
| `npm run rag:embed` | Genera embeddings del contenido para el asistente RAG (requiere `OPENAI_API_KEY`; lo agrega el módulo de IA) |

## Estructura

```
src/
├─ middleware.ts        # Resolución de tenant por dominio + refresh de sesión Supabase
├─ app/
│  ├─ (marketing)/      # Landing pública + guías SEO
│  ├─ (auth)/           # Entrar, registro, onboarding
│  ├─ (app)/            # App autenticada: feed, propiedades, escudo, mensajes, perfil…
│  ├─ admin/            # Paneles global / dominio / moderación
│  └─ api/              # Webhooks (Stripe) + crons (protegidos con CRON_SECRET)
├─ components/          # ui/ (design system), trust/, listings/, feed/, shell/…
├─ lib/                 # supabase/, tenant/, config/services.ts (degradación), rate-limit/, i18n/…
supabase/migrations/    # SQL versionado (RLS FORCE, triggers, RPCs)
scripts/                # rls-enumerator, seed, apply-migrations, generate-icons
```

## Variables de entorno

Todo está documentado en **[`.env.example`](.env.example)** (por bloques: A = imprescindible, B = antes del primer usuario real, C = puede esperar) y en **[`docs/SETUP-ENV.md`](docs/SETUP-ENV.md)** con el paso a paso de cada servicio.

Reglas de oro:

- `NEXT_PUBLIC_*` se expone al navegador → **jamás un secreto ahí**.
- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` viven solo en el servidor.
- Si un servicio no está configurado, la app **degrada con elegancia** (flags en `src/lib/config/services.ts`): la feature muestra un estado premium "muy pronto", nunca un error crudo.

## Seguridad

- **RLS FORCE** en todas las tablas: el `tenant_id` del JWT es la frontera real de aislamiento. `npm run check:rls` lo verifica.
- Server actions con validación **Zod** al borde + **rate limiting** (registro 5/h por IP, reportes 10/día, publicaciones 10/día — `src/lib/rate-limit/`, in-memory; migrar a Upstash con multi-instancia).
- Security headers en `next.config.ts`: HSTS, `X-Frame-Options: DENY`, CSP (hoy en Report-Only; pasa a enforcing tras validar en staging).
- Anti-honeypot: nunca teléfono, dirección exacta ni PII en logs ni en contenido público.

### Gates humanos pendientes (antes del primer dato real)

Según Plan Maestro §5.2 / §14.4 — el repo llega "listo para este gate", pero el gate lo cruza un humano:

1. **Pentest / revisión de seguridad senior** con firma, enfocado en RLS multi-tenant y flujos de pago.
2. Claves reales de **Stripe / Resend / Sentry** cargadas y webhooks apuntados al dominio de producción.
3. Revisión legal del copy del verificador (§11: descriptor + fecha + disclaimer, nunca "verificado" a secas).
4. Dominio y DNS de producción (incl. dominio de envío verificado en Resend).

## Deploy (Vercel)

1. Importar el repo en Vercel (framework: Next.js; el build command sale de `package.json` → `next build --webpack`, no lo pises).
2. Cargar las env vars de los bloques A y B de `.env.example` (Production + Preview).
3. Apuntar el dominio del tenant (p. ej. `dominicanos.com`) al proyecto — el middleware resuelve el tenant por `Host`.
4. Crear el webhook de Stripe hacia `https://<dominio>/api/webhooks/stripe` y cargar `STRIPE_WEBHOOK_SECRET`.
5. Crons: los maneja **pg_cron en Supabase** (no Vercel Crons). Los endpoints `api/cron/*` exigen `Authorization: Bearer ${CRON_SECRET}`.

## Tenants demo

| Slug | Dominio prod | Uso |
|---|---|---|
| `dominicanos` | dominicanos.com | Tenant piloto (default en dev) |
| `comunidadlatina` | comunidadlatina.com | Segundo tenant para probar white-label |

En dev: `http://localhost:3000?t=comunidadlatina` (queda en cookie `cl-tenant`).

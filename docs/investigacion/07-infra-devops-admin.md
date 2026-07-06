# Infra/DevOps + Admin Architecture — Comunidad Latina
## Análisis Integral de Operación Multi-Tenant en Prod

**Fecha:** Julio 2026  
**Scope:** Infraestructura, CI/CD, gestión de tenants, secrets, observabilidad, notificaciones transaccionales multi-tenant, arquitectura de 3 paneles admin  
**Audiencia:** Geovanny (Super Admin Global), team dev, DevOps

---

## EXECUTIVE SUMMARY (10 DECISIONES CRÍTICAS)

1. **Repo:** Single Next.js app (no monorepo) con `/app`, `/lib`, `/admin`, `/edge-functions` — N dominios viven del mismo código, diferenciados por `tenant_id` en todas las queries.

2. **CI/CD:** GitHub Actions + Vercel. Preview auto por PR (preview-<branch>.vercel.app), prod al merge en `main` → custom domain live. Migraciones Supabase vía CLI en GHA, forward-only, con dry-run en staging.

3. **Dominios/Tenants:** Vercel Domains API + Supabase. Crear tenant = form Super Admin → webhook → insert en tabla `tenants` + llamada a Vercel API → DNS + SSL auto. 15-30 min para go-live.

4. **Secrets & Env:** Vercel Env Vars (per-team, no por dominio; compartidos). Supabase project-level secrets (no tenant-scoped). Sensibles: GitHub, Stripe Connect API keys en Vercel. SMS/Email from-addresses por tenant viven en tabla `tenant_settings`.

5. **Observabilidad:** Sentry (error tracking cross-tenant, filtrable por tenant_id). LogTail/Axiom para logs Supabase Edge Functions. Vercel built-in analytics por dominio. Metrics: deploy frequency, MTTR, uptime, request latency p99.

6. **RLS (Row-Level Security):** Postgres enforces `tenant_id` isolation en TODAS las tablas. Super Admin: bypass RLS via service role. Domain Admin: RLS scope al tenant_id. Moderador: RLS scope a tenant_id + `role='moderator'`. Usuarios finales: RLS scope a tenant_id + su user_id + public posts.

7. **Notificaciones Multi-Tenant:** Email (Resend + template por tenant), SMS (Twilio + from-address por tenant), Web Push (Service Worker + app-specific). Cada notificación: `tenant_id` → lookup settings (sender address, branding, language) → send. De-duplication via Redis cache.

8. **Broadcast Global (Cross-Tenant):** Flag `is_global_broadcast` en tabla `posts`. Super Admin crea post con flag=true → aparece en feed de TODOS los usuarios de TODOS los tenants. Fan-out: insert en `post_broadcasts` (una row por tenant) para eficiencia. Read: query `posts WHERE tenant_id = X OR is_global_broadcast = true`.

9. **Backup & PITR:** Supabase automated daily backups + point-in-time recovery (24h window). Manual backups before major schema changes vía CLI. Disaster recovery: restore a nuevo project, redirigir dominios. RTO ~2h, RPO ~24h.

10. **Admin Panels:** 3 paneles separados (URLs distintas, misma Next.js app con middleware routing). Global Admin (`/admin/global`, role=global_admin): todos los tenants, revenue consolidado, CRUD tenants, config global. Domain Admin (`/admin/domain`, role=domain_admin): un tenant, módulos on/off, aprobaciones, stats locales. Moderador (`/admin/moderate`, role=moderator): cola de reportes de su tenant.

---

## PARTE 1: ESTRUCTURA DEL REPOSITORIO

### 1.1 Patrón Single App vs Monorepo

**Decisión: Single Next.js app (no Turborepo)**

**Razones:**
- N dominios usan **exactamente el mismo código** (diferencia solo en datos vía `tenant_id`)
- La "complejidad" no es separación de apps, es segregación de datos y permisos
- Vercel auto-deploya cada push a todos los dominios (no hay versioning per-tenant)
- Monorepo añade fricción sin beneficio (cada dominio no necesita librerías distintas)

**Trade-off:**
- Si emergiera un tenant que requiere UX completamente distinta → refactor a multi-app futura (poco probable)
- Para equipos muy grandes: monorepo daría owner clarity, pero aquí una o dos personas lo manejan

### 1.2 Estructura de Carpetas

```
comunidad-latina/
├── app/                          # Next.js app router
│   ├── (site)/                   # Usuario final (social features)
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Feed
│   │   ├── [tenant]/             # Dinámico: domain routing
│   │   │   ├── feed/
│   │   │   ├── messages/
│   │   │   ├── profile/
│   │   │   └── ...
│   │   └── ...
│   ├── (admin)/                  # Admin panels
│   │   ├── admin/                # Middleware routing → global/domain/moderate
│   │   │   ├── global/           # Global Admin Panel
│   │   │   │   ├── tenants/      # CRUD tenants
│   │   │   │   ├── revenue/      # Analytics consolidado
│   │   │   │   └── settings/     # Config global
│   │   │   ├── domain/           # Domain Admin Panel
│   │   │   │   ├── modules/      # Encender/apagar features
│   │   │   │   ├── approvals/    # Negocios, propiedades pending
│   │   │   │   └── stats/
│   │   │   └── moderate/         # Moderación
│   │   │       ├── queue/        # Cola de reportes
│   │   │       └── actions/
│   │   └── auth/
│   └── api/
│       ├── auth/                 # NextAuth.js
│       ├── webhooks/             # Stripe, Vercel domains, etc.
│       ├── v1/                   # Public API
│       └── internal/             # Internal API (Edge Functions wrapper)
├── lib/
│   ├── supabase/                 # Clients (server, client, admin)
│   ├── auth/                     # Auth logic, RLS setup
│   ├── tenants/                  # Tenant resolution, context
│   ├── stripe/                   # Stripe Connect integration
│   ├── notifications/            # Email, SMS, Web Push
│   ├── broadcast/                # Global broadcast logic
│   └── utils/
├── edge-functions/               # Supabase Edge Functions
│   ├── realtime-presence.ts
│   ├── image-processing.ts
│   ├── notification-triggers.ts  # Webhook listeners
│   └── ...
├── types/
│   ├── database.ts               # Auto-generated from Supabase schema
│   ├── tenant.ts
│   ├── admin.ts
│   └── ...
├── supabase/
│   ├── migrations/               # SQL migrations (forward-only)
│   └── config.toml               # Supabase local config
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint, type check, test
│       ├── deploy-preview.yml    # Preview deployment (PR)
│       ├── deploy-prod.yml       # Prod deployment (main)
│       └── supabase-migrations.yml  # DB migration on deploy
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RUNBOOK.md                # Operaciones diarias
│   ├── DISASTER_RECOVERY.md
│   └── ADMIN_PANELS.md
└── package.json
```

---

## PARTE 2: CI/CD — GITHUB ACTIONS + VERCEL

### 2.1 Pipeline Overview

```
┌─────────────┐
│  Push/PR    │
└──────┬──────┘
       │
       ├─ GHA: ci.yml (lint, type check, test)
       │   └─ If failing: stop (no deploy)
       │
       ├─ GHA: deploy-preview.yml (PR only)
       │   └─ Vercel: preview-<branch>.vercel.app
       │
       └─ GHA: deploy-prod.yml (main only, after ci passes)
           ├─ Supabase: db push (migrations)
           ├─ Vercel: deploy --prod (custom domains live)
           └─ Sentry: release marker
```

### 2.2 GitHub Actions Workflows

#### CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node  # Node, cache dependencies
      
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test:unit
      - run: npm run test:e2e  # Playwright against preview deployment
      
      - name: Report coverage
        uses: codecov/codecov-action@v4
        if: always()
```

#### Preview Deployment (`.github/workflows/deploy-preview.yml`)

```yaml
name: Deploy Preview

on:
  pull_request:

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy preview
        uses: vercel/action@main
        with:
          token: ${{ secrets.VERCEL_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Outputs: preview URL as comment on PR
```

#### Production Deployment (`.github/workflows/deploy-prod.yml`)

```yaml
name: Deploy Production

on:
  push:
    branches: [main]

jobs:
  db-migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      
      - name: Dry-run migrations (staging)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL_STAGING }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY_STAGING }}
        run: npx supabase db push --dry-run
      
      - name: Apply migrations (production)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: npx supabase db push

  deploy:
    runs-on: ubuntu-latest
    needs: db-migrate
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Vercel prod
        uses: vercel/action@main
        with:
          token: ${{ secrets.VERCEL_TOKEN }}
          production: true
      
      - name: Mark release in Sentry
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
        run: |
          npx sentry-cli releases create $(git rev-parse --short HEAD)
          npx sentry-cli releases set-commits $(git rev-parse --short HEAD) \
            --auto --org ${{ secrets.SENTRY_ORG }}
```

### 2.3 Vercel Configuration

#### `vercel.json`

```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "env": [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_ENVIRONMENT"
  ],
  "functions": {
    "api/**": {
      "maxDuration": 60
    }
  }
}
```

### 2.4 Key Points

- **No env vars per-tenant en Vercel**: todos los tenants comparten los mismos secrets (Supabase URL, Stripe keys, etc.). El RLS + tenant_id context manejan la segregación.
- **Preview URLs:** Vercel auto-genera `<branch>-<team>.vercel.app` para cada PR. Perfecto para testing antes de merge.
- **Rollback instantáneo:** Si revertís un commit en main, Vercel despliega la anterior versión (la misma construcción anterior, almacenada).
- **Domain routing:** Vercel API gestiona custom domains. Cada tenant tiene uno o más dominios vinculados al proyecto.

---

## PARTE 3: GESTIÓN DE DOMINIOS/TENANTS EN PRODUCCIÓN

### 3.1 Crear un Tenant Nuevo (End-to-End)

**Flujo:** Super Admin form → API → Supabase → Vercel Domains API → Live

```
┌──────────────────────────┐
│ Super Admin: /admin/global │
│ Form: nombre, dominio      │
└────────────┬──────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ POST /api/internal/tenants              │
│ - Validate dominio (no duplicado)       │
│ - Insert en tabla `tenants`             │
│ - Generar tenant_id (UUID)              │
│ - Insert en tabla `tenant_settings`     │
└────────────┬────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│ POST /api/webhooks/tenant-created        │
│ - Call Vercel Domains API:               │
│   POST /v13/projects/:projectId/domains  │
│   { domain: "colombianos.com" }          │
│ - Vercel auto-approvisiona SSL (Let's   │
│   Encrypt) en 5-10 min                   │
└────────────┬───────────────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ DNS Updated (custom domain)  │
│ SSL Live (auto-renew)        │
│ Tenant accesible en 15-30min │
└──────────────────────────────┘
```

### 3.2 Esquema Supabase (Tenants)

```sql
-- Tabla: tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,           -- "colombianos" (para human readability)
  name TEXT NOT NULL,                  -- "Comunidad Colombiana"
  primary_domain TEXT UNIQUE NOT NULL, -- "colombianos.com"
  additional_domains TEXT[] DEFAULT '{}',  -- ["colombianos-es.com", ...]
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active'         -- active, suspended, archived
);

-- Tabla: tenant_settings (config por tenant)
CREATE TABLE tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  modules_enabled JSONB DEFAULT '{
    "posts": true,
    "messages": true,
    "businesses": false,
    "properties": false,
    "events": false
  }',
  email_from_address TEXT,             -- "noreply@colombianos.com"
  email_from_name TEXT,                -- "Comunidad Colombiana"
  sms_from_number TEXT,                -- Twilio number per tenant (optional)
  branding JSONB DEFAULT '{
    "primary_color": "#000",
    "logo_url": null,
    "favicon_url": null
  }',
  stripe_connect_account_id TEXT,      -- For marketplace
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla: tenant_domains (1:N)
CREATE TABLE tenant_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  domain TEXT UNIQUE NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  ssl_issued BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index para lookup por domain (usado en middleware)
CREATE INDEX idx_tenant_domains_domain ON tenant_domains(domain);
```

### 3.3 Middleware: Tenant Resolution

**`lib/tenants/resolve.ts`**

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function resolveTenantFromHost(host: string): Promise<{
  tenantId: string;
  tenantSlug: string;
  domain: string;
} | null> {
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  
  // Normalizar host (quitar puerto, www)
  const cleanHost = host.replace(/^www\./, '').split(':')[0];
  
  const { data } = await supabase
    .from('tenant_domains')
    .select('tenant_id, tenants(slug)')
    .eq('domain', cleanHost)
    .single();
  
  if (!data) return null;
  
  return {
    tenantId: data.tenant_id,
    tenantSlug: data.tenants.slug,
    domain: cleanHost,
  };
}
```

**`middleware.ts` (Next.js)**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantFromHost } from './lib/tenants/resolve';

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host')!;
  const tenant = await resolveTenantFromHost(host);
  
  if (!tenant && !isAdminPath(request.pathname)) {
    // Redirigir a landing/error
    return NextResponse.rewrite(new URL('/error/tenant-not-found', request.url));
  }
  
  // Injectar tenant en request headers para acceso en routes
  const requestHeaders = new Headers(request.headers);
  if (tenant) {
    requestHeaders.set('x-tenant-id', tenant.tenantId);
    requestHeaders.set('x-tenant-slug', tenant.tenantSlug);
  }
  
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname.startsWith('/auth');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 3.4 Vercel Domains API Integration

**`lib/vercel/domains.ts`**

```typescript
export async function createDomainOnVercel(domain: string): Promise<{ verified: boolean }> {
  const response = await fetch(`https://api.vercel.com/v13/projects/${process.env.VERCEL_PROJECT_ID}/domains`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VERCEL_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Vercel API error: ${error.message}`);
  }
  
  return response.json();
}

export async function getDomainStatus(domain: string) {
  const response = await fetch(`https://api.vercel.com/v13/projects/${process.env.VERCEL_PROJECT_ID}/domains/${domain}`, {
    headers: { 'Authorization': `Bearer ${process.env.VERCEL_API_TOKEN}` },
  });
  
  return response.json();
}
```

---

## PARTE 4: SECRETS, ENV VARS Y CONFIGURACIÓN POR ENTORNO

### 4.1 Estrategia de Secrets

**Nivel 1: Vercel Environment Variables** (compartidos por todos los tenants)
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY (client key, seguro para exponer)
- SUPABASE_SERVICE_KEY (server-side only, secrets)
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- RESEND_API_KEY
- TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
- SENTRY_DSN + SENTRY_AUTH_TOKEN
- VERCEL_API_TOKEN (para Domains API)
- GITHUB_TOKEN (para webhooks)

**Nivel 2: Supabase Secrets** (no tenant-scoped)
- Almacenados como project-level secrets en Supabase
- Usables en Edge Functions: `Deno.env.get('SECRET_NAME')`
- Ejemplos: API keys de terceros, encryption keys

**Nivel 3: Tenant Settings** (per-tenant, en tabla `tenant_settings`)
- `email_from_address`: "hola@colombianos.com" vs "noreply@dominicanos.com"
- `email_from_name`: "Comunidad Colombiana" vs "Comunidad Dominicana"
- `sms_from_number`: Twilio number dedicado (opcional)
- `branding`: colores, logo, favicon por tenant
- `stripe_connect_account_id`: para marketplace per-tenant (si aplica)

**NO HACER:**
- ❌ Env vars por tenant en Vercel (imposible: N dominios, 1 project)
- ❌ Hardcodear dominios/tenants en el código
- ❌ Guardar secrets en git (`.env.local` en `.gitignore`)

### 4.2 Archivo `.env.example` (git-safe)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJx...
SUPABASE_SERVICE_KEY=eyJx...

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Email & SMS
RESEND_API_KEY=re_xxxxx
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=xxxxx

# Observability
SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/123456
SENTRY_ENVIRONMENT=production

# Vercel
VERCEL_PROJECT_ID=prj_xxxxx
VERCEL_API_TOKEN=xxxxx

# Local dev
DATABASE_URL=postgresql://localhost:5432/comunidad_latina_local
```

### 4.3 Entornos

| Entorno | Vercel | Supabase | Migraciones | Deploy |
|---------|--------|----------|-------------|--------|
| **local** | None | `supabase start` | `supabase migration up` | `npm run dev` |
| **staging** | staging-*.vercel.app | `supabase/staging` project | `supabase db push --dry-run` | GHA preview (PR) |
| **prod** | custom domains | `supabase/prod` project | `supabase db push` (GHA) | GHA main merge |

---

## PARTE 5: OBSERVABILIDAD Y MONITOREO

### 5.1 Error Tracking (Sentry)

```typescript
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'production',
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.OnUncaughtException(),
    new Sentry.Integrations.OnUnhandledRejection(),
  ],
});
```

**Tags útiles:**
- `tenant_id`: para filtrar errors por tenant
- `user_id`: para trazabilidad
- `environment`: local, staging, prod

### 5.2 Logging (LogTail / Axiom)

**Edge Functions + API Routes:** Auto-capturados por Vercel  
**Supabase Edge Functions:** LogTail via Supabase dashboard

**Ejemplo:**
```typescript
// Supabase Edge Function
console.log(JSON.stringify({
  tenant_id: tenantId,
  event: 'user_signup',
  user_id: userId,
  timestamp: new Date().toISOString(),
}));
```

### 5.3 Métricas (Vercel Analytics + Custom)

**Vercel built-in:**
- Requests per domain
- Error rates
- Response times
- CPU time, memory usage

**Custom (via Sentry):**
```typescript
Sentry.captureMessage('broadcast_global_published', 'info', {
  contexts: { broadcast: { tenant_count: 10 } },
});
```

### 5.4 SLOs y Alertas

| Métrica | Target | Alert Threshold |
|---------|--------|-----------------|
| Uptime | 99.9% | 99.0% (paging) |
| MTTR | <30min | >1h (warning) |
| Latency p99 | <1s | >3s (warning) |
| Error rate | <0.1% | >0.5% (warning) |
| DB connections | <80% | >90% (critical) |

---

## PARTE 6: SEGURIDAD — ROW-LEVEL SECURITY (RLS)

### 6.1 Principio: Zero-Trust Data Layer

Toda restricción de datos se enforce en **Postgres RLS**, no en la app. Motivos:
- Imposible bypasear desde la UI
- Escalable a N roles sin cambiar código
- Audit trail automático (quien accedió qué)

### 6.2 Roles en Postgres

```sql
-- 3 roles: anon, authenticated, admin (service role)
-- Agregamos custom roles:
CREATE ROLE tenant_user;
CREATE ROLE tenant_admin;
CREATE ROLE global_admin;
```

### 6.3 RLS Policies (Ejemplo: tabla `posts`)

```sql
-- 1. Usuarios normales leen posts de su tenant + globals
CREATE POLICY "users_can_read_tenant_posts"
  ON posts FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
      OR is_global_broadcast = true
    )
  );

-- 2. Usuarios normales solo escriben en su tenant
CREATE POLICY "users_can_create_posts"
  ON posts FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND created_by = auth.uid()
  );

-- 3. Domain Admins: actualizar/eliminar posts de su tenant
CREATE POLICY "admins_can_manage_posts"
  ON posts FOR UPDATE
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- 4. Global Admin (service role): bypass RLS (no policy, role=postgres)
```

### 6.4 JWT Custom Claims (tenant_id, role)

**NextAuth.js integration:**
```typescript
// Supabase session callback
callbacks: {
  session: async ({ session, user }) => {
    const { data } = await supabase
      .from('users')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();
    
    return {
      ...session,
      user: {
        ...session.user,
        tenantId: data.tenant_id,
        role: data.role,
      },
    };
  },
},
```

**Supabase Auth Hook (para JWT):**
```typescript
// En Supabase SQL, via pg_net webhook
-- JWT custom claims added to Supabase session via trigger
CREATE FUNCTION add_tenant_to_jwt(user_id UUID)
RETURNS void AS $$
  SELECT auth.uid() = user_id;  -- Claim tenant_id del user
$$ LANGUAGE sql;
```

---

## PARTE 7: NOTIFICACIONES TRANSACCIONALES MULTI-TENANT

### 7.1 Arquitectura

```
┌─────────────────────────┐
│ Evento (nuevo mensaje)  │
└────────────┬────────────┘
             │
             ▼
┌────────────────────────────────────┐
│ Supabase Trigger + Edge Function   │
│ - Extract tenant_id                │
│ - Lookup recipient preferences      │
└────────────┬────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ Route a Resend (Email)               │
│ - From: tenant_settings.email_from   │
│ - Template: tenant-specific HTML     │
│ - Subject: i18n per tenant           │
└────────────┬───────────────────────┘
             │
             ├─► Resend API (verificado)
             │
             └─► Twilio SMS (desde address per tenant)
             │
             └─► Web Push (via Service Worker)
```

### 7.2 Schema Notificaciones

```sql
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  tenant_id UUID REFERENCES tenants,
  email_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  push_enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants,
  user_id UUID REFERENCES auth.users,
  type TEXT, -- 'new_message', 'broadcast', 'approval_pending'
  data JSONB,
  status TEXT DEFAULT 'pending', -- pending, sent, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 7.3 Email (Resend API)

**`lib/notifications/email.ts`**

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(
  tenantId: string,
  to: string,
  type: 'new_message' | 'broadcast',
  data: any
) {
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('email_from_address, email_from_name')
    .eq('tenant_id', tenantId)
    .single();
  
  const template = getEmailTemplate(type, tenantId, data);
  
  const result = await resend.emails.send({
    from: `${tenantSettings.email_from_name} <${tenantSettings.email_from_address}>`,
    to,
    subject: template.subject,
    html: template.html,
  });
  
  return result;
}

function getEmailTemplate(type: string, tenantId: string, data: any) {
  // Templates per tenant en table tenant_email_templates O defaults
  if (type === 'new_message') {
    return {
      subject: `Nuevo mensaje en ${data.senderName}`,
      html: `<p>Hola ${data.recipientName}, recibiste un nuevo mensaje...</p>`,
    };
  }
  // ...
}
```

### 7.4 SMS (Twilio)

```typescript
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendSMS(
  tenantId: string,
  to: string,
  message: string
) {
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('sms_from_number')
    .eq('tenant_id', tenantId)
    .single();
  
  if (!settings.sms_from_number) {
    console.warn(`No SMS number configured for tenant ${tenantId}`);
    return;
  }
  
  return client.messages.create({
    body: message,
    from: settings.sms_from_number,
    to, // E.164 format: +15551234567
  });
}
```

### 7.5 Web Push

```typescript
// Service Worker
self.addEventListener('push', (event) => {
  const data = event.data.json();
  const { title, body, tenant_id, icon } = data;
  
  // Lookup tenant branding
  const icon_url = `https://${getTenantDomain(tenant_id)}/logo.png`;
  
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon_url,
      tag: `notification-${data.id}`,
    })
  );
});
```

### 7.6 Deduplication (Redis Cache)

```typescript
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

export async function sendNotificationDedup(
  tenantId: string,
  userId: string,
  notificationType: string,
  data: any
) {
  const key = `notif:${tenantId}:${userId}:${notificationType}`;
  const exists = await redis.get(key);
  
  if (exists) {
    console.log('Notification deduplicated (within 5min window)');
    return;
  }
  
  // Send notification
  await sendEmail(tenantId, userEmail, notificationType, data);
  
  // Mark as sent (5min TTL)
  await redis.setex(key, 300, '1');
}
```

---

## PARTE 8: BROADCAST GLOBAL (CROSS-TENANT)

### 8.1 Requisito

Super Admin crea un post (ej: "Alerta de seguridad pública", "Noticia importante"). Aparece en el feed de TODOS los usuarios de TODOS los tenants simultáneamente.

### 8.2 Opción A: Flag `is_global_broadcast` (Recomendado)

**Schema:**
```sql
ALTER TABLE posts ADD COLUMN is_global_broadcast BOOLEAN DEFAULT false;

-- RLS policy: cualquiera puede leer posts globales
CREATE POLICY "anyone_can_read_global_posts"
  ON posts FOR SELECT
  USING (is_global_broadcast = true);
```

**Query (usuario normal):**
```sql
SELECT * FROM posts
WHERE (
  tenant_id = $1  -- Su tenant
  OR is_global_broadcast = true  -- Posts globales
)
ORDER BY created_at DESC;
```

**Ventajas:**
- Simple, una sola tabla
- Escalable (sin fan-out)
- Historial auditado en posts

**Desventajas:**
- Si hay 1M usuarios, todos hitean la misma row (contención)
- Read-heavy (viable con índice)

### 8.3 Opción B: Fan-Out a tabla `post_broadcasts`

**Schema:**
```sql
CREATE TABLE post_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts,
  tenant_id UUID REFERENCES tenants,  -- Fan-out: una row per tenant
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_post_broadcasts_tenant ON post_broadcasts(tenant_id);
```

**Inserción:**
```typescript
// Super Admin crea un post global
const { data: post } = await supabase.from('posts').insert({
  created_by: superAdminId,
  content: 'Alerta global',
  is_global: true,
  tenant_id: superAdminTenant,
}).select().single();

// Fan-out a todos los tenants
const { data: allTenants } = await supabase
  .from('tenants')
  .select('id');

await supabase.from('post_broadcasts').insert(
  allTenants.map(t => ({
    post_id: post.id,
    tenant_id: t.id,
  }))
);
```

**Ventajas:**
- No contención (cada tenant tiene su fila)
- Escalable a millones de usuarios
- Permite tracking per-tenant (cuándo vieron, etc.)

**Desventajas:**
- Requiere fan-out (si N tenants grandes, caro)
- Dos tablas, lógica más compleja

### 8.4 Decisión: Flag `is_global_broadcast` + índice

Razón: Comunidad Latina esperado es medio a pequeño, sin contención severa. Si crece a miles de millones de reads, refactor a fan-out.

---

## PARTE 9: BACKUP, DISASTER RECOVERY Y PITR

### 9.1 Supabase Automated Backups

- **Daily automated backups**: automático en plan pro
- **Point-in-Time Recovery (PITR)**: 24h window standard, 30d con add-on
- **Retention:** 30 días (configurable)

**Acceder a backups:**
```bash
# Via Supabase CLI
supabase db download --project-id xxxxx

# Via dashboard: Settings → Database → Backups
```

### 9.2 Manual Backup Before Major Changes

```bash
# Local checkout del schema
supabase db pull

# Crear migration para reversal (forward-only, pero documentado)
supabase migration new "rollback_schema_change_if_needed"

# Commit a git (backup immutable en VCS)
git add supabase/migrations/
git commit -m "Backup schema before major change"
```

### 9.3 Disaster Recovery Runbook

**Escenario: Supabase project corrupted (impossible, pero prepared)**

```
1. Detect (Sentry alert, customer report)
2. Create new Supabase project (same region)
3. supabase db restore --from-backup <backup-id> --project-id <new-project>
4. Update Vercel env vars:
   NEXT_PUBLIC_SUPABASE_URL = https://new-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = new-anon-key
5. Test on staging first
6. Deploy to prod (GHA auto-runs with new env vars)
7. Tenants viven en nuevo project (datos restaurados)
```

**RTO (Recovery Time Objective):** ~1-2 horas (restore + redeploy)  
**RPO (Recovery Point Objective):** ~24 horas (última backup)

### 9.4 Data Retention Policies

```sql
-- Soft delete para audit trail
ALTER TABLE posts ADD COLUMN deleted_at TIMESTAMP;

-- Retención: posts borrados → archive después de 90 días
CREATE FUNCTION archive_deleted_posts() RETURNS void AS $$
BEGIN
  UPDATE posts
  SET status = 'archived'
  WHERE deleted_at IS NOT NULL
    AND NOW() - INTERVAL '90 days' > deleted_at;
END;
$$ LANGUAGE plpgsql;

-- Trigger cada 24h (via pg_cron extension)
SELECT cron.schedule('archive_deleted_posts', '0 2 * * *', 'SELECT archive_deleted_posts()');
```

---

## PARTE 10: ARQUITECTURA DE LOS 3 PANELES ADMIN

### 10.1 Routing y Middleware

```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  if (pathname.startsWith('/admin/global')) {
    return handleGlobalAdminAuth(request);  // Verifica role=global_admin
  } else if (pathname.startsWith('/admin/domain')) {
    return handleDomainAdminAuth(request);  // Verifica role=domain_admin
  } else if (pathname.startsWith('/admin/moderate')) {
    return handleModeratorAuth(request);    // Verifica role=moderator
  }
  
  return NextResponse.next();
}
```

### 10.2 Global Admin Panel (`/admin/global`)

**Acceso:** Solo Geovanny (role=global_admin)

**Features:**
- **Tenants CRUD**: crear, activar/suspender, eliminar
- **Revenue Dashboard**: total MRR, ARPU, retention por tenant
- **Global Settings**: planes globales, feature flags, pricing
- **Broadcasts**: crear posts que aparezcan en todos los tenants
- **Audit Log**: todos los cambios en el sistema

**Ejemplo: crear tenant**
```typescript
// app/admin/global/tenants/create/page.tsx
export default function CreateTenantPage() {
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    slug: '',
  });
  
  async function handleSubmit(e) {
    e.preventDefault();
    
    const response = await fetch('/api/admin/global/tenants', {
      method: 'POST',
      body: JSON.stringify(formData),
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (response.ok) {
      // Vercel Domains API called, tenant live in 15-30min
      alert('Tenant creado. Será live en 15-30 minutos.');
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input name="name" placeholder="Ej: Comunidad Colombiana" />
      <input name="domain" placeholder="Ej: colombianos.com" />
      <button type="submit">Crear Tenant</button>
    </form>
  );
}
```

### 10.3 Domain Admin Panel (`/admin/domain`)

**Acceso:** Admins de su tenant (role=domain_admin, filtered by tenant_id)

**Features:**
- **Module Toggle**: encender/apagar posts, messages, businesses, properties, events
- **Approvals Queue**: negocios y propiedades pending approval
- **Local Statistics**: usuarios, posts, revenue del tenant
- **Settings**: email from-address, branding, SMS number

**RLS Protection:**
```sql
CREATE POLICY "domain_admins_see_own_tenant"
  ON tenant_settings FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() ->> 'role')::TEXT = 'domain_admin'
  );
```

### 10.4 Moderator Panel (`/admin/moderate`)

**Acceso:** Moderadores de su tenant (role=moderator)

**Features:**
- **Report Queue**: usuarios reportados, posts, mensajes flagged
- **Actions**: warn, suspend, delete content
- **Ban List**: usuarios baneados del tenant

**Example Report Schema:**
```sql
CREATE TABLE content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants,
  reported_by UUID REFERENCES auth.users,
  reported_user UUID REFERENCES auth.users,
  content_type TEXT, -- 'post', 'message', 'profile'
  content_id UUID,
  reason TEXT, -- 'spam', 'harassment', 'inappropriate'
  status TEXT DEFAULT 'pending', -- pending, resolved, dismissed
  resolved_by UUID REFERENCES auth.users,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_content_reports_tenant_status
  ON content_reports(tenant_id, status);
```

### 10.5 Comparison Table

| Panel | URL | Role | Scope | Features |
|-------|-----|------|-------|----------|
| **Global** | /admin/global | global_admin | Todos tenants | CRUD tenants, revenue consolidado, broadcasts, settings globales |
| **Domain** | /admin/domain | domain_admin | Un tenant (su dominio) | Modulos on/off, aprobaciones, stats locales, branding |
| **Moderator** | /admin/moderate | moderator | Un tenant (su dominio) | Queue de reportes, acciones (warn, suspend, ban) |

---

## PARTE 11: IMPLEMENTACIÓN — CHECKLIST

### Phase 1: Infraestructura Base (Semana 1-2)
- [ ] Vercel project creado, custom domains configurado
- [ ] Supabase project creado, RLS enabled
- [ ] GitHub repo + Actions workflows (.github/workflows/)
- [ ] Middleware resolución de tenant (host → tenant_id)
- [ ] Auth (NextAuth.js) + JWT custom claims
- [ ] Sentry + logging setup

### Phase 2: Admin Panels (Semana 3-4)
- [ ] Global Admin Panel (CRUD tenants, broadcasts)
- [ ] Domain Admin Panel (module toggles, approvals)
- [ ] Moderator Panel (report queue)
- [ ] RLS policies para cada rol

### Phase 3: Notificaciones Multi-Tenant (Semana 5)
- [ ] Email (Resend) con from-address per tenant
- [ ] SMS (Twilio) con number per tenant
- [ ] Web Push (Service Worker)
- [ ] Edge Functions para triggers

### Phase 4: Operaciones (Semana 6)
- [ ] Backup strategy (Supabase PITR)
- [ ] Disaster recovery runbook
- [ ] Monitoring dashboards (Sentry, Vercel)
- [ ] Incident response playbook

---

## PARTE 12: DECISIONES CRÍTICAS Y TRADE-OFFS

### Decision 1: Single App vs Multi-App

| Aspecto | Single App | Multi-App |
|---------|-----------|----------|
| **Deployment** | 1 build → N dominios | N builds → N deploys |
| **Versioning** | Todos los tenants corren v1.0.0 | Cada tenant puede correr v1.0.1 |
| **Complexity** | Middleware + RLS | Separate codebases |
| **Team size** | 1-3 devs (recomendado) | 5+ devs (multi-team) |

**Decisión: Single App** ✓ (Comunidad Latina scale)

### Decision 2: RLS vs App-Level Filtering

| Aspecto | RLS | App-Level |
|---------|-----|-----------|
| **Security** | Postgres enforces | Bypassable via API |
| **Performance** | Costo DB (indexes) | Costo app (memoria) |
| **Auditability** | Automático | Manual |

**Decisión: RLS** ✓ (non-negotiable para SaaS)

### Decision 3: Broadcast — Flag vs Fan-Out

| Aspecto | Flag | Fan-Out |
|---------|------|---------|
| **Scalability** | O(1) writes, O(N reads) | O(N writes), O(1) reads |
| **Simplicity** | Muy simple | Más lógica |
| **Contention** | Posible con muchos reads | Distribuido |

**Decisión: Flag `is_global_broadcast`** ✓ (para MVP, escala media)  
**Upgrade path:** Fan-out si crece a >10M users

### Decision 4: Backup Strategy

| Strategy | RTO | RPO | Cost |
|----------|-----|-----|------|
| **Automated (Supabase)** | 1-2h | 24h | Included |
| **Continuous replication** | <5min | <1min | $$ |

**Decisión: Automated Supabase** ✓ (acceptable para MVP)

---

## PARTE 13: RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|--------|-----------|
| Tenant data leak (RLS bypass) | Baja | Crítico | Audit RLS policies, SIEM logging, regular security review |
| DB corruption (Supabase) | Muy baja | Crítico | PITR 24h, automated backups, DR runbook |
| Deploy bugs (rollout a todos tenants) | Media | Alto | Preview deployments, E2E tests, staged rollouts |
| Notification spam (multi-tenant context) | Media | Medio | Rate limiting, deduplication, preference tracking |
| Domain resolution failure | Baja | Alto | Caching, fallback domain, health checks |
| API abuse (N tenants, shared resources) | Media | Medio | Rate limiting per tenant, quota management |

---

## PARTE 14: ARQUITECTURA VISUAL

```
┌─────────────────────────────────────────────────────────────┐
│                      INTERNET / DNS                         │
│  colombianos.com, dominicanos.com, mexicanos.com, ...       │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌──────────────────────┐
│  Vercel Hosting  │    │  Vercel Domains API  │
│ (single app)     │    │ (manages custom DOM) │
│ - Build once     │    │ - SSL auto-provision │
│ - Deploy N times │    │ - DNS validation     │
└──────────┬───────┘    └──────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│    Next.js + Middleware              │
│ - Tenant resolution (host → UUID)    │
│ - RLS context setup                  │
│ - Auth (NextAuth.js)                 │
└──────────┬───────────────────────────┘
           │
      ┌────┴─────────────────┐
      │                      │
      ▼                      ▼
┌──────────────────┐  ┌──────────────────────────┐
│  User App        │  │   Admin Panels           │
│ - Feed           │  │  /admin/global (Super)   │
│ - Messages       │  │  /admin/domain (Owner)   │
│ - Profile        │  │  /admin/moderate (Mod)   │
└──────────┬───────┘  └──────────┬───────────────┘
           │                     │
           └────────────┬────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  Supabase (Postgres + RLS)    │
        │  ├─ tenants (1 per domain)    │
        │  ├─ tenant_settings           │
        │  ├─ users (tenant_id, role)   │
        │  ├─ posts (is_global_broadcast)
        │  ├─ messages (tenant_scoped)  │
        │  └─ content_reports (moderar) │
        │                               │
        │  RLS enforces:                │
        │  ├─ Users see own tenant      │
        │  ├─ Admins see one tenant     │
        │  ├─ Super see all tenants     │
        │  └─ Globals read by all       │
        └──────────┬────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Resend  │ │  Twilio  │ │  Redis   │
│ (Email)  │ │  (SMS)   │ │ (Cache)  │
│ per-from │ │ per-from │ │ dedup    │
└──────────┘ └──────────┘ └──────────┘

┌───────────────────────────┐
│  Observability            │
│ ├─ Sentry (errors)        │
│ ├─ Vercel Analytics       │
│ ├─ LogTail/Axiom (logs)   │
│ └─ Custom metrics         │
└───────────────────────────┘

┌───────────────────────────┐
│  CI/CD (GitHub Actions)   │
│ ├─ Lint, type check, test │
│ ├─ Preview deploy (PR)    │
│ ├─ Prod deploy (main)     │
│ └─ DB migrations (CLI)    │
└───────────────────────────┘
```

---

## CONCLUSIÓN

**Comunidad Latina** es una plataforma SaaS multi-tenant blanca. El éxito operacional depende de:

1. **RLS** en Postgres (seguridad inmutable)
2. **Single Next.js app** (un código, N dominios)
3. **Middleware** para tenant resolution
4. **CI/CD robusto** (GHA + Vercel, DB migrations forward-only)
5. **Admin panels segregados** (super, domain, moderator)
6. **Notificaciones tenant-aware** (email/SMS/push con contexto local)
7. **Observabilidad** (Sentry, logs, metrics)
8. **Backup & DR** (PITR, runbook claro)

**Geovanny puede crear un tenant nuevo en 15-30 minutos** (form → API → Vercel Domains → live).  
**Equipo dev puede deployar sin miedo** (RLS enforce seguridad, preview deployments reducen riesgo).

---

## REFERENCIAS Y FUENTES

- [Vercel Deployment & CI/CD](https://vercel.com/docs/git/vercel-for-github)
- [Vercel GitHub Actions Integration](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)
- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase Multi-Tenant RLS Patterns](https://supabase.com/solutions/b2b-saas)
- [Next.js Multi-Tenancy Guide](https://medium.com/@itsamanyadav/multi-tenant-architecture-in-next-js-a-complete-guide-25590c052de0)
- [Supabase Backup & PITR](https://supabase.com/docs/guides/deployment/managing-environments)

---

**Documento preparado:** 2026-07-06  
**Estado:** Ready for implementation  
**Próximo paso:** Plan de implementación (Phase 1-4)

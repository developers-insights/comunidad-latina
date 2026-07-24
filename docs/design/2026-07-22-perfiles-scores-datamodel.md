# Propuesta de diseño — Perfiles, Roles, Scores, Verificaciones (Fase 1 · fundación de datos)

> **Estado:** PROPUESTA para revisar con Manuel ANTES de aplicar. Nada de esto está
> aplicado a la base. Es la brainstorming/review gate del feature (orden de ejecución
> acordado en `docs/feedback/2026-07-22-gap-analysis-y-plan.md`).
>
> **Alcance de este documento:** SOLO la capa de datos (esquema + RLS + motores de
> score + storage privado de teléfono + campos Connect-ready). NO incluye UI, NO
> aplica migraciones, NO toca `database.types.ts`.
>
> **Insumos:** spec del cliente `2026-07-22-perfiles-verificaciones-scores.md`,
> gap-analysis + decisiones de Manuel, contrato técnico `ARQUITECTURA.md` +
> `HANDOFF.md`, y **lectura en vivo del esquema** (migraciones `0001`–`0027`,
> `list_tables`, enumerador `scripts/rls-enumerator.mjs`).
>
> **Migraciones que implementan esta propuesta:** `0028`–`0037` (borrador, sin aplicar).
> El paso REVISADO posterior (no de este agente) es: aplicar con `apply_migration`,
> correr `get_advisors` (security+perf) tras cada una, regenerar
> `src/lib/types/database.types.ts`, y `npm run check:rls` verde.

---

## 0. Invariantes del repo que este diseño respeta (verificados en vivo)

Todo lo nuevo copia los patrones canónicos ya aplicados. No invento convenciones.

1. **RLS FORCE + exactamente 4 policies** por tabla, nombradas
   `<tabla>_select|insert|update|delete`, con el `cmd` correcto y **ninguna extra**
   (el gate `check:rls` en `scripts/rls-enumerator.mjs` rompe el build si falta o
   sobra una). Toda tabla de `public` **debe tener `tenant_id`** o quedar
   whitelisteada — **todas las tablas nuevas llevan `tenant_id`**, así no hace falta
   tocar el enumerador.
2. **Helpers de `app`** (de `0001`): `app.uuid_v7()` (PK default), `app.current_tenant_id()`,
   `app.current_user_role()`, `app.is_staff()`, `app.is_global_admin()`,
   `app.account_active(uuid)` + trigger `app.enforce_account_active()`,
   `app.pair_blocked(a,b)`, `extensions.moddatetime(updated_at)`.
3. **Estado autoritativo = tabla escrita solo por `service_role`** con policies
   `with check (false)` / `using (false)` para `authenticated` (patrón `trust_scores`,
   `gig_contracts`, `account_sanctions`). El cliente nunca se auto-asigna reputación,
   verificación, plan ni sanción.
4. **Guarda de columnas protegidas** = trigger `security definer` que compara
   `coalesce(auth.jwt() ->> 'role','service_role') = 'service_role'` (+ `pg_trigger_depth() > 1`
   para triggers que mantienen contadores). Patrón `app.protect_profile_columns()`,
   `app.protect_creator_reputation()`.
5. **Roles de gobierno** (`member|moderator|domain_admin|global_admin`) viven en
   `app_metadata.role` del JWT — leídos por `app.current_user_role()`, **nunca** por
   `profiles.role` (columna informativa). Este eje **no se toca**.
6. **Minimización §5.4 (anti-honeypot):** lo sensible vive en tablas separadas
   solo-dueño (`profiles_private`, `listing_private_details`), nunca en la tabla
   pública. Sin grafos usuario→usuario reconstruibles.
7. **pg_cron idempotente:** `do $$ begin perform cron.unschedule('x'); exception when others then null; end; $$;`
   seguido de `select cron.schedule('x', '<cron>', $$sql$$)`.
8. **Degradación elegante:** flag en `src/lib/config/services.ts` por servicio; sin
   credencial, la feature muestra estado premium, nunca error crudo.

---

## 1. Modelo de roles — RECOMENDACIÓN: tabla `user_roles`

### El problema
La spec (§1) pide **una cuenta, múltiples roles** (usuario / creador / admin de negocio)
con un **selector de dashboard** ("Mi perfil / Panel de creador / Mi negocio"). Esto
choca con dos ejes que YA existen y **no hay que romper**:

- `profiles.role` — jerarquía de **staff** (`member|moderator|domain_admin|global_admin`),
  informativa; el enforcement real es `app_metadata.role` (JWT).
- `app_metadata.role`/`app_metadata.tenant_id` — claim de **seguridad** del JWT.

Los "roles" de la spec son un **tercer eje ortogonal**: *capacidades de producto*, no
gobierno ni seguridad. No deben mezclarse con `profiles.role` ni con el JWT.

### Opción elegida: tabla `user_roles` (vs. columna array)

**`user_roles(profile_id, tenant_id, role, status, activated_at, …)`**, `role ∈
('user','creator','business')`, escrita solo por service_role/RPC/trigger.

| | `user_roles` (tabla) ✅ | `profiles.product_roles text[]` (array) |
|---|---|---|
| Metadata por rol (activated_at, status, source) | Sí, columnas | No, solo el valor |
| El switcher lee en 1 índice | `where profile_id=$1 and status='active'` | scan del array |
| Exposición | Controlada (service-write, owner/staff-read) | `profiles` es **público** (`using(true)`) → filtrar el array por columna es imposible con RLS |
| Guarda anti-autoasignación | Policies `false` + trigger opcional | Hay que extender `protect_profile_columns` |
| Grain del repo | = `trust_scores`/`account_sanctions` (estado autoritativo en su tabla) | rompe el grain |

**Por qué NO array:** `profiles` es público por diseño SEO (`profiles_select using(true)`).
Meter ahí la asociación usuario↔negocio la haría pública, y el array no puede llevar
el `status` de aprobación del creador ni la membresía a negocios.

### Coexistencia sin romper nada
- `user_roles` es **otro eje**: no lee ni escribe `profiles.role` ni el JWT. El gating
  de staff sigue 100% por `app.current_user_role()`.
- **`'user'`** lo tiene toda cuenta: trigger `AFTER INSERT on profiles`
  (`app.grant_default_user_role`, security definer) lo siembra; backfill de los 17
  perfiles actuales en la misma migración.
- **`'creator'`** refleja el ciclo de `creator_profiles.status` (lo agrega la RPC de
  activación cuando el creador entra al ciclo; ver §6). El **detalle** del estado vive
  en `creator_profiles.status`, no acá — `user_roles.role='creator'` solo prende la
  entrada "Panel de creador" del switcher.
- **`'business'`** es una **bandera de presencia** = "administra ≥1 negocio". La
  mantiene un trigger sobre `business_members` (primera membership → agrega la fila;
  baja de la última → la quita). El switcher, para "Mi negocio", lista los negocios
  concretos desde `business_members` (una persona puede administrar varios, con rol
  distinto en cada uno).

### Dato que necesita el switcher
```sql
-- ¿Qué dashboards ve esta cuenta?
select role, status from public.user_roles
 where profile_id = auth.uid() and status = 'active';
-- Para 'business', además: los negocios y el rol en cada uno
select bm.business_id, bm.role from public.business_members bm
 where bm.profile_id = auth.uid() and bm.status = 'active';
```

**RLS `user_roles`:** SELECT dueño + staff del tenant (+ global); INSERT/UPDATE/DELETE
`false` (service/RPC/trigger). No es público (la lista de capacidades de una cuenta no
necesita ser anónima; el rol creador ya es visible vía `creator_profiles`).

---

## 2. Tablas de score — forma y taxonomía

Tres scores **independientes** (§45), cada uno con lo que exige §36:
`score_current`, `score_previous`, `score_level`, `score_calculated_at`, `score_version`
**+ cada factor por separado**, y `score_history` por cada cambio.

### 2.1 User Score — EXTENDER `trust_scores` (no tabla nueva)

**Recomendación: extender `trust_scores` in-place**, que YA es el User Score
(PK `profile_id`, `tenant_id`, `score 0-100`, `level`, `signals jsonb`, `computed_at`,
RLS público-lectura/service-escritura) y está cableado a la app (`src/lib/trust/*`,
`components/trust`).

- **Contra una tabla `user_scores` nueva:** renombrar obliga a renombrar sus 4 policies,
  migrar el grafo de FKs, dual-write y cambiar todas las lecturas de la app — **cero
  ganancia funcional**. El único trabajo real (re-mapear niveles) hay que hacerlo
  igual, se llame como se llame la tabla. El concepto pasa a llamarse "User Score"; la
  tabla conserva el nombre `trust_scores` por continuidad. (§37 nombra `user_scores`;
  lo documentamos como **alias conceptual** de `trust_scores`, sin crear una vista que
  el enumerador no chequea y la app no necesita.)

**Columnas que se agregan (`0029`):**
- `score_previous int` (§36).
- `score_version int not null default 1` (§36).
- `factors jsonb not null default '{}'` — **desglose POSITIVO por factor** (los 6 de §5):
  `{identity_security, tenure_activity, profile_completion, positive_participation,
  behavior_history, transactional_trust}`, cada uno su subtotal.
- Se **conserva `signals jsonb`** (contadores crudos que ya consume `signals.ts`:
  `months_in_community`, `transactions_ok`, `endorsements_count`). `signals` = insumos
  positivos para la UI; `factors` = contribución numérica por bucket (§36). Separados a
  propósito.
- `computed_at` cumple el rol de `score_calculated_at`.

**Invariante de privacidad (§35):** `factors` y `signals` contienen **solo lo positivo
y no delicado**. Los negativos (penalizaciones, disputas, documentos rechazados,
recuento de reportes) **nunca** se serializan en la fila de score — viven en tablas
privadas (`score_penalties`, verificaciones, moderación). Así el score público
(número + nivel + explicación positiva) puede seguir siendo `select using(true)` sin
filtrar nada delicado. **Regla dura para el motor: prohibido escribir negativos en
`factors`/`signals`.**

#### Re-mapeo de niveles (cambia DB **y** UI juntas — coordinación obligatoria)

| | Taxonomía ACTUAL (DB `0003` + `lib/trust/levels.ts`) | Taxonomía SPEC (§7) |
|---|---|---|
| L1 | `nuevo` 0–19 | `nuevo` 0–29 |
| L2 | `verificado` 20–39 | `activo` 30–49 |
| L3 | `confiable` 40–69 | `confiable` 50–69 |
| L4 | `premium` 70–89 | `verificado` 70–84 |
| L5 | `diamante` 90–100 | `destacado` 85–100 |

Ojo: la spec **reutiliza** `verificado`/`confiable` **en umbrales distintos**
(`verificado` salta de 20–39 a 70–84). Un string persistido queda semánticamente mal:
hay que **recomputar** el nivel desde el score, no re-mapear el string.

**Qué hace la migración `0029`:**
1. `drop` del CHECK viejo de `level`, `add` del CHECK nuevo
   `('nuevo','activo','confiable','verificado','destacado')` (patrón `0026`).
2. **Recompute inmediato** del `level` de todas las filas existentes desde su `score`
   con los umbrales nuevos (un `UPDATE` de una sola pasada), así ninguna fila viola el
   CHECK nuevo.
3. A partir de ahí, **el nivel lo escribe SOLO el motor** (§3).

**⚠️ Acoplamiento que hay que respetar (va en la MISMA PR revisada, NO es de este
agente):**
- `src/lib/trust/levels.ts` → `TRUST_LEVELS` con los umbrales/labels nuevos.
- `src/lib/trust/signals.ts` → `TRUST_LEVEL_IDS` con el set nuevo de ids.
- `src/components/trust/levels.*` → capa visual (Icon/textClass/segmentClass) para
  `activo` y `destacado`, y re-key de `verificado`.

Aplicar `0029` **sin** este cambio de app degrada toda la UI de confianza a "nuevo"
(porque `toTrustLevel()` desconoce los ids nuevos). **Deben aterrizar juntas.** (Ver
Pregunta Abierta #1.)

### 2.2 Creator Score — `creator_scores` (tabla nueva) + niveles por función

`creator_scores(profile_id PK → creator_profiles, tenant_id, score, score_previous,
level int [0-5], factors jsonb [7 comp de §16], is_provisional boolean, score_version,
computed_at)`. Público-lectura (§35), service-escritura. **No reusar `trust_scores`**
(son ejes independientes, §45).

- **7 factores (§16)** en `factors`: `verification_readiness` (máx15),
  `quality_satisfaction` (máx25), `job_fulfillment` (máx20), `on_time_delivery` (máx15),
  `communication` (máx10), `experience` (máx10, **no público** — se guarda pero no se
  serializa en la parte pública), `safety_compliance` (máx5).
- **Niveles 0–5 (§17):** `creator_levels` de §37 se realiza como **lógica canónica**
  (función SQL `app.creator_level(...)` + constante TS espejo), **no como tabla**.
  Motivo: los umbrales son CANON (fijos, no por-tenant, como los Trust levels); una
  tabla de config idéntica en toda la comunidad no aporta y obligaría a whitelistearla
  (no tiene `tenant_id`) o inventarle uno. Alternativa (tabla de referencia) en
  Pregunta Abierta #6.
  - Nivel 0 "Aspirante" = activó, sin verificar/Stripe → construye portafolio, **no
    cobra**. Nivel ≥1 exige `charges_enabled` (Stripe). Como Stripe está **diferido**,
    en demo **todos topean en 0/provisional** — Connect-ready pero demo.
- **Provisional-50 (§17):** `is_provisional=true` mientras `completed_jobs < 3`; la UI
  muestra 50 y "Creador nuevo — aún sin trabajos suficientes". A los 3 trabajos,
  `is_provisional=false` y se muestra el score real.

### 2.3 Business Score — `business_scores` (tabla nueva)

`business_scores(business_id PK → business_accounts, tenant_id, score, score_previous,
level int [1-5], factors jsonb [7 comp de §106], score_version, computed_at)`.
Público-lectura, service-escritura. Niveles 1–5 (§107: Nuevo 0–39 / Activo 40–59 /
Verificado 60–74 / Confiable 75–89 / Destacado 90–100) por `app.business_level(score)`.

### 2.4 `score_history` — genérica para los 3 scores

`score_history(id, tenant_id, subject_type ['user'|'creator'|'business'], subject_id,
score_before, score_after, level_before, level_after, delta, reason, source
['recalc'|'penalty'|'admin'|'event'], actor_id, created_at)`.

- **No es pública** (el historial incluye motivos de penalización — §35 negativos
  privados). SELECT: dueño de su propio sujeto **user/creator** (`subject_id=auth.uid()`)
  + staff del tenant + global. Para sujetos **business**, staff/global por RLS; los
  admins del negocio lo ven vía RPC `security definer` que valida membership (evita
  depender de `app.business_role()` que se define recién en `0031`). INSERT/UPDATE/DELETE
  `false` (service/motor).
- Cumple §36 "guardar historial por cambio (fecha, razón, puntos antes/después, acción
  auto/manual, admin)" y habilita **apelaciones** (§7).

### 2.5 `score_penalties` — penalizaciones auditables (§7)

`score_penalties(id, tenant_id, subject_type, subject_id, points int, reason, category
['spam'|'harassment'|'fake_review'|'impersonation'|'fraud'|'follower_manipulation'|'abusive_dispute'|…],
applied_by, source ['auto'|'manual'], is_reverted boolean, reverted_by, created_at)`.

- El **factor "historial de comportamiento"** (máx 20, base neutral) = base − Σ
  penalizaciones activas + recuperación por antigüedad. Las penalizaciones son **filas
  discretas** (auditable, apelable), no un número opaco. Revertir (apelación aprobada)
  = `is_reverted=true` → el motor recomputa y restaura puntos.
- **Privada:** dueño ve las propias (para apelar) + staff; service/RPC escribe.

### Por qué `factors jsonb` y no columnas ni tabla hija

- **vs columnas:** el set de factores difiere por score (6/7/7); columnas uniformes no
  encajan.
- **vs tabla hija `score_factors`:** agregaría 6-7 filas por sujeto por recálculo (write
  amplification en el batch diario) + un join en cada lectura de UI. `jsonb` mantiene la
  fila de score atómica (una lectura = número + nivel + desglose), igual que el
  `trust_scores.signals` existente. Los factores se computan y muestran, no se filtran/
  indexan. El historial por-factor, si algún día hace falta, ya lo cubre `score_history`.

---

## 3. Motor de score — HÍBRIDO (SQL autoritativo + orquestación app)

### Decisión
- **Recompute autoritativo = funciones SQL `security definer`**:
  `app.recalc_user_score(profile)`, `app.recalc_creator_score(profile)`,
  `app.recalc_business_score(business)`. Leen los **contadores agregados que ya viven en
  la DB** (antigüedad de `profiles.created_at`; transacciones de `gig_contracts`;
  reseñas de `gig_reviews`/`business_reviews`; verificaciones de las tablas de
  verificación; penalizaciones de `score_penalties`) y escriben la fila de score +
  `append` a `score_history`. Un solo lugar, no forjable (service-write), igual doctrina
  que los contadores por trigger ya existentes.
- **Triggers** disparan recomputes puntuales en los eventos de §36 (tras review, tras
  contrato `released`, tras cambio de verificación, tras penalización). Patrón ya
  presente (`gig_reviews_refresh_rating`, `gig_contracts_bump_completed`).
- **pg_cron diario (§36 "1×/día"):** `recalc-scores-daily` recorre todos los sujetos.
  **Imprescindible** para factores que cambian con el tiempo sin evento (umbrales de
  antigüedad 30d/90d/6m/1a/2a).
- **App-layer:** SOLO para factores con insumos **externos** (Stripe vía webhook,
  Twilio, Vision). Esos sistemas escriben **hechos** (flags de verificación, resultado
  de transacción); el SQL computa el score desde los hechos. **La app nunca computa el
  score** (el gap-analysis constató que el `trust_scores` actual es "placeholder + un
  +25 hardcodeado" — justamente por computar fuera del motor autoritativo).

### Ordenamiento de migraciones (importante)
El motor consume tablas que se crean en varias migraciones (`business_reviews` en `0033`,
`business_verifications` en `0031`, deliverables en `0034`). Por eso:
- **`0029`** crea las **tablas** de score + `score_history` + `score_penalties` + las
  **funciones de nivel puras** (`app.creator_level`, `app.business_level`,
  `app.user_level` — sin dependencias de tablas).
- **`0037`** (última) define el **motor** (`recalc_*` + triggers + cron) con
  `create or replace`, cuando **todas** las tablas de insumo ya existen. Las funciones
  son `plpgsql` (late-binding) y usan `to_regclass('public.x') is not null` como guarda
  donde tocan tablas opcionales, para ser forward-compatibles.

### Penalizaciones
Un evento de penalización (§7): (a) inserta fila en `score_penalties` (delta negativo +
motivo + categoría + actor + auto/manual), (b) dispara `recalc` del sujeto → el nuevo
score baja y se registra en `score_history`. Apelable (§43): la apelación aprobada
marca `is_reverted` y recomputa.

---

## 4. Teléfono + SMS (Twilio Verify) — PRIVADO por diseño

> **Reversión controlada del anti-honeypot §5.4.** `0003` dice "SIN columna de teléfono;
> no agregar phone jamás sin pasar el checklist legal". La decisión de Manuel (2026-07-22)
> reintroduce teléfono porque el **modelo de producto del cliente lo exige** (una cuenta
> por número, anti-duplicados, requisito de creador). Se preserva la postura de
> minimización con las mitigaciones de abajo. Requiere venia legal (Pregunta Abierta #2).

### Esquema
- **`profiles.phone_verified boolean not null default false`** — la **única** parte
  PÚBLICA (insignia), en la tabla pública, escrita **solo por service_role** (se extiende
  `app.protect_profile_columns()`, igual que `identity_verified`). También
  `profiles.email_verified boolean` (insignia, sincronizada de `auth.users.email_confirmed_at`).
- **`public.user_phones`** — tabla PRIVADA (nueva, `0030`):
  ```
  profile_id uuid pk references profiles(id) on delete cascade
  tenant_id  uuid not null references tenants(id)
  phone_e164 text not null          -- E.164, PRIVADO (nunca en profiles ni en vistas públicas)
  phone_verified boolean default false
  phone_verified_at timestamptz
  verification_channel text default 'sms'
  birthdate date                    -- DOB mínima (§2), PRIVADA
  created_at / updated_at
  check (phone_e164 ~ '^\+[1-9]\d{7,14}$')            -- formato E.164
  ```
  - **Una cuenta por número (§2):** `create unique index user_phones_e164_uniq on user_phones (phone_e164)` — **global** (no por-tenant; single-community lo hace irrelevante hoy, pero la regla es global). El número **nunca es seleccionable** (RLS solo-dueño) y el signup es server-mediado, así que la sonda de existencia solo ocurre server-side. Documentado como riesgo residual aceptado.
  - **DOB mínima:** solo `date`, privada. Habilita el gate 18+ del creador (§11) sin exponer la fecha (§3 "nunca público: fecha de nacimiento completa").

### RLS `user_phones` (self-read / service-write)
- **SELECT:** solo el dueño (`profile_id = auth.uid() and tenant_id = current_tenant_id()`).
  **NO** staff, **NO** global (minimización > conveniencia, igual que `profiles_private`).
- **INSERT/UPDATE/DELETE:** `with check (false)` / `using (false)` → **solo service_role**.
  El OTP es una operación que **prende una insignia de confianza** (clase
  `identity_verified`/`account_status`) → va por el **admin client** (justificado, como
  signup/webhooks en `ARQUITECTURA §6`). El cliente no se auto-verifica. Cambio de
  teléfono = flujo server con **2ª verificación** (§2), nunca UPDATE directo.

### Flujo Twilio Verify (server, app-layer — forma, no código de este agente)
Confirmado contra la doc actual de `twilio-node` (Verify v2). **Twilio es dueño del
código**: TTL, rate-limit y máximo de intentos los maneja Twilio → **CL NO almacena el
OTP ni un contador de intentos**.
1. `startPhoneVerification(phone)` — server action, admin client. Zod valida E.164.
   Pre-chequea "una cuenta por número" (+ confía en el unique index). Si Twilio está
   configurado: `twilio.verify.v2.services(SID).verifications.create({ to, channel:'sms' })`
   → devuelve `status:'pending'`. Upsert `user_phones` (verified=false). Si **no** está
   configurado (demo): guarda el teléfono, estado demo, **no revela ningún código**; en
   dev puede auto-aprobar tras un flag, en prod muestra "config pendiente".
2. `checkPhoneVerification(phone, code)` — admin client.
   `twilio.verify.v2.services(SID).verificationChecks.create({ to, code })` → si
   `status==='approved'`: setea `user_phones.phone_verified=true` + `phone_verified_at`
   + `profiles.phone_verified=true` y dispara `recalc_user_score` (+10 del factor
   identidad).
- Flag nuevo en `services.ts`: `isTwilioConfigured =
  Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID)`.
  Degrada con elegancia como Stripe/Resend.

### Nota legal/privacidad (el "checklist" de §5.4, ahora satisfecho conscientemente)
Mitigaciones que preservan la postura anti-honeypot al reintroducir teléfono:
1. El número **nunca** en `profiles` (público) ni en ninguna vista/SEO — solo el boolean.
2. Storage en tabla **solo-dueño/service**; ni staff ni global lo leen por RLS.
3. **OTP nunca persistido** (Twilio lo tiene).
4. Borrado de cuenta **cascadea** el teléfono (`on delete cascade`).
5. **Sin TTL** del número mientras la cuenta vive (lo exige el "una cuenta por número");
   se va con la cuenta.
6. **Riesgo residual explícito:** `user_phones` es ahora un mapa teléfono↔identidad
   subpoenable. Mitigado por cifrado-at-rest (default Supabase), RLS solo-dueño, columnas
   mínimas y base legal documentada. **Necesita firma legal antes de recolectar teléfonos
   reales** (Pregunta Abierta #2).

---

## 5. Negocio como entidad multi-admin

### Ancla — RECOMENDACIÓN: reusar `business_accounts` (no tabla `businesses` nueva)
`business_accounts` YA es, de hecho, la entidad negocio: `id` (uuid_v7), `tenant_id`,
`owner_id`, `listing_id` (su cara pública = listing `kind='business'`), `name`,
`category` + columnas de billing. Es 1-dueño; le agregamos multi-admin alrededor de su
`id`, sin un anclaje nuevo ni backfill de campos duplicados.

- **Contra una tabla `businesses` nueva (§37):** duplicaría los campos públicos que ya
  están en el listing (`kind='business'`: nombre, fotos, categoría, follows, feed, FTS,
  moderación — todo construido) y obligaría a backfill + doble fuente de verdad. La cara
  pública **sigue siendo el listing**; `business_accounts` es el ancla estable de
  identidad+billing. (Alternativa en Pregunta Abierta #3 si prevén negocios sin billing
  o varios listings por negocio.)

### Tablas nuevas (`0031`), todas keyed a `business_accounts.id`
- **`business_members`** — multi-admin (§101):
  `(id, tenant_id, business_id, profile_id, role ['propietario'|'administrador'|'editor'|'atencion'|'analista'],
  status ['active'|'invited'|'revoked'], invited_by, created_at, updated_at)`, unique
  `(business_id, profile_id)`. El `owner_id` de `business_accounts` es el **Propietario**
  bootstrap; se **espeja** como fila `business_members` (propietario) al crear el negocio,
  para tener **una sola fuente de permisos**.
  - Helper `app.business_role(business_id, profile)` → devuelve el rol del miembro
    activo o `null` (el análogo de `app.is_staff()` para un negocio). Base del gating en
    RLS de las satélites y en server actions.
- **`business_verifications`** — 5 niveles (§103), una fila por negocio:
  `(business_id pk, tenant_id, account_verified bool, commercial_info_status,
  documental_status, stripe_status, platform_review_status, verification_status text,
  verification_updated_at, …)`. Service-write. Modela la separación **Stripe (financiero/
  legal) vs CL (comunitario)** de §104: son dos verificaciones distintas, columnas
  distintas.
- **`business_audit_log`** — log por-negocio (§101 "todas las acciones admin quedan
  registradas"): `(id, tenant_id, business_id, actor_id, action, target_type, target_ref,
  metadata jsonb, created_at)`. **Distinto** del `audit_log` global (que es de staff de
  plataforma). SELECT: miembros del negocio (vía `business_role`); INSERT `false`
  (service/RPC). TTL por cron (365d, alineado con `audit_log`).
- **`business_scores`** (definida en `0029`, §2.3).

### Relación con lo existente
- `business_accounts.listing_id` → listing público (`kind='business'`). La **página de
  negocio** = ese listing renderizado con `business_score` + `business_verifications` +
  contador de miembros.
- El **plan/billing** de `business_accounts` sigue igual (webhooks Stripe, service-write).
- `listings kind='product'` (Marketplace) y `kind='creator_gig'` de un negocio se
  cablean por `created_by`/`attrs.store_listing_id` como hoy.

---

## 6. Activación de creador — máquina de 9 estados + gate de requisitos

`creator_profiles` ya existe. En `0032`:

### Estado (§12 paso 4 / §74)
`creator_profiles.status text not null default 'application_started' check (status in (
'not_requested','application_started','documents_pending','stripe_review_pending',
'platform_review_pending','approved','needs_info','suspended','rejected'))`.
- `'not_requested'` = **ausencia de fila** (implícito); al tocar "Convertirme en creador"
  se crea la fila en `'application_started'` (NO cuenta nueva — §8).
- `'approved'` lo setea **staff/service** (revisión de CL, §74 paso 3), nunca el creador.
- Timestamps por transición (`status_updated_at`).

### Gate de requisitos (§11) — la data existe, se cablea
Función `app.creator_activation_eligible(profile)` → `(eligible boolean, reasons text[])`:
- **18+** ← `user_phones.birthdate` (o `profiles.age_confirmed_at`).
- **User Score ≥50** ← `trust_scores.score`.
- **Teléfono/correo verificados** ← `profiles.phone_verified` / `email_verified`.
- **Identidad** ← `profiles.identity_verified`.
- **Sin suspensiones** ← `profiles.account_status='active'` + sin `account_restrictions`
  de scope marketplace.
- **≥3 ejemplos** ← count de `creator_portfolio_items` (o `portfolio_photos`).
- **NO** exige mínimo de seguidores (§11).
- RPC `request_creator_activation()` valida el gate y transiciona
  `application_started → documents_pending/platform_review_pending`. Aprobación por RPC
  staff.

### Portafolio — `creator_portfolio_items` (nueva)
`(id, tenant_id, creator_id, kind ['photo'|'video'|'reel'|'link'|'onplatform'|'testimonial'],
url, caption, is_verified_work bool, sort_order, created_at)`. Público-lectura, dueño-write.
Mejor que el array `portfolio_photos` (que se conserva para compat/samples rápidos) para
el portafolio rico de §8 (videos, reels, campañas, enlaces, trabajos verificados,
testimonios). El gate ≥3 cuenta estos items.

### Insignias distintas (§76) — datos, no una sola azul
Las insignias se **derivan** de datos ya presentes, no necesitan tabla:
`phone_verified`, `identity_verified` (profiles) · `creador aprobado`
(`creator_profiles.status='approved'`) · `pagos activados` (`charges_enabled`, Connect) ·
`creador destacado`/`Top Creator` (`creator_scores.level ≥ 4/5`). Categorías (§8, 23
valores multi) → `creator_profiles.categories text[]` (nueva columna) con CHECK del set.

---

## 7. Reseñas doble-ciego · apelaciones · suspensiones · entregables

### 7.1 Reseñas doble-ciego (§33) — alter de `gig_reviews` (`0033`)
Hoy `gig_reviews` es público al instante. Se agrega `visible boolean not null default
false` + `visible_at timestamptz`, y se **reemplaza** la policy `gig_reviews_select`
(mismo nombre, cuerpo nuevo — forward-only) a:
`using (visible = true or reviewer_id = auth.uid() or app.is_staff() or app.is_global_admin())`
— cada parte ve **su propia** reseña siempre; el resto solo cuando es visible.
- **Reveal on-both:** trigger `AFTER INSERT` — si existe la reseña de la contraparte del
  mismo contrato, marca ambas `visible=true` (security definer; el update de la tabla es
  service).
- **Reveal on-timeout:** pg_cron `reveal-stale-gig-reviews` (diario) hace visibles las
  reseñas de contratos `released` hace > **14 días** aunque la contraparte no calificó
  (evita represalias sin bloquear la reputación para siempre). (Plazo en Pregunta
  Abierta #5.)

### 7.2 `business_reviews` (nueva, `0033`) — reseñas comunitarias de un negocio
§106 distingue **reseña verificada** (compra/servicio/trabajo de creador) vs **comunitaria
no verificada**, con peso distinto en el Business Score. `gig_reviews` cubre solo
creador↔negocio de un contrato; falta la reseña **cliente→negocio** general:
`(id, tenant_id, business_id, author_id, rating 1-5, body, is_verified bool, visible bool,
created_at)`, unique `(business_id, author_id)`.
- `is_verified` = el autor tuvo una transacción/gig `released` con el negocio (lo setea
  el server, no el cliente).
- **Anti-manipulación mínima:** `author_id ≠` miembro del negocio (no auto-reseña),
  una por autor, señal de dispositivo/cuenta relacionada (§8 anti-manip). Público-lectura
  de `visible`. Alimenta `business_score` con pesos §106.
- ¿En alcance ahora o diferido? Es una superficie grande de moderación (Pregunta
  Abierta #4).

### 7.3 `appeals` (nueva, `0033`) — ciclo de 7 estados (§43)
`(id, tenant_id, profile_id, subject_type ['sanction'|'penalty'|'score'|'creator_rejection'
|'business_rejection'|'content_removal'], subject_ref uuid, reason text, evidence_urls
text[], status, resolution_note, resolved_by, resolved_at, created_at)`.
- `status ('presentada','en_revision','info_solicitada','aprobada','rechazada','cerrada')`
  — "No apelado" = ausencia de fila.
- SELECT: apelante (dueño) + staff/global. INSERT: dueño, validando que apela algo
  **suyo**. Transiciones: RPC staff (service). Aprobar una apelación de penalización →
  revierte la `score_penalty` y recomputa.

### 7.4 Suspensiones granulares (§42) — sin romper la global existente
Hoy: `profiles.account_status` (active/suspended/banned, global) + `account_sanctions`
(historial). Se agrega el eje **por-scope** sin tocar el global:
- **`account_restrictions`** (nueva, live): `(id, tenant_id, profile_id, scope
  ['social'|'marketplace'|'pagos'|'publicidad'|'total'], reason, expires_at, applied_by,
  created_at, lifted_at)`. Activa si `lifted_at is null and (expires_at is null or >
  now())`. Es el análogo scoped de `profiles.account_status`.
- **`account_sanctions.scope`** (columna nueva, default `'total'`) — el historial captura
  también las acciones scoped.
- Helper `app.has_restriction(profile, scope)` + RPCs `admin_restrict_user(profile, scope,
  days, reason)` / `admin_lift_restriction(...)` (espejo de `admin_suspend_user`).
- **Enforcement** por triggers scoped (patrón `enforce_account_active`):
  `enforce_social_active` en posts/comments/reactions; `enforce_marketplace_active` en
  gig_applications/(contratos vía server); `pagos`/`publicidad` chequeados donde el dinero
  y los boosts/promotions fluyen (Connect-ready). El global `enforce_account_active`
  (total/banned) queda intacto. §42: "social no bloquea pagos ya ganados salvo
  investigación" → el scope `pagos` es independiente del `social`.

### 7.5 Entregables + estados no-monetarios (§32) — `0034`
- **`job_deliverables`** (nueva): `(id, tenant_id, contract_id, submitted_by, kind, files
  text[], note, version int, is_final bool, created_at)` — cada envío del creador,
  versionado.
- **`job_revisions`** (nueva): `(id, tenant_id, contract_id, requested_by, note,
  created_at)` — cada "Cambios solicitados" del cliente.
- Ambas privadas a las partes + staff; escritura de la parte correspondiente vía server
  (o service).
- **`gig_contracts.status`**: se **extiende el CHECK** (forward-only, patrón `0026`) con
  los estados **no-monetarios** faltantes: `'changes_requested'` (Cambios solicitados),
  `'final_delivery'` (Entrega final), `'approved'` (Aprobado), `'closed'` (Cerrado) +
  timestamps. Los estados **monetarios** (Pago procesándose/Pagado/Reembolsado) quedan
  **Connect-ready** (llegan con el riel real, Hito 1). `funded` ya existe como demo.

### Reconciliación de nombres §37 (documentada, NO se renombra)
La app ya tiene: `listings kind='creator_gig'` = **jobs**; `gig_applications` =
**job_applications**; `gig_contracts` = **job_contracts**; `gig_reviews` +
`business_reviews` = **creator_reviews/business_reviews**; `moderation_queue` =
**moderation_cases**; `notifications` existe. Renombrar = churn + rompe la app → se
mantiene el nombre real y se documenta el mapeo. (Pregunta Abierta #7.)

---

## 8. Anti-manipulación (§34) — capturar señales, no sobre-construir

**Lo que se hace ahora (mínimo, Connect-ready):**
- **`security_signals`** (nueva, `0036`): `(id, tenant_id, profile_id, event_type
  ['signup'|'phone_verify'|'review'|'application'|'login'], ip_hash text, device_hash
  text, created_at)`. **Append-only**, service-write, **staff-read** (nunca público),
  TTL por cron.
  - `ip_hash`/`device_hash` **HASHEADOS** (HMAC con secreto de servidor), **nunca IP
    cruda** — anti-honeypot. Permite detectar clusters mismo-dispositivo/misma-IP
    **después**, sin construir el motor de detección ahora.
- **Guardas estructurales baratas (ya en el diseño):** una-cuenta-por-teléfono (unique),
  anti-auto-reseña (`business_reviews.author ≠` miembro), una-reseña-por-par,
  `gig_reviews` solo entre partes del contrato.

**Lo que NO se construye ahora (se documenta como capa posterior):** el motor de scoring/
clustering, velocity checks, detección de disputas coordinadas, "negocio+creador de la
misma persona". Es un job analítico **sobre `security_signals`** más adelante. §34
"métricas sospechosas NO suben el score" se respeta porque el motor solo suma señales
**verificadas** (transacciones `released`, reseñas de contrato, verificaciones).
- **Privacidad:** aun hasheada, es una tabla de tracking conductual → necesita venia
  legal (Pregunta Abierta #2) y es staff-only.

---

## 9. Campos Connect-ready (§29-41) — `0035`, vacío-pero-listo, SIN dinero

Se crean las tablas/campos de **cuenta** de Connect, **sin lógica de dinero** (diferido
tras Hito 1 — decisión de Manuel). El **ledger** (transactions/transfers/payouts/refunds/
disputes de §37) es lógica de dinero → **NO se crea ahora**, llega con Connect.

- **`connected_accounts`** (nueva): `(id, tenant_id, owner_type ['creator'|'business'],
  owner_ref uuid, stripe_account_id, details_submitted bool, charges_enabled bool,
  payouts_enabled bool, requirements_due jsonb, requirements_past_due jsonb,
  disabled_reason text, capabilities jsonb, verification_status text,
  verification_updated_at, created_at, updated_at)`. Cubre los campos §38. Service-write
  (webhooks). SELECT: dueño (creator `owner_ref=auth.uid()`; business vía
  `business_role`) + staff. **Vacía en demo.**
- **`payment_accounts`** (nueva): método de payout, **solo estado** (§41 "CL solo guarda
  estado/ID/requisitos"): `(id, tenant_id, connected_account_id, kind ['bank'|'card'],
  last4, brand, is_default, status, created_at)`. **Sin PAN/IBAN** (Stripe los tiene).
  Service-write. Vacía en demo.
- **Campos `stripe_*` de verificación (§38):** centralizados en `connected_accounts`
  (details_submitted/charges_enabled/payouts_enabled/requirements_*). La regla §132 ("no
  habilitar solo por tener `stripe_account_id`") se implementa cuando aterrice el webhook:
  el gate mira `charges_enabled/payouts_enabled/requirements`, no la mera existencia del id.
- `creator_profiles`/`business_verifications` referencian el `connected_accounts` de su
  dueño para la insignia "pagos activados".

`user_verifications` (§37) **no** se crea como tabla redundante: se compone de
`profiles` (phone/email/identity flags) + `user_phones` + MFA de `auth`. (Pregunta
Abierta #6 si quieren una tabla materializada única.)

---

## 10. Plan RLS por tabla nueva (todas: `tenant_id` + FORCE + 4 policies)

| Tabla | Migr. | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|---|
| `user_roles` | 0028 | dueño + staff (+global) | service/RPC/trigger (`false`) |
| `score_history` | 0029 | dueño(user/creator) + staff (+global) | service/motor (`false`) |
| `score_penalties` | 0029 | dueño + staff (+global) | service/RPC (`false`) |
| `creator_scores` | 0029 | **público** (`true`) | service/motor (`false`) |
| `business_scores` | 0029 | **público** (`true`) | service/motor (`false`) |
| `user_phones` | 0030 | **solo dueño** | service (`false`) |
| `business_members` | 0031 | miembros del negocio + staff | RPC/service (`false`) |
| `business_verifications` | 0031 | miembros + staff | service (`false`) |
| `business_audit_log` | 0031 | miembros (admin+) + staff | service/RPC (`false`) |
| `creator_portfolio_items` | 0032 | **público** (`true`) | dueño (INSERT/UPDATE/DELETE scoped) |
| `business_reviews` | 0033 | público de `visible` + autor + staff | autor INSERT once; UPDATE/DELETE service |
| `appeals` | 0033 | apelante + staff | apelante INSERT; transición RPC (`false`) |
| `account_restrictions` | 0033 | dueño + staff | RPC admin (`false`) |
| `job_deliverables` | 0034 | partes del contrato + staff | parte (server) / service |
| `job_revisions` | 0034 | partes + staff | parte (server) / service |
| `connected_accounts` | 0035 | dueño + staff | service/webhook (`false`) |
| `payment_accounts` | 0035 | dueño + staff | service/webhook (`false`) |
| `security_signals` | 0036 | **solo staff** | service (`false`) |

`trust_scores` (extendida) mantiene su RLS público-lectura/service-escritura de `0003`.
`gig_reviews_select` (0024) se **reemplaza** por la variante doble-ciego (mismo nombre).
`gig_contracts` extiende su CHECK de status. `account_sanctions` gana `scope`.
`profiles` gana `phone_verified`/`email_verified` (públicos, service-write vía guarda).

---

## 11. Migraciones borrador (0028–0037, forward-only, SIN aplicar)

| # | Archivo | Contenido |
|---|---|---|
| 0028 | `0028_user_roles.sql` | `user_roles` + trigger default `'user'` + backfill 17 perfiles |
| 0029 | `0029_score_infra.sql` | extiende `trust_scores` (previous/factors/version/re-mapeo de nivel + recompute) · `score_history` · `score_penalties` · `creator_scores` · `business_scores` · funciones de nivel puras |
| 0030 | `0030_phone_private.sql` | `user_phones` + `profiles.phone_verified`/`email_verified` + extensión de la guarda · nota Twilio |
| 0031 | `0031_business_multi_admin.sql` | `business_members` + `app.business_role()` + espejo del propietario · `business_verifications` · `business_audit_log` + TTL cron |
| 0032 | `0032_creator_activation.sql` | `creator_profiles.status` + `categories` · `creator_portfolio_items` · `app.creator_activation_eligible()` + RPCs |
| 0033 | `0033_reviews_appeals_suspensions.sql` | `gig_reviews` doble-ciego (alter + reveal trigger + cron) · `business_reviews` · `appeals` · `account_restrictions` + `account_sanctions.scope` + RPCs + triggers scoped |
| 0034 | `0034_deliverables.sql` | `job_deliverables` · `job_revisions` · extensión de `gig_contracts.status` (estados no-monetarios) |
| 0035 | `0035_connect_ready.sql` | `connected_accounts` · `payment_accounts` (vacías, service-only) |
| 0036 | `0036_anti_manipulation.sql` | `security_signals` (hasheada) + helper HMAC + TTL cron |
| 0037 | `0037_score_engine.sql` | `recalc_user/creator/business_score` (late-bound) + triggers de evento + `recalc-scores-daily` cron |

**Seguimiento REVISADO (no de este agente):** aplicar con `apply_migration`; `get_advisors`
(security+perf) tras **cada** una; regenerar `database.types.ts`; `npm run check:rls`
verde; y el cambio acoplado de `lib/trust/levels.ts` + `signals.ts` + `components/trust`
(§2.1) en la MISMA PR.

---

## 12. PREGUNTAS ABIERTAS para Manuel (product/legal — no adivinar)

1. **Re-mapeo de niveles del User Score = cambio DB+UI acoplado.** `0029` cambia la
   taxonomía (`nuevo/activo/confiable/verificado/destacado`). Aplicarla **sin** el cambio
   simultáneo de `lib/trust/levels.ts` + `signals.ts` + `components/trust/levels.*`
   degrada toda la UI de confianza a "nuevo". ¿Confirmás que el cambio de app viaja en la
   **misma PR revisada** que la migración? ¿Y OK con que `verificado` cambie de
   significado (era 20–39, pasa a 70–84) en todos los perfiles ya scoreados?
2. **Venia legal para teléfono + tracking conductual.** Reintroducir teléfono revierte el
   anti-honeypot §5.4, y `security_signals` (aun hasheada) es tracking. Ambas necesitan
   **firma legal** antes de recolectar datos reales (mismo gate que el pentest de Hito 1).
   ¿Se recolecta teléfono real en demo o solo se cablea el flujo con Twilio y datos de
   prueba hasta la firma? ¿Base legal / política de retención del número (hoy: sin TTL
   mientras la cuenta viva)?
3. **Ancla del negocio:** ¿OK reusar `business_accounts` como entidad negocio (menos
   churn), o prevén casos que exijan una tabla `businesses` dedicada — negocio **sin**
   billing, o **varios listings** por negocio? Si es lo segundo, conviene la tabla nueva
   ahora y no migrar después.
4. **Reseñas comunitarias de negocio (`business_reviews`) — ¿alcance ahora?** Abrir que
   cualquier usuario reseñe negocios es una **superficie de moderación y manipulación**
   grande (review-bombing). ¿Entra en este ciclo, o dejamos solo las reseñas verificadas
   de contrato (`gig_reviews`) y diferimos las comunitarias?
5. **Plazos de negocio a confirmar:** timeout de reveal doble-ciego (propuesto **14
   días**); TTL de `security_signals` (propuesto **90 días**); TTL de `business_audit_log`
   (propuesto **365 días**, alineado con `audit_log`). ¿Valores OK?
6. **¿`creator_levels` / `user_verifications` como TABLAS o como lógica?** Propuesto:
   niveles de creador/negocio como **función canónica** (no tabla de config idéntica en
   single-community), y `user_verifications` **compuesto** de columnas existentes (no
   tabla redundante). ¿De acuerdo, o querés tablas materializadas para que product/ops
   editen umbrales sin deploy?
7. **Nombres §37 vs. app real:** ¿OK mantener los nombres reales (`gig_*`, `listings
   kind='creator_gig'`, `moderation_queue`) y documentar el mapeo a los nombres de la
   spec (`jobs`, `job_contracts`, `moderation_cases`), en vez de renombrar (churn + rompe
   la app)?
8. **¿Un solo teléfono por cuenta, para siempre?** El unique global sobre `phone_e164`
   implica que un número liberado (cuenta borrada) **queda reutilizable** (cascade lo
   borra). ¿Correcto, o quieren cuarentena del número tras baja para frenar
   recreación-tras-suspensión (§2)? Eso requeriría retener el **hash** del teléfono de
   cuentas baneadas (decisión de retención, choca con minimización).
9. **2FA/MFA para el +5 del User Score:** ¿se habilita Supabase MFA (TOTP) en este ciclo?
   El motor lo leería de `auth.mfa_factors`; sin MFA habilitada, ese factor queda en 0
   para todos.

---

## 13. Lo que este diseño explícitamente NO hace

- No aplica migraciones ni toca la DB (solo borradores).
- No escribe UI ni server actions (Fase 2, worktrees en paralelo).
- No implementa lógica de dinero real (Connect diferido tras Hito 1).
- No regenera `database.types.ts` (paso revisado posterior).
- No modifica `lib/trust/*` ni `components/trust` (cambio acoplado, misma PR revisada,
  Pregunta Abierta #1).
- No construye el motor de detección anti-fraude (solo captura señales para después).

---

## 14. DECISIONES DE MANUEL sobre las preguntas abiertas (2026-07-22 — RESUELTAS, contrato final)

- **OQ#1 — Re-mapeo de niveles:** ✅ Viaja en la MISMA PR revisada que el cambio de `lib/trust/levels.ts` + `signals.ts` + `components/trust/levels.*`. Aceptado que `verificado` cambie de umbral (era 20–39, pasa a 70–84) en los perfiles ya scoreados (son demo). El nivel se **recomputa desde el score**, no se re-mapea el string.
- **OQ#2 — Teléfono/legal:** ✅ **Twilio en modo TEST hasta firma legal.** Se construye TODO el flujo (tabla privada `user_phones`, OTP, una-cuenta-por-número, DOB privada) pero **NO se recolecta ningún teléfono real de usuario** hasta que haya venia legal + credenciales de Twilio en Vercel. En demo/test usa números de prueba; degrada con elegancia (flag `isTwilioConfigured`). La nota legal/privacidad del §4 sigue como gate junto al pentest de Hito 1.
- **OQ#3 — Ancla del negocio:** ✅ **Reusar `business_accounts`** (no crear tabla `businesses`). Multi-admin + verificación se cuelgan de su `id`; la cara pública sigue siendo el listing `kind='business'`.
- **OQ#4 — Reseñas comunitarias de negocio:** ✅ **DIFERIDAS.** Este ciclo NO se construye `business_reviews` comunitaria. El factor "reseñas verificadas" del Business Score se alimenta solo de reseñas de contrato (`gig_reviews`, transacción `released`) por ahora. `business_reviews` queda documentada como capa posterior (con moderación anti review-bombing).
- **OQ#5 — Plazos:** ✅ reveal doble-ciego **14 días** · TTL `security_signals` **90 días** · TTL `business_audit_log` **365 días**.
- **OQ#6 — Niveles/verificaciones como lógica:** ✅ `creator_levels`/`business_levels`/`user_level` como **función SQL canónica** (no tabla de config). `user_verifications` **compuesto** de columnas existentes (no tabla redundante).
- **OQ#7 — Nombres §37:** ✅ Mantener nombres reales (`gig_*`, `listings kind='creator_gig'`, `moderation_queue`) + documentar el mapeo. NO renombrar.
- **OQ#8 — Cuarentena de teléfono tras baja:** ✅ **Sin cuarentena ahora** — el número queda reutilizable al borrar/banear (cascade). Se revisa si aparece recreación-tras-baneo real (ahí se agrega retención del hash).
- **OQ#9 — MFA/2FA:** ✅ **Diferido** este ciclo. El factor "+5 por 2FA" del User Score queda en 0 hasta habilitar Supabase MFA (TOTP).

**Impacto en las migraciones:** OQ#3 confirma `0031` sobre `business_accounts` (sin tabla `businesses`). OQ#4 **quita `business_reviews`** de `0033` (queda solo doble-ciego de `gig_reviews` + `appeals` + `account_restrictions`). OQ#2/OQ#8 mantienen `0030` como está (flujo completo, sin recolección real, sin cuarentena). El resto sin cambios.


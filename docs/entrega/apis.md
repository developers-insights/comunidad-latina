# APIs de Comunidad Latina

Inventario completo de los `route.ts` bajo `src/app/**`. La plataforma es, sobre todo, Server Components + Server Actions (no APIs REST clásicas) — los route handlers listados acá son los únicos puntos HTTP explícitos del backend.

**Convención de esta plataforma:** casi toda escritura de datos pasa por **Server Actions** (funciones `"use server"` invocadas directamente desde formularios/componentes, sin URL propia), no por rutas de API. Una acción se vuelve route handler solo cuando necesita algo que una Server Action no da: ser cancelable (AbortController), recibir un webhook externo, o ser `GET` idempotente y cacheable. Eso explica por qué el inventario de abajo es corto — el resto de "las APIs" de este producto son los archivos `actions.ts` de cada carpeta (ver ejemplos en `docs/entrega/manual-super-admin.md` y `manual-admin-local.md`).

---

## Inventario

| Ruta | Método | Auth requerida | Público / Interno |
|---|---|---|---|
| `/api/assistant` | POST | Opcional (funciona anónimo y logueado) | **Público** |
| `/api/assistant/feedback` | POST | Opcional | **Público** |
| `/buscar/api` | GET | Ninguna explícita (RLS decide qué ve cada quien) | **Público** |
| `/api/webhooks/stripe` | POST | Firma de Stripe (`stripe-signature` + `STRIPE_WEBHOOK_SECRET`) | **Interno** (solo Stripe le pega) |

No existen rutas `api/cron/*` en el código actual — ver la nota "Cron" al final.

---

## 1. `POST /api/assistant`

**Archivo:** `src/app/api/assistant/route.ts`

El Asistente Comunitario: responde preguntas generales de la comunidad citando únicamente fuentes verificadas, vía Claude (Anthropic).

**Autenticación:** opcional. Detecta sesión con `supabase.auth.getUser()`; si no hay usuario, opera en modo anónimo con límites más estrictos.

**Payload (JSON):**
```ts
{ question: string }   // 3 a 500 caracteres
```

**Respuesta:** stream NDJSON (`application/x-ndjson`), una línea JSON por evento:
- `{ t: "start", queryId: string | null }`
- `{ t: "delta", text: string }` (repetido — tokens del modelo)
- `{ t: "sources", sources: [...] }`
- `{ t: "actions", actions: [{ label, href }] }` (opcional — ej. "Hablar con un profesional verificado")
- `{ t: "done" }` o `{ t: "error" }`

**Errores no-stream:**
| Código | Cuándo |
|---|---|
| 400 | Payload inválido (Zod) |
| 429 `{ error: "rate_limit" }` | Techo duro superado (ver límites abajo) |
| 429 `{ error: "anon_limit" }` | Cortesía de invitado agotada (3 preguntas/sesión) |
| 503 `{ error: "ai_unavailable" }` | `ANTHROPIC_API_KEY` no configurada — degradación elegante, nunca un error crudo |

**Rate limiting (tres capas, todas server-side):**
- Logueado: 10 preguntas/hora (memoria del proceso + conteo en `assistant_queries`).
- Anónimo — capa dura: por IP, 20/hora, más un breaker global de 300/hora para toda la instancia. Corre **antes** de cualquier llamada paga a Anthropic; omitir la cookie no la evita.
- Anónimo — cortesía UX: cookie firmada con HMAC (`cl-asst`), 3 preguntas por sesión de 24h.

**Guardrails de contenido (tres capas, antes de invocar al LLM):**
1. Moderación de la pregunta con OpenAI omni-moderation.
2. Heurística de "caso puntual" (pide consejo legal/médico/de elegibilidad de SU situación) → respuesta fija de derivación a un profesional verificado, sin tocar el LLM.
3. Retrieval acotado al tenant: si no hay fuentes con similitud suficiente, responde honestamente "no tengo información verificada" — nunca alucina.

**Efectos:** inserta en `assistant_queries` (solo el hash SHA-256 de la pregunta, nunca el texto en claro — anti-PII). Nunca escribe en tablas de contenido.

**Privacidad:** la pregunta jamás se persiste ni se loguea en claro.

---

## 2. `POST /api/assistant/feedback`

**Archivo:** `src/app/api/assistant/feedback/route.ts`

Registra el 👍/👎 sobre una respuesta previa del asistente.

**Autenticación:** opcional (mismo criterio que arriba).

**Payload:**
```ts
{ queryId: string /* uuid */, helpful: boolean }
```

**Respuesta:** siempre `{ ok: true }`, incluso si el guardado interno falla (fire-and-forget: la UI agradece igual).

**Autorización del recurso:** antes de escribir, verifica que la fila `assistant_queries` pertenezca al mismo tenant y, si hay sesión, al mismo `profile_id` (un anónimo solo puede marcar consultas anónimas). Usa el cliente admin porque la tabla es de escritura exclusiva de `service_role`, pero el chequeo de pertenencia ocurre en el código antes de tocar la fila.

**Efectos:** actualiza `assistant_queries.helpful`. No genera entrada de auditoría (es un booleano de analítica, no una acción administrativa).

---

## 3. `GET /buscar/api`

**Archivo:** `src/app/(app)/buscar/api/route.ts`

Backend de la barra de búsqueda global (personas, avisos, negocios, eventos, videos...). Vive dentro del segmento `(app)/buscar/` a propósito: es el backend de una sola pantalla, no una API general.

**Por qué es GET y no una Server Action:** se dispara con cada tecla y necesita ser cancelable con `AbortController` — las Server Actions no se pueden abortar.

**Autenticación:** ninguna explícita en el handler. La RPC `global_search` que invoca es `SECURITY INVOKER` y filtra por tenant + `status='published'` + bloqueo mutuo usando el JWT de quien llama — **la RLS es la única barrera**, el handler no agrega ni necesita un `.eq('tenant_id', …)` propio.

**Query params:** `?q=<texto>` (hasta 4000 caracteres de entrada, recortado a 80 antes de llegar a la RPC).

**Respuesta:**
```ts
{ query: string, groups: SearchResultGroup[], total: number }
// o, en error/rate-limit: { error: "search_failed" | "rate_limit" }
```

**Rate limit:** 120 requests/minuto por IP (ventana generosa — pensada para frenar scripts, no gente escribiendo rápido).

**Degradación:** un `q` inválido devuelve resultados vacíos con 200, nunca 400 — la barra dispara sola mientras el usuario escribe, y un error ahí se leería como "se rompió la búsqueda".

---

## 4. `POST /api/webhooks/stripe`

**Archivo:** `src/app/api/webhooks/stripe/route.ts`

**El único endpoint verdaderamente "interno"** de la plataforma: solo Stripe le pega, nunca el cliente de la app.

**Autenticación:** verificación de firma criptográfica (`stripe.webhooks.constructEvent` sobre el body crudo, con `STRIPE_WEBHOOK_SECRET`). Sin firma válida → 400, sin llegar a tocar nada.

**Degradación:** sin `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` configuradas → 503 con log, nunca un crash.

**Idempotencia:** cada evento se inserta primero en `payment_events` con `event_id` UNIQUE. Un reintento de Stripe sobre un evento ya `processed=true` devuelve `{ received: true, duplicated: true }` sin reprocesar; si el intento anterior murió a mitad (`processed=false`), se reprocesa.

**Tiempo de respuesta:** objetivo <200ms — el handler hace solo escrituras puntuales; nada de trabajo pesado inline.

**Eventos que maneja, y qué dispara cada uno:**

| Evento de Stripe | Efecto |
|---|---|
| `checkout.session.completed` (metadata `kind=store_membership`) | Activa una Membresía de Tienda (ver `docs/entrega/extensiones-futuras.md`) |
| `checkout.session.completed` (metadata `kind=listing_premium`) | Sube un aviso a tier `premium` (único camino de escritura de ese tier) |
| `checkout.session.completed` (metadata `boost_id`) | Activa un Boost geolocalizado — con correlación estricta: la sesión, el estado previo (`pending_payment`) y el monto tienen que coincidir exactamente, o no se activa y queda log de alerta para reconciliar a mano |
| `checkout.session.completed` (metadata `post_promotion_id`) | Activa una campaña de post pagada — misma disciplina de correlación que el Boost |
| `checkout.session.completed` (metadata `business_account_id` + `plan`) | Activa un plan de Presencia Verificada (Básico/Prioridad/Pro) |
| `checkout.session.async_payment_succeeded` | Confirma Boost o campaña de post pagados por método asíncrono (ej. transferencia) |
| `identity.verification_session.verified` | Enciende `profiles.identity_verified`, suma +25 al Trust Score (clamp a 100). Del documento de identidad **nada** llega a la base — solo el sí/no |
| `identity.verification_session.requires_input` | Notificación cálida pidiendo reintentar (foto movida, documento cortado) |
| `customer.subscription.updated` / `.deleted` | Sincroniza `business_accounts.plan_status` |

**Respuesta:** siempre `{ received: true }` en éxito (o `{ received: true, duplicated: true }`), `{ error: ... }` con 400/500/503 en falla — 500 hace que Stripe reintente.

**Auditoría:** cada activación exitosa deja un registro en `audit_log` (con ids, nunca contenido) y una notificación al comprador.

**Advertencia del propio código:** este endpoint escribe con `service_role` (bypassa RLS) y activa planes pagos/boosts/Identity — el código deja explícito que requiere firma humana senior antes de apuntarlo a claves `live` de producción.

---

## Nota — Cron jobs y `CRON_SECRET`

`docs/ARQUITECTURA.md` describe rutas `api/cron/*` protegidas con `Authorization: Bearer ${CRON_SECRET}`. **Esas rutas no existen en el código actual.** Lo que hoy hace el trabajo de "cron" son jobs `pg_cron` que corren **dentro de Postgres**, agendados por migración (`supabase/migrations/0013_cron_ttl.sql`):

| Job | Frecuencia | Qué purga |
|---|---|---|
| `purge-expired-messages` | Diario 03:10 UTC | Mensajes con `expires_at` vencido (TTL 90 días) |
| `purge-expired-notifications` | Diario 03:20 UTC | Notificaciones vencidas (TTL 60 días) |
| `purge-old-audit-log` | Diario 03:30 UTC | Auditoría de +365 días |
| `purge-stale-conversations` | Diario 03:40 UTC | Conversaciones de +90 días sin mensajes vivos |
| `purge-processed-payment-events` | Diario 03:50 UTC | Eventos de pago procesados de +90 días (los no procesados se conservan) |
| `purge-old-broadcast-receipts` | Diario 04:00 UTC | Recibos de broadcasts vencidos hace +30 días |
| `purge-resolved-moderation-queue` | Diario 04:10 UTC | Casos de moderación resueltos hace +365 días |
| `purge-resolved-scam-reports` | Diario 04:20 UTC | Reportes de estafa resueltos hace +365 días |

Estos jobs corren como el rol `postgres` (que en Supabase bypassa RLS) — no requieren `CRON_SECRET` porque no son HTTP, viven adentro de la base.

**`CRON_SECRET` sí existe** como variable de entorno, pero su uso real hoy es distinto del descrito en el contrato: es la semilla del HMAC que firma la cookie de cortesía de preguntas anónimas del Asistente (`src/app/api/assistant/_lib/anon-limit.ts`) y, si no hay `ASSISTANT_QUERY_SECRET` dedicado, también la semilla del hash de las preguntas del Asistente (`src/lib/rag/index.ts`). Si en el futuro se agregan rutas `api/cron/*` reales, este es el secreto pensado para protegerlas — hoy simplemente no hay ninguna ruta que lo consuma con ese propósito.

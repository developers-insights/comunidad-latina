# Extensiones futuras de monetización — dónde se enchufan

Este documento es la prueba de que la arquitectura actual está **preparada** para diez monetizaciones que quedan explícitamente **fuera de esta entrega**: transmisiones en vivo, regalos virtuales, monedas compradas, ganancias, wallet/ledger interno, Pay-Per-View, comentarios pagados, Super Chat, membresías de creador y retiros.

Ninguna de estas diez existe hoy en el producto. Lo que sí existe es un patrón repetido cuatro veces en el código actual — pagos con Stripe, avisos con boost, campañas de post, membresías de tienda — y ese patrón es, literalmente, el molde para las diez. Cada sección de abajo dice: qué tabla o módulo extiende, qué punto de extensión concreto usa (nombre real de archivo/tabla/función), y qué invariante no se puede romper al construirlo.

---

## El patrón que ya existe (léase primero)

Cuatro piezas del código actual comparten la misma forma, y es la forma que cualquier monetización nueva debería copiar:

1. **Una tabla de "intento de compra"** con `status` (`pending_payment` → `active`/`published`/`funded` → estado final), `amount_cents`, `stripe_checkout_session_id` y `tenant_id`. Ejemplos reales: `boosts`, `post_promotions` (`supabase/migrations/0023_follows_post_reach.sql`), `gig_contracts` (`0024_marketplace_creators.sql`), `store_memberships` (`0048_monetizacion_tier_campanas_tiendas.sql`).
2. **Un módulo de activación propio**, separado del route handler compartido, con la forma `handleXEvent(admin, event): Promise<boolean>` — devuelve `true` si reconoció y procesó el evento (por su `metadata.kind`), `false` si no era para él. Ejemplos reales: `handleStoreMembershipEvent` (`src/app/(app)/marketplace/membresia/webhook-handlers.ts`) y `handleListingPremiumEvent` (`src/lib/monetization/premium-webhook.ts`).
3. **El webhook central los prueba en orden, ANTES del switch genérico** (`src/app/api/webhooks/stripe/route.ts`, líneas ~134-161): agregar una monetización nueva es agregar una llamada más a esa cadena, no tocar el switch.
4. **Idempotencia y correlación en `payment_events`**: todo evento de Stripe se inserta primero con `event_id` UNIQUE (dedup automático de reintentos); antes de activar cualquier cosa, el handler exige que el estado previo sea el esperado, que la sesión de Stripe coincida exactamente con la vinculada, y que el monto cobrado coincida — si algo no calza, se loguea una alerta y **no se activa nada** (ver `activateBoost` y `activatePostPromotion` en el route handler, comentario "CORRELACIÓN OBLIGATORIA (fiscal R3)").

**Invariante que ninguna monetización nueva puede romper:** pagar (visibilidad, un boost, una campaña) **jamás** toca el Trust Score ni la verificación de identidad. Está escrito explícitamente en los comentarios de `boosts`, `post_promotions` y `store_memberships`, y en el propio código del webhook. Cualquier extensión de esta lista tiene que preservar esa separación.

---

## 1. Transmisiones en vivo

**Qué extiende:** el módulo de posts/videos ya existente (`0046_short_videos_and_ad_video.sql`) y la variable de entorno reservada para Cloudflare Stream (`.env.example`, Bloque C — `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, marcada explícitamente como "Fase 2").

**Punto de extensión concreto:** una tabla nueva `live_streams` (tenant_id, host_id, status, provider_stream_id) siguiendo el mismo patrón de tabla-por-tenant-con-RLS que toda tabla de contenido en este esquema — no un tenant global. El contenido del stream entraría a `moderation_queue` con su propio `subject_kind` ("live_stream"), reusando `enqueueModeration` (`src/lib/moderation/index.ts`) en vez de inventar una cola nueva.

**Qué no hay que romper:** la regla de oro §5.6 ("nunca publicar contenido con imagen/video sin moderar") y el aislamiento por tenant vía RLS — un stream es contenido como cualquier otro, no una excepción.

---

## 2. Regalos virtuales

**Qué extiende:** el mismo molde de `post_promotions`/`boosts` (tabla de intento de compra + activación por webhook), pero el "efecto" no es visibilidad sino una transferencia de valor hacia el creador — por eso depende de que exista primero el wallet/ledger (§5).

**Punto de extensión concreto:** tabla nueva `virtual_gifts` (catálogo: nombre, ícono, `price_cents`) + `gift_transactions` (sender_id, receiver_id, gift_id, tenant_id, `amount_cents`, `stripe_checkout_session_id` o referencia a saldo de moneda comprada — ver §3). El handler de activación seguiría exactamente la forma `handleGiftPurchaseEvent(admin, event): boolean`, registrado en la misma cadena del webhook que `handleStoreMembershipEvent`.

**Qué no hay que romper:** la separación pago↔reputación (arriba). Un regalo no puede sumar puntos de Trust Score — ese bonus está reservado a señales verificables (identidad, antigüedad, comportamiento), no a gasto.

---

## 3. Monedas compradas (in-app currency)

**Qué extiende:** el mismo patrón de Checkout one-time de `boosts`/`post_promotions`, pero el producto comprado es saldo, no un efecto directo sobre un aviso o post.

**Punto de extensión concreto:** un `metadata.kind = 'wallet_topup'` nuevo en el Checkout Session, reconocido por un handler `handleWalletTopupEvent(admin, event)` agregado a la cadena del webhook (mismo lugar que los otros tres `handleXEvent`), que acredita el monto en la tabla de ledger de §5. `payment_events` sigue siendo el registro fuente de todo movimiento externo de dinero — el saldo comprado es una vista derivada, no una tabla paralela de verdad.

**Qué no hay que romper:** la disciplina de correlación (sesión + monto + estado previo) descrita en el patrón general — sin ella, un reintento de webhook podría acreditar saldo dos veces.

---

## 4. Ganancias (creator earnings)

**Qué extiende:** `gig_contracts` (`supabase/migrations/0024_marketplace_creators.sql`) — la tabla **ya calcula** cuánto gana un creador por cada contrato, hoy mismo, con columnas generadas:

```sql
platform_fee_cents int generated always as ((amount_cents * fee_pct) / 100) stored,
creator_net_cents  int generated always as (amount_cents - ((amount_cents * fee_pct) / 100)) stored,
```

**Punto de extensión concreto:** una pantalla de "Ganancias" para el creador es, literalmente, `SUM(creator_net_cents) FROM gig_contracts WHERE creator_id = $1 AND status = 'released'` — no hace falta un cálculo nuevo, el fee (`fee_pct`, default 20%) ya está resuelto y auditado en la fila del contrato.

**Qué no hay que romper:** `fee_pct`/`platform_fee_cents`/`creator_net_cents` son la **única** fuente de verdad de cuánto se queda la plataforma. Cualquier feature de "ganancias" tiene que leer estas columnas, nunca recalcular el fee con lógica propia en otro lado — eso crearía dos verdades sobre lo mismo, el mismo error que el trigger `app.mirror_store_active()` fue creado para evitar en `store_memberships` (ver cita textual del código en §9).

---

## 5. Wallet / ledger interno

**Qué extiende:** `payment_events` como registro append-only de todo movimiento de dinero externo (ya existe, ya es la fuente de verdad de Stripe) + el patrón de `creator_net_cents` de `gig_contracts` como ejemplo de "cuánto le corresponde a quién".

**Punto de extensión concreto:** una tabla nueva `wallet_ledger` (profile_id, tenant_id, `amount_cents` con signo, `source_kind` — `gig_contract` / `gift` / `topup` / `withdrawal` / `store_membership` —, `source_id`, `created_at`), append-only por RLS (mismo patrón que `audit_log`: policies de INSERT en `false` para el cliente, solo `service_role` escribe). El saldo de una persona es `SUM(amount_cents)` sobre sus filas — nunca una columna `balance` mutable que alguien pueda desincronizar de su historial.

**Qué no hay que romper:** el ledger es un **derivado** de `payment_events` + `gig_contracts`, no un reemplazo. La idempotencia de `payment_events` (`event_id` UNIQUE) sigue siendo la que impide que un reintento de Stripe duplique un movimiento — el ledger hereda esa garantía, no la reimplementa.

---

## 6. Pay-Per-View (PPV)

**Qué extiende:** exactamente el molde de `post_promotions` (Checkout one-time + activación con correlación estricta), pero en vez de comprar alcance se compra acceso a un contenido puntual.

**Punto de extensión concreto:** tabla nueva `content_unlocks` (buyer_id, `content_kind`, `content_id`, tenant_id, `amount_cents`, `stripe_checkout_session_id`, `status` `pending_payment`/`active`), con un handler `handlePpvUnlockEvent(admin, event)` que replica **literalmente** la lógica de `activatePostPromotion` (`src/app/api/webhooks/stripe/route.ts`): exige que la fila siga `pending_payment`, que la sesión coincida exactamente, y que el monto coincida — si algo no calza, loguea alerta y no desbloquea.

**Qué no hay que romper:** el chequeo de acceso al contenido (¿esta persona pagó por esto?) tiene que vivir en RLS sobre la tabla del contenido protegido, con la misma disciplina que ya separa "el filtro de conveniencia" de "la barrera real" en todo el resto del esquema (ver `docs/entrega/arquitectura-diagrama.md`, §3) — nunca un chequeo solo en el cliente.

---

## 7. Comentarios pagados

**Qué extiende:** el mismo molde de `post_promotions`, aplicado a `comments` en vez de a `posts`.

**Punto de extensión concreto:** tabla nueva `comment_promotions` (comment_id, buyer_id, tenant_id, `amount_cents`, `stripe_checkout_session_id`, `starts_at`/`ends_at`, `status`) — mismas columnas, mismo ciclo de vida que `post_promotions`. El handler de activación (`handleCommentPromotionEvent`) se agrega a la misma cadena del webhook.

**Qué no hay que romper:** la disciplina de divulgación honesta (FTC §255) que ya rige boosts y campañas de post — el código es explícito en que "Destacado" está reservado al nivel máximo del Trust Score (ganado, no comprado) y que todo lo pago se marca "Patrocinado"/"Publicidad" sin excepciones (ver comentarios de `src/lib/stripe/index.ts` sobre `BOOST_PACKAGES` y `POST_PROMO_PACKAGES`). Un comentario pagado necesita su propia etiqueta honesta, con el mismo criterio.

---

## 8. Super Chat

**Qué extiende:** el mismo molde de pago one-time con `audience`/alcance de `post_promotions` (columna `audience jsonb`, hoy usada para `{"scope": "all"}` o `{"scope": "zones", "zones": [...]}`), aplicado sobre el contexto de un live stream (§1) o de un hilo de comentarios en tiempo real.

**Punto de extensión concreto:** depende de que exista primero la tabla de streams/chat en vivo (§1); una vez que exista, un `super_chat_messages` (stream_id, sender_id, `amount_cents`, `stripe_checkout_session_id`, `pinned_until`) sigue el mismo ciclo que un boost, con el mismo handler de activación por correlación.

**Qué no hay que romper:** el mismo par de invariantes que el resto de la lista — separación pago↔reputación, y divulgación honesta de que el mensaje destacado es pago.

---

## 9. Membresías de creador

**Qué extiende:** `store_memberships` (`0048_monetizacion_tier_campanas_tiendas.sql`) es, letra por letra, el molde de una suscripción recurrente por Stripe a una entidad de la plataforma — hoy es una tienda, mañana sería un creador.

**Punto de extensión concreto:** tabla nueva `creator_memberships` con la misma forma que `store_memberships` (`owner_id`→creator_id, `status` `active`/`past_due`/`canceled`/`expired`, `price_cents`, `current_period_end`, `stripe_subscription_id`, `stripe_customer_id`), y un módulo de activación nuevo con la misma estructura que `src/app/(app)/marketplace/membresia/webhook-handlers.ts` (`handleCreatorMembershipEvent`), registrado en el webhook central en el mismo punto que `handleStoreMembershipEvent`.

**Qué no hay que romper — cita textual del comentario de la tabla que hay que imitar:**

> "Estado de facturación: lo escribe SOLO el webhook de Stripe via service_role — las 3 policies de escritura están en `false`" (`store_memberships`, comentario de tabla en `0048_monetizacion_tier_campanas_tiendas.sql`)

Una membresía de creador tiene que nacer con la misma regla: el cliente nunca escribe su propio `status` de facturación, ni siquiera indirectamente. Y si el efecto de la membresía se refleja en otra tabla (por ejemplo, un badge visible en el perfil del creador), ese espejo tiene que escribirlo un trigger de Postgres — igual que `app.mirror_store_active()` espeja `store_memberships.status` hacia `listings.store_active` en la misma transacción, con `app.protect_listing_counters()` bloqueando cualquier escritura manual de esa columna espejo. Repetir esa dupla (trigger de espejo + trigger de protección) es lo que evita una segunda fuente de verdad sobre lo mismo.

---

## 10. Retiros (payouts a creadores)

**Qué extiende:** una columna que **ya existe y hoy no se usa para nada**: `gig_contracts.stripe_transfer_id` (`0024_marketplace_creators.sql`, listada junto a `stripe_checkout_session_id` y `stripe_payment_intent_id`). Es, literalmente, el campo reservado para el ID de la transferencia de Stripe Connect que le paga al creador su `creator_net_cents`.

**Punto de extensión concreto:**
- Con Stripe Connect: al pasar un contrato a `status = 'released'`, un job (o acción admin) dispara `stripe.transfers.create(...)` hacia la cuenta Connect del creador y guarda el id en `stripe_transfer_id` — ningún campo nuevo hace falta en `gig_contracts` para esto.
- Con el wallet/ledger de §5: un retiro es una fila `wallet_ledger` con `source_kind = 'withdrawal'` y `amount_cents` negativo, más un registro en `payment_events` (o su equivalente para Connect) para mantener la misma idempotencia que ya protege los eventos de Stripe entrantes.

**Qué no hay que romper:** el monto retirable de un creador tiene que salir de `SUM(creator_net_cents) WHERE status = 'released'` menos lo ya retirado — nunca de un campo `available_balance` mantenido a mano, por la misma razón que `store_memberships` no deja que nadie toque `listings.store_active` directamente. Y la disciplina de correlación fiscal (§ patrón general) aplica igual de estricta del lado de la salida de dinero que del lado de la entrada: un retiro duplicado por un reintento es tan grave como una activación duplicada.

---

## Resumen — qué NO construir de cero

| Extensión | Tabla/patrón que reutiliza | Nueva tabla mínima |
|---|---|---|
| Transmisiones en vivo | `moderation_queue`, RLS por tenant | `live_streams` |
| Regalos virtuales | Molde de `post_promotions` + wallet (§5) | `virtual_gifts`, `gift_transactions` |
| Monedas compradas | Checkout one-time + `payment_events` | Handler `wallet_topup` + wallet (§5) |
| Ganancias | `gig_contracts.creator_net_cents` (ya calculado) | Ninguna — es una vista/consulta |
| Wallet/ledger | `payment_events` + `gig_contracts` | `wallet_ledger` (append-only) |
| Pay-Per-View | Molde de `post_promotions` + `activatePostPromotion` | `content_unlocks` |
| Comentarios pagados | Molde de `post_promotions` | `comment_promotions` |
| Super Chat | `post_promotions.audience` + streams (§1) | `super_chat_messages` |
| Membresías de creador | `store_memberships` + su trigger de espejo | `creator_memberships` |
| Retiros | `gig_contracts.stripe_transfer_id` (ya existe) | Ninguna imprescindible, o `wallet_ledger` |

La conclusión de este documento no es "falta construir diez sistemas nuevos" — es que **cuatro piezas ya construidas** (tabla de intento de compra + handler de activación + cadena de dispatch en el webhook + `payment_events` como fuente idempotente) cubren, con variaciones menores de esquema, las diez.

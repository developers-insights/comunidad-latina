# 04 — Monetización y Stripe Connect: Arquitectura de Pagos Multi-Tenant

**Proyecto:** Comunidad Latina (alias NYLabel) — Red social white-label multi-tenant
**Autor:** Especialista en integración de pagos
**Fecha:** 2026-07-06
**Estado:** Diseño para Plan Maestro — pendiente de validación con Geovanny antes de implementar
**Fuentes:** Documentación oficial de Stripe (docs.stripe.com), verificada por WebSearch en julio 2026. Ver enlaces al pie de cada sección.

> Restricción de esta investigación: sin acceso a MCPs autenticados de Stripe. Todo lo aquí escrito es diseño documentado contra la API pública de Stripe, no código probado contra una cuenta real. Antes de escribir la primera línea de implementación, correr el flujo completo en **modo test** con el Dashboard de Stripe abierto en paralelo.

---

## 0. Resumen del problema de negocio

Geovanny dijo, textual: *"El negocio paga $200, queda en Stripe, el creador entrega, Stripe reparte $160 al creador y $40 a la plataforma. Yo nunca toco la plata directamente porque no tengo licencia de money transfer."*

Esa frase contiene tres pedidos distintos que Stripe resuelve con **mecanismos diferentes** y es el primer malentendido a despejar:

1. **"Yo nunca toco la plata"** → esto es Stripe Connect (cuentas conectadas). Cualquier variante lo resuelve, es la base de todo.
2. **"Queda en Stripe [retenido]"** → esto es un problema de **timing de transferencia/captura**, no de tipo de cuenta. Stripe no tiene un producto llamado "escrow"; hay que construirlo con las piezas correctas (sección 2).
3. **"Stripe reparte $160/$40"** → esto es el **charge type** (destination vs. separate charges) — decide quién ve qué dinero y cuándo (sección 1).

El resto del documento resuelve estos tres problemas para cada uno de los 5 flujos de ingreso, y luego los une en un modelo de datos y de compliance común.

---

## 1. Stripe Connect: tipo de cuenta, onboarding y por qué Geovanny no toca la plata

### 1.1 Por qué Connect resuelve "no tengo licencia de money transmitter"

Sin Stripe Connect, si Geovanny cobrara $200 a un negocio y luego le pagara $160 a un creador por su cuenta (transferencia bancaria, PayPal, lo que sea), legalmente **Geovanny se convierte en un money transmitter** — necesitaría licencias estado por estado en EE.UU. (o el equivalente en cada país europeo), un dolor de cumplimiento que puede costar años y millones.

Con Stripe Connect, el dinero del comprador **nunca pasa por una cuenta bancaria de Geovanny**. El flujo real es:

- El comprador paga → el dinero entra al balance de Stripe de la **plataforma** (cuenta de Geovanny) o directo al balance del **connected account** (creador/vendedor), según el charge type elegido.
- Stripe, como procesador licenciado (tiene las licencias de money transmitter en todos los estados donde opera), mueve el dinero entre balances internos y hace los payouts bancarios finales.
- Geovanny nunca tiene custodia bancaria directa de fondos de terceros — solo ve su **application fee** (la comisión) aparecer en su balance de Stripe, que luego retira a su banco como cualquier merchant normal.

Esto es exactamente lo que confirma la documentación oficial: Stripe es el "merchant of record" (MoR) responsable de la relación con el comprador, no la plataforma — el MoR "recibe el pago del cliente, aparece en el estado de cuenta/recibo, y es responsable del bien o servicio comprado. También es responsable de disputas o reembolsos relacionados con la compra."

**Decisión:** Toda la red usa Stripe Connect. Sin excepciones, sin flujos de pago "directo" fuera de Stripe para ningún módulo.

### 1.2 Qué tipo de connected account usar

Stripe históricamente ofrecía tres tipos fijos: **Standard**, **Express**, **Custom**. En 2026 Stripe está migrando el modelo hacia **Accounts v2**, donde en vez de un tipo fijo, una cuenta se configura con **roles/configuraciones combinables**: `merchant` (puede cobrar), `recipient` (puede recibir transferencias) y `customer` (puede ser facturado por la plataforma, reemplazando al objeto Customer clásico).

| | Standard (v1) | Express (v1) | Custom (v1) | Accounts v2 (equivalente) |
|---|---|---|---|---|
| Onboarding | El usuario crea/vincula su propia cuenta Stripe completa | Stripe-hosted, formulario simplificado | Totalmente white-label, la plataforma construye toda la UI | Configurable — se puede lograr UX Express-like |
| Dashboard | Dashboard completo de Stripe | Dashboard "Express" simplificado | Sin dashboard Stripe, todo custom | Configurable |
| Responsabilidad KYC | Del usuario, ante Stripe | Compartida (Stripe hace la verificación, plataforma diseña el flujo) | 100% de la plataforma | Configurable, con KYC compartido entre roles |
| Esfuerzo de integración | Bajo | Medio | Alto (compliance propio) | Medio, con onboarding unificado |
| Riesgo/responsabilidad para la plataforma | Bajo | Medio | Alto | Medio |

**Decisión para Comunidad Latina: Express** (o su equivalente en Accounts v2 con configuración `merchant` + `recipient`), para **todos** los perfiles que reciben dinero: creadores del Marketplace y vendedores de tiendas.

Razones:
- Geovanny no tiene equipo de compliance ni quiere construir una UI completa de verificación de identidad (eso descarta Custom).
- Standard obliga al creador/vendedor a tener/crear una cuenta Stripe "de verdad" con dashboard completo — fricción alta para un vendedor informal de la diáspora latina que solo quiere vender camisetas o hacer un video, y además Standard le da a esa persona más autonomía de la que conviene (puede, por ejemplo, desconectarse de la plataforma más fácilmente, cambiar términos, etc.).
- Express delega la verificación de identidad (KYC/AML) a Stripe (documento de identidad, verificación bancaria) pero la plataforma controla el branding del onboarding, el payout schedule, y qué capacidades tiene la cuenta — el balance correcto de control vs. esfuerzo para este caso de uso.
- **Nota de futuro-proofing:** dado que Stripe está empujando activamente hacia Accounts v2, la recomendación concreta de implementación es: si el proyecto arranca desde cero hoy, evaluar con el equipo de desarrollo si conviene integrar directo contra **Accounts v2** (evita una migración futura) o contra **Express v1** (más tutoriales/soporte de comunidad hoy). Ambas rutas llegan al mismo resultado funcional descrito en este documento. Esta decisión de "v1 vs v2" es de bajo riesgo estratégico — anotarla en el Plan Maestro como punto a resolver con el arquitecto/backend antes del sprint de setup de Stripe.

### 1.3 Onboarding + KYC — flujo concreto

1. El negocio/creador se registra en Comunidad Latina como "vendedor" o "creador" en su tenant (ej. colombianos.com).
2. El backend (Edge Function de Supabase) llama a `stripe.accounts.create()` con `type: 'express'`, `country`, `email`, y **metadata obligatoria**: `{ tenant_id, user_id, role: 'creator' | 'store_owner' }`.
3. Se genera un **Account Link** (`stripe.accountLinks.create()`) de un solo uso, con `type: 'account_onboarding'`, y se redirige al usuario a la UI hospedada por Stripe (con el branding del tenant aplicado vía Connect branding settings) para completar KYC: identidad, datos bancarios, aceptación de Términos de Servicio de Stripe Connected Account.
4. Stripe redirige de vuelta a una `return_url` propia (ej. `https://colombianos.com/vendedor/onboarding-completo`) y a una `refresh_url` si el link expiró.
5. El backend escucha el webhook `account.updated` y revisa los campos `charges_enabled` y `payouts_enabled` — **estos dos booleanos son la única fuente de verdad** de si la cuenta ya puede operar. No asumir que "completó el onboarding" = "puede cobrar"; siempre verificar estos flags.
6. Mientras `charges_enabled === false`, el perfil de creador/vendedor se muestra como "verificación pendiente" y no puede publicar servicios ni tienda activa.

**Riesgo a documentar para Geovanny:** Express todavía dejará caer del embudo a un porcentaje de usuarios que no completan KYC (falta de documento, banco no soportado en su país, etc.). Esto no es un bug de la integración, es inherente a cualquier plataforma de pagos regulada — no se puede "saltar" sin volver al problema original de licencias.

**Fuentes:** [Connected account types](https://docs.stripe.com/connect/accounts) · [Using Express connected accounts](https://docs.stripe.com/connect/express-accounts) · [Connect and the Accounts v2 API](https://docs.stripe.com/connect/accounts-v2) · [Understand the merchant of record](https://docs.stripe.com/connect/merchant-of-record)

---

## 2. Charge types: destination charges vs. separate charges & transfers vs. on_behalf_of

Stripe documenta explícitamente tres formas de mover dinero en Connect. No son intercambiables — cada una implica una relación contractual distinta entre plataforma, connected account y comprador.

### 2.1 Destination charges

El cargo se crea en la cuenta de la **plataforma** (Geovanny es el merchant of record ante el comprador), y Stripe transfiere automáticamente una porción (o todo) al connected account vía el parámetro `transfer_data[destination]` + `application_fee_amount`.

```
PaymentIntent.create({
  amount: 20000, // $200.00 en centavos
  currency: 'usd',
  transfer_data: { destination: creatorAccountId },
  application_fee_amount: 4000, // $40.00 — comisión de la plataforma
  metadata: { tenant_id, order_id, flow: 'creator_marketplace' }
})
```

Stripe la recomienda para marketplaces donde la plataforma "vende" un servicio/producto que en la práctica entrega un tercero (su ejemplo textual: Airbnb, Lyft). **Encaja perfectamente con el Creator Marketplace y con el Marketplace de Tiendas**: en ambos casos hay una relación 1:1 conocida (un comprador → un vendedor/creador) en el momento del pago.

### 2.2 Separate charges and transfers

El cargo y la transferencia son dos operaciones **desacopladas**: se cobra al comprador en la cuenta de la plataforma, y en un momento posterior (o hacia varias cuentas a la vez) se ejecutan transferencias independientes con `stripe.transfers.create({ destination, amount, source_transaction })`.

Stripe recomienda este patrón solo cuando hay: (a) relación **uno-a-muchos** (un pago se reparte entre varias cuentas — ej. tienda + repartidor), (b) relación **muchos-a-uno**, o (c) **el destinatario no se conoce en el momento del pago**.

**Ninguno de los 5 flujos de Comunidad Latina tiene naturaleza 1:muchos.** Pero sí hay un caso de "destinatario conocido pero transferencia diferida" — el Creator Marketplace, donde el pago del negocio llega antes de que el creador "entregue". Ese es exactamente el patrón que se usa para construir el hold (sección 3): **destination charge con la transferencia retenida manualmente**, no un separate-charges-and-transfers clásico de reparto multi-parte.

### 2.3 on_behalf_of

`on_behalf_of` no es un tercer charge type independiente — es un **modificador** que se combina con destination charges o direct charges para decidir de quién son las tarifas país-específicas, el statement descriptor que ve el comprador en su tarjeta, y quién asume ciertas responsabilidades regulatorias locales. Cuando se setea, "el descriptor del connected account aparece en el cargo" en el resumen de tarjeta del comprador.

**Decisión:** No usar `on_behalf_of` en ningún flujo. Razón: Geovanny/la plataforma debe ser el merchant of record visible ante el comprador en **todos** los flujos (así lo confirma también el "yo nunca toco la plata" — el negocio que paga $200 debe ver "Comunidad Latina" o el branding del tenant en su estado de cuenta, no el nombre del creador individual, por control de marca y por simplicidad de disputas). Dejar `on_behalf_of` sin usar es el default correcto de un destination charge estándar.

### 2.4 Tabla de decisión por flujo

| Flujo | Charge type | `application_fee_amount` | `on_behalf_of` |
|---|---|---|---|
| Membresías/Suscripciones (Propiedad, Inmobiliaria, Profesional, Eventos) | N/A — no hay connected account, es venta directa de la plataforma vía Stripe Billing | N/A | N/A |
| Boost / Publicidad | N/A — venta directa de la plataforma | N/A | N/A |
| **Creator Marketplace** | **Destination charge** (con transferencia retenida — ver sección 3) | Sí, 20% ($40 de $200) | No |
| **Marketplace de Tiendas** (pago comprador→vendedor) | **Destination charge** directo, sin retención | No hay comisión — la plataforma no cobra `application_fee_amount` en la venta | No |
| Marketplace de Tiendas (mensualidad de la tienda) | N/A — Stripe Billing, venta directa de la plataforma | N/A | N/A |

**Fuentes:** [Understand how charges work in a Connect integration](https://docs.stripe.com/connect/charges) · [Create destination charges](https://docs.stripe.com/connect/destination-charges) · [Create separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) · [Recommended Connect integrations and charge types](https://docs.stripe.com/connect/integration-recommendations) · [Understand the merchant of record](https://docs.stripe.com/connect/merchant-of-record)

---

## 3. Creator Marketplace: el "escrow" que Stripe no tiene

### 3.1 El hecho incómodo que hay que decirle a Geovanny

**Stripe no tiene un producto de escrow.** No existe una API `stripe.escrow.create()`. Cuando Geovanny (o cualquier fuente que investigue el tema) dice "Stripe lo maneja", en realidad se refiere a que la plataforma tiene que **construir** el comportamiento de retención usando piezas más primitivas de la API. Hay que ser explícitos sobre esto en el Plan Maestro para que no sea una sorpresa a mitad de desarrollo.

Hay tres piezas disponibles, cada una con un problema:

**Opción A — Manual capture (`capture_method: 'manual'`).** Se autoriza el cargo pero no se captura hasta que el creador "entrega". Problema real y documentado: **una autorización de tarjeta solo es válida hasta 7 días**. Si el creador tarda más de una semana en entregar el trabajo (muy plausible: video editado, campaña de contenido, etc.), la autorización expira y el cargo se pierde — hay que re-autorizar, lo que puede fallar si la tarjeta ya no tiene fondos o el comprador se arrepintió. **Esta opción no sirve como mecanismo único para el Creator Marketplace de Comunidad Latina**, salvo que el SLA de entrega sea garantizado en <7 días (dudoso para trabajos creativos complejos).

**Opción B — Capturar el pago inmediatamente en el balance de la plataforma, transferir después ("delayed transfer").** Se hace un charge normal (capturado al instante, sin `transfer_data` en el momento de la creación), el dinero completo ($200) queda en el **balance de Stripe de la plataforma** (no en ningún connected account todavía), y solo cuando el creador marca "entregado" y el negocio confirma (o pasa un período de disputa sin reclamos), el backend ejecuta `stripe.transfers.create({ destination: creatorAccountId, amount: 16000, source_transaction: chargeId })`, y el `application_fee` ($40) simplemente se queda en el balance de la plataforma sin transferirse a nadie.

**Opción C — "Delayed payout" a nivel de cuenta conectada.** Es un destination charge normal (transferencia ocurre al instante hacia el connected account), pero se configura el **payout schedule** de esa cuenta en `manual` o con un delay, de forma que aunque el dinero "legalmente" ya esté en el balance de Stripe del creador, el creador no puede retirarlo a su banco hasta que la plataforma libere el payout. Stripe documenta esto como capaz de sostener fondos "hasta 90 días".

### 3.2 Recomendación: Opción B (captura inmediata + transferencia diferida vía balance de plataforma)

**Por qué no A:** la ventana de 7 días de autorización es un riesgo real de negocio para trabajos creativos que razonablemente tardan más de una semana.

**Por qué no C (como mecanismo primario):** con delayed payout, el dinero del creador **ya está "en su cuenta"** desde el punto de vista de reporting/1099 y de riesgo — si hay una disputa después, es más enredado revertir un transfer ya ejecutado que simplemente no haber transferido nada todavía. Además, el creador podría ver el saldo "pendiente" en su propio Dashboard Express y generar tickets de soporte de "¿dónde está mi plata?" antes de tiempo.

**Por qué sí B:** el dinero se queda contablemente donde debe estar mientras el trabajo está en curso — en el balance de la plataforma, exactamente lo que Geovanny describió ("queda en Stripe" = queda en el balance de Stripe **de la plataforma**, no de nadie más). El creador no ve nada en su Dashboard hasta que se ejecuta el `transfer`, lo cual es el comportamiento esperado de un escrow real. Y no hay riesgo de expiración de autorización porque el cargo ya está capturado desde el día 1.

**Trade-off que hay que aceptar:** con la Opción B, mientras el dinero está en el balance de la plataforma y no se ha transferido, la plataforma (Geovanny) técnicamente sí "tiene" ese dinero en su cuenta Stripe — pero esto **no** lo convierte en money transmitter, porque el dinero sigue custodiado y movido por Stripe (licenciado), Geovanny solo tiene visibilidad/reporting sobre un balance, no custodia bancaria directa. Esto es indistinguible, en términos regulatorios, de cualquier plataforma SaaS que cobra a un cliente y paga a un proveedor con un delay — es la forma estándar en que operan Upwork, Fiverr, y otros marketplaces con "milestones".

### 3.3 Flujo de estados del Creator Marketplace (con Opción B)

```
1. Negocio contrata creador → PaymentIntent capturado por $200 (charge normal,
   SIN transfer_data). Balance disponible en cuenta de PLATAFORMA.
   Estado interno: 'pagado_pendiente_entrega'
   metadata: { tenant_id, order_id, creator_account_id, business_user_id }

2. Creador marca trabajo como "entregado" → notificación al negocio,
   arranca ventana de revisión (ej. 72h, configurable por tenant).
   Estado interno: 'entregado_en_revision'

3a. Negocio aprueba (o no reclama dentro de la ventana → auto-aprobación) →
    backend ejecuta transfer $160 al creador + registra $40 como revenue
    de plataforma (queda en su balance, no requiere transfer).
    Estado interno: 'completado_pagado'

3b. Negocio abre disputa/reclamo dentro de la ventana → el pedido pasa a
    revisión humana (moderador/admin del tenant). Puede resultar en:
    - Refund total al negocio (stripe.refunds.create) — el creador no
      recibe nada, no hubo transfer.
    - Refund parcial + transfer parcial al creador (trabajo parcialmente
      entregado) — decisión de negocio, no de Stripe.
    - Resolución a favor del creador → sigue camino 3a.
    Estado interno: 'en_disputa' → 'resuelto_reembolso' | 'resuelto_pagado'
```

**Nota importante:** este "disputa" interno (negocio vs. creador, mediado por el admin del tenant) es **distinto** de un "dispute" de Stripe (chargeback iniciado por el titular de la tarjeta ante su banco). Ambos pueden coexistir y hay que manejarlos por separado — ver 3.4.

### 3.4 Disputes (chargebacks) y refunds — quién paga

Documentación oficial confirma: en Connect, **la plataforma es en última instancia responsable de las pérdidas por chargebacks**, tanto en destination charges como en separate charges and transfers (el modelo llamado "indirect charges" en la doc de riesgo de Stripe). Puntos clave a diseñar:

- **Refunds siempre salen del balance de la plataforma**, sin importar el charge type. Si ya se ejecutó el `transfer` al creador antes de necesitar un refund, hay que hacer una **transfer reversal** (`stripe.transfers.createReversal()`) para traer el dinero de vuelta al balance de la plataforma antes o al mismo tiempo del refund — Stripe no lo hace automático.
  - **Esto es un argumento adicional a favor de la Opción B**: si el `transfer` al creador solo se ejecuta después de la ventana de revisión (3.3), el caso "ya transferí y ahora tengo que revertir" casi no ocurre — el refund limpio (sin reversal) es el camino normal.
- **Dispute fee de $15** (no reembolsable) se cobra a la plataforma cada vez que un comprador abre un chargeback ante su banco, gane o pierda la plataforma la disputa. No se le puede pasar este fee al connected account.
- Si el creador ya recibió el `transfer` y luego hay un chargeback exitoso del comprador, y el balance del creador no alcanza para cubrir la reversión, **Stripe lo reclama del balance de la plataforma** — Geovanny debe presupuestar un pequeño "reserve" o política de negocio (ej. congelar temporalmente creadores con >2 chargebacks) para no absorber pérdidas repetidas de mala fe.
- **Recomendación operativa:** limitar el monto máximo de un contrato de Creator Marketplace sin revisión manual reforzada (ej. KYC adicional o histórico del creador) durante los primeros meses de operación, mientras se calibra el riesgo de fraude real de la comunidad.

**Fuentes:** [Place a hold on a payment method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) · [Using manual payouts](https://docs.stripe.com/connect/manual-payouts) · [Disputes on Connect platforms](https://docs.stripe.com/connect/disputes) · [Handle refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes) · [Risk and liability management with Connect](https://docs.stripe.com/connect/risk-management) · [Sharetribe: Stripe Connect marketplace payments overview](https://www.sharetribe.com/academy/marketplace-payments/stripe-connect-overview/)

---

## 4. Marketplace de Tiendas: por qué NO es un escrow y hay que evitar tratarlo como tal

Geovanny fue explícito: la tienda paga **mensualidad por tener la tienda activa**, **sin comisión por venta**, y el pago del comprador va **directo al vendedor**. Este es un flujo mucho más simple que el Creator Marketplace y **no debería copiar su complejidad**.

| | Creator Marketplace | Marketplace de Tiendas |
|---|---|---|
| ¿Hay comisión por transacción? | Sí, 20% | No |
| ¿Hay "entrega" que verificar antes de pagar? | Sí — el creador debe completar el trabajo | No — es venta de producto, la plataforma no media la logística de envío |
| ¿Necesita hold/escrow? | Sí (sección 3) | **No** |
| Ingreso de la plataforma | `application_fee_amount` por transacción | Suscripción mensual fija (Stripe Billing), independiente de cuántas ventas haga la tienda |
| Charge type | Destination charge con transfer diferido | Destination charge simple, sin `application_fee_amount`, transfer inmediato |
| Revenue de la venta en sí | 20% a la plataforma | 100% al vendedor, la plataforma no ve ni un centavo de cada venta |

**Decisión de implementación:** el pago del comprador de la tienda usa un **destination charge normal** (`transfer_data[destination]`, sin `application_fee_amount`, sin retención manual) — el dinero llega prácticamente al instante al connected account del vendedor, sujeto solo al payout schedule estándar de su cuenta Express (por defecto, rolling payouts cada 2 días hábiles en EE.UU.).

**Riesgo a marcar:** al no cobrar comisión por venta, la plataforma **no tiene visibilidad de fraude transaccional** más allá de lo que Stripe Radar detecte automáticamente por cuenta — no hay incentivo económico directo para que la plataforma revise cada venta. Este riesgo se mitiga con: (a) requerir la suscripción mensual activa (ya filtra a quien no puede pagar $X/mes, reduciendo cuentas fantasma), (b) los controles de Stripe Radar y KYC de Express ya aplican por default, (c) un límite razonable de reportes de comprador por tienda antes de suspender el módulo de tienda del tenant.

**Fuentes:** mismas que sección 2 (destination charges) — [Create destination charges](https://docs.stripe.com/connect/destination-charges), [Accept a payment using destination charges](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/destination-charges).

---

## 5. Membresías/suscripciones trimestrales — Stripe Billing

Todos los planes de membresía (Propiedad Plus/Premium, Inmobiliaria Starter/Pro/Premium, Profesional, y la mensualidad de tiendas) son **ventas directas de la plataforma al usuario final** — no hay connected account de por medio, así que es Stripe Billing puro, sin Connect. Eventos Destacado/Premium son **one-time**, no recurrentes — se modelan como Checkout Session de pago único, no como Subscription.

### 5.1 Modelo de producto/precio

Cada plan es un **Price** de Stripe asociado a un **Product**, con `recurring: { interval: 'month', interval_count: 3 }` para lograr el ciclo trimestral (Stripe no tiene un intervalo nativo "quarter", se logra con `interval: month, interval_count: 3`).

```
Ejemplo — Propiedad Premium:
Product: "Propiedad Premium" (metadata: { tenant_id, category: 'propiedad', tier: 'premium' })
Price: $59.00, recurring: { interval: 'month', interval_count: 3 }
```

Dado que cada tenant (colombianos.com, dominicanos.com, etc.) puede en teoría tener precios/monedas distintos, **se recomienda un Product/Price separado por combinación tenant+plan** en vez de reusar un Price global — esto simplifica reporting por dominio (sección 6) a costa de más objetos en el catálogo de Stripe, trade-off aceptable dado que Stripe no cobra por tener productos/precios inactivos.

### 5.2 Upgrades, downgrades y prorrateo

Stripe Billing prorratea automáticamente por default cuando se cambia el `price` de una suscripción activa (`stripe.subscriptions.update()` con el nuevo `price_id` en el `subscription_item`). Ejemplo documentado: pasar de un plan de $10/mes a $20/mes a mitad de ciclo genera una factura con crédito de -$5 por el tiempo no usado del plan viejo y +$10 por el tiempo restante del plan nuevo = $5 neto adicional.

- **Upgrade** (ej. Propiedad Plus $29 → Premium $59): usar el comportamiento default (`proration_behavior: 'create_prorations'`) — se cobra la diferencia prorrateada de inmediato.
- **Downgrade** (ej. Inmobiliaria Pro $299 → Starter $149): mismo mecanismo, pero genera un **crédito** que se aplica a la siguiente factura, no un reembolso en efectivo. Política de negocio a decidir con Geovanny: ¿el downgrade aplica inmediato (con crédito) o solo al final del período ya pagado? Para evitar que un Domain Admin/usuario "abuse" del prorrateo (upgrade-downgrade rápido para explotar créditos), la opción más simple y estándar es: **downgrades toman efecto al final del ciclo actual** (`proration_behavior: 'none'` + `subscription_schedule` con el cambio programado), mientras que **upgrades toman efecto inmediato con prorrateo**. Esto es lo que hacen la mayoría de SaaS (Netflix, etc.) y evita a Geovanny tener que emitir refunds.
- Para el caso de **cambio de intervalo** (no aplica hoy porque todo es trimestral, pero si en el futuro se agrega un plan mensual/anual), Stripe cambia la fecha de renovación al día del cambio — hay que decidir explícitamente si eso es aceptable o si se necesita un `subscription_schedule` con fecha de corte fija.

### 5.3 Dunning (fallos de cobro) y cancelaciones

- Configurar **Smart Retries** de Stripe Billing (reintentos automáticos con machine learning de timing) en vez de reintentos manuales.
- Webhook `invoice.payment_failed` → mover el registro interno a estado `pago_fallido`, notificar al usuario, pero **no cortar el acceso inmediatamente** — dar una gracia de N días (configurable) antes de degradar el tier automáticamente al plan Free/gratuito vía el webhook `customer.subscription.updated` cuando Stripe cancela la suscripción tras agotar reintentos (`subscription.status = 'canceled'` o `'unpaid'` según la config de `subscription_settings.payment_settings`).

**Fuentes:** [Modify subscriptions](https://docs.stripe.com/billing/subscriptions/change) · [Prorations](https://docs.stripe.com/billing/subscriptions/prorations) · [Change the price of existing subscriptions](https://docs.stripe.com/billing/subscriptions/change-price) · [Subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) · [What is prorated billing](https://stripe.com/resources/more/prorated-billing-101-what-it-is-how-it-works-and-how-to-use-it)

---

## 6. Boost/Publicidad — productos de pago con activación de features

Boost y Publicidad son, en términos de Stripe, casi idénticos a las membresías (venta directa de la plataforma, sin Connect), con dos diferencias de diseño:

1. **Boost es mayormente one-time**, no recurrente (el usuario paga por una campaña de "X ciudades por Y días"), mientras Publicidad mensual **sí es recurrente** (`/3 meses` según el brief, igual que membresías).
2. La activación de features **no es automática por el pago en sí** — requiere lógica de aplicación (feature flags) disparada por el webhook, no por el estado de la suscripción/pago solamente.

### 6.1 Modelo recomendado

- **Boost (one-time):** Checkout Session en modo `payment` (no `subscription`), con metadata explícita: `{ tenant_id, listing_id, boost_tier: 'basico'|'plus'|'max', cities_scope, duration_days }`.
- **Publicidad mensual (recurrente):** Subscription normal de Stripe Billing, igual patrón que sección 5.
- **Activación:** el webhook `checkout.session.completed` (para Boost one-time) o `invoice.paid` (para Publicidad recurrente) dispara una función de backend que:
  1. Verifica el evento no fue procesado (idempotencia, sección 7).
  2. Escribe/actualiza una fila en una tabla `boosts` o `ad_placements` con `starts_at`, `ends_at` (calculado desde `duration_days` o desde el período de factura), `tenant_id`, `listing_id`.
  3. Un job programado (cron / Supabase Edge Function con `pg_cron`) desactiva boosts vencidos verificando `ends_at < now()` — **no depender de un webhook de Stripe para "apagar" el boost**, porque Stripe no dispara ningún evento en el momento exacto en que un pago one-time "expira" (eso es un concepto de negocio, no de Stripe).
- **Multi-ciudad / targeting:** esto es lógica 100% de la aplicación (qué ciudades ve el boost), Stripe solo sabe que se pagó un monto por un producto — el alcance geográfico vive en metadata + la tabla de negocio, nunca en Stripe.

**Decisión de precio dinámico:** dado que Boost tiene rangos ($10–$60, $25–$100, $50–$200) que probablemente varían por número de ciudades elegidas dentro de cada tier, **no** modelar cada combinación como un Price fijo distinto en Stripe (explotaría el catálogo). En su lugar, usar **Checkout Session con `price_data` inline** (precio calculado dinámicamente por el backend al momento de crear la sesión) en vez de un `price_id` fijo — Stripe soporta esto nativamente para casos de pricing variable sin tener que pre-crear un Price por cada combinación posible.

---

## 7. Multi-tenant + pagos: una cuenta de plataforma, atribución por metadata

### 7.1 Decisión: una sola cuenta Stripe de plataforma para toda la red

**No** crear una cuenta Stripe separada por tenant/dominio. Razones:

- Stripe Connect estructuralmente ya asume **una plataforma → muchos connected accounts**; el "tenant" (colombianos.com vs. dominicanos.com) no es una entidad financiera separada ante Stripe, es una segmentación **lógica de tu propia base de datos**.
- Documentación confirma el patrón estándar para SaaS multi-tenant con Connect: "puedes crear un único endpoint de webhook Connect en tu propia cuenta que recibirá eventos de todas tus cuentas conectadas" — un solo endpoint, una sola cuenta, N connected accounts con metadata de tenant.
- Separar por cuenta Stripe por tenant multiplicaría onboarding, compliance, reconciliación y reporting sin ningún beneficio real — los Domain Admins no necesitan (ni deberían) tener acceso al Dashboard de Stripe de la plataforma completa; ese control de acceso se resuelve en la capa de aplicación (RLS + roles), no en Stripe.
- Esto también es coherente con la arquitectura ya definida del proyecto (una BD Postgres compartida con `tenant_id` + RLS) — Stripe debe reflejar el mismo patrón: una infraestructura, aislamiento lógico.

### 7.2 Cómo se atribuye revenue por dominio

**Regla dura: todo objeto de Stripe relevante a reporting lleva `tenant_id` en `metadata`.** Esto incluye, como mínimo:

| Objeto Stripe | Metadata mínima requerida |
|---|---|
| `Account` (connected, creador/vendedor) | `tenant_id`, `user_id`, `role` |
| `Customer` | `tenant_id`, `user_id` |
| `PaymentIntent` / `Charge` | `tenant_id`, `order_id`, `flow` (`membership`\|`boost`\|`creator_marketplace`\|`store_purchase`\|`event`) |
| `Subscription` | `tenant_id`, `plan_type`, `plan_tier` |
| `Transfer` | `tenant_id`, `order_id` (para poder reconciliar con el charge original) |
| `Checkout Session` | `tenant_id` + todo lo anterior según el flujo |

**Importante — límite real de Stripe:** `metadata` tiene un límite de 50 keys y 500 caracteres por valor. No es un problema para lo listado arriba, pero **no** usar metadata como base de datos — es solo para trazabilidad/debug/reconciliación rápida en el Dashboard de Stripe. La fuente de verdad del reporting de revenue por dominio es **la base de datos propia** (tabla `payments`/`orders` con `tenant_id`), poblada por los webhooks, no queries en vivo contra la API de Stripe filtrando por metadata (eso no escala ni es la forma soportada de hacer analytics).

**Reporting recomendado:** un job (diario o vía Supabase materialized view) que agregue desde la tabla de negocio `payments` — nunca desde Stripe directamente — para los dashboards de Geovanny (Global Super Admin, revenue total + por tenant) y de cada Domain Admin (revenue de su tenant únicamente, aplicando RLS también a esta tabla).

**Fuentes:** [Billing for a multi-entity business](https://docs.stripe.com/billing/multi-entity-business) · [Design a multiparty platform](https://docs.stripe.com/terminal/design-multiparty-platform) · dev.to — Building a Multi-Tenant SaaS with Stripe Connect (patrón de un solo webhook endpoint por plataforma)

### 7.3 Webhooks: idempotencia, seguridad, y eventos clave

Esta es la sección de mayor riesgo de bugs en producción si se hace mal — y la más citada en post-mortems reales de Stripe (colapsos de cola de webhooks en picos de tráfico, funciones Lambda rotas por webhooks fuera de orden, sistemas inundados por requests maliciosos al saltarse la verificación de firma).

**Reglas no negociables:**

1. **Verificación de firma siempre**, usando el SDK oficial (`stripe.webhooks.constructEvent(rawBody, signature, endpointSecret)`), nunca parseo manual del payload.
2. **Body crudo (raw) preservado** — si el framework (Next.js API route / Edge Function) tiene un middleware de JSON parsing por default, **hay que desactivarlo específicamente para la ruta del webhook**. Un solo carácter de diferencia en el body (por ejemplo, un `JSON.parse` + `JSON.stringify` que reordene keys) rompe la verificación HMAC. En Next.js App Router, esto significa leer el `request.text()` crudo, no `request.json()`, antes de pasarlo a `constructEvent`.
3. **Idempotencia por `event.id`:** tabla `stripe_events_processed (event_id PRIMARY KEY, processed_at, event_type)`. Antes de ejecutar cualquier efecto de negocio, intentar insertar el `event_id` — si falla por violación de unique constraint, el evento ya se procesó, responder `200` y salir sin reprocesar. **Crítico:** el insert del `event_id` y el efecto de negocio (ej. activar suscripción) deben ir en la **misma transacción de base de datos** — si se registran por separado y el proceso crashea entre medio, un reintento de Stripe duplica el efecto.
4. **Responder `2xx` rápido** (idealmente <200ms), **antes** de operaciones costosas. El patrón correcto: verificar firma → insertar idempotency record + encolar el trabajo real (o hacerlo async) → responder 200. Nunca hacer llamadas a APIs externas o escrituras pesadas de forma síncrona antes de responder — un timeout dispara reintentos de Stripe, y reintentos + falta de idempotencia = doble procesamiento (el research confirma este exact failure mode en retrospectivas reales: "funciones Lambda rotas por webhooks fuera de orden, sin idempotencia").
5. **Nunca confiar solo en el payload del webhook para decisiones críticas de dinero** — para eventos de alto impacto (ej. confirmar que un pago realmente se completó antes de liberar un `transfer` del Creator Marketplace), re-consultar el estado directo vía API (`stripe.paymentIntents.retrieve()`) como doble verificación, no solo confiar en `event.data.object.status` del webhook recibido.

**Eventos clave a escuchar (mínimo):**

| Evento | Uso |
|---|---|
| `account.updated` | Detectar `charges_enabled`/`payouts_enabled` de connected accounts (onboarding completo) |
| `checkout.session.completed` | Activar Boost one-time, Eventos Destacado/Premium (pagos únicos) |
| `payment_intent.succeeded` | Confirmar pago del Creator Marketplace / compra en tienda |
| `payment_intent.payment_failed` | Notificar fallo, no activar nada |
| `charge.refunded` | Sincronizar estado interno si un refund se hizo desde el Dashboard de Stripe directamente (no solo desde la app) |
| `invoice.paid` | Renovación exitosa de membresía/Publicidad mensual |
| `invoice.payment_failed` | Iniciar dunning / degradar tier tras agotar reintentos |
| `customer.subscription.updated` | Sincronizar cambios de tier (upgrade/downgrade), cancelaciones programadas |
| `customer.subscription.deleted` | Downgrade final a plan gratuito |
| `charge.dispute.created` | Alertar al admin del tenant, congelar el `transfer` pendiente si el Creator Marketplace aún no lo ejecutó |
| `transfer.created` / `transfer.reversed` | Reconciliación contable del split 80/20 |
| `payout.paid` / `payout.failed` | Monitoreo de payouts a connected accounts (detectar cuentas con banco inválido) |

**Endpoint único:** un solo endpoint (`/api/webhooks/stripe`) recibe **tanto** eventos de la cuenta de plataforma **como** eventos Connect de todas las connected accounts (se configuran ambos en el mismo endpoint desde el Dashboard, o vía `stripe.webhookEndpoints.create()` con `connect: true`). El handler debe despachar por `event.account` (presente solo en eventos Connect) para saber si el evento viene de un connected account o de la plataforma misma.

**Fuentes:** [Receive Stripe events in your webhook endpoint](https://docs.stripe.com/webhooks) · Hooklistener — Stripe Webhooks Complete Implementation Guide 2026 · Stigg — Best practices I wish we knew when integrating Stripe webhooks

---

## 8. Modelo de datos: payments / subscriptions / payouts

Esquema mínimo recomendado (Postgres/Supabase, con RLS por `tenant_id` en todas las tablas salvo `stripe_events_processed`, que es de infraestructura interna sin necesidad de RLS por tenant):

```sql
-- Cuentas conectadas (creadores y vendedores de tienda)
create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  stripe_account_id text not null unique,
  role text not null check (role in ('creator', 'store_owner')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotencia de webhooks (global, sin tenant_id — es infraestructura)
create table stripe_events_processed (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

-- Órdenes/pagos genéricos (membership, boost, evento, compra en tienda, creator marketplace)
create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  flow text not null check (flow in ('membership','boost','ad_monthly','event','store_purchase','creator_marketplace')),
  stripe_payment_intent_id text unique,
  stripe_customer_id text,
  amount_total integer not null, -- centavos
  application_fee_amount integer default 0,
  currency text not null default 'usd',
  status text not null, -- pagado_pendiente_entrega | entregado_en_revision | completado_pagado | en_disputa | reembolsado | fallido
  connected_account_id uuid references connected_accounts(id),
  buyer_user_id uuid references users(id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Transferencias ejecutadas hacia connected accounts (split del Creator Marketplace)
create table transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  payment_id uuid not null references payments(id),
  stripe_transfer_id text unique,
  connected_account_id uuid not null references connected_accounts(id),
  amount integer not null,
  status text not null default 'pending', -- pending | completed | reversed
  created_at timestamptz not null default now()
);

-- Suscripciones (membresías + publicidad mensual)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  plan_type text not null, -- propiedad | inmobiliaria | profesional | tienda_mensualidad | ad_monthly
  plan_tier text not null, -- plus | premium | starter | pro | etc.
  status text not null, -- active | past_due | canceled | unpaid
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Boosts activos (derivados de payments.flow = 'boost')
create table boosts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  payment_id uuid not null references payments(id),
  listing_id uuid not null,
  boost_tier text not null, -- basico | plus | max
  cities_scope jsonb not null default '[]',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true
);
```

**Nota de RLS:** todas las tablas de negocio (`connected_accounts`, `payments`, `transfers`, `subscriptions`, `boosts`) deben tener policies de RLS que filtren por `tenant_id = current_tenant()` para queries de Domain Admin, y una policy separada (o bypass vía `service_role`) para el Global Super Admin que necesita ver todos los tenants a la vez. Este patrón de RLS multi-tenant ya debería estar cubierto por el skill `multi-tenant-safety-checker` del proyecto — recomiendo correr ese audit específicamente sobre estas tablas nuevas de pagos antes de ir a producción, dado que un fallo de aislamiento acá no es "un bug de UI", es una fuga de datos financieros entre dominios competidores (ej. colombianos.com viendo revenue de dominicanos.com).

---

## 9. Compliance: Stripe Tax, 1099, payouts a Geovanny y a Domain Admins

### 9.1 US Sales Tax / Stripe Tax

Para las membresías, boost, publicidad y eventos (ventas directas de la plataforma), si se venden a compradores en EE.UU., activar **Stripe Tax** en modo automático sobre los Checkout Sessions/Subscriptions — calcula y potencialmente remite sales tax por estado sin que la plataforma tenga que mantener tablas de tasas manualmente. Para las ventas del Marketplace de Tiendas y Creator Marketplace, la responsabilidad de tax recae generalmente sobre el connected account (el vendedor/creador es quien "vende" el bien/servicio ante el comprador) — esto se configura activando Stripe Tax también a nivel de connected account, o dejando explícito en los Términos de Servicio de la plataforma que cada vendedor es responsable de su propio tax compliance. **Este es un punto para validar con un asesor legal/fiscal antes de lanzar**, dado que las reglas de nexus varían por estado y este documento no reemplaza asesoría fiscal.

### 9.2 1099 para creadores (EE.UU.)

Confirmado por documentación oficial: dado que en el Creator Marketplace **la plataforma controla el pricing** (fija la comisión del 20%, decide cuándo se libera el transfer), **es la plataforma —no Stripe— quien es responsable de emitir el 1099** al creador, no Stripe automáticamente. Stripe solo emite 1099-K de oficio en casos donde Stripe controla el pricing o cobra fees directo al connected account, que no es este caso.

- **Umbral 1099-NEC:** ≥$600 USD pagados a un creador en el año calendario → obligatorio emitir 1099-NEC.
- **Umbral 1099-K** (si aplicara por volumen/transacciones en vez de NEC): >$20,000 USD de volumen bruto Y >200 transacciones en el año — umbral alto, probablemente no aplica a la mayoría de creadores individuales de esta plataforma en el corto plazo, pero sí puede aplicar a vendedores de tienda con alto volumen.
- **Deadline 2026:** Stripe recomienda tener los formularios cargados en el Dashboard a más tardar el 22 de enero para garantizar entrega al IRS antes del deadline del 31 de enero.
- **Implementación práctica:** Stripe ofrece **1099 tax reporting** como producto dentro de Connect que puede automatizar la generación/filing de estos formularios usando los datos de `Transfer` ya presentes en la cuenta — evaluar activarlo en vez de construir generación de 1099 a mano, dado el volumen de trabajo legal/operativo que implica hacerlo manualmente bien.
- **Fuera de EE.UU. (creadores en Europa u otros países):** 1099 es un concepto exclusivamente de IRS/EE.UU. — para creadores fuera de EE.UU. aplican reglas de reporting fiscal locales, fuera del alcance de Stripe 1099. Marcar como pendiente de investigación específica por país si la red se expande a dominios europeos con creadores locales.

### 9.3 Payouts a Geovanny (revenue de la plataforma)

El `application_fee_amount` (20% del Creator Marketplace, más cualquier margen que la plataforma decida cobrar en otros flujos) se acumula en el **balance de la cuenta Stripe de la plataforma** — de ahí Geovanny configura su propio **payout schedule** (automático diario/semanal, o manual) hacia su cuenta bancaria, exactamente como cualquier merchant Stripe normal. Esto no requiere ninguna pieza especial de Connect — es el flujo estándar de "mi balance → mi banco".

### 9.4 Payouts a Domain Admins (si Geovanny decide compartir revenue con ellos)

El brief no especifica si los Domain Admins reciben una porción del revenue de su dominio (parece que no, dado que el modelo descrito es 100% centralizado con Geovanny como Global Super Admin). **Si en el futuro se decide compartir revenue con Domain Admins** (ej. un Domain Admin de colombianos.com recibe 10% del revenue de su tenant como incentivo), la forma correcta de implementarlo es tratar al Domain Admin como **otro connected account más** (Express, rol `recipient`), con un `Transfer` periódico calculado desde el reporting interno (sección 7.2) — nunca como un pago manual fuera de Stripe, por la misma razón de licencia de money transmitter explicada en la sección 1. Esto queda documentado como **decisión futura pendiente**, no como parte del MVP actual.

**Fuentes:** [US tax reporting for Connect platforms](https://docs.stripe.com/connect/tax-reporting) · [1099-NEC form state requirements](https://docs.stripe.com/connect/1099-NEC) · [1099-K form state requirements](https://docs.stripe.com/connect/1099-k) · [Stripe Connect: 1099](https://stripe.com/connect/1099)

---

## 10. Riesgos consolidados y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Autorización de tarjeta expira a los 7 días si se usa manual capture para el hold del Creator Marketplace | Usar Opción B (captura inmediata + transfer diferido), no manual capture puro |
| Webhook duplicado causa doble transfer o doble activación de membresía | Idempotencia por `event.id` en la misma transacción que el efecto de negocio |
| Middleware de JSON parsing rompe verificación de firma del webhook | Ruta de webhook exenta de parsing automático, usar body crudo |
| Fuga de datos financieros entre tenants (ej. Domain Admin ve revenue de otro dominio) | RLS estricto en todas las tablas de payments/subscriptions/transfers + audit con `multi-tenant-safety-checker` |
| Precio manipulado en un botón de pago (XSS/manipulación de frontend) | Nunca confiar en el monto que manda el cliente — el backend siempre recalcula el precio desde su propia fuente de verdad (catálogo de planes/boosts) antes de crear el PaymentIntent/Checkout Session |
| Cuentas de prueba (test mode) aceptadas accidentalmente en producción | Separación estricta de variables de entorno (`STRIPE_SECRET_KEY` test vs. live nunca en el mismo `.env`), chequeo de arranque que falle el build si detecta `sk_test_` en un entorno marcado como producción |
| Chargeback repetido de un mismo creador/vendedor de mala fe | Política de suspensión tras N disputas, reserve interno opcional |
| Creador recibe transfer pero luego hay que revertirlo (chargeback tardío) | Minimizado por diseño (Opción B retrasa el transfer hasta pasada la ventana de revisión), pero aun así implementar `transfer reversal` como código ya probado, no como parche de emergencia |
| Colapso de cola de webhooks en picos de tráfico (caso real documentado en la industria) | Responder 2xx rápido, encolar el trabajo pesado de forma asíncrona, nunca bloquear la respuesta HTTP en operaciones de base de datos costosas |

---

## 11. Próximos pasos sugeridos para el Plan Maestro

1. **Validar con Geovanny** la decisión de Opción B para el hold del Creator Marketplace (sección 3) — es la decisión de mayor impacto de este documento y afecta directamente cómo se comunica el producto a los negocios/creadores ("tu pago está protegido hasta que confirmes la entrega").
2. **Decidir Express v1 vs. Accounts v2** con quien lidere el desarrollo backend (sección 1.2) — bajo riesgo, pero mejor decidirlo antes del sprint de setup de Stripe que a mitad de camino.
3. Definir la **ventana de revisión** exacta del Creator Marketplace (72h sugeridas como default, sección 3.3) y si es configurable por tenant o global.
4. Definir precio de **Videos Premium** (pendiente en el brief original) — una vez definido, encaja en el mismo patrón de Membresías (Stripe Billing) o Boost (one-time), según si es suscripción o compra puntual.
5. Confirmar con asesor legal/fiscal el alcance de Stripe Tax y 1099 antes del lanzamiento, especialmente para los primeros dominios que se lancen fuera de EE.UU. (Europa).
6. Priorizar en el backlog de desarrollo: (a) modelo de datos de la sección 8, (b) webhook handler con idempotencia de la sección 7.3, (c) onboarding Express de connected accounts, en ese orden — son las tres piezas de las que depende todo lo demás.

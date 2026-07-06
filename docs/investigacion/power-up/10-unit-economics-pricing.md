# 10 — Unit Economics, Pricing y Camino a Rentabilidad

**Proyecto:** Comunidad Latina (alias NYLabel) — Red social white-label multi-tenant (PWA) para la diáspora latina en EE.UU./Europa
**Rol de este documento:** Power-up económico del Plan Maestro. Agrega el rigor cuantitativo que faltaba: unit economics por tenant, CAC vs LTV, proyección 12–24 meses, optimización de pricing (incluidos los 2 precios pendientes) y el upside de franquiciar el sistema.
**Autor:** Analista de negocio (startup / early-stage)
**Fecha:** 2026-07-06
**Estado:** Modelo con supuestos explícitos. TODO número aquí es un **supuesto a validar con datos reales del primer tenant**, no un hecho. La honestidad sobre esto es parte del entregable.

> **Advertencia de lectura.** Este modelo es deliberadamente conservador en revenue y explícito en costos. Los márgenes por tenant que verás son altos — y eso es real para un negocio de software con monetización supply-side — pero el **camino a rentabilidad de la red completa** es lento (12–18 meses de EBIT acumulado negativo en el caso base). Las dos cosas son ciertas a la vez. No confundir "margen por tenant maduro" con "el negocio ya es rentable".

---

## 0. TL;DR económico (leer esto primero)

| Métrica | Valor (caso base) | Fuente |
|---|---|---|
| Costo mensual por tenant (10k MAU) | **~$247/mes** | Modelo, sección 2 |
| Break-even de UN tenant (mix maduro) | **~144 MAU** (~12 cuentas pagas de negocio) | Modelo, sección 3 |
| Break-even de UN tenant (monetización temprana, intensidad 0.4) | **~370 MAU** | Modelo, sección 3 |
| Contribución por tenant maduro (10k MAU) | **~$8,800/mes** (margen ~97%) | Modelo, sección 2 |
| CAC vía influencer (por usuario pago) | **~$12.50** | Modelo, sección 4 |
| CAC vía ads pagos (referencia) | **~$40** | Benchmark |
| LTV Profesional / Inmobiliaria Pro | **$285 / $2,765** | Modelo, sección 5 |
| LTV:CAC (Profesional, influencer) | **~23:1** (ads: ~7:1) | Modelo, sección 5 |
| ARR proyectado mes 24 (base) | **~$434k** | Modelo, sección 6 |
| EBIT acumulado break-even (base) | **~mes 16–17** | Modelo, sección 6 |
| **Precio recomendado tienda** | **$29/mes** (ancla), con Starter $19 y Pro $49 | Sección 7 |
| **Precio recomendado video premium** | **$4.99/mes con tope de alcance**, NO ilimitado | Sección 7 |

**Las tres decisiones económicas más importantes de este documento:**
1. El motor de rentabilidad es la **monetización supply-side** (negocios, profesionales, inmobiliarias pagando suscripción), no el usuario común. El usuario común es adquisición + inventario de atención, no ingreso directo.
2. **Video premium plano e ilimitado pierde plata** con power users (sección 2.4 y 7.4). Hay que ponerle guardrails de uso desde el día 1.
3. La red **no es rentable por muchos meses** aunque cada tenant maduro lo sea — porque el costo (equipo + tenants vacíos rampeando) llega antes que el revenue. Presupuestar el valle.

---

## 1. Marco y supuestos globales

### 1.1 Convención de precios
Las membresías del brief están en **precio trimestral** (por 3 meses). Para razonar en MRR-equivalente, todo se convierte a mensual dividiendo por 3. Ej.: Propiedad Premium $59/trimestre = **$19.67/mes** de MRR-equivalente. Esto importa para no sobreestimar el ingreso mensual.

### 1.2 Comisión de Stripe (drag real sobre cada dólar)
- **2.9% + $0.30 por transacción** (tarjeta estándar). Fuente: doc 04 y pricing público de Stripe.
- Como las membresías se cobran **trimestralmente**, el fijo de $0.30 se amortiza sobre 3 meses → el drag efectivo del fijo es bajo por-mes. El drag porcentual (2.9%) es el que domina.
- **Chargebacks: $15 no reembolsable por disputa**, y la plataforma es *merchant of record* → **la plataforma absorbe la pérdida** (doc 04, sección 3.4). Modelado como **reserva de 3% del revenue bruto** (bad-debt + disputas + refunds). Este 3% es un supuesto; calibrar con datos reales — comunidades de diáspora con influencer-marketing pueden tener más fraude inicial.

### 1.3 Definición de "tenant maduro"
Un tenant de **10,000 MAU** con mix de monetización estabilizado. Es una referencia, no una promesa: la mayoría de los tenants tardará 12+ meses en acercarse, y varios nunca llegarán a 10k. Por eso el modelo de portfolio (sección 6) usa curvas de rampa, no el estado maduro.

### 1.4 Qué NO está modelado (límites honestos)
- **Impuestos** (Stripe Tax / sales tax por estado) — afecta el neto pero depende de nexus fiscal, fuera de alcance (ver doc 04, sección 9).
- **Costo de soporte humano** más allá del opex de equipo agregado.
- **Estacionalidad** y efectos de red no-lineales (un tenant con influencer de 1M puede romper la curva hacia arriba; uno sin tracción puede quedar plano).
- **Variación de precio/moneda por tenant** (el brief permite precios distintos por dominio; el modelo usa precios USD uniformes).

---

## 2. Unit economics POR TENANT

### 2.1 Estructura de costo mensual por tenant (10k MAU)

| Componente | $/mes | Notas |
|---|---:|---|
| Infra base (Supabase compute, storage/bw ex-video) | ~$90 + $0.007×MAU | Escala suave con MAU |
| Shared allocation (Vercel Pro+usage, Supabase Pro, Sentry, Redis, Resend) ÷ 8 tenants | ~$31 | $250/mes de plataforma repartido en 8 dominios |
| SMS verificación (Twilio) | ~$11 | 40% de MAU verifica 1×/trimestre @ $0.0079 |
| Moderación imagen (Vision) | ~$6 | 4,000 imágenes/mes @ $0.0015 |
| Moderación texto (OpenAI) | $0 | Endpoint de moderación gratuito |
| **Subtotal fijo ex-video** | **~$189** | |
| Video (Cloudflare Stream): storage | ~$7.50 | 5% MAU sube video, 0.5 min, librería 6 meses, $5/1000 min |
| Video: delivery | ~$50 | 200 views/video, $1/1000 min — **el delivery domina** |
| **Subtotal video** | **~$57.50** | Escala con engagement, no con MAU registrados |
| **COSTO TOTAL POR TENANT (10k MAU)** | **~$247/mes** | |

**Insight de costo #1:** el video es ~23% del costo del tenant y **es el único componente que puede explotar de forma no-lineal** (un video viral con 500k views cuesta ~$250 solo en delivery — más que todo el resto del tenant junto). Esto NO es un problema de infraestructura; es un problema de **pricing** (sección 7.4).

**Insight de costo #2:** a 10k MAU, el costo del tenant es trivial frente al revenue potencial. El costo casi no es el problema del negocio. **El problema del negocio es la adquisición y activación de la monetización supply-side**, no el gasto en servers. Esto reorienta dónde poner la atención: menos optimización de infra, más ventas a negocios/profesionales.

### 2.2 Revenue esperado por tenant maduro (10k MAU, mix base)

Penetración supply-side conservadora sobre 10k MAU:

| Fuente | Cuentas/unidades | MRR-equiv | $/mes bruto |
|---|---:|---:|---:|
| Propiedad Plus ($29/tri) | 60 (0.6% MAU) | $9.67 | $580 |
| Propiedad Premium ($59/tri) | 30 (0.3%) | $19.67 | $590 |
| Inmobiliaria Starter ($149/tri) | 8 | $49.67 | $397 |
| Inmobiliaria Pro ($299/tri) | 4 | $99.67 | $399 |
| Inmobiliaria Premium ($599/tri) | 2 | $199.67 | $399 |
| Profesional Plus/Premium (~$44/tri avg) | 100 (1.0%) | $14.67 | $1,467 |
| Tienda mensualidad ($29/mes) | 40 (0.4%) | $29.00 | $1,160 |
| **Subtotal suscripciones** | **244 cuentas** | | **$4,992** |
| Boost / Publicidad | 61 compradores × $45 | | $2,745 |
| Eventos | 20 × $34 | | $680 |
| Creator Marketplace (comisión 20% de $6k GMV) | | | $1,200 |
| Video Premium ($4.99) | 50 usuarios | | $250 |
| Compra en tienda (comisión 0%) | — | | $0 |
| **REVENUE BRUTO TOTAL** | | | **$9,866/mes** |
| (−) Drag Stripe (~$473) + reserva 3% | | | −$743 |
| **REVENUE NETO** | | | **~$9,103/mes** |

### 2.3 Contribución y margen por tenant

| | $/mes |
|---|---:|
| Revenue neto | $9,103 |
| Costo del tenant | $247 |
| **Contribución** | **~$8,856** |
| **Margen de contribución** | **~97%** |

**Cómo leer ese 97%:** es margen de *contribución* a nivel tenant maduro — NO margen neto del negocio. No incluye equipo, adquisición, ni los tenants inmaduros que queman sin monetizar. Es la métrica correcta para responder "¿un dominio maduro genera plata?" (sí, mucha), pero **no** "¿el negocio es rentable?" (eso lo responde la sección 6). Un inversor con criterio va a asentir con el 97% de contribución y acto seguido preguntar por el CAC blended y el valle de EBIT — ambos están en las secciones 4 y 6.

### 2.4 El problema del video, cuantificado

Contribución de un video premium plano de $4.99 frente al costo real de un creador:

| Creador | Uploads/mes | Views/video | Costo delivery+storage | Ingreso neto ($4.99) | Margen |
|---|---:|---:|---:|---:|---:|
| Ligero | 5 | 100 | ~$0.55 | $4.75 | **+$4.20** ✅ |
| Medio | 20 | 500 | **~$10.60** | $4.75 | **−$5.85** ❌ |
| Pesado | 100 | 2,000 | **~$203** | $4.75 | **−$198** ❌❌ |

**Conclusión dura:** un plan de video premium **plano con alcance/entrega ilimitados es un pasivo**, no un ingreso, apenas el usuario se vuelve activo. Cuanto más "exitoso" el creador, más pierde la plataforma. Esto define el diseño de producto del pricing de video (sección 7.4): **el premium se vende como "más alcance y mejor calidad", con un tope de minutos entregados/mes, no como streaming ilimitado.**

---

## 3. Break-even por tenant

### 3.1 Curva de contribución por MAU (mix maduro, intensidad 1.0)

| MAU | Revenue neto | Costo | Contribución | Cuentas de negocio |
|---:|---:|---:|---:|---:|
| 500 | $449 | $129 | +$320 | 12 |
| 1,000 | $906 | $136 | +$770 | 24 |
| 2,000 | $1,821 | $150 | +$1,670 | 49 |
| 5,000 | $4,552 | $193 | +$4,358 | 122 |
| 10,000 | $9,104 | $265 | +$8,838 | 244 |

**Break-even de un tenant con mix maduro: ~144 MAU** (equivalente a ~12 cuentas de negocio pagando). Es un umbral bajísimo — porque el ingreso viene de pocos negocios que pagan mucho, no de muchos usuarios que pagan poco.

### 3.2 Pero cuidado: el mix maduro no aparece el día 1

Si la monetización arranca "fina" (intensidad 0.4 — pocos negocios convencidos, poco boost, poco Creator Marketplace), el break-even sube a **~370 MAU**. Sigue siendo bajo, pero el punto es que **el break-even real depende de qué tan rápido se activa el lado supply, no de cuántos usuarios se registran.** Un tenant con 5,000 usuarios pero sin negocios pagando puede estar en pérdida; un tenant con 400 usuarios y 15 negocios comprometidos ya es rentable.

**Métrica operativa clave a instrumentar:** no perseguir MAU como North Star. Perseguir **"cuentas de negocio pagas por tenant"** y **"% de MAU que son supply-side pago"**. Ese es el driver de rentabilidad.

### 3.3 La regla de bolsillo para Geovanny

> **Un dominio se paga solo apenas ~12–15 negocios locales pagan membresía.** Ese es el objetivo de activación de cada tenant nuevo. Todo lo demás (usuarios comunes, engagement, video) sirve para *sostener* a esos negocios y justificar su pago, pero el número que hay que mirar para saber si un dominio "ya camina" es la cuenta de negocios pagos.

---

## 4. CAC — Costo de adquisición

### 4.1 Canal influencer (el diferencial del proyecto)

La tracción vía influencers dominicanos (1M+, 500K, 100K seguidores) es el mayor activo económico del proyecto. Modelo de una "ola" de activación:

| Variable | Supuesto | Racional |
|---|---:|---|
| Costo de la ola (pago + canjes + producción) | $5,000 | Mezcla de posts pagos y colaboración |
| Reach efectivo | ~1M | Influencer principal |
| Registros (2% del reach) | 20,000 | Conversión reach→signup realista para social |
| Que se vuelven pagos (2% de signups) | 400 | Supply-side + video premium |
| **CAC por signup (cualquier usuario)** | **~$0.25** | Extraordinariamente bajo |
| **CAC por usuario PAGO** | **~$12.50** | El número que importa |

**Comparación con benchmark:** Nextdoor (red hiperlocal comparable) monetiza a ~$2/MAU/mes vía publicidad y opera en un mercado de ads locales de $200B ([SEC 8-K FY2025](https://www.sec.gov/Archives/edgar/data/0001846069/000184606925000135/exhibit992-pressreleasexq3.htm)). Nuestro CAC de $12.50 por usuario pago es sano contra cualquiera de los LTV de la sección 5.

### 4.2 Canal pago (referencia / plan B)

Si el canal influencer se satura o un dominio no tiene influencer fuerte, el CAC por usuario pago vía Meta/TikTok ads en este vertical ronda **~$40** (estimado; validar por dominio). Sigue siendo aceptable para supply-side (LTV alto) pero **destruye la economía si se usa para adquirir usuarios comunes** (que no pagan directo). Regla: **ads pagos solo para captar negocios/profesionales, nunca para inflar MAU de usuarios comunes.**

### 4.3 Riesgo de concentración de canal (lo que un inversor va a marcar)

La dependencia de **pocos influencers** es un riesgo real: si el influencer principal cambia de opinión, sube el precio, o su audiencia no convierte en un país distinto al dominicano, el CAC blended se dispara hacia el número de ads pagos ($40) o peor. **Mitigación:** tratar los primeros $ de cada tenant como "compra de prueba de canal" y no comprometer los 8 dominios hasta validar la conversión real influencer→negocio-pago en el dominio dominicano piloto.

---

## 5. LTV por tipo de usuario

Fórmula: `LTV = (MRR-equiv neto de Stripe) × (vida media en meses)`, con vida media = 1/churn mensual. Churn asumido por segmento (menor churn para quien paga más y depende más de la herramienta).

| Segmento | MRR-equiv neto | Churn mensual | Vida media | **LTV** |
|---|---:|---:|---:|---:|
| Usuario común (free) | $0 directo | — | — | Monetización **indirecta** (atención → ads/boost de negocios) |
| Propiedad Plus | $9.39 | 8% | 12.5 mo | **$117** |
| Propiedad Premium | $19.10 | 7% | 14.3 mo | **$273** |
| Profesional | $14.24 | 5% | 20 mo | **$285** |
| Tienda ($29/mo) | $28.16 | 5% | 20 mo | **$563** |
| Inmobiliaria Starter | $48.23 | 4% | 25 mo | **$1,206** |
| Inmobiliaria Pro | $96.78 | 3.5% | 28.6 mo | **$2,765** |
| Inmobiliaria Premium | $193.88 | 3% | 33.3 mo | **$6,463** |

### 5.1 Ratios LTV:CAC

| Segmento | LTV | vía Influencer ($12.50) | vía Ads ($40) |
|---|---:|---:|---:|
| Profesional | $285 | **23:1** | 7:1 |
| Tienda | $563 | 45:1 | 14:1 |
| Inmobiliaria Pro | $2,765 | 221:1 | 69:1 |

**Todos los ratios superan holgadamente el 3:1 "sano" de SaaS.** Incluso vía ads pagos, la economía supply-side es excelente. Esto confirma que **el proyecto es económicamente viable si —y solo si— logra convertir usuarios en cuentas de negocio pagas.** El riesgo no es el margen; es la conversión y la retención de ese lado supply.

### 5.2 El usuario común: cómo se monetiza sin cobrarle

El usuario común (el 98%+ de la base) no paga suscripción, pero **no es gratis para el negocio: es el inventario**. Su valor económico es:
1. **Atención** que los negocios compran vía Boost/Publicidad (revenue directo).
2. **Densidad de red** que hace que un negocio quiera estar (justifica el pago supply-side).
3. **GMV** del Creator Marketplace y compras en tienda (comisión / tráfico).
4. **Opcionalidad futura:** video premium, tickets, wallet (fase 2).

Un North Star de "MAU" sin "negocios pagos" es una trampa de vanity metrics. El par correcto es **MAU (inventario) × cuentas de negocio pagas (monetización)**.

---

## 6. Proyección financiera 12–24 meses

### 6.1 Metodología
Portfolio de hasta 8 dominios con **lanzamiento escalonado** (el dominicano primero, por la tracción de influencers). Cada tenant tiene:
- Una **curva de rampa de MAU** (logística hacia un cap por escenario).
- Una **curva de rampa de intensidad de monetización** (el mix supply-side madura con el tiempo, no aparece de golpe).
- Costo de tenant según su MAU en cada mes.
- Un **opex de equipo/plataforma** mensual agregado (founder-led).

### 6.2 Escenarios

**CONSERVADOR** — 6 de 8 dominios vivos al mes 24, cap 4k MAU/tenant, monetización tope 0.45, opex $3k/mes (muy lean).

| Mes | Tenants | MAU total | MRR bruto | EBIT mes | EBIT acumulado |
|---:|---:|---:|---:|---:|---:|
| 6 | 2 | 3,037 | $438 | −$2,898 | −$18,255 |
| 12 | 4 | 8,772 | $2,171 | −$1,634 | −$31,700 |
| 18 | 5 | 14,568 | $4,654 | +$454 | −$34,276 |
| 24 | 6 | 20,187 | $7,261 | +$2,659 | **−$24,001** |

→ Mes 24: ARR ~$87k, **EBIT mensual positivo desde ~mes 18**, pero **acumulado aún negativo** (−$24k). Recupera la inversión hacia ~mes 30. Este escenario es "sobrevive pero no despega".

**BASE** — 8 dominios vivos, cap 8k MAU/tenant, monetización tope 0.7, opex $6k/mes.

| Mes | Tenants | MAU total | MRR bruto | EBIT mes | EBIT acumulado |
|---:|---:|---:|---:|---:|---:|
| 6 | 3 | 7,447 | $1,460 | −$5,144 | −$34,837 |
| 12 | 6 | 27,496 | $10,464 | +$2,511 | −$43,066 |
| 18 | 8 | 47,590 | $24,549 | +$14,979 | +$15,359 |
| 24 | 8 | 59,763 | $36,141 | +$25,512 | **+$144,106** |

→ Mes 24: **ARR ~$434k**, EBIT mensual positivo desde ~mes 12, **acumulado break-even ~mes 16–17**. Este es el caso realista objetivo.

**OPTIMISTA** — 8 dominios rápido, cap 15k MAU/tenant, monetización tope 1.0, opex $9k/mes.

| Mes | Tenants | MAU total | MRR bruto | EBIT mes | EBIT acumulado |
|---:|---:|---:|---:|---:|---:|
| 6 | 5 | 20,052 | $5,014 | −$5,293 | −$48,047 |
| 12 | 8 | 72,970 | $43,647 | +$29,232 | +$26,124 |
| 18 | 8 | 110,659 | $89,741 | +$71,238 | +$353,082 |
| 24 | 8 | 119,527 | $113,307 | +$92,855 | **+$869,480** |

→ Mes 24: **ARR ~$1.36M**, acumulado break-even ~mes 11. Requiere que el efecto influencer funcione en escala en varios dominios simultáneamente.

### 6.3 Lectura estratégica de la proyección

1. **El valle es real.** Incluso en el caso base, el negocio quema **~$43k acumulados hasta ~mes 12** antes de girar. Geovanny necesita capital (o ingresos externos) para financiar ~12 meses de valle. Este es EL número que un plan maestro optimista suele esconder.
2. **El opex de equipo domina el resultado temprano**, no el costo de infra. En el mes 6 del caso base, el costo de todos los tenants sumados (~$471) es <10% del opex de equipo ($6k). **La palanca de supervivencia temprana es mantener el equipo chico**, no optimizar servers.
3. **La rentabilidad se acelera fuerte una vez que 4–5 tenants maduran** (efecto de contribución de 97% cayendo sobre un opex casi fijo). El negocio es de **lento arranque, rápida aceleración** — típico de plataformas.
4. **Sensibilidad #1: velocidad de activación supply-side.** La diferencia entre conservador y base no es MAU — es qué tan rápido los negocios empiezan a pagar (intensidad 0.45 vs 0.7). Ahí es donde va la energía operativa.

---

## 7. Optimización de pricing

### 7.1 Diagnóstico de los tiers actuales (psicología de precios)

**Lo que ya está bien:**
- **Charm pricing** ($29, $59, $149, $299, $599, $19, $49) — correcto para audiencia sensible a precio (diáspora, negocios chicos). Mantener.
- **Escalera inmobiliaria ($149 → $299 → $599)** — buen uso de **anchoring**: el $599 hace que el $299 parezca "el razonable", que es probablemente el que más se vende (efecto **decoy** natural). El ratio ~2× entre tiers es de manual (good-better-best).
- **Membresías trimestrales** — inteligente: reduce fricción de renovación mensual, mejora retención vs mensual, y sube el ticket percibido de compra sin subir el precio mensual.

**Lo que se puede mejorar:**
- **Falta un ancla superior explícita en Profesional.** Hoy Profesional es $29–59 (Plus/Premium). Un tercer tier "Profesional Elite" (~$99/tri con lead-gen y badge destacado) daría un ancla que empuja ventas del Premium $59 — el mismo truco que ya funciona en inmobiliaria. Barato de agregar, sube ARPPU.
- **Boost tiene rangos demasiado anchos** ($10–60, $25–100, $50–200). Un rango 6× dentro de un mismo tier confunde y dispersa. Recomiendo **3 precios charm fijos por tier** (ej. Básico $19/$39/$59 según ciudades) en lugar de un rango continuo — más fácil de decidir para el comprador, mejor para conversión. El backend ya soporta `price_data` inline (doc 04, §6.1), así que es cambio de UX, no de arquitectura.
- **Validar willingness-to-pay real** con Van Westendorp en el tenant piloto antes de congelar precios (el brief permite precios por dominio; usar esa flexibilidad como laboratorio).

### 7.2 PENDIENTE #1 — Precio de la "mensualidad de tienda"

**Contexto competitivo:**
- **Shopify: ~$39/mes**, sin comisión por venta (pagás processing, no marketplace fee). Es el comp más directo — nuestra tienda es **suscripción sin comisión**, igual que Shopify. ([Etsy vs Shopify fees 2026](https://craftybase.com/blog/the-complete-guide-to-etsy-fees))
- **Etsy: $10/mes (Etsy Plus) PERO ~10–11% de comisión efectiva** por venta. Nuestro modelo NO cobra comisión, así que $10 sería regalar la tienda.
- El vendedor de la diáspora es más sensible a precio que un merchant Shopify promedio, pero **también recibe algo que Shopify no da: tráfico de la comunidad local** (Shopify te deja solo con tu tienda; acá venís con audiencia).

**Análisis de sensibilidad (tenant 8k MAU, ~22 tiendas):**

| Precio | Tiendas | Revenue/mes | Lectura |
|---:|---:|---:|---|
| $19 | 22 | $426 | Deja plata en la mesa; barato vs valor (tráfico incluido) |
| $24 | 22 | $538 | |
| **$29** | 22 | **$650** | **Sweet spot: charm, debajo de Shopify, premium sobre Etsy-base** |
| $39 | 22 | $874 | = Shopify; pierde la ventaja de "más barato que Shopify" |
| $49 | 22 | $1,098 | Techo; solo si hay features claros de e-commerce |

**RECOMENDACIÓN: escalera de 3 tiers, ancla en $29/mes.**

| Tier | Precio | Incluye |
|---|---:|---|
| **Tienda Starter** | **$19/mes** | Hasta 20 productos, storefront básico, pago Stripe Connect |
| **Tienda Plus** ⭐ (recomendado) | **$29/mes** | Hasta 100 productos, badge de tienda verificada, prioridad en feed de tiendas, analytics |
| **Tienda Pro** | **$49/mes** | Productos ilimitados, boost mensual incluido, destacado, soporte prioritario |

Racional:
- **$29 como ancla visible** = charm pricing, se posiciona explícitamente como "más barato que Shopify ($39) y sin la comisión de Etsy". Mensaje de marketing potente para el segmento.
- **$19 Starter** baja la barrera de entrada (captura al vendedor informal que solo prueba) y hace de **decoy** que empuja al $29.
- **$49 Pro** ancla por arriba y sube el ARPPU de las tiendas serias; el "boost incluido" justifica el salto y **canaliza revenue de boost hacia una suscripción recurrente** (mejor que boost one-time suelto).
- El LTV de una tienda a $29 es **~$563** (sección 5) contra CAC ~$12.50 → 45:1. Espacio de sobra; el objetivo del precio es **maximizar adopción de tiendas**, no exprimir cada una.

### 7.3 PENDIENTE #2 — Precio de "videos premium" (con el guardrail que lo hace rentable)

**El problema (ver sección 2.4):** un video premium plano e ilimitado **pierde plata** con creadores medios/pesados por el costo de delivery de Cloudflare Stream ($1/1000 min entregados). No se puede vender "video ilimitado" a $4.99 — el power user te funde.

**Análisis de sensibilidad de precio (tenant 8k MAU):**

| Precio | Adopción | Usuarios | Revenue/mes | Nota |
|---:|---:|---:|---:|---|
| $2.99 | 0.8% | 64 | $191 | Adopción alta pero margen frágil si suben views |
| $3.99 | 0.6% | 48 | $192 | |
| **$4.99** | 0.5% | 40 | **$200** | **Mejor balance ingreso/percepción + margen con tope** |
| $6.99 | 0.4% | 28 | $196 | |
| $9.99 | 0.2% | 16 | $160 | Precio ahoga adopción; el ingreso cae |

El revenue es **notablemente plano entre $2.99 y $6.99** (~$190–200) porque mayor precio compra menor adopción. Como el ingreso no cambia mucho, **la decisión se toma por margen y posicionamiento, no por maximizar ingreso.** Y el margen exige un tope de uso.

**RECOMENDACIÓN: $4.99/mes "Creador Premium" con TOPE de alcance, más un tier alto para power users.**

| Tier | Precio | Incluye | Guardrail (lo que protege el margen) |
|---|---:|---|---|
| Gratis | $0 | Videos ≤15s, alcance orgánico | Sin videos largos |
| **Creador Premium** ⭐ | **$4.99/mes** | Videos hasta 3 min, más alcance, sin marca de agua, analytics | **Tope ~3,000 min entregados/mes** (~$3 de costo); pasado el tope, throttle de calidad o cobro de overage |
| **Creador Pro** | **$14.99/mes** | Videos hasta 10 min, máximo alcance, prioridad | **Tope ~15,000 min/mes**; overage a $1.50/1000 min (cubre costo + margen) |

Racional:
- **$4.99 charm**, alineado con el precio psicológico de una suscripción de contenido "de bolsillo" (Spotify-tier mental anchor).
- **El tope de minutos entregados es lo que convierte esto de pasivo en ingreso.** El 95% de los creadores nunca lo tocará; el 5% que sí lo toca es exactamente el que hay que cobrar más (Pro) o limitar. Sin este guardrail, el producto de video premium tiene **margen negativo estructural** (sección 2.4).
- **Posicionar como "alcance + calidad", no "almacenamiento ilimitado".** El valor que se vende es distribución (que el video llegue a más gente del feed), que es justo lo que el negocio controla — no gigabytes.
- **Alternativa a evaluar:** en vez de suscripción de consumidor, hacer el video premium un **add-on de las membresías de negocio** (un profesional/tienda paga extra por video en su perfil). Esto ata el costo de video a cuentas que ya pagan mucho (LTV alto) y evita subsidiar a usuarios comunes con ambiciones de creador. **Recomiendo testear ambos** en el piloto.

### 7.4 Fuentes de revenue sin explotar (upside de pricing)

Ordenadas por facilidad × impacto:

1. **Bundles anuales con descuento (17–20%).** Hoy todo es trimestral. Ofrecer pago anual con ~2 meses gratis **sube LTV, mejora cashflow (cobrás 12 meses por adelantado — clave para financiar el valle de la sección 6) y baja churn**. Cero desarrollo nuevo (Stripe Billing lo soporta). **Máxima prioridad.**
2. **Tier "Destacado del mes" para negocios** (subasta o precio fijo premium por ser el negocio #1 de una categoría/ciudad). Ingreso de alto margen, apela al ego + ROI del negocio local. Es lo que hace Nextdoor con su inventario local.
3. **Verificación / badge de confianza pago** para negocios que quieren el Trust Score visible reforzado. Micro-ingreso recurrente, refuerza la marca de "comunidad confiable".
4. **Lead-gen premium para inmobiliarias/profesionales** (cobrar por lead cualificado, estilo Thumbtack $35–60/lead). El mercado ya está educado en pagar por lead ([Thumbtack pricing 2026](https://procured.us/articles/thumbtack-pricing)). Encaja con el tier Pro inmobiliario. Requiere producto de matching (fase 2).
5. **Publicidad geo-segmentada para negocios NO-locales** (ej. una remesadora nacional pauta en los 8 dominios). Inventario cross-tenant que solo el Global Super Admin puede vender — **ingreso que escala con la red completa, no con un tenant**. Alto potencial a partir de ~50k MAU agregados.
6. **Datos agregados / insights de mercado** (anónimos, agregados) sobre consumo de la diáspora — vendibles a marcas que quieren entrar al mercado latino. Sensible en privacidad; explorar con cuidado legal, pero es el activo de largo plazo más valioso (68M latinos).

---

## 8. Upside: vender/franquiciar el sistema (línea de negocio futura)

El brief menciona "vender el sistema a socios/franquicia". Económicamente, esto convierte a Comunidad Latina de **operador de comunidades** en **plataforma B2B2C (motor white-label licenciado)** — un cambio de categoría con múltiplos de valuación distintos.

### 8.1 Tres modelos posibles

| Modelo | Cómo funciona | Ingreso | Riesgo |
|---|---|---|---|
| **A. Franquicia por dominio** | Un socio compra el derecho a operar un dominio/país (ej. "brasileiros.com") y opera su comunidad; paga fee inicial + % de revenue | Fee setup ($5–25k) + rev-share 10–30% | Control de marca, calidad desigual entre franquiciados |
| **B. Licencia SaaS del motor** | Terceros (fuera de la diáspora latina) licencian el software para SU vertical (ej. "comunidad de nurses filipinas en USA") | Setup + suscripción mensual del motor ($500–5,000/mes/instancia) | Soporte, multi-tenancy de terceros, competencia |
| **C. Venta total del sistema** | Un player grande compra el código + los dominios + la tracción | Exit único | Timing, valuación |

### 8.2 Por qué esto ya está semi-construido (ventaja de costo)

La arquitectura multi-tenant (doc 01, 07) **ya separa datos por tenant con RLS y crea dominios en 15–30 min sin tocar código**. Eso significa que el costo marginal de agregar un franquiciado/licenciatario es **cercano al costo de un tenant más (~$247/mes)** — el producto de franquicia es casi todo margen. La infraestructura para vender el sistema **ya se paga con el negocio principal**; la franquicia es upside sobre un costo hundido.

### 8.3 Valuación potencial (orden de magnitud, no promesa)

- **Como operador (caso base, ARR ~$434k mes 24):** las redes sociales/marketplaces de nicho con buen margen transan a **~3–6× ARR** en early-stage → **~$1.3M–2.6M**. Con la trayectoria del caso optimista (ARR ~$1.36M), **~$4M–8M**.
- **Como plataforma licenciable (modelo B):** el SaaS B2B de infraestructura transa a **múltiplos más altos (6–12× ARR)** por la escalabilidad y el margen. Si la línea de licencia agrega, digamos, $300k ARR de licencias con 90% margen, puede valer tanto como todo el negocio operador.
- **Palanca de valuación clave:** demostrar que el motor funciona para **>1 vertical** (no solo diáspora latina) multiplica el múltiplo, porque prueba que el activo es "un motor de comunidades white-label", no "una app de latinos". Ese es el pitch que cambia la categoría de valuación.

**Recomendación:** NO lanzar la franquicia hasta tener **el dominio piloto rentable y 2–3 dominios validando el playbook** (mes 12–18 del caso base). Vender un sistema que aún no probaste que monetiza es vender humo; vender uno con un playbook replicado 3 veces es vender una máquina. La secuencia correcta es: **probar → replicar → licenciar.**

---

## 9. Métricas clave a instrumentar desde el DÍA 1

Sin estos números, el modelo de arriba es teoría. Instrumentar en el dashboard del Global Super Admin (doc 07, §10.2) y por tenant:

### 9.1 North Star y drivers
| Métrica | Por qué | Target inicial |
|---|---|---|
| **Cuentas de negocio pagas por tenant** | El driver #1 de rentabilidad (sección 3) | ≥12–15 para break-even de tenant |
| **% de MAU que son supply-side pago** | Salud de la monetización | ≥2% en mix maduro |
| MAU y WAU por tenant | Inventario / engagement | Rampa hacia cap del escenario |
| WAU/MAU (stickiness) | Calidad del engagement | >30% |

### 9.2 Unit economics
| Métrica | Por qué |
|---|---|
| **ARPPU supply-side** (rev por cuenta de negocio) | Valida el mix de precios |
| **CAC por canal** (influencer vs ads) — separados | Detecta si el canal influencer se satura (sección 4.3) |
| **LTV:CAC por segmento** | Debe mantenerse >3:1 (hoy 7–45:1) |
| **Churn mensual por tier** | Alimenta el LTV real vs supuesto (sección 5) |
| **Net Revenue Retention (NRR)** | Upgrades − downgrades − churn; >100% = crecimiento sin adquirir |

### 9.3 Márgenes y riesgo
| Métrica | Por qué |
|---|---|
| **Contribución por tenant** y margen | Confirma el 97% teórico con realidad |
| **Costo de video por tenant** (storage vs delivery) | Detecta el power-user que rompe el margen (sección 2.4/7.4) — **alertar si delivery >$X/tenant** |
| **Reserva efectiva por disputas/refunds** (% real) | Valida o corrige el 3% asumido (sección 1.2) |
| **Burn mensual y runway** | El valle de la sección 6 es real; vigilar el fondo |
| **EBIT acumulado vs proyección** | ¿Vamos por conservador, base u optimista? |

### 9.4 Pricing / experimentación
| Métrica | Por qué |
|---|---|
| **Conversión por tier** (vista → compra) | Detecta precios mal puestos |
| **Take-up del ancla** (¿se vende el tier del medio?) | Valida el decoy effect (sección 7) |
| **Overage de video premium** (% que toca el tope) | Valida el guardrail de la sección 7.3 |
| **Adopción anual vs trimestral** (cuando se lance) | Mide el impacto de la palanca #1 de cashflow (sección 7.4) |

---

## 10. Riesgos económicos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Concentración de canal (influencers)** — si el principal se va o no convierte fuera de RD | CAC blended se dispara | Validar conversión influencer→negocio-pago en piloto antes de comprometer 8 dominios (sección 4.3) |
| **Video premium plano funde el margen** con power users | Margen negativo estructural en video | Tope de minutos entregados + tier Pro con overage (sección 7.3) — **no negociable** |
| **El valle de EBIT (~$43k, ~12 meses)** sin capital | Muerte por falta de runway | Financiar 12–15 meses; **pago anual anticipado** (sección 7.4 #1) para adelantar cashflow |
| **Monetización supply-side arranca lenta** (negocios no pagan) | Tenants con MAU pero sin revenue | North Star = cuentas de negocio pagas, no MAU (sección 3.2). Vender activamente a negocios, no esperar inbound |
| **Chargebacks/fraude mayor al 3% asumido** en comunidad de diáspora | Erosión de margen + $15/disputa | Calibrar reserva con datos reales; política de suspensión por N disputas (doc 04 §3.4) |
| **Supuestos de penetración (0.6% propiedad, 1% profesional) demasiado altos** | Todo el modelo se corre a la derecha | Son SUPUESTOS; recalibrar tras 90 días del piloto. El modelo es una hipótesis, no un pronóstico |
| **Un dominio sin influencer fuerte** (¿chilenos.net?) nunca despega | Tenant que solo quema | No lanzar los 8 de una; lanzar donde hay canal probado, apagar/pausar los que no activan |

---

## 11. Recomendaciones accionables (priorizadas)

**Inmediato (antes de lanzar pricing):**
1. **Fijar tienda en escalera $19 / $29⭐ / $49** (sección 7.2). Marketing: "más barato que Shopify, sin la comisión de Etsy".
2. **Fijar video premium en $4.99 con tope de minutos entregados** + tier Pro $14.99 con overage (sección 7.3). El tope es lo que lo hace rentable.
3. **Instrumentar las métricas de la sección 9 desde el día 1**, especialmente "cuentas de negocio pagas por tenant" y "costo de delivery de video por tenant".

**Primeros 90 días (piloto dominicano):**
4. Correr **Van Westendorp** en el tenant piloto para validar willingness-to-pay real antes de congelar precios en los otros 7 dominios.
5. Lanzar **pago anual con ~2 meses gratis** (palanca de cashflow #1, cero desarrollo).
6. Medir la **conversión real influencer→negocio-pago** para validar el CAC de $12.50 y decidir cuántos dominios lanzar.

**6–18 meses:**
7. Agregar **tier "Profesional Elite" (~$99/tri)** y **"Destacado del mes"** como anclas superiores (sube ARPPU).
8. Convertir **rangos de Boost en 3 precios charm fijos** por tier (mejora conversión).
9. Una vez rentable el piloto + 2–3 dominios replicando el playbook, **diseñar la línea de franquicia/licencia** (sección 8) — no antes.

---

## 12. Fuentes

- Investigación interna: `docs/investigacion/04-monetizacion-stripe-connect.md` (mecánica de pagos, fees, disputas, escrow del Creator Marketplace) y `docs/investigacion/07-infra-devops-admin.md` (costos de infra, arquitectura multi-tenant, creación de tenants).
- Guía del producto: https://geovanny-estudio.onrender.com/ (features, tiers, revenue streams).
- Benchmark ARPU red hiperlocal: [Nextdoor SEC 8-K FY2025](https://www.sec.gov/Archives/edgar/data/0001846069/000184606925000135/exhibit992-pressreleasexq3.htm) (ARPU ~$1.42–1.98/MAU/mes; SMBs ~70% del revenue; mercado ads locales ~$200B).
- Benchmark pay-per-lead: [Thumbtack pricing 2026](https://procured.us/articles/thumbtack-pricing) y [Yelp for Business 2026](https://www.servicemag.org/software/yelp-for-business) ($35–60/lead típico; hasta $300–600/mes en metros competitivos).
- Benchmark tienda/e-commerce: [Etsy vs Shopify fees 2026 (Craftybase)](https://craftybase.com/blog/the-complete-guide-to-etsy-fees) (Shopify ~$39/mes sin comisión; Etsy Plus $10/mes + ~10–11% efectivo).
- Benchmark costo video: [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/) ($5/1000 min stored, $1/1000 min delivered).
- Benchmark conversión freemium: [First Page Sage SaaS Freemium 2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) y [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/) (freemium ~2–4%; hard paywall ~10%; role-based gating ~5%).
- Contexto de audiencia: [Pew Research — Latino Immigrants & Remittances](https://www.pewresearch.org/wp-content/uploads/sites/5/reports/13.pdf) (sensibilidad a precio, adopción de apps ~40% para remesas).

---

**Nota metodológica final:** los modelos que sostienen este documento (`model.py`, `model2.py`) usan supuestos de penetración, churn y adopción que son **hipótesis de trabajo, no pronósticos**. El valor de este ejercicio no es predecir el número exacto — es (a) identificar qué palancas importan (activación supply-side, guardrail de video, cashflow anual, financiar el valle) y (b) dar un marco para recalibrar con datos reales tras 90 días del piloto. Un modelo económico honesto en early-stage vale por las preguntas que ordena, no por la falsa precisión de sus decimales.

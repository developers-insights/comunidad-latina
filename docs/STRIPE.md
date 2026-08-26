# Stripe — poner los pagos a andar

Guía para dejar Comunidad Latina cobrando en **modo de prueba**, de punta a punta,
sin tocar código. Está escrita para seguirla paso por paso.

Hoy el sistema está **construido y probado, pero apagado**: faltan las claves. Sin
ellas, cada pantalla que cobra muestra "Muy pronto" en vez de romperse. Cuando
cargues las dos variables de abajo, las siete pantallas se encienden solas.

> **Nada de lo que sigue cobra plata de verdad** mientras uses claves que empiezan
> con `sk_test_`. Las tarjetas de prueba son de mentira y el dinero no existe.

---

## 1. Las dos claves que hacen falta

Son **dos variables, no tres**.

| Variable | Ejemplo | De dónde sale |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_51Ab…` | Dashboard → **Developers → API keys** → *Secret key* |
| `STRIPE_WEBHOOK_SECRET` | `whsec_1a2b…` | Dashboard → **Developers → Webhooks** → tu endpoint → *Signing secret* |

**Antes de copiar nada: prendé el modo de prueba.** Arriba a la derecha del
dashboard hay un interruptor que dice **Test mode**. Encendido = todo lo que veas
(claves, pagos, clientes) es de prueba. Apagado = es real. Las claves de test
empiezan con `sk_test_`; las reales, con `sk_live_`.

### Por qué no hay clave pública

Puede que hayas visto en tutoriales una tercera clave, la *publishable key*
(`pk_test_…`). **Acá no se usa, y no es un olvido.** Los siete cobros llevan a la
persona a la página de pago de Stripe (checkout.stripe.com) y la traen de vuelta;
nunca se dibuja un formulario de tarjeta dentro de Comunidad Latina. Eso es
deliberado: los datos de la tarjeta no pasan nunca por nuestro servidor, y por eso
el proyecto queda fuera del alcance más pesado de PCI.

### Stripe Identity

La verificación de documento (`/perfil/verificar`) **no lleva clave aparte**: se
activa el producto en el dashboard (**Identity → Get started**) y usa la misma
`STRIPE_SECRET_KEY`. Del documento no se guarda nada nuestro: sólo queda un sí/no
en el perfil.

---

## 2. Cargar las claves

### En tu computadora

Abrí `.env.local` en la raíz del proyecto y completá las dos líneas:

```
STRIPE_SECRET_KEY=sk_test_51Ab...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Sin comillas, sin espacios antes ni después. Después reiniciá `npm run dev`: las
variables se leen al arrancar, no en caliente.

> `.env.local` **no se sube a git** y no debe subirse nunca. Si alguna vez pegás
> una clave dentro de un archivo del proyecto por error, hay que rotarla en el
> dashboard: una clave que estuvo en un repo se considera quemada.

### En Vercel (el sitio publicado)

Proyecto **comunidad-latina**, equipo **insights3**.

1. Entrá a **Settings → Environment Variables**.
2. Agregá `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
3. Marcá los entornos: **Production** y, si querés probar en previews, también
   **Preview**.
4. **Volvé a desplegar.** Vercel no aplica variables nuevas a un deploy que ya
   existe — hasta que no haya un deploy nuevo, el sitio sigue sin claves.

El `STRIPE_WEBHOOK_SECRET` de producción **no es** el de tu computadora. Son
endpoints distintos y cada uno tiene su propio secreto. Pegar el equivocado hace
que *todos* los eventos reboten con "Firma inválida" y ningún pago se aplique — sin
error visible para quien pagó.

Para ver qué le falta a Vercel respecto de tu `.env.local` (sin imprimir valores):

```bash
node scripts/vercel-env-sync.mjs
```

---

## 3. El webhook

Toda la plata se acredita por acá. Si el webhook no llega, la persona paga y **no
recibe nada**: el cobro queda hecho en Stripe y el beneficio nunca se enciende.

**URL en producción:**

```
https://comunidad-latina-sigma.vercel.app/api/webhooks/stripe
```

(Si el dominio propio ya apunta al proyecto, es `https://TU_DOMINIO/api/webhooks/stripe`.)

### Los eventos a suscribir — la lista exacta

En **Developers → Webhooks → + Add endpoint**, pegá la URL y seleccioná
**exactamente estos nueve**. Un evento que falte no da error: simplemente esa
función deja de andar, en silencio.

| Evento | Si falta, se rompe |
|---|---|
| `checkout.session.completed` | **Todo.** Ningún pago se acredita nunca. |
| `checkout.session.async_payment_succeeded` | Los pagos diferidos (transferencia, débito bancario): se cobran y no se entregan. |
| `customer.subscription.updated` | Las suscripciones no cambian de estado: una tarjeta rechazada no baja el plan. |
| `customer.subscription.deleted` | **Cancelar no apaga nada.** El beneficio sigue encendido sin pagar. |
| `invoice.paid` | El impulso de regalo mensual del check azul nunca llega, y no se registra el ciclo cobrado. |
| `charge.refunded` | Devolvés la plata y el impulso o la campaña siguen activos. |
| `charge.dispute.created` | Un contracargo no deja ninguna alerta. |
| `identity.verification_session.verified` | La verificación de documento nunca marca el perfil. |
| `identity.verification_session.requires_input` | Quien sacó mal la foto no se entera y no reintenta. |

Guardá el endpoint y copiá el **Signing secret** (`whsec_…`) que aparece recién
después de crearlo.

> Los eventos de Identity sólo aparecen en la lista si activaste Stripe Identity.

---

## 4. Probar en tu computadora

El webhook necesita que Stripe pueda alcanzar tu máquina. Para eso está el CLI.

**Instalar y entrar** (una sola vez):

```bash
stripe login
```

**Dejar corriendo el reenvío** (en una terminal aparte, mientras probás):

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

El comando imprime algo así:

```
> Ready! Your webhook signing secret is whsec_a1b2c3d4...
```

**Ese** `whsec_` es el que va en tu `.env.local` mientras probás en local. Cambia
cada vez que reiniciás `stripe listen`, salvo que uses `--api-key`. Si los eventos
rebotan con "Firma inválida", casi siempre es esto.

### Tarjetas de prueba

En la pantalla de pago de Stripe, cualquier fecha de vencimiento futura y
cualquier CVC de 3 dígitos sirven. Lo que cambia el resultado es el número:

| Número | Qué pasa |
|---|---|
| `4242 4242 4242 4242` | **Aprobada.** El camino feliz: el beneficio se enciende. |
| `4000 0025 0000 3155` | **Pide 3D Secure.** Aparece una ventana de autenticación; al confirmarla, se aprueba. |
| `4000 0000 0000 3220` | 3D Secure **obligatorio**, y falla si no lo completás. |
| `4000 0000 0000 9995` | **Rechazada por fondos insuficientes.** |
| `4000 0000 0000 0002` | **Rechazada por el banco** (declive genérico). |
| `4000 0000 0000 0341` | Se acepta al principio y **falla el cobro después** — sirve para probar renovaciones que fallan. |

Para **Identity**, en modo de prueba no hace falta un documento real: la pantalla
de Stripe ofrece un botón para simular una verificación exitosa o fallida.

### Disparar un evento a mano

Si querés probar el webhook sin pasar por la pantalla de pago:

```bash
stripe trigger checkout.session.completed
```

Ojo: el evento simulado viene **sin nuestra metadata**, así que el webhook lo va a
rechazar con un aviso en la consola. Eso es lo correcto — sirve para comprobar que
el endpoint responde y valida la firma, no para acreditar un beneficio.

---

## 5. Qué se cobra y qué mirar después de cada prueba

Precios de arranque. Cada comunidad puede cambiarlos desde el panel de
administración (tabla `tenant_prices`); estos son los valores por defecto.

| Pantalla | Qué se compra | Precio (USD) | Modo | Se acredita en |
|---|---|---|---|---|
| `/impulsar/{aviso}` | Impulso del aviso, 7 / 14 / 30 días | 10 / 25 / 45 (+ 0/15/40 según alcance) | Pago único | `boosts` |
| `/impulsar-post/{post}` | Campaña de una publicación, 7 / 14 / 30 días | 10 / 25 / 45 | Pago único | `post_promotions` |
| `/negocios/presencia/aviso/{aviso}` | Aviso premium | 9 / mes | Suscripción | `listing_premiums` |
| `/marketplace/membresia` | Tienda en el Marketplace | 10 / mes | Suscripción | `store_memberships` |
| `/negocios/presencia` | Presencia Verificada: Básico / Prioridad / Pro | 19 / 29 / 49 por mes · 190 / 290 / 490 por año | Suscripción | `business_accounts` |
| `/verificacion` | Check azul: Personal / Negocio / Profesional | 6,99 / 9,99 / 19,99 por mes | Suscripción | `verification_subscriptions` |
| `/perfil/verificar` | Verificación de documento | Lo cobra Stripe (~1,50 por verificación) | Por uso | `profiles.identity_verified` |

### Checklist de "está funcionando"

Después de **cada** pago de prueba, chequeá las tres cosas. Que la pantalla diga
"listo" no alcanza: eso lo dice antes de que llegue el webhook.

**1. En Stripe** (Developers → Webhooks → tu endpoint → *Events*)
   - El evento figura con respuesta **200**. Si dice 400 → firma mal (secreto
     equivocado). Si dice 500 → falló nuestro lado, Stripe va a reintentar solo
     durante 3 días.

**2. En la base** (Supabase → Table editor)
   - `payment_events`: hay una fila con el `event_id`, y la columna `processed`
     está en **true**. Si está en `false` y `error` tiene texto, ahí está el motivo.
   - La tabla del producto (columna "Se acredita en" de arriba) tiene la fila con
     el estado esperado: `active` para impulsos y campañas, `status='active'` para
     las suscripciones.

**3. En la app**
   - La persona recibió la notificación ("¡Tu impulso ya está activo!", "Tu check
     azul ya está activo", etc.) y el beneficio se ve.

**La prueba que más importa, y que no es obvia:** en Stripe, en la lista de eventos
del endpoint, tocá un evento ya entregado y usá **Resend**. Todo tiene que quedar
exactamente igual que antes: el mismo beneficio, **una sola** notificación y **una
sola** línea de auditoría. Si llega un segundo aviso, algo se rompió.

Un pago que se acredita dos veces es el error más caro de este sistema, así que
conviene saber que hay **dos** defensas distintas y que el Resend sólo ejercita la
primera:

1. **El mismo evento repetido** (lo que hace *Resend*): se reconoce por su `id` en
   `payment_events` y ni siquiera se reprocesa. La respuesta trae
   `"duplicated": true`.
2. **Dos eventos distintos por el mismo pago** — el caso real, y el que no se puede
   probar con un botón: un pago diferido emite `checkout.session.completed` y
   después `checkout.session.async_payment_succeeded`, que son dos `id` distintos y
   pasan los dos por el punto 1. Para eso, cada concesión lleva escrito el
   identificador del pago que la originó y no vuelve a conceder por el mismo. Esto
   está cubierto por los tests automáticos; en el dashboard se puede ver de reojo
   pagando con un método diferido y comprobando que llegue **un** solo aviso.

### Probar la baja

Cancelá una suscripción de prueba desde el dashboard (Customers → la suscripción →
Cancel). Tiene que llegar `customer.subscription.deleted` y el beneficio tiene que
apagarse. **Este es el camino que más caro sale si falla**, porque nadie se queja
cuando le siguen dando algo gratis.

---

## 6. Pasar a cobrar de verdad

Cuando las pruebas estén hechas:

1. Apagá **Test mode** en el dashboard.
2. Copiá la clave `sk_live_…` (es otra clave, no la misma).
3. Creá **otro endpoint de webhook** apuntando a la misma URL, con los mismos
   nueve eventos, y copiá **su** `whsec_…` (también es otro).
4. Reemplazá las dos variables en Vercel y volvé a desplegar.
5. Comprobá con **una compra real y chica**, y devolvela desde el dashboard.

Los datos de prueba y los reales viven separados en Stripe: los clientes,
suscripciones y pagos de test **no se migran**. Todo empieza de cero.

Mientras el sitio publicado corra con claves de prueba, el servidor deja este aviso
en los logs de Vercel la primera vez que se usa Stripe:

```
[pagos] Stripe en modo TEST sobre un deploy publicado (VERCEL_ENV=production).
Los pagos NO cobran plata de verdad y las tarjetas de prueba se aceptan.
```

Está a propósito y no bloquea nada: probar en producción con claves de test es un
paso legítimo. Lo que no puede pasar es que nadie sepa en qué modo está.

---

## 7. Cuando algo no anda

| Síntoma | Causa casi siempre |
|---|---|
| Todos los eventos dan **400 "Firma inválida"** | El `STRIPE_WEBHOOK_SECRET` es de otro endpoint (o el de local en producción). |
| El endpoint devuelve **503** | Falta `STRIPE_SECRET_KEY`, o Vercel no volvió a desplegar después de cargarla. |
| El pago se hizo y **el beneficio no aparece** | Mirá `payment_events`: si `processed=false` y hay `error`, ahí está. Si no hay fila, el evento nunca llegó (¿está suscripto?). |
| Los logs dicen **"NO se concede"** | Es una protección, no una falla: el monto, la moneda o el dueño no coinciden con lo pactado al abrir el pago. El cobro quedó hecho en Stripe y hay que devolverlo o acreditarlo a mano. |
| Las pantallas siguen diciendo **"Muy pronto"** | El proceso no ve la clave: reiniciá `npm run dev`, o volvé a desplegar en Vercel. |
| Un pago con transferencia **no acredita** | Falta suscribir `checkout.session.async_payment_succeeded`. |

Todo evento recibido queda guardado íntegro en `payment_events`, aunque se rechace.
Nunca se pierde el rastro de un cobro.

---

## 8. Qué NO está cubierto todavía

Honestidad sobre los límites de lo entregado:

- **Nunca se ejecutó un pago real ni de prueba.** El proyecto no tuvo jamás una
  clave de Stripe. Todo lo verificado son tests automáticos contra nuestro lado del
  contrato (firma real con el mismo HMAC de Stripe, correlación de montos,
  idempotencia). El primer pago de prueba que hagas es el primero de la historia
  del proyecto.
- **Un checkout abandonado deja una fila `pending_payment`** en `boosts` /
  `post_promotions` que nadie limpia automáticamente. No cobra ni entrega nada, pero
  ensucia. No están suscritos `checkout.session.expired` ni
  `checkout.session.async_payment_failed` porque hoy no hay handler que los use.
- **Un reembolso parcial, y cualquier reembolso de suscripción, no revocan nada.**
  Sólo se revoca el reembolso *total* de un pago único (impulso o campaña). El resto
  deja una alerta en los logs para resolver a mano — a propósito: apagar un
  beneficio por un reembolso ambiguo es peor que revisarlo una persona.
- **Una renovación no verifica el monto**, sólo avisa si se corrió del pactado. Es
  deliberado: rechazar una renovación sería apagarle el servicio a alguien que pagó.
- **Los precios no son productos de Stripe.** Cada pago se crea con el monto leído
  de `tenant_prices` en el momento. Funciona y permite precio por comunidad, pero el
  dashboard de Stripe no muestra un catálogo de productos.
- **No hay facturas ni comprobantes fiscales.** Stripe manda su propio recibo por
  correo si lo activás en el dashboard (Settings → Customer emails).
- **No hay impuestos** (Stripe Tax no está configurado).
- **Doble compra:** si alguien abre el pago dos veces y completa los dos, paga dos
  veces. Las suscripciones no bloquean eso hoy.
- **El aviso de modo test no se ve en la app**, sólo en los logs de Vercel.

---

## Apéndice: para quien lea el código

- Endpoint único: `src/app/api/webhooks/stripe/route.ts`. Verifica la firma sobre
  el cuerpo **crudo** (`request.text()`) antes de tocar nada, guarda el evento en
  `payment_events` (con `event_id` UNIQUE) y recién ahí despacha.
- Cada producto se reconoce por su `metadata.kind`: `listing_premium`,
  `store_membership`, `verificacion`. Los pagos únicos se reconocen por
  `metadata.boost_id` / `metadata.post_promotion_id`.
- El monto y la moneda se verifican contra **lo pactado al abrir el pago**
  (`metadata.price_cents` en las suscripciones, la fila de la base en los pagos
  únicos), nunca releyendo `tenant_prices` — si alguien edita el precio de la
  comunidad entre el pago y el evento, releer rechazaría un cobro legítimo. La regla
  vive en `src/lib/monetization/pactado.ts`.
- Una concesión por pago: `src/lib/monetization/concesion.ts` pone el token del pago
  en el `WHERE` del UPDATE, así dos entregas del mismo evento no acreditan dos veces
  ni mandan dos comprobantes.
- El modo (test o live) se lee del prefijo de la clave: `getStripeMode()` en
  `src/lib/stripe/index.ts`.

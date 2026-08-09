# Servicios de terceros: rol, plan mínimo y costo estimado

Lista completa de los servicios externos que la plataforma necesita, tomada de `.env.example` y `src/lib/config/services.ts`. Los precios son **órdenes de magnitud, no cotizaciones** — cada proveedor cambia sus planes con frecuencia; confirmá el precio vigente al momento de contratar.

Cada servicio tiene un **flag de configuración** en el código (`isStripeConfigured`, `isResendConfigured`, etc.) — si falta la credencial, la funcionalidad que depende de ese servicio se apaga sola mostrando un aviso premium ("Estamos terminando de configurar esto"), **nunca rompe la app**. Esa es la razón por la que se puede lanzar sin tener contratado el 100% de la lista desde el día uno.

---

## Imprescindibles para operar (sin esto, la plataforma no funciona en absoluto)

| Servicio | Rol | Plan mínimo viable | Orden de magnitud mensual |
|---|---|---|---|
| **Supabase** | Base de datos, autenticación, storage de fotos, tiempo real (mensajería). Es la única dependencia sin degradación posible — sin esto no hay app. | Plan Pro (el free tier pausa el proyecto por inactividad, algo inaceptable para producción) | US$25–100+ según uso de DB/storage/egress — confirmar en supabase.com/pricing |
| **Vercel** | Hosting de la app Next.js, dominios personalizados con SSL automático, edge network. | Plan Pro (necesario para dominios custom en cantidad y límites de build razonables) | US$20/asiento + consumo — confirmar en vercel.com/pricing |

---

## Necesarios antes del primer usuario real (Bloque B de `.env.example`)

| Servicio | Rol | Plan mínimo viable | Orden de magnitud mensual |
|---|---|---|---|
| **Stripe** | Cobra las suscripciones de Presencia Verificada, Boosts, Membresías de Tienda, campañas de post — y Stripe Identity para verificar identidad de quien publica. | Sin costo fijo — cobra por transacción (~2.9% + US$0.30 por cargo en EEUU) | Variable, proporcional a lo facturado. Sin volumen, US$0 |
| **Resend** | Emails transaccionales: confirmación de cuenta, recuperación de contraseña, avisos de contacto. | Plan gratuito alcanza para volumen bajo (3.000 emails/mes); plan pago cuando se supere | US$0–20 para arrancar |
| **OpenAI** | Moderación de texto (`omni-moderation-latest`) sobre posts, comentarios, avisos y preguntas al Asistente antes de procesarlas. | Pago por uso, sin plan fijo — la moderación es un modelo barato | Bajo — algunos dólares/mes en volumen inicial, escala con contenido publicado |
| **Google Vision** | Moderación de imágenes (SafeSearch) — obligatoria porque los avisos suben fotos. Sin esto, toda foto queda en revisión manual (degrada, no rompe). | Pago por uso; primeras 1.000 unidades/mes gratis en muchas categorías de Vision | Bajo en volumen inicial — confirmar cuota gratuita vigente en cloud.google.com/vision/pricing |
| **Anthropic (Claude)** | Motor del Asistente Comunitario — responde preguntas citando fuentes verificadas de la comunidad. Es la única credencial que el asistente necesita (el retrieval usa full-text search nativo de Postgres, no embeddings). | Pago por uso (tokens) | Depende del volumen de preguntas; el rate limiting del endpoint (10/hora logueado, techos para anónimos) acota el gasto máximo por diseño — ver `docs/entrega/apis.md` |
| **Sentry** | Observabilidad de errores en producción — el propio contrato técnico del proyecto la marca como obligatoria antes del primer dato real. | Plan gratuito (Developer) alcanza para empezar; plan Team cuando el volumen de eventos crezca | US$0–26+ |

---

## Pueden esperar a fases posteriores (Bloque C de `.env.example`) — hoy vacíos, intencionalmente

Ninguno de estos bloquea el lanzamiento. Están documentados en `.env.example` como fase posterior explícita.

| Servicio | Rol previsto | Cuándo entra |
|---|---|---|
| **Cloudflare R2** | Storage de media con egress US$0 — reemplazo de Supabase Storage cuando el feed crezca y el costo de egress importe | Optimización, no bloqueante |
| **Cloudflare Stream** | Video premium | Fase 2 |
| **Google Gemini (2.5 Flash)** | "Segunda opinión" de moderación en zona gris + generación de assets por tenant (nano banana) | Fase 2/3 |
| **Twilio** | SMS — para F0 el email alcanza | Fase 1 (notificaciones) |
| **Upstash Redis** | Deduplicación de notificaciones y rate-limiting a escala (hoy el rate-limit es in-memory por instancia) | Fase 1+, cuando haya más de una instancia sirviendo tráfico |
| **Web Push (VAPID)** | Notificaciones push de la PWA | Fase 1 |

---

## Resumen para presupuestar el lanzamiento

**Imprescindibles desde el día 1:** Supabase + Vercel — la única capa sin la cual no hay producto.

**Imprescindibles antes de mostrarle esto a un usuario real:** Stripe, Resend, OpenAI, Google Vision, Sentry. Sin alguno de estos, la comunidad "nace muda" en esa función puntual (sin poder cobrar, sin poder mandar emails, con todas las fotos en revisión manual, o sin visibilidad de errores en producción) — la app sigue funcionando, pero degradada.

**Opcional para el lanzamiento, necesario para el producto completo:** Anthropic (sin esto, el Asistente Comunitario muestra "muy pronto" en vez de responder).

**Puede esperar:** todo el Bloque C — ninguno tiene impacto en el día 1.

> Ninguna cifra de este documento es una cotización vigente. Confirmá el plan y precio exacto de cada proveedor al momento de contratar — todos cambian sus tarifas con relativa frecuencia.

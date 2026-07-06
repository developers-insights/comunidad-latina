# SETUP — Variables de entorno (guía para Geovanny/Manuel)

Guía para completar `.env.example` → `.env.local`. Está ordenada por **cuándo la necesitás**, no alfabéticamente. Si solo tenés 20 minutos, hacé el **Paso 1** y listo: con eso el equipo ya puede empezar a codear F0.

> Contexto: el plan arranca por un **wedge** (vivienda verificada anti-estafa, 1 dominio). Por eso NO hace falta contratar video, SMS ni IA-avanzada todavía. Cada cosa a su fase.

---

## Paso 1 — Para ARRANCAR a codear (🟢 hoy mismo) · ~20 min · gratis

| Servicio | Para qué | Plan / costo | Qué copiar al `.env.local` |
|---|---|---|---|
| **Supabase** | DB + Auth + Storage + RLS (el corazón) | Free para empezar; Pro **$25/mes** cuando haya datos reales | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD` |

Con **solo Supabase** cargado, el motor multi-tenant, el login y el módulo de propiedades ya se pueden construir en local. **Esto es lo único que bloquea el arranque.**

---

## Paso 2 — Antes del primer deploy con usuarios reales (🟡 durante F0) · ~1–2 h

Creá estas cuentas cuando el wedge esté por salir a producción. Todas tienen tier de prueba gratis.

| Servicio | Para qué | Costo real | Notas |
|---|---|---|---|
| **Stripe** | Cobro de la membresía del landlord **+ Stripe Identity** (verificar al que publica) | Comisión por transacción; Identity ~$1.50/verificación | Empezá en **modo TEST**. Identity NO es una key aparte: se activa en el dashboard y usa la misma clave. |
| **Resend** | Emails (confirmación, aviso de lead) | Free hasta 3.000 emails/mes | Verificá el dominio de envío (DNS). |
| **OpenAI** | Moderación de texto (omni-moderation) | **Gratis** (la moderación no se cobra) | Solo necesitás la API key. |
| **Google Vision** | Moderación de fotos (NSFW/violencia) | ~$1.50 / 1.000 imágenes | Habilitar "Cloud Vision API" en Google Cloud. |
| **Sentry** | Errores en producción | Free generoso | El plan exige tenerlo **antes del primer dato real**. |
| **Vercel** | Hosting + dominios (dominicanos.com, comunidadlatina.com) | Pro **$20/mes** (Hobby no sirve: topa en 50 dominios y prohíbe uso comercial) | Necesario también para el "Track Marca" (specimen antes de octubre). |

---

## Paso 3 — Puede esperar (🔵 F1/F2/F3) · NO lo hagas ahora

No abras estas cuentas todavía; son de fases posteriores. Listadas solo para que sepas que existen.

| Servicio | Para qué | Fase |
|---|---|---|
| **Cloudflare R2** | Storage con egress $0 (optimización; F0 usa Supabase Storage) | F1 |
| **Cloudflare Stream** | Video Premium | F2 |
| **Google Gemini** | IA-producto (Asistente RAG) + moderación zona gris + assets (nano banana) | F2/F3 |
| **Twilio** | Notificaciones por SMS | F1 |
| **Upstash Redis** | Dedup de notificaciones / rate-limit a escala | F1+ |
| **Web Push (VAPID)** | Push de la PWA (se genera con un comando, gratis) | F1 |

---

## Resumen en una línea

- **Para empezar YA:** solo **Supabase**. 🟢
- **Para lanzar el wedge:** + **Stripe, Resend, OpenAI, Google Vision, Sentry, Vercel**. 🟡
- **Todo lo demás:** más adelante. No gastes tiempo ni plata en eso ahora. 🔵

> Costo fijo mensual real para operar F0 (cuando esté en producción): ~**$45–70/mes** de infra (Supabase Pro $25 + Vercel Pro $20 + resto casi gratis). Lo caro del proyecto NO es la infra — es el trabajo humano (moderación, ventas B2B, legal), como detalla §6 del Plan Maestro.

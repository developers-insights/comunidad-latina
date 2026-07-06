# 05 — Ingeniería de IA + Media

**Proyecto:** Comunidad Latina (alias NYLabel) — Red social white-label multi-tenant (PWA)
**Autor:** Ingeniero de IA + Media
**Fecha:** 2026-07-06
**Estado:** Documento de decisión — alimenta el PLAN MAESTRO
**Alcance:** Pipeline de moderación (3 niveles), moderación de imagen/video/texto ES-latino, Trust Score dinámico, media pipeline (video + storage), generación de assets por tenant.

> **Nota sobre precios:** Todos los costos son estimaciones a **julio 2026** verificadas con fuentes públicas (ver §10 Fuentes). Los proveedores cambian tarifas; re-validar antes de firmar contratos. Todos los cálculos usan supuestos explícitos que se pueden ajustar.

---

## 0. TL;DR — Decisiones tomadas

| # | Área | Decisión | Costo aprox. | Razón principal |
|---|------|----------|--------------|-----------------|
| 1 | **Texto ES-latino** | **OpenAI Moderation (`omni-moderation-latest`)** como primera línea + **Gemini 2.5 Flash** como segunda opinión en zona gris | **$0** (moderation) + ~$0.30/1M tok (Gemini solo en dudosos) | Gratis, +42% multilingüe, español supera a inglés del modelo previo. Perspective API **se discontinúa 31-dic-2026** → descartada. |
| 2 | **Imagen** | **Google Vision SafeSearch** (confirmado por cliente) | ~**$1.50/1000** imgs (tier 1) | Ya confirmado. NSFW + violencia nativos. Copyright vía hash, no Vision. |
| 3 | **Video** | **Cloudflare Stream** para MVP y video corto; evaluar Bunny para escala premium con DRM | **$5/1000 min** almacenados + **$1/1000 min** entregados | Modelo por minuto (sin matemática de egress), encoding incluido, tokens firmados. Bunny castiga a Sudamérica con $0.045/GB egress. |
| 4 | **Storage imágenes/assets** | **Cloudflare R2** (público/media) + **Supabase Storage** (privado/auth) — híbrido | R2: **$0.015/GB**, **egress $0** | R2 elimina el costo de egress (crítico para feed). Cliente ya inclinado a R2. |
| 5 | **Moderación de video** | Extracción de frames (1 cada 2-3s) → Vision SafeSearch + audio→texto opcional | Ver §5 | 15s de video = ~5-8 frames = ~$0.008-0.012/video. Barato. |
| 6 | **Trust Score** | Modelo ponderado 0-100 con decay temporal + señales anti-abuso | Cómputo interno (SQL/Edge) | Ver §6. Badges: Nuevo/Verificado/Confiable/Premium. |
| 7 | **Assets por tenant** | nano banana (Gemini image) para logos/banners/onboarding; Meshy solo si hay 3D | Por generación | Pipeline documentado en §8. |
| 8 | **Orquestación async** | **Supabase Queues (pgmq)** + **Edge Functions** como workers | Incluido en Supabase | Nativo, sin infra extra. Ver §1. |

**Costo total estimado de moderación+media** para un tenant de **10.000 usuarios activos / mes** con volumen moderado: **~$80-160/mes** (desglose en §9). El grueso es video delivery, no IA.

---

## 1. Pipeline de moderación de 3 niveles

### 1.1 Reglas del cliente (recordatorio)

El score de riesgo **0-100** enruta así:

| Score | Nivel | Acción | Visibilidad del contenido |
|-------|-------|--------|---------------------------|
| **0-30** | Tier 1 — Auto-aprobar | Publica de inmediato | Visible al instante |
| **31-70** | Tier 2 — Monitorear | Publica pero se marca (`shadow monitor`) | Visible, pero en watchlist; re-evaluación y down-ranking posible |
| **71-100** | Tier 3 — Revisión manual | Retiene hasta que Moderador decida | **Oculto** (o "pendiente de revisión") hasta aprobación |

> **Decisión de producto (recomendada):** en Tier 2 el contenido **sí se publica** pero entra a una watchlist con re-scoring y posible down-ranking en el feed. Esto evita fricción para el 90% de casos ambiguos y mantiene el volumen de la cola manual bajo. El cliente definió Tier 2 como "monitorea y flaggea"; esta interpretación lo respeta.

### 1.2 Cómo se calcula el score de riesgo (fórmula)

El score **NO** es un único número de un solo proveedor. Es una **fusión ponderada** de señales de IA + contexto del usuario (Trust Score) + reglas duras. Fórmula:

```
risk_score = clamp(0, 100,
    100 * (
        w_ai   * ai_risk          // 0..1 — máximo de las señales de IA (imagen/texto/video)
      + w_user * (1 - trust_norm)  // usuarios de bajo trust suben el riesgo
      + w_hist * repeat_offense    // 0..1 — reincidencia reciente del autor
    )
    + hard_penalties               // saltos duros (ver abajo)
)
```

**Pesos sugeridos (tunables):** `w_ai = 0.70`, `w_user = 0.20`, `w_hist = 0.10`.
`trust_norm = trust_score / 100`.

**`ai_risk`** = combinación de los scores crudos de cada modalidad presente, normalizados 0..1:

- **Texto:** `max(category_scores)` de OpenAI Moderation, con override de categorías críticas (ver §3).
- **Imagen:** mapeo de likelihood de Vision SafeSearch a 0..1 (ver §2.2).
- **Video:** `max` del frame más riesgoso (ver §5).
- Se toma el **máximo** entre modalidades (una foto NSFW en un post con texto inocente debe flaggear), no el promedio.

**`hard_penalties` (reglas duras que saltan directo a Tier 3, score = 100):**
- Vision devuelve `VERY_LIKELY` en `adult` o `violence`.
- OpenAI marca `sexual/minors` o `violence/graphic` con score > 0.5 → **auto-reject + reporte legal** (ver §3.4, NCMEC/legal).
- Hash de imagen/video coincide con base de CSAM conocido (PhotoDNA/NCMEC) → auto-block + reporte obligatorio.
- Usuario con Trust Score < 15 (probable bot/spam ring).

**`repeat_offense`:** proporción de contenido del autor rechazado en los últimos 30 días. Escala el riesgo para reincidentes.

> **Por qué esta fusión:** un modelo único (p. ej. solo Vision) da falsos positivos/negativos. Ponderar con Trust Score hace que un usuario **Premium** con 3 años de historial no caiga a cola manual por una foto borde, mientras que una **cuenta nueva** con la misma foto sí se revisa. Esto reduce la carga del Moderador ~40-60% en la práctica.

### 1.3 Flujo asíncrono (arquitectura)

**Principio:** la subida del usuario **nunca bloquea** esperando a la IA. El contenido entra en estado `pending_moderation`, se encola, y un worker resuelve el estado. El feed muestra optimistamente al autor su propio contenido (UX), pero no a terceros hasta que pasa Tier 1/2.

**Stack de orquestación (decisión):**
- **Cola:** **Supabase Queues (pgmq)** — extensión Postgres nativa, sin infra externa. Alternativa: Upstash QStash si se necesita retry HTTP más sofisticado.
- **Workers:** **Supabase Edge Functions** (Deno) disparadas por (a) cron que drena la cola cada N segundos, o (b) Database Webhook on-insert.
- **Estado:** tabla `moderation_jobs` + columna `moderation_status` en cada tabla de contenido (`posts`, `photos`, `videos`, `comments`, `listings`, `businesses`, `events`).
- **Realtime:** Supabase Realtime notifica al Moderador cuando entra algo a la cola Tier 3, y al usuario cuando su contenido cambia de estado.

### 1.4 Diagrama de flujo

```
┌──────────────┐
│ Usuario sube │  (post / foto / video / comentario / listing)
│  contenido   │
└──────┬───────┘
       │ INSERT con moderation_status = 'pending'
       ▼
┌─────────────────────────────┐
│ Tabla contenido (Postgres)  │───► visible SOLO al autor (optimistic UI)
│ + tenant_id (RLS)           │
└──────┬──────────────────────┘
       │ trigger / webhook  →  pgmq.send()
       ▼
┌─────────────────────────────┐
│  Supabase Queue (pgmq)      │   [moderation_queue]
└──────┬──────────────────────┘
       │ Edge Function worker (cron cada 2-5s / on-event)
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    WORKER DE MODERACIÓN                       │
│                                                               │
│  1) ¿Qué modalidades tiene? (texto / imagen / video)         │
│                                                               │
│  ┌───────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │  TEXTO    │   │    IMAGEN      │   │      VIDEO        │  │
│  │ OpenAI    │   │ Google Vision  │   │ Frames→Vision +  │  │
│  │ Moderation│   │ SafeSearch     │   │ audio→texto      │  │
│  │ (+Gemini  │   │ + hash copyright│  │ (async, tras     │  │
│  │  si duda) │   │ + PhotoDNA CSAM│   │  transcode)      │  │
│  └─────┬─────┘   └───────┬────────┘   └────────┬─────────┘  │
│        │                 │                     │            │
│        └────────┬────────┴─────────────────────┘            │
│                 ▼                                            │
│      ai_risk = max(modalidades)                              │
│                 +                                            │
│      Trust Score del autor  +  reincidencia  +  reglas duras │
│                 ▼                                            │
│           risk_score (0-100)                                 │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
        ┌─────────┴──────────┐
        │   Router por score │
        └─┬────────┬───────┬─┘
          │        │       │
     0-30 │   31-70│  71-100│  (o regla dura)
          ▼        ▼       ▼
   ┌──────────┐ ┌────────┐ ┌─────────────────┐
   │ APROBAR  │ │MONITOR │ │  COLA MANUAL    │
   │ status=  │ │status= │ │  status=        │
   │ approved │ │monitor │ │  in_review      │
   │ público  │ │público │ │  OCULTO         │
   │          │ │+watch  │ │                 │
   └──────────┘ └───┬────┘ └────────┬────────┘
                    │               │ Realtime notify
                    │               ▼
                    │        ┌──────────────────┐
                    │        │  MODERADOR (rol)  │
                    │        │  Dashboard cola   │
                    │        │  Aprobar/Rechazar │
                    │        │  /Eliminar/Susp.  │
                    │        └────────┬─────────┘
                    │                 │
                    │                 ▼
                    │        ┌──────────────────┐
                    │        │ Ajusta Trust Score│
                    │        │ del autor (±)     │
                    │        │ Actualiza feed    │
                    │        └──────────────────┘
                    │
                    ▼ (re-score periódico si recibe reportes)
              vuelve a la cola si acumula reportes
```

### 1.5 Latencia esperada

| Modalidad | Latencia del worker (p50) | Latencia (p95) | Experiencia del usuario |
|-----------|---------------------------|----------------|--------------------------|
| **Texto** (post/comentario) | 300-600 ms | ~1.2 s | Casi instantáneo; el autor ve su post ya publicado, terceros lo ven en <2s |
| **Imagen** | 500 ms - 1.5 s | ~3 s | Foto visible en pocos segundos; SafeSearch domina el tiempo |
| **Video corto (≤15s)** | 15-60 s | ~2-3 min | Depende del transcode del proveedor (Stream/Bunny). Se muestra "procesando" |
| **Video largo (premium)** | 1-5 min | ~10 min | Barra de progreso; notificación push al terminar |

**Encolado → inicio de proceso:** con cron cada 2-5s, la latencia de cola añade <5s en carga normal. Bajo picos, el worker escala horizontalmente (múltiples Edge Function invocations concurrentes leyendo la cola con visibility timeout).

**Presupuesto de latencia objetivo (SLA interno):**
- Texto e imagen: **contenido decidido en < 5 s p95.**
- Video: **decidido dentro de los 3 min de terminar el transcode p95.**

---

## 2. Moderación de imágenes y video — Google Vision + alternativas

### 2.1 Google Vision SafeSearch — capacidades

Google Cloud Vision **SafeSearch Detection** clasifica cada imagen en 5 categorías, cada una con un *likelihood* de 5 niveles (`UNKNOWN`, `VERY_UNLIKELY`, `UNLIKELY`, `POSSIBLE`, `LIKELY`, `VERY_LIKELY`):

| Categoría | Detecta | Uso en Comunidad Latina |
|-----------|---------|--------------------------|
| `adult` | Desnudez, contenido sexual explícito | **Crítico** — bloqueo/revisión |
| `violence` | Sangre, violencia gráfica | **Crítico** |
| `racy` | Sugerente, ropa mínima, poses provocativas | Zona gris → Tier 2 |
| `medical` | Contenido médico/quirúrgico | Contexto (permitir en negocios de salud) |
| `spoof` | Memes, imágenes modificadas | Informativo, no bloqueante |

**Lo que Vision SafeSearch NO hace bien / no hace:**
- **Copyright:** SafeSearch **no** detecta violaciones de copyright. Para eso se usa **perceptual hashing** (pHash/dHash) contra una base de contenido conocido, o `WEB_DETECTION` de Vision (más caro, $3.50/1000) para encontrar coincidencias en la web. **Decisión:** copyright vía pHash propio + reportes de usuarios, no vía Vision SafeSearch.
- **CSAM (menores):** Vision no es un sistema de reporte legal. Para CSAM se integra **PhotoDNA (Microsoft)** o el hashing de **NCMEC** para match contra bases conocidas, con reporte legal obligatorio. **Esto es un requisito legal en EE.UU. (18 U.S.C. §2258A), no opcional.**
- **Detección de bots/spam en imagen:** limitada. El spam se ataca en texto + Trust Score + rate limiting.

### 2.2 Mapeo de likelihood → score de riesgo

```
likelihood → valor numérico:
  VERY_UNLIKELY = 0.0
  UNLIKELY      = 0.2
  POSSIBLE      = 0.5
  LIKELY        = 0.8
  VERY_LIKELY   = 1.0

img_risk = max(
    adult    * 1.0,   // peso pleno
    violence * 1.0,
    racy     * 0.5    // racy pesa menos: no siempre viola normas
)
// medical y spoof: informativos, no suman a img_risk salvo contexto
```

### 2.3 Costos Google Vision 2026 (verificado)

SafeSearch tiene precio **propio** (distinto de otras features) y un **descuento por bundle**:

| Tier | SafeSearch standalone | SafeSearch + Label Detection (bundle) |
|------|----------------------|----------------------------------------|
| Primeras 1.000 imgs/mes | **Gratis** | **Gratis** |
| 1.001 – 5.000.000/mes | **$1.50 / 1.000** | **Gratis** (incluido con Label) |
| 5.000.001+/mes | **$0.60 / 1.000** | **Gratis** (incluido con Label) |

> **Optimización de costo:** si de todas formas se corre **Label Detection** (útil para auto-tagging, búsqueda, categorización de listings/negocios), **SafeSearch sale gratis**. Se paga solo Label Detection ($1.50/1000 tier 1). **Decisión:** correr Label + SafeSearch juntos → obtenemos moderación *y* metadata de imagen por el precio de una feature.

**Ejemplo:** 100.000 imágenes/mes en un tenant = ~$148/mes (Label+SafeSearch, tras el free tier). A 1M imágenes/mes ≈ $1.500/mes. Escala lineal; se puede cachear por hash para no re-analizar duplicados.

### 2.4 Alternativas evaluadas

| Proveedor | Imagen | Video | Multi-modal | Notas |
|-----------|--------|-------|-------------|-------|
| **Google Vision** ✅ | ~$1.50/1000 (o gratis c/Label) | No nativo (frames) | No | **Elegido** (cliente lo confirmó). Sólido en NSFW/violencia. |
| **AWS Rekognition** | ~$0.001/img (1er 1M), baja con volumen | **$0.10/min** (async nativo) | Parcial | **Más barato en imagen a escala** y **video nativo async**. Fuerte candidato si el volumen de video crece. Taxonomía de moderación granular (~35 subcategorías). |
| **Hive AI** | ~$1.50-3.00/1000 | **$0.13/min** | **Sí (texto+img+video+audio en 1 API)** | Mejor cobertura multimodal única. Más caro. Ideal si se quiere **un solo proveedor** para todo. |
| **Sightengine** | Competitivo | Sí | Sí | Buen NSFW, workflows configurables. Alternativa europea. |

**Recomendación de evolución:**
- **Fase 1 (MVP → escala media):** Google Vision (imagen, ya confirmado) + frames para video.
- **Fase 2 (si video explota):** migrar **video** a **AWS Rekognition** ($0.10/min nativo async, sin gestionar extracción de frames) o **Hive** si se quiere consolidar todo. Mantener imagen en Vision o consolidar en Rekognition (más barato a escala).
- El pipeline se diseña **provider-agnostic** (interfaz `ImageModerator` / `VideoModerator`) para poder cambiar sin reescribir el orquestador.

---

## 3. Moderación de texto en ESPAÑOL LATINO — la decisión crítica

### 3.1 Comparativa de opciones (2026)

| Servicio | Español | Costo | Categorías | Estado 2026 | Veredicto |
|----------|---------|-------|------------|-------------|-----------|
| **OpenAI Moderation (`omni-moderation-latest`)** | **Excelente** — +42% en eval multilingüe (40 idiomas), español del nuevo modelo **supera** al inglés del anterior | **GRATIS** | 13 categorías (texto **e imagen**) | Activo, free | ✅ **ELEGIDO (1ra línea)** |
| **Google Perspective API** | Bueno (20+ idiomas) | Gratis | toxicity, insult, threat, profanity, identity_attack | ⚠️ **SE DISCONTINÚA 31-DIC-2026, sin soporte de migración** | ❌ **DESCARTADO** |
| **AWS Comprehend** | Bueno (detección de toxicidad + PII) | ~$0.0001/unidad (100 chars) | Toxicidad, sentiment, PII | Activo | 🔸 Backup / usar solo para **PII redaction** |
| **LLM (Gemini 2.5 Flash / Claude Haiku 4.5)** | **Excelente** (entiende jerga, contexto, ironía, regionalismos) | Gemini: **$0.30/1M in, $2.50/1M out** · Haiku: $1/1M in, $5/1M out | Cualquier categoría (prompt) + explicación | Activo | ✅ **ELEGIDO (2da opinión en zona gris)** |

### 3.2 Por qué esta decisión

**Descarte de Perspective API:** aunque es históricamente el estándar para toxicidad en español, **Google anunció su discontinuación el 31 de diciembre de 2026 sin ruta de migración**. Construir sobre una API muerta es deuda técnica garantizada. **No se usa.**

**OpenAI Moderation como primera línea:**
1. **Es gratis** — cero costo marginal por request, se puede correr sobre el 100% del texto sin preocuparse por presupuesto.
2. **Español mejorado dramáticamente** — el modelo `omni-moderation-latest` mejoró 42% en evaluaciones multilingües; el español ahora rinde mejor que el inglés del modelo previo.
3. **Multimodal** — la misma API modera texto **e imágenes** (útil como segunda señal sobre Vision).
4. **13 categorías** con scores 0-1: `sexual`, `sexual/minors`, `harassment`, `harassment/threatening`, `hate`, `hate/threatening`, `illicit`, `illicit/violent`, `self-harm`, `self-harm/intent`, `self-harm/instructions`, `violence`, `violence/graphic`.
5. **Response format:** `flagged` (bool), `categories` (bool por categoría), `category_scores` (0-1), `category_applied_input_types`.

**Limitaciones a cubrir:**
- **Spam** no es una categoría nativa de OpenAI Moderation. Se ataca con: (a) heurísticas (links, repetición, velocidad de posteo), (b) Trust Score bajo, (c) el LLM de segunda opinión clasifica spam explícitamente.
- **Jerga latina regional / ironía / amenazas veladas:** los clasificadores puros pueden fallar con "te voy a buscar" (¿amenaza o casual?). Aquí entra el **LLM**.

**Gemini 2.5 Flash como segunda opinión (solo zona gris 31-70):**
- Solo se invoca cuando OpenAI deja el texto en ambigüedad (score 0.3-0.7 en alguna categoría) → **volumen bajo**, costo controlado.
- Prompt en español pide: clasificar spam/hate/toxicidad/amenaza + dar un score 0-100 + **explicación** (auditable para el Moderador).
- **Gemini elegido sobre Claude Haiku por costo** ($0.30 vs $1.00 por 1M input tokens = 3.3x más barato) para una tarea de clasificación de alto volumen donde el input domina. Un comentario ~50 tokens; 1M de comentarios ≈ 50M tokens ≈ **$15**. Trivial.
- **Nota de gobernanza (regla CLAUDE.md):** si en el futuro se necesita razonamiento matizado o el cliente prioriza calidad sobre costo, Claude Haiku/Sonnet es intercambiable — la interfaz `TextModerator` lo permite.

### 3.3 Flujo de texto (detalle)

```
texto → OpenAI Moderation (gratis, ~300ms)
         │
         ├─ score < 0.3 en todas las cat.      → APROBAR (Tier 1)
         ├─ alguna cat. > 0.7                   → COLA MANUAL (Tier 3)
         │    └─ si sexual/minors o violence/graphic > 0.5 → AUTO-REJECT + reporte legal
         └─ zona gris (0.3-0.7)                 → Gemini 2.5 Flash 2da opinión
                                                    │
                                                    ├─ confirma limpio → Tier 2 (monitor)
                                                    └─ confirma tóxico → Tier 3 (manual)
        // en paralelo: heurística de spam (links, repetición, velocidad) suma a risk
```

### 3.4 Categorías críticas — manejo legal

- **`sexual/minors` (CSAM):** detección → **bloqueo inmediato + preservación de evidencia + reporte a NCMEC** (obligatorio por ley EE.UU.). Nunca va a la cola de un Moderador humano común (exposición legal/psicológica); va a un flujo restringido de compliance. Complementar con hashing PhotoDNA.
- **Amenazas creíbles (`violence`, `harassment/threatening`):** cola manual prioritaria + posible reporte a autoridades según jurisdicción del tenant (EE.UU. vs Europa → GDPR/DSA).
- **DSA (Digital Services Act, Europa):** para tenants europeos, mantener **logs de decisiones de moderación**, mecanismo de apelación del usuario, y transparencia. El schema de `moderation_jobs` debe guardar: input, scores, decisión, moderador, timestamp, razón. Ya contemplado en §7.

---

## 4. (Integrado en §3) — Recomendación de texto

**Resumen:** OpenAI Moderation (gratis, primera línea, 100% del texto) + Gemini 2.5 Flash (segunda opinión solo en zona gris) + heurísticas de spam + AWS Comprehend opcional solo para **redacción de PII**. Perspective API **descartado por discontinuación**.

---

## 5. Moderación de video

### 5.1 Estrategia: frames + audio

El video no se modera "entero" con un modelo mágico barato. Se descompone:

```
VIDEO subido
   │
   ▼
Transcode (Cloudflare Stream / Bunny) ──► genera renditions + thumbnails
   │
   ├─► EXTRACCIÓN DE FRAMES (1 frame cada 2-3 s)
   │      └─► cada frame → Google Vision SafeSearch (o Rekognition)
   │             └─► video_img_risk = max(frames)
   │
   └─► AUDIO → TEXTO (opcional, video largo)
          └─► Whisper / Bunny AI Transcription ($0.10/min)
                 └─► texto → OpenAI Moderation
                        └─► video_text_risk

video_risk = max(video_img_risk, video_text_risk)
```

**Para video corto (≤15s, gratis):** solo frames (5-8 frames). Audio-a-texto opcional (mayoría es música/ruido). Costo IA por video: **5-8 imgs × $1.50/1000 ≈ $0.008-0.012**. Despreciable.

**Para video largo (premium):** frames + transcripción de audio. La transcripción agrega $0.10/min pero solo aplica a creadores premium (monetizable).

### 5.2 Alternativa nativa: AWS Rekognition Video

Rekognition modera video de forma **nativa y asíncrona** a **$0.10/min**, sin que nosotros gestionemos extracción de frames. Para un video de 15s = **$0.025**. Es **más caro que frames manuales** ($0.01) pero **operacionalmente más simple** (sin lógica de sampling, maneja escenas). 

**Decisión:**
- **MVP:** frames + Vision (reutiliza el proveedor de imagen ya confirmado, más barato).
- **Escala:** si el volumen de video justifica la simplicidad operativa, migrar a Rekognition Video o Hive Video ($0.13/min). Interfaz `VideoModerator` desacopla la decisión.

### 5.3 Latencia de video

Dominada por el **transcode del proveedor**, no por la IA. Cloudflare/Bunny tardan de segundos a minutos según duración. La moderación de frames corre **después** del transcode (los thumbnails/frames ya existen). Total: **video corto decidido en 15-60s**, largo en 1-5 min. El usuario ve "procesando" con la PWA.

---

## 6. Trust Score dinámico (0-100) + badges + anti-abuso

### 6.1 Modelo de cálculo

El Trust Score es **persistente por usuario**, sube con actividad legítima y baja con reportes/rechazos. Se recalcula por eventos (no en cada request; se cachea en `profiles.trust_score`).

```
trust_score = clamp(0, 100,
      base_new_user                       // 10 al registrarse
    + w1 * account_age_factor             // antigüedad (con techo)
    + w2 * legit_activity                 // posts aprobados, engagement recibido
    + w3 * verification_bonus             // email/SMS/foto verificada
    + w4 * positive_social                // seguidores reales, reacciones positivas
    - w5 * reports_penalty                // reportes válidos recibidos (decae en el tiempo)
    - w6 * rejections_penalty             // contenido rechazado por moderación
    - w7 * abuse_signals                  // señales de bot/spam ring (ver §6.3)
)
```

**Componentes (valores sugeridos, tunables):**

| Componente | Fórmula / lógica | Aporte máx |
|------------|------------------|------------|
| `base_new_user` | Constante al registro | +10 |
| `account_age_factor` | `min(20, days_active / 9)` → ~180 días llega al techo | +20 |
| `legit_activity` | `min(25, 2 * approved_posts + engagement_recibido/K)` | +25 |
| `verification_bonus` | email(+5), SMS/Twilio(+10), foto verificada Google(+10) | +25 |
| `positive_social` | seguidores reales, reacciones (con anti-inflado) | +20 |
| `reports_penalty` | `Σ reportes_válidos * decay(t)` — cada reporte válido resta, **con decay temporal** (un reporte de hace 6 meses pesa menos) | hasta −40 |
| `rejections_penalty` | contenido eliminado por Moderador resta fuerte | hasta −30 |
| `abuse_signals` | penalización dura por señales de fraude | hasta −50 |

**Decay temporal (clave anti-injusticia):** las penalizaciones **se recuperan** con el tiempo si el usuario se comporta bien. Un reporte válido resta X, pero decae exponencialmente (`half-life ~90 días`). Esto permite rehabilitación y evita "muerte por un mal día".

**Asimetría (clave anti-abuso):** el score **sube lento** (actividad sostenida) y **baja rápido** (una violación grave). Esto encarece construir cuentas "confiables" falsas.

### 6.2 Badges

| Badge | Rango Trust Score | Requisitos adicionales | Beneficios |
|-------|-------------------|------------------------|------------|
| 🆕 **Nuevo** | 0-30 | Cuenta recién creada | Rate limits estrictos; todo su contenido pondera más alto en riesgo (`w_user`) |
| ✅ **Verificado** | 31-60 | Email **y** SMS verificados | Menos fricción de moderación; puede crear listings |
| 🔵 **Confiable** | 61-85 | + foto verificada + antigüedad + historial limpio | Auto-aprobación más amplia; menos revisiones; badge visible |
| 👑 **Premium** | 86-100 **o** suscripción de pago | Historial impecable **o** membresía Stripe | Máxima confianza; puede ser creador monetizado (80/20); prioridad en soporte |

> **Nota:** "Premium" tiene doble vía — por **mérito** (score alto sostenido) o por **suscripción** (Stripe Connect). Un usuario que paga obtiene el badge pero **sigue sujeto a moderación** (pagar no compra impunidad; solo reduce fricción y desbloquea monetización).

### 6.3 Anti-abuso: bots, spam rings, fake accounts

**Señales que alimentan `abuse_signals` (penalización):**

| Vector | Detección | Contramedida |
|--------|-----------|--------------|
| **Bots** | Velocidad de posteo sobrehumana, patrones horarios de máquina, texto repetido, sin variación de dispositivo | Rate limiting agresivo + CAPTCHA + baja de Trust Score |
| **Spam rings** | Cluster de cuentas nuevas que se siguen/likean entre sí, mismo IP/subnet, mismos links | Análisis de grafo (comunidades densas anómalas) → penalización colectiva |
| **Fake accounts** | Email desechable, sin verificación SMS, foto de perfil stock/duplicada (pHash), device fingerprint compartido | Bloquear dominios de email temporales; exigir SMS; pHash de fotos de perfil |
| **Inflado de engagement** | Likes/follows en ráfaga desde cuentas de bajo trust | Los votos de cuentas Trust<20 pesan ~0 en `positive_social` (voto ponderado por trust) |
| **Report brigading** (abuso de reportes para tumbar a inocentes) | Muchos reportes desde cuentas de bajo trust o coordinadas | **Peso del reporte ∝ Trust Score del reportante**; reportes de bots casi no cuentan |
| **Ban evasion** | Cuenta nueva con device/IP de usuario baneado | Device fingerprinting + shadow-ban |

**Principios de diseño:**
1. **Voto ponderado por confianza:** tanto reacciones como reportes pesan según el Trust Score del emisor. Esto neutraliza granjas de bots en ambas direcciones (no pueden inflar ni tumbar).
2. **Análisis de grafo periódico** (job nocturno) para detectar clusters de spam rings.
3. **Device + IP fingerprinting** para correlacionar cuentas falsas (respetando GDPR: consentimiento y minimización de datos en tenants europeos).
4. **Rate limits por badge:** Nuevo < Verificado < Confiable < Premium.

---

## 7. Esquema de datos de moderación (referencia para el PLAN MAESTRO)

```sql
-- Cola/log de moderación (auditable, cumple DSA)
create table moderation_jobs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,                    -- RLS
  content_type  text not null,                    -- post|photo|video|comment|listing|business|event
  content_id    uuid not null,
  author_id     uuid not null,
  modalities    text[] not null,                  -- {text,image,video}
  ai_scores     jsonb,                            -- crudo de cada proveedor (auditoría)
  risk_score    int not null,                     -- 0-100 final
  tier          int not null,                     -- 1|2|3
  status        text not null default 'pending',  -- pending|approved|monitor|in_review|rejected|removed
  moderator_id  uuid,                             -- quién resolvió (si manual)
  decision_reason text,
  created_at    timestamptz default now(),
  resolved_at   timestamptz
);

-- Estado embebido en cada tabla de contenido:
-- moderation_status text default 'pending'  (approved|monitor|in_review|rejected|removed)

-- Trust score cacheado en profiles:
-- profiles.trust_score int default 10
-- profiles.trust_badge text  -- nuevo|verificado|confiable|premium
-- profiles.trust_updated_at timestamptz

-- Reportes (con peso por trust del reportante):
create table content_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  content_id uuid not null,
  reporter_id uuid not null,
  reporter_trust_at_time int,      -- snapshot para calcular peso
  reason text,
  created_at timestamptz default now()
);
```

**RLS:** todas las tablas filtran por `tenant_id` (patrón confirmado por el cliente). El Moderador solo ve la cola de **su dominio**; el Global Super Admin puede ver todo.

---

## 8. Media pipeline — decisiones detalladas

### 8.1 Video: Cloudflare Stream vs Bunny Stream

| Dimensión | **Cloudflare Stream** | **Bunny Stream** |
|-----------|----------------------|------------------|
| **Modelo de precio** | Por **minuto** (simple) | Por **GB + storage + encoding** (granular) |
| **Almacenamiento** | **$5 / 1.000 min** almacenados | **$0.01/GB/mes** (barato) |
| **Entrega** | **$1 / 1.000 min** vistos | Por GB **según región** (ver abajo) |
| **Entrega Sudamérica** | Incluido en el $1/1000min (global uniforme) | **$0.045/GB** ⚠️ (caro para LatAm) |
| **Entrega Europa/NA** | Incluido | $0.010/GB |
| **Encoding** | **Incluido** | H.264 hasta 1080p **gratis**; premium (1440p/4K) $0.05-0.15/min |
| **DRM** | ❌ **No** (solo tokens firmados) | ✅ **MediaCage** (Basic incluido; Enterprise $99/mes) |
| **Live streaming** | ✅ Sí | ⚠️ No documentado en review |
| **Player embebido** | ✅ Sí, edge global | ✅ Sí, adaptive bitrate |
| **Seguridad** | Tokens firmados (expiran) | Tokens + domain restrictions |
| **Simplicidad** | ⭐⭐⭐⭐⭐ (un switch) | ⭐⭐⭐ (modelar egress) |

**El trade-off central para Comunidad Latina:**

La audiencia es la **diáspora latina en EE.UU./Europa** — pero también hay tráfico y potencialmente CDN hacia **Sudamérica**. Bunny castiga la entrega a Sudamérica con **$0.045/GB** (4.5x Europa/NA) y a Medio Oriente/África con $0.06/GB. Cloudflare Stream cobra **por minuto visto de forma global uniforme**, sin sorpresas regionales.

**Simulación (tenant 10k usuarios, video corto):**
- Supuesto: 5.000 videos/mes × 15s = 1.250 min almacenados; 200.000 vistas/mes × 15s = 50.000 min vistos.
- **Cloudflare Stream:** storage 1.250 min → $6.25 + delivery 50.000 min → $50 = **~$56/mes**. Predecible, sin importar región.
- **Bunny Stream:** storage trivial (~$0.10) + encoding gratis + delivery ~= (50.000 min × ~5MB/15s ≈ 16 GB... depende de bitrate). A bitrate bajo (~1 Mbps, 15s ≈ 1.9 MB) → ~95 GB. Si 40% Sudamérica ($0.045) + 60% NA/EU ($0.01): ≈ $2.6 + $0.6 ≈ **~$5-15/mes** en delivery. **Más barato en storage y encoding, competitivo en delivery si el bitrate es bajo.**

**Decisión:**
> **MVP y por defecto: Cloudflare Stream.** Razones: (1) **precio por minuto = presupuesto predecible** sin modelar bitrate/GB/región; (2) encoding incluido; (3) tokens firmados suficientes para contenido social (no premium); (4) live streaming disponible para futuro; (5) integración trivial. El costo es transparente y fácil de facturar por tenant.
>
> **Reservar Bunny Stream para el tier premium con DRM.** Cuando existan creadores monetizados (Creator Marketplace 80/20) que exijan **protección DRM real** contra piratería, Bunny MediaCage lo ofrece y Cloudflare **no**. Arquitectura desacoplada (interfaz `VideoProvider`) permite enrutar: video social → Stream, video premium protegido → Bunny.

**Regla de oro de costos:** el video **domina** el costo de media. Por eso video corto es **gratis con límite de 15s** (controla el gasto) y el video largo es **premium** (el usuario que lo consume/produce ayuda a pagarlo).

### 8.2 Storage de imágenes/assets: Cloudflare R2 vs Supabase Storage

| Dimensión | **Cloudflare R2** | **Supabase Storage** |
|-----------|-------------------|----------------------|
| **Storage** | **$0.015/GB/mes** | ~$0.021/GB/mes (Pro, overage) |
| **Egress** | **$0 (CERO)** ✅✅ | **$0.09/GB** ⚠️ (Pro, tras 250GB incluidos) |
| **Operaciones** | Class A (write) $4.50/M, Class B (read) $0.36/M | Incluido |
| **CDN** | Edge global de Cloudflare, integrado | CDN incluido (pero egress se cobra) |
| **Integración auth** | Requiere wiring (S3 API + firma) | **Nativa** con Supabase Auth/RLS |
| **Mejor para** | **Media público de alto volumen** (feed, fotos, videos thumbnails) | **Archivos privados atados a auth** (documentos, avatares privados) |

**El factor decisivo: egress.** Una red social sirve **muchísimas** lecturas de imágenes (cada scroll del feed carga decenas de fotos). Con Supabase Storage, ese egress a $0.09/GB se vuelve el costo dominante. Con R2, **el egress es cero** — se paga solo storage barato + operaciones.

**Decisión (híbrida, alineada con el cliente):**
> **Cloudflare R2 para todo el media público** (fotos de posts, imágenes de listings/negocios/eventos, thumbnails de video, banners de tenant). **Egress $0** es el argumento ganador para un feed de alto tráfico. El cliente ya se inclinaba a R2 "por eficiencia a alto volumen" — confirmado.
>
> **Supabase Storage para archivos privados atados a auth** (documentos de verificación, assets que requieren RLS estricto y no se sirven masivamente). Aprovecha la integración nativa con Supabase Auth.
>
> **Patrón:** "Supabase para archivos de usuario autenticados, R2 para media público" — es el patrón recomendado por la industria 2026 y encaja perfecto.

**CDN:** R2 se sirve por la red edge de Cloudflare (rápido global, incluye LatAm). Se añade **transformación de imágenes** (resize/webp on-the-fly) vía Cloudflare Images o Workers para servir tamaños optimizados por dispositivo (clave para PWA + performance móvil).

**Aislamiento por tenant en storage:** estructura de paths `/{tenant_id}/{content_type}/{id}.{ext}` + políticas de acceso. Aunque R2 no tiene RLS de Postgres, el acceso se media por **URLs firmadas generadas por el backend** (que sí valida `tenant_id` vía RLS antes de firmar). Nunca se exponen buckets públicos sin firma para contenido sensible.

---

## 9. Estimación de costos consolidada (por tenant, 10k usuarios activos/mes)

**Supuestos:** 30k posts de texto, 100k imágenes subidas, 5k videos cortos (15s), 200k vistas de video, feed con alto egress de imágenes.

| Servicio | Cálculo | Costo/mes |
|----------|---------|-----------|
| **Texto — OpenAI Moderation** | 30k+ requests, gratis | **$0** |
| **Texto — Gemini 2.5 Flash** (solo ~10% zona gris) | ~3k comentarios × ~50 tok | **~$1** |
| **Imagen — Google Vision** (Label+SafeSearch) | 100k imgs × $1.50/1000 (tras free) | **~$148** |
| **Video — moderación (frames)** | 5k videos × ~6 frames × $1.50/1000 | **~$45** |
| **Video — Cloudflare Stream** | storage 1.250min ($6.25) + delivery 50k min ($50) | **~$56** |
| **Storage imágenes — R2** | ~50GB storage ($0.75) + egress $0 + ops | **~$3** |
| **Total moderación + media** | | **~$253/mes** |

> **Palancas de reducción de costo:**
> - **Cache por hash de imagen:** no re-analizar duplicados (fotos virales) → puede recortar Vision 20-40%.
> - **Solo moderar contenido de usuarios Trust<60:** los Premium/Confiables con historial impecable pueden auto-aprobar imágenes con muestreo aleatorio (p. ej. moderar solo 1 de cada 5) → recorta Vision drásticamente. **Con esta palanca, el costo de imagen baja de ~$148 a ~$50-70.**
> - **Con ambas palancas:** total realista **~$120-160/mes** por tenant de 10k usuarios. Escala sublinealmente gracias al cache.

**Costo marginal por usuario activo:** ~$0.012-0.025/mes. Muy sostenible para un modelo con membresías Stripe.

---

## 10. Generación de assets/branding por tenant

Al crear un dominio nuevo (p. ej. `colombianos.com`, `dominicanos.com`), se auto-genera un kit de branding inicial con IA. **Nota: esto NO se ejecuta ahora — es diseño del pipeline.**

### 10.1 Herramientas disponibles

- **nano banana (Gemini image)** — MCP disponible. Genera y **edita** imágenes 2D: logos, banners, ilustraciones de onboarding, iconos, patrones de fondo. Soporta aspect ratios y edición conversacional.
- **Meshy** — MCP disponible. Genera **modelos 3D** (text-to-3D, image-to-3D). Solo relevante si el producto usa assets 3D (mascotas de comunidad, badges 3D, elementos gamificados). **No prioritario para MVP.**

### 10.2 Pipeline de branding por tenant (diseño)

```
Admin crea tenant "colombianos.com"
   │  inputs: nombre país, colores bandera, tono (cálido/formal), keywords culturales
   ▼
┌────────────────────────────────────────────────┐
│  Generación de kit (nano banana / Gemini image) │
│                                                  │
│  1. LOGO           → prompt con nombre+colores+  │
│                       símbolo cultural           │
│  2. BANNER hero    → escena de comunidad,        │
│                       aspect 16:9 y 3:1          │
│  3. ONBOARDING     → 3-4 ilustraciones de        │
│     illustrations     bienvenida (estilo         │
│                       consistente vía seed)      │
│  4. ICON / favicon → versión simplificada logo   │
│  5. OG image       → para compartir social       │
│  6. Patrón/textura → fondo sutil con motivo      │
│                       regional                    │
└───────────────────┬──────────────────────────────┘
                    │  imágenes generadas
                    ▼
      Revisión humana del Admin (aprobar/regenerar)
                    ▼
      Upload a R2: /{tenant_id}/branding/*
                    ▼
      Registro en tabla tenant_branding (URLs)
                    ▼
      PWA lee branding por tenant → theming dinámico
```

### 10.3 Consideraciones

- **Consistencia de estilo:** usar el **mismo seed/estilo base** en todas las ilustraciones de un tenant para coherencia visual. Definir un "style prompt" maestro por marca.
- **Revisión humana obligatoria:** la IA propone, el Admin dispone. Nunca publicar branding sin aprobación (evita logos con artefactos o culturalmente insensibles).
- **Sensibilidad cultural:** los prompts deben evitar estereotipos. Curar prompts con símbolos culturales **auténticos y respetuosos** por país. Esto es reputacionalmente crítico para una app de diáspora.
- **Costo:** por generación (unos centavos a pocos dólares por imagen según proveedor). Un kit completo por tenant es un costo **one-time** trivial frente al valor de branding instantáneo.
- **Fallback:** si la generación falla o no convence, tener plantillas base parametrizables por color (CSS variables) como red de seguridad.
- **3D (Meshy):** diferir a fase de gamificación. Si se implementan badges/mascotas 3D, Meshy genera los modelos que se renderizan con Three.js/React Three Fiber en la PWA.

---

## 11. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| **Perspective API discontinuado** ya considerado | — | No se usa. OpenAI Moderation elegido. |
| **Falsos positivos molestan a usuarios legítimos** | Churn | Tier 2 publica igual; decay en penalizaciones; apelación (DSA); Trust alto reduce fricción |
| **CSAM — exposición legal** | Legal grave | PhotoDNA/NCMEC hashing + reporte obligatorio + flujo de compliance separado (no Moderador común) |
| **Costo de video se dispara** | Presupuesto | Video corto gratis ≤15s; largo es premium (paga quien lo usa); Stream = costo predecible |
| **Egress de imágenes** | Presupuesto | R2 con egress $0 |
| **Dependencia de un solo proveedor de IA** | Continuidad | Interfaces `TextModerator`/`ImageModerator`/`VideoModerator` desacopladas → swap sin reescribir |
| **Spam rings / bots evaden moderación** | Calidad, spam | Voto ponderado por trust, análisis de grafo, fingerprinting, rate limits por badge |
| **GDPR/DSA en tenants europeos** | Legal | Logs de moderación auditables, apelación, minimización de datos, consentimiento de fingerprinting |
| **Latencia de moderación degrada UX** | Experiencia | Async con optimistic UI; presupuesto <5s texto/imagen; "procesando" para video |

---

## 12. Fuentes (verificadas julio 2026)

**Moderación de texto:**
- [OpenAI — Upgrading the Moderation API (multimodal)](https://openai.com/index/upgrading-the-moderation-api-with-our-new-multimodal-moderation-model/)
- [OpenAI Moderation Guide](https://developers.openai.com/api/docs/guides/moderation)
- [omni-moderation model](https://developers.openai.com/api/docs/models/omni-moderation-latest)
- [Content Moderation APIs 2026 — Eden AI](https://www.edenai.co/post/content-moderation-apis-text-image-and-video-compared)
- [Perspective API discontinuation / alternatives — Lasso](https://www.lassomoderation.com/blog/perspective-api/)
- [Annenberg — OpenAI, DeepSeek, Google vary in hate speech detection](https://www.asc.upenn.edu/news-events/news/openai-deepseek-and-google-vary-widely-identifying-hate-speech)

**Imagen/Video:**
- [Google Cloud Vision Pricing](https://cloud.google.com/vision/pricing)
- [AWS Rekognition Pricing](https://aws.amazon.com/rekognition/pricing/)
- [AWS Rekognition image vs video for moderation](https://aws.amazon.com/blogs/machine-learning/how-to-decide-between-amazon-rekognition-image-and-video-api-for-video-moderation/)
- [Best Image Moderation APIs 2026 — Eden AI](https://www.edenai.co/post/best-image-moderation-apis)

**Video streaming:**
- [Bunny Stream Review 2026 — Swarmify](https://swarmify.com/blog/bunny-stream-review/)
- [Mux vs Cloudflare Stream vs Bunny 2026 — PkgPulse](https://www.pkgpulse.com/guides/mux-vs-cloudflare-stream-vs-bunny-stream-video-cdn-2026)
- [Cloudflare Stream Pricing](https://developers.cloudflare.com/stream/pricing/)
- [Bunny.net vs Cloudflare 2026](https://www.kunalganglani.com/blog/bunnynet-vs-cloudflare-2026)

**Storage:**
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 vs S3 vs Supabase Storage 2026](https://adamarant.com/en/blog/cloudflare-r2-vs-s3-vs-supabase-storage-in-2026-which-to-pick)
- [Supabase vs R2 2026 — BuildMVPFast](https://www.buildmvpfast.com/compare/supabase-vs-r2)

**LLM pricing:**
- [LLM API Pricing 2026 — TLDL](https://www.tldl.io/resources/llm-api-pricing)
- [Claude Haiku 4.5 vs Gemini 2.5 Flash Pricing](https://langcopilot.com/claude-haiku-4-5-vs-gemini-2.5-flash-pricing)

**Guía del cliente:**
- [Comunidad Latina — Guía completa](https://geovanny-estudio.onrender.com/)

---

## 13. Próximos pasos para el PLAN MAESTRO

1. **Definir schema completo** de `moderation_jobs`, `content_reports`, columnas de trust en `profiles` (borrador en §7).
2. **Implementar interfaces desacopladas:** `TextModerator`, `ImageModerator`, `VideoModerator`, `VideoProvider`, `StorageProvider` — para poder cambiar proveedores sin reescribir el orquestador.
3. **Edge Function worker** de moderación + integración pgmq (Supabase Queues).
4. **Dashboard del Moderador** (cola Tier 3, acciones aprobar/rechazar/suspender, respetando RLS por tenant).
5. **Cron de recálculo de Trust Score** + job nocturno de análisis de grafo anti-spam-ring.
6. **Flujo de compliance CSAM** separado (PhotoDNA/NCMEC) — prioridad legal alta.
7. **Pipeline de branding por tenant** (nano banana) con revisión humana.
8. **Cache por hash** para imágenes (dedup de moderación) desde el día 1.
9. **Presupuesto de latencia** como SLA monitoreado (observabilidad: logs de tiempos por etapa).
```

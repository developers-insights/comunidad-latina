# 09 — Diferenciación e IA como Producto

**Proyecto:** Comunidad Latina (NYLabel) — red social white-label multi-tenant para la diáspora latina en EE.UU./Europa.
**Documento:** Power-up del plan maestro. Foco exclusivo: **qué convierte esto en un producto con moat, no en "otro Facebook genérico".**
**Fecha:** 2026-07-06 · **Autor:** ai-engineer (investigación verificada con WebSearch, julio 2026)
**Stack asumido:** Next.js (PWA) · Supabase (Postgres + RLS + pgvector + Edge Functions + Realtime + Storage) · Vercel · Stripe Connect · OpenAI / Gemini / Google Vision.

> ⚠️ **AVISO (2026-07-06) — ESTE INFORME ESTÁ PARCIALMENTE SUPERADO POR §3 DE `docs/PLAN_MAESTRO.md` (V4).** La §2.2 de abajo describe el Escudo Anti-Estafa como *"IA que intercepta el fraude antes de que ocurra"* y el verificador de notarios/abogados con badge de aval. Ambos veredictos del abogado del diablo marcaron eso como **responsabilidad civil disfrazada de feature** (negligent misrepresentation; pérdida de la inmunidad §230 tipo Roommates.com; UPL tipo FTC v. DoNotPay). **La versión que se construye es la de §3 del Plan Maestro V4: verificación DETERMINÍSTICA contra fuente oficial fechada, con copy literal + disclaimer, NUNCA un badge de aval ni una IA que "promete" interceptar fraude.** El resto del informe (costos IA, Asistente Comunitario RAG con guardrails, Guías, Matching, Copiloto de Negocios, moonshots) sigue vigente. Ante conflicto, rige el Plan Maestro.

---

## 0. Tesis del documento

El plan maestro ya resuelve la **infraestructura de una red social + directorio + marketplace** (feeds, perfiles, propiedades, negocios, profesionales, eventos, tiendas, publicidad geo, grupos, historias, moderación IA, broadcast). Todo eso es **paridad competitiva**: necesario para no perder, insuficiente para ganar. Sngine, Facebook Groups, Nextdoor y una docena de directorios latinos ya cubren ese terreno.

El **moat** — lo que hace que un inmigrante latino *no pueda* obtener el mismo valor en Facebook — vive en tres capas que ninguna red social generalista puede replicar sin reconstruir su producto entero alrededor del inmigrante:

1. **Confianza verificada entre inmigrantes** (anti-estafa). Es el problema #1 de una población deliberadamente vulnerable. Es un moat de **datos + red** (mejora con cada usuario y cada reporte).
2. **Utilidad accionable en los dolores reales del inmigrante** (trámites, remesas transparentes, "cómo hacer X siendo latino", homeland). Es un moat de **contenido propietario + workflow**.
3. **IA como producto, no como feature** (asistente comunitario hiperlocal + matching semántico + growth para negocios chicos). Es un moat de **datos privados por tenant** que ningún LLM genérico tiene.

Cada idea abajo está etiquetada con:
- **Impacto** (1-5) · **Esfuerzo** (1-5, con el stack real) · **Moat** (Débil / Medio / **FUERTE**) · **Producto completo** (Sí / Fase 2 / Opcional).
- **Factibilidad técnica** concreta con Supabase/Next.js/LLMs 2026.

> **Regla de oro de priorización:** Impacto alto + Moat FUERTE + Esfuerzo bajo/medio = entra al producto completo. Un feature "cool" con moat Débil (lo copia Facebook en un sprint) NO justifica complejidad.

---

## 1. Realidad de costos IA 2026 (verificado) — habilita "IA como producto"

La razón por la que "IA como producto" es viable económicamente en 2026 y no lo era en 2023: **el costo por token colapsó**. Enrutando por tarea, el costo marginal de un asistente comunitario es de centavos.

| Modelo | Input $/1M tok | Output $/1M tok | Uso recomendado en el producto |
|---|---|---|---|
| **GPT-5 nano** | ~$0.05 | ~$0.40 | Clasificación, routing, tagging de feed, dedupe, detección de idioma, pre-filtro moderación |
| **Gemini 2.5 Flash** | ~$0.30 | ~$2.50 | Workhorse: asistente comunitario, resúmenes, generación de listings, traducción contextual |
| **GPT-5 mini** | ~$0.25 | ~$2.00 | Alternativa/fallback al workhorse; structured outputs |
| **Claude Haiku 4.5** | ~$1.00 | ~$5.00 | Redacción de calidad (copy de negocios, mensajes sensibles), razonamiento sobre trámites |
| **Gemini Live (voz)** | ~$0.005/min in · ~$0.018/min out (~$0.037/min efectivo) | — | Traducción de voz en vivo, asistente por voz. ~32x más barato que OpenAI Realtime |
| **text-embedding-3-small** | ~$0.02 / 1M tok | — | Embeddings para pgvector (matching, semantic search, recos). 1536 dims |
| **Google Vision** | ~$1.50 / 1000 img | — | Moderación de imágenes, OCR de documentos (trámites), verificación de listings |

**Consecuencia de diseño:** arquitectura **multi-modelo con router** (una Edge Function `ai-router` que elige modelo por costo/complejidad). Cache semántico en pgvector para preguntas repetidas del asistente (las mismas 200 preguntas cubren el 80% del volumen por ciudad → cache hit ratio alto → costo real ≈ pocos dólares/mes por tenant al inicio).

**Feasibility stack:** Todo LLM se llama desde **Supabase Edge Functions (Deno)** o desde route handlers de Next.js en Vercel. Embeddings se generan async vía **trigger Postgres → pgmq queue → Edge Function** (patrón oficial de "automatic embeddings" de Supabase, verificado). pgvector con índice **HNSW** (cosine) para matching y semantic search en la misma DB — cero infra extra.

---

## 2. CAPA 1 — Moat de Confianza (Anti-Estafa). **La joya de la corona.**

> **Por qué es el moat #1:** El inmigrante latino es un objetivo deliberado de fraude. Verificado: la NYC Dept. of Consumer & Worker Protection emitió 175 violaciones a proveedores de servicios de inmigración en solo 4 meses de 2026 (vs 220 en todo 2025); en junio 2025 NYC aprobó la legislación anti-"notario fraude" más completa del país. El **notario fraude** existe porque "notario" significa *abogado licenciado* en Latinoamérica pero *cualquiera con un sello* en EE.UU. Súmese estafas de renta ("paga el depósito por Zelle y desaparezco"), de empleo, de roommate, y de permisos de trabajo ($6,000 por un work permit que nunca llega). **Ninguna red social generalista puede resolver esto porque no está construida alrededor de la vulnerabilidad del inmigrante.** Este es el "¿por qué esta app y no Facebook?" en una sola frase.

### 2.1 Trust Score 2.0 — Reputación multi-señal, portable y explicable
El plan ya tiene un Trust Score (0-100, badges Nuevo/Verificado/Confiable/Premium). **Diferenciador:** convertirlo de un número opaco en un **sistema de reputación multi-señal, verificable y transversal a todos los módulos**, con IA que explica *por qué* confiar.

- **Señales:** verificación de identidad por niveles (email → teléfono → selfie+documento vía Google Vision OCR/face-match → verificación de dirección → verificación de empleo/negocio) · antigüedad · reviews cross-módulo · transacciones completadas sin disputa en marketplaces · reportes recibidos/resueltos · endorsements de otros usuarios verificados (grafo de confianza) · "verificado por [influencer/HTA/iglesia] local".
- **IA:** un modelo (GPT-5 nano) computa el score y **genera una explicación en lenguaje natural**: *"Confiable: 2 años en la comunidad, 14 transacciones sin disputa, verificado por documento y dirección, avalado por 3 vecinos verificados."*
- **Impacto 5 · Esfuerzo 3 · Moat FUERTE · Producto completo: Sí.**
- **Feasibility:** tabla `trust_signals` en Postgres; función `compute_trust_score()` en Edge Function o pg function; Google Vision para OCR/face-match; grafo de endorsements como tabla de aristas. RLS por tenant.

### 2.2 Escudo Anti-Estafa (Scam Shield) — IA que intercepta el fraude *antes* de que ocurra
El feature más defensivo del producto entero. Una capa de IA que vigila señales de fraude en tiempo real y **protege activamente** al usuario.

- **Detección de patrones de estafa:** clasificador (GPT-5 nano + reglas) sobre mensajes/listings que detecta las firmas conocidas: "paga el depósito antes de ver la propiedad", "envía dinero por Zelle/gift cards", "soy notario y consigo tu permiso", precios de renta 40% bajo mercado (bait), urgencia artificial, pedir datos de documentos.
- **Alertas contextuales just-in-time:** cuando un usuario está por contactar/pagar a alguien con señales de riesgo, aparece un aviso: *"⚠️ Cuidado: esta cuenta tiene 2 días, pide pago antes de mostrar la propiedad y 3 personas la reportaron. Nunca envíes depósitos sin ver el lugar."*
- **Registro comunitario de estafadores (crowdsourced, con moderación):** reportes verificados alimentan una lista negra por tenant y global (broadcast). Este es el **efecto red**: cada estafa reportada protege a los siguientes 68M. Facebook no puede replicar esto porque no tiene el contexto ni la comunidad enfocada.
- **Verificador de "notario/abogado":** integración con el directorio de representantes acreditados por el DOJ + colegios de abogados estatales. El usuario busca a quién va a pagar y la app dice *"❌ NO es abogado licenciado ni representante acreditado por el DOJ"* o *"✅ Abogado licenciado en NY, bar #..."*. **Esto directamente salva a gente de perder $6,000 y arruinar su caso migratorio.**
- **Impacto 5 · Esfuerzo 3 · Moat FUERTE (efecto red + datos propietarios) · Producto completo: Sí (fundacional).**
- **Feasibility:** clasificador barato en tiempo real (nano) sobre mensajes; tabla `scam_reports` + `verified_professionals`; el directorio DOJ es data pública scrapeable/cargable; alertas como componente React sobre el flujo de contacto/checkout. Cache de veredictos.

### 2.3 Escrow de Confianza para transacciones P2P (roommate/renta/servicios)
Extender Stripe Connect (ya en el plan para Creator Marketplace) a un **escrow opcional para transacciones entre usuarios**: depósitos de renta, adelantos de servicios, compra-venta. El dinero se retiene hasta que ambas partes confirman. Mata la estafa "pagué y desapareció".

- **Impacto 4 · Esfuerzo 3 · Moat Medio (Stripe lo habilita cualquiera, pero + confianza + comunidad = defensivo) · Producto completo: Fase 2** (el escrow del Creator Marketplace ya está en roadmap; reusar).
- **Feasibility:** Stripe Connect con `transfer_group` + captura diferida / holds. Ojo regulatorio: posicionar como "pago protegido de servicios", no como custodia de dinero (evitar money-transmitter). Legal review antes de lanzar.

---

## 3. CAPA 2 — Moat de Utilidad Accionable (los dolores reales del inmigrante)

> **Por qué es moat:** genera **contenido propietario hiperlocal** (cómo sacar la licencia en *este* estado, qué banco acepta ITIN en *esta* ciudad) que Google no tiene indexado bien y que mejora con cada usuario. Es el "para qué vuelvo todos los días" más allá del scroll social.

### 3.1 "Cómo hacer X siendo latino aquí" — Guías vivas hiperlocales asistidas por IA
El buscador de Google para "cómo saco licencia de conducir sin SSN en New Jersey" devuelve basura, foros de 2015 y estafas. **Diferenciador:** una base de conocimiento **por país-de-destino × ciudad × estado**, curada + generada + validada por la comunidad, servida por un asistente conversacional.

- **Temas núcleo (los que de verdad duelen):** licencia de conducir (con/sin SSN), abrir cuenta bancaria con ITIN/pasaporte, sacar el ITIN, taxes siendo indocumentado/con ITIN, inscribir hijos en la escuela, acceso a salud/clínicas comunitarias sin seguro, derechos ante ICE ("conoce tus derechos"), alquilar sin historial crediticio, convalidar título profesional, mandar a los hijos a la universidad (in-state tuition, DACA).
- **IA:** RAG sobre la base (pgvector) + Gemini 2.5 Flash. Respuestas **siempre citando la fuente oficial** y con disclaimer. Se actualiza con contribuciones de la comunidad (moderadas) y cambios de política (ej. el 1% remittance tax de 2025).
- **Impacto 5 · Esfuerzo 3 · Moat FUERTE (contenido propietario que compone con el tiempo) · Producto completo: Sí (empezar con top 15 temas × top 5 ciudades).**
- **Feasibility:** tabla `guides` + chunks embebidos en pgvector; RAG en Edge Function; el contenido semilla se genera con IA + revisión humana (barato de arrancar). **SEO gigante gratis** (estas páginas rankean y traen tráfico orgánico — sinergia con la estrategia SEO de Manuel).

### 3.2 Asistente de Trámites Migratorios — el copiloto, NO el abogado
El más sensible y el más valioso. **Un agente que guía paso a paso** por procesos migratorios/administrativos, con un límite legal claro y explícito.

- **Qué SÍ hace (verificado como seguro/legal):** explica qué es cada formulario (I-130, I-485, I-765, TPS, asilo, DACA renewal) en español simple; genera un **checklist personalizado** ("necesitás: pasaporte, 2 fotos, comprobante de domicilio, $X de fee"); recuerda **deadlines** (fecha de corte de TPS, renovación de work permit); **pre-llena datos** extrayendo de documentos con OCR (Google Vision/Filevine-style); traduce cartas de USCIS del inglés legal a español claro; explica qué significa una notificación de USCIS.
- **Qué NO hace (línea roja legal — verificado):** **no da asesoría legal** (eso es *unauthorized practice of law*, delito en EE.UU.). Nunca dice "deberías pedir asilo" o "vas a ganar tu caso". Ante decisiones legales, **conecta con un abogado verificado del directorio** (sinergia con 2.2). Disclaimer permanente: *"Esto es información general, no asesoría legal. Para tu caso, consultá un abogado licenciado."*
- **Impacto 5 · Esfuerzo 4 · Moat FUERTE · Producto completo: Fase 2 del núcleo** (arrancar con 3.1 guías + checklist estático; el agente conversacional + OCR de formularios es v2 por complejidad y riesgo legal).
- **Feasibility:** RAG + agente con herramientas (checklist generator, deadline scheduler → notificaciones, OCR extractor). Modelo: Haiku 4.5 o Gemini 2.5 Flash con prompt de seguridad estricto (constitutional/guardrails). **Requiere legal review y term sheet de responsabilidad.** Guardrail crítico: filtro que detecta "pedido de asesoría legal" y responde con derivación, no con opinión.

### 3.3 Remesas Transparentes — comparador + educación (SIN ser money transmitter al inicio)
Verificado: la remesa promedio cuesta **6.5%** en fees; **67% de latinos** no sabe que el markup del tipo de cambio es un fee oculto; en 2025 se sumó un **impuesto del 1%** a remesas en efectivo. Aquí hay rabia y dinero.

- **Fase 1 — Comparador de remesas (bajo riesgo, alto valor):** el usuario dice "mando $300 a Colombia", y la app compara **costo real total** (fee + markup de FX + el nuevo 1% tax) entre Remitly, Wise, Western Union, Xoom, etc., vía sus APIs/tarifas. Muestra el **markup oculto** en dólares reales. Educación: "estás perdiendo $18 en esta transferencia". Monetización: afiliados/referidos. **Moat de confianza:** somos el lado del usuario, no del proveedor.
- **Fase 2 — Rieles propios stablecoin (moonshot-adjacent):** verificado que Stripe soporta payouts en **USDC**, que transferencias stablecoin cuestan **centavos vs 6.5%**, y que Stripe lanza su blockchain (Tempo) con Nubank/Visa en 2026. Integrar remesas nativas de bajo costo. **Enorme regulatoriamente** (licencias money transmitter estado por estado, KYC/AML, FinCEN). Solo con partner regulado (Bridge/Stripe stablecoin, o BaaS).
- **Impacto 5 · Esfuerzo: Fase1=2, Fase2=5 · Moat: Fase1 Medio, Fase2 FUERTE · Producto completo: Fase 1 Sí, Fase 2 Moonshot.**
- **Feasibility Fase 1:** llamadas a APIs de proveedores o tabla de tarifas + cálculo; cero riesgo regulatorio (solo información/afiliación). **Feasibility Fase 2:** requiere entidad regulada o partner; NO hacer solos.

### 3.4 Calendario Cultural Vivo — festividades, cívico-migratorio y "morriña"
Un calendario **por país** que mezcla lo cultural y lo útil-cívico.

- Fiestas patrias, día de la independencia de cada país, Día de Muertos, Las Posadas, Carnaval, santos patronos regionales · **fechas útiles del inmigrante**: deadlines de TPS por país, temporada de taxes, inscripciones escolares, fechas de renovación de documentos · eventos de la comunidad local (sinergia con módulo Eventos).
- **IA:** genera y localiza el calendario por tenant; sugiere al feed contenido cultural relevante ("Mañana es el Grito — estos 5 eventos mexicanos cerca de ti").
- **Impacto 3 · Esfuerzo 2 · Moat Medio (difícil de hacer bien y con cariño, fácil de subestimar) · Producto completo: Sí (barato, alto valor emocional/retención).**

### 3.5 Puente con el País de Origen — homeland feed + "clubes de oriundos digitales"
Verificado: las **Hometown Associations (clubes de oriundos)** son estructuras reales y queridas, pero solo ~9% de los que mandan remesas pertenece a una, y su **mayor desafío es enganchar a la segunda generación**. Digitalizarlo es un hueco enorme.

- **Homeland feed:** noticias curadas del país/región de origen (por API de medios locales + resumen IA), en el idioma y con el sesgo local. "Qué pasa en tu pueblo."
- **Clubes de oriundos digitales:** grupos hiper-específicos por pueblo/municipio (no solo por país). "Gente de Salcedo (RD) en Nueva York." Coordinan ayuda mutua, envío colectivo de fondos a proyectos del pueblo (escuela, iglesia), y reconectan familias. **La segunda generación entra porque es digital-native y social, no una reunión de salón.**
- **Impacto 4 · Esfuerzo 3 · Moat FUERTE (nadie sirve el nivel "pueblo"; es profundamente emocional y pegajoso) · Producto completo: Sí (empezar con grupos por región + homeland feed; la coordinación de fondos colectivos es Fase 2).**
- **Feasibility:** los grupos ya existen en el plan; agregar taxonomía geográfica de origen (país→estado→municipio) y matching por origen. News feed: agregador + resumen IA. Fondos colectivos: Stripe Connect (Fase 2, con cuidado regulatorio).

---

## 4. CAPA 3 — IA como Producto (no como moderación)

> **Por qué es moat:** la IA opera sobre **datos privados por tenant** (el pulso de la comunidad colombiana en Queens) que ningún ChatGPT genérico posee. El moat no es "usamos GPT" — es "GPT + nuestros datos comunitarios exclusivos".

### 4.1 Asistente Comunitario Conversacional ("Pregúntale a la comunidad") — el hero feature de IA
El feature que la gente va a *contarle a sus amigos*. Un asistente al que le preguntás **cualquier cosa sobre vivir en tu ciudad siendo latino** y responde con el conocimiento de la comunidad + guías + directorio.

- *"¿Dónde compro harina PAN cerca de Jackson Heights?"* → responde con negocios del directorio (RAG sobre datos del tenant).
- *"¿Qué dentista latino barato recomiendan en Miami?"* → profesionales verificados + reviews.
- *"¿Cómo inscribo a mi hijo en la escuela sin papeles?"* → guía 3.1 + derivación.
- *"¿Hay algún evento dominicano este finde?"* → módulo Eventos.
- **Es el pegamento que unifica todos los módulos** detrás de una interfaz conversacional en español natural. Convierte una app de 12 módulos en "preguntá y ya".
- **Impacto 5 · Esfuerzo 3 · Moat FUERTE (RAG sobre datos propietarios del tenant) · Producto completo: Sí (el diferenciador de IA #1).**
- **Feasibility:** RAG multi-fuente sobre las tablas del tenant (negocios, profesionales, eventos, guías, grupos) embebidas en pgvector; router a Gemini 2.5 Flash; **cache semántico** (las mismas preguntas se repiten → costo real bajísimo). Respeta RLS: solo ve datos del tenant del usuario. Entra por chat y por barra de búsqueda universal.

### 4.2 Matching Inteligente (roommate / trabajo / servicios / gente de tu pueblo)
Matching semántico con pgvector en vez de filtros rígidos. El plan tiene directorios; el diferenciador es **conectar personas por compatibilidad real**.

- **Roommate:** embeddings de preferencias (horarios, limpieza, mascotas, presupuesto, país de origen, idioma) → match por similitud + Trust Score. "Buscamos roommate ordenada, no fumadora, dominicana, cerca del tren 7."
- **Trabajo:** matching de ofertas ↔ perfiles (habilidades, disponibilidad, ubicación, idioma, estatus de autorización si aplica). Enorme para el mercado laboral latino informal/semi-formal.
- **Servicios:** "necesito un plomero que hable español en el Bronx hoy" → ranking por proximidad + Trust Score + reviews.
- **Gente de tu pueblo/región:** matching por origen (sinergia 3.5).
- **Impacto 5 · Esfuerzo 3 · Moat FUERTE (mejora con cada usuario; datos + red) · Producto completo: Sí (roommate + servicios primero; trabajo Fase 2).**
- **Feasibility:** pgvector HNSW cosine; embeddings de perfiles/necesidades; función `match_candidates()` con filtros híbridos (vector + geo + trust). Patrón estándar y barato.

### 4.3 Feed personalizado por IA (recomendaciones), con control del usuario
En vez del feed cronológico/pago-primero del plan, un **feed con relevancia** que aprende qué le importa a cada usuario (temas, negocios, zonas, país de origen), **sin volverse un pozo de dopamina** — transparente y con control ("ver menos de esto").

- **Impacto 4 · Esfuerzo 3 · Moat Medio (todos hacen recos; el moat es el contexto latino/inmigrante) · Producto completo: Fase 2** (arrancar con feed por reglas + geo; ML ranking después, cuando haya datos de engagement).
- **Feasibility:** embeddings de contenido + perfil de intereses; ranking híbrido (recencia + afinidad vector + señales de negocio pagas). Cuidar no canibalizar el feed pago (monetización).

### 4.4 Resúmenes de Comunidad ("El resumen de tu barrio")
Digest generado por IA: *"Esta semana en dominicanos-NY: 3 apartamentos nuevos en Washington Heights, un evento de bachata el sábado, alerta de una estafa de renta reportada, y un plomero muy recomendado."* Por push/email semanal. **Killer para retención** (razón para volver) y para reactivar dormidos.

- **Impacto 4 · Esfuerzo 2 · Moat Medio · Producto completo: Sí (barato, altísimo ROI de retención).**
- **Feasibility:** cron (Vercel Cron / pg_cron) → Edge Function que resume la actividad del tenant/zona con Gemini Flash → Resend (email) / push. Sinergia con el escudo anti-estafa (incluye alertas).

### 4.5 Traducción Contextual ES↔EN (texto y voz)
No "Google Translate pegado" sino **traducción consciente del contexto inmigrante**: traduce una carta de USCIS, un contrato de renta, un mensaje del landlord, con glosario de términos legales/migratorios y explicación.

- **Texto:** cualquier contenido de la app + documentos subidos (OCR + traducción + "explicámelo simple").
- **Voz (moonshot-adjacent, ver 6.2):** traducción de voz en vivo para hablar con el landlord/doctor/empleador que no habla español. Verificado: Gemini Live ~$0.037/min hace esto económicamente viable.
- **Impacto 4 · Esfuerzo: texto 2, voz 4 · Moat: texto Débil, voz Medio · Producto completo: texto Sí, voz Fase 2/Moonshot.**

### 4.6 Copiloto de Negocios Chicos — "IA que hace marketing por el negocio de la esquina"
El dueño de la lonchería no sabe hacer marketing. **Diferenciador de monetización + retención B2B:** una suite de IA que le hace el trabajo.

- **Generación de listings/anuncios:** subís 3 fotos del plato → IA escribe la descripción, título, tags, y genera 3 variantes de anuncio (sinergia con módulo Publicidad + Boost). Copy en español que vende.
- **Auto-respuestas y reviews:** sugiere respuestas a reviews, mensajes de clientes, horarios.
- **Marketing coach:** *"Es viernes, poné una promo de fin de semana; tus clientes están más activos a las 6pm; probá un Boost de $10 en 3 ciudades."* Vincula al sistema de ads existente.
- **Contenido social:** genera posts para historias/feed del negocio.
- **Impacto 5 (vende suscripciones + Boost) · Esfuerzo 3 · Moat Medio-FUERTE (el negocio se vuelve dependiente = retención B2B alta) · Producto completo: Sí (motor de ingresos + diferenciador real).**
- **Feasibility:** generación con Gemini Flash / Haiku (calidad de copy); Vision para leer las fotos del plato/producto; templates estructurados. **Impacto directo en revenue** (más listings pagos, más Boost, menos churn de negocios).

---

## 5. Tabla maestra de priorización

| # | Feature | Capa | Impacto | Esfuerzo | Moat | ¿Producto completo? |
|---|---|---|---|---|---|---|
| 2.2 | **Escudo Anti-Estafa + verificador notario/abogado** | Confianza | 5 | 3 | **FUERTE** | **Sí — fundacional** |
| 4.1 | **Asistente Comunitario Conversacional** | IA | 5 | 3 | **FUERTE** | **Sí — hero de IA** |
| 2.1 | **Trust Score 2.0 (multi-señal + explicable)** | Confianza | 5 | 3 | **FUERTE** | **Sí** |
| 3.1 | **Guías "Cómo hacer X siendo latino aquí"** | Utilidad | 5 | 3 | **FUERTE** | **Sí** |
| 4.2 | **Matching Inteligente (roommate/servicios/trabajo)** | IA | 5 | 3 | **FUERTE** | **Sí** |
| 4.6 | **Copiloto de Negocios Chicos** | IA | 5 | 3 | Medio-FUERTE | **Sí — revenue** |
| 3.3→ | Homeland feed + clubes de oriundos digitales | Utilidad | 4 | 3 | **FUERTE** | Sí (fondos colectivos F2) |
| 4.4 | Resúmenes de Comunidad (digest IA) | IA | 4 | 2 | Medio | **Sí — retención** |
| 3.3 | Remesas Transparentes (comparador) | Utilidad | 5 | 2 | Medio | **Sí (Fase 1)** |
| 3.4 | Calendario Cultural Vivo | Utilidad | 3 | 2 | Medio | **Sí** |
| 4.5 | Traducción contextual (texto) | IA | 4 | 2 | Débil | **Sí** |
| 3.2 | Asistente de Trámites Migratorios | Utilidad | 5 | 4 | **FUERTE** | Fase 2 (riesgo legal) |
| 2.3 | Escrow de Confianza P2P | Confianza | 4 | 3 | Medio | Fase 2 |
| 4.3 | Feed personalizado por IA | IA | 4 | 3 | Medio | Fase 2 |
| 4.5 | Traducción de VOZ en vivo | IA | 4 | 4 | Medio | Fase 2 / Moonshot |
| 3.3 | Remesas rieles propios (stablecoin) | Utilidad | 5 | 5 | **FUERTE** | Moonshot |

---

## 6. Moonshots — lo que podría volverlo icónico

### 6.1 "La Red de Confianza que te sigue a donde vayas" — reputación portable del inmigrante
El activo más valioso y escaso del inmigrante nuevo es **no tener historial** (crediticio, de reputación, de referencias). Convertir el Trust Score en un **pasaporte de reputación portable**: verificado por la comunidad, respaldado por transacciones reales, que el usuario puede **presentar a landlords, empleadores y prestamistas** ("mira, 2 años, 30 transacciones limpias, verificado por documento y por 10 vecinos"). Con el tiempo, alianzas para que este score **desbloquee acceso real**: alquilar sin co-signer, micro-préstamos comunitarios, empleo.
- **Por qué icónico:** resuelve el problema estructural del inmigrante (invisibilidad al sistema) y crea un moat de datos casi imposible de replicar. La reputación vive en *nuestra* red.
- **Riesgo/complejidad:** alto (regulación crediticia FCRA si toca lending, privacidad, portabilidad). Empezar como "carta de reputación" presentable, no como buró de crédito.

### 6.2 Intérprete de Bolsillo en vivo — "nunca más una barrera de idioma"
Traducción de voz bidireccional en tiempo real (ES↔EN) para los momentos de alto estrés del inmigrante: hablar con el doctor, el landlord, el policía, el maestro de tu hijo, en la corte. Verificado factible: Gemini Live <700ms y ~$0.037/min. Modo "conversación cara a cara" y modo "llamada".
- **Por qué icónico:** ataca el miedo #1 cotidiano (no entender / no hacerse entender) en los momentos que más importan. Es utilidad pura que la gente lleva en el bolsillo y le cuenta a todos.
- **Complejidad:** media-alta (UX de voz, latencia, privacidad de conversaciones sensibles). Costo controlable con límites por plan.

### 6.3 Remesas nativas de bajo costo (rieles stablecoin) — "manda a casa sin que te roben en fees"
El más ambicioso y el más transformador. Remesas a centavos vs 6.5%, aprovechando USDC/Stripe/Tempo (verificado 2026). Si funciona, es **la razón por la que 68M de personas instalan la app**: le devuelve dinero real a la familia cada mes.
- **Por qué icónico:** convierte una red social en infraestructura financiera de la diáspora. Pegajosidad y misión en una.
- **Complejidad:** máxima (money transmitter licenses estado por estado, KYC/AML, FinCEN, partner regulado obligatorio). **No hacer solos** — requiere BaaS/partner (Bridge, Stripe stablecoin) y capital regulatorio. Es un negocio dentro del negocio.

---

## 7. Recomendación de secuencia (qué construir y en qué orden)

**Bloque 1 — El moat mínimo viable (entra al "producto completo"):** estos cuatro convierten el clon-de-Sngine en "la app que protege y ayuda al inmigrante latino":
1. **Escudo Anti-Estafa + verificador notario/abogado (2.2)** — el "¿por qué no Facebook?".
2. **Asistente Comunitario Conversacional (4.1)** — el hero de IA, unifica todos los módulos.
3. **Trust Score 2.0 (2.1)** — la moneda de confianza de toda la red.
4. **Guías "Cómo hacer X" (3.1)** — utilidad + SEO orgánico.

**Bloque 2 — Amplificar valor y revenue:** Matching Inteligente (4.2), Copiloto de Negocios (4.6), Remesas comparador (3.3 F1), Resúmenes de Comunidad (4.4), Calendario Cultural (3.4), Homeland/clubes de oriundos (3.5), Traducción texto (4.5).

**Bloque 3 — Profundidad y defensa:** Asistente de Trámites (3.2), Escrow P2P (2.3), Feed IA (4.3).

**Moonshots (apuestas de identidad):** Reputación portable (6.1), Intérprete en vivo (6.2), Remesas stablecoin (6.3).

**Arquitectura transversal a construir una vez, usar en todo:**
- `ai-router` Edge Function (selección de modelo por costo/tarea) + **cache semántico en pgvector**.
- Pipeline de **embeddings automáticos** (trigger → pgmq → Edge Function) para todo contenido (negocios, profesionales, eventos, guías, perfiles).
- **Guardrails de seguridad** reusables (filtro de "asesoría legal", disclaimers, PII redaction) — crítico para trámites y confianza.
- Todo respetando **RLS por tenant** (la IA de cada comunidad solo ve sus datos → aislamiento + moat de datos).

---

## 8. Riesgos y líneas rojas (para no meter la pata)

- **Legal/UPL (trámites):** jamás dar asesoría legal. Info + prep + derivación a abogado verificado. Disclaimers permanentes. Legal review obligatorio.
- **Regulatorio (remesas/escrow):** no ser money transmitter sin licencia/partner. Fase 1 solo comparador/afiliación. Escrow con partner y encuadre legal correcto.
- **Responsabilidad del anti-estafa:** el verificador y la lista negra deben tener proceso de apelación/moderación (evitar difamación / falsos positivos). Reportes verificados, no rumores.
- **Costo IA fuera de control:** router + cache + límites por plan. Monitorear costo/tenant (observabilidad desde día 1).
- **Privacidad de datos sensibles:** conversaciones de trámites, documentos, voz. Cifrado, retención mínima, RLS estricto, no entrenar modelos con datos de usuarios.
- **Confianza mal calibrada:** un Trust Score que se pueda gamear destruye el moat. Diseñar señales resistentes a manipulación (verificación de documento pesa más que endorsements auto-generados).

---

### Fuentes clave (verificadas, jul 2026)
- Costos LLM 2026: intuitionlabs.ai, benchlm.ai, tldl.io, tokenmix/tokencost (voz).
- Notario fraude / anti-estafa: City Limits (NYC), ABA, USCIS "Common Scams", NYC Council (ley jun-2025).
- Remesas / underbanked: Pew Research, Inter-American Dialogue (2025-2026), UnidosUS (67% FX markup), FAIR (1% tax 2025).
- Inmigración + IA / UPL: CLINIC, DHS/USCIS AI use cases, Docketwise, Filevine (OCR form-fill).
- pgvector/Supabase: Supabase Docs (AI & Vectors, automatic embeddings, semantic search).
- Stripe/stablecoin remesas: Stripe Docs (cross-border payouts, stablecoin), PYMNTS (Tempo 2026).
- Voz en vivo: Google Research (speech-to-speech <700ms), Gemini Live pricing.
- Homeland / HTAs: Migration Policy Institute, The Conversation, IADB.

# 11 — Legal, Compliance y Riesgo Legal: Comunidad Latina / NYLabel

**Fecha de investigación:** Julio 2026
**Cliente:** Geovanny
**Contexto:** Plataforma social white-label multi-tenant para diáspora latina (EE.UU. + Europa). Marca registrada "Comunidad Latina" vence si no hay prueba de uso antes de **octubre 2026**. Demanda legal en curso contra el proveedor anterior — cliente en modo de alta sensibilidad al riesgo legal.

> **DISCLAIMER OBLIGATORIO:** Este documento es una plantilla/mapa de riesgos con fines informativos, elaborado a partir de investigación pública (2026). **No constituye asesoría legal.** Es un input para priorizar conversaciones con un abogado de marcas (trademark) y un abogado de privacidad/tech con licencia en las jurisdicciones relevantes (EE.UU. federal + estados donde operan los dominios, y UE si hay tenants europeos). Dado que hay una demanda activa contra el proveedor anterior, cualquier decisión de arquitectura o de comunicación pública debería pasar primero por el abogado litigante de Geovanny.

---

## RESUMEN DE PRIORIDAD (orden de ataque)

| # | Tema | Urgencia | Ventana |
|---|---|---|---|
| 1 | Marca "Comunidad Latina" — prueba de uso | 🔴 CRÍTICA | Antes de **octubre 2026** |
| 2 | CSAM/NCMEC — reporte obligatorio | 🔴 CRÍTICA (día 1 de lanzamiento) | Debe existir desde el primer post con imagen/video |
| 3 | Datos sensibles / estatus migratorio — privacy-by-design | 🔴 CRÍTICA | Debe estar en el schema de DB desde el diseño, no parcheado después |
| 4 | Sección 230 + ToS + moderación mínima | 🟠 ALTA | Antes de abrir registro público |
| 5 | Stripe Connect / KYC / 1099 | 🟠 ALTA | Antes de procesar el primer pago |
| 6 | GDPR (si hay tenant europeo) | 🟠 ALTA (solo si aplica) | Antes de lanzar dominio .eu o con usuarios UE |
| 7 | CCPA/CPRA | 🟡 MEDIA (probable exención por tamaño, revisar al crecer) | Monitorear umbral de usuarios |
| 8 | Multi-tenant ToS / reparto de responsabilidad Global-Domain Admin | 🟡 MEDIA | Antes de otorgar el primer Domain Admin externo |
| 9 | DSA europeo | 🟢 BAJA al inicio (exención micro/pequeña empresa) | Reevaluar si crece en UE |

---

## 1. MARCA "COMUNIDAD LATINA" — URGENTE (vence octubre 2026)

### 1.1 Qué es realmente el riesgo

Dos mecanismos legales distintos pueden matar la marca, y es importante no confundirlos porque cambian la estrategia:

**A) Declaración de Sección 8 (mantenimiento de registro).** Si el registro ya tiene 5+ años, USPTO exige una Declaración de Uso Continuo (Section 8) entre el 5º y 6º aniversario (con período de gracia de 6 meses adicionales pagando fee extra). Si no se presenta con especímenes válidos, **la cancelación es automática** — no hace falta que nadie la impugne.

**B) Abandono por no-uso (impugnable por terceros).** Independiente de cuándo vence el registro, cualquier tercero puede iniciar un procedimiento de cancelación ante el TTAB alegando abandono. La ley (15 U.S.C. § 1127) establece que **3 años consecutivos de no-uso es "prima facie evidence" de abandono** — es decir, se presume abandonada la marca y **la carga de la prueba se invierte**: Geovanny tendría que demostrar (i) uso real durante esos 3 años, (ii) causa excusable de no-uso, o (iii) que formuló intención concreta de reanudar el uso y adoptó un plan para implementarlo.

**Acción inmediata:** Confirmar con el abogado de marcas **cuál de los dos escenarios aplica** (¿la fecha de octubre 2026 es un deadline de Section 8, o es simplemente cuándo se cumplen los 3 años de no-uso desde el último uso documentado del proveedor anterior?). Esto determina si octubre es un vencimiento administrativo duro o un umbral de riesgo de impugnación. **No asumir — verificar con el número de registro/serial en TESS (uspto.gov/trademarks) esta misma semana.**

### 1.2 Qué constituye "specimen" aceptable

Un specimen es evidencia real de uso en el mercado — **no un mockup, no un diseño, no un borrador de sitio**. Para servicios (que es el caso — "servicios de red social / comunidad online"), USPTO acepta:

- **Screenshot del sitio web en vivo** mostrando la marca, siempre que:
  - Muestre la URL y la fecha de acceso/impresión.
  - La marca aparezca funcionando *como identificador de origen* del servicio (no solo mencionada de paso).
  - Sea el mismo mark exacto que aparece en el drawing del registro.
- Publicidad, folletos o material promocional que muestre la marca asociada al servicio.
- Debe ser **uso genuino del propio Geovanny/su empresa**, no de terceros (ej. no sirve un artículo de prensa que solo menciona el nombre).

### 1.3 El mínimo real necesario (para condicionar el lanzamiento)

Dado que S&Gine.com es el placeholder actual, el mínimo defendible antes de octubre 2026 es:

1. **Sitio vivo con la marca "Comunidad Latina" visible y funcionando como servicio** (no landing estática — tiene que ofrecer el servicio, aunque sea en versión reducida). El dominio `comunidadlatina.com` listado en el MVP debería ser el que lleve la marca, no un dominio de país.
2. **Capturas de pantalla fechadas y con URL visible**, tomadas y archivadas *antes* de la fecha límite, mostrando:
   - Header/logo con "Comunidad Latina".
   - El servicio en funcionamiento (feed, perfiles, alguna transacción).
3. **Uso transaccional real, aunque sea mínimo**: al menos un puñado de usuarios reales registrados, idealmente alguna membresía o transacción procesada bajo el nombre "Comunidad Latina" — esto es la diferencia entre un specimen fácilmente impugnable ("mock up") y evidencia de "bona fide use in the ordinary course of trade."
4. **Guardar todo con timestamp verificable**: exportar HTML, PDF con fecha, logs de servidor con fecha de acceso, registros de Stripe con fecha de la primera transacción bajo ese nombre. Esta evidencia es la que sostiene el argumento de "intención de reanudar + plan de implementación" si hubo un gap de uso previo.

### 1.4 Riesgo de la estrategia MVP multi-dominio

El plan maestro prioriza lanzar primero *colombianos.com*, *mexicanos.com*, etc., y deja `comunidadlatina.com` como uno más de ocho dominios. **Esto es un riesgo directo para la marca**: si ninguno de esos dominios usa el string "Comunidad Latina" de forma prominente, no sirven como specimen. Recomendación táctica:

- Adelantar `comunidadlatina.com` (o un subdominio tipo `www.comunidadlatina.com` redirigiendo al hub) en el cronograma para que esté *vivo* mucho antes de las 10 semanas completas — no hace falta el producto completo, pero sí un servicio real y funcional bajo ese nombre exacto.
- Asegurar que el nombre de marca aparezca en el propio producto (footer, ToS, splash, emails transaccionales "Comunidad Latina <no-reply@comunidadlatina.com>"), no solo en el dominio.

### 1.5 Checklist accionable — Marca

- [ ] Confirmar con abogado de marcas el número de serial/registro y estado exacto en TESS/TSDR (uspto.gov).
- [ ] Determinar si octubre 2026 es deadline de Section 8 o umbral de 3 años de abandono presunto.
- [ ] Adelantar el lanzamiento de una versión mínima viable de `comunidadlatina.com` con la marca visible y funcional — antes que los dominios de países.
- [ ] Capturar specimens (screenshots con URL + fecha) desde el primer día de uso real, archivarlos en carpeta legal con timestamp.
- [ ] Procesar al menos una transacción real bajo el nombre "Comunidad Latina" antes de la fecha límite (membresía, boost, lo que sea) y conservar el recibo/registro de Stripe.
- [ ] Si el abogado determina que ya hubo un gap de no-uso, preparar documentación de "intent to resume use" (este mismo proyecto, con fechas de inicio de desarrollo, contratos, etc., sirve como evidencia).
- [ ] Evaluar si conviene presentar una nueva solicitud de marca (nueva aplicación) como respaldo, en paralelo, en caso de que el registro actual no sea salvable — consultar costo/beneficio con el abogado.

---

## 2. MODERACIÓN DE CONTENIDO

### 2.1 CSAM / NCMEC — la obligación más urgente y no-negociable

Esto **no es opcional ni escalable después** — debe existir desde el primer post con foto/video. Bajo 18 U.S.C. § 2258A (reforzado por la **REPORT Act de 2024**):

- Obligación de reportar a NCMEC CyberTipline "tan pronto como sea razonablemente posible" al tener conocimiento real de CSAM, intento de seducción de menores (online enticement), o trata de personas de menores.
- El REPORT Act 2024 **amplió** los delitos reportables y **extendió la retención de evidencia de 90 días a al menos 1 año** (con estándares NIST de ciberseguridad para el almacenamiento).
- Aplica a cualquier "electronic service provider" — no hay excepción de tamaño de empresa.

**Implicación de diseño concreta:** el pipeline de moderación de fotos/video (Google Vision API mencionado en el plan) debe tener un canal de escalamiento automático a NCMEC, no solo "flag y banear usuario". Se necesita: (a) hash-matching contra bases conocidas de CSAM (PhotoDNA/similar) en el momento del upload, antes de publicar; (b) proceso de retención de la evidencia por 1 año mínimo con seguridad NIST; (c) un playbook legal de quién en el equipo de Geovanny recibe y ejecuta el reporte.

### 2.2 Sección 230 (EE.UU.) — protección, no exención total

Section 230(c)(1) protege a la plataforma de ser tratada como "publisher" del contenido de terceros — esto es lo que permite operar una red social sin responder por cada post de usuario. Pero:

- **No cubre**: contenido que la plataforma co-crea o modifica sustancialmente (ej. si un moderador edita un post y lo deja "mejorado", ya no es puramente de terceros).
- **Excepciones explícitas**: ley penal federal, propiedad intelectual (DMCA opera aparte), ECPA, y desde **FOSTA-SESTA (2018)** — trata de personas/sex trafficking. Un marketplace con anuncios de "servicios" mal moderado es la zona de mayor riesgo histórico de FOSTA.
- **Difamación**: NO es una excepción explícita — sigue cubierta por 230(c)(1), lo cual es una razón más para no editar/curar contenido de forma que la plataforma "adopte" el mensaje.
- **Contexto 2026 — inestabilidad regulatoria activa**: hay múltiples proyectos de reforma en curso (SAFE TECH Act, KOSA/COPPA 2.0 fusionados en el KIDS Act que pasó la Cámara el 29 de junio 2026). La tendencia es hacia *más* responsabilidad para plataformas en temas de menores y algoritmos de recomendación (ver *Anderson v. TikTok*, 3er Circuito, sobre responsabilidad por recomendaciones algorítmicas). **Recomendación: diseñar la moderación asumiendo un estándar más alto del que exige 230 hoy, porque el terreno se está moviendo hacia mayor responsabilidad, no menos.**

### 2.3 DSA — Digital Services Act (solo si hay tenants europeos)

El plan menciona "Europa" en el objetivo pero el MVP de 8 dominios es todo EE.UU./LatAm (.com/.net). Si en efecto se lanza un dominio dirigido a audiencia europea:

- El DSA usa un enfoque **escalonado por tamaño**: obligaciones básicas para todos, mejoradas para "online platforms", y las más estrictas solo para VLOPs (45M+ usuarios activos mensuales en la UE) — Comunidad Latina estaría muy lejos de ese umbral al inicio.
- Aun como plataforma pequeña, se exige: mecanismo para que usuarios reporten contenido ilegal, y **"statement of reasons"** claro y específico cada vez que se elimina contenido o se restringe una cuenta (esto es más estricto que la práctica típica de EE.UU. de solo banear sin explicación).
- Micro/pequeñas empresas están **exentas de transparency reports públicos**, pero no de las obligaciones básicas de moderación y de dar explicación al usuario.

**Acción concreta:** el sistema de moderación (3 niveles, mencionado en el PRD) debería generar automáticamente una notificación al usuario con motivo específico de cualquier acción de moderación — esto sirve tanto para DSA como para buenas prácticas de debido proceso interno, y es mucho más barato de construir ahora (en el schema/flujo) que parchear después.

### 2.4 Hate speech y difamación — obligaciones mínimas

No hay una ley federal única de EE.UU. contra "hate speech" en general (protegido por la Primera Enmienda salvo incitación directa a violencia inminente), pero:

- ToS debe prohibir explícitamente contenido de odio, acoso, amenazas — esto da base contractual para banear sin depender solo de la ley.
- Difamación es responsabilidad del usuario que publica, protegida la plataforma por 230(c)(1) **mientras no co-cree el contenido**. Mantener logs de "notice and takedown" (aunque no sea obligatorio como DMCA, ayuda a demostrar buena fe si hay litigio).

### Checklist — Moderación

- [ ] Implementar hash-matching de CSAM en el momento del upload (antes de publicar), no solo post-publicación.
- [ ] Definir el flujo legal de reporte a NCMEC CyberTipline y quién lo ejecuta.
- [ ] Retención de evidencia CSAM por mínimo 1 año con estándares de seguridad adecuados (aislado, acceso restringido).
- [ ] ToS con prohibiciones explícitas: CSAM, trata de personas, hate speech, acoso, difamación, contenido ilegal.
- [ ] Sistema de moderación que genere "statement of reasons" específico al usuario en cada acción (ban, eliminación, restricción) — no solo "tu cuenta fue suspendida".
- [ ] Mecanismo de reporte de contenido accesible para todos los usuarios (no solo moderadores).
- [ ] Marketplace de servicios/anuncios con revisión reforzada — zona de mayor riesgo FOSTA-SESTA (anuncios de "servicios" ambiguos).
- [ ] Política de que moderadores NO editen contenido de usuarios (solo eliminar/ocultar) para no perder la protección de "third-party content" de 230.
- [ ] Monitorear evolución regulatoria (KIDS Act, SAFE TECH Act) cada trimestre — el terreno legal de EE.UU. está cambiando activamente en 2026.

---

## 3. PRIVACIDAD — Y LA SENSIBILIDAD CRÍTICA DEL ESTATUS MIGRATORIO

Esta es, junto con la marca, la sección de mayor riesgo reputacional y humano del proyecto. La población objetivo es explícitamente vulnerable.

### 3.1 El riesgo concreto en 2026 (esto no es hipotético)

La investigación confirma que **esto está pasando activamente ahora**:

- DHS ha estado emitiendo **cientos de subpoenas administrativas** a plataformas sociales pidiendo nombres, emails, IPs y teléfonos vinculados a cuentas que discuten operaciones de ICE.
- ICE ha publicado RFPs para contratar monitoreo de redes sociales 24/7 (incluyendo plataformas como Facebook/Instagram/TikTok/Reddit) para convertir posts públicos en "leads" de aplicación de la ley.
- Herramientas usadas por ICE ya recolectan datos que **normalmente requerirían una orden judicial** si se pidieran directamente — lo cual hace que los datos que la plataforma *sí* posee (y podría ser obligada a entregar vía subpoena, un estándar mucho más bajo que un warrant) sean especialmente sensibles.

**Conclusión de diseño: el objetivo no es "cumplir con GDPR/CCPA" en abstracto — es minimizar activamente qué existe en la base de datos que pueda ser útil para una subpoena, y tener un proceso claro para cuando llegue una.**

### 3.2 Privacy-by-design para población inmigrante — principios concretos

1. **No preguntar estatus migratorio, nunca, en ningún formulario.** Ni siquiera como campo opcional. No es necesario para ningún flujo del producto (posts, propiedades, negocios, eventos, marketplace). Si en algún punto "sería útil saber" (ej. verificación de identidad para KYC de Stripe), ese dato lo captura Stripe directamente — nunca debería tocar la base de datos de Comunidad Latina.
2. **Data minimization real, no de checkbox.** Revisar cada campo del schema (Trust Score, perfiles, Q&A, grupos) y preguntar: ¿esto es necesario para el producto o es "nice to have para analytics"? Menos campos = menos superficie de exposición ante una subpoena.
3. **Separación de identidad legal vs. identidad de plataforma.** Los datos de KYC/pago (nombre legal, ID, dirección fiscal) deben vivir en Stripe, no replicados en la base de datos de Supabase de Comunidad Latina. Row Level Security por tenant no protege contra una subpoena — protege contra fugas entre tenants, son problemas distintos.
4. **Nunca usar nombre completo real como default público.** Considerar que el perfil público pueda operar con nombre de usuario/alias por defecto, dejando nombre legal solo donde el flujo lo exige estrictamente (ej. facturación de una membresía).
5. **Geolocalización — cuidado extra.** El feed de Propiedades/Negocios probablemente usa ciudad/zona. Evitar guardar geolocalización de precisión (lat/long exacta) de usuarios individuales sin necesidad clara; usar zonas/ciudades agregadas.
6. **Política de solicitudes de autoridades — definir ANTES de que llegue la primera.** Buenas prácticas del sector (Meta, Microsoft, Google): notificar al usuario antes de entregar sus datos, salvo prohibición legal expresa o riesgo real e inminente a una persona. Esto requiere:
   - Un proceso legal documentado: quién en el equipo recibe subpoenas, qué se verifica (validez, jurisdicción, alcance), a quién se escala.
   - Requerir siempre proceso legal formal (subpoena/warrant/orden judicial) — nunca entregar datos por solicitud informal.
   - Publicar (aunque sea internamente, no necesariamente como transparency report público al inicio) cuántas solicitudes llegaron y cómo se resolvieron — esto también genera trazabilidad legal útil si hay litigio.
7. **Cifrado y control de acceso interno.** Los Domain Admins y Moderadores no deberían tener acceso de lectura directa a campos legales/fiscales sensibles — solo a lo necesario para moderar contenido.
8. **Retención con fecha de expiración.** No guardar logs/IPs/metadata más tiempo del necesario. Definir políticas de retención explícitas (ej. IPs de login por 90 días, no indefinido).

### 3.3 GDPR (si hay tenants con usuarios en la UE)

- El estatus migratorio en sí no está listado expresamente como categoría especial del Artículo 9 (que cubre origen racial/étnico, opiniones políticas, religión, datos de salud, orientación sexual, etc.) — pero el **origen étnico/racial sí está cubierto**, y en la práctica los metadatos de una comunidad étnica-nacional específica (ej. "venezolanos.net") hacen que gran parte del comportamiento en la plataforma sea *inferible* como dato de origen étnico. Tratar los datos de la plataforma con el mismo cuidado que special category data es la postura conservadora correcta.
- Si aplica GDPR: base legal explícita (probablemente consentimiento explícito, Art. 9(2)(a)), DPO si el volumen lo amerita, DPIA (evaluación de impacto) antes de lanzar el módulo de moderación con IA (por ser procesamiento automatizado con impacto en usuarios), y Data Processing Agreement con cada proveedor (Supabase, Cloudflare R2, Twilio, Resend, Google Vision).
- Derechos de usuario (acceso, portabilidad, borrado, rectificación) deben funcionar **cross-tenant si el usuario tiene actividad en más de un dominio** — esto es un requisito técnico, no solo legal, que hay que resolver en el diseño de la base de datos.

### 3.4 CCPA/CPRA (California — alta relevancia por concentración de población latina)

- Regulaciones nuevas ya vigentes desde el 1 de enero de 2026 (ADMT, evaluaciones de riesgo de privacidad, auditorías de ciberseguridad).
- Umbral de aplicabilidad: ingresos anuales >$26.625M, **o** procesar datos de 100,000+ residentes/hogares de California al año, **o** 50%+ de ingresos de venta/compartición de datos personales. **Comunidad Latina probablemente empieza exenta**, pero el segundo umbral (100K usuarios de California) es alcanzable rápido si el producto tiene tracción — monitorear activamente, no asumir exención permanente.
- Si se comparten datos con anunciantes/redes de boost publicitario, la CPRA considera eso "sharing" aunque no haya pago — esto afecta directamente el módulo de "Boost publicitario" del plan de monetización.

### 3.5 COPPA — menores de 13 años

- La plataforma no está "dirigida a niños", pero una red social abierta inevitablemente tendrá intentos de registro de menores. Requiere: verificación de edad en el registro (no solo un checkbox "tengo 18 años"), y política de qué pasa si se detecta "actual knowledge" de que un usuario es menor de 13 (eliminar cuenta y datos, no solo suspender).
- La FTC emitió en **febrero 2026** un policy statement que da un "safe harbor" de facto para usar tecnologías de verificación de edad, siempre que: (a) el dato solo se use para verificar edad, (b) no se retenga más de lo necesario, (c) no se comparta con terceros sin garantías de confidencialidad.
- **COPPA 2.0 / KIDS Act** (en trámite legislativo activo, pasó la Cámara el 29 de junio 2026) ampliaría la protección a 13-16 años y prohibiría publicidad dirigida a menores — vale la pena diseñar el módulo de Boost/Ads con esta ampliación en mente, ya que llegaría antes de que el producto madure.

### Checklist — Privacidad

- [ ] Auditar el schema completo de Supabase: eliminar cualquier campo que capture o infiera estatus migratorio.
- [ ] Definir que datos de KYC/identidad legal viven solo en Stripe, nunca replicados en la DB del producto.
- [ ] Perfiles públicos con alias/username por defecto, no nombre legal.
- [ ] No guardar geolocalización de precisión de usuarios individuales.
- [ ] Redactar y aprobar (con abogado) una "Política de Solicitudes de Autoridades" antes del lanzamiento — con proceso de verificación y notificación al usuario salvo prohibición legal.
- [ ] Restringir acceso de Domain Admins/Moderadores a campos legales/fiscales sensibles vía RLS.
- [ ] Definir políticas de retención de datos con expiración automática (IPs, logs, metadata).
- [ ] Verificación de edad real en onboarding (más allá de checkbox) — preparar terreno para COPPA 2.0/KIDS Act.
- [ ] Si hay tenant europeo: DPIA antes de activar moderación por IA, DPAs firmados con Supabase/Cloudflare/Twilio/Resend/Google, mecanismo de derechos de usuario cross-tenant.
- [ ] Monitorear trimestralmente el conteo de usuarios de California frente al umbral de 100K para CCPA/CPRA.
- [ ] Evaluar si el módulo de "Boost publicitario" comparte datos con redes externas — si sí, tratarlo como "sharing" bajo CPRA y dar opt-out.

---

## 4. PAGOS — Stripe Connect, 1099, KYC/AML, sales tax

### 4.1 Por qué Stripe Connect resuelve el problema de money transmitter

Operar un marketplace que mueve dinero entre usuarios normalmente requeriría que Geovanny obtenga licencias estatales de "money transmitter" (proceso caro y lento, estado por estado). Stripe Connect **absorbe esa carga regulatoria** porque Stripe ya tiene las licencias MTL/MSB necesarias en EE.UU. y equivalentes internacionales — Geovanny opera como plataforma sobre la infraestructura regulada de Stripe, no como transmisor de dinero él mismo. Esto es la razón estructural por la que el modelo de negocio (membresías + comisión de 20% + escrow del Creator Marketplace) es viable sin licencias propias.

**Matiz importante:** esto cubre la transmisión de dinero, **no** exime de otras obligaciones (fiscales, KYC, disputas). Confirmar con Stripe el nivel exacto de integración (Standard/Express/Custom) porque cambia qué responsabilidades quedan en la plataforma vs. en Stripe — Custom traslada más carga operativa (y por tanto más responsabilidad de compliance) a Geovanny.

### 4.2 KYC/AML — responsabilidad compartida, no delegada 100%

- Stripe verifica identidad de las cuentas conectadas, pero **la plataforma sigue obligada a monitorear fraude de forma independiente** — no basta con "Stripe ya lo verificó".
- Si se usa integración vía API (Custom), Geovanny debe recolectar y enviar a Stripe la información KYC de personas/beneficiarios finales (UBO) — hay actualizaciones activas en 2026 (ej. requisitos UK FCA / Banco Central de Irlanda) que pueden requerir ajustes al flujo de onboarding si algún Domain Admin o creador opera desde Europa.
- **Acción:** definir explícitamente qué tipo de integración de Connect se usa (Standard es más simple y traslada más responsabilidad a Stripe; recomendado para MVP dado el perfil de riesgo del cliente).

### 4.3 1099 para creadores — umbral 2026 (cambió recientemente, verificar)

- La ley "One Big Beautiful Bill Act" **revirtió** el umbral bajo de $600 (que iba a entrar en vigencia) y **restauró el umbral histórico de $20,000 y 200 transacciones** para 1099-K.
- Para 1099-MISC/1099-NEC (pagos por servicios, no necesariamente vía tarjeta), el umbral es $600 en general, subiendo a **$2,000 desde el año fiscal 2026** (con ajuste por inflación desde 2027).
- Stripe puede automatizar generación y filing de 1099 para las cuentas conectadas, pero **la responsabilidad de filing depende de quién controla el pricing**: si la plataforma controla precios/fees, Geovanny (no Stripe) es responsable de filear los 1099 correspondientes. Esto hay que resolverlo con el equipo de Stripe antes del lanzamiento del Creator Marketplace — no asumir que "Stripe se encarga de todo".

### 4.4 Sales tax

- No cubierto en profundidad por Stripe Connect en sí — cada estado de EE.UU. tiene sus propias reglas de nexus económico para marketplace facilitators. Dado que hay un marketplace de tiendas y venta de membresías, vale la pena una consulta puntual con un contador especializado en sales tax multi-estado (fuera del alcance de este documento, pero flagged como pendiente).

### Checklist — Pagos

- [ ] Confirmar con Stripe el tipo de integración de Connect (Standard recomendado para reducir carga de compliance en el MVP).
- [ ] Documentar por escrito la división de responsabilidad KYC/AML entre Stripe y Geovanny.
- [ ] Definir política interna de monitoreo de fraude adicional (no depender solo de la verificación de Stripe).
- [ ] Confirmar quién filea los 1099 (Stripe vs. plataforma) según el modelo de pricing del Creator Marketplace y del marketplace de tiendas.
- [ ] Verificar aplicabilidad de sales tax / marketplace facilitator laws por estado con un contador (fuera de alcance legal, pendiente de asignar).
- [ ] Si hay creadores/tiendas en Europa: revisar actualizaciones de verificación KYC para UBO/directores (cambios activos 2026 UK FCA / Banco Central de Irlanda).

---

## 5. MULTI-TENANT LEGAL — ToS, Privacy Policy y reparto de responsabilidad

### 5.1 ¿ToS y Privacy Policy por dominio o globales?

Recomendación: **un solo ToS y Privacy Policy maestro, operado por la entidad legal de Geovanny, aplicado a todos los dominios**, con anexos específicos por dominio solo si hay diferencias reales de jurisdicción (ej. un dominio con audiencia europea necesita cláusulas GDPR que uno solo-EE.UU. no necesita).

Razones:
- Mantener 8+ ToS distintos es una pesadilla de mantenimiento y aumenta el riesgo de inconsistencias legales explotables en litigio.
- La estructura técnica ya es "un motor, N dominios" — el marco legal debería reflejar la misma lógica: un solo controlador de datos (Geovanny/su entidad), N presentaciones de marca.
- Cada dominio SÍ necesita: nombre de marca visible, aviso de qué entidad legal opera el servicio, y el mismo ToS/Privacy Policy enlazado (no reescrito).

### 5.2 Reparto de responsabilidad: Global Admin vs. Domain Admin

Este es el punto de mayor riesgo legal estructural del modelo, y el que más se conecta con el trauma de la demanda anterior — hay que ser explícito y sin ambigüedad contractual:

**Geovanny (Global Super Admin) debe quedar, ante la ley, como el "operador del servicio" y responsable último** frente a usuarios, autoridades y contrapartes (Stripe, hosting, etc.) — porque es quien controla la infraestructura, la base de datos, y tiene acceso técnico total. No se puede "delegar" legalmente la responsabilidad de operador solo dándole a alguien un panel de administración.

**El Domain Admin es, en la práctica legal, más parecido a un franquiciado o gestor de contenido con permisos delegados** que a un "operador" independiente. Su responsabilidad contractual (vía un **Domain Admin Agreement** separado del ToS de usuario final) debería incluir:

- Obligación de moderar activamente el contenido de su dominio según las políticas globales (no puede bajar el estándar de moderación de su comunidad).
- Prohibición expresa de usar su acceso de admin para fines ilegales (recolectar datos de usuarios para venderlos, discriminar, extorsionar, autopromoción fraudulenta, etc.).
- Indemnización: si un Domain Admin actúa fuera de sus permisos y genera responsabilidad legal (ej. él mismo publica contenido difamatorio o discriminatorio usando su posición, o hace mal uso de datos de usuarios de su comunidad), el acuerdo debe estipular que el Domain Admin indemniza a Geovanny/la entidad global por esos daños — esto no elimina el riesgo pero da a Geovanny una vía de recuperación y una defensa clara de "actuaba fuera de sus permisos autorizados" ante terceros.
- Derecho de Geovanny (Global Admin) de suspender o revocar el acceso de un Domain Admin unilateralmente y sin preaviso si detecta uso indebido — esto debe estar en el acuerdo desde el día uno, no negociado caso por caso.
- Los Domain Admins **no deberían tener acceso de exportación masiva de datos de usuarios** de su comunidad sin un log auditable — es la salvaguarda técnica que hace cumplible la cláusula contractual de arriba.

### 5.3 El riesgo concreto: "¿qué pasa si un Domain Admin hace algo ilegal?"

Escenarios a cubrir explícitamente en el Domain Admin Agreement y en el diseño técnico:

1. **Domain Admin discrimina o excluye usuarios por raza/nacionalidad dentro de su propia comunidad** (ej. un admin de "venezolanos.net" bloquea sistemáticamente a usuarios de otro país). Mitigación: políticas globales de no discriminación que ningún Domain Admin puede override, con logs auditables de acciones de moderación por admin.
2. **Domain Admin usa su acceso para extraer y vender datos de usuarios de su comunidad.** Mitigación: RLS + logs de acceso a datos + prohibición contractual expresa + límites técnicos de exportación masiva.
3. **Domain Admin publica o permite contenido ilegal a sabiendas (ej. anuncios de servicios que rozan trata de personas) para maximizar ingresos de su dominio.** Mitigación: la responsabilidad de reporte CSAM/NCMEC y las políticas de moderación de nivel 1-2-3 deben aplicar de forma centralizada (no delegable), con el Domain Admin solo operando dentro de las reglas del sistema, nunca pudiendo desactivar la capa de moderación automática/legal.
4. **Domain Admin abandona su dominio o desaparece** (relevante dado que hubo un proveedor anterior que "no entregó") — el acuerdo debe darle a Geovanny el derecho de reasignar o recuperar el dominio/comunidad sin fricción legal.

### 5.4 Conexión con la demanda legal en curso

Dado que ya existe litigio contra el proveedor anterior por incumplimiento, dos recomendaciones de higiene legal para el proyecto actual (a validar con el abogado litigante de Geovanny, que probablemente ya tiene contexto que este documento no tiene):

- **Documentar por escrito y con fecha cada entregable de este proyecto** (planes, milestones, código entregado) — la misma disciplina que se necesita para el specimen de marca sirve como blindaje contra el riesgo de que este proyecto termine en un conflicto similar.
- **Evitar que cualquier comunicación técnica o de producto haga referencias específicas al caso legal anterior** — mantener el equipo de desarrollo enfocado en el producto, y cualquier pregunta sobre el litigio se redirige al abogado de Geovanny, no se opina desde el equipo técnico.

### Checklist — Multi-tenant legal

- [ ] Redactar un único ToS y Privacy Policy maestro (con anexos por jurisdicción solo donde sea necesario, ej. GDPR para dominio europeo).
- [ ] Redactar un Domain Admin Agreement separado del ToS de usuario final, con: obligaciones de moderación, prohibiciones expresas, cláusula de indemnización, derecho de revocación unilateral de Geovanny, límites técnicos de exportación de datos.
- [ ] Diseñar logs auditables de todas las acciones de Domain Admin (moderación, acceso a datos, exportaciones) — necesario tanto para compliance como para hacer cumplible el acuerdo.
- [ ] Confirmar que la capa de moderación legal (CSAM, políticas globales de no discriminación) no es desactivable por ningún Domain Admin.
- [ ] Definir proceso de recuperación/reasignación de un dominio si su Domain Admin abandona o incumple.
- [ ] Validar con el abogado litigante de Geovanny si hay algún patrón del caso anterior que deba informar específicamente los acuerdos de este proyecto (áreas de conflicto ya conocidas).

---

## RESUMEN EJECUTIVO (para respuesta directa a Geovanny)

1. **La marca es la prioridad número uno y tiene fecha límite real (octubre 2026)** — hay que confirmar YA con un abogado de marcas si octubre es un deadline de Sección 8 (renovación) o el cumplimiento de 3 años de no-uso (umbral de abandono impugnable), porque cambia la estrategia.
2. **El specimen mínimo aceptable ante USPTO es un sitio vivo y funcional bajo el nombre exacto "Comunidad Latina"** con capturas fechadas y con URL — no sirve un mockup ni un dominio de país sin la marca visible.
3. **Recomendación táctica: adelantar `comunidadlatina.com` en el cronograma**, antes que los ocho dominios de países, aunque sea en versión mínima — es la única forma de asegurar el specimen a tiempo.
4. **Procesar al menos una transacción real bajo el nombre "Comunidad Latina" antes de octubre** y archivar el recibo — la diferencia entre specimen fuerte y débil es evidencia de uso transaccional real, no solo un sitio visible.
5. **CSAM/NCMEC es una obligación de día uno, no escalable después** — necesita hash-matching en upload y un playbook de reporte antes de que se suba la primera foto/video, sin excepción de tamaño de empresa.
6. **La sensibilidad de estatus migratorio es el riesgo humano más grave del proyecto** — DHS/ICE ya están emitiendo cientos de subpoenas administrativas a plataformas sociales en 2026 pidiendo identidad de usuarios; el diseño debe minimizar activamente qué dato existe para poder ser solicitado, no solo "cumplir GDPR en abstracto".
7. **Regla de oro de diseño: nunca preguntar ni inferir estatus migratorio en ningún formulario**, perfiles públicos con alias por defecto, datos de KYC/identidad legal viven solo en Stripe (nunca replicados en la base de datos del producto).
8. **Definir una "Política de Solicitudes de Autoridades" antes del lanzamiento** — con requisito de proceso legal formal, notificación al usuario salvo prohibición expresa, y un responsable claro de recibir y evaluar subpoenas.
9. **Sección 230 protege la plataforma de contenido de terceros, pero el terreno se está moviendo hacia más responsabilidad** (reformas activas en el Congreso en 2026, casos como Anderson v. TikTok sobre recomendaciones algorítmicas) — diseñar la moderación con un estándar más alto del mínimo legal actual.
10. **Stripe Connect resuelve el problema de licencia de money transmitter** (Geovanny nunca toca la plata directamente), pero **no exime de responsabilidad de monitoreo de fraude independiente ni de definir quién filea los 1099** — hay que confirmarlo explícitamente con Stripe, no asumirlo.
11. **El umbral de 1099-K volvió a $20,000/200 transacciones** (se revirtió el plan de bajarlo a $600) — reduce la carga administrativa inmediata del Creator Marketplace, pero 1099-NEC/MISC sigue en $600 subiendo a $2,000 en este año fiscal.
12. **GDPR solo aplica si hay tenants con usuarios reales en la UE** — de ser así, requiere DPIA antes de activar la moderación por IA y DPAs firmados con cada proveedor (Supabase, Cloudflare, Twilio, Resend, Google Vision). CCPA/CPRA probablemente exime a Comunidad Latina al inicio por tamaño, pero hay que monitorear el umbral de 100K usuarios de California activamente, dada la alta concentración de población latina ahí.
13. **Un solo ToS/Privacy Policy maestro para todos los dominios**, no uno por país — mantener consistencia legal y reducir superficie de inconsistencias explotables en litigio.
14. **El mayor riesgo estructural del modelo multi-tenant es un Domain Admin actuando mal dentro de su comunidad** (discriminación, venta de datos, contenido ilegal tolerado por ingresos) — se mitiga con un Domain Admin Agreement separado (indemnización, revocación unilateral, prohibiciones expresas) y logs auditables de sus acciones, nunca dándole poder para desactivar la capa de moderación legal central.
15. **Dado el litigio activo contra el proveedor anterior, aplicar la misma disciplina de documentación a este proyecto** (entregables fechados y por escrito) que la que se exige para el specimen de marca — es la mejor protección disponible tanto para la marca como para evitar repetir el patrón de conflicto anterior.

---

*Documento generado a partir de investigación pública de julio 2026. Verificar cada punto crítico (especialmente fechas de marca y estado del registro en TESS/TSDR) con abogado de marcas y abogado de privacidad/tech antes de tomar decisiones de arquitectura o de lanzamiento.*

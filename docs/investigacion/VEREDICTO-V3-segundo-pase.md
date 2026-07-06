# VEREDICTO — Abogado del Diablo, SEGUNDO PASE (sobre el PLAN MAESTRO V3)

**Fecha:** 2026-07-06 · **Método:** 4 fiscales adversariales en paralelo (mercado/wedge/competencia · números/gates/valle · legal/privacidad-ICE/marca · ejecución/pre-mortem/punto ciego), cada uno con investigación web fresca de 2026 y casos reales citados. Más un quinto ángulo — producto/diseño/moat — analizado directamente sobre los informes 09 y 13.

> **Contexto.** El primer pase (`VEREDICTO-abogado-del-diablo.md`) atacó la **V2** y moldeó la **V3**. La V3 corrigió mucho (scope→ruta validada, economía→$235k, moat→determinístico, seguridad→humano en el loop). Este segundo pase ataca las **decisiones nuevas que la V3 introdujo** — para que la V4 no herede sus puntos ciegos. La V3 no se salva de la crítica por haber salido de una crítica: cambió el conjunto de supuestos, no la necesidad de probarlos.

---

## VEREDICTO (sin anestesia)

La V3 corrigió la **contabilidad del pozo** y se olvidó de corregir la **regla que dice cuándo saliste de él**. Arregló el *tamaño* del valle ($235k) pero dejó los **gates de validación calibrados con los números viejos** — miden cosas que no significan viabilidad. Y en el corazón del producto hay una contradicción que la V3 declaró "resuelta" y no lo está: **la arquitectura misma —agregar población deportable, segmentada por nacionalidad, en un lugar identificable— es un honeypot para ICE que ninguna decisión de schema elimina.** Sacar la verificación de la base de datos es teatro de privacidad mientras el producto siga necesitando teléfono, IP y geolocalización para funcionar. Sumado a esto: el wedge de vivienda le habla a un pagador que ya tiene herramientas mejores y gratis, el moat que lo haría ganar está todo pospuesto a Fase 2, y el plan sigue creciendo en papel (3 versiones, cero código) contra un reloj de marca que vence en octubre y un cliente al que un re-precio 5,5× puede espantar.

**Nada de esto mata el objetivo.** Mata la creencia de que la V3 ya está lista para construir. No lo está: le falta una fase de validación de campo — barata, corta, con fecha dura — que responda las tres preguntas letales *antes* de la primera migración.

---

## LAS GRIETAS, POR SEVERIDAD

### 🔴 A — El honeypot anti-ICE: riesgo humano y existencial que el plan declara resuelto y no lo está

**El golpe.** La V3 (§5.4) dice haber resuelto la contradicción confianza-vs-privacidad porque Stripe Identity devuelve solo un booleano y se descarta el documento. Pero la **subpoena administrativa de DHS no pide el documento** — pide nombre, email, teléfono e IP asociados a una cuenta, que es *exactamente* lo que la plataforma retiene por diseño para funcionar (login, notificaciones, listados geolocalizados, historial, contactos). El grafo social sigue entero y subpoenable. Peor: agregar a una población deportable **pre-segmentada por nacionalidad** (`dominicanos.com`, `venezolanos.net`) construye un directorio-objetivo que antes no existía, servible a un estándar legal bajísimo (subpoena, sin juez).

**Por qué es letal.** No es hipotético. En **feb-2026 DHS emitió cientos de subpoenas administrativas** a Google, Meta, Reddit y Discord pidiendo nombre/email/teléfono de cuentas anti-ICE, y **varias plataformas cumplieron voluntariamente** ([Gizmodo](https://gizmodo.com/reddit-meta-and-google-voluntarily-gave-dhs-info-of-anti-ice-users-report-says-2000722279), [EFF](https://www.eff.org/deeplinks/2026/02/open-letter-tech-companies-protect-your-users-lawless-dhs-subpoenas), [State of Surveillance](https://stateofsurveillance.org/news/dhs-ice-instagram-subpoenas-anti-ice-speech-surveillance-2026/)). Una startup sin equipo legal ni capital para litigar cada subpoena es el eslabón **más débil** de esa cadena: cumple por default. El costo de este golpe no es una multa — es que un usuario indocumentado sea deportado por haber confiado en una promesa de privacidad que la arquitectura no puede cumplir. Y el enjambre de IA construyendo la capa de aislamiento agrava el riesgo: **Moltbook**, red social vibe-coded, fue vulnerada a los **3 días** de lanzar — Supabase sin RLS, 1,5M tokens de auth y 35.000 emails expuestos ([OX Security](https://www.ox.security/blog/vibe-coding-security/)); los CVE de código IA subieron de 6 a 35/mes entre ene y mar 2026 ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-generated-code-vulnerability-surge-2026/)).

**Qué tendría que ser cierto para sobrevivir.** Que la app minimice retención al punto de ser **inútil para una subpoena**: sin IP persistida, login sin teléfono (passkey/email efímero), geolocalización aproximada nunca exacta, mensajería E2E que la plataforma no pueda descifrar, y una Política de Solicitudes de Autoridades con litigación-por-default + notificación al usuario, **presupuestada ex ante** (seguro E&O + fondo legal, que no están en los ~$247/mes de infra). Sin eso, la promesa de privacidad es fraudulenta y el producto es una herramienta de localización. **Esta no es una tarea de checklist: es una decisión go/no-go sobre si el producto se construye así.**

### 🔴 B — Los gates de validación miden lo que no es viabilidad (la economía no cierra)

**El golpe.** Con el propio mix de precios de la V3 (Inmobiliaria Starter $149 / Pro $299 / Premium $599 por trimestre) y la distribución del plan (8+4+2 = 14 cuentas), 15 landlords pagando generan **~$1.125/mes netos**. Contra el opex honesto de $13.200/mes, eso cubre **8,5%**. El gate estrella "12-15 negocios pagando = el dominio ya camina" (§2.4, §6.4) deja el negocio **quemando ~$12.000/mes**. Break-even real: **~160 cuentas por dominio**, no 15.

**Por qué es letal.** Es el "progreso falso" que el primer veredicto juró no repetir — ahora escondido en la aritmética. Y los otros dos gates están calibrados al negocio equivocado:
- **D30 de 25-30%** es 4-6× el benchmark real de un producto transaccional (5-12% — [enable3](https://enable3.io/blog/app-retention-benchmarks-2025), [core-mba](https://www.core-mba.pro/tool-hub/mobile-app-retention)), y **contradice el propio North Star "anti-scroll / resolución con final"**: un producto diseñado para que la sesión *termine* cuando el usuario resuelve no puede retener como uno adictivo.
- **Churn estructural del inmueble resuelto:** la ventana de lease-up es de [10-21 días](https://zillow.mediaroom.com/2025-05-28-Rental-hunting-season-hits-fever-pitch-as-June-begins,-Zillow-data-shows); alquilada la unidad, el listado sobra. El LTV de Inmobiliaria Pro colapsa de ~$2.765 a ~$300.
- **CAC-B2B de $150 subestimado 2-5×:** vender a un landlord desconfiado, sin marca y sin red, está en **$300-700** ([Data-Mania](https://www.data-mania.com/blog/cac-benchmarks-for-b2b-tech-startups-2025/), [FinancialModelsLab](https://financialmodelslab.com/blogs/kpi-metrics/marketplace-startup)).

**Qué tendría que ser cierto para sobrevivir.** Gate real de viabilidad = **~$8k MRR neto por dominio a mes 6** (no "15 cuentas"). D30 realista para transaccional = **8-12%**, y la métrica que importa es **re-uso por evento** (vuelve en la próxima mudanza), no D30 diario. Ingreso **no atado al listado**: suscripción de "presencia verificada" que el landlord paga aunque no tenga vacante, o modelo pay-per-lead ([Thumbtack $35-60/lead](https://procured.us/articles/thumbtack-pricing)) en vez de membresía continua. Falsable: si >50% de landlords cancela dentro de 60 días de alquilar, el churn es estructural y el LTV del modelo es ficción.

### 🟠 C — El wedge le habla a un pagador que ya tiene mejores herramientas, y su moat está pospuesto

**El golpe.** Los landlords/inmobiliarias que sirven a inmigrantes **ya usan Zillow, Facebook Marketplace Housing y Craigslist** — con screening de ingresos y verificación ya integrados, gratis. La "verificación determinística" nuestra no mueve su disposición a pagar ([lead-gen costs 2026](https://www.jamilacademy.com/blog/real-estate-lead-generation-costs); [Craigslist sigue con 105M usuarios/mes](https://www.inquirer.com/life/craigslist-philly-lingel-20260219.html)). Y lo que *sí* nos haría distintos — el moat real del informe 09 (Escudo Anti-Estafa, Asistente Comunitario, Trust Score 2.0, Guías, Matching, Copiloto de Negocios) — está **todo en Fase 2** del roadmap V3. **F0 sale a competir contra Zillow desnudo, sin diferenciador.**

**Por qué es letal.** Un wedge sin diferenciador en un mercado de dos lados ya ganado por incumbentes densos no alcanza el tipping point. Y la tesis de "coexistencia" con WhatsApp puede ser un búmeran: si el usuario descubre en la app pero **cierra el trato en el grupo de WhatsApp**, el engagement se lo lleva WhatsApp y el D30 medible de la app cae a **8-12%**, rompiendo el gate. "Coexistencia" descrita así es el eufemismo de "regalar el engagement y esperar retención milagro".

**Qué tendría que ser cierto para sobrevivir.** Que exista un pedazo del moat **dentro de F0** (aunque sea uno: el verificador notario/abogado determinístico, o el Escudo Anti-Estafa como capa de alertas) que haga que el usuario *no pueda* obtener lo mismo en Facebook — y que el cierre de la transacción ocurra **dentro de la app** (contacto protegido, no "copiá el link a WhatsApp"). Validable en campo: ≥60% de landlords entrevistados dicen que pagarían por 2+ leads netos que Zillow no les da; ≥40% de los usuarios que comparten un listing vuelven a buscar en la app en D30.

### 🟠 D — El senior humano es un cuello de botella no dimensionado y no contratado (la premisa que carga todo)

**El golpe.** Toda la seguridad descansa en un ingeniero senior que "lee, entiende y firma CADA migración RLS y CADA webhook de Stripe" (§5.2). Pero (i) **ese humano aún no existe** — es la decisión pendiente §16.4, "no opcional" pero sin nombre, sin salario en la planilla, sin fecha; y (ii) la ruta validada agrega tablas/RLS **incrementalmente sobre un esquema ya en producción con datos de población perseguible**, así que no firma una vez: firma para siempre, en cada fase. Un revisor serial en una arquitectura diseñada para generar cambios en paralelo con un enjambre.

**Por qué es letal.** El enjambre produce a 3-5× la velocidad humana y **"0% de los PRs de IA son mergeables tal cual"** ([Augment Code / METR](https://www.augmentcode.com/guides/the-80-percent-problem-ai-agents-technical-debt)). O el senior frena al enjambre (y entonces ¿para qué el enjambre?), o —bajo presión de octubre— firma por lote sin leer, y el gate se degrada a un sello de goma. El plan presupuesta el *costo* del senior pero nunca su *ancho de banda*. **Un gate cuya capacidad no se dimensionó no es un control: es un supuesto.**

**Qué tendría que ser cierto para sobrevivir.** Que ese senior esté **contratado antes de la primera tabla**, y que el ritmo de migraciones se subordine deliberadamente a su capacidad de lectura (no a la del enjambre). Si no está en la planilla, o el valle de $235k lo excluye, la premisa que carga todo el plan está vacía.

### 🟡 E — La planificación infinita ES el síntoma, y el capital no está confirmado

**El golpe.** Tres versiones de plan maestro, 12 informes, 5 power-ups, dos veredictos adversariales, un handoff pulido — y **cero líneas de código**. El primer veredicto ya diagnosticó esto ("la enfermedad ya está en movimiento") y la respuesta fue producir **otra capa de documento**. El sistema respondió a "estás planificando en vez de construir" planificando mejor. Y todo el plan asume que Geovanny financia ~$235k — pero §16.3 lo lista como **decisión PENDIENTE**. La cifra saltó 5,5× ($43k→$235k) *después* de que el cliente se comprometió mentalmente con el proyecto barato.

**Por qué es letal.** Contra un reloj de octubre, cada semana de re-blindaje del papel es una semana que no valida la única pregunta que importa. Y un cliente **ya quemado por una empresa que no entregó, con demanda legal en curso**, es exactamente el perfil que corta el grifo al ver el re-precio — antes de que el código llegue a fallar.

**Qué tendría que ser cierto para sobrevivir.** Que esta sea la **última palabra escrita antes de la primera acción de validación**, con una **fecha dura** de "primer contacto con un landlord/usuario real" en el calendario, y que el capital esté **comprometido por escrito** antes de escalar el gasto. El roadmap §13 usa gates ("cuando pase X"), no fechas — suena disciplinado pero elimina el único forzante (octubre) que obliga a cortar el papel.

---

## LA QUE LO MATA

Si hay que apostar a una sola causa de muerte del **proyecto**: **la combinación planificación-infinita + capital-no-confirmado + cliente-quemado** lo mata primero, por la vía aburrida — Geovanny ve el re-precio 5,5×, financia una versión recortada "hasta ver algo", el equipo entrega el 80% visible (login, branding, PWA), nunca se cruzan los gates reales, y corta por segunda vez.

Pero hay un riesgo distinto que **no se mide en probabilidad sino en consecuencia**: el honeypot anti-ICE (grieta A). Aunque el proyecto tuviera todo el capital y todo el talento, esa arquitectura puede terminar en la **deportación de un usuario real**. Ese riesgo debe condicionar *si* el producto se construye así — no ser un ítem de checklist. Es la razón por la que la V4 necesita una decisión go/no-go explícita y honesta con Geovanny, no un párrafo tranquilizador.

---

## SI INSISTÍS, ARREGLÁ ESTO PRIMERO (input directo a la V4)

Ordenado, ejecutable, y **antes de la primera migración de producto**:

1. **Sprint 0 de validación de campo (2-3 semanas, sin código de producto, con fecha dura).** Responde las tres preguntas letales antes de gastar el valle:
   - **¿Pagan los landlords?** 20-30 entrevistas estructuradas a landlords/inmobiliarias que sirven inmigrantes en 2-3 ciudades: ¿cuánto pagan hoy en lead-gen?, ¿pagarían por 2+ leads netos que Zillow no da? Umbral: ≥60% sí.
   - **¿Vuelve el usuario?** Instrumentar una prueba de demanda (landing + concierge manual, sin app completa) que mida si el usuario *cierra dentro* del flujo y vuelve, o se va a WhatsApp.
   - **¿Es legal?** Consulta de una tarde en TSDR para confirmar si octubre 2026 es Sección 8 o abandono, y una consulta con abogado de inmigración/privacidad sobre el riesgo de honeypot y de negligent misrepresentation.
2. **Decisión go/no-go sobre el honeypot anti-ICE**, tomada con Geovanny y por escrito, con arquitectura de minimización de datos definida ANTES de cualquier dato real (o la decisión explícita de no construirlo así).
3. **Recalibrar los tres gates** a números que signifiquen viabilidad: ~$8k MRR neto/dominio a mes 6; D30 8-12% + re-uso por evento; churn <50% a 60 días post-alquiler. Y rediseñar el ingreso para que **no dependa del listado** (presencia verificada / pay-per-lead).
4. **Meter un pedazo del moat dentro de F0** (verificador determinístico notario/abogado, o Escudo Anti-Estafa como capa de alertas) para que el wedge no salga desnudo contra Zillow — con el copy legalmente seguro (nunca "verificado/de confianza": descriptor literal + disclaimer + seguro E&O presupuestado).
5. **Confirmar por escrito las dos precondiciones bloqueantes:** (a) capital de ~$235k comprometido; (b) ingeniero senior de RLS/Stripe contratado, con su ancho de banda de firma dimensionado como el verdadero límite de velocidad del proyecto. Sin las dos, el plan es una hipótesis, no un plan.
6. **Sincronizar los documentos-fuente:** el informe 09 todavía describe el Escudo Anti-Estafa como "IA que intercepta el fraude antes de que ocurra" — la versión legalmente tóxica que la V3 dice haber reformulado. Si el enjambre construye leyendo el 09, construye la bomba. Corregir el 09 (o marcarlo como superado por §3 de la V4).

---

*Este segundo pase no cambia el objetivo (producto completo multi-tenant para la diáspora latina, diseño premium, salvar la marca). Cambia lo que la V4 debe hacer antes de construir: validar en campo, decidir el honeypot de frente, recalibrar los gates con la verdad, y confirmar que el capital y el senior existen. La mejor mejora del plan no es una versión más larga — es la que fuerza a cortar el papel y tocar el mundo real.*

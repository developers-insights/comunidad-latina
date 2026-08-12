# Estándar legal de referencia — Insights (4 productos)

**Fecha de corte de la investigación: 9 de agosto de 2026.** Todo dato con cifra, plazo o fecha
lleva fuente al lado. Lo que no la lleva es criterio propio y está marcado como tal.

> **Esto es un documento informativo, no asesoramiento legal.** No soy abogado matriculado.
> Los puntos marcados con 🧑‍⚖️ requieren revisión de un abogado de la jurisdicción **antes**
> de salir a producción. Consultá con un profesional habilitado para tu situación concreta.

**Qué es este documento:** la vara. Define qué *debería* tener cada producto y con qué
prioridad. No audita código — eso lo hace el otro frente. Cuando el relevamiento vuelva, se
cruza contra la §3 (matriz) y sale el plan de trabajo.

**Cómo leer las prioridades:**

| Prioridad | Significado operativo |
|---|---|
| 🔴 **Bloqueante** | No sale a producción / no se publica en tienda sin esto. Riesgo de demanda con daños tasados por unidad, o de takedown. |
| 🟠 **Alto** | Sale, pero con exposición real. Se cierra dentro del sprint siguiente al lanzamiento. |
| 🟡 **Medio** | Deuda de cumplimiento. Se agenda, no frena nada. |

**Distinción que se respeta en todo el documento:** `LEY` = obligación normativa con
consecuencia (multa, demanda, takedown). `TIENDA` = requisito de plataforma, no ley, pero te
baja la app. `PRÁCTICA` = criterio propio o estándar de industria, sin norma detrás.

---

## 1. Checklist legal transversal (aplica a los 4 productos)

### 1.1 Cookies, trackers y consentimiento

#### C-01 · Bloqueo real de scripts antes del consentimiento 🔴 Bloqueante
- **Qué es:** ningún script de terceros (analytics, píxel publicitario, session replay, chat,
  mapas, fuentes remotas) puede ejecutarse ni abrir una conexión de red antes de que el usuario
  haya dado un consentimiento afirmativo — donde se exija consentimiento previo.
- **Por qué existe:** `LEY`. En la UE la ePrivacy Directive exige consentimiento **previo** a
  escribir o leer cualquier cosa del dispositivo que no sea estrictamente necesaria. En EE.UU. la
  vía no es la ley de privacidad sino la **litigación bajo CIPA** (California Invasion of Privacy
  Act): demandantes reencuadran píxeles, session replay y herramientas de captura de IP como
  wiretaps o pen registers. Los tribunales están divididos sobre si califican, pero eso no evita
  el costo de defensa: hay acuerdos de clase de millones (p. ej. Los Angeles Times, $3,85M,
  aprobado el 26-jun-2026). El proyecto SB 690, que cerraría esta vía, **no es ley** al
  1-ago-2026 y, si se aprueba, no regiría antes del 1-ene-2027
  ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/04/the-millisecond-problem-how-pre-consent-tracking-is-driving-cipa-lawsuits-in-2026),
  [Spencer Fane](https://www.spencerfane.com/insight/cipa-website-tracking-lawsuits-where-the-law-stands-where-its-going-and-what-your-business-should-do-now/),
  [cookie-script CIPA tracker](https://cookie-script.com/privacy-laws/cipa-lawsuit-tracker/amp)).
- **Cómo se ve implementado bien (verificable):**
  - En una pestaña nueva, sin consentimiento previo, el panel Network **no muestra ninguna
    request** a `google-analytics.com`, `googletagmanager.com`, `facebook.net`, `hotjar`,
    `clarity`, `fonts.googleapis.com`, etc. Ni una. Este es el test — grepear el código no
    alcanza.
  - Los `<script>` de terceros están como `type="text/plain"` + `data-category="..."` (patrón de
    bloqueo previo) o inyectados dinámicamente **después** del evento de consentimiento; no
    cargados con `next/script strategy="afterInteractive"` sin gate.
  - No hay fuentes ni imágenes servidas desde CDN de terceros en el primer render (self-host).
- **Falla típica:** el banner existe, es lindo, y GTM ya cargó. Eso es un banner que decora.

#### C-02 · Consentimiento previo vs. opt-out, según jurisdicción 🟠 Alto
- **Qué es:** el mismo producto necesita dos comportamientos distintos según de dónde venga el
  visitante. No es "poner un banner", es **decidir cuál**.
- **Por qué existe:** `LEY`. Modelos:
  | Región | Modelo | Consecuencia en UI |
  |---|---|---|
  | UE / UK / Brasil (LGPD, en la práctica) | **Opt-in previo** para todo lo no esencial | Banner bloqueante con "Rechazar todo" al mismo nivel visual que "Aceptar todo" |
  | EE.UU. — estados con ley integral | **Opt-out** de venta/compartición y de publicidad dirigida; opt-in solo para datos sensibles | Link permanente "Do Not Sell or Share My Personal Information" + honrar señal automática |
  | EE.UU. — resto | Sin obligación estatal; rige lo que diga tu propia política | Coherencia con la política, nada más |
  | Chile (desde 1-dic-2026) | Opt-in tipo GDPR | Igual que UE |
- **Cómo se ve implementado bien:** una función de resolución de régimen (`getConsentRegime(geo)`)
  que decide entre `opt-in` / `opt-out` / `none`, y **un default seguro**: si no se puede
  geolocalizar, se aplica opt-in. La geolocalización por IP es aproximada — el default importa.
- **Criterio propio:** para un producto chico, aplicar opt-in en todas partes es más barato que
  mantener dos regímenes y equivocarse. Cuesta conversión de analytics, no ingresos.

#### C-03 · Global Privacy Control (GPC) 🔴 Bloqueante (si aplica alguna ley estatal)
- **Qué es:** una señal que manda el navegador (`Sec-GPC: 1` en el header, `navigator.globalPrivacyControl === true`
  en JS). Vale como ejercicio válido del derecho de opt-out, sin que el usuario toque tu banner.
- **Por qué existe:** `LEY`. Al 1-ene-2026 **doce estados** obligan a reconocerla: California,
  Colorado, Connecticut, Delaware, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New
  Jersey, Oregon y Texas ([Secure Privacy](https://secureprivacy.ai/blog/privacy-laws-2026)).
  California además exige mostrar una confirmación visible de que la señal fue honrada.
- **Cómo se ve implementado bien:**
  - El server lee `Sec-GPC` en el middleware de Next.js y setea el estado inicial de consentimiento
    **antes** del primer render — no después, en un `useEffect`.
  - El cliente chequea `navigator.globalPrivacyControl` y lo trata como opt-out ya ejercido.
  - La señal **no** se puede sobrescribir con un "Aceptar todo" del banner sin acción explícita
    posterior del usuario.
  - Queda registrado en la tabla de consentimientos con `source='gpc'`.
- **Falla típica:** el CMP lo soporta en su plan Enterprise y está apagado.

#### C-04 · Registro auditable del consentimiento 🔴 Bloqueante
- **Qué es:** poder responder, dos años después y ante un tercero, "este usuario aceptó *esto*,
  el día *tal*, y este era el texto exacto que leyó".
- **Por qué existe:** `LEY`. GDPR Art. 7(1) pone la carga de la prueba en el responsable. El
  TCPA/FTSA, en la práctica, se ganan o se pierden por si podés producir el registro de consentimiento
  (ver §2.1). Sin timestamp + versión del texto, el consentimiento **no es oponible**: es tu
  palabra contra la del demandante.
- **Cómo se ve implementado bien:** ver la tabla completa en §5.1. Mínimo no negociable:
  `user_id` o identificador, `purpose`, `granted` (bool), `policy_version`, `text_hash`,
  `timestamp`, `ip`, `user_agent`, `method` (`banner` / `checkbox` / `gpc` / `api`), y
  **append-only** (sin UPDATE ni DELETE; revocar = insertar una fila nueva con `granted=false`).
- **Verificable:** existe una consulta SQL de una línea que reconstruye el estado de
  consentimiento de un usuario en cualquier fecha pasada. Si hay que mirar logs de aplicación
  para responder eso, no está implementado.

#### C-05 · Revocación tan fácil como el otorgamiento 🟠 Alto
- **Por qué existe:** `LEY`. GDPR Art. 7(3) ("tan fácil retirar como dar"). Las leyes estatales de
  EE.UU. exigen un método de opt-out accesible desde cualquier página.
- **Cómo se ve bien:** link permanente en el footer ("Preferencias de privacidad") que reabre el
  panel con el estado actual, en **todas** las páginas, incluidas las de la app logueada. Al
  revocar, los scripts ya cargados se desactivan y las cookies de esa categoría se borran en la
  misma sesión — no en la próxima visita.

---

### 1.2 Política de privacidad y términos

#### P-01 · Contenido mínimo de la política de privacidad 🔴 Bloqueante
- **Por qué existe:** `LEY` + `TIENDA`. GDPR Arts. 13–14 listan el contenido obligatorio; CCPA
  §1798.130 exige el aviso en el momento de la recolección; Apple y Google exigen un link a la
  política **desde la ficha de la tienda y desde dentro de la app**.
- **Cómo se ve bien:** ver índice mínimo en §5.4. El criterio de suficiencia es: un usuario
  puede responder, leyendo solo la política, **qué datos** se recogen, **para qué**, **con qué
  base legal**, **con quién se comparten** (nombrados, no "proveedores de confianza"),
  **cuánto tiempo** se guardan y **cómo ejercer** sus derechos.
- **Falla típica que anula la oponibilidad:** listar terceros como categorías genéricas. Si tu
  política dice "proveedores de análisis" y el producto manda datos a Meta, la política no cubre
  ese envío.

#### P-02 · Versionado y prueba de aceptación 🟠 Alto
- **Por qué existe:** `LEY` (contractual). Unos términos que cambiaron sin que el usuario los
  aceptara no le son oponibles en la versión nueva. Los tribunales de EE.UU. distinguen
  *clickwrap* (aceptación afirmativa, ejecutable) de *browsewrap* (link en el footer,
  frecuentemente inejecutable).
- **Cómo se ve bien:**
  - Cada documento tiene `version` (semver o fecha ISO) y los archivos viven **en el repo**, no en
    un CMS sin historial. El diff entre versiones es visible en git.
  - Al registrarse: checkbox **sin premarcar**, texto con link, y se persiste
    `accepted_terms_version` + `accepted_privacy_version` + timestamp en la fila del usuario.
  - Cambio material ⇒ re-aceptación bloqueante en el próximo login, no un email.
  - `PRÁCTICA`: aviso con 30 días de anticipación para cambios materiales en productos de pago.

#### P-03 · Términos con las cláusulas que efectivamente te protegen 🟠 Alto
- **Por qué existe:** `LEY` (contractual). Sin límite de responsabilidad y sin ley aplicable, el
  cliente queda expuesto al foro del demandante.
- **Mínimo, por producto:** limitación de responsabilidad, disclaimer de garantías, ley aplicable
  y foro, indemnidad, terminación, y **la cláusula específica del vertical** (ver §2). 🧑‍⚖️ Las
  cláusulas de arbitraje y renuncia a acción de clase son las que más valen y las que más se
  caen si están mal redactadas — no las escribas vos.

---

### 1.3 Derechos del titular

#### D-01 · Acceso y exportación 🟠 Alto
- **Por qué existe:** `LEY`. GDPR Art. 15 + Art. 20 (portabilidad, formato estructurado y de uso
  común, legible por máquina). CCPA: derecho a saber y a portabilidad. LGPD Art. 18.
- **Plazos:** GDPR **1 mes**, prorrogable a 3 con aviso. CCPA **45 días**, prorrogable a 90 con
  aviso. Chile Ley 21.719 y las leyes estatales nuevas siguen rangos similares.
- **Cómo se ve bien:** un endpoint/pantalla que genera un archivo (JSON o ZIP con JSON + medios)
  con **todas** las tablas donde aparece el usuario — no solo el perfil. Si el export no incluye
  mensajes, eventos, consentimientos y contenido generado, está incompleto.
- **Verificable:** correr el export sobre una cuenta de prueba y comparar contra la lista de
  tablas con FK al usuario. La diferencia es el bug.

#### D-02 · Borrado real, no desactivación 🔴 Bloqueante
- **Por qué existe:** `LEY` + `TIENDA`. GDPR Art. 17. Apple es explícito: ofrecer solo
  desactivación **no es suficiente**, y hay que borrar el registro de cuenta y los datos
  personales asociados, incluido el contenido generado por el usuario
  ([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)).
- **Cómo se ve bien:** contrato explícito de tres categorías — borrar / anonimizar / conservar —
  documentado y ejecutado en una transacción. Ver §5.2.
- **Falla típica:** `UPDATE users SET deleted_at = now()` y nada más. Eso es desactivación con otro
  nombre, y contradice tu propia política de privacidad — que es lo que te hace perder el caso.

#### D-03 · Rectificación 🟡 Medio
- `LEY` (GDPR Art. 16, CCPA derecho a corregir). Se cubre con "editar perfil" en la mayoría de los
  casos; el gap suele estar en datos **inferidos o traídos de terceros**, que el usuario no puede
  tocar. Ahí hace falta un canal manual documentado.

#### D-04 · Prueba de cumplimiento del pedido 🟠 Alto
- **Por qué existe:** `LEY`. La autoridad no pregunta si borraste; pregunta cómo lo probás.
- **Cómo se ve bien:** tabla `dsr_requests` (`tipo`, `usuario`, `recibido_at`, `verificado_at`,
  `completado_at`, `resultado`, `operador`) + un artefacto de cierre (hash del export entregado,
  o el conteo de filas afectadas por el borrado). Retenida **más allá** del borrado del usuario —
  es tu prueba, y su base legal es el cumplimiento de una obligación legal.

---

### 1.4 Retención y minimización

#### R-01 · Tabla de retención declarada y ejecutada 🟠 Alto
- **Por qué existe:** `LEY`. GDPR Art. 5(1)(e) (limitación del plazo) + la obligación de
  **declarar** los plazos en la política (Art. 13(2)(a)). Las leyes estatales de EE.UU. exigen que
  no se retenga más de lo razonablemente necesario para el propósito declarado.
- **Cómo se ve bien:** un documento (o mejor, una constante en código) que por cada tabla declara
  plazo y disparador, **y un job que lo ejecuta**. Una política que dice "24 meses" sin cron que
  borre es una declaración falsa, que es peor que no declarar nada.
- **Verificable:** `select min(created_at) from <tabla>` devuelve algo dentro del plazo declarado.

#### R-02 · Minimización en el punto de captura 🟡 Medio
- `LEY` (GDPR Art. 5(1)(c)) + `PRÁCTICA`. Cada campo de un formulario debería tener un motivo. El
  caso caro: guardar la respuesta cruda completa de una API de terceros ("por si acaso") cuando
  usás tres campos. Eso multiplica la superficie de una brecha y de un pedido de acceso.

---

### 1.5 Terceros, encargados y transferencias

#### T-01 · Inventario de terceros y DPA firmado 🟠 Alto
- **Qué es:** lista viva de todo proveedor que toca datos personales, con su rol
  (encargado/responsable) y el contrato correspondiente.
- **Por qué existe:** `LEY`. GDPR Art. 28 exige contrato escrito con el encargado, con contenido
  tasado. LGPD Art. 39. Las leyes estatales de EE.UU. (CCPA §1798.100(d), y las de VA/CO/CT/TX y
  sucesivas) exigen contrato con el *service provider* / *processor* con obligaciones específicas
  — y **sin ese contrato, la transferencia puede calificar como "venta"** de datos, que dispara
  todo el régimen de opt-out.
- **Cómo se ve bien:** en el stack de Insights, esto significa DPA aceptado con **Supabase,
  Vercel, y cada proveedor de mensajería, IA, pagos, crash reporting y analytics** que use cada
  producto — más la lista de subencargados publicada en la política. Los DPA estándar de estos
  proveedores se aceptan online; no hay excusa de costo.
- **Verificable:** existe un archivo `docs/TERCEROS.md` (o equivalente) por producto, y cada
  entrada tiene link al DPA firmado y la región de procesamiento.

#### T-02 · Transferencias internacionales 🟡 Medio → 🟠 Alto si hay usuarios UE/Chile/Brasil
- **Por qué existe:** `LEY`. GDPR Cap. V (SCC + evaluación de impacto de la transferencia).
  Brasil: la ANPD aprobó las cláusulas contractuales estándar por Resolución 19/2024
  ([Mattos Filho](https://www.mattosfilho.com.br/en/unico/regulates-international-data-transfers/)).
  Chile Ley 21.719 trae su propio régimen y el Ministerio de Economía ya dictó cláusulas tipo
  ([Prey](https://preyproject.com/es/blog/ley-de-proteccion-de-datos-en-chile)).
- **Cómo se ve bien:** región del proyecto Supabase documentada y **elegida a propósito**, no la
  default. Si hay usuarios UE, la región debería ser UE salvo decisión consciente y documentada.

---

### 1.6 Menores

#### M-01 · Edad mínima declarada y verificada de forma proporcional 🟠 Alto
- **Por qué existe:** `LEY`. COPPA (EE.UU.) rige para menores de 13 y exige **consentimiento
  parental verificable** — la Regla enmendada exige compliance total desde el **22 de abril de
  2026**, e introduce un consentimiento parental **separado** para divulgar datos del menor a
  terceros con fines de publicidad dirigida **o para entrenar IA**
  ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/coppa-rule-amendment-compliance-deadline-approaches),
  [White & Case](https://www.whitecase.com/insight-alert/unpacking-ftcs-coppa-amendments-what-you-need-know)).
  GDPR Art. 8: 16 años por defecto, cada estado miembro puede bajarlo hasta 13.
- **Cómo se ve bien (criterio propio, proporcional):** para productos que **no** apuntan a menores,
  lo correcto es (a) declarar la edad mínima en los términos, (b) una *age gate* neutral en el
  registro que guarde la fecha de nacimiento o el chequeo pasado/no pasado, y (c) un procedimiento
  documentado de borrado si se detecta una cuenta de menor. Verificación robusta de identidad
  solo si el producto efectivamente atrae menores.
- **Dónde muerde acá:** Comunidad Latina (red social, atrae menores por naturaleza) e iRowing
  (deporte escolar/juvenil — el remo tiene categorías junior). 🧑‍⚖️

---

### 1.7 Seguridad como obligación legal

#### S-01 · Plan de notificación de brechas escrito y ensayado 🟠 Alto
- **Por qué existe:** `LEY`. GDPR Art. 33: notificar a la autoridad en **72 horas** desde que se
  tuvo conocimiento; Art. 34: a los afectados sin dilación indebida si hay riesgo alto. EE.UU.: los
  50 estados tienen ley de notificación; ~20 fijan plazo numérico, típicamente 30–60 días. Los más
  duros al 2026: **California SB 446 — 30 días corridos a los residentes afectados, y 15 días al
  Fiscal General si son 500 o más**; Oklahoma — 60 días al AG si son 500 o más
  ([Alston & Bird](https://www.alstonprivacy.com/key-breach-notification-updates-in-california-and-oklahoma-for-2026/),
  [Privacy Rights Clearinghouse](https://privacyrights.org/resources-tools/reports/data-breach-notification-laws-50-state-survey-2026-edition)).
  Chile Ley 21.719 incorpora notificación en 72 h.
- **Cómo se ve bien:** un runbook de una carilla en el repo con: quién declara el incidente, cómo
  se determina el alcance (qué consulta SQL corre), a quién se notifica y en qué orden, plantilla
  de aviso, y **el reloj arranca en la detección, no en la confirmación**. Más un contacto legal
  del cliente identificado por nombre.
- **Lo que hace falta antes:** logs que permitan determinar el alcance. Sin logs de acceso a datos,
  no podés decir cuántos registros se expusieron, y la respuesta por defecto pasa a ser "todos".

#### S-02 · Medidas técnicas "apropiadas" 🟠 Alto
- **Por qué existe:** `LEY`. GDPR Art. 32; CCPA §1798.150 crea un **derecho privado de acción por
  brecha** cuando hubo falta de medidas razonables — es la única parte de CCPA con demanda de
  particulares, y por eso la que se litiga.
- **Cómo se ve bien:** para el stack de Insights, el mínimo defendible es RLS habilitada y forzada
  en toda tabla con datos personales, service-role key nunca en el cliente, MFA disponible en
  cuentas administrativas, cifrado en tránsito y en reposo (lo da Supabase), y ausencia de
  endpoints que devuelvan datos de otro tenant. El frente de seguridad tiene el detalle.

---

### 1.8 IA sobre datos de usuarios

#### IA-01 · Divulgación de que hay IA de por medio 🟠 Alto
- **Por qué existe:** `LEY` en la UE — el AI Act Art. 50 exige, desde el **2 de agosto de 2026**,
  informar a la persona que está interactuando con un sistema de IA cuando no sea obvio, y etiquetar
  contenido generado o manipulado por IA de forma clara y con marca legible por máquina. Multas de
  hasta €15M o 3% de la facturación mundial. El "Digital Omnibus" aprobado el 16-jun-2026 corrió
  las obligaciones de alto riesgo entre 12 y 16 meses, **pero el Art. 50 mantuvo su fecha**
  ([Cooley](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026),
  [Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/is-it-a-bot-eu-ai-act-transparency-rules-take-effect-2-august-2026/)).
  En EE.UU. no hay obligación federal equivalente; hay leyes estatales de transparencia (California)
  y el régimen ADMT de California (abajo).
- **Cómo se ve bien:** en un chat/asistente, la primera interacción de **cada usuario** dice que es
  IA (no basta con decirlo una vez en la home). En contenido generado, marca visible.

#### IA-02 · Decisiones automatizadas sobre personas 🔴 Bloqueante donde aplique
- **Qué es:** usar un modelo para decidir (o sustituir sustancialmente la decisión humana sobre)
  algo significativo para una persona.
- **Por qué existe:** `LEY`. Las regulaciones ADMT de California, finalizadas por la CPPA en 2025,
  definen "decisión significativa" incluyendo **empleo u oportunidades de contratación
  independiente y su compensación**, vivienda, servicios financieros o de préstamo, educación y
  salud. Obligaciones: **aviso previo al uso**, derecho de acceso a la lógica, y **derecho de
  opt-out — salvo que ofrezcas apelación a un revisor humano con autoridad para revertir**.
  Cumplimiento del régimen ADMT desde el **1-ene-2027**; las evaluaciones de riesgo para
  actividades cubiertas rigen desde el **1-ene-2026** y se presentan a la CPPA hasta el 1-abr-2028
  ([White & Case](https://www.whitecase.com/insight-alert/cppa-finalizes-rules-admt-risk-assessments-and-cybersecurity-audits-requirements),
  [Skadden](https://www.skadden.com/insights/publications/2025/10/california-finalizes-cppa-regulations),
  [CPPA](https://cppa.ca.gov/announcements/2025/20250923.html)). GDPR Art. 22 tiene un régimen
  paralelo y más viejo.
- **Dónde muerde acá, y es el punto no obvio:** **Marex**. Si un algoritmo (scoring, ranking,
  matching, filtro automático de antecedentes) decide qué trabajador entra o cuánto cobra, eso es
  una "decisión significativa" sobre *independent contracting opportunities*. Y en RDX, un scoring
  que module acceso a financiación roza "servicios financieros". 🧑‍⚖️
- **Cómo se ve bien:** aviso previo al uso + ruta de apelación humana implementada (no prometida) +
  registro de qué señales entraron en la decisión.

#### IA-03 · Qué NO se puede hacer con datos de usuarios y un LLM 🟠 Alto
- `LEY` + contrato. Reglas duras:
  1. **No mandar datos personales a un proveedor de IA sin DPA y sin que figure como subencargado**
     en tu política. Si no está listado, la transferencia no está cubierta.
  2. **No permitir entrenamiento sobre los datos del cliente.** Verificable: la cuenta/API del
     proveedor tiene el opt-out de entrenamiento activado y está documentado. En OpenAI/Anthropic
     el default de API es no entrenar, pero eso hay que poder mostrarlo, no afirmarlo.
  3. **No datos de menores para entrenar IA sin consentimiento parental separado** — es
     explícito en la Regla COPPA enmendada, exigible desde el 22-abr-2026.
  4. **No datos de salud/health data sin consentimiento opt-in específico** (ver §2.7).
  5. Un output de IA que sea decisión sobre una persona cae en IA-02.

---

## 2. Requisitos por jurisdicción / vertical

### 2.1 EE.UU. — SMS, voz y mensajería (TCPA + FTSA) 🔴 Bloqueante para RDX

Este es, por lejos, el riesgo más caro del portafolio: **daños tasados por mensaje, sin necesidad
de probar daño real, y con abogados especializados que los buscan a escala.**

| Punto | Federal (TCPA) | Florida (FTSA) |
|---|---|---|
| Consentimiento para marketing | **Prior express written consent**: acuerdo escrito firmado (firma electrónica ESIGN vale), que identifique al llamante, el número, y diga clara y visiblemente que autoriza llamadas/mensajes de marketing **y que aceptar no es condición de compra** | Definición propia en Fla. Stat. 501.059: firma, número, y disclosure clara y visible; tras la reforma de 2023 un acto que demuestre consentimiento expreso (tildar una casilla, responder afirmativamente a un texto) puede alcanzar |
| Daños | **$500 por mensaje**, **$1.500 si es willful o knowing** | **$500 por violación o daño real, el mayor**; **triplicable** si es willful o knowing |
| Ventana horaria | 8:00–21:00 hora local del destinatario (47 CFR 64.1200(c)(1)) | **8:00–20:00** hora local del destinatario (Fla. Stat. 501.616(6)) |
| Frecuencia | Sin tope explícito | **Máximo 3 llamadas/mensajes en 24 h** a la misma persona sobre el mismo asunto, **cualquiera sea el número usado** |
| Opt-out | Desde el **11-abr-2025**: se puede revocar por **cualquier medio razonable**; hay que honrarlo **"as soon as practicable" y como máximo en 10 días hábiles**; palabras que obligan: *stop, quit, end, revoke, opt out, cancel, unsubscribe*; la revocación se extiende a **llamadas y textos por igual**, sin importar el canal por el que llegó; **un solo** mensaje de confirmación posterior permitido. La parte de "métodos razonables" se pospuso al **11-abr-2026** ([BCLP](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html), [Nixon Peabody](https://www.nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules)) | Prerrequisito de demanda: el destinatario debe responder **STOP**, y el remitente tiene **15 días** para cesar. Solo si sigue recibiendo después de esos 15 días hay acción |
| Otros | Scrub contra el **National Do Not Call Registry**; lista interna de DNC obligatoria | Scrub contra la lista estatal de "no sales solicitation calls"; caller ID obligatorio con número que reciba llamadas de vuelta |

**Cambio relevante de 2025 que juega a favor:** el 24-ene-2025 el 11º Circuito, en *Insurance
Marketing Coalition v. FCC*, **anuló la regla de consentimiento "uno a uno"** de la FCC — que
habría exigido consentimiento por vendedor individual y "lógica y tópicamente asociado" a la
interacción original. La FCC la derogó formalmente después
([MoFo](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule),
[Womble](https://www.womblebonddickinson.com/us/insights/blogs/fcc-repeals-one-one-consent-rule-following-eleventh-circuit-decision)).
**Qué NO cambió:** sigue haciendo falta consentimiento expreso previo del consumidor. Lo que cayó
fue una restricción adicional, no el requisito base. No es una puerta para el SMS en frío.

**Traducción operativa para RDX:** un propietario cuyo teléfono salió de un skip-trace
**nunca dio consentimiento**. No hay lectura razonable de "prior express written consent" que lo
cubra. Con Florida en el mapa, el piso de exposición es $500 por mensaje, y el registro A2P 10DLC
ante TCR **no es una licencia** — es un requisito del carrier para que el mensaje se entregue, y
no sustituye ni un gramo de consentimiento. Esto ya está identificado como bloqueo; el estándar lo
confirma. 🧑‍⚖️ **Ya hay un abogado de Florida en el tema — que la respuesta cubra explícitamente:
(a) si existe alguna vía de contacto inicial legal sin consentimiento previo, (b) llamada de voz
manual vs. SMS automatizado, (c) exposición de la agencia como quien opera el sistema.**

**Cómo se ve implementado bien, si y solo si hay consentimiento:**
- Tabla `sms_consent` append-only con el texto exacto del disclosure y su versión (§5.1).
- Gate en el envío que verifica, **por destinatario y en el momento del envío**: consentimiento
  vigente ∧ no opt-out ∧ hora local dentro de ventana ∧ tope de frecuencia ∧ no en DNC.
- La hora local se calcula del **área geográfica del número o del domicilio conocido**, no de la
  zona horaria del servidor.
- El opt-out es global por persona, no por campaña ni por número emisor.

### 2.2 EE.UU. — Email (CAN-SPAM) 🟠 Alto
- `LEY`. Sanción civil máxima **$53.088 por email**, aplicada **por mensaje**, no por campaña
  ([FTC guía](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business);
  monto de la actualización de 2025, vigente en 2026 — el ajuste de 2026 fue suspendido por OMB).
- CAN-SPAM es **opt-out**, no opt-in: no hace falta consentimiento previo, pero sí (a) encabezados
  y asunto no engañosos, (b) identificar el mensaje como publicitario si lo es, (c) **domicilio
  postal físico válido**, (d) mecanismo de baja funcional, honrado en **10 días hábiles**, sin
  exigir login ni pago, y (e) responsabilidad por lo que haga un tercero contratado.
- **Trampa:** el domicilio postal físico. Es el requisito que más se omite y es objetivo, verificable
  y de defensa imposible.
- **Nota Canadá (CASL):** si hay destinatarios en Canadá, el modelo se invierte a **opt-in** con
  sanciones hasta CAD $10M. Solo relevante si el cliente manda a Canadá — preguntar, no asumir.

### 2.3 EE.UU. — Leyes estatales de privacidad 🟠 Alto
- **Estado del mapa:** al 2026 hay **20 estados** con ley integral en vigor: California, Colorado,
  Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New
  Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, Virginia y Washington
  ([MultiState](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)).
- **Umbrales — acá está la pregunta que decide todo:** casi todas aplican por volumen, no por
  facturación. California: >**$26.625.000** de facturación bruta anual, **o** datos de ≥100.000
  consumidores/hogares de California, **o** ≥50% de los ingresos por vender/compartir datos
  ([Clym](https://www.clym.io/blog/ccpa-applicability-guide)). La mayoría de los otros estados:
  **~100.000 residentes** del estado (algunos 175.000 o 35.000), o 25.000 si hay venta de datos.
  **Texas no tiene umbral de volumen** — aplica a cualquiera que haga negocios en el estado y no
  sea una pequeña empresa según SBA, lo que en la práctica la vuelve la más fácil de disparar.
- **Consecuencia práctica:** un producto de agencia con pocos miles de usuarios probablemente
  **no** califica bajo la mayoría de estas leyes hoy. Pero (a) Texas puede aplicar igual, (b)
  el umbral se cruza sin avisar cuando el producto crece, y (c) las obligaciones básicas
  (aviso, opt-out, GPC, derechos) son las mismas que ya exigen las tiendas y el sentido común.
  **Criterio propio: construir para el estándar aunque hoy no aplique el umbral; es más barato
  que retrofittear.**
- Obligaciones núcleo comunes: aviso en la recolección, derechos (saber/borrar/corregir/portar),
  opt-out de venta/compartición y publicidad dirigida, **honrar GPC** (12 estados, §C-03),
  **opt-in para datos sensibles** (salud, biométricos, origen étnico, geolocalización precisa,
  orientación sexual, inmigración), contrato con el processor, y evaluación de riesgo para
  tratamientos de alto riesgo.

### 2.4 EE.UU. — FCRA y verificación de antecedentes 🔴 Bloqueante para Marex

Marex ya tiene documentos FCRA en el repo — eso es bueno y raro. Pero tener el PDF no es cumplir:
lo que se litiga es el **flujo**.

| Requisito | Detalle | Cómo se ve bien en producto |
|---|---|---|
| **Disclosure standalone** | Documento que consiste **solo** en la divulgación de que se pedirá un consumer report. No puede compartir pantalla ni documento con los términos de servicio, la política de privacidad, un waiver de responsabilidad ni el contrato del trabajador ([Checkr](https://checkr.com/blog/understanding-disclosure-and-authorization-requirements), [GoodHire](https://www.goodhire.com/blog/fcra-disclosure-and-authorization-tips-ftc/)) | Pantalla propia, sin nada más en ella. **Falla clásica: meter el disclosure dentro del onboarding junto a los T&C. Eso lo invalida.** |
| **Autorización escrita** | Separada, previa a pedir el reporte | Checkbox propio, no premarcado, en su pantalla; persistido con timestamp y versión |
| **Pre-adverse action** | Antes de decidir en contra: notificar, **entregar copia del reporte** y el **Summary of Your Rights Under the FCRA**, y dar un plazo razonable para disputar | Estado explícito en la máquina de estados del trabajador (`pre_adverse_sent`), con timestamp; el sistema **no permite** pasar a rechazo antes de que venza el plazo. Estándar de industria: **5 días hábiles** (no está en la ley — es `PRÁCTICA`) |
| **Adverse action** | Notificación final con nombre/dirección/teléfono del CRA, aclaración de que el CRA no tomó la decisión, y derecho a reporte gratuito y a disputar | Plantilla versionada, envío registrado |
| **Idiomas** | Los documentos ya están en inglés y español — correcto y necesario para el público de Marex | El idioma del documento entregado debe coincidir con el idioma en que el usuario operó la app; registrarlo |

- **Daños:** violación **willful** → daños reales **o** daños tasados de **$100 a $1.000**, más
  punitivos y honorarios de abogado; negligente → daños reales + honorarios. La litigación FCRA
  subió más de 30% interanual en 2025 ([gcheck](https://gcheck.com/blog/fcra-contractor-background-check/)).
  Los honorarios son el motor: hacen económicamente viable el caso individual.
- **Contratistas independientes:** la FTC sostiene que la FCRA cubre a trabajadores no
  tradicionales, aunque algunos tribunales han dicho lo contrario
  ([SHRM](https://www.shrm.org/topics-tools/news/talent-acquisition/fcra-apply-to-background-checks-independent-contractors)).
  **Criterio propio: tratar a los proveedores de Marex como cubiertos. El costo de cumplir es una
  pantalla más; el costo de equivocarse es una acción de clase.** 🧑‍⚖️
- **El riesgo no obvio y potencialmente el más caro:** si Marex **reúne, evalúa o transmite**
  información sobre trabajadores a terceros (por ejemplo, muestra el resultado del background check
  a los clientes que contratan, o comparte el score entre tenants), Marex puede convertirse ella
  misma en una **consumer reporting agency**, con todas las obligaciones de una CRA encima
  (procedimientos de exactitud máxima razonable, disputas, etc.). 🧑‍⚖️ **Pregunta concreta al
  abogado: ¿qué exactamente se le muestra al comprador del servicio sobre el resultado del check?**
- **Además:** leyes estatales y municipales de *ban-the-box* / *fair chance* fijan cuándo se puede
  preguntar por antecedentes y cómo evaluarlos (NYC, California, Illinois y muchas más). Dependen
  de dónde opere Marex. 🧑‍⚖️

### 2.5 Skip-trace y datos obtenidos de terceros 🔴 Bloqueante para RDX

- **La pregunta correcta no es "¿es legal el skip-trace?" sino "¿legal para qué uso?".** Obtener
  el dato y usarlo son dos análisis distintos.
- **Obtención:** los datos típicos de skip-trace inmobiliario (registros catastrales y de
  impuestos, NCOA, servicios públicos, credit header) no son un consumer report cuando se usan
  para contactar a un vendedor potencial, y por eso no disparan FCRA. **DPPA** restringe los
  registros de vehículos (irrelevante si el proveedor no los usa — **verificarlo con el
  proveedor**). **GLBA** prohíbe obtener información financiera por pretexto o suplantación
  ([One Call Legal](https://www.oncalllegal.com/is-skip-tracing-legal/),
  [VA Horizon](https://www.vahorizon.site/guides/how-to-skip-trace-real-estate/)).
- **El punto que se pasa por alto:** el momento en que ese dato se usa para decidir **elegibilidad**
  de una persona (aprobar/rechazar una financiación, calificar a un vendedor), pasa a ser un uso
  con propósito FCRA y todo el régimen se activa. Es una línea que un producto cruza sin darse
  cuenta cuando agrega scoring. 🧑‍⚖️
- **Base legal para contactar a alguien que nunca dio su dato:**
  - En **EE.UU. no existe** una obligación general de "base legal" tipo GDPR. Existe la restricción
    específica del canal — y ahí manda el TCPA/FTSA (§2.1). El resultado práctico es el mismo: sin
    consentimiento, no hay SMS automatizado.
  - **En el momento del primer contacto lícito** (correo postal, o llamada manual dentro de lo
    permitido), hay que identificarse y decir de dónde salió el dato — es lo que exige el aviso a
    terceros bajo GDPR Art. 14 si alguna vez aplicara, y es `PRÁCTICA` defensiva en EE.UU. porque
    demuestra buena fe.
  - **Bajo GDPR/LGPD/Chile, si aplicara**, el Art. 14 obliga a **notificar a la persona dentro de
    un mes** de haber obtenido su dato de un tercero, diciendo de qué fuente vino. Esto hace el
    skip-trace masivo prácticamente inviable en esas jurisdicciones. RDX es EE.UU., así que no
    aplica — pero es la razón por la que el modelo no es exportable sin rediseño.
- **Cómo se ve bien:** cada registro de contacto guarda `data_source`, `acquired_at`,
  `provider_contract_ref` y el `permissible_use` declarado. Un contacto sin procedencia trazable
  es indefendible.

### 2.6 EE.UU. — Vertical inmobiliario (RDX) 🟠 Alto — 🧑‍⚖️ todo este bloque

No es privacidad, pero es donde el producto puede quedar del lado equivocado de una ley:

- **Seller finance y Dodd-Frank / SAFE Act.** Quien financia la venta de una vivienda puede quedar
  como *mortgage originator*. La exclusión de **3 propiedades en 12 meses** exige que el préstamo
  sea **totalmente amortizable (sin pago globo)**, con tasa fija o variable ajustable recién a
  partir del año 5 con topes razonables, y que se determine de buena fe la **capacidad de pago**
  del comprador. Financiar **más de 3 propiedades por año** saca de la exclusión y obliga al
  análisis completo de capacidad de repago
  ([NAR](https://www.nar.realtor/the-safe-act-seller-financing), [Berlin Patten](https://berlinpatten.com/dodd-frank-seller-financing-and-private-money-financing/)).
  **Implicancia de producto:** si RDX permite armar operaciones con balloon payment o contar
  operaciones por originador, el software está facilitando estructuras que pueden ser ilícitas
  para ese usuario. Como mínimo: contador de operaciones por originador y advertencia en la UI.
- **Subject-To y la cláusula de vencimiento anticipado (*due-on-sale*).** Transferir el inmueble
  dejando la hipoteca a nombre del vendedor típicamente **dispara** el derecho del acreedor a
  exigir el saldo. No es ilegal, pero es un riesgo material que el producto no puede ocultar.
- **Wholesaling.** Varios estados exigen licencia inmobiliaria o restringen la publicidad del
  contrato en lugar de la propiedad. Depende del estado donde opere cada tenant.
- **Fair Housing Act.** Cualquier filtro, targeting o scoring que correlacione con clase protegida
  (raza, origen nacional, familia, discapacidad) en marketing de vivienda es exposición directa.
  Un producto multi-tenant que deja a cada tenant definir sus filtros **hereda** ese riesgo.
- **Escrow y movimiento de fondos.** Un marketplace que retiene fondos, controla el timing de
  liquidación y paga a terceros puede caer bajo las leyes estatales de **money transmission**. La
  excepción de *agent of payee* (del modelo MTMA de la CSBS) la reconocen la mayoría de los
  estados, pero cada uno la define distinto y se interpretan de forma restrictiva
  ([Ridgeway](https://www.ridgewayfs.com/money-transmitter-license-guide/),
  [Faisal Khan](https://faisalkhan.com/solutions/licensing/money-transmitter-license/agent-of-payee-exemption)).
  **Aplica igual a Marex y a Comunidad Latina** si hay pagos entre usuarios. La salida estándar
  es usar Stripe Connect / un custodio licenciado y **no** tocar los fondos. Verificable: ¿existe
  alguna cuenta bancaria del cliente por donde pasa dinero de terceros? Si sí, hay tema. 🧑‍⚖️

### 2.7 Datos de actividad física y salud (iRowing) 🔴 Bloqueante si hay usuarios en Washington

- **Cuándo cruza a sensible:** los datos de rendimiento en un ergómetro (potencia, ritmo, tiempo)
  son datos de actividad física. Se vuelven **datos de salud** cuando incluyen o permiten inferir
  estado fisiológico — **frecuencia cardíaca**, peso, signos vitales, lesiones, o cualquier
  inferencia de condición física.
- **La norma que muerde:** la **My Health My Data Act** de Washington (RCW 19.373), vigente desde
  el 31-mar-2024. Su definición de "consumer health data" es lo bastante amplia para capturar datos
  de salud, bienestar, nutrición y **fitness**, o datos usados para inferirlos. Exige
  **consentimiento opt-in de nivel GDPR** para cualquier tratamiento más allá de lo necesario para
  prestar el servicio que el usuario pidió, y — esto es lo caro — tiene **derecho privado de
  acción** vía la Consumer Protection Act de Washington. Ya hay acciones de clase desde 2025
  ([Clark Hill](https://www.clarkhill.com/news-events/news/its-here-the-who-what-and-how-of-washingtons-new-my-health-my-data-act-and-its-private-right-of-action/),
  [California Lawyers Association](https://calawyers.org/privacy-law/the-washington-my-health-my-data-act-not-just-washington-or-health/)).
  Nevada tiene una ley paralela (SB 370) sin derecho privado de acción.
- **La trampa del nombre:** "My Health My Data" no se limita a residentes de Washington en el
  sentido intuitivo — cubre a consumidores de Washington y a datos recolectados **en** Washington.
  Una app de deporte distribuida en las tiendas de EE.UU. tiene usuarios de Washington por defecto,
  salvo geobloqueo explícito.
- **Además:** las 20 leyes estatales tratan los datos de salud como **categoría sensible con
  opt-in**, no opt-out. Y si hay datos de menores deportistas, se suma COPPA.
- **Cómo se ve bien:** consentimiento **separado y específico** para datos de salud (no dentro del
  consentimiento general), pantalla propia, revocable, registrado con versión de texto; y una
  decisión explícita y documentada sobre si la app captura frecuencia cardíaca — porque ese solo
  campo cambia el régimen. 🧑‍⚖️
- **HIPAA no aplica** salvo que iRowing procese datos por cuenta de un prestador de salud o
  aseguradora. Es el error de encuadre más común en apps de fitness: se invoca HIPAA, que no
  aplica, y se ignora MHMDA, que sí.

### 2.8 UE / GDPR — cuándo alcanza de verdad 🟡 Medio (para los 4, hoy)

**Sé preciso acá: GDPR no aplica solo por tener un sitio accesible desde Europa.**

Aplica si se cumple alguno de los dos criterios del Art. 3:
1. **Establecimiento** en la UE (Art. 3(1)) — oficina, sucursal, empleado estable. Ninguno de los
   4 productos lo tiene, según lo informado.
2. **Targeting o monitoreo** (Art. 3(2)) — ofrecer bienes o servicios a personas **en** la UE, o
   monitorear su comportamiento en la UE.

La EDPB (Guidelines 3/2018) es explícita: la oferta debe ser **intencional**, no incidental. Y
si un servicio se ofrece solo a personas fuera de la UE, el hecho de no retirarlo cuando esa
persona entra a la UE **no** somete el tratamiento al GDPR
([EDPB](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf),
[Hintze Law](https://hintzelaw.com/blog/2018/12/3/is-our-us-company-subject-to-gdpr)).
Tampoco te somete al GDPR el solo hecho de contratar un procesador establecido en la UE.

**Indicadores de targeting** que sí lo disparan: precios en euros, idioma de un estado miembro que
no sea el propio, dominio `.de`/`.fr`/`.es`, publicidad dirigida a usuarios de la UE, envíos o
soporte a países de la UE, menciones a clientes europeos.

**Indicadores de monitoreo:** tracking de comportamiento, perfilado y publicidad comportamental
sobre personas que están en la UE — y esto **sí** puede alcanzar a un sitio que no vende en la UE
si le pone píxeles de retargeting a todo el tráfico.

**Conclusión operativa:** hoy, para los 4, GDPR es probablemente **no aplicable** — con dos
salvedades: (a) Comunidad Latina, si tiene o busca usuarios hispanohablantes **en España**, lo
dispara de lleno; (b) cualquiera de los 4, si hace retargeting sin filtro geográfico, entra por la
puerta del monitoreo. **Criterio propio: no es motivo para ignorar el GDPR. El estándar GDPR es el
techo; construir contra él resuelve las 20 leyes estatales de EE.UU. de arriba.** Lo que sí evita
es gastar en un DPO, un representante en la UE (Art. 27) y un registro de actividades (Art. 30)
que hoy no hacen falta.

### 2.9 Latinoamérica (relevante para Comunidad Latina) 🟠 Alto

Lo mínimo que **cambia** respecto de lo anterior:

| País | Norma | Qué cambia |
|---|---|---|
| **Brasil** | LGPD (Lei 13.709/2018) | Muy cercana al GDPR: 10 bases legales, derechos amplios, **encargado de datos (DPO) obligatorio** para el controlador, y transferencias internacionales reguladas por la Resolución ANPD **19/2024** con cláusulas contractuales estándar ([Mattos Filho](https://www.mattosfilho.com.br/en/unico/regulates-international-data-transfers/)). Multas hasta 2% de la facturación en Brasil, tope R$50M por infracción |
| **México** | **Nueva LFPDPPP**, publicada 20-mar-2025, **en vigor desde el 21-mar-2025** — abroga la de 2010. La supervisión pasó del extinto INAI a la Secretaría Anticorrupción y Buen Gobierno ([Basham](https://basham.com.mx/en/nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares-publicada-en-el-diario-oficial-de-la-federacion/), [Greenberg Traurig](https://www.gtlaw.com/en/insights/2025/3/nueva-ley-general-proteccion-de-datos)) | Sigue el modelo del **aviso de privacidad** (documento con contenido tasado, distinto de una privacy policy estilo EE.UU.) y de los **derechos ARCO**. Régimen más estricto que el anterior |
| **Chile** | **Ley 21.719**, publicada 13-dic-2024, **vigencia 1-dic-2026** ([Prey](https://preyproject.com/es/blog/ley-de-proteccion-de-datos-en-chile), [Recording Law](https://www.recordinglaw.com/es/world-laws/world-data-privacy-laws/chile-data-privacy-laws/)) | Salto de régimen: nueva Agencia de Protección de Datos, derechos ARCO completos, **notificación de brechas en 72 h**, y multas de hasta **20.000 UTM** o 4% de los ingresos en reincidencia. Modelo europeo |
| **Colombia** | Ley 1581/2012 | **Registro Nacional de Bases de Datos** ante la SIC — obligación registral que no existe en los otros países. Autorización previa como base principal |
| **Argentina** | Ley 25.326 (1999) | Régimen viejo; **Argentina tiene decisión de adecuación de la UE**, lo que facilita transferencias. Reforma en trámite legislativo desde hace años — no dar por vigente ningún proyecto |

**Denominador común LATAM, distinto de EE.UU.:**
1. El modelo es **opt-in / autorización previa**, no opt-out.
2. El documento se llama **aviso de privacidad** y tiene contenido tasado que difiere país por país.
3. Los derechos se llaman **ARCO** (Acceso, Rectificación, Cancelación, Oposición) y hay que
   nombrarlos así en el texto, no traducir de un template estadounidense.
4. El idioma importa: el aviso debe estar en español, y en Brasil en portugués.
5. Varios exigen designar un responsable/encargado con datos de contacto publicados.

**Criterio propio para Comunidad Latina:** un solo aviso de privacidad "para LATAM" no cumple bien
en ningún lado. Lo defendible es un aviso base + anexos por país, servidos según el país
declarado del tenant o del usuario. 🧑‍⚖️

### 2.10 Tiendas de apps (Marex e iRowing) 🔴 Bloqueante

No es ley, pero el efecto es peor que una multa: **no publicás, o te bajan la app.** Misma
prioridad.

| Requisito | Apple | Google Play |
|---|---|---|
| **Borrado de cuenta** | Guideline **5.1.1(v)**, obligatorio desde el **30-jun-2022** para toda app que permita crear cuenta. Debe poder **iniciarse dentro de la app** (típicamente en ajustes de cuenta). Linkear a una web para *completar* el borrado se acepta; obligar a salir de la app para *iniciarlo*, no. **Ofrecer solo desactivar o deshabilitar NO alcanza.** Tampoco alcanza mandar a un mail, un teléfono o un flujo de soporte. Hay que borrar el registro de cuenta y los datos personales asociados, incluido el contenido generado por el usuario, salvo lo que la ley obligue a conservar ([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)) | Exigido por la User Data policy, en enforcement pleno desde el **15-abr-2024**. Se exigen **dos** rutas: (a) ruta **dentro de la app** para borrar cuenta y datos asociados, **y** (b) un **link web** accesible desde fuera de la app para pedir el borrado, declarado en el formulario de Data safety ([Google Play](https://support.google.com/googleplay/android-developer/answer/13327111)) |
| **Declaración de datos** | *Privacy Nutrition Labels* en App Store Connect: qué se recolecta, para qué, y si se vincula a la identidad o se usa para tracking. Además, si hay tracking entre apps de terceros, **App Tracking Transparency** con el prompt de sistema | **Data safety form** obligatorio, incluyendo las preguntas de borrado de datos. Debe **coincidir** con lo que la app hace y con la política de privacidad |
| **Permisos** | Cada permiso necesita un *purpose string* en `Info.plist` que explique el uso real. iRowing: `NSBluetoothAlwaysUsageDescription` es obligatorio | Android 12+: `BLUETOOTH_SCAN` con `android:usesPermissionFlags="neverForLocation"` **si no se deriva ubicación** — sin eso, Google puede exigir permiso de ubicación y la declaración correspondiente, y el revisor pregunta |
| **Política de privacidad** | Link obligatorio en la ficha **y** accesible dentro de la app | Igual |

- **El error que cuesta el rechazo, en los dos:** que el Data safety form / nutrition label diga
  una cosa y el tráfico de red de la app diga otra. Ambas tiendas comparan. Cada SDK que agregás
  (analytics, crash reporting, ads) cambia lo que hay que declarar.
- **Verificable:** para cada SDK del `pubspec.yaml`, existe una línea correspondiente en el
  formulario de la tienda y en la política de privacidad. Si el conteo no da, hay una omisión.
- **Riesgo particular de iRowing:** si captura frecuencia cardíaca, la declaración de "Health and
  fitness" en Google Play y "Health & Fitness" en Apple es obligatoria, y ambas tiendas aplican
  reglas extra a esa categoría (prohibición de usarla para publicidad, entre otras).

---

## 3. Matriz producto × requisito

Leyenda: **✅ Aplica** · **➖ No aplica** · **❓ Aplica si** (condición ⇒ ver preguntas abiertas al pie)

### 3.1 Transversal

| # | Requisito | RDX | Marex | Comunidad Latina | iRowing |
|---|---|---|---|---|---|
| C-01 | Bloqueo de scripts pre-consentimiento | ✅ | ✅ (admin web) | ✅ | ❓ solo si hay web/landing |
| C-02 | Régimen opt-in vs opt-out por geo | ❓ P-1 | ❓ P-1 | ✅ (LATAM+EE.UU. ⇒ ambos) | ❓ P-1 |
| C-03 | Honrar GPC | ✅ (usuarios EE.UU.) | ✅ | ❓ P-1 | ➖ (no aplica en app nativa; ✅ si hay web) |
| C-04 | Registro auditable de consentimiento | ✅ | ✅ | ✅ | ✅ |
| C-05 | Revocación tan fácil como el alta | ✅ | ✅ | ✅ | ✅ |
| P-01 | Política de privacidad con contenido mínimo | ✅ | ✅ | ✅ | ✅ |
| P-02 | Versionado + prueba de aceptación | ✅ | ✅ | ✅ | ✅ |
| P-03 | Términos con límite de responsabilidad y foro | ✅ | ✅ | ✅ | ✅ |
| D-01 | Acceso / exportación | ✅ | ✅ | ✅ | ✅ |
| D-02 | Borrado real | ✅ | ✅ | ✅ | ✅ |
| D-03 | Rectificación | ✅ | ✅ | ✅ | ✅ |
| D-04 | Prueba de cumplimiento del pedido | ✅ | ✅ | ✅ | ✅ |
| R-01 | Tabla de retención declarada y ejecutada | ✅ | ✅ | ✅ | ✅ |
| R-02 | Minimización en captura | ✅ | ✅ | ✅ | ✅ |
| T-01 | Inventario de terceros + DPA | ✅ | ✅ | ✅ | ✅ |
| T-02 | Transferencias internacionales | ➖ salvo P-1 | ➖ salvo P-1 | ✅ | ❓ P-1 |
| M-01 | Menores / edad mínima | ➖ (B2B, propietarios) | ❓ P-6 | ✅ | ❓ P-7 |
| S-01 | Plan de notificación de brechas | ✅ | ✅ | ✅ | ✅ |
| S-02 | Medidas técnicas apropiadas | ✅ | ✅ | ✅ | ✅ |
| IA-01 | Divulgación de IA | ❓ P-8 | ❓ P-8 | ❓ P-8 | ❓ P-8 |
| IA-02 | Decisiones automatizadas (ADMT) | ❓ P-5 | ❓ **P-4 — el más probable** | ➖ salvo moderación automática con sanción | ➖ |
| IA-03 | Límites de uso de datos con LLM | ❓ P-8 | ❓ P-8 | ❓ P-8 | ❓ P-8 |

### 3.2 Jurisdiccional / vertical

| # | Requisito | RDX | Marex | Comunidad Latina | iRowing |
|---|---|---|---|---|---|
| 2.1 | TCPA — consentimiento, ventana horaria, opt-out | ✅ **crítico** | ❓ P-3 (notificaciones a trabajadores) | ❓ P-3 | ➖ salvo SMS |
| 2.1 | FTSA Florida — 8–20 h, 3/24 h, cura 15 días | ✅ **crítico** | ❓ P-2 | ❓ P-2 | ➖ |
| 2.2 | CAN-SPAM | ✅ | ✅ | ✅ | ❓ si hay email marketing |
| 2.3 | Leyes estatales de privacidad (umbral) | ❓ P-2 (Texas puede aplicar sin umbral) | ❓ P-2 | ❓ P-2 | ❓ P-2 |
| 2.4 | FCRA — disclosure standalone + adverse action | ➖ | ✅ **crítico** | ➖ | ➖ |
| 2.4 | Riesgo de ser CRA por compartir el resultado | ➖ | ❓ **P-4** | ➖ | ➖ |
| 2.5 | Skip-trace — trazabilidad de origen del dato | ✅ **crítico** | ➖ | ➖ | ➖ |
| 2.6 | Dodd-Frank / SAFE Act — seller finance | ✅ 🧑‍⚖️ | ➖ | ➖ | ➖ |
| 2.6 | Fair Housing en filtros y targeting | ✅ 🧑‍⚖️ | ➖ | ➖ | ➖ |
| 2.6 | Money transmission / escrow | ❓ P-5 | ❓ P-5 | ❓ P-5 | ➖ |
| 2.7 | MHMDA Washington — datos de salud, opt-in | ➖ | ➖ | ➖ | ❓ **P-7 — probable** |
| 2.8 | GDPR | ➖ (EE.UU. only) | ➖ salvo P-1 | ❓ **P-1 — España** | ❓ P-1 |
| 2.9 | LATAM — aviso ARCO, LGPD, Ley 21.719, RNBD | ➖ | ❓ P-1 | ✅ **crítico** | ❓ P-1 |
| 2.10 | Borrado de cuenta desde la app (Apple/Google) | ➖ | ✅ **bloqueante** | ➖ salvo app | ✅ **bloqueante** |
| 2.10 | Data safety / nutrition labels coherentes | ➖ | ✅ **bloqueante** | ➖ salvo app | ✅ **bloqueante** |
| 2.10 | Permisos justificados (BLUETOOTH_SCAN, etc.) | ➖ | ❓ ubicación/cámara | ➖ | ✅ Bluetooth |
| — | DMCA §512 — agente designado + notice&takedown | ➖ | ➖ | ✅ **crítico** | ➖ |
| — | Sección 230 / moderación de UGC | ➖ | ❓ (reseñas) | ✅ | ➖ |
| — | Clasificación de trabajadores (contractor vs empleado) | ➖ | ✅ 🧑‍⚖️ | ➖ | ➖ |

**Nota sobre UGC (Comunidad Latina):** el safe harbor de DMCA §512(c) exige **designar un agente
ante la Copyright Office y renovar la designación al menos cada 3 años**; el trámite cuesta **$6**
y cualquier lapso en el registro es un lapso en la protección
([Fross Zelnick](https://www.frosszelnick.com/u-s-copyright-office-renewal-of-dmca-designated-agent-required-for-dmca-safe-harbor/),
[Copyright Office](https://www.copyright.gov/onlinesp/tutorials/transcripts/renew.pdf)).
Es la relación costo/beneficio más alta de todo el documento: seis dólares y un formulario
protegen contra responsabilidad por infracción de copyright de los usuarios.

### 3.3 Preguntas que cierran los "Aplica si"

Están consolidadas en la §6.

---

## 4. Las 10 cosas que romperían primero

Ordenadas por probabilidad × costo. "A quién le pega": la **agencia** (Insights) o el **cliente** —
en varios casos a los dos, porque quien opera el sistema puede ser codemandado.

| # | Qué pasa | A quién le pega | El mínimo que la evita |
|---|---|---|---|
| **1** | **RDX manda SMS a propietarios sin consentimiento.** Uno solo llega a un número de Florida: $500 base, triplicable, más el TCPA federal a $500–$1.500 por mensaje. Una campaña de 5.000 mensajes es exposición de siete cifras y hay estudios jurídicos que viven de esto | Cliente **y agencia** (quien opera el sistema de envío) | No enviar hasta cerrar con el abogado de Florida. Mientras tanto, gate técnico que impida el envío sin fila de consentimiento vigente — no una política escrita, un `if` que tire error |
| **2** | **Marex rechaza a un trabajador por antecedentes sin el proceso de dos pasos**, o con el disclosure metido dentro de los T&C. Daños de $100–$1.000 + punitivos + **honorarios de abogado**, que es lo que lo hace viable como acción individual y de clase | Cliente (empleador) **y agencia** si diseñó el flujo | Pantalla de disclosure standalone + estado `pre_adverse_sent` con plazo que el sistema no deja saltear + plantilla de adverse action versionada |
| **3** | **Rechazo o takedown en la tienda** por borrado de cuenta ausente o incompleto, o por Data safety que no coincide con el tráfico real de la app | Cliente (no factura) **y agencia** (no entrega) | Flujo de borrado in-app real (§5.2) + link web para Google + auditar SDK contra formulario antes de subir |
| **4** | **Banner de cookies que carga GTM/Meta antes del consentimiento** ⇒ demanda CIPA en California. No hace falta que el tribunal te dé la razón: el costo de defensa y el acuerdo llegan igual | Cliente **y agencia** (fue decisión de implementación) | Bloqueo real verificado en el panel Network con pestaña nueva. Es media jornada de trabajo |
| **5** | **"Borrar cuenta" que solo desactiva.** Contradice tu propia política de privacidad — que es lo que convierte un bug en una práctica engañosa (FTC Act §5) y en incumplimiento del derecho de supresión | Cliente, y la agencia ante el cliente | Implementar el contrato de borrado de §5.2 y **que la política diga exactamente eso** |
| **6** | **iRowing captura frecuencia cardíaca sin consentimiento opt-in específico** ⇒ MHMDA de Washington, que **tiene derecho privado de acción** y ya generó acciones de clase | Cliente **y agencia** | Decidir explícitamente si se captura HR. Si sí: consentimiento separado, propio, versionado y revocable |
| **7** | **Brecha en Supabase sin plan de notificación.** Los relojes corren desde la detección: 30 días a residentes de California, 15 días al AG si son 500 o más. Se pierden por no saber a quién avisar, no por mala fe | Cliente, con daño reputacional directo a la agencia | Runbook de una carilla + logs que permitan determinar el alcance |
| **8** | **Comunidad Latina sin agente DMCA registrado.** Un usuario sube material con copyright y la plataforma responde por infracción sin safe harbor | Cliente | $6 y un formulario. Más un flujo de notice & takedown |
| **9** | **Marex usa un algoritmo para decidir qué trabajador entra o cuánto cobra**, sin aviso previo ni apelación humana ⇒ régimen ADMT de California (vigente 1-ene-2027, evaluaciones de riesgo ya desde 1-ene-2026) | Cliente | Aviso previo + botón de apelación a revisión humana. Barato ahora, caro de retrofittear |
| **10** | **Datos personales mandados a un LLM sin DPA ni mención en la política.** Transferencia no cubierta; en varios estados eso califica como "venta" de datos y dispara todo el régimen de opt-out | Cliente **y agencia** (eligió el proveedor) | Aceptar el DPA del proveedor, listarlo como subencargado en la política, y verificar el opt-out de entrenamiento |

**Menciones que quedaron afuera del top 10 pero están cerca:** email sin domicilio postal físico
(CAN-SPAM, $53.088/mensaje — probabilidad de detección baja, costo enorme); RDX facilitando
estructuras de seller finance sin balloon-check (Dodd-Frank); clasificación de trabajadores en
Marex; y fondos de terceros pasando por una cuenta del cliente (money transmission).

---

## 5. Plantillas de implementación

Reutilizables entre los 4. Adaptar nombres al esquema de cada producto.

### 5.1 Tabla de registro de consentimientos

```sql
create table consent_records (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,              -- multi-tenant: siempre presente, siempre primero en el índice
  subject_id     uuid,                       -- FK al usuario si existe
  subject_key    text not null,              -- email/teléfono normalizado E.164/device_id: identifica al no registrado
  purpose        text not null,              -- 'analytics'|'marketing_email'|'marketing_sms'|'health_data'|'ai_processing'|'background_check'
  granted        boolean not null,
  policy_version text not null,              -- '2026-08-01' o 'v2.3' — apunta a un archivo versionado en el repo
  text_hash      text not null,              -- sha256 del texto EXACTO mostrado
  text_locale    text not null,              -- 'es-419'|'en-US'|'pt-BR' — importa para FCRA y LATAM
  method         text not null,              -- 'banner'|'checkbox'|'double_optin'|'gpc'|'api'|'imported'
  evidence       jsonb,                      -- screenshot_url, form_id, mensaje de double opt-in, etc.
  ip             inet,
  user_agent     text,
  occurred_at    timestamptz not null default now(),
  expires_at     timestamptz,                -- si la jurisdicción o el propio texto fijan vencimiento
  source_ref     text                        -- para datos importados: de dónde vino
);

create index on consent_records (tenant_id, subject_key, purpose, occurred_at desc);
```

**Por qué cada columna:**

| Columna | Por qué |
|---|---|
| `tenant_id` | Aislamiento multi-tenant; el consentimiento dado a un tenant **no** vale para otro. En RDX esto es doctrina de producto, no solo técnica |
| `subject_key` | El consentimiento suele darse **antes** de existir el usuario (banner, lead form). Sin esto no se puede probar nada de la etapa anónima |
| `purpose` | GDPR/LGPD exigen consentimiento **por finalidad**; un consentimiento genérico no es válido. Además permite revocar una finalidad sin tumbar las otras |
| `granted` + append-only | Revocar = insertar `false`. Nunca `UPDATE`. Un registro que se puede editar no prueba nada |
| `policy_version` + `text_hash` | **Lo que hace el registro oponible.** Sin el texto exacto, no podés demostrar qué aceptó. El hash detecta si el archivo versionado se alteró |
| `text_locale` | FCRA: el documento entregado debe ser comprensible por el trabajador. LATAM: el aviso debe estar en el idioma local |
| `method` | Distingue un opt-in explícito de una señal GPC de un dato importado. Un `imported` sin `source_ref` es un consentimiento que no podés defender |
| `evidence` | Para TCPA/FCRA, la captura del formulario tal como se vio es la prueba que gana el caso |
| `ip` / `user_agent` | Atribución. Ojo: son datos personales, entran en la retención |
| `occurred_at` | El timestamp es el dato central |
| `expires_at` | Algunas jurisdicciones y algunos textos limitan la vigencia; sin esta columna el sistema asume "para siempre", que no siempre es cierto |

**Reglas de la tabla (no negociables):**
- `REVOKE update, delete` a todos los roles de aplicación. Append-only real, no por convención.
- RLS habilitada y forzada, con policy de `select` e `insert` únicamente.
- El estado vigente se calcula con `distinct on (subject_key, purpose) ... order by occurred_at desc` —
  no se cachea en la fila del usuario como única fuente de verdad. Un campo `users.marketing_ok`
  puede existir como caché, pero la tabla manda.
- **Se conserva más allá del borrado de la cuenta** (ver 5.2): es prueba de una obligación legal.

### 5.2 Contrato de la función de borrado de cuenta

Tres categorías, decididas por adelantado y documentadas **en la política de privacidad con las
mismas palabras**.

```
deleteAccount(user_id, reason) -> DeletionReceipt
```

| Categoría | Qué entra | Cómo |
|---|---|---|
| **BORRAR** (hard delete) | Perfil, credenciales, avatar y demás archivos en Storage, mensajes privados, contactos, preferencias, datos de dispositivo, tokens push, tokens OAuth, entradas en la tabla de sesiones, y **datos de categoría sensible sin excepción** (salud, biométricos, antecedentes) | `DELETE` real, en transacción, incluyendo objetos de Storage. Verificable: correr el export (D-01) después del borrado devuelve vacío |
| **ANONIMIZAR** | Contenido que otros usuarios necesitan y que perdería sentido al desaparecer: reseñas, posts en hilos con respuestas, registros de transacciones para la contraparte, métricas agregadas | Reemplazar la FK por un `deleted_user` sentinel; **borrar** todo campo de texto libre escrito por el usuario que pueda contener datos personales; y **romper el vínculo de forma irreversible** (nada de guardar un mapa de reversión — eso es seudonimización, no anonimización, y sigue siendo dato personal) |
| **CONSERVAR** | Solo lo que una obligación legal concreta exige, con su plazo. Cada línea lleva la norma al lado | Mover a una tabla server-only con RLS deny-all, fuera del alcance de la aplicación |

**Ejemplo de tabla CONSERVAR (adaptar por producto — el plazo se confirma con abogado):**

| Dato | Por qué se conserva | Plazo típico | 🧑‍⚖️ |
|---|---|---|---|
| Registros fiscales de transacciones | Obligación tributaria | 7 años (EE.UU. federal; varía por estado y país) | sí |
| Registro de opt-out / lista de supresión | **Necesario para no volver a contactar.** Si borrás el opt-out, la próxima campaña le escribe otra vez y ahí sí hay violación TCPA | Indefinido, minimizado a un **hash** del teléfono/email | sí |
| `consent_records` | Prueba de cumplimiento | Mientras dure el plazo de prescripción (TCPA: 4 años federal) | sí |
| `dsr_requests` | Prueba de que se atendió el pedido | 2–3 años | sí |
| Registros FCRA (disclosure, autorización, adverse action) | Prueba del proceso | 5 años (`PRÁCTICA`; confirmar) | sí |
| Logs de seguridad | Investigación de incidentes, obligación de medidas apropiadas | 6–12 meses | no |

**Contrato de la función:**
1. **Idempotente** — llamarla dos veces no rompe ni falla.
2. **Transaccional** — o borra todo o no borra nada. Un borrado a medias es peor que ninguno.
3. **Asíncrona con SLA declarado** — se acepta hacerlo en un job (Apple lo permite explícitamente),
   pero el usuario ve el plazo ("hasta 30 días") y el sistema lo cumple. Si hay ventana de
   arrepentimiento, es **corta** (≤14 días), está declarada, y durante ella la cuenta **no es
   utilizable** — si no, es desactivación disfrazada.
4. **Devuelve un recibo** — `DeletionReceipt` con `request_id`, `completed_at`, tablas afectadas y
   conteo de filas. Se guarda (categoría CONSERVAR) y se le manda al usuario. Es la prueba de D-04.
5. **Propaga a terceros** — dispara el borrado en cada procesador que tenga copia (analytics,
   proveedor de email, CRM, proveedor de IA). Un borrado que no propaga no es un borrado.
   Verificable: existe una lista de destinos de propagación y cada uno tiene su llamada.
6. **Cubre auth** — borrar de `auth.users` de Supabase, no solo de las tablas de negocio.

### 5.3 Gestor de consentimiento de cookies que bloquea de verdad

**Categorías** (usar estas cuatro; más categorías confunden y no agregan cumplimiento):

| Categoría | Qué entra | Consentimiento |
|---|---|---|
| `necessary` | Sesión, auth, CSRF, balanceo, preferencia de idioma, **la propia cookie de consentimiento** | No requiere. No se puede desactivar |
| `functional` | Preferencias no esenciales, chat de soporte, video embebido | Requiere |
| `analytics` | GA4, Plausible, Hotjar, session replay, heatmaps | Requiere |
| `marketing` | Meta Pixel, Google Ads, TikTok, retargeting, atribución | Requiere. **Es la categoría que dispara CIPA y "venta de datos"** |

**Orden de carga (el corazón del asunto):**

```
1. HTML del servidor. Middleware ya leyó `Sec-GPC` y la cookie de consentimiento
   y los inyectó en el estado inicial. → sin flash, sin race condition
2. Solo scripts `necessary`. Nada de terceros. Ni fuentes remotas.
3. Render del banner (si no hay decisión previa registrada).
4. Usuario decide → se persiste (cookie + fila en consent_records).
5. Se emite un evento `consent:changed` con las categorías otorgadas.
6. Un único loader escucha el evento e inyecta los scripts de las categorías otorgadas.
   Los <script> preexistentes están como type="text/plain" y recién ahí se activan.
7. Al revocar: se remueven los scripts, se borran las cookies de esa categoría
   (incluyendo las de dominio padre) y se recarga si el SDK no soporta teardown limpio.
```

**Persistencia:**
- Cookie `first-party`, `SameSite=Lax`, `Secure`, sin `HttpOnly` (el cliente la necesita), con
  **la versión del texto** dentro del valor: `{v:"2026-08-01", cats:["necessary","analytics"], ts:...}`.
- Vigencia máxima **12 meses** (`PRÁCTICA` alineada con la posición de varias autoridades europeas);
  al vencer, se vuelve a preguntar.
- **Si cambia la versión del texto o la lista de terceros, el consentimiento anterior no vale** y se
  vuelve a preguntar. Esto es lo que hace que el versionado sirva para algo.
- Fila espejo en `consent_records` (§5.1) apenas haya identificador; antes, con `subject_key` =
  id anónimo de la cookie.

**Revocación:** link permanente en el footer de **todas** las páginas, incluidas las de la app
logueada, con el mismo peso visual que los términos.

**Requisitos de UI que son legales, no estéticos:**
- "Rechazar todo" al mismo nivel visual, mismo tamaño, mismo contraste y en la **misma capa** que
  "Aceptar todo". Esconderlo detrás de "Configurar" es un dark pattern sancionable en la UE.
- Ningún toggle premarcado salvo `necessary`.
- Cerrar el banner con la X o con Escape = **rechazar**, nunca aceptar.
- Seguir navegando sin decidir ≠ consentimiento.

### 5.4 Índice mínimo de una política de privacidad oponible

No redactar los textos acá — se hacen por producto. Este es el esqueleto y el criterio.

```
0.  Metadatos: versión, fecha de vigencia, link al historial de versiones
1.  Quiénes somos — razón social completa, domicilio, email de contacto de privacidad
    · Comunidad Latina/LATAM: nombrar al responsable/encargado
    · Si GDPR aplicara: representante en la UE (Art. 27) y DPO si corresponde
2.  A quién aplica — usuarios, visitantes, y (Marex/RDX) terceros cuyos datos procesamos
    sin que sean usuarios ← sección que casi todas las políticas omiten y que en RDX es central
3.  Qué datos recogemos — por categoría, con ejemplos concretos:
    3.1 Los que nos das      3.2 Los que se generan por el uso
    3.3 Los que obtenemos de terceros ← origen nombrado (REAPI, skip-trace, CRA)
    3.4 Datos sensibles      ← subsección propia si hay salud, biométricos o antecedentes
4.  Para qué los usamos — finalidad por finalidad, con la base legal al lado
    (consentimiento / contrato / interés legítimo / obligación legal)
5.  Cookies y tecnologías similares — o link a una política de cookies aparte, con la
    tabla de cookies concretas (nombre, proveedor, finalidad, duración)
6.  Con quién los compartimos — proveedores NOMBRADOS por categoría, con país de
    procesamiento. Nada de "proveedores de confianza"
    6.1 Declaración explícita de si hay o no "venta"/"compartición" en el sentido de las
        leyes estatales de EE.UU.
7.  Transferencias internacionales — a dónde y con qué mecanismo
8.  Cuánto tiempo los guardamos — la tabla de retención (R-01), con plazos reales
9.  Tus derechos — nombrados como los nombra cada jurisdicción:
    9.1 GDPR/UE   9.2 EE.UU. por estado (incl. "Do Not Sell or Share" y GPC)
    9.3 LATAM: derechos ARCO   9.4 Cómo ejercerlos, plazo de respuesta, y cómo
        verificamos identidad   9.5 Derecho a reclamar ante la autoridad, nombrada
10. Menores — edad mínima y qué hacemos si detectamos una cuenta de menor
11. Seguridad — medidas, en términos verificables y sin prometer lo imposible
12. Inteligencia artificial — qué procesa IA, qué proveedor, si hay decisiones
    automatizadas y cómo apelarlas ← sección propia, no un párrafo escondido
13. Cambios a esta política — cómo se avisa y desde cuándo rigen
14. Contacto
```

**Criterio de suficiencia:** una persona sin formación legal puede responder, leyendo solo esto,
las seis preguntas de P-01. Si tiene que inferir algo, falta.

**Reglas de forma que afectan la oponibilidad:**
- Vive en el repo, versionada en git, servida desde el producto. No en un CMS sin historial.
- Cada versión queda accesible por URL propia (`/legal/privacidad/2026-08-01`) — es lo que hace
  que `policy_version` en `consent_records` signifique algo.
- Idioma del usuario. Un template en inglés para un producto de público hispanohablante es un
  problema de cumplimiento en LATAM, no un detalle de UX.
- Fecha de vigencia visible arriba, no en el pie.

---

## 6. Cierre operativo

### 6.1 Preguntas que hay que responder para cerrar los "Aplica si"

Sin estas respuestas, la matriz no se puede cerrar. **No las inventé — hay que preguntarlas.**

| # | Pregunta | Qué desbloquea |
|---|---|---|
| **P-1** | **¿En qué países y estados están los usuarios reales de cada producto?** En particular: ¿Comunidad Latina tiene o busca usuarios **en España**? ¿iRowing y Marex se distribuyen en las tiendas de la UE? | GDPR sí/no; régimen opt-in vs opt-out; qué leyes LATAM aplican; región del proyecto Supabase |
| **P-2** | **¿Alguno de los clientes supera $26,6M de facturación anual, o 100.000 residentes de un mismo estado en la base?** ¿Alguno hace negocios en **Texas** (que no tiene umbral de volumen)? | Si aplican las leyes estatales de privacidad de EE.UU. como obligación o solo como estándar voluntario |
| **P-3** | **En RDX: ¿el SMS es en frío a propietarios de skip-trace, o hay algún punto donde la persona da su número y consiente?** ¿Y en Marex/Comunidad Latina, los SMS son transaccionales (código de verificación, aviso de trabajo asignado) o hay alguno promocional? | Si TCPA/FTSA es bloqueante absoluto o gestionable. Los transaccionales tienen tratamiento distinto de los de marketing |
| **P-4** | **En Marex: ¿qué se le muestra exactamente al cliente que contrata sobre el resultado del background check?** ¿Un "verificado" sí/no, o el detalle? ¿Se comparte entre tenants o con terceros? | Si Marex se convierte en consumer reporting agency — el riesgo más caro y menos visible del portafolio |
| **P-5** | **¿Algún producto retiene o mueve dinero de terceros por una cuenta del cliente?** (escrow de RDX, pagos a trabajadores en Marex, pagos entre usuarios en Comunidad Latina) ¿O todo pasa por Stripe Connect / un custodio licenciado? | Money transmission estatal; y en RDX, quién es el custodio de escrow (parámetro que el manual del producto todavía tiene abierto) |
| **P-6** | **¿Los trabajadores de Marex son contratistas independientes o empleados, y en qué estados?** | FCRA aplicada a contratistas; ban-the-box estatal; clasificación laboral (AB5 en California) |
| **P-7** | **¿iRowing captura o va a capturar frecuencia cardíaca u otro dato fisiológico además de potencia/ritmo/tiempo?** ¿Tiene usuarios menores de edad (categorías junior)? | MHMDA de Washington (derecho privado de acción) y COPPA. Este solo campo cambia el régimen entero |
| **P-8** | **¿Qué producto usa hoy un modelo de lenguaje sobre datos de usuarios, con qué proveedor, y para qué exactamente?** ¿Alguno de esos outputs decide algo sobre una persona (matching, scoring, ranking, moderación con sanción)? | IA-01/02/03 y el régimen ADMT de California, que empieza a exigir evaluaciones de riesgo desde el 1-ene-2026 |

### 6.2 Puntos que exigen abogado matriculado antes de producción 🧑‍⚖️

Ordenados por urgencia. Cada uno con la pregunta concreta a hacerle, para que la consulta no se
desperdicie.

| # | Punto | Jurisdicción | Pregunta concreta |
|---|---|---|---|
| **1** | **SMS/voz en frío de RDX** (ya hay tema abierto con abogado de Florida) | Florida + federal | ¿Existe alguna vía de contacto inicial lícita sin consentimiento previo? ¿Cambia si la llamada es manual en vez de SMS automatizado? ¿Qué exposición tiene **Insights** como operador del sistema de envío, además del cliente? |
| **2** | **Marex como posible consumer reporting agency** | EE.UU. federal (FCRA) | Dado lo que se le muestra al contratante sobre el resultado del check (respuesta a P-4), ¿Marex reúne o transmite información de consumidores a terceros de forma que la convierta en CRA? |
| **3** | **FCRA: flujo completo y contratistas** | EE.UU. federal + estados | ¿Los documentos que ya están en el repo son suficientes, y el flujo de pantallas respeta el standalone? ¿Qué plazo de espera pre-adverse action fijamos? ¿Qué leyes ban-the-box aplican en los estados donde opera? |
| **4** | **iRowing y datos de salud** | Washington (MHMDA) + estatales | Con el alcance de captura definido (respuesta a P-7), ¿cae bajo MHMDA? Si sí, ¿el consentimiento separado que planeamos cumple el estándar de la ley? ¿Conviene geobloquear Washington? |
| **5** | **RDX: Dodd-Frank / SAFE Act y estructuras de seller finance** | EE.UU. federal + estados | ¿Qué responsabilidad tiene una plataforma que **facilita** operaciones que podrían violar la regla de capacidad de repago o la exclusión de 3 propiedades? ¿Qué advertencias o límites debe imponer el software? |
| **6** | **RDX: Fair Housing en filtros y targeting multi-tenant** | EE.UU. federal | ¿Qué filtros de búsqueda y qué criterios de targeting puede ofrecer la plataforma sin exponerse por discriminación, sabiendo que cada tenant los configura? |
| **7** | **Money transmission / escrow** | Estados EE.UU. | Con el flujo de fondos definido (respuesta a P-5), ¿aplica la excepción de agent of payee en los estados donde operan? |
| **8** | **Cláusulas de arbitraje, renuncia a acción de clase, límite de responsabilidad y foro** en los términos de los 4 | Según foro elegido | Redacción y ejecutabilidad. Son las cláusulas que más valor tienen y las que más se caen mal escritas |
| **9** | **Clasificación de trabajadores de Marex** | Estados EE.UU. | Contratista vs. empleado según el estado; impacto de que la plataforma fije precios y asigne trabajos |
| **10** | **Aviso de privacidad para LATAM** (Comunidad Latina) | MX, BR, CL, CO, AR | ¿Un aviso base + anexos por país cumple, o hace falta uno completo por jurisdicción? ¿Corresponde registro ante la SIC en Colombia? |
| **11** | **Menores** en Comunidad Latina e iRowing | EE.UU. (COPPA) + local | Con la Regla COPPA enmendada exigible desde el 22-abr-2026, ¿qué nivel de verificación de edad es proporcional para cada producto? |
| **12** | **Régimen ADMT de California** aplicado a Marex | California | Con la respuesta a P-8, ¿el matching/scoring de Marex es "decisión significativa" sobre oportunidades de contratación independiente? |

### 6.3 Cómo se usa este documento cuando vuelva el relevamiento

1. Por cada fila de la §3 marcada ✅, el frente de relevamiento dice si está / no está / a medias.
2. Los ❓ quedan bloqueados hasta que se responda la pregunta de §6.1. **No se resuelven por
   inferencia** — se anota el supuesto de trabajo y se sigue.
3. Lo que quede en 🔴 sin implementar es lista de bloqueo de lanzamiento, no backlog.
4. La §4 es el orden de ataque si hay que priorizar con recursos limitados.
5. La §5 son los fragmentos a implementar una vez y copiar entre los 4 proyectos.

---

## Fuentes

**TCPA / FTSA**
- [BCLP — nuevas reglas de opt-out del TCPA (11-abr-2025)](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
- [Nixon Peabody — postergación parcial al 11-abr-2026](https://www.nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules)
- [Morrison Foerster — el 11º Circuito anula la regla de consentimiento uno-a-uno](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule)
- [Womble Bond Dickinson — la FCC deroga la regla tras el fallo](https://www.womblebonddickinson.com/us/insights/blogs/fcc-repeals-one-one-consent-rule-following-eleventh-circuit-decision)
- [Fla. Stat. 501.059 — texto oficial](https://www.flsenate.gov/Laws/Statutes/2024/501.059)
- [Fla. Stat. 501.616 — Florida Telemarketing Act (ventana horaria y tope de 3/24 h)](https://law.justia.com/codes/florida/title-xxxiii/chapter-501/part-iv/section-501-616/)
- [Quarles — amendments a la FTSA (2023)](https://www.quarles.com/newsroom/publications/a-return-to-relative-sanity-amendments-to-the-florida-telephone-solicitation-act)
- [Morrison Foerster — litigación FTSA y mitigación](https://www.mofo.com/resources/insights/241111-uptick-in-florida-telephone-solicitation-act-litigation)

**CAN-SPAM**
- [FTC — CAN-SPAM Act: guía de cumplimiento para empresas](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [FTC — montos de sanciones civiles ajustados por inflación (2025)](https://search.ftc.gov/news-events/news/press-releases/2025/02/ftc-publishes-inflation-adjusted-civil-penalty-amounts-2025)

**FCRA**
- [Checkr — disclosure y autorización](https://checkr.com/blog/understanding-disclosure-and-authorization-requirements)
- [GoodHire — requisitos FCRA de disclosure según la FTC](https://www.goodhire.com/blog/fcra-disclosure-and-authorization-tips-ftc/)
- [SHRM — ¿aplica la FCRA a contratistas independientes?](https://www.shrm.org/topics-tools/news/talent-acquisition/fcra-apply-to-background-checks-independent-contractors)
- [gcheck — FCRA y contratistas, qué cambió (2026)](https://gcheck.com/blog/fcra-contractor-background-check/)

**Privacidad EE.UU.**
- [MultiState — las 20 leyes estatales integrales vigentes en 2026](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)
- [Secure Privacy — GPC obligatorio en 12 estados desde el 1-ene-2026](https://secureprivacy.ai/blog/privacy-laws-2026)
- [Clym — umbrales de aplicabilidad de CCPA 2026](https://www.clym.io/blog/ccpa-applicability-guide)
- [CPPA — anuncio de reglamentos finales (23-sep-2025)](https://cppa.ca.gov/announcements/2025/20250923.html)
- [White & Case — reglas finales de ADMT, evaluaciones de riesgo y auditorías](https://www.whitecase.com/insight-alert/cppa-finalizes-rules-admt-risk-assessments-and-cybersecurity-audits-requirements)
- [Skadden — ADMT: fechas de cumplimiento](https://www.skadden.com/insights/publications/2025/10/california-finalizes-cppa-regulations)
- [Alston & Bird — cambios de notificación de brechas en California y Oklahoma (2026)](https://www.alstonprivacy.com/key-breach-notification-updates-in-california-and-oklahoma-for-2026/)
- [Privacy Rights Clearinghouse — encuesta 50 estados de notificación de brechas (2026)](https://privacyrights.org/resources-tools/reports/data-breach-notification-laws-50-state-survey-2026-edition)

**CIPA / tracking**
- [Loeb & Loeb — el problema del milisegundo: tracking pre-consentimiento y CIPA (abr-2026)](https://www.loeb.com/en/insights/publications/2026/04/the-millisecond-problem-how-pre-consent-tracking-is-driving-cipa-lawsuits-in-2026)
- [Spencer Fane — estado de la litigación CIPA y SB 690](https://www.spencerfane.com/insight/cipa-website-tracking-lawsuits-where-the-law-stands-where-its-going-and-what-your-business-should-do-now/)

**Salud / fitness**
- [Clark Hill — MHMDA y su derecho privado de acción](https://www.clarkhill.com/news-events/news/its-here-the-who-what-and-how-of-washingtons-new-my-health-my-data-act-and-its-private-right-of-action/)
- [California Lawyers Association — MHMDA: no solo Washington, no solo salud](https://calawyers.org/privacy-law/the-washington-my-health-my-data-act-not-just-washington-or-health/)

**Menores**
- [Hunton — se acerca la fecha de cumplimiento de la Regla COPPA enmendada](https://www.hunton.com/privacy-and-cybersecurity-law-blog/coppa-rule-amendment-compliance-deadline-approaches)
- [White & Case — desglose de las enmiendas COPPA de la FTC](https://www.whitecase.com/insight-alert/unpacking-ftcs-coppa-amendments-what-you-need-know)

**Tiendas**
- [Apple — ofrecer borrado de cuenta en tu app (Guideline 5.1.1(v))](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Google Play — requisitos de borrado de cuenta](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Google Play — formulario de Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)

**UE**
- [EDPB — Guidelines 3/2018 sobre el ámbito territorial del GDPR (PDF)](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf)
- [Hintze Law — ¿está nuestra empresa de EE.UU. sujeta al GDPR?](https://hintzelaw.com/blog/2018/12/3/is-our-us-company-subject-to-gdpr)
- [Cooley — obligaciones de transparencia del AI Act desde el 2-ago-2026](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026)
- [Travers Smith — Art. 50 del AI Act y el Digital Omnibus](https://www.traverssmith.com/knowledge/knowledge-container/is-it-a-bot-eu-ai-act-transparency-rules-take-effect-2-august-2026/)

**Latinoamérica**
- [Mattos Filho — ANPD regula transferencias internacionales (Res. 19/2024)](https://www.mattosfilho.com.br/en/unico/regulates-international-data-transfers/)
- [Basham — nueva LFPDPPP de México publicada el 20-mar-2025](https://basham.com.mx/en/nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares-publicada-en-el-diario-oficial-de-la-federacion/)
- [Greenberg Traurig — nueva ley mexicana de protección de datos](https://www.gtlaw.com/en/insights/2025/3/nueva-ley-general-proteccion-de-datos)
- [Prey — guía Ley 21.719 de Chile](https://preyproject.com/es/blog/ley-de-proteccion-de-datos-en-chile)
- [Recording Law — Chile: Ley 21.719 y vigencia dic-2026](https://www.recordinglaw.com/es/world-laws/world-data-privacy-laws/chile-data-privacy-laws/)

**Vertical inmobiliario / marketplace**
- [NAR — SAFE Act y seller financing](https://www.nar.realtor/the-safe-act-seller-financing)
- [Berlin Patten — Dodd-Frank, seller financing y private money](https://berlinpatten.com/dodd-frank-seller-financing-and-private-money-financing/)
- [Ridgeway — guía de licencias de money transmitter](https://www.ridgewayfs.com/money-transmitter-license-guide/)
- [Faisal Khan — excepción de agent of payee](https://faisalkhan.com/solutions/licensing/money-transmitter-license/agent-of-payee-exemption)
- [One Call Legal — legalidad del skip tracing](https://www.oncalllegal.com/is-skip-tracing-legal/)
- [VA Horizon — skip tracing inmobiliario: proceso y cumplimiento](https://www.vahorizon.site/guides/how-to-skip-trace-real-estate/)

**UGC / copyright**
- [Fross Zelnick — renovación obligatoria del agente designado DMCA](https://www.frosszelnick.com/u-s-copyright-office-renewal-of-dmca-designated-agent-required-for-dmca-safe-harbor/)
- [U.S. Copyright Office — renovación de la designación (PDF)](https://www.copyright.gov/onlinesp/tutorials/transcripts/renew.pdf)

---

*Documento generado el 9-ago-2026. Las cifras de sanciones y los plazos cambian: revalidar los
montos del TCPA, CAN-SPAM y las fechas de vigencia estatales antes de cada lanzamiento.*

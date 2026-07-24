# Feedback cliente 2026-07-22 — Perfiles, Verificaciones, Scores y Dashboards

> Fuente: WhatsApp/mail de Geovanny (22/7, 4:23 p.m.), reenviado por Manuel.
> Este es el documento crudo del cliente. La lectura de "qué es nuevo vs. ya
> construido" y el plan de ejecución viven en `docs/HANDOFF.md`. NO tratar cada
> línea como instrucción literal de UX — entender la intención (regla global de Manuel).

## 1. Principio general

Tres presencias públicas: **Perfil de Usuario**, **Perfil de Creador**, **Página de Negocio**.
Una sola persona = **una cuenta principal** con **múltiples roles** (usuario, creador, admin de negocio),
mismos email/teléfono/contraseña. Selector para cambiar de dashboard: "Mi perfil / Panel de creador / Mi negocio".
Internamente: una cuenta, distintos roles, permisos, dashboards y sistemas de puntuación.

## 2. Registro general (todos empiezan como Usuario Regular)

**Obligatorio:** nombre, apellido, username, teléfono, código SMS, email, contraseña,
fecha de nacimiento, país de origen, país de residencia, ciudad, aceptación de T&C,
aceptación de privacidad, confirmación de edad mínima.

**Métodos:** teléfono, email, Google, Apple. **Aunque use Google/Apple, se exige y verifica teléfono.**

**Regla fundamental: una cuenta por número telefónico.** Bloquear: múltiples cuentas mismo teléfono,
múltiples cuentas sospechosas mismo dispositivo, recreación tras suspensión, cambio de teléfono sin 2ª verificación.

## 3. Perfil de Usuario Regular

**Público:** foto perfil, portada, nombre visible, username, bio, país origen, ciudad/área,
idiomas, fecha de ingreso, insignia teléfono verificado, insignia identidad verificada (si aplica),
User Score, seguidores, siguiendo, nº publicaciones, fotos, videos, reels, guardadas (solo él),
negocios que administra (opcional), estado como creador (si aplica).

**Pestañas:** Publicaciones, Videos, Fotos, Información, Reseñas realizadas, Seguidores, Siguiendo.

**Privacidad (configurable):** quién puede seguir/mensajear/comentar/etiquetar; visibilidad de
ciudad/seguidores/fecha nacimiento/estado en línea. **Nunca público:** dirección exacta, teléfono,
email, documentos, info bancaria, info fiscal, fecha de nacimiento completa (salvo autorización).

## 4-7. User Score (0–100)

Mide autenticidad, antigüedad, buena conducta, participación, confianza, cumplimiento. **No** popularidad.

**Composición:**
- **Identidad y seguridad (máx 30):** teléfono +10, correo +5, 2FA +5, identidad con documento +10 (opcional para user regular; obligatoria para ciertas funciones).
- **Antigüedad y actividad legítima (máx 15):** 30d +2, 90d +5, 6m +8, 1a +12, 2a+ +15 (solo si hay actividad legítima).
- **Perfil completo (máx 10):** foto +2, bio +2, ciudad/país +2, intereses +2, 100% +2.
- **Participación positiva (máx 15):** publicaciones auténticas, comentarios útiles, sin spam, reportes correctos, asistencia a eventos, transacciones completadas. No premiar volumen.
- **Historial de comportamiento (máx 20):** base neutral; sube por meses sin violaciones; baja por spam, acoso, engaño, suplantación, fraude, manipulación.
- **Confianza transaccional (máx 10):** compra/trabajo/pago/reseña verificada = +; disputa perdida propia / cancelaciones repetidas = −.

**Niveles:** 1 Nuevo (0–29), 2 Activo (30–49), 3 Confiable (50–69, puede pedir ser creador), 4 Verificado (70–84), 5 Destacado (85–100).

**Penalizaciones:** spam leve −2/−5, contenido eliminado −3/−10, acoso −10/−25, reseña falsa −10, suplantación −20/−40, fraude → grave o 0, manipulación seguidores −10/−30, disputa abusiva −5/−15.
Guardar historial por cambio (fecha, razón, puntos antes/después, acción auto/manual, admin). El usuario puede **apelar**.

## 8-18. Creador

**Activar modo "Convertirme en creador"** (NO nueva cuenta). Tras aprobación el perfil actual se amplía:
mantiene seguidores/publicaciones/User Score/login; obtiene **Creator Score** separado, **Dashboard de Creador**,
acceso al **Marketplace de Creadores**, **Stripe Connect** para cobrar.

**Perfil público del creador** (además de lo normal): insignia creador, nivel, Creator Score, categorías,
ciudad/mercado, idiomas, tipo de audiencia, seguidores, redes externas, portafolio, videos destacados,
trabajos completados, reseñas de negocios, tasa de completado, tasa de entrega a tiempo, tiempo de respuesta,
rango de precios, disponibilidad, botones Contratar/Invitar/Mensaje, estado verificación identidad/pagos.
Categorías (multi): comida, restaurantes, belleza, moda, bienes raíces, finanzas, eventos, entretenimiento, viajes,
deportes, educación, tecnología, negocios, cultura latina, noticias, fotografía, video, diseño, redes, UGC, influencer, presentador, podcast, lives.
Portafolio: videos, reels, fotos, campañas, enlaces, trabajos en-plataforma (marca "Trabajo verificado por Comunidad Latina"), testimonios, resultados.

**Requisitos para solicitar:** 18+, teléfono/correo verificados, perfil completo, User Score ≥50, sin suspensiones,
aceptar términos de creador, categorías, ≥3 ejemplos de contenido, disponibilidad, verificación identidad, Stripe Connect antes de cobrar.
**No exigir mínimo de seguidores** (creador pequeño puede ofrecer foto/grabación/edición/UGC/redes/diseño).

**Verificación (4 pasos):** (1) cuenta: teléfono/correo/dispositivo/edad/historial. (2) identidad y pagos vía Stripe Connect (KYC, banco, fiscal). (3) revisión de creador por CL (calidad portafolio, originalidad, categorías, sin contenido robado, sin seguidores falsos). (4) activación con estados: No solicitado / Solicitud iniciada / Documentación pendiente / Revisión Stripe pendiente / Revisión plataforma pendiente / Aprobado / Requiere info / Suspendido / Rechazado.

**Insignias (distintas, NO una sola azul):** teléfono verificado, identidad verificada, pagos activados, creador aprobado, creador destacado, Top Creator.

**Creator Score (0–100), independiente del User Score.**
- Verificación y preparación (máx 15): identidad +5, Stripe +5, portafolio +3, perfil profesional +2.
- Calidad y satisfacción (máx 25): calificación promedio, reseñas verificadas (solo trabajo pagado y completado en plataforma), revisiones solicitadas, reclamaciones.
- Cumplimiento de trabajos (máx 20): aceptados/entregados/abandonados/cancelados.
- Entregas a tiempo (máx 15): dentro de plazo ÷ completados (extensiones acordadas no penalizan).
- Comunicación (máx 10): tiempo de respuesta, claridad, sin desapariciones.
- Experiencia (máx 10): nº trabajos, meses activos, clientes recurrentes, categorías, valor total (NO público).
- Seguridad y cumplimiento (máx 5): sin fraude/copyright, sin manipulación, sin pagos fuera de plataforma.

**Niveles creador:** 0 Aspirante (activó, sin verificar; construye portafolio, no cobra) · 1 Nuevo (verificado + Stripe) · 2 Activo (≥3 trabajos, ≥4★, score ≥60) · 3 Profesional (≥10, ≥75, ≥85% a tiempo) · 4 Destacado (≥25, ≥85, ≥4.7) · 5 Top Creator (≥50, ≥92).
**Regla nuevos:** no mostrar score bajo por falta de experiencia; "Creador nuevo — aún sin trabajos suficientes"; **score provisional 50** → definitivo tras 3 trabajos.

**Dashboard de Creador (privado):** 18.1 Inicio (saldos, próximos pagos, trabajos, score, nivel, progreso, calificación, alertas) · 18.2 Oportunidades (filtros + tarjeta de trabajo con Business Score) · 18.3 Mis solicitudes (estados) · 18.4 Invitaciones (aceptar/rechazar/contraoferta) · 18.5 Trabajos activos (sala privada: contrato, entregables, archivos, mensajes, entregar/extensión/reportar, estado del dinero) · 18.6 Entregas (versiones, entrega final) · 18.7 Pagos (proyecto, comisión, neto, estados, payouts; componentes Stripe) · 18.8 Portafolio · 18.9 Estadísticas · 18.10 Evaluaciones · 18.11 Configuración profesional.

## 19-27. Negocio

**Página de Negocio** administrada por una o varias cuentas personales (no funciona como usuario). Identidad pública propia + Business Score.

**Público:** logo, portada, nombre comercial, username, categoría, descripción, dirección, ciudad, país,
área de servicio, horario, teléfono, WhatsApp, correo, web, redes, mapa, fotos, videos, productos/servicios,
rango precios, métodos de pago, idiomas, año fundación, Business Score, insignias, seguidores, reseñas, publicaciones, ofertas, eventos, trabajos publicados.
Botones (según plan): Llamar, WhatsApp, Cómo llegar, Web, Reservar, Comprar, Cotización, Mensaje, Seguir, Compartir.

**Administradores (roles/permisos):** Propietario (todo, incl. eliminar/transferir/Stripe/finanzas) · Administrador (editar/publicar/responder/campañas/trabajos) · Editor (crear/subir/editar) · Atención al cliente (mensajes/comentarios) · Analista (solo estadísticas). **Todas las acciones admin quedan registradas (audit log).**

**Verificación (5 niveles):** (1) cuenta admin verificada · (2) info comercial básica · (3) verificación documental por CL (registro, licencia, certificado, prueba de dirección, etc.) · (4) Stripe Connect (obligatorio para vender/cobrar) · (5) revisión de CL (que exista, categoría correcta, sin documentos falsos, sin suplantación).
**Stripe NO verifica todo el perfil:** Stripe = identidad legal/representante/banco/fiscal/elegibilidad; CL = fotos verdaderas, no suplantación, categoría, servicios permitidos, licencias, reseñas legítimas, comportamiento. **Dos verificaciones separadas.**

**Business Score (0–100):** verificación (máx 25), perfil completo (máx 10), reseñas verificadas (máx 20, etiquetas "Compra/Servicio/Trabajo de creador verificado" vs "Reseña comunitaria no verificada"), cumplimiento transaccional (máx 20), atención al cliente (máx 10), antigüedad/estabilidad (máx 10), seguridad (máx 5).
**Niveles:** 1 Nuevo (0–39) · 2 Activo (40–59) · 3 Verificado (60–74, insignia) · 4 Confiable (75–89) · 5 Destacado (90–100).

**Dashboard de Negocio (privado):** 27.1 Resumen · 27.2 Página · 27.3 Publicaciones · 27.4 Publicidad (Local/Nacional/Global) · 27.5 Marketplace de creadores (publicar trabajo, propuestas, comparar Creator Scores, invitar, contratar, depositar, revisar, disputas, calificar) · 27.6 Mensajes/leads · 27.7 Reseñas · 27.8 Pagos · 27.9 Equipo · 27.10 Estadísticas.

## 28-41. Stripe Connect y pagos

**Recomendación:** Stripe Connect **Express** (o equivalente con componentes integrados). Onboarding financiero por Stripe (KYC, banco, fiscal, payouts); CL controla la experiencia y su dashboard; actualizaciones vía **webhooks**.

**Flujo creador (§29):** solicitar → requisitos → crear Connected Account → onboarding Stripe → verificación → estado a CL → revisión portafolio → activar → aceptar trabajos → negocio deposita → trabajo → aprobación → comisión → payout.
**Flujo negocio (§30):** Connect NO obligatorio para página gratis; obligatorio para vender/cobrar. Para comprar publicidad o contratar creadores, el negocio paga como cliente (Checkout/Payment Element) sin ser Connected Account.

**Marketplace y pagos (§31):** publicar → solicitar → seleccionar → aceptar términos → pago → confirmar fondos → trabajo → entrega → revisión → aprobar → comisión → creador cobra → ambas partes califican. Ej: $100, comisión 20%, neto $80. **No usar "escrow" como afirmación legal**; usar "Pago protegido / Fondos recibidos / Pago pendiente de aprobación / Pago liberado".

**Estados de un trabajo (§32):** Borrador, Publicado, Recibiendo propuestas, En negociación, Creador seleccionado, Esperando pago, Pago confirmado, En progreso, Entrega enviada, Cambios solicitados, Entrega final, Aprobado, Pago procesándose, Pagado, Cancelado, En disputa, Reembolsado, Cerrado.

**Reseñas creador↔negocio (§33):** doble evaluación; **ocultas hasta que ambas partes califiquen o expire el plazo** (evita represalias).

**Anti-manipulación (§34):** detectar cuentas duplicadas, reseñas entre cuentas relacionadas, mismo dispositivo, trabajos falsos, pagos pequeños repetidos, seguidores/likes falsos, IPs sospechosas, disputas coordinadas, negocio+creador de la misma persona. Métricas sospechosas NO suben el score.

**Visibilidad de scores (§35):** mostrar público User/Creator/Business con explicación positiva ("Identidad verificada, 12 trabajos, 95% a tiempo, 4.8, miembro desde 2026"). **NO** mostrar negativos delicados (disputa bancaria, documento rechazado, banco no verificado, nº de reportes) — privados.

**Recálculo (§36):** tras verificación/transacción/reseña/penalización/disputa; 1×/día batch; corrección admin. Guardar `score_current`, `score_previous`, `score_level`, `score_calculated_at`, `score_version` + cada factor por separado.

**Entidades (§37):** users, user_profiles, user_roles, user_verifications, user_scores, score_history, creator_profiles, creator_portfolios, creator_scores, creator_levels, businesses, business_members, business_verifications, business_scores, business_reviews, creator_reviews, connected_accounts, payment_accounts, jobs, job_applications, job_contracts, job_deliverables, job_revisions, transactions, transfers, payouts, refunds, disputes, notifications, moderation_cases, appeals, audit_logs.

**Campos de verificación (§38):** phone_verified, email_verified, identity_verified, platform_verified, stripe_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements_due, stripe_requirements_past_due, verification_status, verification_updated_at. **No** habilitar solo por tener `stripe_account_id`; comprobar details_submitted/charges_enabled/payouts_enabled/requirements/disabled_reason.

**Webhooks (§39):** account update, requisitos, pagos, transferencias, payouts (incl. fallidos), reembolsos, disputas, cambios de capacidades. Nunca confiar en el navegador; confirmar en backend.

**Alertas (§40) · Documentos sensibles (§41):** Stripe recopila docs/banco/fiscal; CL solo guarda estado/ID/requisitos/fecha/capacidades. Documentos que CL revise: cifrados, acceso restringido, con registro de consulta y política de borrado.

## 42-45. Suspensiones, apelaciones, resumen

**Suspensiones (§42):** social, marketplace, pagos, publicidad, total. Social no bloquea pagos ya ganados salvo investigación/disputa/legal.
**Apelaciones (§43):** ver razón, explicar, adjuntar evidencia, estado, decisión. Estados: No apelado / Presentada / En revisión / Info solicitada / Aprobada / Rechazada / Cerrada.
**Resumen (§45):** una cuenta + múltiples roles + tres scores independientes + dashboards privados. NO cuentas separadas para creador. Negocio SÍ es página aparte pero administrada por usuarios verificados. Ningún score editable sin historial. Stripe = financiero/legal; CL = comunitario.

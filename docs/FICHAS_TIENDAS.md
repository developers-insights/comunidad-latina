# Fichas de tienda — Comunidad Latina

> Contenido listo para pegar en **Google Play Console** y **App Store Connect**.
> Derivado de `CONTEXTO_PROYECTO.md` (análisis de 9 dimensiones del repo).
> Fecha: 2026-07-10. **Nada de esto fue cargado todavía en ninguna consola.**

---

## 0. Lo que hoy hace imposible *enviar* la ficha (leer primero)

Estos no son detalles de copy — son campos obligatorios o requisitos duros de plataforma que hoy no existen. Ningún texto de este documento los resuelve.

| # | Bloqueante | Consola afectada | Quién lo destraba |
|---|---|---|---|
| 1 | **No hay cuenta de developer.** Google Play Console: $25 único + identidad/datos fiscales/bancarios verificados. Apple Developer Program: $99/año + D‑U‑N‑S si la cuenta es de organización. En `docs/` no hay entidad legal documentada para Geovanny. | Ambas | Geovanny (semanas de lead time si hay que constituir la sociedad) |
| 2 | **No existe URL de Política de Privacidad.** Campo **obligatorio** en ambas consolas. Hoy el footer solo dice "Pronto", sin `href`. | Ambas | Se puede escribir ya (ver §7) |
| 3 | **No existe binario instalable.** Ni `.aab` (Android) ni `.ipa` (iOS). El proyecto es una PWA pura: cero Capacitor/Cordova/RN/Expo, cero proyecto Gradle/Xcode, cero `assetlinks.json`. Verificado por búsqueda en todo el repo. | Ambas | Trabajo técnico nuevo (Bubblewrap para Play; Capacitor + feature nativa para Apple) |
| 4 | **No existe ni un screenshot** de la app corriendo, ni feature graphic 1024×500 (Play), ni ícono 1024×1024 sin alfa (Apple). Todos obligatorios. | Ambas | Sesión de captura + generación (ver §6) |
| 5 | **Faltan features que Apple exige explícitamente** para apps con UGC + mensajería 1:1 (guideline 1.2): bloqueo global de usuario y suspensión de reincidentes. Hoy solo se puede bloquear *una conversación*, no a una persona. | App Store (rechazo probable en revisión humana) | Desarrollo |
| 6 | **No hay pipeline CSAM/NCMEC** (PhotoDNA) y Google Vision no está configurado → toda foto queda en revisión humana. Google Play exige declarar y cumplir política CSAM para apps con subida de imágenes. | Google Play | Desarrollo / configuración |

**Sobre los formularios de privacidad.** El *Data Safety* de Google y el *App Privacy* de Apple no son marketing: son **declaraciones legales vinculantes**. Google remueve apps por declaraciones inexactas. Dado que esta app maneja datos de una población perseguible (§4.0 de `CONTEXTO_PROYECTO.md` llama al riesgo "honeypot para ICE"), las respuestas de §4 y §5 de este documento están redactadas para ser **verdaderas hoy**, no para ser cómodas. Si cambia el código, se actualizan antes de enviar.

---

## 1. Decisiones tomadas (con criterio, sin consultar)

| Decisión | Elección | Por qué |
|---|---|---|
| Nombre público | **Comunidad Latina** | Es la marca insignia y su publicación con usuarios reales puede contar como *specimen* de uso genuino ante USPTO antes del vencimiento de octubre 2026. "Dominicanos en USA" no ayudaría a sostener esa marca. Riesgo asumido: si igual se pierde la marca, hay rebrand forzado de la ficha. |
| Tenant que representa la ficha | `comunidadlatina` (#C2410C) | Coherente con el nombre. Ojo: el tenant con contenido sembrado es `dominicanos` — las capturas van a salir de ahí salvo que se siembre `comunidadlatina`. |
| Package name / Bundle ID | `com.comunidadlatina.app` | Reversed-DNS del dominio insignia. **Irreversible** una vez publicado. |
| Categoría Play | Social | `manifest.ts` declara `["social","lifestyle","news"]`; Social es la más honesta. |
| Categoría Apple | Primaria: Social Networking · Secundaria: Lifestyle | Ídem. |
| Idioma principal | Español (es‑US / es‑MX) | `lib/i18n/` tiene ES como fuente de verdad; EN está incompleto con fallback a ES. **No** declarar inglés hasta completar EN. |
| Precio | Gratis, sin compras integradas *declaradas* | El usuario final no paga. Ver ⚠️ en §3. |
| Clasificación de edad | Play: Teen · Apple: 17+ | Hay mensajería 1:1 entre desconocidos, UGC con foto sin moderación automática, y temática de fraude inmobiliario. 17+ hasta que existan bloqueo global y suspensión. |

**⚠️ Riesgo de política de pagos, sin resolver.** Membresías y Boost se cobran hoy con **Stripe Checkout dentro de la app**. Si el wrapper nativo expone ese flujo, Google Play y Apple exigen su propio sistema de facturación cuando el pago desbloquea funcionalidad digital dentro de la app. Esto **no está evaluado en ningún documento del proyecto** y puede ser motivo de rechazo. Opción defensiva: que la compra ocurra fuera de la app (web), sin link ni CTA desde el binario.

---

## 2. Google Play Console — campo por campo

### Ficha principal (Store listing)

**Nombre de la app** (máx. 30) — *16 caracteres*
```
Comunidad Latina
```

**Descripción breve** (máx. 80) — *76 caracteres*
```
Alquileres contrastados con registros oficiales. Comunidad latina en EE. UU.
```

**Descripción completa** (máx. 4000)
```
Comunidad Latina es la red social para latinos recién llegados a Estados Unidos: vivienda, negocios, profesionales y gente de tu país, con más información antes de decidir en quién confiar.

VIVIENDA CON DATOS, NO CON PROMESAS
Cada aviso de alquiler muestra qué se pudo contrastar contra registros públicos oficiales y en qué fecha se hizo esa consulta. La dirección exacta no se publica: aparece recién cuando hay un contacto real entre las dos partes.
Que un dato figure en un registro oficial no garantiza la conducta de nadie. Nunca envíes dinero por adelantado.

ESCUDO ANTI-ESTAFA
Consultá registros públicos antes de comprometerte con un aviso. Reportá avisos o perfiles que te parezcan sospechosos: los reportes de la comunidad se ponderan y los revisa un equipo humano.

CONTACTO PROTEGIDO
Escribile a quien publica el aviso desde adentro de la app. No necesitás dar tu teléfono ni tu dirección para hablar con alguien.

TU COMUNIDAD, EN TU IDIOMA
· Muro con lo que está pasando en tu comunidad
· Directorio de negocios latinos
· Directorio de profesionales
· Eventos cerca de tu zona
· Guías con enlaces a las fuentes oficiales: ITIN, licencia de conducir, tus derechos ante una autoridad

Las guías son material informativo y citan la fuente oficial de cada dato. No son asesoría legal ni migratoria. Para tu situación puntual, hablá con un abogado.

PENSADA PARA NO EXPONERTE
· No te pedimos tu número de teléfono para registrarte
· Nunca mostramos tu ubicación exacta, solo tu zona aproximada
· Los mensajes se borran automáticamente a los 90 días
· Podés borrar tu cuenta desde la app cuando quieras

Gratis para las personas. En español.
```

**Otros campos**

| Campo | Valor |
|---|---|
| Tipo de app | Aplicación (no juego) |
| Categoría | Social |
| Etiquetas | Comunidad · Clasificados · Estilo de vida |
| Email de contacto | `hola@comunidadlatina.com` ⚠️ **confirmar que ese buzón se lee**, o crear `soporte@` |
| Sitio web | `https://comunidadlatina.com` ⚠️ el dominio todavía no apunta al proyecto |
| URL de Política de Privacidad | `https://comunidadlatina.com/privacidad` ⚠️ **no existe — bloqueante #2** |
| Teléfono | Opcional. Dejar vacío. |

### App access (acceso para revisores)

```
Esta app requiere cuenta para acceder a las funciones sociales (muro, mensajes,
publicar avisos, Escudo Anti-Estafa). Dejamos una cuenta de prueba ya creada,
no hace falta registrarse:

  Email:    maria@demo.comunidadlatina.com
  Password: <PEGAR AQUÍ — rotar SEED_DEMO_PASSWORD antes de enviar>
  Rol: usuario estándar. No tiene acceso a paneles de administración.

Si necesitan revisar el panel de moderación (/admin), usar en su lugar:

  Email:    carlos@demo.comunidadlatina.com
  Password: <mismo>
  Rol: administrador de dominio.

También pueden crear su propia cuenta: el registro pide solo nombre, email y
contraseña (no pedimos teléfono) y da acceso inmediato, sin confirmar el email.

Nota: si el inicio de sesión falla varias veces seguidas, esperen unos minutos
antes de reintentar. Hay un límite de frecuencia por seguridad.
```

---

## 3. App Store Connect — campo por campo

**Name** (máx. 30) — *16*
```
Comunidad Latina
```

**Subtitle** (máx. 30) — *27*
```
Vivienda y comunidad latina
```

**Promotional text** (máx. 170) — editable sin nueva revisión
```
Alquileres contrastados con registros públicos oficiales, contacto protegido y la comunidad latina de tu ciudad. En español, sin pedirte tu teléfono.
```

**Keywords** (máx. 100 caracteres, separadas por coma, sin espacios) — *93*
```
alquiler,renta,vivienda,latino,inmigrante,hispano,dominicano,comunidad,queens,nyc,estafa,itin
```

**Description** (máx. 4000) — usar la misma que Google Play (§2), es válida.

**URLs**

| Campo | Valor |
|---|---|
| Support URL | `https://comunidadlatina.com/soporte` ⚠️ **no existe** |
| Marketing URL | `https://comunidadlatina.com` |
| Privacy Policy URL | `https://comunidadlatina.com/privacidad` ⚠️ **no existe — bloqueante #2** |

**Sign-In information (para el revisor)** — mismo texto que "App access" de §2.

**Notes for review**
```
Comunidad Latina es una red social multi-comunidad para inmigrantes latinos en
EE. UU. El producto está en español.

- El núcleo de la app es la sección de vivienda: avisos de alquiler donde se
  muestra qué datos pudieron contrastarse contra registros públicos oficiales y
  en qué fecha. La app NO certifica ni avala a ningún anunciante, y el copy lo
  aclara explícitamente en cada aviso.
- Las guías de trámites son informativas y citan la fuente oficial. La app no
  provee asesoría legal ni migratoria.
- Los mensajes entre usuarios se moderan automáticamente antes de guardarse y
  se eliminan a los 90 días.
- Los avisos con foto no se publican hasta que un moderador humano los aprueba.
```

---

## 4. Google Play — Data safety (borrador de respuestas)

| Pregunta | Respuesta | Fundamento en código |
|---|---|---|
| ¿La app recopila o comparte datos de usuario? | **Sí** | — |
| Nombre | Recopilado · No compartido · Requerido | `registerSchema` pide `displayName` |
| Dirección de email | Recopilado · **Compartido** (Resend, Stripe) · Requerido | `lib/email/index.ts`, checkout de Stripe |
| Número de teléfono | **No recopilado** | El registro no tiene campo de teléfono |
| Ubicación aproximada | Recopilada · No compartida · Opcional | `listings.geo_zone`: geohash truncado a ≤5 chars (~4,9 km) |
| Ubicación precisa | **No recopilada** | Cero llamadas a `navigator.geolocation` en `src/` |
| Información de pago | Recopilada · **Compartida** (Stripe) · Opcional | `stripe.checkout.sessions.create`; la app nunca toca el PAN |
| Mensajes de usuario | Recopilados · **Compartidos** (OpenAI, para moderación) · Requerido para la feature | `mensajes/actions.ts` → `omni-moderation-latest` |
| Fotos | Recopiladas · Compartidas solo si se activa Google Vision · Opcional | `lib/config/services.ts` |
| Otro contenido del usuario (posts, preguntas al asistente) | Recopilado · **Compartido** (OpenAI) | `lib/moderation/`, `lib/rag/` |
| ID de usuario | Recopilado · No compartido | uuid de Supabase Auth |
| ID de publicidad / tracking cross-app | **No** | Sin SDK de ads en `package.json` |
| ¿Los datos se cifran en tránsito? | **Sí** | HTTPS/TLS (Vercel + Supabase + Stripe) |
| ¿El usuario puede pedir el borrado de sus datos? | **Sí**, in-app | `/perfil` → `deleteAccountAction` |
| ¿Se usan datos para publicidad? | **No** | — |

> ⚠️ **Antes de enviar:** `deleteAccountAction` falla con un error genérico si el usuario tiene una cuenta de negocio activa (FK `RESTRICT` sobre `business_accounts.owner_id`). Google exige que el borrado sea usable de punta a punta. Arreglar antes de declarar "Sí".

---

## 5. Apple — App Privacy (nutrition label)

| Categoría | ¿Aplica? | Vinculado a identidad | Usado para tracking | Propósito |
|---|---|---|---|---|
| Contact Info → Name, Email | Sí | Sí | No | App Functionality |
| Location → **Coarse** | Sí | Sí | No | App Functionality |
| Location → Precise | **No** | — | — | — |
| User Content → Messages, Photos, Other | Sí | Sí | No | App Functionality (moderación vía OpenAI) |
| Financial Info → Payment Info | Sí | Sí | No | App Functionality (Stripe) |
| Identifiers → User ID | Sí | Sí | No | App Functionality |
| Diagnostics → Crash Data | Sí | **No** | No | App Functionality (Sentry, con scrub de PII) |
| Sensitive Info | Zona gris → declarar como **Other User Content** | Sí (solo el dueño lo lee) | No | `profiles_private.needs` puede codificar necesidad migratoria |
| Search / Browsing History | No | — | — | — |

**Data Use Disclosure — Third parties a nombrar en la política:** Supabase (infra/DB), Stripe (pagos + verificación de identidad), OpenAI (moderación de contenido y asistente), Resend (email transaccional), Sentry (diagnóstico), Vercel (hosting).

> ⚠️ Apple pregunta explícitamente si el contenido de los mensajes va a terceros. **Va** (OpenAI, para moderación). Y los mensajes **no son end-to-end** hoy: `messages.body` es texto plano con TTL de 90 días; la columna `cipher_envelope` existe pero siempre es `null`. La política de privacidad debe decirlo con esas palabras — el producto se posiciona como "contacto protegido" y esa expectativa hay que acotarla.

---

## 6. Assets gráficos — qué hay y qué falta

| Asset | Requisito | Estado |
|---|---|---|
| Ícono 512×512 (ficha Play) | PNG 32-bit | ✅ `public/icons/icon-512.png` |
| Ícono maskable | full-bleed, safe zone 40% | ✅ `public/icons/maskable-512.png` — es exactamente lo que consume Bubblewrap |
| Ícono 1024×1024 **sin canal alfa** (Apple) | PNG opaco, sin esquinas redondeadas | ❌ **No existe.** Trivial: extender `scripts/generate-icons.mjs` (el SVG fuente es vectorial) |
| Feature graphic 1024×500 (Play) | Obligatorio | ❌ **No existe.** Fuente parcial: `public/images/og-default.png` (1376×768, aspecto incorrecto) |
| Screenshots teléfono (Play) | mín. 2, máx. 8 | ❌ **Cero.** Capturar `/feed`, `/escudo`, `/propiedades`, `/mensajes`, `/perfil` |
| Screenshots iPhone 6.9" y 6.5" | Obligatorios | ❌ **Cero** |
| Video promocional | Opcional | ❌ No existe |

**Nota de marca:** el ícono es azul `#1A5EDB` fijo (hardcodeado en `scripts/generate-icons.mjs`), pero el tenant `comunidadlatina` es naranja `#C2410C`. Si la ficha se publica como "Comunidad Latina", el ícono no coincide con su propio color de marca. Decidir: regenerar el ícono en naranja, o aceptar el azul como color corporativo de la app.

---

## 7. Lo mínimo que tenés que hacer vos

Ordenado por lo que destraba más:

1. **Confirmar/constituir la entidad legal** y crear las dos cuentas de developer (Google Play $25 único, Apple $99/año). Es lo de mayor lead time. Sin esto no existe ni el botón de "crear app".
2. **Apuntar `comunidadlatina.com` al proyecto en Vercel** + contratar Vercel Pro (el plan Hobby prohíbe uso comercial).
3. **Confirmar si `hola@comunidadlatina.com` se lee**, o crear `soporte@`.
4. **Rotar `SEED_DEMO_PASSWORD`** y pegar la nueva en los campos de acceso de revisor de §2 y §3.
5. **Decidir el flujo de pagos** frente a las políticas de facturación de cada tienda (ver ⚠️ en §1).

Lo que yo puedo hacer apenas me digas (no necesita nada tuyo):

- Escribir y publicar las páginas `/privacidad`, `/terminos` y `/soporte` con el contenido real de §4 y §5 (bloqueante #2 resuelto).
- Generar el ícono 1024×1024 sin alfa y el feature graphic 1024×500.
- Capturar los screenshots de las 5 pantallas contra el build de producción.
- Arreglar el caso `RESTRICT` de `deleteAccountAction`.
- Diseñar el esquema de bloqueo global de usuario (requisito duro de Apple guideline 1.2).
- Correr `bubblewrap init` contra el manifest, una vez que el dominio real esté sirviendo HTTPS.

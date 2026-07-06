# 13 — Dirección de Diseño UX/UI Premium

**Proyecto:** Comunidad Latina (NYLabel) — red social white-label multi-tenant para la diáspora latina en EE.UU./Europa.
**Documento:** Design brief de agencia. Foco exclusivo: **la dirección de diseño y UX que hace que el producto se sienta premium, confiable y distinto — "puliendo todo al máximo" como pidió el cliente.**
**Fecha:** 2026-07-06 · **Autor:** UI/UX Design Lead (nivel agencia Awwwards-tier: Linear, Airbnb, Revolut, Cash App)
**Stack de implementación:** Next.js (App Router) + Tailwind CSS + Supabase + PWA. Todo lo definido aquí es implementable directamente por un enjambre de agentes (`frontend-developer`, `ui-designer`, `accessibility-expert`).

---

## 0. Tesis del documento

El Plan Maestro (§1-2) ya resolvió *qué* construir y *por qué gana* (Trust Score, Escudo Anti-Estafa, Asistente Comunitario, Guías). Este documento resuelve **cómo se ve, se siente y se usa** — y es, según el cliente, "lo más importante". La razón no es estética: **para un inmigrante que ya fue estafado, el diseño ES la primera señal de si puede confiar.** Antes de leer una sola palabra de copy, antes de ver el Trust Score de nadie, la persona ya decidió en 3 segundos si esto "parece serio" o "parece otra trampa de Facebook Marketplace". Ese juicio instantáneo es 100% visual: tipografía, espaciado, consistencia, ausencia de desorden.

**La apuesta de diseño de este documento en una frase:** *calidez de comunidad latina + rigor visual de fintech (Revolut/Mercado Pago) + claridad de infraestructura crítica (Linear) — nunca "otro clon de Facebook azul con iconos genéricos".*

Tres consecuencias no negociables se derivan de esto y ordenan todas las decisiones de abajo:

1. **El white-label NO puede degradar la calidad.** Si el admin #47 de un tenant elige un verde neón feo, el producto igual debe verse premium. Esto es un problema de *arquitectura de tokens*, no de "buen gusto del admin" — se resuelve en §2.
2. **La confianza se diseña, no se declara.** No alcanza con poner "Verificado ✓" en texto. Cada señal de confianza (Trust Score, badge, escrow, reporte de estafa) tiene una gramática visual consistente, reconocible y a prueba de imitación — se resuelve en §3 y §4.
3. **El recién llegado con baja alfabetización digital es el usuario de diseño, no el power user.** Si el onboarding funciona para alguien que nunca usó una PWA, funciona para todos. Diseñamos para el piso, no para el techo — se resuelve en §3.1 y §4.a.

---

## 1. Principios de diseño y de UX

### 1.1 Los 5 principios rectores

**① Calidez sin infantilizar, rigor sin frialdad.**
La competencia implícita no es "otra app social" — es el miedo del usuario a que lo estafen otra vez. El error de la mayoría de productos "para inmigrantes" es sobrecompensar con diseño demasiado suave, ilustraciones tipo clip-art, o tipografía redondeada infantil que sin querer comunica "esto es para gente que no entiende cosas complejas". El error opuesto —frialdad corporativa tipo banco tradicional— comunica "no te conocen ni les importás". La dirección correcta: **estructura de fintech seria (grillas limpias, jerarquía estricta, espaciado generoso) + acentos cálidos de marca (color, fotografía real, copy en español cálido) + cero decoración gratuita.** Se siente como Revolut si Revolut hablara español y conociera tu barrio.

**② La confianza es un sistema visual, no una palabra.**
"Verificado" en texto plano no vale nada — cualquier estafador también puede escribir "verificado". La confianza se comunica con: consistencia obsesiva (si todo se ve igual de cuidado, nada parece improvisado), señales verificables con evidencia (el Trust Score siempre es clickeable y explica *por qué*, nunca es un número mudo), y fricción visible en los lugares correctos (el botón de "Reportar estafa" siempre está a la misma distancia de un toque, nunca escondido en un menú de tres puntos).

**③ Claridad radical por sobre densidad de información.**
Cada pantalla tiene **una** acción primaria obvia. Todo lo demás es secundario y visualmente subordinado (tamaño, peso, color). Esto es lo opuesto al patrón "Facebook Groups" (todo grita al mismo volumen, todo es azul, todo es clickeable). Con un usuario de baja alfabetización digital, la carga cognitiva es el enemigo #1 — no la falta de features.

**④ Progresividad: simple primero, poder disponible después.**
El "recién llegado" ve una versión mínima y guiada de cada pantalla; el power user (el mismo usuario, 3 meses después) accede a filtros avanzados, configuración fina, y densidad de información mayor — pero nunca por default. La complejidad se **revela**, nunca se **impone**.

**⑤ Anti-scroll por diseño, no solo por métrica.**
El Plan Maestro (concepto unificador) define el North Star como "resoluciones", no tiempo en pantalla. Esto tiene una traducción visual directa: los feeds no usan trucos de scroll infinito adictivo tipo TikTok (auto-play agresivo, dopamina de refresh); en cambio, favorecen **tarjetas con destino claro** ("Ver detalles", "Contactar", "Guardar") que sacan al usuario del feed hacia una resolución. El diseño celebra "encontraste lo que buscabas y te fuiste" — no "te quedaste scrolleando 40 minutos".

### 1.2 Qué nos hace ver DISTINTO a "otro Facebook" — checklist de diferenciación visual

| Dimensión | Facebook / Sngine (paridad, lo que evitamos) | Comunidad Latina (nuestra dirección) |
|---|---|---|
| Paleta | Azul Facebook genérico o gris corporativo plano | Base neutra premium cálida (grises con temperatura, nunca gris frío #808080) + acento de marca del tenant inyectado con disciplina |
| Tipografía | System font / Arial / Roboto sin personalidad | Familia geométrica humanista con carácter propio (§2.2) — nunca Inter/Roboto/Arial a secas |
| Tarjetas | Bordes grises duros, sombras genéricas `box-shadow: 0 2px 4px gray` | Doble-bisel (Double-Bezel, §2.5): shell exterior + core interior, sombras difusas y cálidas, radios generosos |
| Iconografía | Mezcla de emoji + Font Awesome grueso | Un solo set de línea fina y consistente (§2.6), nunca emoji como ícono funcional |
| Densidad | Todo compite por atención al mismo volumen | Jerarquía estricta: 1 CTA primario por pantalla, todo lo demás subordinado |
| Confianza | Texto plano ("Verificado") sin evidencia | Sistema visual verificable, siempre clickeable, siempre explicado (§3.3) |
| Motion | Transiciones instantáneas o inexistentes | Micro-interacciones con física de resorte, feedback en <150ms (§5) |
| Vacío/errores | Pantallas en blanco o "Error 404" genérico | Estados vacíos que enseñan y guían (§3.5) |
| Tono de copy | Corporativo genérico o "growth-hacky" | Cálido, directo, en español real — nunca traducido literalmente del inglés (§ux-writing aplicado en todo el documento) |

### 1.3 Por qué esto transmite seguridad a alguien que fue estafado

Investigación de UX aplicada a poblaciones vulnerables (y sentido común validado en fintechs como Nubank/Mercado Pago, que atienden a la misma región con el mismo problema de confianza) muestra que la percepción de seguridad se forma por señales acumulativas, no por una sola feature:

1. **Consistencia = profesionalismo percibido.** Un estafador nunca invierte en un design system completo con 6 estados de botón y microcopy pulido en cada error. La *consistencia visual exhaustiva* es, paradójicamente, la señal anti-fraude más fuerte y más barata de producir bien.
2. **Espacio en blanco = "no tenemos nada que ocultar".** Las estafas comprimen todo (urgencia, letra chica, superposición de elementos) para que no pares a pensar. Un layout que respira (macro-whitespace, §2.4) comunica lo opuesto: "tomate tu tiempo, no hay trampa".
3. **Fricción visible en el lugar correcto genera confianza, no la destruye.** Mostrar claramente "esta cuenta tiene 3 días" o "reportar" no es "asustar al usuario" — es la prueba de que la plataforma vigila activamente. El silencio total sobre riesgo es lo que da miedo.
4. **Reversibilidad visible.** Botones de deshacer, confirmaciones antes de acciones destructivas, y "podés cancelar esto" siempre visibles bajan la ansiedad de decisión — crítico para alguien que ya perdió dinero por apresurarse.

---

## 2. Design System White-Label Premium

### 2.1 La arquitectura de tokens: 3 capas (esto es la clave del white-label)

El problema a resolver: **Geovanny necesita que un admin de tenant pueda escribir un color hex y el resultado siga viéndose como una app de $150k, no como una plantilla de WordPress de 2014.** Esto no se logra "confiando en el buen gusto del admin" — se logra con una arquitectura de tokens de 3 capas donde **el admin solo controla una capa angosta y todo lo demás es fijo**.

```
CAPA 1 — PRIMITIVOS (fijos, nunca configurables, viven en el código)
  └─ Escala de neutros premium · escala tipográfica · escala de espaciado
     radios · sombras/elevación · motion tokens · iconografía

CAPA 2 — SEMÁNTICOS (fijos en estructura, el valor de "brand" se inyecta)
  └─ color-bg-surface, color-text-primary, color-border-subtle... = SIEMPRE
     de la escala de neutros (Capa 1)
  └─ color-brand-500, color-brand-accent, color-brand-on-brand = ÚNICO
     punto donde entra el color del tenant, y SOLO tras pasar por el
     "brand color pipeline" (ver 2.3)

CAPA 3 — TENANT (lo único que el admin edita)
  └─ 1 hex de marca (color primario) · logo · nombre · (opcional) 1 hex
     secundario de acento · tipografía de marca opcional (con fallback
     obligatorio a la familia premium por defecto)
```

**Regla de oro:** el admin de tenant NUNCA edita un valor de la Capa 1 o 2 directamente. Solo entrega un input a la Capa 3, que pasa por un pipeline de validación y transformación (2.3) antes de convertirse en los pocos tokens semánticos de marca que sí varían.

### 2.2 Tipografía — familias reales recomendadas

Nunca usar Inter/Roboto/Arial/Helvetica/Open Sans a secas — son la firma visual de "plantilla genérica" que exactamente el diseño de este producto necesita evitar (ver también §1.2). Recomendación con razonamiento:

| Uso | Familia | Por qué | Fallback / licencia |
|---|---|---|---|
| **Display / Headings** (H1-H2, hero, números de Trust Score) | **"General Sans"** (Fontshare, gratis, variable) o **"Clash Display"** (Fontshare) | Geométrica humanista, calidez sin perder seriedad, soporta acentos y ñ correctamente (crítico para ES), peso variable para jerarquía sin cargar 6 archivos | Sistema: `-apple-system` |
| **Body / UI text** (párrafos, botones, labels, feed) | **"Inter Display"** NO — usar **"Plus Jakarta Sans"** (Google Fonts, gratis, variable, excelente soporte de diacríticos ES) | Alta legibilidad a 16px en pantallas chicas con conexión pobre, x-height generoso (legible para baja alfabetización digital), se ve premium sin ser "de moda pasajera" | `system-ui` |
| **Números / Trust Score / precios** | **"Plus Jakarta Sans"** con `font-variant-numeric: tabular-nums` | Cifras tabulares evitan que el layout salte cuando el Trust Score cambia de 87 a 100 | — |
| **Monoespaciada** (IDs de transacción, referencias de escrow) | **"JetBrains Mono"** | Solo para códigos/referencias — nunca para UI general | `ui-monospace` |

**Escala tipográfica** (base 16px, ratio ~1.25 modificado para mobile):

```
--font-size-xs:    12px / 16px line-height   (helper text, timestamps)
--font-size-sm:    14px / 20px               (labels, metadata, botones secundarios)
--font-size-base:  16px / 24px               (body — MÍNIMO en mobile, nunca menor)
--font-size-lg:    18px / 28px               (body destacado, subtítulos)
--font-size-xl:    22px / 30px               (H3, títulos de card)
--font-size-2xl:   28px / 36px               (H2, títulos de sección)
--font-size-3xl:   36px / 44px               (H1, títulos de pantalla)
--font-size-4xl:   48px / 56px               (hero, solo desktop/landing)
```

Pesos: 400 (body), 500 (labels/énfasis medio), 600 (subtítulos/botones), 700 (headings). Nunca más de 3 pesos activos en una misma pantalla.

### 2.3 Paleta base neutra premium + el "brand color pipeline"

**La base neutra (fija, Capa 1) — nunca gris frío puro:**

```
--neutral-0:    #FFFFFF   (superficie elevada, cards en light mode)
--neutral-25:   #FCFCFB   (fondo de página light — cálido, no #FFFFFF puro)
--neutral-50:   #F7F6F3   (superficie secundaria)
--neutral-100:  #EFEDE8   (bordes sutiles, divisores)
--neutral-200:  #E2DFD7   (bordes visibles, skeleton base)
--neutral-300:  #C8C3B8   (íconos deshabilitados)
--neutral-400:  #A39C8C   (texto placeholder)
--neutral-500:  #7A7364   (texto secundario)
--neutral-600:  #5C564A   (texto terciario / metadata)
--neutral-700:  #3D392F   (texto secundario en dark, bordes en dark)
--neutral-800:  #24211B   (superficie elevada — dark mode)
--neutral-900:  #17150F   (fondo de página — dark mode, NUNCA #000000 puro)
--neutral-950:  #0D0C08   (superficie más profunda, dark mode)
```

Nota de diseño: esta escala tiene una **temperatura cálida deliberada** (un ligerísimo tinte hacia el beige/arena, no gris puro de sistema). Es la diferencia entre "app fintech fría" y "app fintech cálida latina" sin caer en color saturado. Es sutil a propósito — se nota en la sensación, no se nombra.

**Colores semánticos fijos (nunca varían por tenant):**

```
--color-success:      #1A7F5A   (confirmaciones, Trust Score alto, verificado)
--color-success-bg:   #E8F5EE
--color-warning:      #B7791F   (alertas de riesgo medio, "cuenta nueva")
--color-warning-bg:   #FBF2E3
--color-danger:       #C23B3B   (estafa detectada, reportar, eliminar)
--color-danger-bg:    #FBEAEA
--color-info:         #2B6CB0   (tips, ayuda contextual)
--color-info-bg:      #E9F1FA
```

Estos NUNCA se derivan del color de marca del tenant — es una regla dura de guardrail (§6). Un tenant con marca roja no puede tener su color de "peligro/estafa" confundido con su color de marca.

**El brand color pipeline (cómo se inyecta el color del tenant sin verse barato):**

El admin entrega **un solo hex**. Ese hex NUNCA se usa directamente en la UI. Pasa por un pipeline determinístico:

1. **Validación de accesibilidad automática.** Se calcula el contraste del hex contra `--neutral-0` y `--neutral-900`. Si no alcanza 4.5:1 en ninguna combinación práctica de texto, el sistema **ajusta automáticamente** la luminosidad (HSL, mismo hue/saturation, L clamped) hasta que sí alcance — el admin ve una preview en vivo con el mensaje: *"Ajustamos tu color para que el texto se lea bien — así se ve"*. El admin nunca puede forzar un color que rompa contraste.
2. **Generación de escala tonal automática (no manual).** A partir del hex validado se generan programáticamente 10 variantes tonales (50 a 900, mismo algoritmo que Radix Colors / Tailwind's `generateColors`) — el admin nunca elige `brand-100` o `brand-700` a mano; el sistema los deriva. Esto es lo que evita el look "amateur" de paletas hechas a ojo.
3. **El color de marca SOLO se usa en 4 lugares fijos, nunca como fondo masivo:**
   - CTA primario (botón, 1 por pantalla)
   - Elementos de navegación activos (tab seleccionado, link activo)
   - Acentos puntuales (borde de foco, ícono de marca, barra de progreso)
   - Logo / header de marca (zona de branding contenida)
   - **Nunca:** fondo de página completo, fondo de card, color de texto de body, color de error/éxito/warning (esos son fijos y semánticos, ver arriba).
4. **Regla anti-fealdad final:** el color de marca siempre se muestra **sobre** la base neutra premium (Capa 1), nunca reemplaza la base. Un tenant con verde neón tiene un botón verde neón sobre un layout beige-crema impecable — no una app entera verde neón. Esto es lo que garantiza que 50 tenants con 50 colores distintos sigan pareciendo la misma familia de producto premium.

### 2.4 Espaciado y radios

Escala de 4px con paradas de uso claro (sistema 4/8pt estándar, con paradas ampliadas para el "macro-whitespace" que da sensación premium):

```
--space-1:  4px    (gap entre ícono y texto inline)
--space-2:  8px    (padding interno de chips, gap entre elementos relacionados)
--space-3:  12px   (padding de inputs pequeños)
--space-4:  16px   (padding estándar de card, gap por default)
--space-5:  20px
--space-6:  24px   (padding de card grande, gap entre cards del feed)
--space-8:  32px   (separación entre secciones dentro de una pantalla)
--space-10: 40px
--space-12: 48px   (padding de sección en mobile)
--space-16: 64px
--space-20: 80px   (padding de sección en desktop/tablet — "macro-whitespace")
--space-24: 96px   (separación entre bloques mayores en desktop)
```

**Radios (squircle-leaning, nunca esquinas duras de 0-4px que se ven "de sistema operativo 2010"):**

```
--radius-sm:   10px   (chips, badges pequeños)
--radius-md:   16px   (botones, inputs)
--radius-lg:   20px   (cards estándar — core interior del Double-Bezel)
--radius-xl:   28px   (cards destacadas, modales — shell exterior del Double-Bezel)
--radius-2xl:  32px   (hojas/bottom sheets, contenedores de pantalla completa)
--radius-full: 9999px (avatares, pills de navegación, botones primarios)
```

### 2.5 Sombras / elevación — el patrón Double-Bezel obligatorio

Ninguna tarjeta, imagen destacada o contenedor premium se apoya plano sobre el fondo. Se usa el patrón **Doble-Bisel** (shell exterior + core interior) en todos los componentes de "confianza alta": tarjetas de listing verificado, cards de Trust Score, tarjetas de negocio, modal de pago/escrow.

```css
/* Shell exterior — el "marco" */
.card-shell {
  background: var(--neutral-50);      /* o negro/10 en dark */
  padding: 6px;                        /* p-1.5 */
  border-radius: var(--radius-xl);     /* 28px */
  box-shadow:
    0 1px 2px rgba(23, 21, 15, 0.04),
    0 8px 24px -8px rgba(23, 21, 15, 0.08);
}

/* Core interior — el contenido real */
.card-core {
  background: var(--neutral-0);
  border-radius: calc(var(--radius-xl) - 6px);  /* 22px, concéntrico */
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
  padding: var(--space-6);
}
```

**Escala de elevación semántica (sombras difusas y cálidas, nunca `rgba(0,0,0,0.3)` duro):**

```
--shadow-xs:  0 1px 2px rgba(23,21,15,0.04)                                (chips, inputs en reposo)
--shadow-sm:  0 2px 8px -2px rgba(23,21,15,0.06)                           (cards en el feed)
--shadow-md:  0 8px 24px -8px rgba(23,21,15,0.10)                         (cards destacadas, hover)
--shadow-lg:  0 16px 48px -12px rgba(23,21,15,0.14)                      (modales, dropdowns)
--shadow-xl:  0 24px 64px -16px rgba(23,21,15,0.18)                      (bottom sheets, onboarding)
--shadow-focus-ring: 0 0 0 3px var(--color-brand-200)                     (focus visible, ver §3.2 a11y)
```

Dark mode: las mismas sombras se reemplazan por un borde `1px solid rgba(255,255,255,0.06)` + sombra sutil hacia negro más profundo, nunca sombra invertida hacia blanco (se ve mal).

### 2.6 Iconografía

- **Set único:** **Phosphor Icons** (peso `Regular` o `Light`, nunca `Bold`/`Fill` salvo para estado activo/seleccionado). Alternativa equivalente: `Remix Icon` línea. Ambos tienen +1200 íconos, licencia MIT, y trazo consistente de 1.5-2px.
- **Nunca emoji como ícono funcional** — un emoji de casa 🏠 para "Propiedades" se ve distinto en iOS/Android/Windows y no se puede tematizar. Se reemplaza por `ph:house-simple` de Phosphor en todos los casos.
- **Tamaños tokenizados:** `--icon-sm: 16px` (inline con texto), `--icon-md: 20px` (navegación, botones), `--icon-lg: 24px` (acciones primarias), `--icon-xl: 32px` (estados vacíos, ilustración de sección).
- **Trazo consistente:** 1.5px en todos los tamaños ≤24px; 2px en `--icon-xl`. Nunca mezclar trazo fino con trazo grueso en la misma vista.
- **Contraste mínimo:** 3:1 contra el fondo para íconos funcionales (WCAG AA para "graphical objects").

### 2.7 Motion tokens

```
--ease-out-premium:  cubic-bezier(0.32, 0.72, 0, 1)     (entradas, expansiones)
--ease-in-premium:   cubic-bezier(0.4, 0, 1, 1)          (salidas — 60-70% de la duración de entrada)
--ease-spring:       cubic-bezier(0.34, 1.56, 0.64, 1)   (feedback de botón, toggles, celebración)

--duration-instant:  100ms   (feedback de tap/press)
--duration-fast:     150ms   (hover, toggle, chip selection)
--duration-base:     250ms   (transición de card, expand/collapse)
--duration-slow:     400ms   (transición de pantalla completa, modal)
--duration-page:     500ms   (navegación entre rutas principales)
```

Regla dura: nunca `linear`, nunca `ease-in-out` genérico de CSS por default. Ver detalle de aplicación en §5.

### 2.8 Dark mode — no es "invertir colores"

Dark mode se diseña como **paleta tonal propia**, no como inversión matemática de light mode (regla `color-dark-mode` del estándar de UX aplicado). Reglas:

- Fondo de página: `--neutral-900` (`#17150F`, nunca `#000000` puro — el negro puro con texto blanco puro vibra y cansa la vista, además de verse "barato").
- Superficies elevadas se aclaran progresivamente (`--neutral-800` → `--neutral-700`), nunca se oscurecen más que el fondo.
- El color de marca del tenant se **desatura ligeramente y sube de luminosidad** (+8-12% L en HSL) en dark mode para no vibrar contra el fondo oscuro — esto es automático en el brand color pipeline (§2.3), no manual.
- Texto primario en dark: `--neutral-50` (no blanco puro `#FFFFFF` — mismo razonamiento que el fondo).
- Todas las combinaciones de contraste se validan independientemente en dark — nunca se asume que "si funciona en light, funciona en dark".
- Bordes y divisores deben ser visibles en ambos modos (`rgba(255,255,255,0.08)` en dark vs `--neutral-200` en light) — nunca un borde que "desaparece" en un tema.

---

## 3. UX Inclusiva para el Inmigrante

### 3.1 Onboarding "Recién Llegado" — objetivo <60s

**Principio de diseño:** cada pantalla tiene una sola decisión, con opciones grandes tocables, ícono + texto (nunca solo ícono, nunca solo texto), y progreso visible. Cero campos de texto libre en los primeros 3 pasos — todo es selección.

**Flujo (detallado como wireframe en §4.a):**

1. **Bienvenida con propósito claro** (0-8s): no pide registro todavía. Muestra valor inmediato: *"¿De dónde sos?"* con banderas grandes tocables → determina tenant/comunidad si no vino de un dominio específico.
2. **¿Qué necesitás hoy?** (8-20s): 4-5 tarjetas grandes con ícono + texto grande: 🏠 *Buscar dónde vivir* / 💼 *Buscar trabajo* / 🤝 *Conocer gente de mi país* / 🛡️ *Cuidarme de estafas* / 📖 *Aprender trámites*. Multi-selección permitida, mínimo 1.
3. **Registro mínimo** (20-35s): solo teléfono O email (no ambos), con autocompletado nativo. Verificación por SMS (Twilio) con auto-lectura de OTP donde el navegador lo soporte (`autocomplete="one-time-code"`).
4. **Ubicación** (35-45s): un solo input de ciudad con autocompletar, o botón grande "Usar mi ubicación" (permiso nativo del navegador).
5. **Recompensa inmediata** (45-60s): aterriza directo en el feed **ya filtrado** por sus selecciones del paso 2, con 3-5 tarjetas reales y visibles arriba del fold (nunca un feed vacío). Modal breve y descartable: *"Así se ve tu comunidad en [Ciudad]. Ya podés explorar."*

**Reglas duras de accesibilidad al onboarding:**
- Todo texto en español por default, con selector de idioma (ES/EN) visible pero no intrusivo desde el paso 1 (esquina superior, nunca escondido en configuración).
- Ningún paso requiere scroll para ver la acción principal en un viewport de 375×667px (iPhone SE, el piso realista de hardware en la población objetivo).
- Botón "Atrás" siempre presente y predecible — nunca un onboarding que solo avanza.
- Se puede omitir el onboarding completo y llegar a un feed genérico — nunca bloquea el acceso al producto (principio de "escape routes", accesibilidad).
- Cero jerga técnica: nunca "Crear cuenta", siempre "Empezá" o "Sumate a tu comunidad"; nunca "Verificar OTP", siempre "Ingresá el código que te mandamos".

### 3.2 Accesibilidad WCAG AA — checklist aplicado al producto completo

| Área | Regla aplicada | Implementación concreta |
|---|---|---|
| **Contraste** | Texto normal ≥4.5:1, texto grande (≥18px bold o ≥24px) ≥3:1 | Toda la escala de neutros (§2.3) pre-validada; el brand pipeline valida el color de marca automáticamente (§2.3 paso 1) |
| **Targets táctiles** | Mínimo 44×44px, con 8px de separación mínima entre targets adyacentes | Todos los botones, ítems de lista tocables, e íconos interactivos respetan el token `--touch-target-min: 44px` incluso si el ícono visual es más chico (hit area expandida con padding invisible) |
| **Foco visible** | Anillo de foco de 3px, nunca `outline: none` sin reemplazo | `--shadow-focus-ring` (§2.5) aplicado a todo elemento interactivo vía `:focus-visible` |
| **Screen readers** | Nombres accesibles en todo control, `aria-label` en botones solo-ícono, roles ARIA correctos en widgets custom | Botón de "Reportar estafa" (solo ícono en la barra de acciones) siempre lleva `aria-label="Reportar como estafa"`; Trust Score badge lleva `aria-label` con el valor y el nivel ("Trust Score 87, nivel Confiable") |
| **Navegación por teclado** | Todo accesible por Tab, orden lógico, Escape cierra modales | Los bottom sheets y modales de pago/escrow (alto riesgo) se testean primero en este criterio |
| **Texto dinámico / zoom** | Soporta zoom del navegador hasta 200% sin romper layout, unidades relativas | `rem`/`em` para tipografía, nunca `px` fijo en font-size de componentes de texto |
| **Reduced motion** | Respeta `prefers-reduced-motion: reduce` | Todas las animaciones de §5 tienen variante estática/crossfade simple cuando el usuario lo pide |
| **Color no como único indicador** | Estados (verificado/riesgo/error) siempre llevan ícono + texto, nunca solo color | Badge de Trust Score: color de fondo + ícono de escudo + texto del nivel, nunca solo un punto de color |
| **i18n ES/EN** | Toda la UI vive en un sistema de claves de traducción, nunca string hardcodeado | Selector de idioma persistente en configuración y visible en onboarding; fechas/números con formato de locale (`Intl.NumberFormat`, `Intl.DateTimeFormat`) |

### 3.3 Señales de confianza visibles y legibles

**El sistema de Trust Score — gramática visual fija en todo el producto (nunca varía por módulo):**

```
┌─────────────────────────────────┐
│  🛡️ [Avatar]  Rosa M.           │
│      ●●●●○  87 · Confiable      │  ← barra de 5 segmentos + número + nivel en texto
│      Verificada · 2 años · 14   │  ← 3 señales concretas, siempre visibles, nunca ocultas
│      transacciones sin disputa  │     tras un tap
└─────────────────────────────────┘
```

- **5 niveles con nombre + color + ícono fijo** (nunca solo color): Nuevo (gris, ícono de brote/seedling) → Verificado (azul info, ícono de check simple) → Confiable (verde éxito, ícono de escudo) → Premium (dorado de marca, ícono de estrella) → Diamante (acento especial, ícono de diamante) — nombres y umbrales exactos a definir con backend, pero la gramática visual (barra de segmentos + nombre + ícono) es fija y no configurable por tenant.
- **Siempre clickeable → siempre explica el "por qué".** Tocar cualquier Trust Score abre una hoja (bottom sheet) con el desglose de señales — nunca es un número mudo. Esto es lo que lo distingue de "otro badge de vanidad".
- **Badge de verificación de identidad** (documento + selfie confirmados): ícono de check en círculo sólido, sobre el avatar, esquina inferior derecha — patrón reconocible tipo "verified" de apps serias, pero con nuestro propio ícono (nunca copiar el checkmark azul de Meta/X para evitar confusión de marca).
- **Botón "Reportar estafa"** — **siempre en la misma posición relativa** (dentro del menú de acciones de cualquier perfil/listing, primera opción, en rojo `--color-danger` con ícono de bandera) en las 12+ superficies donde aplica (perfiles, listings de propiedad, listings de negocio, mensajes, comentarios). La consistencia posicional es en sí misma una señal de seguridad — el usuario no tiene que "buscar cómo defenderse".
- **Verificador de notario/abogado** (Escudo Anti-Estafa, Plan Maestro §2.1): resultado siempre en formato binario grande y sin ambigüedad — tarjeta verde con ✅ *"Abogado licenciado en NY, matrícula #12345"* o tarjeta roja con ❌ *"No encontrado en el directorio oficial del DOJ — no es representante acreditado"*. Nunca un resultado gris/neutro que deje duda.

### 3.4 Offline-first — diseño para conexión pobre

Dado que el público objetivo frecuentemente usa datos móviles limitados o wifi compartido de mala calidad:

- **Skeleton screens, no spinners genéricos.** Todo contenido que carga (feed, perfil, listing) muestra la silueta de su layout final (shimmer sutil, `--duration-base`) en vez de un spinner centrado — reduce la percepción de espera y evita el "salto" de layout cuando el contenido llega (CLS).
- **Banner de estado de conexión, no bloqueo total.** Si se pierde conexión, un banner superior discreto ("Sin conexión — mostrando lo último guardado") permite seguir viendo contenido cacheado (feed, perfil propio, guías descargadas) en vez de una pantalla de error bloqueante.
- **Imágenes progresivas.** Placeholder de color dominante (extraído server-side) → versión blur-hash → imagen completa en WebP/AVIF con `srcset`. Nunca un espacio en blanco mientras carga.
- **Acciones encoladas offline.** Si el usuario intenta enviar un mensaje o guardar un listing sin conexión, la acción se encola visualmente (ícono de reloj, "se enviará cuando vuelva la conexión") en vez de fallar silenciosamente o mostrar un error técnico.
- **Guías descargables.** Las Guías "Cómo hacer X" (moat del Plan Maestro §2.1.4) tienen un botón explícito "Guardar para leer sin conexión" — un trámite migratorio es exactamente el tipo de contenido que alguien necesita poder leer en una sala de espera sin señal.

### 3.5 Estados vacíos que guían (nunca pantallas en blanco)

Regla general: **ningún estado vacío es solo "No hay contenido"**. Cada uno tiene: ilustración simple de línea (mismo estilo que la iconografía, nunca clip-art), un mensaje cálido en español directo, y **una acción concreta** que resuelve el vacío.

| Contexto | Mala práctica (evitar) | Nuestro patrón |
|---|---|---|
| Feed sin posts en tu zona | "No hay publicaciones" | Ilustración de mapa + *"Todavía no hay mucho movimiento en tu zona — sé el primero en compartir algo"* + botón "Crear publicación" |
| Búsqueda sin resultados | "0 resultados" | *"No encontramos nada con esas palabras"* + sugerencias de búsquedas relacionadas + botón "Avisame cuando aparezca algo así" (crea alerta) |
| Grupos sin unirse | Pantalla en blanco | Ilustración de personas + *"Todavía no estás en ningún grupo"* + 3 grupos sugeridos según su comunidad/ubicación con botón directo "Unirme" |
| Mensajes vacío | "No hay mensajes" | *"Tus conversaciones van a aparecer acá"* + acceso directo a "Buscar gente de [país] cerca tuyo" |
| Error de carga (falla de red real) | "Error 500" / ícono roto | *"Algo no cargó bien de nuestro lado — no es tu culpa"* + botón "Reintentar" + (si offline) fallback a contenido cacheado |

---

## 4. Flujos y pantallas clave (wireframes detallados)

Convenciones de lectura: `[ ]` = elemento tocable, `━` = separador visual, `●○` = indicador de progreso/estado, todas las medidas asumen viewport mobile de referencia 375×812px (iPhone 13 mini / SE grande), mobile-first.

### 4.a Onboarding "Recién Llegado"

```
┌─────────────────────────────────────┐
│ [← ]                    ES ⇄ EN [ ] │  ← selector de idioma siempre visible, back opcional
│                                      │
│         [LOGO DEL TENANT]           │  ← zona de marca, contenida (§2.3 regla 4)
│                                      │
│      ¿De dónde sos vos o tu         │  ← H1, --font-size-2xl, 700, neutral-900
│      familia?                       │
│                                      │
│   ┌───────┐ ┌───────┐ ┌───────┐    │
│   │ 🇩🇴    │ │ 🇨🇴    │ │ 🇲🇽    │    │  ← tarjetas grandes 100×100px mín,
│   │ Rep.  │ │Colombia│ │México │    │     ícono grande + texto, radius-lg,
│   │ Dom.  │ │       │ │       │    │     Double-Bezel sutil
│   └───────┘ └───────┘ └───────┘    │
│   ┌───────┐ ┌───────┐ ┌───────┐    │
│   │ 🇻🇪    │ │ 🇵🇷    │ │ Otro  │    │
│   │Venez. │ │ P.Rico│ │  país │    │
│   └───────┘ └───────┘ └───────┘    │
│                                      │
│              ● ○ ○ ○ ○              │  ← progreso, 5 pasos, dot activo en color de marca
└─────────────────────────────────────┘

  Paso 2 — multi-selección, avanza automático al elegir 1+:

┌─────────────────────────────────────┐
│ [← ]                                │
│                                      │
│   ¿Qué necesitás resolver hoy?      │  ← copy cálido, no "¿Qué buscás?" seco
│   Elegí todo lo que quieras.        │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ 🏠  Buscar dónde vivir      [✓]│ │  ← fila completa tocable (44px+ alto),
│  └────────────────────────────────┘ │     checkbox visual grande a la derecha
│  ┌────────────────────────────────┐ │
│  │ 💼  Buscar trabajo           [ ]│ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ 🤝  Conocer gente de mi país [✓]│ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ 🛡️  Protegerme de estafas    [ ]│ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ 📖  Aprender trámites acá     [ ]│ │
│  └────────────────────────────────┘ │
│                                      │
│  [        Continuar (2)        ]    │  ← CTA primario, deshabilitado hasta 1+,
│                                      │     color de marca del tenant, radius-full
│              ○ ● ○ ○ ○              │
└─────────────────────────────────────┘

  Paso 5 — recompensa inmediata (aterrizaje, NO más onboarding):

┌─────────────────────────────────────┐
│  ✨ Así se ve tu comunidad en       │  ← modal/toast descartable, 4s auto-dismiss
│     Queens, NY                      │     o tap para cerrar, aria-live="polite"
│                          [Entendido]│
├─────────────────────────────────────┤
│  Feed · Queens, NY            [⚙] │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ [foto] Depto 1BR verificado ✓  │ │  ← contenido REAL ya filtrado por selección
│  │ $1,400/mes · a 10 min de ti    │ │     del paso 2 — nunca feed vacío
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ [foto] Se busca ayudante en    │ │
│  │ restaurante dominicano · hoy   │ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ 📖 Guía: cómo sacar tu ITIN    │ │
│  │ en Nueva York — 5 min de       │ │
│  │ lectura                         │ │
│  └────────────────────────────────┘ │
│                                      │
│ [🏠][🏢][👥][💬][👤]                │  ← bottom nav, 5 ítems máx (regla ux)
└─────────────────────────────────────┘
```

**Copy real de ejemplo (tono cálido, directo, sin jerga — aplicando `ux-writing`):**
- Título paso 1: *"¿De dónde sos vos o tu familia?"* (nunca "Selecciona tu país de origen" — muy formal/frío)
- CTA deshabilitado: *"Elegí al menos una opción"* (nunca "Campo requerido")
- Verificación SMS: *"Te mandamos un código a tu teléfono. Escribilo acá abajo."* (nunca "Ingrese el OTP enviado")
- Error de red en onboarding: *"No pudimos conectar — revisá tu conexión e intentá de nuevo."* (nunca "Network Error")

### 4.b Feed principal

```
┌─────────────────────────────────────┐
│ [LOGO tenant]  Queens, NY ▾   [🔔3]│  ← header: marca + selector ubicación + notif
├─────────────────────────────────────┤
│ [Para ti][Propiedades][Negocios]... │  ← tabs de los 5 feeds, scroll horizontal,
│  ▔▔▔▔▔▔                              │     tab activo con underline color de marca
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ ○ Ana P. ●●●●○92      · 2h      │ │  ← autor con Trust Score inline (siempre)
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
│ │ "¿Alguien sabe de un dentista    │ │  ← body texto, --font-size-base, line-height 1.5
│ │ que acepte pacientes sin         │ │
│ │ seguro en Corona?"               │ │
│ │                                  │ │
│ │ [♡ 12]  [💬 5]  [↗ Compartir]   │ │  ← acciones subordinadas, iconografía Phosphor
│ └─────────────────────────────────┘ │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ [FOTO listing 16:9]              │ │  ← card de listing verticalmente distinta
│ │ 🏠 Depto 1BR · Jackson Heights  │ │     del post social — jerarquía clara
│ │ $1,350/mes                       │ │
│ │ 🛡️ Verificado · Publicado por   │ │
│ │    inmobiliaria ●●●●● 98         │ │
│ │ [       Ver detalles →      ]   │ │  ← CTA de card, saca del feed (anti-scroll)
│ └─────────────────────────────────┘ │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ 📖 Guía destacada                │ │  ← formato distinto para contenido de Guías
│ │ "Cómo abrir cuenta bancaria sin  │ │     (moat, SEO) — nunca se confunde con un post
│ │ SSN en Nueva York"                │ │
│ │ [        Leer (5 min)        ]  │ │
│ └─────────────────────────────────┘ │
│                                      │
│ [🏠][🏢][👥][💬][👤]                │
│      ↑ activo, color de marca       │
└─────────────────────────────────────┘
```

**Jerarquía visual y componentes:**
- **3 tipos de card claramente distinguibles por estructura** (no solo color): post social (avatar + Trust Score inline + acciones sociales), listing vertical (imagen 16:9 + precio destacado + badge de verificación + CTA único), contenido editorial/guía (ícono de libro + formato de "artículo" con tiempo de lectura). Esto evita el error de Facebook donde todo se ve igual y hay que leer para saber qué es.
- **Trust Score siempre inline junto al nombre del autor** — nunca requiere ir al perfil para verlo. Es la aplicación directa del principio "la confianza es un sistema visual" (§1.1.②).
- **Nunca autoplay de video con sonido** (regla de accesibilidad + cortesía en conexión pobre) — video inicia muted con tap-to-unmute visible.
- **Pull-to-refresh con gesto estándar**, nunca redefinido (regla `standard-gestures`).

### 4.c Perfil con Trust Score

```
┌─────────────────────────────────────┐
│ [← ]                        [⋯ ]   │  ← menú de acciones incluye "Reportar" 1º
├─────────────────────────────────────┤
│         ┌──────────┐                │
│         │  [AVATAR] │ 🛡️           │  ← avatar grande + badge verificación
│         └──────────┘                │     esquina inf-derecha
│                                      │
│         Rosa Martínez                │  ← nombre, --font-size-xl, 700
│         🇩🇴 Rep. Dominicana · Queens│  ← metadata secundaria, neutral-600
│                                      │
│    ┌────────────────────────────┐   │
│    │  ●●●●○  87 · Confiable     │   │  ← Card de Trust Score, Double-Bezel,
│    │  Tocá para ver el detalle →│   │     siempre clickeable (regla §3.3)
│    └────────────────────────────┘   │
│                                      │
│    [ Enviar mensaje ]  [ Seguir ]   │  ← 1 CTA primario (mensaje, color marca)
│                                      │     + 1 secundario (outline)
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  En la comunidad hace 2 años         │  ← señales concretas de confianza,
│  14 transacciones sin disputa        │     texto plano legible, nunca solo íconos
│  Avalada por 3 vecinos verificados   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  [Publicaciones][Reseñas][Negocios] │  ← tabs secundarios de contenido del perfil
├─────────────────────────────────────┤
│  (feed de posts de este usuario)     │
└─────────────────────────────────────┘

  Al tocar la card de Trust Score → bottom sheet (hoja inferior):

┌─────────────────────────────────────┐
│           ─────                     │  ← handle de arrastre, indica "deslizable"
│  Trust Score de Rosa                │
│                                      │
│         ●●●●○  87                   │  ← número grande, tabular-nums
│         Nivel: Confiable            │
│                                      │
│  Cómo se calcula:                    │
│  ✓ Identidad verificada (documento) │  ← desglose real de señales, cada una
│  ✓ Teléfono verificado              │     con su propio ícono de check
│  ✓ 2 años en la comunidad           │
│  ✓ 14 transacciones sin disputa     │
│  ✓ 3 vecinos verificados la avalan  │
│  ○ Aún no verificó su dirección     │  ← señal faltante, gris, sin penalizar
│                                      │     visualmente de más (no es "malo",
│                                      │     es "todavía no")
│                                      │
│  [Leer cómo funciona el Trust Score]│  ← link a explicación general (educar)
└─────────────────────────────────────┘
```

### 4.d Listing verificado (departamento) con señales de confianza

```
┌─────────────────────────────────────┐
│ [← ]                    [♡][↗ ]    │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │                                  │ │
│ │      [GALERÍA DE FOTOS]          │ │  ← 16:9, swipe horizontal, contador "3/8"
│ │                          [3/8]   │ │
│ └─────────────────────────────────┘ │
│                                      │
│  🛡️ Verificado por Comunidad Latina│  ← banda de confianza, SIEMPRE arriba
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │     del precio, fondo success-bg suave
│                                      │
│  Depto 1BR · Jackson Heights         │  ← título, --font-size-xl 700
│  $1,350/mes                          │  ← precio destacado, --font-size-2xl,
│                                      │     tabular-nums, color de marca del tenant
│  [🛏 1 hab] [🚿 1 baño] [📐 650 ft²]│  ← chips de specs, iconografía consistente
│                                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Publicado por                       │
│  ┌────────────────────────────────┐ │
│  │ [logo] Inmobiliaria Rodríguez   │ │  ← Double-Bezel card del publicador
│  │ ●●●●● 98 · Confiable            │ │     con Trust Score inline
│  │ 47 propiedades publicadas       │ │
│  │ Verificado: licencia de agente  │ │  ← señal específica del vertical inmobiliario
│  └────────────────────────────────┘ │
│                                      │
│  ⚠️  Antes de pagar cualquier cosa: │  ← módulo del Escudo Anti-Estafa,
│  Nunca envíes depósito sin ver el    │     SIEMPRE presente en listings de
│  lugar en persona o por video.       │     propiedad/renta, fondo warning-bg
│  [Aprender a identificar estafas →] │
│                                      │
│  Descripción                         │
│  Departamento luminoso a 10 min de  │
│  la estación 7...                    │
│                                      │
│  Ubicación                           │
│  [MAPA — pin aproximado, no exacto] │  ← privacidad: nunca dirección exacta
│                                      │     pública hasta contacto confirmado
├─────────────────────────────────────┤
│  [    💬 Contactar (protegido)   ]  │  ← CTA primario fijo (sticky), full-width
└─────────────────────────────────────┘
```

**Detalle de las señales de confianza en este flujo (aplicación directa del moat "Escudo Anti-Estafa"):**
- La banda **"Verificado por Comunidad Latina"** no es decorativa — solo aparece si el listing pasó verificación real (documento de propiedad/licencia de agente + revisión). Si NO está verificado, la banda simplemente no existe (nunca un badge "no verificado" en rojo que estigmatice al publicador nuevo — se resuelve con ausencia, no con negativo).
- El **aviso amarillo de seguridad** es un componente reusable (`<ScamShieldNotice variant="rental" />`) que cambia su copy según el contexto (renta, empleo, servicios) pero mantiene posición y estilo fijos — el usuario aprende a reconocerlo en cualquier vertical.
- El **mapa con pin aproximado** (no dirección exacta) es una decisión de privacidad-por-diseño que además comunica cuidado: la dirección exacta solo se revela tras iniciar contacto, replicando cómo Airbnb maneja la privacidad de ubicación.

### 4.e Asistente Comunitario

```
┌─────────────────────────────────────┐
│ [← ]  Asistente de Queens, NY      │  ← se nombra por comunidad, no "Chatbot IA"
├─────────────────────────────────────┤
│                                      │
│         [ilustración simple de      │  ← estado inicial: sugiere preguntas,
│          un ícono de brújula]       │     nunca un input vacío intimidante
│                                      │
│   Preguntame lo que necesites       │
│   sobre vivir acá.                  │
│                                      │
│   Probá con:                        │
│   ┌────────────────────────────┐   │
│   │ "¿Dónde compro harina PAN   │   │  ← chips de preguntas sugeridas,
│   │  cerca de Corona?"          │   │     tocables, pre-llenan el input
│   └────────────────────────────┘   │
│   ┌────────────────────────────┐   │
│   │ "¿Cómo saco mi ITIN?"       │   │
│   └────────────────────────────┘   │
│   ┌────────────────────────────┐   │
│   │ "Dentista barato sin       │   │
│   │  seguro"                    │   │
│   └────────────────────────────┘   │
│                                      │
│  (conversación, una vez iniciada:)  │
│                                      │
│  ┌────────────────────────────┐    │
│  │ ¿Dónde compro harina PAN    │    │  ← burbuja usuario, alineada derecha,
│  │ cerca de Corona?             │    │     fondo color de marca suave
│  └────────────────────────────┘    │
│                                      │
│  [🤖] Encontré 3 lugares cerca      │  ← burbuja asistente, alineada izq,
│       tuyo que la venden:            │     fondo neutral-50, avatar/ícono
│                                      │     propio (nunca genérico "IA robot")
│  ┌────────────────────────────┐    │
│  │ 🛒 Supermercado Dominicano  │    │  ← respuesta con tarjetas de resultado
│  │ El Progreso · 0.4 mi         │    │     real, no solo texto — accionable
│  │ [Ver en mapa]                │    │
│  └────────────────────────────┘    │
│                                      │
│  Esta info viene de negocios         │  ← disclosure de fuente, genera confianza
│  verificados en tu comunidad.        │     en la respuesta (no "alucinación IA")
│                                      │
├─────────────────────────────────────┤
│ [Escribí tu pregunta...    ] [➤]   │  ← input fijo abajo, siempre visible
└─────────────────────────────────────┘
```

**Principios de diseño conversacional aplicados (`ux-writing` + confianza):**
- **Nunca se presenta como "IA" fría o genérica** — se nombra "Asistente de [Ciudad]" para reforzar que es *hiperlocal y comunitario*, coherente con el moat del Plan Maestro (RAG sobre datos del tenant, no un LLM genérico).
- **Respuestas siempre con fuente/disclosure** ("Esta info viene de negocios verificados en tu comunidad") — crítico para que el usuario confíe en una respuesta generada, especialmente en temas sensibles como trámites.
- **Nunca finge certeza en temas legales.** Para preguntas de trámites migratorios (línea roja del Plan Maestro §2.2), la respuesta del asistente siempre deriva a contenido de Guías verificado o a un profesional verificado — nunca improvisa asesoría legal. Esto se refuerza visualmente con un tag `⚖️ Verificado por nuestras guías` o `👤 Te recomendamos hablar con un abogado verificado` cuando aplica.
- **Preguntas sugeridas como chips** resuelven el "blank page problem" — el usuario de baja alfabetización digital no siempre sabe qué preguntarle a un chat vacío.

---

## 5. Motion y microinteracciones

Filosofía: motion premium en mobile significa **rápido, con propósito, y barato en GPU** — nunca decorativo ni pesado. Toda animación usa `transform`/`opacity` exclusivamente (nunca `width`/`height`/`top`/`left`, que fuerzan reflow) y respeta `prefers-reduced-motion`.

### 5.1 Feedback táctil y háptico

- **Press feedback en <100ms:** todo elemento tocable escala levemente al presionar (`scale(0.97)`, `--duration-instant`, `--ease-spring`) y vuelve a `scale(1)` al soltar. Comunica "la app me escuchó" antes de cualquier resultado de red.
- **Haptic feedback nativo** (Vibration API / `navigator.vibrate` corto, 10-15ms) en: confirmación de envío de mensaje, like/reacción, verificación exitosa (Trust Score sube), y alerta de riesgo del Escudo Anti-Estafa (patrón de vibración distinto y más largo para alertas, para que se distinga sin mirar la pantalla). Nunca abusar — solo en confirmaciones/alertas genuinas.
- **Botones deshabilitados nunca dan feedback de press** — refuerza visualmente que la acción no está disponible (opacity 0.4-0.5 + `cursor: not-allowed` + sin animación de scale).

### 5.2 Skeletons y estados de carga

- Todo contenido asíncrono que tarda >300ms muestra skeleton con shimmer sutil (`--duration-base`, gradiente que recorre de izquierda a derecha, opacity entre 0.6-1 en la escala de neutros) — nunca spinner centrado genérico para contenido de feed/perfil/listing.
- Spinners circulares reservados exclusivamente a **acciones dentro de botones** (enviar formulario, confirmar pago) — nunca para carga de página completa.
- Transición skeleton → contenido real: crossfade de `--duration-base` (250ms), nunca un "pop" instantáneo que sea disruptivo.

### 5.3 Transiciones de pantalla y navegación

- **Navegación hacia adelante** (drill-down: feed → detalle de listing): el contenido entra desde la derecha con slide + fade sutil (`--duration-page`, `--ease-out-premium`), la pantalla anterior se desplaza levemente a la izquierda con leve escala hacia abajo (`scale(0.96)`) para dar sensación de profundidad espacial (patrón "hierarchy-motion": adelante = más cerca, atrás = más lejos).
- **Navegación hacia atrás:** exactamente la animación inversa, pero un 30% más rápida (`--duration-base` en vez de `--duration-page`) — las salidas se sienten más responsivas que las entradas.
- **Bottom sheets** (Trust Score detail, filtros, menú de acciones): entran con slide-up + fade desde el punto de origen del tap (nunca desde el centro de la pantalla genérico), con scrim de fondo que oscurece progresivamente (40-60% negro, nunca menos — regla de legibilidad de scrim).
- **Modales de alto riesgo** (confirmar pago, confirmar eliminación de cuenta, alerta de estafa detectada): la animación de entrada es más lenta y deliberada (`--duration-slow`, 400ms) — la lentitud comunica "esto es importante, no lo hagas sin pensar", contraste intencional con la rapidez del resto del sistema.

### 5.4 Scroll y entrada de contenido

- Las tarjetas del feed entran con fade-up sutil (`translateY(12px)` → `0`, opacity 0→1, `--duration-base`) al entrar en viewport, vía `IntersectionObserver` — nunca listener de scroll nativo (mata el rendimiento en mobile).
- **Sin parallax en mobile** — el parallax en scroll consume batería y frame budget que no sobra en hardware de gama media/baja, que es el hardware realista de la población objetivo.
- Listas largas (feed, resultados de búsqueda, mensajes) se virtualizan a partir de 50 elementos (regla `virtualize-lists`) para mantener scroll a 60fps incluso en dispositivos de gama baja con conexión pobre.

### 5.5 Celebración y refuerzo positivo (sin infantilizar)

- **Trust Score sube:** micro-animación de la barra de segmentos rellenándose con `--ease-spring` + destello sutil de color de marca (nunca confetti genérico de gamificación barata) + haptic corto. Comunica logro sin verse como juego para niños.
- **Verificación de identidad exitosa:** el ícono de check se dibuja con un trazo de `stroke-dasharray` animado (250ms) en vez de aparecer instantáneo — sensación de "algo se completó", no de "un elemento apareció".
- **Envío de reporte de estafa confirmado:** feedback inmediato y serio (nunca festivo) — check simple + copy de agradecimiento sobrio: *"Gracias, tu reporte ayuda a proteger a toda la comunidad."*

### 5.6 Gestos

- **Swipe estándar únicamente:** swipe-back de navegación (nativo del sistema, nunca redefinido), swipe horizontal en galerías de fotos, pull-to-refresh vertical estándar. Nunca gestos custom no documentados que el usuario tenga que "descubrir".
- **Threshold de arrastre** antes de iniciar cualquier drag (evita drags accidentales al hacer scroll) — mínimo 8-10px de movimiento antes de interpretar como gesto intencional.
- **Alternativa visible siempre disponible.** Ninguna acción crítica depende solo de un gesto — swipe-to-delete en una lista de mensajes, por ejemplo, siempre coexiste con un botón de acción visible en un menú de "⋯", porque un usuario de baja alfabetización digital puede no descubrir el gesto nunca.

---

## 6. Guardrails de consistencia (qué es fijo vs. qué es configurable)

Esta es la sección que hace el white-label operativamente seguro para Geovanny: define, sin ambigüedad, qué puede tocar un admin de tenant y qué es intocable por diseño de sistema.

### 6.1 Tabla de guardrails

| Elemento | Fijo (premium, no configurable) | Configurable por tenant | Mecanismo de seguridad |
|---|---|---|---|
| **Tipografía** | Familias (General Sans / Plus Jakarta Sans), escala completa, pesos | — (ningún tenant elige tipografía en v1; ver nota abajo) | No expuesto en el panel de admin en absoluto |
| **Paleta de neutros** | Escala completa §2.3 (fondo, superficies, texto, bordes) | — | No expuesto; es la Capa 1 |
| **Colores semánticos** (success/warning/danger/info) | Valores fijos, nunca derivados de marca | — | Hardcoded en el design system, no en config de tenant |
| **Color de marca** | El pipeline de validación/transformación (§2.3) | 1 hex primario (+ opcional 1 hex de acento secundario) | Pipeline automático de contraste + generación de escala tonal — el admin nunca edita el resultado, solo el input |
| **Espaciado, radios, sombras** | Escala completa §2.4/§2.5 | — | No expuesto |
| **Iconografía** | Set único (Phosphor), pesos y tamaños | — | No expuesto; ícono de marca del tenant (si trae uno propio) se usa solo en el logo, nunca reemplaza los íconos funcionales del sistema |
| **Motion tokens** | Duraciones y easings completos | — | No expuesto |
| **Componentes** (cards, botones, Trust Score, badges, estados vacíos) | Estructura y comportamiento 100% fijos | Solo el color de acento se propaga automáticamente | Componentes del design system son "cerrados" — no editables vía panel, solo vía código central |
| **Logo** | Zona de contención (tamaño máx, posición en header) | El archivo del logo en sí | Validación de dimensiones/aspect ratio en upload; se normaliza a un contenedor fijo |
| **Nombre del tenant / dominio** | — | Nombre, dominio, favicon | Simple texto/asset, sin impacto en design system |
| **Copy / microcopy** | Tono de voz, estructura de mensajes de error/vacío/confirmación (§ux-writing) | Nombre del tenant se interpola en templates ("Bienvenido a Dominicanos.com") | Sistema de claves i18n con interpolación de variables de tenant, nunca copy libre editable |
| **Layout de pantallas** | Estructura completa de cada pantalla (§4) | — | Cero configuración de layout por tenant — esto es lo que garantiza consistencia de UX entre los N dominios |

**Nota sobre tipografía por tenant:** se decide **no exponer selección de tipografía en v1** (ni siquiera dentro de una lista curada) porque es el vector de riesgo más común de "blanqueo con mal gusto" (un admin eligiendo Comic Sans o una fuente decorativa ilegible). Si a futuro se quisiera dar más personalización de marca, la única vía seria seria una **lista curada cerrada de 3-4 pares tipográficos pre-aprobados por el equipo de diseño** (nunca upload de fuente libre ni input de nombre de Google Font arbitrario).

### 6.2 El principio general

> **Todo lo que un admin de tenant puede tocar pasa por una función determinística que produce un resultado premium garantizado. Nunca hay una ruta donde el input crudo del admin llegue directo al DOM.**

Esto es lo que separa este sistema de un "theme.json editable" ingenuo (que es como la mayoría de plataformas white-label baratas fallan): en vez de dar 40 variables sueltas al admin, se le da **1 decisión de alto nivel (un color) que un sistema transforma en las 10-15 variables reales que sí tocan el UI**, con validación de accesibilidad en el medio. El admin nunca tiene el poder de romper la consistencia — solo el poder de personalizar dentro de una caja que el sistema garantiza que se ve bien.

### 6.3 Proceso de QA de un tenant nuevo (parte del "Playbook de Nacimiento de Tenant", Plan Maestro §7.4)

Antes de que cualquier dominio nuevo salga de "Gestación" a "Nacimiento" (Plan Maestro épica 29), corre un checklist de diseño automatizable:
1. Contraste del color de marca validado en ambos modos (light/dark) — automático, bloqueante.
2. Logo normalizado dentro del contenedor de header sin distorsión de aspect ratio — automático, bloqueante.
3. Captura de pantalla del feed principal, perfil, y onboarding generada automáticamente para revisión visual rápida del equipo antes del lanzamiento del dominio — manual, no bloqueante pero recomendado.
4. Ningún string de copy sin traducir (fallback a clave i18n visible) — automático, bloqueante.

---

## 7. Resumen de decisiones para implementación (referencia rápida del enjambre)

- **Tipografía:** General Sans/Clash Display (headings) + Plus Jakarta Sans (body/UI), ambas variables, gratuitas, con excelente soporte ES.
- **Paleta base:** escala de neutros cálidos (`--neutral-25` a `--neutral-950`, nunca gris frío puro ni negro/blanco puros).
- **Color de marca:** 1 hex de tenant → pipeline de validación de contraste + generación de escala tonal automática → solo 4 usos permitidos (CTA primario, nav activo, acentos puntuales, logo).
- **Radios:** squircle-leaning, 16-32px según componente, nunca esquinas duras.
- **Sombras:** Double-Bezel (shell + core) en toda card de confianza alta; escala de elevación cálida y difusa, nunca `rgba(0,0,0,0.3)`.
- **Iconografía:** Phosphor Icons, Regular/Light, 1.5-2px de trazo, nunca emoji funcional.
- **Motion:** `cubic-bezier(0.32,0.72,0,1)` para entradas, spring para feedback, 150-400ms según jerarquía, solo `transform`/`opacity`.
- **Dark mode:** paleta tonal propia, nunca inversión matemática; color de marca se ajusta automáticamente (+8-12% L).
- **Accesibilidad:** WCAG AA como piso (4.5:1 texto, 44px targets, focus visible, reduced-motion, i18n ES/EN completo).
- **Onboarding:** 5 pasos, <60s, cero texto libre en los primeros 3 pasos, aterriza en feed ya poblado y filtrado.
- **Confianza:** Trust Score con gramática visual fija (barra de segmentos + número + nivel + ícono), siempre clickeable y explicado; "Reportar estafa" en posición fija en 12+ superficies.
- **White-label:** arquitectura de 3 capas (primitivos fijos → semánticos fijos con 1 punto de inyección de marca → tenant). El admin nunca edita el DOM directo — solo alimenta un pipeline que garantiza calidad.

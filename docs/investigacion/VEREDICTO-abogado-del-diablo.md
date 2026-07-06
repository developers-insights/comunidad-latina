# VEREDICTO — Abogado del Diablo sobre el PLAN MAESTRO V2

**Fecha:** 2026-07-06 · **Método:** 5 fiscales adversariales en paralelo (premisas/punto ciego, mercado/competencia, viabilidad técnica-legal, números, ejecución/pre-mortem), cada uno con investigación de casos reales. Este documento consolida el veredicto que alimenta la **V3**.

---

## VEREDICTO (sin anestesia)

El plan es un documento de investigación excelente **disfrazado de plan de ejecución**. Sabe *qué construir* y *por qué gana*, pero está estructurado para **no terminar nunca**: decidió el producto completo (31 épicas, 8 dominios, moat de IA) **antes de validar la única pregunta que importa** — ¿un inmigrante deja su Facebook Group lleno por esto, y un negocio local paga sin ROI probado, en UN mercado, de forma repetible? La economía real necesita **5-6× más capital del que declara**, el enjambre de IA no puede construir la capa que no puede fallar (RLS multi-tenant) de forma segura, y el moat de IA es responsabilidad civil disfrazada de feature. Contra una marca que vence en octubre y un cliente ya quemado por una empresa que no entregó, el plan actual reproduce ese trauma con más tecnología.

**Nada de esto mata el objetivo. Mata la RUTA.** El producto correcto sigue adentro; hay que llegar a él por una ruta validada, no por un big-bang.

---

## LA QUE LO MATA (causa de muerte #1)

**Scope infinito + cadena de dependencias que posterga todo lo monetizable + código de IA que un equipo chico no puede mantener = el producto nunca llega a manos de usuarios reales antes de que se agoten la marca (oct-2026), el capital (valle real ~$235k) y la paciencia del cliente.** Evidencia del propio repo: una sesión autónoma completa produjo un plan en su 3ª versión y **cero líneas de código**. La enfermedad ya está en movimiento.

---

## LAS GRIETAS, POR LETALIDAD

1. **Scope infinito / big-bang (LETAL).** "Producto completo, no MVP" repetido como mantra; el scope creció 32% (V1→V2, +10 épicas) sin una línea de código. Los proyectos big-bang mueren a mitad de camino. Fix: rebanada vertical en producción, no las 31 épicas.
2. **Economía irreal (LETAL).** Valle 6× subestimado (~$235k, no $43k: opex real $13.2k/mes con moderación humana + legal + soporte; influencers $40-60k no $5k). CAC 5× ($62 no $12.50: confunde traer un consumidor con cerrar una venta B2B ~$150). Churn 3× (15% no 3%). LTV:CAC de "221:1" → **1.6:1 (destruye valor)** en el segmento de volumen.
3. **El competidor invisible ya ganó (LETAL).** Facebook (60% hispanos) + WhatsApp (98% open rate) + TikTok (88% de PYMES latinas venden ahí, gratis). El plan **nunca prueba que alguien se vaya** de donde ya está. "Caótico y lleno de tu gente" le gana a "ordenado y vacío".
4. **Contradicción confianza-verificada vs. privacidad anti-ICE (LETAL + riesgo humano).** El moat #1 (reputación verificada + portable) construye el grafo identidad-ubicación-red que las subpoenas de ICE (cientos, feb-2026, a Google/Meta/Reddit/Discord) quieren. La verificación (Vision+SMS) es KYC en la DB — lo que la propia §3.3 prohíbe. **RLS no protege contra subpoena.** El moat y la promesa de privacidad se cancelan.
5. **El enjambre de IA no puede construir RLS multi-tenant sin fuga (LETAL técnico).** CVE-2025-48757: 170+ apps por una policy faltante que compiló limpio. 70% de apps hechas con IA con RLS off en ≥1 tabla. El gate de tests que el enjambre se escribe a sí mismo es el zorro cuidando el gallinero. Falta enumerador que falle el build + cobertura Storage/Realtime + pentest humano.
6. **El moat de IA = responsabilidad civil (LETAL para el moat).** "Interceptar fraude antes" es vaporware; "verificar notarios" crea deber de cuidado (negligent misrepresentation si falla); "asistente de trámites" → UPL (FTC v. DoNotPay). Capado por legal → el moat colapsa a paridad. Falta "verificado" determinístico + guardrails + seguro E&O (no está en los $247/mes).
7. **Multi-tenant N-dominios = cementerio hiperlocal (ALTA).** Patch quemó $200-300M en esto. NO hay economías de red entre tenants (un negocio dominicano en Queens no sirve a un colombiano en Miami), solo economías de código. 8 dominios = 8 pueblos fantasma simultáneos; el kill-switch al 35% convierte el modelo en un coin flip.
8. **Cold-start paradox (ALTA).** El lado que financia todo (el negocio que paga) es el que menos razón tiene para entrar primero a una red vacía. El seed no está presupuestado (~$32k para 8 dominios).
9. **El seed "scraping ético" es ilegal (ALTA).** Craigslist ganó **$60M contra RadPad** por scrapear rentals y contactar dueños — el método exacto del plan. Y "tenant en minutos" (una fila) contradice "Playbook de Nacimiento" (semanas de trabajo humano). Falta: fuentes licenciadas/opt-in; reconciliar minutos vs. semanas.
10. **"Avance para el viernes" vs. 31 épicas = progreso falso (ALTA).** Login/branding/PWA son las piezas más fáciles y las menos correlacionadas con resolver un dolor. Con un cliente ya víctima de progreso falso, es nitroglicerina. "Avance" debe redefinirse como *resolución real de un usuario*.

---

## ARREGLAR ESTO PRIMERO (input directo a la V3)

1. **Redefinir la RUTA, no el objetivo.** Rebanada vertical delgada en producción en ~60 días: **1 dominio · 1 vertical monetizable · 1 pago simple · 1 dolor transaccional agudo (wedge) · CERO features de IA-moat riesgosas al inicio**. Validar antes de escalar. El producto completo sigue siendo el destino.
2. **Elegir el wedge:** el dolor "hair-on-fire" que Facebook/WhatsApp resuelven MAL — probablemente **vivienda anti-estafa** o **trabajo verificado**. Una cosa, no doce.
3. **Economía honesta:** valle real ~$235k; separar CAC-consumidor (barato) de CAC-negocio B2B (~$150, venta humana); willingness-to-pay a validar con dinero real (Van Westendorp). Definir cómo entra el supply-side (freemium/oferta gratis inicial + probar ROI antes de cobrar).
4. **Resolver la contradicción de privacidad, tabla por tabla:** verificación FUERA de la DB (Stripe Identity → solo un flag booleano, se descarta el insumo); Trust Score sin grafo de endorsements persistente subpoenable; análisis legal de exposure por cada tabla. Sacrificar parte del moat por seguridad de la población.
5. **Seguridad multi-tenant de verdad:** enumerador automático que falle el build ante cualquier tabla con `tenant_id` sin RLS FORCE + 4 policies; cobertura de Storage + Realtime + Edge Functions; **pentest humano adversarial antes del primer dato real**; un ingeniero senior humano firma cada migración y cada webhook de Stripe.
6. **Moat legal-safe:** "verificado" = verificación determinística contra fuente oficial fechada (no match de IA); guardrails duros en el asistente (nunca plazos/montos/elegibilidad; solo texto citado + "hablá con un abogado"); revisión de abogado de inmigración ANTES de Fase 1; seguro E&O en la economía.
7. **Seed legal:** solo fuentes licenciadas (MLS/IDX), APIs oficiales, u opt-in directo. Borrar "scraping" del plan.
8. **Coexistencia, no reemplazo:** login con WhatsApp, share a WhatsApp/TikTok, integrarse al comportamiento existente en vez de pedir migración.
9. **Redefinir "avance"** = una resolución real de un usuario real (un dominicano recién llegado encuentra un depto/negocio verificado), no pantallas.
10. **Diseño premium + UX** (requisito del cliente) desde la rebanada inicial: la cuña debe verse premium y resolver el dolor con una experiencia excelente — es lo que valida el producto y tranquiliza a Geovanny.

---

*La V3 aplica estos 10 arreglos sin cambiar el objetivo (producto completo multi-tenant): misma meta, ruta validada y disciplinada.*

# HANDOFF — Construcción de Comunidad Latina (sesión Fable 5 / ultracode)

Prompt copiable y contexto para arrancar la **construcción del producto completo** con el enjambre de agentes.

---

## Leé primero (en este orden)
1. `docs/PLAN_MAESTRO.md` (**V4 — el norte único**).
2. `docs/investigacion/VEREDICTO-V3-segundo-pase.md` (por qué la V4 corrige lo que corrige — no reintroducir esos errores).
3. `docs/investigacion/13-diseno-ux-premium.md` (design system premium + UX del inmigrante — rige tal cual).
4. `docs/investigacion/01-arquitectura-multitenant-datos.md` (modelo de datos — fuente técnica).
5. `.env.example` + `docs/SETUP-ENV.md` (variables; Supabase desbloquea el arranque).

## Hecho y verificado
- Plan maestro en **V4 definitiva, orientada a construcción**: visión, moat legal-safe desde R1, diseño premium, arquitectura anti-honeypot, economía honesta, roadmap por rebanadas (R0→R5) con gates de seguridad, plan de ejecución para el enjambre (§14), riesgos, datos de ejemplo (§18).
- Investigación completa: 12 informes + diseño + **dos** veredictos adversariales.
- **Cero código aún** (greenfield). La construcción arranca ahora.

## Objetivo del cliente (no cambiar)
Construir el **producto completo YA**, con Fable 5 orquestando agentes especializados. No es MVP recortado ni "validar antes de construir". Donde falten datos → usar los **datos de ejemplo** del §18 (marcados `[EJEMPLO]`) o posponer lo no-esencial, nunca frenar.

## Próxima tarea — construir por rebanadas verticales (§2, §13, §14)
**R0 — Cimientos:** motor multi-tenant + auth (**login sin teléfono**, §5.4) + white-label premium (pipeline de marca §4.2) + PWA + observabilidad + **arquitectura anti-honeypot desde el 1er registro**.
**R1 — Wedge con moat:** vivienda verificada anti-estafa en `dominicanos.com` + **Escudo Anti-Estafa determinístico + verificador notario/abogado** (parte del moat, YA en R1) + Trust Score base + 1 pago (presencia verificada) + **contacto protegido dentro de la app** + onboarding "Recién Llegado" + diseño premium.
**Definición de "hecho" de R1:** un dominicano recién llegado encuentra/publica un depto verificado y evita una estafa — sin salir a WhatsApp para cerrar. NO "una pantalla de login linda".
Luego R2 (red social completa) → R3 (moat de IA + monetización) → R4 (escala multi-tenant) → R5 (completo + moonshots).

## Gates de seguridad NO negociables (§5.2, §14.4)
- **Enumerador RLS que rompe el build:** toda tabla con `tenant_id` sin RLS `FORCE` + las 4 policies falla CI. Enumera por `information_schema`, no confíes en una suite escrita por el agente.
- Cobertura de **Storage + Realtime + Edge Functions** (no solo tablas). Ojo *connection-pool contamination* y *async-context leak* (viven fuera del enumerador → por eso el pentest humano).
- **Pentest humano adversarial** antes del primer dato real.
- **Un ingeniero senior HUMANO firma cada migración RLS y cada webhook de Stripe.** Es un recurso **serial**: subordiná el ritmo de migraciones a su capacidad de firma, nunca al revés. **Sin senior contratado, no arranca la parte de datos reales de R0.**

## Gotchas (correcciones del 2º veredicto — construí la versión correcta, no el error)
- **Anti-honeypot (riesgo humano real):** ICE emitió cientos de subpoenas a plataformas en 2026 y varias cumplieron. No basta con no guardar el documento: **minimizá todo** (login sin teléfono, geo aproximada, IP/logs con TTL corto, mensajería E2E, verificación fuera de la DB). El dato que no existe no es subpoenable.
- **Copy legalmente seguro:** nunca "Verificado/de confianza/seguro" a secas — eso crea deber de cuidado (Roommates.com, negligent misrepresentation, saca §230). Usá descriptor literal + disclaimer ("licencia activa según el registro DOJ al [fecha]; esto NO garantiza conducta; nunca envíes dinero por adelantado"). Seguro E&O presupuestado.
- **Moat en R1, no en Fase 2:** el Escudo determinístico + verificador entran con el wedge, o competimos con Zillow sin diferenciador.
- **Retención propia:** contacto protegido dentro de la app; no diseñar para que el cierre ocurra en WhatsApp.
- **Números honestos:** 15 negocios = 8% del opex, no break-even. Ingreso **no atado al listado** (presencia verificada / pay-per-lead), o el churn del inmueble resuelto destruye el LTV.
- **Marca:** specimen de **uso genuino**, no una transacción manufacturada (= sham use → fraude USPTO).
- **El informe 09 está SUPERADO por §3 del plan:** describe el Escudo como "IA que intercepta el fraude antes" (tóxico). Construí §3 (determinístico), no el 09.
- **Verificación de identidad FUERA de la DB** (Stripe Identity → flag booleano). Nada de KYC replicado en Postgres.
- **Seed solo legal** (MLS/IDX licenciado, APIs oficiales, opt-in). Cero scraping+republicación.
- Construir por **rebanadas verticales**, no por capas horizontales (§14.1).

## Estado de configuración (2026-07-06) — construí con lo que hay (§5.6)
- **Puesto:** Supabase (env vars) ✅ · OpenAI ✅.
- **Falta hoy (degradar con elegancia, NO romper — §5.6):** Stripe → `<ProximamentePremium feature="pagos" />` (cartel premium "próximamente") · Resend → emails se saltan/encolan · Google Vision → imágenes a cola de moderación manual, **nunca publicar sin moderar** · Sentry → no inicializa, app corre igual · Vercel → dominios manuales (no hay dominios reales aún).
- **Regla:** ningún servicio faltante muestra un error técnico crudo; siempre el estado premium del §5.6.
- **✅ MCP de Supabase OK (verificado 2026-07-06):** conectado con token válido; ve la org **INSIGHTS** (`thmokrmynbamoukloork`) y el proyecto **"Comunidad latina"** (`ktmbtpuhqqofdkisqseq`, ACTIVE_HEALTHY, Postgres 17, us-west-2). El proyecto está **vacío (greenfield, 0 tablas)** — listo para que el enjambre construya las migraciones desde cero. (El server no está scopeado a un solo proyecto, pero la org solo contiene este, así que no hay riesgo de tocar otro.)

## Decisiones de Geovanny (§16 — corren en paralelo, no bloquean R0/R1 salvo la #4)
1. Marca: ¿Sección 8 o abandono? (TSDR, urgente). 2. Precios: calibrar con entrevistas; mientras, usar §18. 3. Capital ~$235k: confirmar antes de escalar gasto. **4. Ingeniero senior de seguridad: BLOQUEA el 1er dato real.** (Resto en §16.)

## Modelo y razonamiento
```
🤖 MODELO: Fable 5 en ultracode (orquestación del enjambre) · Opus en los gates
   RAZONAMIENTO: Máx en RLS, webhooks de pago, arquitectura anti-honeypot y
   decisiones de seguridad (código en producción con datos de población vulnerable);
   Sonnet/Medio para implementación mecánica.
   Revisión humana senior OBLIGATORIA en seguridad multi-tenant y en dinero.
```

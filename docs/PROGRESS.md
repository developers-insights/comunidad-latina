# PROGRESS — Plan Maestro Comunidad Latina

**Última actualización:** 2026-07-06.
**Estado:** ✅ **PLAN MAESTRO V4 COMPLETO — orientada a construcción.** Listo para la sesión de Fable 5.

## Objetivo (intacto)
Construir el **PRODUCTO COMPLETO** — red social white-label multi-tenant (PWA) para la diáspora latina; Geovanny opera y monetiza el comercio local. **Decisión del cliente (2026-07-06): construir ya, completo, con Fable 5 orquestando agentes** (no MVP recortado, no validar-antes-de-construir). Fuente/guía: https://geovanny-estudio.onrender.com/

## Qué es la V4 (en una línea)
Mismo objetivo que siempre (producto completo multi-tenant), reorientada de "ruta validada con gates que bloquean" a **"construir el producto completo por rebanadas verticales (R0→R5), con la validación de mercado corriendo en paralelo (Geovanny) sin frenar el código"**, y con las correcciones del **segundo pase adversarial** integradas en la arquitectura, la economía y el copy.

## Cadena de tareas
- [✅] A — 7 informes técnicos + A2 — 5 power-ups + diseño (13).
- [✅] V1 (técnica) → `docs/versiones/PLAN_MAESTRO_v1.md`.
- [✅] V2 (integrada) → `docs/versiones/PLAN_MAESTRO_v2.md`.
- [✅] 1er abogado del diablo (sobre V2) → `docs/investigacion/VEREDICTO-abogado-del-diablo.md`.
- [✅] V3 (ruta validada) → `docs/versiones/PLAN_MAESTRO_v3.md`.
- [✅] **2º abogado del diablo (sobre V3, 4 fiscales + web 2026)** → `docs/investigacion/VEREDICTO-V3-segundo-pase.md`.
- [✅] **V4 (orientada a construcción)** → `docs/PLAN_MAESTRO.md` (18 secciones).
- [✅] `.env.example` + `docs/SETUP-ENV.md` (variables por prioridad).
- [▶️ SIGUIENTE] **Construcción con Fable 5 (ultracode)** — arrancar por R0 (cimientos) → R1 (wedge con moat). Ver `docs/HANDOFF.md`.

## Correcciones que la V4 aplicó sobre la V3 (del 2º veredicto)
1. **Números honestos:** 15 negocios pagando = **8% del opex**, no break-even; real ~160 cuentas / ~$8k MRR/dominio (§6.2). Ingreso **no atado al listado** para vencer el churn estructural (§7).
2. **Moat desde la 1ª rebanada:** Escudo Anti-Estafa determinístico + verificador notario/abogado entran en R1 — el wedge no sale desnudo contra Zillow (§3, §13).
3. **Arquitectura anti-honeypot (minimización agresiva de datos):** login sin teléfono, geo aproximada, TTL corto, mensajería E2E, verificación fuera de la DB (§5.4). El riesgo ICE no se "resuelve" borrando el documento; se mitiga guardando lo mínimo.
4. **Copy legalmente seguro:** nunca "verificado/de confianza" (deber de cuidado, Roommates.com, negligent misrepresentation); descriptor literal + disclaimer + seguro E&O (§11.2).
5. **Marca con uso genuino,** no specimen manufacturado (= sham use → cancelación por fraude, §11.1).
6. **Senior humano = límite de velocidad** dimensionado; su firma bloquea el 1er dato real (§14.4).
7. **09 superado por §3:** el informe 09 aún describe el Escudo "que promete" (tóxico); el enjambre construye §3.
8. **Validación en paralelo,** no bloqueante (§10).

## Archivos clave
- `docs/PLAN_MAESTRO.md` — **V4, el norte.**
- `docs/HANDOFF.md` — arranque de la construcción (Fable 5).
- `docs/investigacion/VEREDICTO-V3-segundo-pase.md` — por qué la V4 corrige lo que corrige.
- `.env.example` + `docs/SETUP-ENV.md` — variables (Supabase desbloquea el arranque).

## Reanudar
Leer `docs/PLAN_MAESTRO.md` (V4) + `docs/HANDOFF.md`. La construcción arranca por **R0** (motor multi-tenant + auth + anti-honeypot + PWA + diseño) → **R1** (wedge con moat). NO cambiar el objetivo. Decisiones de Geovanny en §16 (solo el senior de seguridad bloquea el 1er dato real; el resto corre en paralelo). Datos de ejemplo para destrabar: §18.

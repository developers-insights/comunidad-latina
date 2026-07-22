# HANDOFF — Comunidad Latina (diagnóstico pre-producción)

**Fecha:** 2026-07-22. Este documento reemplaza al handoff del 2026-07-07 (quedaba
desactualizado — no reflejaba nada de lo construido después de R3). Producido por
una auditoría de **5 agentes en paralelo** (arquitectura/features, plan del
cliente vs. código, seguridad, deploy/infra, deuda técnica) más verificación en
vivo contra Supabase real y contra la prod desplegada. Nada de lo que sigue vive
solo en el chat: todo lo verificado quedó escrito acá.

## Leé primero (en este orden)
1. **Este archivo** — diagnóstico y plan de ejecución.
2. `docs/PROGRESS.md` — historial completo de qué se construyó, sesión por sesión.
3. `docs/PLAN_MAESTRO.md` (V4) — el norte original del producto.
4. `docs/ARQUITECTURA.md` — contrato técnico vigente (respetarlo en código nuevo).

## Dónde estamos (una línea)
**R0–R3 + Blindaje + Marketplace/Creadores + Feed red-social v2 construidos y
verdes (930 tests, tsc 0, lint 0).** ~65 rutas. Todo en modo demo: sin pagos
reales, sin pentest, sin dominio propio. El plan de 12 semanas del cliente
arrancó 2026-07-06; por calendario deberíamos estar cursando semana 3, y el
contenido de esa semana (legal + consentimiento) está atrasado.

## Semáforo contra el plan de 12 semanas de Geovanny (RDX, en `C:\MisProyectos\INSIGHTS\comunidad-latina-plan-cliente\`)

| Semana | Tema | Estado real (verificado en código, no en docs) |
|---|---|---|
| 2 (13–19/7) | Bloqueo, sanciones, reporte simple | ✅ Hecho, a tiempo (17/7) |
| 3 (20–26/7, **estamos acá**) | Términos/Privacidad/Normas, edad mínima al registro, borrado de cuenta | 🔴 **Atrasado**: no existen páginas de Términos/Privacidad/Normas (`Glob` de `legal/`, `terminos*` → nada). El form de registro (`src/app/(auth)/registro/registro-client.tsx`) no tiene checkbox de edad/aceptación de reglas. **Sí existe** y está bien construido el borrado de cuenta (`src/components/auth/delete-account.tsx`, doble confirmación) — no hace falta tocarlo. |
| 4 (27/7–2/8) | Moderación automática de fotos, emails reales, recuperación de contraseña | 🔴 Bloqueado por credenciales (Vision y Resend vacías en `.env.local`) **y** recuperación de contraseña **no está implementada** (ni ruta ni llamado a `resetPasswordForEmail` en todo `src/` — solo existe el string de copy "¿Te olvidaste la contraseña?" sin acción detrás). |
| **5 (3–9/8)** | **Auditoría de seguridad formal → Aceptación Hito 1** | 🔴 No hecha. Es el gate más crítico y el más atrasado: pentest humano + firma de ingeniero senior, documentado como bloqueante no negociable desde `PLAN_MAESTRO.md` y nunca ejecutado. |
| 6–9 (Hito 2: pagos reales, negocios reales) | Stripe real, verificación identidad real, dominio propio, contenido real, primeros negocios de Queens | Todo en modo demo hoy; depende 100% de cerrar Hito 1 primero. |
| 10–12 (Hito 3: lanzamiento) | Piloto Queens, apertura pública, entrega + marca USPTO oct-2026 | Contingente a los dos hitos anteriores. Cualquier atraso en Hito 1/2 pone en riesgo la ventana de uso genuino de marca antes de octubre. |

## 🔴 Gates humanos — nada de esto lo puede resolver un agente

1. **Pentest + firma de ingeniero senior** sobre migraciones y el webhook de Stripe. Bloqueante no negociable antes de cualquier dato real (ya documentado en `PLAN_MAESTRO.md`, nunca ejecutado).
2. **Confirmar y consolidar el team/dominio real de Vercel.** Hay evidencia de al menos 4 teams distintos habiendo tocado el proyecto (`manuels-projects-66819a23` → `manuelinsights` → `insights-apps` → `insights3`, dominio `comunidad-latina-sigma.vercel.app`). El repo `developers-insights/comunidad-latina` está **confirmado público hoy** (`gh repo view`, 2026-07-22) y trackea `main` correctamente. Pero **ningún archivo del repo confirma cuál dominio/team es el auto-deploy real vigente** — eso solo vivía en memoria de sesión hasta hoy. Acción: Manuel entra al dashboard de Vercel, confirma cuál proyecto recibe el push de `developers-insights/comunidad-latina`, y esa verdad se escribe acá (reemplazando esta misma sección) en la próxima sesión.
3. Aplicar en el Dashboard de Supabase (SQL Editor, porque `storage.objects` lo posee `supabase_storage_admin` y ni el rol `postgres` ni el MCP pueden tocarlo): el script `supabase/manual/harden-storage-listing.sql` **ampliado** para cubrir el bucket `post-media` (hallazgo nuevo de esta auditoría — el mismo bug de "listado público enumera user_ids" que el script ya resolvía para `avatars`/`listing-photos`/`tenant-assets` reapareció en `post-media`, creado después por la migración `0025`).
4. Activar **Leaked Password Protection** (Supabase Dashboard → Auth → Providers → Password, 1 toggle).
5. Conseguir credenciales reales cuando corresponda por plan: Resend + Google Vision (semana 4), Stripe test→real + Sentry (semana 6, exigido por el propio plan maestro antes de producción).
6. Decidir alcance: si "Tiendas verificadas con Stripe" (pagos peer-to-peer con Stripe **Connect**) entra en este ciclo — hoy no existe ni una línea de código de Connect, es una feature de pagos nueva de punta a punta, no un ajuste.

## Workstreams para agentes — paralelizables, ninguno espera al pentest para *empezar*

**A. Legal y consentimiento (semana 3, el más atrasado — prioridad 1)**
- Páginas Términos de Uso, Política de Privacidad, Normas de la Comunidad (contenido + rutas `(marketing)`).
- Checkbox de edad mínima (18+) + aceptación de términos en `register-form`/`registro-client.tsx`, persistido en `profiles_private` o similar.
- Flujo de recuperación de contraseña (`resetPasswordForEmail` de Supabase Auth + página de reset) — hoy no existe, es requisito explícito de semana 4.

**B. Hardening de seguridad ejecutable hoy (antes del pentest, para llegar con menos findings)**
- Ampliar `supabase/manual/harden-storage-listing.sql` con la policy de `post-media` (el agente arma el SQL; Manuel lo corre en Dashboard — ver gate humano #3).
- Promover la CSP de `Report-Only` a enforcing (`next.config`/headers) — verificar que no rompe ningún flujo antes de mergear.
- Test coverage del webhook de Stripe (`src/app/api/webhooks/stripe/route.ts`): firma inválida, replay/idempotencia, correlación de monto/session — hoy cero tests.
- `npm audit fix` para `fast-uri` (high, sin breaking change).
- Arreglar el TLS de `npm run check:rls` (descargar CA de Supabase, setear `SUPABASE_DB_CA_CERT_PATH`) — hoy el gate de RLS está ciego localmente (falla por cert, no por RLS).
- Sondeo en vivo con la anon key contra las RPCs `admin_suspend_user`/`admin_ban_user`/`admin_reactivate_user`/etc. para confirmar que un JWT no-staff no puede invocarlas (hoy es solo lectura de código, no probado en vivo).
- Trackear `.env.example` en git (`.gitignore` con `.env*` lo excluye sin querer — usar `!.env.example` o `git add -f`).

**C. Bug fix mecánico**
- React #418 en `/admin/moderacion`: `moderation-item.tsx` y `scam-report-item.tsx` reimplementan su propio `formatWhen()` con `Intl.DateTimeFormat` sin `timeZone` (difiere server/browser). Ya existe `formatDate()`/`timeAgo()` en `src/lib/utils.ts` diseñado justamente para evitar este drift — solo hay que usarlo ahí en vez de reimplementar.

**D. Limpieza chica**
- `BrandMark` (`src/components/experience/brand-mark.tsx`) sigue sin usarse en ningún lado — decidir: darle un hogar o borrarlo.
- Hay un cambio sin commitear y ya terminado en `src/components/creators/copy.ts` + `creator-profile-form.tsx` (pegar varias habilidades separadas por coma) — solo falta commitear.

## Hallazgos nuevos de esta auditoría (no estaban documentados antes)
- El bucket `post-media` (creado en `0025`) tiene el mismo agujero de listado público que el SQL manual ya resolvía para los buckets viejos — se coló porque la migración es posterior al fix.
- La CSP en producción está en `Report-Only`, no bloqueando — verificado con `curl` contra la prod real.
- El webhook de Stripe tiene cero tests (la lógica en sí es sólida: firma sobre body crudo, idempotencia por `event_id` único, correlación de monto/session).
- `npm audit`: 3 high + 1 moderate. Solo `fast-uri` es fixable sin drama; `postcss`/`sharp` vienen empaquetados dentro de `next` mismo, esperar parche de Next.
- El repo es público hoy (confirmado con `gh repo view`), pero ningún archivo lo documentaba — solo el commit message `50c76ea`.
- No existe ninguna línea de Stripe **Connect** — la distinción futura "Marketplace Comunidad" (sin Stripe) vs. "Tiendas verificadas con Stripe" (vendedor cobra directo) es una feature de pagos completa por construir, no un flag.
- Recuperación de contraseña: no implementada (solo un string de copy suelto).

## Gotchas que siguen vigentes (del handoff anterior)
- Migraciones: **forward-only**, nunca editar una aplicada. Toda tabla nueva con `tenant_id` necesita RLS FORCE + 4 policies o el gate `check:rls` rompe.
- Build usa `--webpack` (Serwist no soporta Turbopack build en Next 16 todavía). No quitar el flag.
- Componentes nuevos usan `m.` de `motion/react`, nunca `motion.*` (LazyMotion strict rompe el render si no).
- Copy legal: nunca "Verificado" a secas ni promesas de seguridad — descriptor literal + fecha + disclaimer.
- El admin client (`lib/supabase/admin`) solo en: signup, webhooks, notify helper, paneles admin gateados por `app_metadata.role` + audit_log.
- 26 migraciones aplicadas (`0001`–`0026`). `supabase/manual/` tiene un script fuera de la cadena normal (ver gate humano #3).

## Modelo y razonamiento sugeridos

```
🤖 MODELO: Sonnet para A/C/D (legal, copy, fix mecánico, limpieza) ·
   Opus para B (hardening de seguridad, tests del webhook de dinero real, RLS)
   RAZONAMIENTO: Alto en todo lo de seguridad/RLS/webhook · Medio en legal/copy/fix mecánico
```

**Regla de oro:** todo lo que necesita la próxima sesión está en el repo
(`docs/` + código + migraciones). Nada vive solo en el chat.

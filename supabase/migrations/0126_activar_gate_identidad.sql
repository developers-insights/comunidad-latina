-- =============================================================================
-- 0126_activar_gate_identidad.sql — Comunidad Latina
--
-- ✅ SE APLICA. Decisión cerrada del dueño del producto, 2026-08-31: "para
-- vender dentro de la plataforma, tenés que estar verificado sí o sí" —
-- asumiendo el bloqueo que eso implica hoy. No es una condición que se haya
-- terminado de cumplir (ver el detalle más abajo): es una decisión de negocio
-- que pesa MÁS que la condición 1. Este archivo reemplaza a
-- `supabase/migraciones-en-espera/0109_activar_gate_identidad.sql` (que
-- esperaba desde el 2026-08-24) — mismo contenido, header reescrito.
--
-- ⚠️ RENUMERADA de 0124 a 0126: el brief de esta tarea pedía el prefijo 0124,
-- pero al momento de escribir este archivo `supabase/migrations/` ya tenía
-- `0124_me_gusta_en_avisos.sql` Y `0125_emojis_de_la_comunidad.sql` — dos
-- migraciones de otros agentes en curso en el mismo merge, sin commitear
-- todavía. Verificado contra el directorio real, no contra el número que
-- decía el brief. Ver "Puntos de integración pendientes" en el reporte de
-- esta tarea: esos dos archivos podrían volver a moverse antes del commit
-- final, y esta migración tendría que renumerarse con ellos si eso pasa.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ HACE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Enchufa a `listings_insert` el gate que la spec pide: publicar un alquiler,
-- un artículo del marketplace, un empleo o un evento PAGO exige tener la
-- identidad verificada. Las funciones que lo implementan
-- (`app.identidad_verificada`, `app.vertical_exige_identidad`,
-- `public.puedo_publicar_vertical`) ya existen desde la 0106 — lo único que
-- falta es la condición en la policy, y es lo único que hace este archivo.
--
-- ── ACTUALIZADO POR LA 0121 (2026-08-26) ────────────────────────────────────
-- La rama B ya no pregunta por la PERSONA sino por la IDENTIDAD ACTIVA
-- (`app.identidad_verificada_activa()`), que es lo mismo mientras nadie use el
-- cambiador de perfil y la verificación del negocio cuando sí. Es la doctrina
-- de la 0116/0117 —«todo lo que emitís lleva la cara activa»— y el pedido del
-- cliente de 2026-08-26: «según cada perfil». La UI pregunta por la MISMA
-- función desde `public.puedo_publicar_vertical()`, que la 0121 ya cambió: si
-- este archivo hubiera quedado con el predicado viejo, la pantalla y la policy
-- habrían dicho cosas distintas — que es exactamente lo que la 0106 se propuso
-- evitar cuando sacó la lista de verticales a una función.
--
-- La 0106 las creó por separado a propósito: la UI necesita poder hacer la
-- misma pregunta ANTES de que la persona llene el formulario entero. Eso ya
-- funciona hoy sin este archivo.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LAS TRES CONDICIONES QUE PEDÍA LA 0109 — ESTADO REAL AL 2026-08-31
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se documentan tal cual están, no se maquillan: la decisión del dueño del
-- producto es aplicar el gate IGUAL, con los ojos abiertos sobre lo que falta.
--
-- 1. STRIPE_SECRET_KEY cargada en producción y `/perfil/verificar` probado de
--    punta a punta con una identidad real.
--    ⚠️ PARCIAL / NO VERIFICADO EN VIVO POR ESTE AGENTE. En `.env.local` del
--    worktree hay una clave con forma real (`sk_...`); la memoria de sesiones
--    previas registra "Stripe YA cargado" en producción el 2026-08-26. Pero
--    este agente NO pudo confirmar el valor en Vercel (el worktree no está
--    linkeado: `vercel env ls production` pide `vercel link`) ni corrió el
--    flujo de `/perfil/verificar` con una identidad real. Y hay un riesgo
--    concreto encontrado leyendo el código: `src/app/(app)/perfil/verificar/page.tsx`
--    sólo muestra el botón de verificar cuando `isStripeConfigured` es true;
--    si la clave faltara en producción, la pantalla a la que este gate manda
--    a la gente muestra "Muy pronto" — un candado sin llave, tal cual describía
--    el encabezado original de la 0109. CONFIRMAR ESTO ANTES de aplicar.
--
-- 2. Las server actions que publican traducen el rechazo a copy de producto.
--    ✅ /publicar (property, job, event pago) — hecho en esta tarea:
--       `requireIdentidadVerificada()` en src/app/(app)/publicar/actions.ts.
--    ✅ /marketplace/publicar (product) — ya estaba (verificado leyendo el
--       código, no sólo grepeado): lee `profiles.identity_verified` directo,
--       misma superficie funcional, otro camino.
--    ❌ /empleos/publicar (job, el otro camino para publicar un empleo además
--       de /publicar?kind=job) — SIGUE SIN GATE. Confirmado con
--       `grep -rn requireIdentidadVerificada src/app/\(app\)/empleos/`: cero
--       resultados. Fuera del alcance de esta tarea (archivos de otro agente).
--       Con el gate de la BASE ya activo (este archivo), publicar un empleo
--       desde /empleos/publicar sin identidad verificada va a fallar con un
--       42501 crudo de PostgREST hasta que se cablee ahí también.
--
-- 3. Las cuentas que hoy publican están verificadas, o se les avisó.
--    Números reportados por quien encargó esta tarea, minutos antes de
--    escribir este archivo: 20 perfiles totales, 1 verificado · 73 listings ·
--    4 empleos. Este agente NO pudo re-correr la consulta de abajo en vivo
--    (el MCP de Supabase de este proyecto devolvió "Connection terminated due
--    to connection timeout" en tres intentos separados) — así que estos
--    números NO están re-verificados por este agente, y en cualquier caso van
--    a estar desactualizados para cuando esto se aplique de verdad. CORRER DE
--    NUEVO antes de aplicar:
--
--        select count(*) filter (where identity_verified) as verificados,
--               count(*) as total
--          from public.profiles;
--
--        select l.kind, p.display_name, p.identity_verified
--          from public.listings l
--          join public.profiles p on p.id = l.created_by
--         where l.kind in ('property','product','job','event')
--           and l.status = 'published'
--         group by 1,2,3;
--
-- Lo que YA está publicado no se toca en ningún caso: el gate rige sólo para
-- INSERT y `listings_update` no se modifica. El detalle completo de esa
-- decisión está en la sección B del encabezado de la 0106.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CÓMO VOLVER ATRÁS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Re-aplicar la sección C de la 0106 (la misma policy sin la rama B). No hay
-- datos que migrar ni nada que limpiar: esto es un predicado, no un cambio de
-- forma.
-- =============================================================================

begin;

drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings
for insert to authenticated
with check (
  -- ── Base intacta (0050) ──────────────────────────────────────────────────
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and source = 'user'
  and status in ('draft', 'pending_review')
  and publisher_name is null
  and publisher_kind is null
  and published_at is null
  and comment_count = 0
  and view_count = 0
  and store_verified = false
  and tier = 'free'
  and store_active = true

  -- ── B · Gate de identidad (0126, ex-0109) ────────────────────────────────
  -- La lista de verticales vive en `app.vertical_exige_identidad()`, que es lo
  -- que también consulta la UI: una sola fuente, para que el formulario avise
  -- antes en vez de reventar al final.
  and (
    not app.vertical_exige_identidad(kind, price_amount)
    -- 0121: la cara activa, no la persona. Misma función que consulta la UI.
    or app.identidad_verificada_activa()
  )

  -- ── C · Una sola ficha de negocio (0106) ─────────────────────────────────
  -- Corta el INSERT ciego de /publicar?kind=business en el acto. El `or` de
  -- adelante hace que la subconsulta ni se evalúe para las otras verticales.
  -- 0121: la MISMA llamada, con la regla cambiada por dentro — «ya agotó sus
  -- fichas» pasó de significar "tiene una" a "tiene tantas como cuentas de
  -- negocio, con piso en uno". El texto de esta policy no cambió a propósito,
  -- para que este archivo y la 0121 se puedan aplicar en cualquier orden.
  and (
    kind <> 'business'
    or not app.ya_tiene_ficha_de_negocio(
      (select app.current_tenant_id()),
      (select auth.uid())
    )
  )
);

comment on policy listings_insert on public.listings is
  'Base de 0050 (0048 ← 0039 ← 0038 ← 0004) SIN cambios, más dos gates: (1) no más fichas kind=business vivas que cuentas de negocio, con piso en una (0106 + 0121); (2) identidad de la CARA ACTIVA verificada para property/product/job y event pago —app.vertical_exige_identidad() + app.identidad_verificada_activa(), 0126 (ex-0109) con la corrección de la 0121—, que rige SÓLO al crear: listings_update no se tocó, así que nadie pierde acceso a lo que ya publicó, y como el dueño no puede escribir published por UPDATE (0075), INSERT es la única bisagra que tiene.';

commit;

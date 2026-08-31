-- =============================================================================
-- 0109_activar_gate_identidad.sql — Comunidad Latina
--
-- ⚠️ ESTA MIGRACIÓN NO SE APLICA TODAVÍA. Está escrita y lista; falta que se
-- cumpla la condición de abajo. Aplicarla antes de tiempo deja la app sin
-- forma de publicar.
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
-- POR QUÉ SE SEPARÓ: HOY SERÍA UN CANDADO SIN LLAVE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido contra la base de producción el 2026-08-24, antes de aplicar nada:
--
--     select count(*) filter (where identity_verified) as verificados,
--            count(*) as total
--       from public.profiles;
--     →  verificados = 0   ·   total = 20
--
-- CERO de veinte. Y la verificación de identidad se hace con Stripe Identity,
-- que necesita `STRIPE_SECRET_KEY` — variable que está VACÍA tanto en
-- `.env.local` como en producción (ver `docs/STRIPE.md`).
--
-- O sea que enchufar el gate hoy produce esto, en este orden:
--
--   1. Nadie puede publicar un alquiler, un artículo, un empleo ni un evento
--      pago. Ni el cliente, ni el equipo, ni una sola de las veinte cuentas.
--   2. El rechazo llega como un `42501` crudo de PostgREST, porque el helper
--      `requireIdentidadVerificada()` todavía no está cableado en las server
--      actions: la persona ve un error técnico, no "verificá tu identidad".
--   3. Y aunque lo entendiera, NO PODRÍA verificarse: el flujo de identidad
--      depende de la misma clave de Stripe que falta.
--
-- Un gate correcto en el papel y una app que no deja publicar nada, sin salida.
-- La regla de la spec no está en discusión — lo que estaba mal era el momento.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CUÁNDO APLICARLA — LAS TRES CONDICIONES, LAS TRES JUNTAS
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. `STRIPE_SECRET_KEY` cargada en producción y el flujo de
--      `/perfil/verificar` probado de punta a punta con una identidad real.
--      Sin esto, la llave del candado no existe.
--      SIGUE SIN CUMPLIRSE al 2026-08-26: la clave sigue vacía y la base sigue
--      teniendo 0 identidades verificadas sobre 20 perfiles (medido ese día).
--      Y desde la 0121 la llave abre DOS puertas, no una: sin documento
--      validado tampoco se puede reclamar la verificación de un negocio.
--
--   2. Las server actions que publican traducen el rechazo a copy de producto.
--      El helper ya está: `requireIdentidadVerificada()` en
--      `src/lib/verificacion/gate.ts`. Falta llamarlo desde
--      `src/app/(app)/publicar/actions.ts`, `empleos/publicar/actions.ts` y
--      `marketplace/publicar/actions.ts`, y que el formulario avise ANTES —no
--      al final— con un camino a `/perfil/verificar`.
--      SIGUE SIN CUMPLIRSE al 2026-08-26: `grep -rn requireIdentidadVerificada
--      src/` devuelve sólo su definición y su test. Lo que SÍ cambió es que
--      `/perfil/verificar` ya tiene a dónde llevar a cada perfil (la lista de
--      "Tus perfiles" de la 0121), o sea que el camino de salida existe.
--
--   3. Las cuentas que hoy publican están verificadas, o se les avisó. Mirá
--      quiénes son antes de cerrarles la puerta:
--
--          select l.kind, p.display_name, p.identity_verified
--            from public.listings l
--            join public.profiles p on p.id = l.created_by
--           where l.kind in ('property','product','job','event')
--             and l.status = 'published'
--           group by 1,2,3;
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

  -- ── B · Gate de identidad (0109) ────────────────────────────────
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
  'Base de 0050 (0048 ← 0039 ← 0038 ← 0004) SIN cambios, más dos gates: (1) no más fichas kind=business vivas que cuentas de negocio, con piso en una (0106 + 0121); (2) identidad de la CARA ACTIVA verificada para property/product/job y event pago —app.vertical_exige_identidad() + app.identidad_verificada_activa(), 0109 con la corrección de la 0121—, que rige SÓLO al crear: listings_update no se tocó, así que nadie pierde acceso a lo que ya publicó, y como el dueño no puede escribir published por UPDATE (0075), INSERT es la única bisagra que tiene.';

commit;

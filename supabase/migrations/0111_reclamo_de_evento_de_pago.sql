-- =============================================================================
-- 0111_reclamo_de_evento_de_pago.sql — Comunidad Latina
--
-- Una columna: `payment_events.claimed_at`. Cierra la última ventana de carrera
-- de la idempotencia del webhook de Stripe, encontrada en la auditoría del
-- 2026-08-24.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL AGUJERO, QUE ESTÁ EN UN LUGAR MUY PRECISO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El INSERT en `payment_events` YA es el punto de serialización correcto:
-- `(provider, event_id)` es UNIQUE, así que ante dos entregas simultáneas del
-- mismo evento exactamente una gana y la otra recibe `23505`. Eso está bien.
--
-- El problema es qué hace la que pierde. Hoy relee la fila y razona así:
--
--     processed = true   → ya se procesó, respondo "duplicado"
--     processed = false  → el intento anterior murió a mitad, sigo yo
--
-- Y `processed = false` es **también** el estado mientras la ganadora todavía
-- está trabajando. O sea que la rama pensada para "el intento anterior murió"
-- se dispara igual cuando el intento anterior está vivo y a mitad de camino.
-- Las dos procesan el mismo evento a la vez.
--
-- ── QUÉ TAN GRAVE ES, SIN EXAGERARLO ────────────────────────────────────────
-- No se cobra ni se acredita dos veces: las transiciones de plata ya llevan el
-- predicado de estado en el `WHERE` del UPDATE (boosts, promotions, identity, y
-- las tres suscripciones desde `lib/monetization/concesion.ts`), así que la
-- segunda ejecución no toca ninguna fila. Lo que sí se duplica es lo que cuelga
-- de esas transiciones y no está gateado: el comprobante que se le manda a la
-- persona y la fila de auditoría. Molesto y confuso, no destructivo.
--
-- Se arregla igual, y ahora, porque es plata: una defensa que depende de que
-- cada handler futuro se acuerde de poner el predicado es una defensa que se
-- pierde el día que alguien agregue el octavo producto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ UNA COLUMNA Y NO ALGO MÁS INGENIOSO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se evaluaron dos alternativas sin schema:
--
--   · Un `UPDATE ... WHERE processed is not true RETURNING` en vez del SELECT.
--     No alcanza. El UPDATE toma un lock de fila, sí, pero cada statement de
--     PostgREST viene en su propia transacción y la suelta en el acto: la
--     segunda espera, entra, y `processed` sigue en false porque la ganadora
--     recién lo pone en true al terminar. Vuelve a pasar exactamente lo mismo.
--
--   · `pg_advisory_xact_lock`. Correcto en teoría e inalcanzable en la
--     práctica: el lock dura lo que dura la transacción, y acá el procesamiento
--     son varias llamadas separadas por PostgREST.
--
-- Con `claimed_at` el reclamo es atómico y observable: un solo UPDATE
-- condicional decide quién procesa, y quien no se lo lleva responde 200 sin
-- tocar nada.
--
-- ── LA VENTANA DE 5 MINUTOS NO ES ARBITRARIA ────────────────────────────────
-- Un reclamo sin vencimiento convierte un proceso que murió a mitad en un
-- evento que NADIE va a procesar nunca — cambiaríamos un duplicado por una
-- pérdida, que es peor cuando hay plata. Con la ventana, un reclamo huérfano se
-- puede volver a tomar. Cinco minutos es holgado contra el techo de 300 s de
-- las funciones de Vercel: si el proceso sigue vivo, ya se pasó del tiempo que
-- la plataforma le da.
-- =============================================================================

begin;

alter table public.payment_events
  add column if not exists claimed_at timestamptz;

comment on column public.payment_events.claimed_at is
  'Cuándo un proceso se adjudicó este evento para procesarlo. NULL = libre. El webhook lo reclama con un UPDATE condicional (claimed_at is null o más viejo que 5 minutos) y sólo procesa si ese UPDATE devolvió fila: sin esto, dos entregas simultáneas del mismo event_id veían las dos processed=false —que es también el estado MIENTRAS la primera trabaja— y procesaban las dos, duplicando comprobantes y auditoría. La ventana de 5 min existe para que un proceso que murió a mitad no deje el evento reclamado para siempre.';

-- El índice de reclamos vencidos: la consulta de reconciliación ("qué eventos
-- quedaron tomados y nunca terminaron") tiene que poder encontrarlos sin barrer
-- la tabla, que crece con cada webhook de cada comunidad.
create index if not exists payment_events_reclamados_idx
  on public.payment_events (claimed_at)
  where processed = false and claimed_at is not null;

commit;

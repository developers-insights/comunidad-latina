-- ============================================================================
-- 0026 — El creador ACEPTA o RECHAZA la propuesta antes de que el negocio pague
-- ============================================================================
-- Feedback del cliente: un contrato PROPUESTO ahora tiene que ser ACEPTADO por
-- el creador antes de poder avanzar. El negocio ya NO deposita en garantía
-- directamente desde 'proposed': primero el creador acepta (o rechaza).
--
--   Nuevo ciclo feliz:  proposed → accepted → funded → delivered → released
--   Nueva salida:        proposed → rejected   (el creador rechaza; terminal)
--
-- Cambio SOLO de estado/UX. La garantía sigue en modo demostración
-- (payment_mode='demo'): no se toca Stripe ni ninguna columna de dinero.
-- Idempotente: se puede correr más de una vez sin romper.
-- ============================================================================

-- 1) Ampliar el CHECK de `status` para admitir 'accepted' y 'rejected'.
--    En 0024 el check es inline sobre la columna, así que Postgres lo nombró
--    gig_contracts_status_check (patrón <tabla>_<columna>_check). Lo bajamos y
--    lo recreamos con el conjunto ampliado. `drop ... if exists` lo hace seguro
--    de re-correr; todas las filas actuales ya caen dentro del conjunto nuevo.
alter table public.gig_contracts
  drop constraint if exists gig_contracts_status_check;

alter table public.gig_contracts
  add constraint gig_contracts_status_check
  check (status in (
    'proposed', 'accepted', 'funded', 'delivered', 'released',
    'canceled', 'disputed', 'rejected'
  ));

-- 2) Sellos de tiempo de las transiciones nuevas (paralelos a funded_at, etc.).
alter table public.gig_contracts
  add column if not exists accepted_at timestamptz;

alter table public.gig_contracts
  add column if not exists rejected_at timestamptz;

comment on column public.gig_contracts.accepted_at is
  'Momento en que el creador aceptó la propuesta (proposed → accepted). El negocio recién entonces puede depositar en garantía.';
comment on column public.gig_contracts.rejected_at is
  'Momento en que el creador rechazó la propuesta (proposed → rejected; estado terminal).';

-- Nota: el comentario de la tabla en 0024 describe el ciclo viejo
-- (proposed → funded). El ciclo vigente es proposed → accepted → funded →
-- delivered → released; lo dejamos documentado acá para no reescribir 0024.

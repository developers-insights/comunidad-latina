-- =============================================================================
-- 0123_higiene_de_la_tanda.sql — Comunidad Latina
--
-- Lo que los advisors de Supabase encontraron DESPUÉS de aplicar 0120-0122, y
-- que las tres migraciones dejaron pasar. Tres líneas, ningún cambio de
-- comportamiento: esto no agrega ni saca una sola regla del producto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A · `app.tope_de_negocios()` sin `search_path` fijo
-- ═══════════════════════════════════════════════════════════════════════════
--
--     [WARN] function_search_path_mutable
--     Function `app.tope_de_negocios` has a role mutable search_path
--
-- Es EXACTAMENTE el caso de la 0108, y su cabecera ya dejó escrito el
-- razonamiento entero — vale la pena releerla antes que repetirla acá. El
-- resumen: la tentación es silenciarlo porque el cuerpo es `select 10`, una
-- constante que no lee ninguna tabla, es `immutable` y no es `security
-- definer`. Y la respuesta es la misma que entonces: lo que la función no
-- tiene, lo tiene quien la llama. `app.business_accounts_enforce_cap()` es un
-- trigger que corre con los privilegios del dueño de la tabla y compara contra
-- el valor que esta función devuelve. Con `search_path` mutable, quien pueda
-- crear objetos en un esquema que quede antes en el suyo puede sombrear el
-- operador `>=` de esa comparación y hacer que el tope de 10 valga lo que él
-- quiera — que es, literalmente, desactivar el único lugar donde ese tope
-- existe de verdad.
--
-- Las demás funciones de la 0121 nacieron con `search_path=""`. A ésta se le
-- escapó por ser la más chica, que es como suelen escaparse.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- B · Dos claves foráneas sin índice de cobertura
-- ═══════════════════════════════════════════════════════════════════════════
--
--     [INFO] unindexed_foreign_keys
--       · business_verifications.identity_claimed_by_fkey   (0121)
--       · community_help_notices.reviewed_by_fkey           (0120)
--
-- Las dos apuntan a `profiles(id)` y las dos nombran a la PERSONA QUE DECIDIÓ:
-- quién reclamó la verificación de un negocio, quién aprobó o rechazó un aviso
-- de ayuda. Sin índice, Postgres tiene que escanear la tabla entera cada vez
-- que valida esa FK, y eso pasa en el peor momento posible: al borrar un
-- perfil. `deleteAccountAction` ya arrastra una lista larga de precondiciones
-- (ver `src/app/(app)/perfil/actions.ts`), y sumarle dos seq scans convierte
-- un borrado en una espera.
--
-- Son índices PARCIALES (`where … is not null`) a propósito: las dos columnas
-- son nulas en la enorme mayoría de las filas —un aviso todavía sin revisar, un
-- negocio nunca reclamado— y un índice que indexa millones de NULL ocupa disco
-- para responder una pregunta que nadie hace. El planner los usa igual para la
-- validación de la FK, que siempre busca por un id concreto.
--
-- Los otros siete `unused_index` que reportaron los advisors NO se tocan: son
-- los índices recién creados que todavía nadie consultó. "Sin usar" a los
-- veinte minutos de nacer significa "sin tráfico", no "sobra".
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A · El search_path del tope
-- ---------------------------------------------------------------------------

alter function app.tope_de_negocios() set search_path = '';

-- ---------------------------------------------------------------------------
-- B · Los dos índices de cobertura
-- ---------------------------------------------------------------------------

create index if not exists business_verifications_identity_claimed_by_idx
  on public.business_verifications (identity_claimed_by)
  where identity_claimed_by is not null;

comment on index public.business_verifications_identity_claimed_by_idx is
  'Cobertura de identity_claimed_by_fkey (0121). Parcial: la columna es nula mientras nadie reclamó la verificación del negocio, que es el estado normal. Lo que evita es el seq scan al borrar un perfil.';

create index if not exists community_help_notices_reviewed_by_idx
  on public.community_help_notices (reviewed_by)
  where reviewed_by is not null;

comment on index public.community_help_notices_reviewed_by_idx is
  'Cobertura de reviewed_by_fkey (0120). Parcial: nula mientras el aviso está en borrador o pendiente. Mismo motivo que su hermana de business_verifications — el costo aparecía al borrar la cuenta de un moderador.';

commit;

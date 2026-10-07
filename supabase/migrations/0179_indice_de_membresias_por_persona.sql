-- =============================================================================
-- 0179_indice_de_membresias_por_persona.sql — Comunidad Latina
--
-- `public.identidades_disponibles()` es el RPC autenticado más llamado de la app
-- (1990 llamadas en pg_stat_statements desde el 15/09: lo pide el selector de
-- identidad en cada carga). Filtra `business_members` por `profile_id` y
-- `status`, pero el tenant lo pone sobre `business_accounts`, no sobre la
-- membresía. Por eso ninguno de los índices existentes de `business_members`
-- servía para arrancar desde la persona:
--   · `business_members_profile_idx (tenant_id, profile_id, status)` empieza por
--     `tenant_id`, que la consulta no fija en esta tabla.
--   · `business_members_one_per_business (business_id, profile_id)` empieza por
--     el negocio.
-- El plan medido recorría TODAS las cuentas de negocio del tenant y probaba la
-- membresía de cada una: costo lineal en la cantidad de negocios de la
-- comunidad, para una pregunta cuya respuesta son 1–3 filas.
--
-- Con `(profile_id, status)` el planner arranca por las membresías activas de la
-- persona y entra a `business_accounts` por la PK. De paso cubre la FK
-- `business_members_profile_id_fkey`, que el advisor marcaba sin índice: un
-- borrado de perfil deja de recorrer la tabla entera.
--
-- `create index` común y no `concurrently`: la tabla tiene un puñado de filas y
-- `concurrently` no corre dentro de la transacción de una migración. Si alguna
-- vez se re-crea con la tabla grande, hacerlo a mano con `concurrently`.
-- =============================================================================

create index if not exists business_members_profile_status_idx
  on public.business_members (profile_id, status);

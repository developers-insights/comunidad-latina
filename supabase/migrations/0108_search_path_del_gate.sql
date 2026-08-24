-- =============================================================================
-- 0108_search_path_del_gate.sql — Comunidad Latina
--
-- Un solo `alter function`. Lo pidió el linter de Supabase justo después de
-- aplicar la 0106:
--
--     [WARN] function_search_path_mutable
--     Function `app.vertical_exige_identidad` has a role mutable search_path
--
-- ── POR QUÉ IMPORTA SI LA FUNCIÓN NO TOCA NINGUNA TABLA ─────────────────────
-- El cuerpo es una expresión pura:
--
--     select p_kind in ('property', 'product', 'job')
--         or (p_kind = 'event' and coalesce(p_price, 0) > 0);
--
-- No lee nada, no escribe nada, y encima es `immutable` y NO es `security
-- definer`. La tentación es decir "acá no hay superficie de ataque" y
-- silenciar el warning.
--
-- Pero lo que la función no tiene, lo tiene el lugar donde se la llama: es una
-- de las dos condiciones de `listings_insert` cuando se active el gate (0109),
-- y la invoca `public.puedo_publicar_vertical`, que SÍ es `security definer`.
-- Con `search_path` mutable, quien puede crear objetos en un esquema que quede
-- antes en su propio `search_path` puede sombrear los operadores que esta
-- expresión usa —`=`, `in`, `>`, `coalesce`— y hacer que devuelva lo que
-- quiera. Es un vector conocido de Postgres, y el precio de cerrarlo es una
-- línea.
--
-- Las otras seis funciones de la 0106 y la 0107 ya nacieron con
-- `search_path=""` (verificado en `pg_proc.proconfig`). A ésta se le escapó
-- por ser la única que no es `security definer` — justamente la que menos
-- parecía necesitarlo. Con este archivo, las siete quedan iguales: no hay una
-- excepción que alguien tenga que recordar.
--
-- No hace falta redefinir el cuerpo: `alter function ... set search_path`
-- cambia sólo la configuración y conserva permisos, comentario y firma.
-- =============================================================================

begin;

alter function app.vertical_exige_identidad(text, numeric) set search_path = '';

commit;

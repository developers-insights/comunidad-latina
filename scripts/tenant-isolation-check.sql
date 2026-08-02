-- Verificación de aislamiento entre tenants — se corre contra la base real.
--
-- Por qué SQL y no un .mjs: `npm run check:rls` no levanta en la máquina de
-- Manuel por el TLS roto. Esto se pega tal cual en el SQL Editor de Supabase o
-- se pasa por el MCP (`execute_sql`), que van por HTTPS y no dependen del
-- certificado local.
--
-- Es todo de lectura y cada bloque abre y revierte su propia transacción:
-- no escribe nada, no deja el rol cambiado.
--
-- ANTES DE CORRER: poné abajo los dos tenants que querés enfrentar.
--   \set tenant_propio  '...'   -- el del token que simulamos
--   \set tenant_ajeno   '...'   -- el que NO debería verse
-- Si no usás psql, reemplazá a mano las dos constantes del bloque 3.


-- ===========================================================================
-- 1. Toda tabla de `public` tiene que estar con RLS ENABLE **y** FORCE
-- ===========================================================================
-- FORCE es el que importa acá: sin él, el dueño de la tabla (y cualquier
-- función SECURITY DEFINER que corra como él) se saltea las policies.
-- Resultado esperado: 0 filas.

select c.relname as tabla_sin_blindar,
       c.relrowsecurity   as rls_habilitada,
       c.relforcerowsecurity as rls_forzada,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and (not c.relrowsecurity or not c.relforcerowsecurity)
order by c.relname;


-- ===========================================================================
-- 2. Policies que dejan pasar todo, y a quién
-- ===========================================================================
-- No todas son un bug: `profiles`, `tenant_domains` y los scores son públicos
-- a propósito. Sirve como inventario para que ninguna nueva se cuele sin que
-- alguien la haya decidido.

select p.tablename, p.policyname, p.cmd, p.roles::text as roles,
       case when 'anon' = any (p.roles::text[]) then 'SÍ' else 'no' end as alcanza_a_anon
from pg_policies p
where p.schemaname = 'public'
  and coalesce(p.qual, '') = 'true'
order by (case when 'anon' = any (p.roles::text[]) then 0 else 1 end), p.tablename;


-- ===========================================================================
-- 3. La prueba de verdad: ¿un miembro del tenant A ve filas del tenant B?
-- ===========================================================================
-- Recorre TODA tabla de `public` que tenga `tenant_id`, con el rol
-- `authenticated` y un JWT armado a mano, y cuenta cuántas filas de otro
-- tenant devuelve. `query_to_xml` deja contar tabla por tabla sin escribir a
-- mano un UNION de sesenta ramas, y respeta RLS porque corre con el rol puesto.
--
-- Resultado esperado: `filas_ajenas = 0` en todas las tablas privadas.
-- Las que hoy dan > 0 son las públicas por diseño SEO (listings, posts,
-- comments, listing_comments, guides, profiles, *_scores, creator_*): ese
-- contenido es `published` y se ve entre comunidades a propósito. Cualquier
-- OTRA tabla con filas ajenas es una regresión.

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"369cf151-6677-4b8f-895b-d3b0c565691a","role":"authenticated","app_metadata":{"tenant_id":"019f39cf-55e8-7bcc-a66a-2737ff672b16","role":"member"}}';

select c.table_name as tabla,
       (xpath('/row/c/text()',
              query_to_xml(
                format('select count(*) as c from public.%I where tenant_id = %L',
                       c.table_name,
                       '019f39cf-5115-70bf-8a9e-8db074bf07d6'),  -- tenant AJENO
                false, true, '')
       ))[1]::text::int as filas_ajenas
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.column_name  = 'tenant_id'
   and exists (select 1 from pg_class k join pg_namespace n on n.oid = k.relnamespace
                where n.nspname = 'public' and k.relname = c.table_name and k.relkind = 'r')
 order by 2 desc, 1;

rollback;


-- ===========================================================================
-- 4. Qué ve alguien sin cuenta
-- ===========================================================================
-- Mismo recorrido pero como `anon`. Todo lo que aparezca acá es, literalmente,
-- lo que cualquiera puede bajarse de la API pública sin registrarse.

begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select c.table_name as tabla,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', c.table_name),
                           false, true, '')
       ))[1]::text::int as filas_visibles_sin_cuenta
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.column_name  = 'tenant_id'
   and exists (select 1 from pg_class k join pg_namespace n on n.oid = k.relnamespace
                where n.nspname = 'public' and k.relname = c.table_name and k.relkind = 'r')
 order by 2 desc, 1;

rollback;


-- ===========================================================================
-- 5. Storage: nadie debería poder listar buckets ajenos
-- ===========================================================================
-- Ojo con la lectura de este bloque: el endpoint público
-- `/storage/v1/object/public/...` NO pasa por RLS, así que esto mide el
-- LISTADO (poder enumerar qué archivos existen), no la descarga por URL.
-- Esperado: 0 para anon, y para un usuario logueado sólo su propia carpeta.

begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select 'anon' as quien, count(*) as objetos_que_puede_listar from storage.objects;
rollback;


-- ===========================================================================
-- 6. SECURITY DEFINER: search_path fijo y quién puede ejecutarlas
-- ===========================================================================
-- Una definer sin `search_path` fijo es escalable por búsqueda de esquema.
-- La columna `anon_puede` es la que hay que mirar de reojo: cada `true` es un
-- endpoint en /rest/v1/rpc/ abierto a internet sin sesión.

select p.proname,
       coalesce(array_to_string(p.proconfig, ','), '*** SIN search_path ***') as search_path,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_puede,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and p.prosecdef
order by (p.proconfig is null) desc, has_function_privilege('anon', p.oid, 'EXECUTE') desc, p.proname;


-- ===========================================================================
-- 7. Vistas: sin security_invoker, una vista se saltea la RLS de sus tablas
-- ===========================================================================
-- Hoy no hay ninguna vista en `public` ni en `app`, así que esto devuelve 0
-- filas. Queda para que la primera que alguien cree no entre sin el flag.

select c.relname as vista,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'NO SETEADO') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app')
  and c.relkind in ('v', 'm')
  and coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'off') <> 'on'
order by c.relname;


-- ===========================================================================
-- 8. Permisos por columna: lo que RLS no puede tapar
-- ===========================================================================
-- RLS decide QUÉ FILAS ve alguien, nunca qué columnas. Donde la policy es
-- `using (true)` a propósito (perfiles públicos, escudo, scores), lo único que
-- separa un dato público de uno interno es el permiso por columna.
--
-- Dos trampas que ya nos mordieron, por si hay que tocar esto de nuevo:
--   a) `revoke select (col)` es un NO-OP si el rol conserva el SELECT de tabla.
--      Postgres sólo mira los permisos por columna cuando no hay permiso de
--      tabla. Hay que revocar el de tabla y devolver las columnas una por una.
--   b) `revoke ... from anon` no saca lo que está concedido a PUBLIC. Si el ACL
--      arranca con `=X/postgres` (nada a la izquierda del `=`), eso es PUBLIC y
--      hay que revocárselo a PUBLIC.
--
-- Esta consulta lista qué columnas puede leer `anon` en las tablas de policy
-- abierta. Si aparece una que no debería, es una fuga.

-- (ojo: `column_privileges` no trae `ordinal_position`, hay que ir a `columns`
--  para ordenar como está declarada la tabla)
select p.table_name,
       string_agg(p.column_name, ', ' order by c.ordinal_position) as columnas_que_lee_anon
from information_schema.column_privileges p
join information_schema.columns c
  on c.table_schema = p.table_schema
 and c.table_name   = p.table_name
 and c.column_name  = p.column_name
where p.grantee = 'anon'
  and p.privilege_type = 'SELECT'
  and p.table_schema = 'public'
  and p.table_name in ('profiles', 'verification_checks', 'trust_scores',
                       'creator_scores', 'business_scores')
group by p.table_name
order by p.table_name;

-- Referencia de lo que tiene que dar hoy (migraciones 0057 y 0058):
--   business_scores      → business_id, tenant_id, score, score_previous, level,
--                          score_version, computed_at        (sin `factors`)
--   creator_scores       → profile_id, tenant_id, score, score_previous, level,
--                          is_provisional, score_version, computed_at (sin `factors`)
--   profiles             → id, display_name, avatar_url, country_origin,
--                          area_label, bio, identity_verified, created_at
--                          (sin role, account_status, suspended_until, tenant_id,
--                           email_verified, phone_verified, terms_*, locale,
--                           updated_at, age_confirmed_at, identity_verified_at)
--   verification_checks  → todo menos `evidence`
--   trust_scores         → profile_id, tenant_id, score, score_previous, level,
--                          signals, score_version, computed_at  (sin `factors`)
--
-- `trust_scores.signals` es la única columna interna que sigue abierta a anon, y
-- es deuda conocida, no descuido: 23 archivos piden `select("score, level,
-- signals")` en páginas que abre un anónimo. Se cierra cuando la app deje de
-- pedir `signals` donde sólo pinta score y level — ahí este bloque tiene que
-- pasar a listar trust_scores sin `signals`.

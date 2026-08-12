-- =============================================================================
-- 0091_lectura_no_cruza_comunidades.sql — Comunidad Latina
--
-- BLOQUEANTE B1 de la auditoría 2026-08-09. Un miembro de una comunidad leía el
-- padrón completo de la otra —incluyendo `role`, `account_status` y
-- `suspended_until`— porque catorce policies de SELECT no filtraban por tenant.
-- Es la única fila que hace fallar a la vez el veredicto de seguridad y el de
-- aislamiento multidominio (docs/entrega/prueba-multidominio.md §3, "NO PASA").
--
-- =============================================================================
-- LO PRIMERO, PORQUE CONDICIONA TODO LO DEMÁS: EL `Host` NO LLEGA A LA BASE
-- =============================================================================
-- El pedido natural es "que cada quien vea lo de SU dominio": un anónimo parado
-- en dominicanos.com ve los avisos de dominicanos y no los de comunidadlatina.
-- Eso NO se puede expresar en RLS con la arquitectura de hoy, y conviene decirlo
-- explícito en vez de escribir una policy que aparente hacerlo:
--
--   · El tenant sale del JWT (`app.current_tenant_id()` lee
--     app_metadata.tenant_id). Un visitante SIN SESIÓN no tiene JWT, así que
--     para él `current_tenant_id()` es NULL — siempre, venga del dominio que
--     venga.
--   · El host sí se resuelve, pero muere en el borde: `src/middleware.ts` lo
--     traduce a un header de Next (`x-tenant-slug`, src/lib/tenant/resolve.ts:39)
--     que leen los Server Components. Nunca viaja a Postgres. Verificado además
--     que la app NO usa `signInAnonymously`, NO setea `global.headers` en el
--     cliente de Supabase y NO tiene ningún otro canal que le cuente el tenant a
--     la base sin sesión (src/lib/supabase/{server,client}.ts).
--   · Y aunque lo mandara por parámetro no serviría: lo elegiría el visitante.
--     La anon key es pública por diseño y PostgREST está expuesto, así que
--     cualquiera le pega directo a /rest/v1/listings sin pasar por Next.
--
-- Es exactamente lo que ya dejó escrito la 0079 al resolver este mismo problema
-- para `profile_card()`. No se inventa un mecanismo nuevo: se respeta el que hay.
--
-- POR LO TANTO, LA REGLA DE ESTA MIGRACIÓN ES:
--
--     El filtro de tenant se le aplica a QUIEN TIENE SESIÓN.
--     El visitante anónimo sigue leyendo el contenido PUBLICADO, sin filtrar,
--     PERO SÓLO donde una pantalla pública real lo necesita.
--
-- Ese "sólo donde hace falta" no es retórica: se verificó tabla por tabla contra
-- `src/`, y en CUATRO de las catorce resultó que `anon` no tenía ningún lector
-- legítimo, así que ahí se le cierra del todo y no hay concesión que explicar:
--   · tenant_domains          (sólo la lee el middleware, y por RPC)
--   · creator_scores          (cero lectores en toda la app)
--   · business_scores         (cero lectores en toda la app)
--   · creator_portfolio_items (sus tres lectores exigen sesión)
--
-- Qué cierra eso y qué no, sin adornos:
--   ✔ Cierra la fuga DEMOSTRADA en la auditoría —la que se reprodujo con un
--     `set local role authenticated` y un JWT de otra comunidad—: un miembro
--     logueado deja de ver el padrón, los Trust Scores, las verificaciones y el
--     contenido de las demás comunidades. Ahí están `role`, `account_status`,
--     `suspended_until`, `email_verified` y `terms_accepted_at`, que son las
--     columnas administrativas: `anon` NUNCA las tuvo (su grant son 10 de 23
--     columnas, verificado en information_schema.column_privileges), así que
--     acotar `authenticated` las cierra por completo.
--   ✘ NO cierra la lectura anónima cross-tenant del contenido publicado. Un
--     anónimo con la anon key sigue pudiendo listar los avisos publicados de
--     todas las comunidades. Cerrarlo requiere que el tenant llegue a la base
--     —cambio en `src/`, fuera del alcance de esta migración—; el camino está en
--     "LO QUE FALTA" al pie de este archivo.
--   El saldo: se pasa de "cualquier miembro reconstruye la base de usuarios y la
--   conducta del cliente competidor" a "el contenido público es público", que es
--   la definición de contenido público.
--
-- =============================================================================
-- POR QUÉ EL FILTRO ES `auth.uid() is null` Y NO `current_tenant_id() is null`
-- =============================================================================
-- Tentaba escribir `or (select app.current_tenant_id()) is null` como sinónimo
-- de "es anónimo". Es FALSO y habría dejado la puerta abierta: hay 1 usuario de
-- 18 en `auth.users` sin `tenant_id` en su app_metadata (medido, no supuesto).
-- Con esa versión ese usuario —y cualquier token viejo o mal provisionado—
-- habría leído TODO, que es justo lo que se viene a cerrar.
--   `auth.uid() is null` distingue de verdad "no hay sesión". Un autenticado sin
-- claim de tenant no matchea ninguna rama y no lee nada: falla cerrado, que es
-- como tiene que fallar. (Ese usuario, verificado, ni siquiera tiene fila en
-- `profiles`.)
--
-- Se usa `auth.uid()` y NO una función nueva en `app` a propósito: la 0081 le
-- quitó a `anon` el EXECUTE por default sobre las funciones nuevas de ese schema,
-- y las expresiones de una policy corren con los privilegios de QUIEN CONSULTA.
-- Un helper nuevo en `app` sin `grant execute ... to anon` habría tirado
-- "permission denied for schema app" en todo el sitio público. `auth.uid()` ya
-- lo ejecutan las policies actuales.
--
-- =============================================================================
-- SE MANTIENEN EXACTAMENTE 4 POLICIES POR TABLA, CON EL NOMBRE CANÓNICO
-- =============================================================================
-- `scripts/rls-enumerator.mjs` (npm run check:rls) rompe el build si una tabla
-- tiene una policy EXTRA: "el contrato es exactamente 4 policies canónicas:
-- consolidá la lógica dentro de ellas". Por eso NO se parte en una policy para
-- `anon` y otra para `authenticated` —que habría sido lo legible— y toda la
-- lógica de rol vive dentro de la expresión de `<tabla>_select`.
--
-- =============================================================================
-- LO QUE **NO** SE TOCA, Y POR QUÉ (decidido leyendo `src/`, no por prudencia)
-- =============================================================================
-- 1. LOS GRANTS POR COLUMNA DE `profiles`. La auditoría proponía
--    `revoke select on public.profiles from authenticated` y re-otorgar una
--    lista sin `role`, `account_status` ni `suspended_until`. ESO ROMPE LA APP
--    EN EL CAMINO MÁS CALIENTE QUE TIENE: `getViewerAccount()`
--    (src/lib/time/viewer-zone.ts:58) hace, con el cliente de usuario y en CADA
--    request del shell `(app)`,
--        .from("profiles").select("timezone, account_status, suspended_until")
--    para el gate de sanciones de `src/app/(app)/layout.tsx`. Sin esas columnas
--    el gate no puede decidir y la app entera se cae. Los mismos tres campos los
--    leen `src/app/admin/miembros/page.tsx` (role, account_status,
--    suspended_until) y `src/app/admin/global/contenido/queries.ts`, también con
--    el cliente de usuario.
--      Un GRANT es por ROL, no por fila: no existe "leé tu propio account_status
--    pero no el ajeno". Con el filtro de tenant de esta migración esas columnas
--    dejan de cruzar comunidades, que era el daño reportado. Queda como residuo
--    conocido que un miembro logueado pueda leer por REST el `role` /
--    `account_status` de OTRO miembro DE SU MISMA comunidad. Cerrarlo requiere
--    mover esas lecturas a una función SECURITY DEFINER (el patrón de
--    `profile_card`), o sea tocar `src/`. Está en "LO QUE FALTA".
-- 2. `profile_card()`. La 0079 ya le puso la guarda de tenant. No se re-abre.
-- 3. Las policies de INSERT/UPDATE/DELETE. La escritura cross-tenant ya estaba
--    bloqueada y auditada; esta migración es solo de LECTURA.
-- 4. `tenants` (`status = 'active'`): es el catálogo de comunidades y el
--    middleware lo lee sin sesión. Filtrarlo por tenant sería circular.
-- 5. Nada fuera de Comunidad Latina: la base es compartida con caughtcode y
--    todos los objetos que se tocan acá son de este producto.
--
-- ADITIVO Y REVERSIBLE: no se borra ni una fila, ni una columna, ni una tabla.
-- Volver atrás es restaurar el `using` anterior de cada policy (están citados
-- uno por uno más abajo) y devolver `resolve_tenant_domain` a SECURITY INVOKER.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. `profiles` — el padrón. El corazón de B1.
-- ---------------------------------------------------------------------------
-- ANTES: using (true)  ·  to anon, authenticated
-- Evidencia de la auditoría: un miembro de comunidadlatina leyó las 15 filas de
-- dominicanos con display_name, role='domain_admin', account_status, tenant_id,
-- email_verified y terms_accepted_at. La lista de quién administra la comunidad
-- de al lado es la lista de objetivos de un ataque dirigido.
--
-- La rama `id = auth.uid()` no es decorativa: garantiza que nadie pierda su
-- PROPIO perfil si el tenant del token y el de su fila difieren (token viejo,
-- cuenta migrada). Es la misma promesa que el `v_owner or` de la 0079.
--
-- Quién lee esta tabla y por qué no se rompe:
--   · anon (sitio público, sitemap.ts con la anon key pelada, tarjetas de autor
--     en feed/marketplace/empleos): entra por la rama `auth.uid() is null`.
--   · el propio usuario (getViewerAccount, ajustes, shell-context): rama `id`.
--   · miembros de la misma comunidad (autores de posts, listados de creadores):
--     rama `tenant_id`.
--   · global_admin (paneles /admin/global/*): rama `is_global_admin()`, que ya
--     existía para eso (0075/0076).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to anon, authenticated
  using (
    (select auth.uid()) is null                            -- visitante sin sesión (ver cabecera)
    or id = (select auth.uid())                            -- el propio perfil, pase lo que pase con el token
    or tenant_id = (select app.current_tenant_id())        -- mi comunidad
    or (select app.is_global_admin())
  );

comment on policy profiles_select on public.profiles is
  'El padrón deja de ser global (B1, auditoría 2026-08-09). Antes era using(true) y un miembro logueado de una comunidad leía las filas COMPLETAS de la otra: display_name, role, account_status, suspended_until, tenant_id, email_verified y terms_accepted_at — o sea quién administra la comunidad de al lado y quién está suspendido allá. Ahora quien tiene sesión ve su propia fila y la de su tenant; global_admin ve todo (0075/0076). El visitante SIN sesión sigue leyendo, y no por olvido: el Host no llega a la base (el middleware lo convierte en el header x-tenant-slug de Next), sin JWT no hay tenant que comparar y la anon key es pública, así que un filtro por tenant para anon sería decorativo. A anon lo contiene el GRANT por columna (10 de 23, 0058): ninguna columna administrativa está entre ellas. El test es auth.uid() is null y NO current_tenant_id() is null porque hay usuarios autenticados sin claim de tenant, y ésos tienen que quedar AFUERA, no adentro.';

-- ---------------------------------------------------------------------------
-- 2. `trust_scores` — la conducta de cada persona
-- ---------------------------------------------------------------------------
-- ANTES: using (true)
-- La auditoría leyó las 15 filas ajenas con `signals` incluido
-- ({"reports_upheld":0,"transactions_ok":9,"endorsements_count":14,
--   "months_in_community":22}): historial de conducta de miembros de otro
-- cliente. `anon` también tiene grant sobre `signals` (no sobre `factors`).
drop policy if exists trust_scores_select on public.trust_scores;
create policy trust_scores_select on public.trust_scores
  for select to anon, authenticated
  using (
    (select auth.uid()) is null
    or profile_id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy trust_scores_select on public.trust_scores is
  'El Trust Score y sus `signals` (reports_upheld, transactions_ok, endorsements_count) son historial de conducta: desde 0091 no cruzan comunidades para quien tiene sesión. Antes era using(true) y un miembro leía la reputación completa del padrón ajeno, que junto con profiles permitía reconstruir la actividad del cliente competidor. Cada quien ve siempre su propio score (rama profile_id) aunque su token traiga otro tenant. El anónimo sigue leyendo por la razón general de 0091: sin JWT no hay tenant que comparar.';

-- ---------------------------------------------------------------------------
-- 3. `creator_profiles` — la ficha profesional del creador
-- ---------------------------------------------------------------------------
-- ANTES: using (true). Las 18 columnas están otorgadas a anon Y authenticated,
-- así que un miembro leía el catálogo de creadores de la otra comunidad entero
-- (headline, skills, rate_hint, rating_avg, completed_jobs) — que en un
-- marketplace es la lista de proveedores del competidor.
drop policy if exists creator_profiles_select on public.creator_profiles;
create policy creator_profiles_select on public.creator_profiles
  for select to anon, authenticated
  using (
    (select auth.uid()) is null
    or profile_id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy creator_profiles_select on public.creator_profiles is
  'El directorio de creadores deja de ser global para quien tiene sesión (B1). Antes using(true): un miembro leía headline, skills, rate_hint, rating_avg y completed_jobs de los creadores de la otra comunidad, que en un marketplace white-label es la lista de proveedores y las tarifas del cliente competidor. El creador siempre ve su propia ficha (rama profile_id). El anónimo sigue leyendo (ver cabecera de 0091): /creadores es una pantalla pública.';

-- ---------------------------------------------------------------------------
-- 4-5. `creator_scores` y `business_scores` — SIN rama de anónimo
-- ---------------------------------------------------------------------------
-- ANTES: using (true) en las dos.
-- Estas dos son la excepción feliz de esta migración: se les puede cerrar la
-- puerta a `anon` DEL TODO, sin la concesión de "el Host no llega a la base",
-- porque no hay a quién romperle. Barrido exhaustivo de `src/`: NINGÚN archivo
-- de src/app, src/lib ni src/components las lee ni las escribe — no aparecen
-- fuera de database.types.ts, de sus propias migraciones (0029, 0058, 0085) y
-- de scripts/tenant-isolation-check.sql. Cero lectores, con sesión o sin ella.
--
-- Si mañana una pantalla PÚBLICA necesita mostrar el puntaje de un negocio, el
-- camino correcto NO es devolverle `using(true)` a anon: es una función SECURITY
-- DEFINER que reciba el tenant resuelto del Host, como hizo la 0078 con los
-- precios. Queda dicho acá para que nadie lo "arregle" reabriendo la tabla.
--
-- No se les toca el GRANT (anon conserva el de columnas): la policy ya devuelve
-- cero filas, y mover grants es la clase de cambio que la 0085 documenta como
-- capaz de vaciar la app en silencio. Con la policy alcanza y es reversible.
drop policy if exists creator_scores_select on public.creator_scores;
create policy creator_scores_select on public.creator_scores
  for select to anon, authenticated
  using (
    profile_id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy creator_scores_select on public.creator_scores is
  'El puntaje de un creador no cruza comunidades (B1). Antes era using(true). A diferencia del resto de 0091 acá NO hay concesión para el visitante anónimo, y se pudo porque no rompe nada: el barrido de src/ no encontró un solo lector de esta tabla en toda la app (ni público ni con sesión). Cada creador ve el suyo (rama profile_id). Si alguna vez una pantalla pública necesita mostrarlo, la salida es una función SECURITY DEFINER que reciba el tenant del Host —el patrón de tenant_public_prices (0078)—, no devolverle using(true) a anon.';

-- Sin rama de "fila propia" en business_scores: la fila cuelga de `business_id`
-- (un negocio), no de un perfil, y el dueño de un negocio pertenece al tenant de
-- ese negocio, así que la rama de tenant ya lo cubre.
drop policy if exists business_scores_select on public.business_scores;
create policy business_scores_select on public.business_scores
  for select to anon, authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy business_scores_select on public.business_scores is
  'El puntaje de un negocio no cruza comunidades (B1). Antes using(true). Igual que creator_scores_select: sin rama de anónimo, porque el barrido de src/ no encontró ningún lector de esta tabla en la app. Sin rama de fila propia a propósito: la fila cuelga de business_id y el dueño pertenece al tenant del negocio, así que la rama de tenant lo cubre.';

-- ---------------------------------------------------------------------------
-- 6. `verification_checks` — verificaciones contra registros oficiales
-- ---------------------------------------------------------------------------
-- ANTES: using (true). Expone license_number, registry, registry_url y result.
-- La rama de sujeto propio evita que alguien pierda de vista SU verificación si
-- su token trae otro tenant.
drop policy if exists verification_checks_select on public.verification_checks;
create policy verification_checks_select on public.verification_checks
  for select to anon, authenticated
  using (
    (select auth.uid()) is null
    or (subject_kind = 'profile' and subject_id = (select auth.uid()))
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy verification_checks_select on public.verification_checks is
  'Las verificaciones contra registros oficiales (license_number, registry, result) no cruzan comunidades para quien tiene sesión (B1). Antes using(true). Quien es el sujeto de la verificación la ve siempre, aunque su token traiga otro tenant. El anónimo sigue leyendo porque el sello de verificación se muestra en las fichas públicas: `evidence` nunca estuvo en su grant.';

-- ---------------------------------------------------------------------------
-- 7. `creator_portfolio_items` — tampoco necesita rama de anónimo
-- ---------------------------------------------------------------------------
-- ANTES: using (true)
-- Tercera tabla que se cierra del todo. `anon` tiene el grant de columnas, pero
-- el barrido de src/ encontró exactamente TRES lectores y los tres exigen
-- sesión: src/app/(app)/creadores/solicitud/queries.ts:304 (el creador viendo su
-- propia solicitud) y los dos de staff, src/app/admin/creadores/
-- {solicitudes/queries.ts:304, snapshots.ts:147}. Ninguna pantalla pública lo
-- muestra hoy — el perfil público del creador se arma de creator_profiles.
drop policy if exists creator_portfolio_items_select on public.creator_portfolio_items;
create policy creator_portfolio_items_select on public.creator_portfolio_items
  for select to anon, authenticated
  using (
    creator_id = (select auth.uid())
    or tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy creator_portfolio_items_select on public.creator_portfolio_items is
  'El portafolio del creador deja de ser legible por cualquiera (B1). Antes using(true). Sin rama de anónimo, y se pudo porque los únicos tres lectores en src/ exigen sesión: el propio creador en su solicitud y las dos pantallas de staff de /admin/creadores. Si mañana el perfil PÚBLICO del creador pasa a mostrar el portafolio, hay que resolverlo con una función SECURITY DEFINER que reciba el tenant del Host (patrón 0078), no reabriendo la tabla a anon.';

-- ---------------------------------------------------------------------------
-- 8. `tenant_domains` — la ÚNICA que sí se le cierra a `anon`, y hay que
--    explicar por qué se puede
-- ---------------------------------------------------------------------------
-- ANTES: using (true) para anon y authenticated. Probado por la auditoría: un
-- GET /rest/v1/tenant_domains con la anon key devolvía el mapa completo
-- dominio→tenant de TODOS los clientes, con `notes` incluido — y el comment de
-- esa columna dice que ahí va "por qué se suspendió, a quién se le compró el
-- dominio". Es información comercial de un cliente visible por cualquiera.
--
-- LA TRAMPA QUE HAY QUE DESARMAR PRIMERO. Esta tabla la lee el middleware ANTES
-- de que exista sesión, en CADA request, vía `public.resolve_tenant_domain()`
-- (0060). Esa función se escribió SECURITY **INVOKER**, y su propio comentario
-- dice por qué: "anon ya puede leer estas dos tablas por RLS, no hace falta
-- elevar privilegios". O sea que cerrar la tabla sin tocar la función deja al
-- middleware sin resolver el host: no se cae una pantalla, se cae la plataforma
-- entera para todo visitante sin sesión.
--
-- Por eso el orden acá importa: PRIMERO la función pasa a DEFINER, DESPUÉS se
-- cierra la tabla. Es seguro porque la función es propiedad de `postgres`, que
-- tiene rolbypassrls = true (verificado en pg_roles), así que su cuerpo lee la
-- tabla aunque la RLS esté en FORCE — el mismo mecanismo por el que
-- `profile_card` (0079) llega a `profiles_private`. Ya tiene `search_path = ''`,
-- que es lo que hace segura a una definer.
--
-- El cuerpo NO se modifica: se copia tal cual de la 0060. Sigue devolviendo 0 o
-- 1 fila y sigue tapando por igual "dominio inexistente", "suspendido" y "tenant
-- pausado". Lo que cambia es de dónde saca el permiso. Nunca devolvió `notes`.
create or replace function public.resolve_tenant_domain(p_host text)
returns table (
  tenant_id       uuid,
  tenant_slug     text,
  tenant_name     text,
  matched_domain  text,
  is_primary      boolean,
  primary_domain  text
)
language sql
stable
security definer
set search_path = ''
as $$
  with host as (
    select regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_host, ''))), ':[0-9]+$', ''),
             '\.$', ''
           ) as h
  ),
  candidato as (
    -- Se prueba el host tal cual y su versión sin `www.`: registrar el apex
    -- alcanza para que `www.` resuelva, sin obligar al admin a cargar dos filas.
    select d.tenant_id, d.domain, d.is_primary
      from public.tenant_domains d, host
     where d.status = 'active'
       and (d.domain = host.h or d.domain = regexp_replace(host.h, '^www\.', ''))
       and host.h <> ''
     order by (d.domain = host.h) desc, d.is_primary desc
     limit 1
  )
  select t.id,
         t.slug,
         t.name,
         c.domain,
         c.is_primary,
         (select p.domain
            from public.tenant_domains p
           where p.tenant_id = t.id and p.is_primary and p.status = 'active'
           limit 1)
    from candidato c
    join public.tenants t on t.id = c.tenant_id
   where t.status = 'active';
$$;

comment on function public.resolve_tenant_domain(text) is
  'Lookup Host→tenant para el middleware, una llamada por request. Devuelve 0 o 1 fila; devolver 0 tapa por igual "dominio inexistente", "dominio suspendido/archivado" y "tenant pausado" — indistinguibles a propósito. `primary_domain` viene para poder redirigir un alias a su canónico sin una segunda consulta. DESDE 0091 ES SECURITY DEFINER, y el cambio es la condición para cerrar la tabla: la 0060 la había hecho INVOKER apoyándose en que tenant_domains_select era using(true) para anon, así que al filtrar esa policy el middleware se habría quedado sin resolver el host en toda request sin sesión — la plataforma entera, no una pantalla. Es propiedad de postgres (rolbypassrls), así que como definer lee la tabla con la RLS en FORCE, igual que profile_card llega a profiles_private. El cuerpo es idéntico al de 0060 y nunca devolvió `notes`.';

revoke execute on function public.resolve_tenant_domain(text) from public;
grant execute on function public.resolve_tenant_domain(text) to anon, authenticated, service_role;

-- Ahora sí: la tabla se cierra. `anon` pierde el SELECT de tabla y de columna —
-- se le revocan las dos formas porque un grant por columna sobrevive al revoke
-- de tabla y viceversa; olvidarse de una es dejar el agujero abierto creyendo lo
-- contrario (la lección de la 0057 y la 0085, en el sentido inverso).
--
-- La policy queda `to authenticated` a secas: si algún día alguien le devuelve
-- el grant a `anon` sin pensarlo, no habrá policy que lo ampare y seguirá sin
-- leer. Falla cerrado.
--
-- Quién lee esta tabla hoy y por qué sigue funcionando:
--   · el middleware sin sesión → `resolve_tenant_domain`, ya convertida arriba.
--     Es el ÚNICO camino de resolución que usa la app: src/lib/tenant/
--     domain-lookup.ts:197 le pega por `fetch` crudo a
--     /rest/v1/rpc/resolve_tenant_domain con la anon key, sin cliente de
--     Supabase de por medio. (`get_tenant_by_domain` existe en la base y ya era
--     definer, pero hoy no la llama nadie en el repo — verificado. Que la 0060
--     la mencione como "la que llama el middleware" quedó desactualizado.)
--   · src/lib/integrity/register.ts:480 → createAdminClient (service_role, que
--     tiene rolbypassrls). No lo afecta.
--   · /admin/global/page.tsx:48 y /admin/global/dominios/page.tsx:50 → cliente
--     de usuario, pero son pantallas de global_admin: rama is_global_admin().
--   · el admin de una comunidad viendo SUS dominios → rama tenant_id.
revoke select on public.tenant_domains from anon;
revoke select (id, tenant_id, domain, is_primary, created_at, status, updated_at, notes)
  on public.tenant_domains from anon;

drop policy if exists tenant_domains_select on public.tenant_domains;
create policy tenant_domains_select on public.tenant_domains
  for select to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    or (select app.is_global_admin())
  );

comment on policy tenant_domains_select on public.tenant_domains is
  'El mapa dominio→tenant deja de ser público (B1). Antes era using(true) para anon: un GET /rest/v1/tenant_domains con la anon key devolvía TODOS los dominios de TODOS los clientes con su `notes`, que es la nota comercial del admin (por qué se suspendió, a quién se le compró el dominio). Ahora un admin ve los dominios de su comunidad y global_admin los ve todos. Se pudo cerrar —y es la única tabla de 0091 que se le cierra a anon— porque en esta misma migración resolve_tenant_domain() pasó a SECURITY DEFINER: el middleware resuelve el host sin tocar la RLS, igual que get_tenant_by_domain. Sin ese cambio previo, esta policy habría dejado sin resolver el host a toda request sin sesión. La policy es `to authenticated` a secas para que devolverle el grant a anon por descuido no alcance para volver a abrirla.';

-- ---------------------------------------------------------------------------
-- 9-14. Contenido publicado: listings, posts, comments, listing_comments,
--       guides y gig_reviews
-- ---------------------------------------------------------------------------
-- Estas seis NO eran using(true): ya tenían la forma
--     status = 'published'  OR  (mi tenant AND (soy el autor OR soy staff))
--     OR is_global_admin()
-- El agujero es la PRIMERA rama: `published` sin tenant. Es la que la 0079 y
-- src/lib/tenant/guard.ts:29-31 documentan como deliberada ("NO bloquea
-- lecturas: el contenido published es cross-tenant a propósito (SEO)"). Contra
-- un anónimo eso es SEO; contra un miembro logueado de otra comunidad es fuga
-- (53 de 64 avisos y 31 de 34 publicaciones ajenas leídas en la prueba).
--
-- Se le suma el tenant SOLO a esa rama, con la excepción del anónimo. Las otras
-- ramas ya filtraban por tenant y quedan como estaban.
--
-- CAMBIO DE COMPORTAMIENTO QUE HAY QUE DECIR EN VOZ ALTA: un miembro logueado de
-- la comunidad A que abra el link de un aviso de la comunidad B verá un 404
-- donde antes veía el aviso. Es lo que pide el white-label, y es asimétrico
-- respecto del anónimo: el mismo link sin sesión sigue abriendo. La asimetría es
-- consecuencia de que el Host no llega a la base, no una decisión de producto.

-- 9. listings ------------------------------------------------------------------
-- ANTES: (status='published') or (tenant_id=current_tenant_id() and (created_by=uid or is_staff())) or is_global_admin()
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings
  for select to anon, authenticated
  using (
    (
      status = 'published'
      and (
        (select auth.uid()) is null                        -- SEO / sitio público
        or tenant_id = (select app.current_tenant_id())    -- con sesión: sólo mi comunidad
      )
    )
    or (
      tenant_id = (select app.current_tenant_id())
      and (
        created_by = (select auth.uid())
        or (select app.is_staff())
      )
    )
    or (select app.is_global_admin())
  );

comment on policy listings_select on public.listings is
  'Los avisos publicados dejan de ser globales para quien tiene sesión (B1: la prueba leyó 53 de 64 avisos de la otra comunidad). La rama `published` era cross-tenant a propósito por SEO (src/lib/tenant/guard.ts:29-31) y sigue siéndolo para el visitante SIN sesión —el sitemap.ts la usa con la anon key pelada, y el Host no llega a la base como para distinguir de qué dominio viene—; pero para un miembro logueado se acota a su comunidad, que es donde estaba la fuga. Las ramas de autor, staff y global_admin no cambian: ya filtraban por tenant. Consecuencia buscada: con sesión, el link a un aviso de otra comunidad da 404; sin sesión, sigue abriendo.';

-- 10. posts --------------------------------------------------------------------
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to anon, authenticated
  using (
    (
      status = 'published'
      and (
        (select auth.uid()) is null
        or tenant_id = (select app.current_tenant_id())
      )
    )
    or (
      tenant_id = (select app.current_tenant_id())
      and (
        author_id = (select auth.uid())
        or (select app.is_staff())
      )
    )
    or (select app.is_global_admin())
  );

comment on policy posts_select on public.posts is
  'El feed publicado deja de ser global para quien tiene sesión (B1: 31 de 34 publicaciones ajenas leídas en la prueba). Mismo criterio que listings_select: la rama `published` sigue abierta para el visitante sin sesión (SEO, y sin JWT no hay tenant que comparar) y se acota al tenant en cuanto hay sesión. Autor, staff y global_admin sin cambios.';

-- 11. comments -----------------------------------------------------------------
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to anon, authenticated
  using (
    (
      status = 'published'
      and (
        (select auth.uid()) is null
        or tenant_id = (select app.current_tenant_id())
      )
    )
    or (
      tenant_id = (select app.current_tenant_id())
      and (
        author_id = (select auth.uid())
        or (select app.is_staff())
      )
    )
    or (select app.is_global_admin())
  );

comment on policy comments_select on public.comments is
  'Los comentarios acompañan a su publicación: mismo criterio que posts_select (0091). Con sesión, sólo los de mi comunidad; sin sesión, los publicados siguen visibles. Coherente por construcción: si con sesión ya no veo el post ajeno, tampoco tiene sentido que vea sus comentarios.';

-- 12. listing_comments ---------------------------------------------------------
drop policy if exists listing_comments_select on public.listing_comments;
create policy listing_comments_select on public.listing_comments
  for select to anon, authenticated
  using (
    (
      status = 'published'
      and (
        (select auth.uid()) is null
        or tenant_id = (select app.current_tenant_id())
      )
    )
    or (
      tenant_id = (select app.current_tenant_id())
      and (
        author_id = (select auth.uid())
        or (select app.is_staff())
      )
    )
    or (select app.is_global_admin())
  );

comment on policy listing_comments_select on public.listing_comments is
  'Los comentarios de un aviso acompañan al aviso: mismo criterio que listings_select (0091).';

-- 13. guides -------------------------------------------------------------------
-- ANTES: (status='published') or (tenant_id is not null and tenant_id=current_tenant_id()
--        and current_user_role() in ('domain_admin','global_admin')) or is_global_admin()
--
-- OJO CON `tenant_id is null`: una guía sin tenant es una GUÍA GLOBAL, y eso es
-- intencional (la propia auditoría lo marca: "dejando pasar guides.tenant_id is
-- null (guía global, es intencional)"). Si se filtrara sólo por igualdad de
-- tenant, `null = <uuid>` da NULL y las guías globales desaparecerían para todo
-- usuario logueado — se perdería contenido que hoy se ve, sin ganar aislamiento.
drop policy if exists guides_select on public.guides;
create policy guides_select on public.guides
  for select to anon, authenticated
  using (
    (
      status = 'published'
      and (
        (select auth.uid()) is null
        or tenant_id is null                               -- guía global: cross-tenant BY DESIGN
        or tenant_id = (select app.current_tenant_id())
      )
    )
    or (
      tenant_id is not null
      and tenant_id = (select app.current_tenant_id())
      and (select app.current_user_role()) = any (array['domain_admin', 'global_admin'])
    )
    or (select app.is_global_admin())
  );

comment on policy guides_select on public.guides is
  'Las guías publicadas de OTRA comunidad dejan de verse con sesión (B1). Se conserva explícitamente la guía GLOBAL (tenant_id is null), que es cross-tenant por diseño: sin esa rama, `null = <uuid>` evalúa NULL y todo usuario logueado habría perdido contenido que hoy ve, sin ganar un gramo de aislamiento. El borrador sigue siendo visible sólo para el admin de su propia comunidad, y el visitante sin sesión sigue leyendo lo publicado (sitemap.ts las publica con la anon key).';

-- 14. gig_reviews --------------------------------------------------------------
-- ANTES: (visible = true) or (reviewer_id = uid) or is_staff() or is_global_admin()
-- Dos arreglos, no uno:
--   a) `visible` sin tenant — el agujero de B1 (3 de 4 reseñas ajenas leídas).
--   b) `is_staff()` suelto: era un chequeo de ROL sin pertenencia, así que un
--      moderador de la comunidad A leía las reseñas ocultas de la B. Las demás
--      tablas ya exigían `tenant_id = current_tenant_id() AND is_staff()`; acá
--      faltaba. Se alinea con el resto.
-- `reviewer_id` se conserva sin condición de tenant: quien escribió una reseña
-- tiene que poder verla aunque su token traiga otro tenant (misma promesa que
-- la rama de fila propia del resto de esta migración).
drop policy if exists gig_reviews_select on public.gig_reviews;
create policy gig_reviews_select on public.gig_reviews
  for select to anon, authenticated
  using (
    (
      visible = true
      and (
        (select auth.uid()) is null
        or tenant_id = (select app.current_tenant_id())
      )
    )
    or reviewer_id = (select auth.uid())
    or (
      tenant_id = (select app.current_tenant_id())
      and (select app.is_staff())
    )
    or (select app.is_global_admin())
  );

comment on policy gig_reviews_select on public.gig_reviews is
  'Las reseñas visibles dejan de cruzar comunidades para quien tiene sesión (B1). Arregla además algo que la auditoría no listó: la rama de staff era app.is_staff() a secas, un chequeo de ROL sin pertenencia, así que un moderador de una comunidad leía las reseñas NO visibles de la otra; ahora exige tenant, como en listings, posts y comments. Quien escribió la reseña la ve siempre (rama reviewer_id, sin condición de tenant, para que un token desfasado no le tape lo suyo). El anónimo sigue viendo las visibles: la ficha del creador es pública.';

commit;

-- =============================================================================
-- LO QUE FALTA (no entra acá porque exige tocar `src/`, y esta migración no lo
-- hace) — para que quede escrito y no se pierda:
--
--   1. AISLAR TAMBIÉN AL ANÓNIMO. Requiere que el tenant del Host llegue a la
--      base. El camino ya existe y es el de la 0078: una función SECURITY
--      DEFINER que recibe el tenant EXPLÍCITO resuelto por el servidor desde el
--      Host (`resolve_tenant_domain`), con la tabla cerrada detrás. Habría que
--      llevar las lecturas públicas (feed, marketplace, guías, sitemap) a
--      funciones de ese estilo, o inyectar el tenant como claim en un token
--      anónimo emitido por el servidor. Es un frente de app, no de RLS.
--   2. `role` / `account_status` / `suspended_until` DENTRO del mismo tenant.
--      Hoy siguen legibles por cualquier miembro de la misma comunidad vía REST,
--      porque un GRANT es por rol y no por fila, y revocarlos rompería
--      getViewerAccount() en cada request (ver cabecera, punto 1). El cierre
--      correcto es exponerlos por una función SECURITY DEFINER que devuelva solo
--      la fila propia —el patrón de profile_card()— y recién entonces revocar
--      las columnas a `authenticated`.
--   3. B2 (anon con TRUNCATE/INSERT/UPDATE/DELETE sobre las 74 tablas) sigue
--      abierto: es otra migración, con su propio análisis de qué se re-otorga.
-- =============================================================================

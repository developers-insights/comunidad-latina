# Blindaje — Comunidad Latina · Puerta previa a producción

**Repo:** `C:/MisProyectos/INSIGHTS/clientes/comunidad_latina` · rama `main`, commit `d1a0abf`, árbol limpio
**Supabase auditado:** `ktmbtpuhqqofdkisqseq` ("Comunidad latina") — confirmado con `list_projects`; NO se tocó `rlausjxxgmtapvozrttw`
**Fecha:** 2026-08-09
**Método:** skill `blindaje` (puerta gateada) + `multi-tenant-safety-checker` + `supabase-audit-rls` + `supabase-audit-rpc` + `secret-leak-detector`

---

## 1. VEREDICTO GLOBAL

# 🔴 NO PASA

Motivo gateado: **hay un bloqueante abierto y VERIFICADO en el dominio load-bearing #2 (políticas de lectura / PII)** — un usuario logueado de una comunidad lee el padrón completo de la otra, incluyendo columnas administrativas. En un producto white-label donde cada tenant es un cliente distinto, eso es fuga entre clientes, no entre usuarios.

**Contexto honesto, porque importa para la decisión:** este repo está **muy por encima** de la media. 74/74 tablas con RLS `enabled` + `FORCE`, 4 policies cada una, 56 de 74 con deny total para anónimos, GRANT por columna funcionando, trigger anti-escalada de privilegios que probé y frenó, escritura cross-tenant bloqueada, RPC admin con verificación de rol Y de pertenencia, TTL de retención implementado en `pg_cron` que coincide con lo que promete la política de privacidad. La migración `0057_fix_revokes_que_no_tomaron.sql` documenta y corrige la trampa de "el GRANT de tabla le gana al de columna" — eso es nivel de detalle que casi nadie tiene.

Lo que falla no es descuido general: es **una decisión de diseño puntual** (`USING(true)` en el eje de perfiles públicos) que era razonable para un sitio de una sola comunidad y que **no se reevaluó al volverse multi-tenant**. Es acotado y tiene arreglo mecánico.

---

## 2. BLOQUEANTES DE LANZAMIENTO

### 🔴 B1 — Un miembro de una comunidad lee el padrón completo de la otra, con columnas administrativas

**Qué es.** 13 tablas tienen políticas que no filtran por tenant. La peor es `profiles`: su policy de SELECT es `USING(true)` para `{anon, authenticated}`, y `authenticated` tiene GRANT sobre **las 23 columnas**.

**Evidencia (VERIFICADO — prueba de comportamiento en la base de producción).** Impersoné el rol exacto de PostgREST (`set local role authenticated` + `request.jwt.claims` con `app_metadata.tenant_id` del tenant *comunidadlatina*, rol `member`) y conté qué filas del tenant *dominicanos* podía leer. La prueba es **auto-verificable**: 30 tablas devolvieron 0 (RLS sí estaba aplicando), 13 filtraron.

| Tabla | Filas ajenas que LEO | Filas ajenas que existen |
|---|---|---|
| `listings` | 53 | 64 |
| `posts` | 31 | 34 |
| **`profiles`** | **15** | **15 (todas)** |
| **`trust_scores`** | **15** | **15 (todas)** |
| `comments` | 14 | 14 |
| `creator_profiles` | 8 | 8 |
| `creator_scores` | 8 | 8 |
| `gig_reviews` | 3 | 4 |
| `listing_comments` | 2 | 2 |
| `business_scores`, `guides`, `tenant_domains`, `verification_checks` | 1 c/u | 1 c/u |

Grupo de control (0 filas leídas, RLS correcta): `messages`, `conversations`, `profiles_private`, `moderation_queue`, `audit_log`, `listing_private_details`, `job_applications`, `post_poll_votes`, `saves`, `notifications`, `scam_reports`, `follows`, `cta_clicks`, `listing_views`, `post_views`, `tenant_prices` y 14 más.

Contenido real devuelto por la prueba (perfiles del tenant ajeno):
```json
{"display_name":"Carlos Rosario","role":"domain_admin","account_status":"active",
 "email_verified":false,"phone_verified":false,"terms_accepted_at":null,
 "tenant_id":"019f39cf-5115-70bf-8a9e-8db074bf07d6","locale":"es"}
```
```json
{"profile_id":"67dde9ce-…","score":35,"level":"activo",
 "signals":{"reports_upheld":0,"transactions_ok":9,"endorsements_count":14,"months_in_community":22}}
```

**La app NO compensa esto, y está escrito así a propósito.** `src/lib/tenant/guard.ts:29-31`: *"NO bloquea lecturas: el contenido `published` es cross-tenant a propósito (SEO…). La divergencia solo cierra la ESCRITURA."* Las páginas de detalle (`perfil/[id]`, `feed/[id]`, `marketplace/[id]`) consultan por id **sin filtro de tenant**. Y aunque filtraran: la anon key es pública y PostgREST está expuesto — se le pega directo, sin pasar por Next. Detalle completo en §7.0.

**Impacto.** Cualquiera que se registre en `comunidadlatina.com` obtiene: (a) el padrón íntegro de `dominicanos.com` — nombre visible, biografía, país de origen, barrio (`area_label`), fecha de alta; (b) **quién es `domain_admin` de la otra comunidad**, que es la lista de objetivos de un ataque dirigido; (c) `account_status` — quién está suspendido o dado de baja allá; (d) `email_verified`/`phone_verified`/`terms_accepted_at`, que son metadatos de cumplimiento; (e) el Trust Score con sus señales de conducta (`transactions_ok`, `endorsements_count`, `reports_upheld`) de cada persona. En white-label, el cliente A puede reconstruir la base de usuarios y la actividad del cliente B — que es competencia directa. `anon` (sin cuenta) obtiene una versión reducida pero igual completa: probé `GET /rest/v1/profiles` con la anon key y devolvió **17 de 17 perfiles** (`Content-Range: 0-0/17`) de ambos tenants.

**Fix exacto.** El GRANT por columna ya contiene bien a `anon` (10 de 23 columnas — probé pedir `tenant_id` como anon y devolvió `42501`). Falta el filtro de tenant en la policy y cerrar las columnas administrativas a `authenticated`:

```sql
-- 1) El eje de perfiles públicos deja de ser global
alter policy profiles_select on public.profiles
  to anon, authenticated
  using (tenant_id = (select app.current_tenant_id()) or (select app.is_global_admin()));

-- 2) 'authenticated' no necesita las columnas administrativas de OTRA persona
revoke select on public.profiles from authenticated;
grant select (id, tenant_id, username, display_name, avatar_url, cover_url, bio,
              country_origin, area_label, identity_verified, created_at)
  on public.profiles to authenticated;

-- 3) Mismo tratamiento a las otras 12
alter policy trust_scores_select        on public.trust_scores        using (tenant_id = (select app.current_tenant_id()));
alter policy creator_profiles_select    on public.creator_profiles    using (tenant_id = (select app.current_tenant_id()));
alter policy creator_scores_select      on public.creator_scores      using (tenant_id = (select app.current_tenant_id()));
alter policy business_scores_select     on public.business_scores     using (tenant_id = (select app.current_tenant_id()));
alter policy verification_checks_select on public.verification_checks using (tenant_id = (select app.current_tenant_id()));
alter policy creator_portfolio_items_select on public.creator_portfolio_items using (tenant_id = (select app.current_tenant_id()));
-- listings / posts / comments / listing_comments / gig_reviews / guides:
--   sumar `and tenant_id = (select app.current_tenant_id())` a la rama de publicado,
--   dejando pasar `guides.tenant_id is null` (guía global, es intencional).
```

⚠️ **`tenant_domains` es la excepción legítima**: el middleware resuelve el host **antes** de que exista sesión, así que su lectura pública es necesaria. Pero hoy expone el mapa completo dominio→tenant de todos los clientes (probado: `GET /rest/v1/tenant_domains` como anon devuelve las 2 filas con `tenant_id`, `notes`, `status`). Reemplazarlo por la RPC `get_tenant_by_domain`, que ya existe, ya es `SECURITY DEFINER`, ya devuelve solo branding y **ya es anon-ejecutable** — y después revocar el SELECT de tabla a `anon`.

⚠️ **`profile_card()` arrastra el mismo problema y hay que arreglarlo en el mismo commit**: es `SECURITY DEFINER`, anon-ejecutable, y **no verifica tenant en ningún punto**. Probado en vivo: como anon devolvió la ficha de un perfil del tenant ajeno. Los campos sensibles sí quedaron protegidos por `app.privacy_allows()` con los defaults de `app.profile_privacy_defaults()` (`last_name`, `age`, `birthdate`, `country_residence`, `city` volvieron `null`), pero la ficha en sí cruza el límite. Agregar la verificación de tenant al `select` inicial.

---

### 🟠 B2 — `anon` tiene TRUNCATE sobre las 74 tablas, y TRUNCATE ignora la RLS

**Qué es.** El `grant all on all tables` que Supabase deja por defecto en `public` nunca se revocó para escritura. `anon` y `authenticated` tienen `INSERT`, `UPDATE`, `DELETE` y **`TRUNCATE`** sobre las 74 tablas.

**Evidencia (VERIFICADO — `information_schema.role_table_grants`).** `anon`: TRUNCATE en 74 tablas, INSERT en 74, UPDATE en 74, DELETE en 74. Corroborado por comportamiento: `DELETE /rest/v1/posts?id=eq.<uuid-imposible>` como anon devuelve **204**, no 401 — el rol tiene el privilegio, lo que frena es la policy.

**Por qué importa aunque la RLS esté bien.** RLS filtra filas en SELECT/INSERT/UPDATE/DELETE. **TRUNCATE no pasa por RLS en absoluto** — es un privilegio de tabla y borra todo sin evaluar una sola policy. Las 74 policies no protegen contra esto.

**Alcance real hoy (lo verifiqué, no lo asumo).** PostgREST **no expone TRUNCATE** por HTTP, y comprobé que **ninguna** de las 27 funciones expuestas a `anon`/`authenticated` usa SQL dinámico (`EXECUTE` / `format(`) — consulta sobre `pg_proc` filtrando por esos patrones: **0 resultados**. O sea: **no hay camino de explotación por HTTP hoy**. Es riesgo latente, no fuga activa. Se vuelve alcanzable el día que aparezca una conexión directa con el rol `anon`, una RPC nueva con SQL dinámico, o componentes embebibles.

**Impacto si se alcanza.** Pérdida total e irrecuperable de las 74 tablas en una sola sentencia.

**Fix exacto.**
```sql
revoke truncate, insert, update, delete on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, insert, update, delete on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;
-- después re-otorgar insert/update/delete a `authenticated` SOLO donde el producto lo necesita
-- (las policies ya están escritas: esto es cinturón además del tirante).
```

---

### 🟠 B3 — 19 migraciones están aplicadas en producción y no existen en el repo

**Qué es.** El repo tiene 59 archivos en `supabase/migrations/` (hasta `0059_trust_scores_factors_privado.sql`). La base tiene **19 migraciones más**, todas del 8 y 9 de agosto, sin archivo correspondiente en `main`.

**Evidencia (VERIFICADO — `list_migrations` cruzado con `ls supabase/migrations/`).** Faltan en el repo: `dominios_desde_la_base`, `content_integrity`, `campos_de_registro_y_perfil`, `privacidad_del_perfil`, `umbrales_de_creador_por_tenant`, `fix_reasons_array_concat`, `job_id_cl_cm`, `telefono_por_tenant_y_codigos_sms`, `zona_horaria_por_usuario`, `notificaciones_sociales`, `retencion_de_lo_nuevo`, `envoltorios_public_para_la_app`, `envoltorios_public_de_telefono`, `precios_por_dominio`, `semilla_de_precios`, `ingresos_por_comunidad`, `super_admin_cross_tenant`, `levantar_restriccion_cross_tenant`, `historial_de_precios_sobrevive_al_tenant`. Archivos `0060+` en el repo: **0**.

El propio SQL aplicado se delata: `-- 0075_super_admin_cross_tenant.sql (ver el archivo del repo para el comentario completo)` — apunta a un archivo que en `main` no existe. Corroboración independiente: el frente legal reportó que `content_assets`/`content_matches` "no existen" en el repo; en la base **sí existen** (4 tablas, 0 filas). Es la misma brecha vista desde el otro lado.

**Impacto.** Producción está adelante de `main`. Ese SQL no pasó por revisión de código, no se puede reconstruir la base desde el repo, y 14 tablas existen en producción sin migración versionada. Probablemente sea trabajo en vuelo en alguno de los 6 worktrees — pero mientras no esté en `main`, para una puerta de producción cuenta como no auditado.

**Fix exacto.** Volcar las 19 desde `supabase_migrations.schema_migrations` a archivos `0060`–`0078` en `supabase/migrations/`, revisarlas y mergearlas a `main` antes del lanzamiento.

---

### 🟡 B4 — 4 buckets públicos sin límite de tamaño ni filtro de tipo; borrar contenido no lo baja del CDN

**Qué es.** `avatars`, `listing-photos`, `post-media` y `tenant-assets` tienen `public = true`, `file_size_limit = NULL` y `allowed_mime_types = NULL`.

**Evidencia (VERIFICADO — descarga real sin ninguna credencial).**
```
curl "$URL/storage/v1/object/public/listing-photos/019f39cf-5115-…/92dffb63-….webp"
→ HTTP=200  bytes=205449
```
Sin `apikey`, sin `Authorization`. Las policies de `storage.objects` filtran lindo por `app.current_tenant_id()` — y son **decorativas para estos 4 buckets**, porque la ruta pública del CDN no las evalúa. `job-cvs` sí está privado (`public=false`), que era el crítico.

**Impacto.** (a) Un usuario autenticado puede subir **cualquier tipo de archivo, de cualquier tamaño** a un bucket público: hosting gratis de contenido arbitrario a costa del cliente, y vector de distribución de malware bajo el dominio del proyecto. (b) Cuando moderación baja una foto, **la imagen sigue accesible por URL para siempre** — el pipeline de moderación borra la fila, no el objeto. Eso choca de frente con la promesa de `moderation_queue` ("nunca publicar imagen sin moderar").

**Fix exacto.**
```sql
update storage.buckets
   set file_size_limit = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif']
 where id in ('avatars','listing-photos','tenant-assets');
update storage.buckets
   set file_size_limit = 104857600, -- 100 MB (video corto)
       allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
 where id = 'post-media';
```
Y en la resolución de moderación: borrar el objeto de Storage, no solo la fila.

---

### 🟡 B5 — Protección de contraseñas filtradas desactivada

**Qué es / evidencia (VERIFICADO — `get_advisors(security)`).** `auth_leaked_password_protection`: WARN. Supabase Auth no está contrastando contra HaveIBeenPwned.

**Impacto.** Registro con contraseñas ya comprometidas → apropiación de cuentas por credential stuffing. En un producto que maneja PII de población migrante y contratos con dinero, es barato de arreglar y caro de ignorar.

**Fix exacto.** Dashboard → Authentication → Policies → activar "Leaked password protection". Un clic, sin migración.

*Dato relacionado (VERIFICADO):* **0 usuarios con MFA verificado** sobre 18. `auth.mfa_factors` está vacía. No es bloqueante para miembros comunes, pero las cuentas `global_admin` y `domain_admin` — que con `super_admin_cross_tenant` ahora pueden sancionar en **cualquier** comunidad — hoy se protegen con solo una contraseña, y sin chequeo de contraseñas filtradas. Esa combinación sí conviene cerrarla antes del lanzamiento.

---

## 3. AISLAMIENTO ENTRE TENANTS — veredicto propio

# 🔴 NO PASA (lectura) · ✅ PASA (escritura)

**Cómo se resuelve el tenant.** `app.current_tenant_id()` = `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. `app_metadata` **no es editable por el usuario** vía `updateUser` — solo lo escribe el servidor. Ese eje es correcto: **el tenant no es suplantable desde el JWT**. (La resolución por Host en el middleware la cubre el frente de aplicación; ver §6.)

**Prueba corrida.** Impersonación del rol de PostgREST (`set local role authenticated` + claims de tenant A, rol `member`), barriendo las 74 tablas y contando filas del tenant B. Auto-verificable: 30 tablas devolvieron 0, lo que prueba que la RLS estaba efectivamente aplicando y que el resultado no es un falso negativo.

| Vector | Resultado | Evidencia |
|---|---|---|
| **Lectura cross-tenant** | 🔴 **FUGA en 13 tablas** | tabla completa en B1 |
| **Escritura cross-tenant** | ✅ BLOQUEADO | `INSERT` de post con `tenant_id` ajeno → `42501: new row violates row-level security policy` |
| **Escalada por columna** | ✅ BLOQUEADO | `UPDATE profiles SET role='global_admin'` sobre mi propia fila → `P0001: PROTECTED_COLUMNS: role/identity_verified/phone_verified/email_verified/tenant_id de profiles solo se modifican via service_role` |
| **RPC admin cross-tenant** | ✅ BLOQUEADO | `admin_ban_user` / `admin_metrics_overview` / `admin_revenue_summary` verifican rol **y** pertenencia; el `domain_admin` queda clavado a su JWT y recibe `FORBIDDEN` explícito |
| **RPC admin desde anon** | ✅ BLOQUEADO | `POST /rpc/admin_revenue_summary` → `42501 permission denied for function` |
| **Datos privados cross-tenant** | ✅ BLOQUEADO | `profiles_private` (6 filas reales) → `[]` como anon; `messages`, `conversations`, `listing_private_details`, `job_applications` → 0 filas ajenas |
| **Storage por tenant (API)** | ✅ correcto | policies de `storage.objects` filtran por `app.current_tenant_id()` |
| **Storage por CDN público** | 🟡 se saltea | ver B4 |
| **Entre USUARIOS del mismo tenant** | ✅ CORRECTO | eje aparte, probado por separado (abajo) |

**Segundo eje probado: usuario contra usuario dentro de la misma comunidad.** Impersoné a un `member` de *dominicanos* y busqué filas de OTRO member del mismo tenant, barriendo todas las tablas con columna de dueño (`profile_id`, `viewer_id`, `voter_id`, `applicant_id`, `sender_id`, `owner_id`, `blocker_id`, `follower_id`, `buyer_id`). Resultado: **solo se ven las 3 tablas de reputación pública** (`trust_scores`, `creator_profiles`, `creator_scores`), que es el diseño buscado. `user_roles` devolvió **0** correctamente. Nada de lo privado se cruza entre usuarios. **Este eje pasa.**

**Integridad del eje de identidad (VERIFICADO).** Crucé `auth.users.raw_app_meta_data` contra `public.profiles` para los 18 usuarios: **`tenant_id` y `role` coinciden en el 100%** de los casos. No hay deriva entre el eje de seguridad (JWT, el que evalúan las policies) y el de display (`profiles.role`). Hay 1 usuario huérfano sin tenant y sin perfil — falla cerrado: `app.current_tenant_id()` le devuelve `null` y no lee nada. **No hay Auth Hook ni triggers sobre `auth.users`** (verificado sobre `pg_proc`/`pg_trigger`), así que `app_metadata` lo escribe la aplicación con `service_role` en el alta.

⚠️ **De ahí cuelga la pregunta abierta más importante del aislamiento de escritura:** si el `tenant_id` que la app graba en `app_metadata` al registrarse sale del **`Host` de la request**, entonces el `Host` es el eje real de asignación de tenant y hay que confirmar que el proxy lo fije. La base ya no puede protegerse sola en ese punto — para cuando la policy evalúa el JWT, el tenant ya está adentro. Es exactamente lo que cubre el frente de aplicación (§7); **queda SIN CHEQUEAR hasta que cierre.**

**Lectura del resultado.** El aislamiento está bien construido en todo lo que es *privado* (mensajes, datos sensibles, moderación, auditoría, pagos, dinero). Lo que se escapa es el eje *público*: perfiles, contenido publicado y reputación. Eso era correcto cuando la app era una comunidad; al volverse white-label, "público" dejó de significar "público para todos" y pasó a significar "público dentro de esta comunidad" — y las policies no acompañaron el cambio.

**Dos migraciones con nombre alarmante resultaron ser lo contrario.** Revisé `super_admin_cross_tenant` y `levantar_restriccion_cross_tenant`: la primera le da cross-tenant al `global_admin` a pedido explícito del pliego ("acceder administrativamente a cualquier dominio") manteniendo al `domain_admin` acotado; la segunda **arregla** un bug real de aislamiento (`admin_lift_restriction` era la única de la familia que no verificaba pertenencia y devolvía 204 dejando una anotación falsa). Ambas están bien.

---

## 4. FILAS `probe-audit-` CREADAS

**Ninguna.**

Todos los intentos de escritura fueron rechazados por la base:
- `INSERT` cross-tenant en `posts` con cuerpo `probe-audit-cross-tenant-write` → `42501`, revertido.
- `UPDATE` de escalada de rol → `P0001`, revertido dentro del bloque de excepción.
- Batería de 20 `INSERT` anónimos con `probe-audit-anon` → ninguno pasó (401 o 400 por forma del payload).
- `DELETE`/`PATCH` anónimos: siempre con filtro imposible (`id=eq.00000000-…`), 0 filas afectadas.

**Limpieza:** creé dos funciones temporales para las pruebas de impersonación (`public._probe_audit_xtenant()`, `public._probe_audit_pii()`) y **las dejé borradas** con `drop function` en la misma sesión. No queda nada mío en la base.

**Nada real fue borrado ni modificado.**

---

## 5. INVENTARIO LEGAL

### Lo que existe y **funciona** (VERIFICADO)

| Pieza | Ruta | Estado |
|---|---|---|
| Banner de consentimiento | `src/components/legal/consent-banner.tsx` + `consent-preferences.tsx` | ✅ **Bloquea de verdad** — ver detalle abajo |
| Registro único de trazadores | `src/lib/consent/categories.ts` (`TRACKERS`) | ✅ misma fuente para el gate y la tabla de cookies |
| Gate de scripts | `src/lib/consent/gate.ts` (`whenConsented`) | ✅ existe; hoy sin usuarios porque no hay scripts que gatear |
| Exportación de datos | `src/app/(app)/ajustes/privacidad/exportar/route.ts` | ✅ **con auth y ownership** |
| Borrado de cuenta | `src/app/(app)/perfil/actions.ts` (`deleteAccountAction`) | ✅ **borrado real**, no desactivación |
| Cascadas de borrado | `supabase/migrations/0015_account_deletion_fk.sql` | ✅ CASCADE / SET NULL documentados |
| 5 documentos legales | `src/app/(marketing)/legal/{terminos,privacidad,normas,cookies,marketplace}/page.tsx` | ✅ enlazados desde footer, con fecha |
| Aceptación en registro | `src/app/(auth)/actions.ts` líneas 67-68 | ✅ `z.literal(true)` **server-side**, no bypasseable |
| Edad mínima | ídem + `0027_consent_age.sql` | ✅ guarda solo el timestamp de atestación, no la fecha de nacimiento |
| Denuncia de contenido | RPC `report_scam` | ✅ 10/día/usuario, misma clave en todas las superficies |
| Cola de moderación | `src/app/admin/moderacion/page.tsx` + `actions.ts` | ✅ resuelve con RLS del staff, audita cada acción |
| Retención declarada = real | `supabase/migrations/0013_cron_ttl.sql` + `cron.job` en vivo | ✅ ver abajo — **verificado contra la base, no contra el archivo** |

**Banner de consentimiento — el punto que más importa, resuelto:** El banner **sí bloquea**, y la razón por la que hoy no bloquea nada es que **no hay nada que bloquear**. Verificado: cero `<Script>`/`next/script` de terceros en toda la app; ni GA, ni GTM, ni Meta Pixel, ni Hotjar, ni `@vercel/analytics` en `package.json`. Las categorías `analitica` y `marketing` están vacías por diseño, con comentario explicándolo. Default antes de elegir: ambas en `false`. Tecla Escape = rechazar, nunca aceptar. Persistencia en `localStorage['cl-consent']` con versión y timestamp.
*Matiz que corresponde anotar:* **Sentry se inicializa sin pasar por el consentimiento**, clasificado deliberadamente como "necesarias" con justificación escrita (no escribe cookies ni localStorage, Session Replay apagado con `replaysSessionSampleRate: 0`, `sendDefaultPii: false`, y hay un test que falla si alguien lo reactiva). Es una postura defendible por interés legítimo, pero es **criterio propio, no un hecho objetivo** — que quede registrado como decisión, no como cumplimiento automático.

**Exportación — no hay IDOR:** la route es un `GET` **sin ningún parámetro**. El `user.id` sale exclusivamente de `supabase.auth.getUser()`; usa el cliente anon + cookies de sesión, **nunca `service_role`**; las 13 consultas llevan `.eq(ownerColumn, user.id)` además de la RLS. **No se pueden exportar los datos de otro usuario cambiando un id, porque no hay ningún id que cambiar.**

**Borrado de cuenta — es real:** `admin.auth.admin.deleteUser(user.id)`. Orden verificado: bloquea si hay negocio con Stripe activo → recolecta paths de Storage → borra el usuario → recién entonces limpia Storage (`avatars`, `post-media`, `job-cvs`, `listing-photos`). Contenido publicado: `conversations`/`messages`/`listings` en CASCADE (se borran); `posts.author_id`, `comments.author_id`, `scam_reports.reporter_id` en SET NULL (el contenido sobrevive anonimizado). Sin período de gracia — y la UI lo dice bien ("No lo podemos deshacer"), sin discrepancia entre copy y comportamiento.

**Tabla de cookies vs. cookies reales — coinciden, sin excepciones.** Contrasté `TRACKERS` contra grep de `.set(`, `localStorage.setItem`, `sessionStorage.setItem` y `middleware.ts`. **Cero cookies reales no declaradas.** La tabla no es prosa desconectada: `cookie-table.tsx` importa `TRACKERS` directo, así que la divergencia es estructuralmente imposible salvo que alguien agregue una cookie sin tocar `categories.ts`.

| Cookie / storage | Declarada | Real |
|---|---|---|
| `sb-<proyecto>-auth-token` | sí | sí (`@supabase/ssr`) |
| `cl-tenant` | sí | sí, **solo en dev** (`middleware.ts:35-41`, gateado por `NODE_ENV !== production`) |
| `cl-asst` | sí (dormida) | dormida — asistente devuelve 503 sin `ANTHROPIC_API_KEY` |
| `cl-identity-session` | sí (dormida) | dormida, `httpOnly` |
| `cl-consent`, `cl-theme`, `cl-splashed`, `cl-guias-offline`, `cl:buscar:historial:*`, `cl-pwa-*` | sí | sí |

### Lo que existe pero **NO funciona** o está incompleto

| Problema | Ruta | Detalle |
|---|---|---|
| 🔴 **Placeholder crudo visible al usuario** | `legal/normas/page.tsx:185` y `legal/marketplace/page.tsx:356` | Muestran literalmente `[correo de contacto legal — completar]` en producción. `terminos` y `privacidad` sí usan `<LegalContact />`, que degrada con dignidad. Dos documentos quedaron fuera de esa centralización. |
| 🔴 **Sin canal de derechos de autor (DMCA)** | — | Cero resultados para `DMCA`, `copyright`, `notice-and-takedown`, `agente designado`. `legal/marketplace` menciona "reclamos de propiedad intelectual" y **redirige al placeholder sin completar**. En una plataforma de contenido de terceros con marketplace, es la vía por la que llega la primera carta de un abogado. |
| 🟠 **Marketplace se autodeclara borrador** | `legal/marketplace/page.tsx:96-99` | `LegalCallout tone="warning"`: **"BORRADOR — requiere revisión de abogado"**, visible en la página pública. |
| 🟠 **Responsable del tratamiento no se resuelve por tenant** | `src/lib/tenant/resolve.ts:8-16` | El tipo `Tenant` tiene `id, slug, name, brandHex, logoUrl, locale, currency, modules` — **ningún campo de razón social, domicilio, jurisdicción ni contacto legal**. `LEGAL_CONTACT_EMAIL` y `LEGAL_GOVERNING_STATE` son constantes **globales**, hoy ambas `null`. El `JsonLd` hardcodea `Organization.name = "Comunidad Latina"` para cualquier tenant. **Es un gap de arquitectura, no de redacción**: aunque se complete el mail hoy, seguiría siendo un único valor para todos los clientes. Si cada comunidad white-label la opera una entidad distinta, hoy no hay dónde guardar quién responde por los datos de cada una. |
| 🟠 **Integridad de contenido: esquema sin producto** | tablas `content_assets`, `content_asset_versions`, `content_matches`, `content_integrity_alerts` | Existen en la base (4 tablas, **0 filas**), llegaron por la migración `content_integrity` que **no está en el repo** (B3). Sin cableado a la UI. Los únicos `sha256` del repo son del pipeline de embeddings del asistente, no de huellas de fotos. |
| 🟡 **Export sin rate limit** | `ajustes/privacidad/exportar/route.ts` | Único flujo sensible sin `lib/rate-limit` (que sí usan `registerAction`, `reportProfileAction`, `deleteAccountAction`). Riesgo bajo (requiere sesión, devuelve solo lo propio) pero permite descargas repetidas. |

### Lo que **falta** por completo

1. Canal y agente designado para reclamos de derechos de autor.
2. `LEGAL_CONTACT_EMAIL` y `LEGAL_GOVERNING_STATE` (`legal-prose.tsx:15-32` — el propio código lo marca "PENDIENTE DE NEGOCIO — NO ES UNA DECISIÓN TÉCNICA").
3. Campos de entidad legal por tenant en el modelo de datos.
4. Mención de encargado/subencargados y DPA — cero resultados en los 5 documentos.
5. Revisión de abogado del documento de marketplace (lo pide el propio documento).

---

## 6. LA MATRIZ — 16 dominios

| # | Dominio | Estado | Resultado |
|---|---|---|---|
| 1 | **RLS por tabla** | ✅ VERIFICADO | Terreno cruzado con 3 fuentes (`list_tables` 74 + 59 migraciones del repo + `pg_class`). **74/74 con RLS `enabled` + `FORCE`**, 4 policies cada una. `get_advisors` sin un solo error de RLS. Pero el advisor no ve `USING(true)`: **8 tablas lo tienen**, y el sondeo las delató (fila 2). |
| 2 | **Políticas de lectura (PII)** | 🔴 **VERIFICADO — FUGA** | **B1.** 13 tablas leen cross-tenant. Desambiguado como manda el playbook: los `[]` de `profiles_private` se contrastaron contra 6 filas reales conocidas → bloqueo confirmado, no tabla vacía. |
| 3 | **Escritura + escalada por columna** | ✅ VERIFICADO | Escritura cross-tenant → `42501`. Escalada de `role` → `P0001` por trigger. Los `400` de la batería anónima eran forma del payload (no probaban nada) — desambiguados con `role_table_grants`, que reveló B2. |
| 4 | **Authz server-side** | ✅ VERIFICADO | RPC verificadas por mí (rol + pertenencia). 7 Route Handlers + 37 archivos de Server Actions enumerados y auditados: **sin IDOR explotable**; gate del panel admin en el layout. Anotado **A3** (service_role sin filtro de tenant leyendo mensajes en moderación). §7.2 |
| 5 | **Secretos en el bundle** | 🟡 VERIFICADO con caveat | **Bundle limpio:** grep de los 199 archivos de `.next/static/` contra los valores literales de `.env.local` → **0 coincidencias**; ningún `"use client"` toca una env sin `NEXT_PUBLIC_`. ⚠️ **el `.next/` es del 3-ago y el último commit del 8-ago** — vale para ese build, no para el código de hoy. **Historial de git limpio (VERIFICADO):** `.env.local` **nunca** se commiteó (`git log --all -- .env.local` vacío); busqué los valores literales de 9 secretos en los últimos 60 commits → **ninguno aparece**. Dos aparentes coincidencias en `.env.example` resultaron **falsos positivos**: `STRIPE_SECRET_KEY` y `SENTRY_AUTH_TOKEN` están **vacías** en `.env.local`, y lo que "coincidía" era el relleno de espacios del comentario alineado. `.env.example` solo tiene placeholders. Falta el grep de `.next/static/` → §7. |
| 6 | **Dependencias / CVEs** | 🟡 VERIFICADO | `npm audit`: **0 critical, 8 high**. Los dos que tocan tráfico real: **`sharp`** (procesa imágenes de usuarios) y **`undici`** (fetch en runtime). §7.4 |
| 7 | **Headers / CSP / HSTS** | ✅ **VERIFICADO — bien** | `curl -sD -` contra la **respuesta real** de `https://comunidad-latina-sigma.vercel.app` (no contra `next.config.ts`). CSP estricta: `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, allowlist explícita por Stripe/Supabase/Sentry/OpenAI. HSTS `max-age=63072000; includeSubDomains; preload` (2 años). `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)`. **Única objeción:** `'unsafe-inline'` en `script-src` y `style-src` (limitación conocida de Next sin nonces) — degrada la CSP como defensa anti-XSS, no la anula. |
| 8 | **Endpoints públicos: abuso** | 🟡 parcial VERIFICADO | `record_cta_click` y `record_listing_share` son anon-ejecutables pero **exigen sesión adentro** (probado: `P0001 AUTH_REQUIRED`). Rate limit de app en §7. |
| 9 | **Superficie LLM / chatbot** | 🟡 parcial VERIFICADO | `match_chunks` y `match_chunks_fts` **revocadas a `anon` y `authenticated`** (solo `service_role`). `rag_chunks` con SELECT en `false`: sin dump de embeddings por PostgREST. El endpoint HTTP del asistente, en §7. |
| 10 | **Webhooks entrantes** | ⏳ frente de aplicación | `payment_events` tiene `event_id UNIQUE` (idempotencia) y las 4 policies en `false` (solo `service_role`) — el lado base está bien. Firma de Stripe en §7. |
| 11 | **Auth / OAuth / tokens** | 🟡 VERIFICADO con hallazgo | Tenant desde `app_metadata` (no falsificable). **B5: leaked password protection apagada.** MFA disponible sin usar (0 factores). |
| 12 | **Logs / PII** | ✅ **VERIFICADO — bien** | Corrí la suite: `npx vitest run sentry.scrub.test.ts` → **8/8 passed**. Y leí qué cubre, porque un test verde solo vale si prueba lo correcto: tapa el `token_hash` de `/confirmar`, el `code` PKCE de `/callback`, `access_token`/`refresh_token` (también dentro de mensajes de excepción y de breadcrumbs), emails, teléfonos, cookies y headers sensibles; del usuario deja **solo el id, nunca el email**. Verifiqué además que esté **realmente cableado en los tres runtimes**: `sentry.server.config.ts`, `sentry.edge.config.ts` y `src/instrumentation-client.ts` importan todos `SENTRY_SHARED_OPTIONS` de `sentry.scrub.ts`. Session Replay apagado (`replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0`). |
| 13 | **Subida de archivos** | 🟠 **VERIFICADO — hallazgo** | **B4.** 4 buckets públicos, sin límite de tamaño, sin filtro MIME; objeto real descargado sin credencial. `job-cvs` sí privado. |
| 14 | **Middleware auth bypass** | ✅ VERIFICADO | **Next 16.2.12** (`package.json`). CVE-2025-29927 afecta `<14.2.25` / `<15.2.3`: **muy por encima del parche**. |
| 15 | **Supabase Realtime** | ✅ VERIFICADO | La publicación `supabase_realtime` existe pero tiene **0 tablas**. Ningún `postgres_changes` expuesto: un anónimo no puede suscribirse a nada. No aplica por imposibilidad estructural, medida. |
| 16 | **Server Actions / cache** | 🟡 VERIFICADO | Authz dentro de cada action. Cache de servidor **sin fugas** (tenant en la key, cliente anónimo, sin `force-static`/`revalidate`). Pero **A4**: el Service Worker cachea páginas autenticadas y el logout no las limpia. §7.4 |

---

## 7. FRENTE DE APLICACIÓN — cerrado

### 7.0 La app NO compensa la fuga de B1, y es una decisión escrita

Esto es lo que convierte a B1 de "policy laxa" en **fuga real y confirmada**. `src/lib/tenant/guard.ts:29-31`, textual:

> *"NO bloquea lecturas: el contenido `published` es cross-tenant a propósito (SEO, policy `listings_select`). La divergencia solo cierra la ESCRITURA."*

`requireTenantMatch()` existe, es sólido, y **por diseño solo gatea escrituras**. Las páginas de detalle consultan por id sin filtro de tenant (VERIFICADO, leídas y trazadas):

| Ruta | Consulta | Filtro de tenant |
|---|---|---|
| `src/app/(app)/perfil/[id]/page.tsx:85-95` | `.from("profiles").eq("id", id)` | **ninguno** |
| `src/app/(app)/feed/[id]/page.tsx:59-63` | `.from("posts").eq("id", id)` | **ninguno** |
| `src/app/(app)/marketplace/[id]/page.tsx:49-60` | `.from("listings").eq("id", id)` | **ninguno** |

El comentario de `perfil/[id]/page.tsx:98-100` cita la policy `USING(true)` como justificación. **Consecuencia práctica: desde `comunidadlatina.com` se abre `/perfil/<uuid-de-un-miembro-de-dominicanos>` y se ve su perfil completo.**

Y aunque la app filtrara en las ~130 consultas sin filtro, no alcanzaría: **la anon key es pública por diseño y PostgREST está expuesto** — cualquiera le pega directo a `/rest/v1/profiles?select=*` sin pasar por Next, que es exactamente lo que hice en §B1. **El arreglo va en RLS, no en la app.**

### 7.1 Resolución de tenant en multidominio (VERIFICADO)

| Pregunta | Respuesta |
|---|---|
| ¿De dónde sale el tenant? | `middleware.ts:19` → `resolveTenantSlug(headers.get("host"), …)`. En producción manda **solo el `Host`**: `?t=` y la cookie `cl-tenant` se ignoran (`resolve.ts:214-218`, cerrado también en previews de Vercel). |
| ¿Suplantable por header custom? | ✅ **NO.** `middleware.ts:23` usa `Headers.set()`, que **reemplaza** el `x-tenant-slug` entrante; `resolveTenantSlug()` siempre devuelve string no vacío. No hay rama donde el valor del cliente sobreviva. Verificado además que ninguna ruta escapa al `matcher`. |
| ¿Se usa para ESCRIBIR? | ⚠️ **SÍ.** `src/app/(auth)/actions.ts:135` → `app_metadata: { tenant_id: tenant.id, role: "member" }`. **El Host define a qué comunidad pertenece una cuenta nueva, para siempre.** Es el eslabón que anticipé en §3: en el alta todavía no hay JWT, así que el Host es la única fuente. En Vercel la plataforma lo fija; detrás de otro proxy, hay que garantizarlo. |
| ¿Host desconocido? | 🟠 **Falla ABIERTO**, no 404: `resolve.ts:249` cae a `DEFAULT_TENANT_SLUG = "dominicanos"`. |

🟠 **Hallazgo derivado (A1):** `DOMAIN_TENANTS` (`resolve.ts:105-110`) solo contiene `dominicanos.com` y `comunidadlatina.com`. **El host real de producción —`comunidad-latina-sigma.vercel.app`— no está en el mapa**, así que hoy *todo* el tráfico productivo resuelve al tenant `dominicanos` por defecto, incluidas las altas. Explica el reparto que medí en la base: **15 perfiles en `dominicanos` contra 2 en `comunidadlatina`**.

✅ Host-header poisoning en recuperación de contraseña: **cerrado**. `(auth)/recuperar/origin.ts:64-95` valida contra allowlist antes de construir la URL con el token de sesión. Detalle menor: `isLoopback()` no está gateado por `NODE_ENV`, así que un `Host: localhost` en producción rompe el correo (no exfiltra).

### 7.2 Superficie servidor — inventario completo

**7 Route Handlers**, todos revisados: `api/assistant`, `api/assistant/feedback`, `api/webhooks/stripe`, `ajustes/privacidad/exportar`, `buscar/api`, `(auth)/callback`, `(auth)/confirmar`.
**37 archivos con `"use server"`** — barrido de authz sobre los 30 de `(app)`/`(auth)`/`admin`: **ninguna función vulnerable**. Patrón consistente: `requireTenantMatch()` → ownership por `.eq()` → recién ahí el admin client, y solo sobre tablas que RLS le niega al JWT del usuario.
**`createAdminClient()` en 28 archivos** — cada escritura con poder real tiene gate previo verificado (`admin/guard.ts:110`, webhook tras `constructEvent()`, `deleteUser` acotado a la sesión, `admin/miembros/actions.ts` vía las RPC que revalidan tenant en Postgres, `admin/dominio/actions.ts:180` con el tenant del **JWT** y no de input).
**No existen endpoints de cron** — `CRON_SECRET` se usa solo como secreto HMAC (ver A2). No hay `vercel.json`.

✅ **Webhook de Stripe: de lo mejor del repo.** Body crudo → `constructEvent()` con `STRIPE_WEBHOOK_SECRET` en try/catch → 400 si falla. Más idempotencia por `event_id UNIQUE` y **correlación triple** antes de activar una compra: estado `pending_payment` + `stripe_checkout_session_id` idéntico + `amount_total === amount_cents`.

### 7.3 Hallazgos nuevos del frente de aplicación

| Ref | Sev | Qué | Dónde |
|---|---|---|---|
| **A1** | 🟠 | Host desconocido → tenant por defecto; el host real de producción no está en el mapa, así que todo resuelve a `dominicanos` | `src/lib/tenant/resolve.ts:105-110,249` |
| **A2** | 🟠 | **Secreto HMAC degrada en silencio a una constante pública del repo.** Si falta `CRON_SECRET`, cae a `"cl-rag-dev-only"` con solo un `console.warn`. Ese HMAC existe para que un dump de la base no permita revertir las preguntas del asistente por diccionario — con el secreto conocido, esa garantía desaparece | `src/lib/rag/index.ts:357-364`, `src/app/api/assistant/_lib/anon-limit.ts:23-31` |
| **A3** | 🟠 | Mensajes privados leídos con **service_role sin `.eq("tenant_id")`** en el panel de moderación. Su hermano el DELETE sí lo lleva. `moderation_queue.subject_id` es uuid polimórfico **sin FK**: cualquier bug de integridad ahí filtra mensajes de otro tenant a un moderador | `src/app/admin/moderacion/page.tsx:126-137` |
| **A4** | 🟠 | **El Service Worker cachea páginas autenticadas** (`defaultCache` de Serwist = NetworkFirst en navegaciones) y `signOutAction` **no** llama a `clearLocalData()` — que existe y funciona, pero solo está cableado al panel de privacidad. En un público que usa teléfonos compartidos y locutorios, el siguiente usuario ve offline las páginas del anterior | `src/app/sw.ts`, `src/app/(app)/perfil/actions.ts:96-100` |
| **A5** | 🟡 | `votePostPollAction` razona sobre "RLS me protege", premisa falsa. Hoy no es explotable: lo salva el trigger `app.post_poll_votes_validate()` de `0041`. Lo único que lo frena es una protección en **otra** tabla | `src/app/(app)/feed/engagement-actions.ts:171-188` |
| **A6** | 🟡 | Un anónimo puede marcar "útil" sobre cualquier consulta anónima del mismo tenant si adivina el UUIDv4 | `src/app/api/assistant/feedback/route.ts:60-65` |

### 7.4 Filas de la matriz que cerró este frente

- **Fila 4 — Authz server-side: ✅ VERIFICADO (con A3 anotado).** Sin IDOR explotable. El gate del panel admin vive en el layout, así que ninguna página puede olvidarlo.
- **Fila 5 — Secretos en el bundle: ✅ VERIFICADO.** Se grepearon los **199 archivos** de `.next/static/` contra los valores literales de `.env.local`: **0 coincidencias**. ⚠️ **Caveat que no se maquilla: el `.next/` es del 3-ago (`BUILD_ID`) y el último commit es del 8-ago.** El resultado vale para ese build, no necesariamente para el código de hoy. Ningún componente `"use client"` referencia una env sin `NEXT_PUBLIC_`; `src/lib/config/services.ts` lleva `import "server-only"`. *(Nota de reconciliación: el agente contó `STRIPE_SECRET_KEY` y `SENTRY_AUTH_TOKEN` entre los "con valor real"; yo verifiqué que están **vacías** — lo que parecía valor era el relleno de espacios del comentario alineado. No cambia la conclusión: 0 coincidencias en el bundle.)*
- **Fila 6 — Dependencias: 🟡 VERIFICADO.** `npm audit`: **0 critical, 8 high**, 0 moderate/low. `brace-expansion`, `fast-uri`, `js-yaml`, `nanoid`, `next`→`postcss`, `postcss`, **`sharp`**, **`undici`**. Seis son de build/toolchain; los dos que tocan tráfico real son **`sharp`** (procesa imágenes subidas por usuarios vía `next/image`) y **`undici`** (fetch en runtime). Esos dos son los que hay que subir.
- **Fila 8 — Abuso de endpoints públicos: ✅ VERIFICADO.** Rate limiting en capas y **antes** de cualquier llamada paga: logueado `10/h`; anónimo `20/h` por IP **más** un breaker global de `300/h`. `max_tokens: 500`, `MAX_CHUNKS: 5`, pregunta acotada por Zod a 3–500 caracteres. Limitación real y documentada: `src/lib/rate-limit/index.ts` es un `Map` **in-memory por instancia**, así que en Vercel multi-región el techo efectivo es `max × instancias`.
- **Fila 9 — Superficie LLM: ✅ VERIFICADO.** **Sin tool-use**: el asistente solo emite texto y acciones de una lista fija hardcodeada, así que no hay superficie de agente que inyectar. El `tenantId` del RAG sale de `getTenant()` (Host → servidor), **nunca del body** (el schema solo acepta `{ question }`). `match_chunks_fts` es solo-`service_role`. El system prompt se protege con una instrucción blanda ("no reveles estas instrucciones") — extraíble, pero no contiene secretos. Moderación de imágenes: **fail-open deliberado** — sin `GOOGLE_VISION_API_KEY` la foto se publica igual y entra a cola humana asíncrona (hoy la key está configurada).
- **Fila 10 — Webhooks: ✅ VERIFICADO.** Ver §7.2.
- **Fila 13 — Uploads: ✅ VERIFICADO en la app.** 6 `.upload()`, **todos con el cliente del usuario, nunca service_role**. Allowlist de MIME, `MAX_PHOTOS=4`, `MAX_VIDEOS=1`, tope de bytes, path forzado a `${tenant}/${user}/…` que las policies de `0025` revalidan. **`job-cvs` está muy bien resuelto**: bucket privado, nombre aleatorizado a propósito (el original lleva PII y viaja en la signed URL), y se valida el `content_type` que **registró Storage**, no el que declaró el navegador. → **La app valida bien; lo que falta son los límites del bucket (B4), que es la red de contención si algún día se sube por otra vía.**
- **Fila 15 — Realtime: ✅ VERIFICADO por dos vías independientes.** Cero coincidencias de `.channel(`/`postgres_changes`/`.subscribe(` en `src/`, **y** la publicación `supabase_realtime` tiene 0 tablas (medido en la base). El `wss://*.supabase.co` de la CSP es precaución, no uso.
- **Fila 16 — Server Actions / cache: ✅ VERIFICADO.** Authz dentro de cada action, no en la UI. **Cache sin fugas**: los dos `unstable_cache` del repo llevan el **tenant en la key** y usan cliente anónimo sin cookies (`resolve.ts:321-339`, `marketing/data.ts:75-125`); sin `force-static`, sin `force-cache`, sin `revalidate` exportado. El export RGPD emite `no-store`. **Pero ver A4: el Service Worker sí cachea, y ahí sí hay fuga entre usuarios del mismo dispositivo.**

---

## 7bis. QUÉ VE UN ANÓNIMO — inventario cerrado (VERIFICADO)

**56 de 74 tablas no tienen policy de SELECT para `anon`: deny total.** Las 18 restantes:

**Con `USING(true)` (sin filtro de tenant) — 8 tablas:** `profiles` (10/23 columnas), `trust_scores` (8/9), `creator_profiles` (18/18), `creator_scores` (8/9), `business_scores` (7/8), `verification_checks` (11/12), `creator_portfolio_items` (9/9), `tenant_domains` (8/8). Son las de B1.

**Con condición real (correctas dentro de un tenant, pero sin filtro de tenant) — 9 tablas:** `listings`, `posts`, `comments`, `listing_comments` (`status='published'`), `guides` (`published`), `boosts`, `post_promotions` (`status='active'`), `gig_reviews` (`visible=true`), `tenants` (`status='active'`).

**Cerrada:** `rag_chunks` con `qual='false'` — sin dump de embeddings.

Conteos reales medidos con `Prefer: count=exact` como anónimo: `listings` **53**, `posts` **34**, `creator_profiles` **8**, `tenants` **2**, `profiles` **17** — todos los números son el total de **ambas** comunidades.

Dos confirmaciones de que los GRANT por columna sí muerden: `select=*` sobre `trust_scores` y `verification_checks` como anon **falla** (falta `factors` / `evidence`), exactamente lo que buscaban las migraciones `0057` y `0059`.

Nota de severidad: `creator_profiles` expone las 18 columnas, pero su contenido es portfolio que el creador publica a propósito (titular, bio, skills, fotos, `rate_hint`, rating). No hay PII dura ahí. El problema es de alcance cross-tenant, no de sensibilidad.

---

## 7ter. DATO DE CONTEXTO QUE CAMBIA LA URGENCIA (VERIFICADO)

**Los dominios registrados en `tenant_domains` todavía no apuntan a esta app.**
- `https://dominicanos.com` → **HTTP 200 servido por PHP/8.2.32 sobre LiteSpeed**, con cookies `PHPSESSID` y `user_session`. Es un sitio preexistente, ajeno a este proyecto (0 referencias a `_next/static`).
- `https://comunidadlatina.com` → `302` a `www.comunidadlatina.com`.
- La app vive hoy en `https://comunidad-latina-sigma.vercel.app` (proyecto Vercel `comunidad-latina`, `prj_eNnHfx33W1879zoNu2HuoixP4JEO`).

**Por qué importa para la puerta:** no hay tráfico real de usuarios finales contra esta base todavía, así que **B1 es una fuga confirmada pero aún no explotada por terceros** — hay ventana para arreglarla antes del corte. También significa que el escenario multidominio real (dos hosts distintos resolviendo a dos tenants) **no está probado en producción**: hoy solo existe el host de Vercel.

**Cuidado con el orden:** conectar los dominios antes de arreglar B1 sería exactamente al revés. El día que `dominicanos.com` apunte acá, el padrón de esa comunidad queda legible desde `comunidadlatina.com` y viceversa.

---

## 8. RIESGOS MENORES / DEUDA

- **Schema `app` NO expuesto por PostgREST** (VERIFICADO: `PGRST106 — Only the following schemas are exposed: public, graphql_public`). Los helpers de seguridad (`app.current_tenant_id`, `app.is_global_admin`) no son invocables desde afuera. Correcto.
- **Cero vistas y cero vistas materializadas** en `public` y `app` (VERIFICADO sobre `pg_class`). El vector clásico de "vista que corre como su dueño y saltea RLS" no existe acá.
- **GraphQL no es una segunda puerta de lectura** (VERIFICADO): `POST /graphql/v1` con la anon key devuelve `pg_graphql extension is not enabled`. El schema `graphql_public` figura como expuesto pero la extensión no está instalada. Una superficie menos que auditar.
- **19 funciones `SECURITY DEFINER` expuestas** — todas con `search_path` fijado (`public, app` o `''`). Sin `search_path` serían secuestrables; están bien. Las revisé una por una: `admin_*` verifican rol y pertenencia; `profile_card` gatea campos por privacidad (pero no por tenant, ver B1).
- **`profile_privacy` tiene 0 filas** — todo el mundo corre con `app.profile_privacy_defaults()` (`last_name` y `birthdate` en `privado`, ubicación e idiomas en `seguidores`, bio y país en `publico`). Es un default conservador y correcto, pero significa que la pantalla de privacidad todavía no la usó nadie.
- **`phone_verification_codes`** con las 4 policies en `false` y sus funciones (`phone_verification_consume`, `phone_verification_can_send`) **sin GRANT a `anon` ni a `authenticated`** — los envoltorios de teléfono están bien cerrados. VERIFICADO.
- **21 cron jobs** de `pg_cron` corriendo como `postgres` (bypassan RLS por diseño, documentado).
- **`tenant_domains.notes`** se expone a `anon` — hoy `null`, pero si mañana alguien anota ahí algo operativo, sale publicado.

---

## 9. QUÉ HACE FALTA PARA DAR PASA

**Estado de la matriz al cierre: 16/16 filas recorridas, 0 SIN CHEQUEAR.** El veredicto NO PASA se sostiene por **B1**, que es un bloqueante abierto y verificado — no por huecos de cobertura.

### Antes de conectar los dominios (obligatorio)

1. **B1 — cerrar la lectura cross-tenant.** Una migración: `USING(true)` → filtro por `app.current_tenant_id()` en las 13 tablas, recortar el GRANT de columnas de `profiles` a `authenticated`, verificación de tenant dentro de `profile_card()`, y `tenant_domains` detrás de la RPC `get_tenant_by_domain` que ya existe. **Es el único bloqueante que impide el lanzamiento por sí solo.**
2. **A1 — que el host desconocido falle cerrado**, o como mínimo sumar `comunidad-latina-sigma.vercel.app` a `DOMAIN_TENANTS`. Hoy todo el tráfico productivo —y toda alta nueva— aterriza en el tenant `dominicanos` por defecto.
3. **B2 — revocar `TRUNCATE`** (y las escrituras no usadas) a `anon` en las 74 tablas, más `alter default privileges`.
4. **A2 — que el HMAC falle cerrado en producción** en vez de degradar a la constante pública del repo.
5. **B5 — activar leaked password protection** (un clic) y **MFA para las cuentas `global_admin`/`domain_admin`**, que desde `super_admin_cross_tenant` operan sobre cualquier comunidad.

### Antes del corte productivo

6. **B3 — traer las 19 migraciones al repo** y mergearlas a `main`. Hoy producción está adelante de `main` y ese SQL no pasó por revisión.
7. **B4 — límite de tamaño y filtro MIME** en los 4 buckets públicos; que moderación borre el objeto, no solo la fila.
8. **A3 — agregar `.eq("tenant_id", …)`** a la lectura de mensajes del panel de moderación (copiar lo que ya hace su hermano el DELETE).
9. **A4 — llamar a `clearLocalData()` desde `signOutAction`.** Existe y funciona; solo falta cablearlo. Importa de verdad en un público que usa teléfonos compartidos.
10. **Subir `sharp` y `undici`** — los 2 de los 8 `high` que tocan tráfico real.
11. **Legal — reemplazar los dos placeholders `[correo de contacto legal — completar]`** por `<LegalContact />`. Es texto roto visible a usuarios reales.
12. **Reconstruir y re-escanear el bundle**: el `.next/` auditado es 5 días más viejo que el código.

### Decisiones de negocio, no técnicas (no bloquean el código, sí la exposición legal)

13. Canal y agente designado para reclamos de derechos de autor.
14. `LEGAL_CONTACT_EMAIL` y `LEGAL_GOVERNING_STATE`.
15. Si cada comunidad white-label la opera una entidad distinta: el modelo `Tenant` necesita campos de entidad legal. Hoy es **estructuralmente imposible** declarar un responsable del tratamiento por tenant.
16. Revisión de abogado del documento de marketplace (lo pide el propio documento).

**Con 1–5 hechos, el veredicto pasa a `PASA CON CONDICIONES`** (las condiciones serían 6–12). Con 1–12, **PASA**.

---

## 10. LO QUE QUEDÓ SIN CHEQUEAR — sin maquillar

Ninguna fila de la matriz quedó sin recorrer. Estas son las limitaciones reales de lo que hice, para que nadie lea más certeza de la que hay:

1. **No me autentiqué como usuario real.** Mis reglas me impiden crear cuentas o usar contraseñas. La prueba de aislamiento la corrí **impersonando el rol de PostgREST dentro de Postgres** (`set local role authenticated` + `request.jwt.claims`), que es el mismo mecanismo que evalúan las policies. Es evidencia de comportamiento válida y auto-verificada (30 tablas de control dieron 0), pero **no es un login por HTTP de punta a punta**. Un bug que viva entre el gateway de Supabase y Postgres no lo habría visto.
2. **El escaneo de secretos vale para un build de 5 días atrás.** El `.next/` es del 3-ago; el commit es del 8-ago. Habría que reconstruir y re-escanear.
3. **No probé el escenario multidominio real**, porque no existe: los dos dominios no apuntan a la app. Todo lo de resolución de tenant por Host está verificado **leyendo y trazando el código**, no ejerciendo dos hosts distintos contra el despliegue.
4. **No verifiqué el TRUNCATE ejecutándolo** — obviamente. El GRANT está probado documentalmente y la ausencia de camino HTTP también (0 funciones con SQL dinámico), pero "no encontré camino" no es "no existe camino".
5. **La medición de consultas sin filtro de tenant en la app (~130) es INDICIO**, no VERIFICADO: sale de contar cadenas `.from(tabla)` sin `.eq("tenant_id")` cerca, y sobreestima, porque muchas están legítimamente acotadas por `.eq("id", user.id)`. Los 3 casos de las páginas de detalle sí están leídos y trazados uno por uno.
6. **No hice pentest ofensivo** (fuzzing, cadenas de exploits, XSS almacenado real contra la CSP). Blindaje es la puerta previa, no un red team. Con `unsafe-inline` en `script-src`, un XSS almacenado sería ejecutable: si el presupuesto lo permite, ese es el ejercicio que sigue.
7. **No validé el contenido jurídico de los textos legales** — solo que existan, estén enlazados, tengan fecha y que lo que prometen (retención, cookies, borrado) coincida con lo que el sistema hace. Si son *suficientes* para las jurisdicciones donde opera cada tenant es pregunta de abogado, y el propio repo marca el documento de marketplace como borrador.
8. **`assistant_queries` y el flujo de Stripe end-to-end no se ejercieron con tráfico real** — el asistente devuelve 503 sin `ANTHROPIC_API_KEY`, que hoy no está configurada.

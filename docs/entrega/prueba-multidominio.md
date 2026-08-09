# Prueba técnica multidominio — evidencia de ejecución

**Criterio de aprobación contractual.** El pliego lo exige dos veces: **Fase 1 §2** (prueba con un dominio temporal) y **Fase 4 §8** (verificación antes del pago final). Este documento registra la corrida real: qué se probó, con qué comando exacto, qué devolvió, y si pasa o no.

| | |
|---|---|
| **Fecha de ejecución** | 2026-08-09, 02:12–02:40 UTC |
| **Base de datos** | Supabase `ktmbtpuhqqofdkisqseq` (Postgres 17) — la misma que usa producción |
| **App** | Next.js 16.2.12, servidor local levantado desde el mismo repo (`npm run dev`) |
| **Tenant de prueba** | `pruebapliego` — "Prueba Pliego", `019fe44b-1b3e-731d-8cfc-8dd5ec0e632b`, marca `#7A2E8E` |
| **Tenants reales** | `dominicanos` (`019f39cf-5115-…`) y `comunidadlatina` (`019f39cf-55e8-…`) — **no se modificó ni un dato de ninguno de los dos** |
| **Estado final** | Tenant de prueba **borrado y verificado por base** (§4) |

> **Vigencia de esta evidencia.** Es una foto del sistema a la hora indicada. Mientras corría, otros frentes de trabajo estaban aplicando cambios a la misma base (llegaron tablas y migraciones nuevas entre el inicio y el cierre — ver §4). **Cualquier cambio posterior a las políticas de datos, a las funciones de administración o a la resolución de dominios obliga a repetir esta prueba antes de presentarla como aprobación.** El §5 explica cómo repetirla completa.

## Regla que se siguió

**Leer una política no es probarla.** Ninguna fila de este informe dice PASA porque el código "parezca" correcto. Cada aislamiento se probó con un token real de un tenant consultando datos del otro, y cada resultado "0 filas" se validó contra una contraparte que **sí tiene filas** — si no, "vacío" y "protegido" se ven igual y no prueban nada.

### Las tres identidades usadas

| Identidad | Rol | Comunidad | Para qué |
|---|---|---|---|
| `admin@pruebapliego.test` | `domain_admin` | pruebapliego | Administrador local del tenant de prueba |
| `carlos@demo.comunidadlatina.com` | `domain_admin` | dominicanos | Administrador local de la comunidad principal |
| `geovanny@demo.comunidadlatina.com` | `global_admin` | — | Super Admin |

Los tres tokens se obtuvieron con login real contra `/auth/v1/token?grant_type=password`, y se verificó el contenido del JWT antes de usarlos:

```
{"sub":"53c3e51a-…","role":"domain_admin","tenant":"019fe44b-1b3e-731d-8cfc-8dd5ec0e632b"}   # pruebapliego
{"sub":"de5520a5-…","role":"domain_admin","tenant":"019f39cf-5115-70bf-8a9e-8db074bf07d6"}   # dominicanos
{"sub":"c7a5f356-…","role":"global_admin","tenant":"019f39cf-55e8-7bcc-a66a-2737ff672b16"}   # super admin
```

---

## Veredicto general

**15 de 17 puntos PASAN. 2 puntos NO PASAN**, los dos por la misma causa única.

> **La causa única:** el contenido **publicado** y las **fichas públicas** (perfil, score, directorio de creadores, checks del Escudo) se leen **entre comunidades** por la API de datos. No es un descuido: está escrito y justificado en las migraciones como decisión de SEO y de producto (`0004_listings.sql`, `0003_profiles_trust.sql`, `0005_escudo.sql`, `0056_…sql`). Pero el pliego pide "información completamente separada" y "ningún acceso cruzado" **sin excepciones**, y hoy esa excepción existe. Es una decisión que el cliente tiene que tomar explícitamente, no algo que este informe pueda dar por aprobado. Detalle y arreglo exacto en §3.

Todo lo demás —usuarios, administradores, mensajes privados, datos personales, archivos, ingresos, configuración, permisos de administración, alta y baja de dominios— **está aislado y probado**.

---

## 1. Fase 1 §2 — Prueba con tenant temporal

### 1. Separación de usuarios — **PASA**

Se probó que el administrador de una comunidad no ve los usuarios ni los permisos de la otra, en las tablas que gobiernan la identidad.

```bash
# Token del domain_admin de pruebapliego, pidiendo los roles de dominicanos
curl -s "$URL/rest/v1/user_roles?select=profile_id&tenant_id=eq.019f39cf-5115-70bf-8a9e-8db074bf07d6" \
     -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_PRUEBAPLIEGO"
```

| Consulta | Filas reales del otro lado | Devolvió | |
|---|---|---|---|
| `user_roles` de dominicanos, con token de pruebapliego | 16 | `[]` | Aislada |
| `conversations` de dominicanos | 6 | `[]` | Aislada |
| `messages` de dominicanos | 6 | `[]` | Aislada |
| `notifications` de dominicanos | 15 | `[]` | Aislada |
| `notification_prefs` de dominicanos | 2 | `[]` | Aislada |
| `follows` de dominicanos | 21 | `[]` | Aislada |
| `user_roles` de pruebapliego, con token de dominicanos | 1 | `[]` | Aislada |

**Control positivo (para que el `[]` signifique algo):** con el mismo token, `user_roles` del propio tenant devuelve su fila, y `admin_metrics_overview` del propio tenant devuelve datos. El `[]` es un bloqueo real, no una tabla vacía.

**Salvedad, no bloqueante:** la **ficha pública** de un perfil (nombre visible, bio, foto, país) sí se lee entre comunidades — ver §3. El *padrón* de usuarios (quién pertenece a qué comunidad, con qué permisos) está separado; la *tarjeta pública* de una persona, no.

### 2. Separación de administradores — **PASA**

Cada comunidad tiene su propio `domain_admin`, y los permisos no cruzan. Probado sobre las RPC de administración, que son el camino real por el que un administrador actúa (no la UI):

```bash
curl -s -X POST "$URL/rest/v1/rpc/admin_ban_user" -H "Authorization: Bearer $TOKEN_PRUEBAPLIEGO" \
  -H "Content-Type: application/json" \
  -d '{"p_profile_id":"1bc91444-…(usuario de dominicanos)","p_reason":"prueba pliego"}'
```

| Acción intentada (cruzada) | Resultado literal | |
|---|---|---|
| `admin_ban_user` sobre usuario de la otra comunidad | `PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.` (HTTP 400) | Bloqueado |
| `admin_suspend_user` cruzado | `PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.` | Bloqueado |
| `admin_restrict_user` cruzado (con scope válido) | `PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.` | Bloqueado |
| `admin_reactivate_user` cruzado | `PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.` | Bloqueado |
| `admin_metrics_overview` de la otra comunidad | `FORBIDDEN: solo podés ver los números de tu comunidad.` (HTTP 403) | Bloqueado |
| `admin_revenue_summary` de la otra comunidad | `[]` | Bloqueado (ver abajo) |

El `[]` de ingresos se validó de forma inequívoca: se sembró un cobro de prueba (12.345 centavos) **en pruebapliego**, y entonces

- el admin de pruebapliego lo ve: `[{"tenant_id":"019fe44b-…","net_cents":12345,"payments":1,…}]`
- el admin de dominicanos pidiendo **ese mismo tenant** sigue recibiendo `[]`
- el Super Admin sí lo ve.

Probado en las dos direcciones. Ningún administrador local pudo tocar ni ver la otra comunidad.

### 3. Separación de publicaciones — **NO PASA**

Este es el punto de la excepción documentada. Con el token del administrador de una comunidad se leen las publicaciones **publicadas** de la otra:

```bash
curl -s "$URL/rest/v1/posts?select=id&tenant_id=eq.019f39cf-5115-…&limit=3" \
     -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_PRUEBAPLIEGO"
```

Resultado literal: **devuelve las publicaciones de dominicanos** (`[{"id":"019f39fa-b3b1-7294-…"}, …]`, HTTP 200). Lo mismo al revés: el administrador de dominicanos lee el post de bienvenida de pruebapliego. Y sin ninguna sesión (sólo la clave pública), también:

```bash
curl -s "$URL/rest/v1/posts?select=id,body&tenant_id=eq.019fe44b-…" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# → [{"id":"019fe44b-2624-…","body":"¡Bienvenidos a Prueba Pliego! …"}]
```

Alcance exacto y arreglo: §3. **Aclaración importante:** en la aplicación esto **no se ve** — el feed, el marketplace y los listados filtran por comunidad, y ningún usuario navegando encuentra contenido de otra comunidad. La lectura cruzada requiere consultar la API de datos a mano.

### 4. Separación de configuraciones — **PASA**

Cada comunidad tiene su propia configuración en su fila, y la app la respeta en vivo.

```sql
select slug, brand_hex, locale, currency, country_focus, city_seed, modules from public.tenants;
```

| slug | brand_hex | país | ciudad semilla | módulo `empleos` |
|---|---|---|---|---|
| `dominicanos` | `#1A5EDB` | DO | Queens, NY | `true` |
| `comunidadlatina` | `#C2410C` | — | New York, NY | `true` |
| `pruebapliego` | `#7A2E8E` | CO | Miami, FL | `true` → se apagó |

Prueba en vivo: se apagó **sólo** el módulo `empleos` de `pruebapliego` y se midió la app real hasta que la caché de comunidad (5 minutos) expiró.

```
MODULO OFF T0 = 02:31:18
02:31:18  /empleos pruebapliego=200  dominicanos=200
02:32:13  /empleos pruebapliego=200  dominicanos=200
02:33:06  /empleos pruebapliego=200  dominicanos=200
02:34:00  /empleos pruebapliego=200  dominicanos=200
02:34:53  /empleos pruebapliego=200  dominicanos=200
02:35:45  /empleos pruebapliego=200  dominicanos=200
02:36:38  /empleos pruebapliego=404  dominicanos=200   ← cambio efectivo (T0 + 5 min)
02:37:32  /empleos pruebapliego=404  dominicanos=200
```

Al expirar la caché, **la sección Empleos desapareció sólo de la comunidad de prueba** (404) y siguió funcionando normal en la comunidad principal (200) durante las ocho mediciones. La configuración es por comunidad y no se contagia.

También se probó que ningún administrador local puede editar la configuración del otro: `PATCH /tenants?id=eq.<el otro>` con `{"brand_hex":"#000000"}` devolvió `200 []` (cero filas afectadas) en las dos direcciones, y por base el `brand_hex` de cada tenant quedó intacto (`#7A2E8E` y `#1A5EDB`).

### 5. Separación de archivos y datos — **PASA**

**Archivos.** Se subió un archivo canario a la carpeta de `pruebapliego` en cada bucket y se intentó enumerarla con el token de la otra comunidad:

```bash
curl -s -X POST "$URL/storage/v1/object/list/tenant-assets" -H "Authorization: Bearer $TOKEN_DOMINICANOS" \
  -H "Content-Type: application/json" -d '{"prefix":"019fe44b-…/","limit":20}'
```

| Bucket | Enumerar carpeta ajena | |
|---|---|---|
| `tenant-assets` | `[]` | Aislado |
| `job-cvs` (CVs — privado) | `[]` | Aislado |
| `post-media` | `[]` | Aislado |
| `listing-photos` | `[]` | Aislado |
| `avatars` | `[]` | Aislado |

**Control positivo:** el mismo token enumerando **su propia** carpeta de `listing-photos` devuelve archivos reales. El `[]` es bloqueo.

Descarga directa del CV de la otra comunidad (bucket privado), con token y sin token: `{"statusCode":"404","error":"not_found","code":"NoSuchKey"}` y `Bucket not found`. **Aislado.**

**Salvedad conocida, no bloqueante:** los buckets `avatars`, `listing-photos`, `post-media` y `tenant-assets` son públicos por diseño (la app arma URLs públicas para mostrar imágenes). Quien tenga la URL exacta descarga el archivo sin sesión — se comprobó (`HTTP 200`). No permite descubrir archivos ajenos (la enumeración está cerrada, y las rutas son UUID), pero conviene que el cliente lo sepa: **una foto pública es pública para todo internet, no sólo para su comunidad**. Los CVs, que son el dato sensible, están en el único bucket privado y sí están cerrados.

**Datos.** Barrido completo, no una muestra: se recorrieron **las 43 tablas que tienen filas reales en `dominicanos`**, consultándolas con el token del administrador de `pruebapliego`. Como la contraparte tiene filas, cada `[]` es un bloqueo comprobado.

**30 tablas devolvieron 0 filas (aisladas):**
`assistant_queries`, `audit_log`, `broadcast_targets`, `business_accounts`, `business_members`, `conversations`, `cta_clicks`, `follows`, `gig_applications`, `gig_contracts`, `job_applications`, `listing_private_details`, `listing_shares`, `listing_views`, `messages`, `moderation_queue`, `notification_prefs`, `notifications`, `post_poll_votes`, `post_promotions`, `post_views`, `profiles_private`, `rag_chunks`, `reactions`, `saves`, `scam_reports`, `score_history`, `tenant_price_history`, `tenant_prices`, `user_roles`.

Entre ellas están **todas las que tienen datos personales o privados**: `profiles_private` (apellido, fecha de nacimiento, ciudad), `listing_private_details` (contacto de los avisos), `messages` y `conversations` (mensajería), `job_applications` (postulaciones), `moderation_queue` y `audit_log`.

A esas 30 se suma **`payment_events`** (movimientos de dinero), probada aparte porque en la comunidad principal está vacía: con el cobro canario sembrado en la comunidad de prueba, la consulta por API devolvió `[]` incluso **para el propio dueño** — esa tabla sólo se lee por las RPC de ingresos, que ya se probaron aisladas.

**13 tablas devolvieron datos de la otra comunidad** — ver §3.

### 6. Acceso del Super Admin a ambos tenants — **PASA**

```bash
curl -s "$URL/rest/v1/posts?select=id&tenant_id=eq.<cada tenant>" -H "Authorization: Bearer $TOKEN_SUPERADMIN"
```

| Consulta con token de Super Admin | Resultado |
|---|---|
| `posts` de dominicanos | 34 filas |
| `user_roles` de dominicanos | 16 filas |
| `posts` de pruebapliego | 1 fila |
| `user_roles` de pruebapliego | 1 fila |
| `admin_metrics_overview` de dominicanos | serie completa de 30 días |
| `admin_metrics_overview` de pruebapliego | serie completa de 30 días |
| `admin_revenue_summary` de pruebapliego | el cobro sembrado, `net_cents: 12345` |

Las mismas consultas con un administrador local devuelven `[]` o `FORBIDDEN`. El Super Admin ve las dos comunidades; nadie más.

### 7. Imposibilidad del administrador local de acceder al tenant de prueba — **PASA**

Es el punto más importante del pliego y se probó **en las dos direcciones**, contra escritura, borrado, administración y escalada de privilegios. Ninguna intrusión prosperó, y se verificó **por base de datos**, no por el código de respuesta.

**Escrituras cruzadas — administrador de `dominicanos` contra `pruebapliego`:**

| Intento | Resultado literal | Efecto real en la base |
|---|---|---|
| Crear una publicación en pruebapliego | `HTTP 403` · `42501 new row violates row-level security policy for table "posts"` | ninguno |
| Editar el post de bienvenida de pruebapliego | `HTTP 200 []` (0 filas) | texto intacto |
| Borrar el post de pruebapliego | `HTTP 200 []` (0 filas) | el post sigue ahí |
| Editar el perfil del admin de pruebapliego | `HTTP 200 []` (0 filas) | nombre intacto |
| Borrar los avisos de pruebapliego | `HTTP 200 []` (0 filas) | el aviso sigue ahí |
| Cambiarle la marca a pruebapliego | `HTTP 200 []` (0 filas) | `#7A2E8E` intacto |
| Darle un dominio a pruebapliego | `HTTP 403` · `42501 … tenant_domains` | ninguno |

**Escrituras cruzadas — administrador de `pruebapliego` contra `dominicanos`:** cambiar la marca, borrar publicaciones y editar perfiles → `HTTP 200 []` en los tres casos, cero filas afectadas.

**Escalada de privilegios — el administrador local intenta ascenderse:**

| Intento | Resultado literal |
|---|---|
| Ponerse `role = global_admin` en su perfil | `PROTECTED_COLUMNS: role/identity_verified/phone_verified/email_verified/tenant_id de profiles solo se modifican via service_role` |
| Cambiarse de comunidad (`tenant_id` de su perfil) | mismo bloqueo |
| Editar su fila de `user_roles` | `HTTP 200 []` (0 filas) |

**Verificación por base después de todos los intentos** (no por el HTTP):

```sql
select count(*) from public.posts where body like 'INTRUSION%';                 -- 0
select count(*) from public.profiles where bio like 'INTRUSION%';               -- 0
select count(*) from public.tenant_domains where domain='intrusion.test';       -- 0
select brand_hex from public.tenants where slug='pruebapliego';                 -- #7A2E8E
select brand_hex from public.tenants where slug='dominicanos';                  -- #1A5EDB
select count(*) from public.posts where tenant_id='019f39cf-5115-…';            -- 34 (intactos)
select display_name, role from public.profiles where id='53c3e51a-…';           -- Admin Prueba Pliego / domain_admin
```

Cero cambios. **PASA.**

---

## 2. Fase 4 §8 — Verificación antes del pago final

### 1. Branding diferente — **PASA**

Probado contra la app real, resolviendo por dominio (cabecera `Host`), sin `?t=` y sin deploy:

```bash
curl -s -H "Host: pruebapliego.test" http://localhost:3000/feed | grep -o -- '--color-brand-500:[^;]*'
```

| Dominio | Marca en la fila | Variable CSS que sirvió la app |
|---|---|---|
| `dominicanos.com` | `#1A5EDB` | `--color-brand-500:#5486e3` |
| `pruebapliego.test` | `#7A2E8E` | `--color-brand-500:#af68c2` |

La comunidad nueva se pintó con **su propia escala de color**, generada por el pipeline de marca desde un solo hex, sin tocar código.

*Nota:* `comunidadlatina.com` sirve la marca de `dominicanos` **a propósito**: `comunidadlatina` es slug reservado de marca/legal (`RESERVED_BRAND_SLUGS` en `src/lib/tenant/resolve.ts`) y nunca se sirve como comunidad pública. Por eso la comparación de este informe se hace contra `dominicanos`, que es la comunidad principal real.

### 2. Administrador diferente — **PASA**

El script creó el administrador de la comunidad nueva con permiso acotado a ella:

```
+ [create] usuario admin@pruebapliego.test (domain_admin)
+ [ok] profile + trust_score de Admin Prueba Pliego
```

Verificado en el JWT (`role: domain_admin`, `tenant: 019fe44b-…`) y en la práctica: no puede administrar la otra comunidad (Fase 1 §2 y §7 de este informe).

### 3. Usuarios diferentes — **PASA**

Padrones separados y comprobados: `dominicanos` 15 perfiles / 16 roles, `pruebapliego` 1 perfil / 1 rol, sin superposición. Ninguna de las dos ve los roles ni la mensajería de la otra (§1.1).

### 4. Contenido diferente — **PASA parcialmente** *(el aislamiento del contenido publicado es el punto 5)*

Cada comunidad tiene su propio contenido y arranca desde cero: `pruebapliego` nació con 1 post de bienvenida y 0 avisos; `dominicanos` tiene 34 posts, 64 avisos y 14 comentarios. Nada del contenido nuevo apareció en la comunidad existente, y la comunidad nueva arrancó vacía. Lo que **no** se cumple es la separación estricta a nivel API — punto 5.

### 5. Información completamente separada — **NO PASA**

Falla por la excepción de §3: 13 tablas de contenido y fichas públicas se leen entre comunidades. Todo lo privado (mensajes, datos personales, contacto de avisos, postulaciones, moderación, auditoría, ingresos, archivos) **sí** está completamente separado y probado.

### 6. Ningún acceso cruzado — **NO PASA** *(por lectura; la escritura sí pasa, sin excepción)*

| Dimensión | Estado |
|---|---|
| Escritura cruzada (crear, editar, borrar) | **Bloqueada** — 10 intentos, 0 efectos, verificado por base |
| Administración cruzada (banear, suspender, métricas, ingresos) | **Bloqueada** — 6 RPC, todas rechazadas |
| Escalada de privilegios | **Bloqueada** — trigger de columnas protegidas |
| Archivos cruzados | **Bloqueada** — 5 buckets, enumeración vacía; CV privado inaccesible |
| Lectura de datos privados | **Bloqueada** — 31 tablas, 0 filas |
| Lectura de contenido publicado y fichas públicas | **Abierta** — §3 |

### 7. Acceso del Super Admin a ambos — **PASA**

Ver Fase 1 §6. Además, sobre ingresos: el Super Admin lee los de `pruebapliego` (`net_cents: 12345`) mientras el administrador de `dominicanos` recibe `[]` para el mismo pedido.

### 8. Broadcast hacia ambos — **PASA**

Prueba completa en vivo, incluyendo quién **no** puede emitir:

```bash
# 1) Un administrador local intenta emitir
curl -s -X POST "$URL/rest/v1/broadcasts" -H "Authorization: Bearer $TOKEN_DOMAIN_ADMIN" \
  -d '{"title":"NO-DEBE-EXISTIR","body":"x","severity":"urgent","starts_at":"2026-08-01T00:00:00Z", …}'
# → HTTP 403  42501 new row violates row-level security policy for table "broadcasts"
#   (idéntico para el admin de pruebapliego y para el de dominicanos)

# 2) El Super Admin emite y apunta a LAS DOS comunidades
curl -s -X POST "$URL/rest/v1/broadcasts"        -H "Authorization: Bearer $TOKEN_SUPERADMIN" -d '{…"title":"PRUEBA-PLIEGO-BROADCAST"…}'
# → HTTP 201  id 019fe453-a8c8-7bf2-9a30-9adca804dea5
curl -s -X POST "$URL/rest/v1/broadcast_targets" -H "Authorization: Bearer $TOKEN_SUPERADMIN" \
  -d '[{"broadcast_id":"019fe453-…","tenant_id":"<dominicanos>"},{"broadcast_id":"019fe453-…","tenant_id":"<pruebapliego>"}]'
# → HTTP 201  las dos filas
```

Recepción, con el token de cada comunidad:

| Lector | Recibe |
|---|---|
| Admin de `pruebapliego` | `[{"id":"019fe453-…","title":"PRUEBA-PLIEGO-BROADCAST","severity":"urgent"}]` |
| Admin de `dominicanos` | el mismo aviso **más** el aviso previo propio de su comunidad |

Y el alcance no se filtra de más: cada comunidad ve **sólo su propia fila** de destinatarios (`broadcast_targets`), mientras el Super Admin ve las dos. Un aviso global llega a las dos comunidades sin que ninguna vea la lista completa de destinos.

### 9. Capacidad de desactivar solamente uno — **PASA**

Se apagó el dominio del tenant de prueba con el comando del runbook, midiendo la app real minuto a minuto:

```bash
node scripts/new-tenant.mjs --domain-for=pruebapliego --domain=pruebapliego.test \
     --status=suspended --notes="Prueba de pliego Fase 4 punto 9"
# → + [update] pruebapliego.test → pruebapliego · apagado (suspended)
```

```
SUSPENSION T0 = 02:25:05 UTC
02:25:31  pruebapliego.test=200  dominicanos.com=200
02:26:24  pruebapliego.test=200  dominicanos.com=200
02:27:18  pruebapliego.test=200  dominicanos.com=200
02:28:11  pruebapliego.test=200  dominicanos.com=200
02:29:03  pruebapliego.test=404  dominicanos.com=200   ← apagado efectivo (T0 + 4 min)
02:29:55  pruebapliego.test=404  dominicanos.com=200
02:30:47  pruebapliego.test=404  dominicanos.com=200
02:31:38  pruebapliego.test=404  dominicanos.com=200
```

El dominio suspendido dejó de servir a los 4 minutos (dentro de los 5 documentados como caché del proxy) y **la comunidad principal no se vio afectada ni un segundo**: 200 en las ocho mediciones. Sin deploy, sin reiniciar nada.

### 10. Agregar otro dominio sin duplicar ni reconstruir el código — **PASA**

Un solo comando, y se midió el repositorio antes y después para probar que no hubo cambio de código:

```bash
git rev-parse HEAD                 # d1a0abf225b56a622928e9f52dd2a9d4cd8d3baf
git status --porcelain | md5sum    # a6233fcbd974c3046afa71a6d0b34e74

node scripts/new-tenant.mjs --domain-for=pruebapliego --domain=pruebapliego.test
# → + [create] pruebapliego.test → pruebapliego · canónico
#   "Lo que YA NO hace falta: ninguna edición de código, ningún commit, ningún deploy."

git rev-parse HEAD                 # d1a0abf225b56a622928e9f52dd2a9d4cd8d3baf   (idéntico)
git status --porcelain | md5sum    # a6233fcbd974c3046afa71a6d0b34e74           (idéntico)
```

**Mismo commit, mismo árbol de trabajo, cero archivos tocados.**

Verificación en la base y en el resolutor de dominios:

```sql
select (select row_to_json(r) from public.resolve_tenant_domain('pruebapliego.test') r);
-- {"tenant_id":"019fe44b-…","tenant_slug":"pruebapliego","tenant_name":"Prueba Pliego",
--  "matched_domain":"pruebapliego.test","is_primary":true,"primary_domain":"pruebapliego.test"}

select (select row_to_json(r) from public.resolve_tenant_domain('inexistente.test') r);  -- NULL
```

Y en la app real, sirviendo por ese dominio con su propia marca: `Host: pruebapliego.test` → `HTTP 200` con `--color-brand-500:#af68c2`. Un dominio desconocido → `HTTP 404`.

**Lo que sí queda a mano**, y es correcto que quede (son paneles de terceros, no código): registrar el dominio, apuntar el DNS y agregarlo en Vercel para que emita el certificado. Eso no lo puede hacer ningún script.

---

## 3. Lo que NO pasa, con nombre y apellido

### El hallazgo

Con un token de cualquier comunidad —o incluso **sin sesión**, sólo con la clave pública del cliente— se pueden leer, por la API de datos, el contenido **publicado** y las **fichas públicas** de todas las comunidades a la vez.

Barrido completo de las 43 tablas con datos: **13 devolvieron filas ajenas.**

| Tabla | Qué expone | Regla que lo permite |
|---|---|---|
| `posts` | publicaciones publicadas | `status = 'published'` sin filtro de comunidad |
| `listings` | avisos publicados | ídem |
| `comments` | comentarios publicados | ídem |
| `listing_comments` | comentarios de avisos publicados | ídem |
| `guides` | guías publicadas | ídem |
| `gig_reviews` | reseñas visibles | `visible = true` sin filtro de comunidad |
| `profiles` | ficha pública: nombre, bio, país, zona — y para usuarios logueados también `role`, `account_status`, `suspended_until` | `using (true)` |
| `trust_scores` | Trust Score y sus factores | `using (true)` |
| `creator_profiles` | directorio de creadores | `using (true)` |
| `creator_scores` | score de creadores | `using (true)` |
| `business_scores` | score de negocios | `using (true)` |
| `verification_checks` | checks del Escudo (verificaciones de licencia) | `using (true)` |
| `tenant_domains` | el mapa dominio → comunidad, legible sin sesión | `using (true)` |

### No es un accidente — está escrito en el código

- `supabase/migrations/0004_listings.sql:70` — *"Público: SOLO published (anon+auth, cross-tenant por diseño SEO — la app filtra tenant por query)."*
- `supabase/migrations/0003_profiles_trust.sql:87` — *"Perfil = contenido público (contrato: perfiles públicos legibles por anon/auth)."*
- `supabase/migrations/0005_escudo.sql:42` — *"Transparencia: cualquiera puede leer los checks (parte del producto de confianza)."*
- `supabase/migrations/0002_tenants.sql:83` — *"SELECT público de solo-lectura: mapping dominio→tenant es información pública (necesaria antes de cualquier sesión)."*
- `supabase/migrations/0056_aislamiento_storage_definers_indices.sql:11` — lo deja **explícitamente reportado y no aplicado**, con el motivo: *"Cerrarlo dejaría el sitio público en blanco para anon, porque `app.current_tenant_id()` es NULL sin sesión y la app no empuja el tenant a la sesión de Postgres."*

Dos de esas trece (`business_scores` y `creator_scores`) **no** tienen comentario de diseño propio; heredan el patrón de `trust_scores` y `creator_profiles` sin decisión escrita. Conviene documentarlas o cerrarlas.

### Por qué igual figura como NO PASA

El pliego pide "**información completamente separada**" y "**ningún acceso cruzado**", sin excepción. Hoy la excepción existe y es verificable en 30 segundos con `curl`. Un informe que la omitiera se caería en la primera auditoría. La decisión de aceptarla o cerrarla es del cliente, no de este documento.

### Qué falta para cerrarlo

El arreglo no es una línea: la razón por la que está abierto es real. Hoy la comunidad se resuelve en el proxy de Next.js y **no viaja a la sesión de Postgres**, así que sin sesión `app.current_tenant_id()` es `NULL` y una política que exija `tenant_id = app.current_tenant_id()` dejaría el sitio público vacío para visitantes sin cuenta. Hay dos caminos:

1. **Empujar la comunidad a la sesión de Postgres.** Que el cliente de Supabase del servidor mande la comunidad resuelta en cada request (`set_config('request.tenant_id', …)` o un claim en un token de invitado), y recién entonces cambiar las políticas a `status = 'published' AND tenant_id = app.current_tenant_id()`. Es el arreglo correcto y de fondo; toca la capa de datos completa y **hay que volver a correr esta prueba entera después**.
2. **Aceptarlo por escrito.** Dejar constancia firmada de que el contenido publicado y las fichas públicas son deliberadamente globales (es lo que permite que una publicación de la comunidad se indexe en Google) y que la separación contractual aplica a datos privados, de administración y de negocio. Costo: cero. Requisito: que el cliente lo entienda y lo firme.

Como acción mínima e independiente del camino elegido, y de bajo costo:

- **`tenant_domains`**: hoy cualquiera lista todas las comunidades y sus dominios sin sesión. Sólo hace falta que sea legible el dominio que se está resolviendo, no el catálogo completo. Cerrarlo a `service_role` + la RPC `resolve_tenant_domain` (que ya existe y ya es `SECURITY DEFINER`) no rompe nada.
- **`profiles`**: para usuarios logueados expone `role`, `account_status` y `suspended_until` de cualquier persona de cualquier comunidad. Eso no es "ficha pública", es estado de moderación. La migración `0058` ya hizo este trabajo por columna para `anon`; falta hacer lo mismo para `authenticated`.

### Un detalle menor encontrado de paso — no bloquea

`admin_lift_restriction` (levantar una restricción a un usuario) es el único de los seis RPC de administración que **no rechaza** una llamada cruzada: devuelve `HTTP 204` como si hubiera funcionado.

No es una fuga: se verificó por base que **no levantó ninguna restricción de la otra comunidad** (el `update` interno sí filtra por comunidad, y `dominicanos` siguió con 0 restricciones levantadas y el usuario objetivo intacto). Pero el `insert` en el registro de sanciones corre igual, sin comprobar antes que el perfil pertenezca a la comunidad de quien llama. Efecto real: un administrador puede ensuciar **su propio** registro de auditoría con filas que apuntan a personas de otra comunidad. Se comprobó: quedó 1 fila así.

Arreglo: agregar la misma comprobación de pertenencia que ya tienen sus cinco hermanas (`PROFILE_NOT_FOUND`) al principio de la función. Es una línea, y conviene hacerlo porque un registro de auditoría con datos imposibles es un registro en el que después nadie confía.

---

## 4. Limpieza del tenant de prueba

Borrado con el comando del runbook:

```bash
node scripts/new-tenant.mjs --delete=pruebapliego --yes-i-am-sure
```

**Primer intento — el script se frenó solo, como corresponde:**

```
+ [delete] usuario Admin Prueba Pliego (cascadea profile + trust_score)
+ [delete] 1 post(s)

✘ "pruebapliego" todavía tiene contenido que este script no borra.
  update or delete on table "tenants" violates foreign key constraint "payment_events_tenant_id_fkey"
  Revisá qué queda … y borralo a mano antes de reintentar — a propósito este script NO
  cascadea contenido que no creó él mismo.
```

Es el comportamiento correcto y vale como evidencia por sí solo: quedaban las filas canario que esta prueba sembró a mano (el cobro de prueba, el aviso, la sanción y el destinatario del broadcast). **El script prefiere frenarse antes que llevarse puesto contenido que no creó.** Se limpiaron esas filas de prueba y se reintentó:

```
+ [delete] tenant pruebapliego (+ su dominio, por cascada)
✔ "pruebapliego" borrado.
```

**Verificación por base de datos, no por la app** — la marca de cada comunidad se cachea 5 minutos, así que recién borrada puede seguir "viéndose" en la aplicación aunque ya no exista:

| Comprobación | Resultado |
|---|---|
| `tenants` con slug `pruebapliego` | **0** |
| `tenant_domains` con `pruebapliego.test` | **0** |
| `auth.users` con `admin@pruebapliego.test` | **0** |
| `profiles` / `posts` / `listings` del tenant borrado | **0 / 0 / 0** |
| Broadcast de prueba | **0** |
| Objetos de Storage del tenant | **0** |
| `resolve_tenant_domain('pruebapliego.test')` | **NULL** (ya no resuelve) |
| **Comunidades que quedan** | **`comunidadlatina`, `dominicanos`** |

**Los tenants reales quedaron intactos**, comprobado contra los valores del inicio de la prueba: `dominicanos` con 34 publicaciones, 64 avisos y 15 perfiles; `resolve_tenant_domain('dominicanos.com')` → `dominicanos`; marcas `#1A5EDB` y `#C2410C` sin cambios.

El script **se niega a borrar `dominicanos` y `comunidadlatina`** a propósito. No se intentó forzar ese bloqueo.

**Gate de RLS después de todo el ciclo** (alta, pruebas, dominios, apagado y borrado):

```
$ RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1 npm run check:rls
✔ GATE VERDE: 79 superficies auditadas, aislamiento completo.
```

(Al iniciar la prueba el gate reportaba 77 superficies; al cerrar, 79. La diferencia son dos tablas nuevas — `tenant_prices` y `tenant_price_history` — que otro frente de trabajo agregó mientras esta prueba corría. Nacieron con su protección completa.)

---

## 5. Cómo repetir esta prueba

Cualquiera con acceso al repositorio y a `.env.local` puede reproducirla completa. Toma unos 25 minutos, la mayoría esperando cachés.

### Preparación

```bash
cd <raíz del repo>
export URL=$NEXT_PUBLIC_SUPABASE_URL
export ANON=$NEXT_PUBLIC_SUPABASE_ANON_KEY   # clave pública: es segura de usar, sirve para probar qué ve un visitante

login() {  # $1=email  $2=password  → imprime el token
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
       -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}"
}
```

> En PowerShell, `Invoke-RestMethod` rompe la cabecera `Bearer` y devuelve 401 falsos. Usar `curl` desde Git Bash o WSL.

### 1. Crear la comunidad de prueba

```bash
node scripts/new-tenant.mjs --slug=pruebapliego --name="Prueba Pliego" --hex=#7A2E8E \
  --admin-email=admin@pruebapliego.test --admin-name="Admin Prueba Pliego" \
  --city="Miami, FL" --country=CO --admin-password='<elegí una>'
```

Guardar el `tenant_id` que imprime. Probar primero con `--dry-run` si se quiere validar el color sin escribir nada.

### 2. Conseguir los tres tokens

Uno por identidad: el admin recién creado, un `domain_admin` de la comunidad principal y el `global_admin`. Verificar siempre lo que dice el token antes de confiar en él:

```bash
node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));
         console.log(p.app_metadata.role, p.app_metadata.tenant_id)' "$TOKEN"
```

### 3. Probar el aislamiento de lectura

```bash
curl -s "$URL/rest/v1/<tabla>?select=tenant_id&tenant_id=eq.<ID DE LA OTRA COMUNIDAD>&limit=5" \
     -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"
```

**Cómo leer el resultado — acá es donde casi todo el mundo se equivoca:**

- `[]` **sólo prueba aislamiento si la otra comunidad tiene filas en esa tabla.** Verificarlo antes con `select count(*) from <tabla> where tenant_id = '<la otra>'`. Si da 0, el `[]` no prueba nada.
- Que devuelva filas de la otra comunidad es **fuga confirmada**, sin ambigüedad.
- Hacer siempre el **control positivo**: la misma consulta contra la comunidad propia tiene que devolver datos. Si también da `[]`, algo está mal en el token, no en la política.

### 4. Probar el aislamiento de escritura

```bash
curl -s -X PATCH "$URL/rest/v1/posts?id=eq.<post de la otra comunidad>" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" -d '{"body":"INTRUSION-TEST"}'
```

- `403` con `42501` → la política rechazó. Bloqueado.
- `200 []` → cero filas afectadas: la política filtró el objetivo. **También es bloqueo, pero hay que confirmarlo por base** (`select … where body like 'INTRUSION%'` tiene que dar 0).
- `400` por columna faltante o restricción `check` **no es** bloqueo de seguridad: es el payload mal armado. Corregir el payload y repetir, si no la prueba no vale.

### 5. Probar las RPC de administración

```bash
curl -s -X POST "$URL/rest/v1/rpc/admin_metrics_overview" -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_tenant_id":"<LA OTRA COMUNIDAD>","p_days":30}'
# esperado: FORBIDDEN: solo podés ver los números de tu comunidad.
```

Repetir con `admin_ban_user`, `admin_suspend_user`, `admin_restrict_user` (scope válido: `social`, `marketplace`, `pagos`, `publicidad`, `total`) y `admin_revenue_summary`.

### 6. Probar los archivos

```bash
curl -s -X POST "$URL/storage/v1/object/list/<bucket>" -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prefix":"<ID DE LA OTRA COMUNIDAD>/","limit":20}'
```

Buckets: `avatars`, `listing-photos`, `post-media`, `tenant-assets`, `job-cvs`. Control positivo con la carpeta propia.

### 7. Probar dominio y apagado

```bash
node scripts/new-tenant.mjs --domain-for=pruebapliego --domain=<host de prueba>
# verificar: select public.resolve_tenant_domain('<host>');

npm run dev
curl -s -H "Host: <host de prueba>" http://localhost:3000/feed | grep -o -- '--color-brand-500:[^;]*'

node scripts/new-tenant.mjs --domain-for=pruebapliego --domain=<host> --status=suspended
# volver a medir cada minuto durante 6: el host de prueba pasa a 404, el principal sigue en 200
```

**La caché es real y hay que respetarla:** hasta 1 minuto para que un dominio nuevo resuelva, hasta 5 para que uno apagado deje de resolver, y 5 minutos para la marca y los módulos de una comunidad. Medir antes de tiempo da falsos negativos.

### 8. Correr el enumerador del repositorio

```bash
npm run check:rls
# si falla por TLS en tu red:
RLS_ENUMERATOR_ALLOW_INSECURE_TLS=1 npm run check:rls
```

Tiene que terminar en verde. En esta corrida: `GATE VERDE: 77 superficies auditadas, aislamiento completo.` Ese gate verifica que **exista** la protección en cada tabla y bucket; **no** evalúa si la regla dice lo correcto. Por eso hace falta también todo lo de arriba: una tabla con protección activa y regla `using(true)` pasa el gate y filtra igual.

### 9. Borrar y verificar

```bash
node scripts/new-tenant.mjs --delete=pruebapliego --yes-i-am-sure
```

```sql
select count(*) from public.tenants        where slug = 'pruebapliego';   -- 0
select count(*) from public.tenant_domains where domain = '<host>';       -- 0
select count(*) from auth.users            where email = 'admin@pruebapliego.test'; -- 0
```

**Verificar por la base, nunca por la aplicación.** Recién borrada, la comunidad puede seguir apareciendo en la app hasta 5 minutos por la caché de marca —incluso en una pestaña nueva y con el servidor reiniciado, porque esa caché vive en disco (`.next/cache`)—. La app mintiendo no significa que el borrado falló.

Si el script se frena porque quedó contenido que no reconoce, dice exactamente qué falta limpiar. Es intencional: prefiere frenarse antes que llevarse puesto algo real.

---

## 6. Qué queda pendiente de un gate humano

Este informe cubre lo que se puede ejecutar y medir. Queda fuera de su alcance, y sigue vigente:

| Pendiente | Por qué no lo cubre este informe |
|---|---|
| **Decisión del cliente sobre §3** | Es una decisión de negocio (SEO e indexación vs. separación estricta), no técnica. Hasta que se resuelva, los puntos 3 de Fase 1 y 5–6 de Fase 4 quedan en NO PASA. |
| **Recorrido de la interfaz de administración** | Se probaron los permisos en la capa de datos, que es la barrera real. Que `/admin/dominio` y `/admin/global` muestren exactamente lo que corresponde a cada rol se verifica a ojo, con una sesión de navegador. |
| **Dominio propio en producción** | La prueba corrió contra un servidor local con la cabecera `Host`. Registrar el dominio, apuntar el DNS y que Vercel emita el certificado son pasos en paneles de terceros. |
| **Pentest y firma senior** | El gate humano del plan maestro (§5.2, §14.4), previo al primer dato real de un usuario. Sigue vigente. |
| **Variables de entorno de producción** | Fuera de alcance. Se revisa con `node scripts/vercel-env-sync.mjs`: sin `RESEND_API_KEY` la comunidad nueva no manda ni un correo; sin `GOOGLE_VISION_API_KEY` toda foto queda en revisión manual. Ninguna de las dos rompe la app, pero la dejan a medias sin que se note. |

---

## Resumen por punto

### Fase 1 §2

| # | Punto | Veredicto |
|---|---|---|
| 1 | Separación de usuarios | **PASA** |
| 2 | Separación de administradores | **PASA** |
| 3 | Separación de publicaciones | **NO PASA** — contenido publicado legible entre comunidades (§3) |
| 4 | Separación de configuraciones | **PASA** |
| 5 | Separación de archivos y datos | **PASA** |
| 6 | Acceso del Super Admin a ambos | **PASA** |
| 7 | Imposibilidad del administrador local de acceder al tenant de prueba | **PASA** |

### Fase 4 §8

| # | Punto | Veredicto |
|---|---|---|
| 1 | Branding diferente | **PASA** |
| 2 | Administrador diferente | **PASA** |
| 3 | Usuarios diferentes | **PASA** |
| 4 | Contenido diferente | **PASA** (con la salvedad del punto 5) |
| 5 | Información completamente separada | **NO PASA** (§3) |
| 6 | Ningún acceso cruzado | **NO PASA** por lectura; escritura y administración **sin excepción** bloqueadas |
| 7 | Acceso del Super Admin a ambos | **PASA** |
| 8 | Broadcast hacia ambos | **PASA** |
| 9 | Capacidad de desactivar solamente uno | **PASA** |
| 10 | Agregar otro dominio sin duplicar ni reconstruir el código | **PASA** |

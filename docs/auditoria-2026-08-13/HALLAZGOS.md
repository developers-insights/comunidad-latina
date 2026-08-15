# Auditoría completa — 2026-08-13

Barrido de los ~1.035 archivos de `src/` (193k líneas) y las 104 migraciones, en
cinco frentes paralelos: seguridad/multi-tenant, escalabilidad/datos, robustez,
arquitectura y frontend. Todo lo listado fue **leído en el archivo**, no inferido.

Estado del árbol al empezar: typecheck limpio, lint sin errores, **88 tests
rojos**. Ver «Ya arreglado» al final.

---

## Lo que NO se puede arreglar desde el código — decisión de Manuel

Estos cuatro no son cambios de código. Tres tocan producción y uno es una
decisión de infraestructura. **No se aplicó ninguno.**

### S1 · [CRÍTICO] La base de datos está compartida con otro producto

El proyecto Supabase `ktmbtpuhqqofdkisqseq` aloja Comunidad Latina **y**
`vibecoder-copilot`/caughtcode: mismo schema `public`, mismo PostgREST, mismo
GoTrue y **las mismas claves `anon` y `service_role`**. Hay 30+ tablas
`*_caughtcode` y 14 RPCs `SECURITY DEFINER` con `EXECUTE` a `authenticated`,
entre ellas `delete_account_caughtcode(uuid)`.

El `SUPABASE_SERVICE_ROLE_KEY` del webhook de Stripe de Comunidad Latina es,
literalmente, la llave maestra de los datos de caughtcode, y al revés. Una
filtración en un deploy, un log o un preview compromete **los dos productos a la
vez**. Las policies de caughtcode hoy aguantan un JWT de un vecino de acá (se
verificaron las 34), pero la superficie está unida y ninguna de las dos partes la
revisa cuando toca la suya.

**No es un problema de RLS: es que la frontera de credenciales no existe.**
Separar en dos proyectos. Si no es viable ahora: un schema por producto, revocar
los `EXECUTE` cruzados, rotar claves junto con la separación.

### S2 · [CRÍTICO] `anon` y `authenticated` tienen `TRUNCATE` sobre 74 y 81 tablas

`supabase/migrations/0085_restaurar_grants_de_la_api.sql:55-75` restauró
`GRANT ALL` tras el incidente de grants borrados. `ALL` incluye `TRUNCATE`, y
**`TRUNCATE` no pasa por RLS** — RLS filtra filas en SELECT/INSERT/UPDATE/DELETE,
no en TRUNCATE. Lo único que hoy lo frena es que PostgREST no expone ese verbo.
El propio `0091:618-619` lo dejó anotado como abierto.

Cualquier camino que llegue a ejecutar SQL como `anon`/`authenticated` vacía
`profiles`, `posts` o `payment_events` sin policy que lo pare, sin auditoría y
sin vuelta atrás. Mitigante verificado: esos roles **no** tienen `CREATE` en
`public`, así que no pueden crear la función que necesitarían.

```sql
revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;
```
Y cambiar el `GRANT ALL` de 0085 por `select, insert, update, delete`.

### S3 · [ALTO] Un visitante sin sesión lee el padrón completo de todas las comunidades

`0091_lectura_no_cruza_comunidades.sql:154-162`: la policy `profiles_select` abre
incondicionalmente para anónimos, **sin filtro de tenant**. La `anon key` es
pública por diseño — va en el bundle del browser.

```
GET https://<ref>.supabase.co/rest/v1/profiles?select=*&limit=1000
```
devuelve, sin cuenta y sin rate limit, el directorio entero de miembros de
**todas** las comunidades, con `area_label` (zona/barrio) y `country_origin`.
Hoy son 17 filas; escala lineal con el producto. Es exactamente el honeypot que
la doctrina del propio repo dice evitar: un listado descargable de migrantes con
dónde viven y de dónde vienen. Mismo patrón en `trust_scores`,
`creator_profiles`, `verification_checks`, `creator_service_packages`,
`gig_reviews`; y `listing_review_stats_select` es directamente `using (true)`.

El comentario de 0091 justifica la rama diciendo «sin JWT no hay tenant que
comparar». Es cierto, pero la conclusión correcta no es abrir la tabla: es no
exponerla a `anon`. Servir el perfil público por `profile_card()`, que ya existe,
ya es `SECURITY DEFINER` y ya tiene la guarda de tenant.

### S4 · [ALTO] Un miembro común puede enumerar quiénes son staff y quiénes están sancionados

`authenticated` tiene `SELECT` sobre las columnas `role`, `account_status`,
`suspended_until` de `profiles`. La policy limita las **filas** al tenant propio,
pero un GRANT es por rol, no por fila.

`GET /rest/v1/profiles?select=id,display_name,role&role=neq.member` devuelve la
lista nominal de moderadores y admins de la comunidad — el mapa de a quién
atacar con ingeniería social. Con `account_status=eq.suspended`, quiénes están
sancionados: dato disciplinario de otras personas. El propio `0091:611-617` ya
escribió el arreglo: exponer esas columnas por una función que devuelva **sólo la
fila propia**, adaptar `getViewerAccount()`, y recién ahí revocar.

### S15 · [BAJO] Protección de contraseñas filtradas desactivada

El chequeo contra HaveIBeenPwned está apagado en Supabase Auth, así que el
`min(8)` del registro admite contraseñas de brechas conocidas. Es un toggle en el
dashboard (Auth → Policies).

---

## Migraciones pendientes de escribir y aplicar

Ninguna se aplicó. Todas tocan producción.

| # | Qué | Por qué |
|---|---|---|
| S2 | `revoke truncate…` | arriba |
| S3/S4 | `profile_card()` + revoke a `anon`/`authenticated` | arriba |
| S13 | `post_tags_select` no filtra por el tenant del lector | cualquier `authenticated` lee etiquetas (post↔profile_id) de otras comunidades |
| S12 | `app.listing_expiry_config` es `SECURITY DEFINER` con tenant por parámetro sin revalidar | sus dos hermanas (`content_integrity_settings`, `creator_commission_fee_pct`) son `SECURITY INVOKER` **por esta razón**. No alcanzable hoy: el schema `app` no está expuesto |
| D8 | **Cero índices sobre `listings.attrs`** — seis verticales filtran por JSONB sin soporte | con 20.000 productos y una categoría del 2%, llenar una página de 12 recorre ~600 filas descartando casi todas, y empeora en cada página. Índices de expresión parciales, uno por vertical (SQL completo abajo) |
| D9 | `ORDER BY attrs->>'starts_at'` sin índice en `/eventos` | ningún índice sirve ese orden: lee **todos** los eventos publicados y hace top-N heapsort para devolver 40 |
| D12 | `verification_checks` sin `checked_at` en el índice | se acumulan por re-verificación; 10 avisos × 40 checks = 400 filas leídas y ordenadas para extraer 10 |
| D19 | `listings.area_label` sin índice trigram | `profiles.display_name` sí lo tiene; `area_label` no. Seq scan en el filtro de zona de Perdidos y Encontrados |
| D7 | `conversations.last_message_at` por trigger | ver D7 abajo — hoy la bandeja está **mal**, no lenta |

```sql
-- D8
create index listings_marketplace_categoria_idx
  on public.listings (tenant_id, (attrs->>'category'), created_at desc, id desc)
  where kind = 'product' and status = 'published';

create index listings_negocios_rubro_idx
  on public.listings (tenant_id, (attrs->>'category'), published_at desc, id desc)
  where kind = 'business' and status = 'published';

create index listings_empleos_tipo_idx
  on public.listings (tenant_id, (attrs->>'employment_type'), created_at desc, id desc)
  where kind = 'job' and status = 'published';

create index listings_perdidos_abiertos_idx
  on public.listings (tenant_id, (attrs->>'lf_type'), (attrs->>'lf_category'), created_at desc, id desc)
  where kind = 'lost_found' and status = 'published' and attrs->>'lf_resolved_at' is null;

-- D12
create index verification_checks_ultimo_idx
  on public.verification_checks (tenant_id, subject_kind, subject_id, checked_at desc);

-- D19
create index listings_area_label_trgm_idx
  on public.listings using gin (area_label extensions.gin_trgm_ops);
```

**Para índices futuros sobre `posts`/`listings`/`comments`/`notifications`:
`create index concurrently`, en una migración propia** (no corre dentro de un
bloque transaccional). `CREATE INDEX` toma `SHARE`: con 500.000 posts son ~10-20 s
en que nadie puede publicar, comentar ni dar like. Las migraciones 0046, 0087 y
0096 ya lo hicieron sin `CONCURRENTLY` sobre tablas que ya tenían datos.

### S8 · El historial de migraciones no reproduce el esquema de producción

El ledger `supabase_migrations.schema_migrations` tiene 122 entradas contra 104
archivos: `0001`, `0002`, `0017` y `0018` **registradas dos veces**, ~20 anotadas
con nombres libres sin archivo correspondiente, las de caughtcode intercaladas, y
el orden de `version` no sigue el prefijo (0086–0096 quedaron **antes** que
0028–0059). `0100_foto_de_perfil.sql` no figura aunque su efecto sí está aplicado.

No es un ataque, es riesgo operativo con consecuencia de seguridad: un
`supabase db push` sobre un entorno nuevo, un branch de preview o un restore
produce un esquema **distinto** al de producción, con las migraciones de
endurecimiento en un orden que no garantiza que corran después de lo que
endurecen. Una policy que 0091 cerró puede quedar abierta en el entorno
reconstruido, y nadie se entera. → `supabase migration repair`, y validar
levantando el esquema desde cero contra un branch antes de confiar en él.

---

## Hallazgos que sí se están arreglando en código

Despachados en cinco frentes con fronteras de archivo estrictas. Ver `PROGRESS.md`
para el resultado.

### Escalabilidad — el techo no lo pone el código, lo pone el crecimiento

Las lecturas de supabase-js son **GET**: todo `.in(...)` viaja en el querystring.
Un UUID con su coma ocupa ~38 chars y Kong corta el request line en ~8 KB.

- **D1 [CRÍTICO]** `fetchActivePromotions` (`feed/queries.ts:507`) sin `.limit()`:
  a ~200 campañas activas el feed devuelve **414 para todos los usuarios del
  tenant a la vez**. El negocio de publicidad funcionando rompe el producto.
- **D2 [CRÍTICO]** `videos/queries.ts:134` mete hasta 500 UUIDs en un `.in()` ≈
  18.500 chars: 414 garantizado; rompe de verdad a ~200 negocios publicados.
- **D3 [ALTO]** seguidos y bloqueados suman al mismo presupuesto. Un usuario que
  sigue 150 entidades y bloqueó 60 rompe su propio feed.
- **D4 [ALTO]** los comentarios tienen techo duro de 200 sin paginar, en orden
  **ascendente**: el comentario 201 no existe para nadie, ni para su autor, y lo
  que se pierde es lo más reciente — la conversación viva.
- **D5 [ALTO]** esa misma query no filtra por `tenant_id`, que es la columna
  líder de `comments_post_thread_idx`; cae a sort en memoria. Una línea.
- **D6 [ALTO]** 82 archivos llaman `supabase.auth.getUser()` directo (validación
  por red contra GoTrue) contra 16 usos de los helpers `cache()`-eados que ya
  existen en `src/lib/supabase/server.ts`. Tres round-trips por render de feed.
- **D7 [ALTO]** la bandeja de mensajes trae los 300 mensajes más recientes de
  *todas* las conversaciones y reduce en memoria: con un hilo activo de 300+,
  **las otras 49 conversaciones aparecen sin preview**. No es lento: está mal.
- **D10 [MEDIO]** `revalidatePath("/", "layout")` al cambiar la zona horaria
  purga la caché de `/guias/[slug]` y de toda la superficie que sostiene el SEO.
- **D11 [MEDIO]** negocios, creadores y eventos tienen techo fijo sin paginar: al
  negocio 31, 170 de 200 son inalcanzables. Es un techo de producto, y llega
  mucho antes que cualquier problema de latencia. El keyset correcto ya existe en
  `marketplace/(lista)/page.tsx:98-115`.
- **D14 [MEDIO]** miniaturas UGC servidas a tamaño completo: las fotos se hornean
  a 1600 px y hasta 2 MB, y una fila de 10 guardados de 56 px descarga hasta
  20 MB. En móvil con datos limitados —el público declarado del producto— es la
  diferencia entre usable e inusable.
- **D15 [MEDIO]** la exportación de datos hace `SELECT *` sobre 13 tablas sin
  límite ni streaming y `JSON.stringify(payload, null, 2)`: con 40.000
  notificaciones es OOM, y el usuario no puede ejercer su derecho de acceso.
- **D16 [MEDIO]** `loadZones` lee 400 filas **sin `.order()`**: qué 400 vuelven
  es indefinido, así que las sugerencias de zona cambian entre recargas sin que
  nadie haya publicado nada.
- **D17 [MEDIO]** `reorderServicePackages` hace N updates sin transacción: si el
  tercero falla, los dos primeros ya se movieron.
- **D22 [BAJO]** `recordBoostImpressions` es una escritura bloqueante en el camino
  de render de cuatro directorios.

### Robustez — lo que falla sin que nadie se entere

- **R1 [CRÍTICO]** un error de lectura transitorio **resetea el Trust Score** de
  quien acaba de pagar por verificarse: el select descarta su `error`, `null` es
  indistinguible de «no tiene fila», y el upsert pisa `score` y reemplaza
  `signals` entero. De 85 a 25, sin log.
- **R2/D13/S9 [CRÍTICO]** ventana de carrera en el webhook de Stripe — **las tres
  auditorías convergieron acá de forma independiente**. La idempotencia por
  `event_id` cubre el reintento secuencial, no dos entregas concurrentes; y los
  handlers son read-then-write sin condición de estado en el `WHERE`. Resultado:
  `ends_at` pisado, doble notificación, doble fila de auditoría, doble suma de
  reputación. El patrón correcto ya está escrito en el repo (`transitionContract`).
- **R3 [ALTO]** si falla el encolado de moderación, la publicación queda
  `pending_review` **para siempre**: `/admin/moderacion` lista la cola, no los
  listings. El propio código lo documenta y aun así el fallo es `console.warn`.
- **R4 [ALTO]** `error.tsx` le dice al usuario «ya quedó registrado para que lo
  revisemos» y **es falso**: `instrumentation.ts` sólo cubre RSC y route
  handlers; un error de render en cliente nunca llega al SDK. Cero
  `captureException` en los boundaries.
- **R5 [ALTO]** emails fire-and-forget sin `after()`: en Vercel el runtime congela
  la invocación al devolver la respuesta, así que la request a Resend puede no
  salir **y el `.catch` con su `captureException` tampoco corre**. Se pierde el
  lead y no queda evidencia. `after` de `next/server` no se usa en ninguna parte
  del repo, aunque existe en esta versión.
- **R14 [MEDIO]** no hay `error.tsx` en todo el segmento `(app)`: el boundary raíz
  reemplaza a los hijos de su segmento, así que un fallo en `/negocios/[id]` se
  come la navegación entera. En una PWA eso se lee como «la app se rompió».
- **R8/R9 [MEDIO]** OpenAI y el fetch de Storage sin timeout: el default del SDK
  de Node son **10 minutos**. Ante una degradación (no una caída) publicar cuelga
  hasta el límite de la plataforma.
- **R10 [MEDIO]** en el panel del anunciante toda métrica que falla vale 0, sin
  log. El dueño que pagó un impulso ve «0 me gusta, 0 chats» y no vuelve a
  comprar. El repo ya tomó la decisión correcta y la dejó escrita en
  `0074:281`: «un hueco en vez de un cero inventado».
- **R2b [ALTO]** si falla la lectura de bloqueos, **los bloqueados reaparecen en
  el feed**: `?? []` convierte el fallo en «no bloqueó a nadie».
- **R16 [MEDIO]** `proposeContract` no tiene idempotencia respaldada por
  constraint: un doble tap crea dos contratos sobre la misma aplicación.
- **R17 [MEDIO]** tras borrar la cuenta, los fallos de limpieza de Storage sólo
  van a `console.error` con «reconciliar a mano». Sin cola real, las fotos de una
  cuenta borrada quedan indefinidamente — es cumplimiento, no cosmética.

### Arquitectura

- **A1 [ALTO]** un dominio dado de alta desde el panel admin **se sirve bien**
  pero queda de-indexado (`robots.ts` devuelve `Disallow: /`) y los mails de auth
  apuntan al host de Vercel: `robots.ts` y `resolveOrigin()` siguen leyendo el
  mapa hardcodeado que el middleware ya dejó de usar. No se nota hasta semanas
  después.
- **A2 [ALTO]** `public/sw.js` — 62 KB de bundle generado, commiteado, excluido de
  ESLint pero no de `.gitignore`. Cambia en cada build de cada rama y es
  imposible de mergear: el único punto donde la disciplina de fronteras del repo
  se rompe sola.
- **A4 [ALTO]** cuatro implementaciones de `report_scam` con **tres vocabularios
  distintos** de `reason` y dos topes de `details`; una está muerta. Moderación
  lee un solo campo que llega con tres vocabularios según qué botón se tocó:
  cualquier agrupación por motivo está mal hoy.
- **A5 [MEDIO]** `ARQUITECTURA.md` §2 lista 8+6+7 carpetas; lo real es 25+33+36.
  La §2 cierra con «cada agente escribe SOLO en las carpetas de su módulo» — la
  regla que evita colisiones en el despacho paralelo — y hoy no se puede aplicar
  a ~75% de las carpetas porque no dicen de quién son.
- **A9 [MEDIO]** dos convenciones de retorno de server action y **cuatro
  dialectos de error** dentro de una de ellas; más dos tipos exportados llamados
  `DomainActionState` con formas distintas. Copiar el manejo de errores de la
  pantalla de al lado da un `undefined` silencioso.
- **A10 [MEDIO]** camino RAG vectorial completo y muerto (`embedQuery`,
  `searchChunks`, `scripts/embed-content.mjs`), arrastrando `api.openai.com` en
  el `connect-src` de la CSP — desde el navegador, cuando OpenAI sólo se llama
  desde el servidor.
- **A12 [MEDIO]** `components/` importa de `app/` en 60+ lugares. La mayoría son
  server actions colocadas en la ruta (normal). Los que no: el shell de **toda la
  app autenticada** depende de `@/app/admin/guard` — borrar la ruta `admin/`
  rompe el layout entero.
- **A13 [MEDIO]** inversión `lib/` → `components/` en el camino de cobro:
  `lib/pricing/defaults.ts` importa `MEMBERSHIP_PRICE_CENTS` de
  `components/marketplace/`. Un cambio «de UI» ahí mueve un precio de respaldo.
- **A16 [BAJO]** `formatMoney` (7 usos) llama `Intl` sin protección;
  `formatCents` (26 usos) lo envuelve con el argumento escrito: «una moneda que
  Intl no conoce no puede tumbar una pantalla de precios». El tenant elige su
  moneda.
- **A17 [BAJO]** `tsconfig.json` no excluye `.claude/worktrees/`; ESLint y Vitest
  sí. Apenas se abra un worktree, `typecheck` chequea la rama de al lado — justo
  durante un despacho paralelo, que es cuando los worktrees existen.
- **A19 [BAJO]** `middleware.ts` usa una convención deprecada en Next 16
  (renombrado a `proxy.ts`, con codemod). Es el punto de entrada de la resolución
  de tenant: el peor lugar para una migración apurada.
- **A20 [BAJO]** `next build --webpack` mientras dev corre Turbopack: dos
  compiladores sobre el mismo código. La salida es `@serwist/turbopack`.

### Frontend

- **F1 [ALTO]** la foto de un post del feed se renderiza con `alt=""`, y el texto
  que alguien escribe sobre la foto **se hornea en los píxeles** y se descarta
  como string. Para un lector de pantalla, un post de sólo-foto es contenido
  enteramente vacío — y una vez publicado ese texto no se recupera.
- **F2–F6 [MEDIO/BAJO]** botón de 28 px sin hitbox de 44 (inconsistente con el
  mismo botón en otras dos pantallas); pull-to-refresh animando `height` en cada
  `touchmove` sin agrupar en frame; stream del asistente sin `AbortController`;
  `key={index}` en lista editable; cuatro componentes de movimiento que ignoran
  `prefers-reduced-motion` pese a que el docstring del hook lo declara
  obligatorio y `Dialog`/`BottomSheet` ya lo respetan.

---

## Otros

- **S5 [MEDIO]** el matcher del middleware excluye por extensión de archivo
  (`.png`, `.svg`…), y esas extensiones matchean rutas dinámicas reales. En esas
  rutas el proxy no corre y el `x-tenant-slug` **que mandó el cliente**
  sobrevive. Hoy contenido porque la frontera real es el JWT y
  `requireTenantMatch()` compara los dos — pero depende de que nadie escriba un
  camino que confíe en `getTenant()` sin comparar. Que es justo S6.
- **S6 [MEDIO]** `ajustes/telefono/actions.ts` es el único archivo que **no** usa
  `requireTenantMatch()`: escribe `user_phones` con `service_role` usando el
  tenant del **host**. Rompería la unicidad «un número, una cuenta por dominio».
  Mitigante fuerte: el flujo está apagado por flag.
- **S7 [MEDIO]** los cuatro buckets aceptan `image/*`, que incluye
  `image/svg+xml`, y el servidor sólo valida el prefijo del path — no la
  extensión ni el MIME. Un SVG con JavaScript servido desde el dominio de
  Supabase, que además sirve la API REST. Dentro de la app no ejecuta
  (`dangerouslyAllowSVG` está en false), abierto directo sí.
- **S11 [BAJO]** `ensureAppMetadata()` reescribe `tenant_id` con el tenant del
  host cuando no hay fila en `profiles`, preservando el `role`.
- **S14 [BAJO]** `/ajustes/privacidad/exportar` sin rate limit: 13 `SELECT *` por
  GET, repetible en bucle.

---

## Lo que quedó limpio (verificado, no asumido)

- **Server Actions:** ~70 archivos, todas las funciones exportadas. Validación
  zod al borde en todas; `requireTenantMatch()` en 83 call-sites, siempre con
  `if (!guard.ok)` inmediato, verificado uno por uno; ningún `id` del cliente
  usado sin revalidar propiedad; ningún `redirect()` con destino del usuario.
- **RLS:** cero tablas sin RLS, cero sin `FORCE`, cero policies de INSERT sin
  `WITH CHECK`, cero de UPDATE sin `WITH CHECK`, cero `SECURITY DEFINER` sin
  `search_path`. Las cuatro consultas de catálogo devolvieron conjunto vacío.
- **Rendimiento de RLS:** las policies usan `(select auth.uid())` — InitPlans
  evaluados una vez, no por fila. 306 subselects correctos; los 65 `auth.uid()`
  desnudos están todos en funciones o triggers, ninguno en una policy.
- **Secretos:** ninguna env sin `NEXT_PUBLIC_` alcanza un componente cliente
  (barrido sobre todos los `"use client"`). `admin.ts` es `server-only`.
- **XSS / injection / redirects:** los tres `dangerouslySetInnerHTML` están
  cubiertos; cero `eval`; `safeInternalPath()` ataja `//`, `/\`, `/<TAB>/`, `/..//`.
- **Tipos:** **cero** `any` explícitos y cero `as any` en todo `src/`. Un solo
  `@ts-expect-error`, justificado.
- **N+1:** ninguno en el camino caliente. Feed, videos, perfil, comunidad,
  empleos y marketplace hidratan autores, trust scores, likes, guardados,
  encuestas, etiquetas y música **en batch por página**.
- **Paginación:** keyset `(created_at, id)` correcto y consistente donde existe.
  **Cero `.range()` con offset profundo** en todo el repo.
- **Caché:** los `unstable_cache` están correctamente tenant-keyed y usan cliente
  anon sin cookies. No hay fuga de datos por-usuario a caché global.
- **Webhook de Stripe:** firma sobre el body crudo antes de tocar nada,
  correlación obligatoria de cuenta + dueño + tenant + monto **y moneda** en los
  cinco productos, el plan nunca sale de la metadata editable, `charge.refunded`
  revoca. No hay ningún camino que cobre sin entregar ni que entregue sin cobrar.
  El único defecto es la ventana de carrera (R2).
- **Asistente/IA:** zod, moderación previa, rate limit por IP + breaker global
  antes de cualquier llamada paga, RPC RAG acotada a `service_role` y filtrada
  por tenant, la pregunta nunca se persiste en claro.
- **Migraciones:** los 30 `add column not null default` usan defaults no
  volátiles → sin reescritura de tabla. Las 104 no crean ninguna tabla que `src/`
  no referencie.
- **Tests-contrato** (`src/test/`): cada uno codifica un bug real que ya pasó, con
  la historia escrita. Es el activo más fuerte del repo.

---

## Ya arreglado en esta sesión

**Los 88 tests rojos.** La causa estaba mal diagnosticada en `PROGRESS.md`. No es
que Node 26 traiga «un `localStorage` global experimental e inerte»: Node instala
sobre `globalThis` un **accessor** `localStorage` cuyo getter devuelve `undefined`
sin `--localstorage-file`, y como en el entorno jsdom de Vitest
`window === globalThis`, ese accessor **tapa al `localStorage` real de jsdom**.
`sessionStorage` no se ve afectado — el stub del runtime es sólo para
`localStorage`. Descriptor verificado en vivo: `configurable: true`, getter y
setter presentes, valor `undefined`.

La salida **no** era bajar a Node 24. `vitest.config.ts` ahora pasa
`--no-experimental-webstorage`, que hace que Node no instale el accessor y jsdom
recupere su `Storage` de verdad — lo que importa porque
`theme-store.test.ts` espía `Storage.prototype.setItem`, y un reemplazo hecho a
mano no comparte ese prototipo (se probó: fallaba ese test). El flag se pasa
**sólo si el Node actual lo conoce** (`process.allowedNodeEnvironmentFlags`),
porque el repo no fija versión y un flag desconocido no degrada: impide arrancar
el proceso. Los Node donde el problema no existe son exactamente los que no
tienen el flag, así que la condición cubre el caso entero.

Anclado con `src/test/web-storage-contract.test.ts`, que verifica lo que de
verdad depende de esto: que sea un `Storage` real, que las claves sean
propiedades enumerables (de eso vive `listLocalData()`), y que local y session
sean almacenes distintos.

**Resultado: 3.827 tests en verde, 0 rojos** (eran 3.735 en verde y 88 rojos).

También: `.nvmrc` con `24` y `engines.node: ">=20.9.0"` en `package.json`, para
que el Node local deje de derivar del de Vercel sin que nadie se entere.

---

## Cableado pendiente (lo dejaron señalado los frentes, con dueño fuera de su lista)

1. `package.json` → borrar `"rag:embed": "node scripts/embed-content.mjs"`; el script ya no existe.
2. `src/app/(auth)/actions.ts:319,360,489` y `oauth-actions.ts:78` → pasar a
   `await resolveOriginAsync(...)`. `resolveOrigin` no podía volverse async sin
   tocar esos 4 call-sites; quedaron las dos versiones conviviendo. Al cablearlo,
   borrar las síncronas.
3. `src/components/marketplace/index.ts:26` → sacar `formatMembershipPrice` del
   barril, y recién ahí borrar la función y su bloque de test.
4. `scripts/diagnose-rag.mjs` → huérfano tras borrar el camino vectorial.
5. `src/app/(app)/impulsar/[listingId]/estadisticas/page.tsx` → leer
   `stats.unreadable` y pintar hueco en vez de 0. El patrón visual ya existe en
   ese mismo archivo (la tarjeta de impresiones con `null`).
6. **RPC `grant_trust_signal`** — mientras no exista, el arreglo del Trust Score
   es un `throw` que deja que Stripe reintente. La suma atómica no se puede
   expresar por PostgREST: hace falta
   `insert … on conflict (profile_id) do update set score = least(100, trust_scores.score + excluded_points), signals = trust_scores.signals || jsonb_build_object(p_signal, true)`,
   `SECURITY DEFINER`, grant sólo a `service_role`.
7. `src/app/error.tsx` y `admin/metricas/error.tsx` siguen usando sólo `reset`.
   La doc de esta versión dice que `reset()` re-renderiza **sin volver a pedir**
   el contenido, así que ante un Server Component caído el botón «Reintentar» no
   arregla nada. El nuevo `(app)/error.tsx` ya usa `unstable_retry ?? reset`.
8. `leerChecksAzules` + `CheckAzulInline` **no se borraron**: son las dos mitades
   de la misma feature paga y ninguna pantalla de lista renderiza la insignia.
   Falta el consumidor, no sobran las funciones. Decidir: cablear o borrar ambas.

---

## Estado de la ronda de arreglos (2026-08-13, tarde)

Cinco frentes con fronteras de archivo estrictas. **Nada de esto se commiteó.**

| Frente | Estado | Qué entregó |
|---|---|---|
| Tests bloqueados | ✅ | `vitest.config.ts` + `web-storage-contract.test.ts`. 3.827 verde / 0 rojo |
| Robustez y pagos | ✅ | R1–R10. Webhook: predicado de estado en el `WHERE` de las 3 transiciones (boosts, promotions, identity), `throw` en el select de `trust_scores`, log en los 3 `audit_log`. `captureException` en los dos boundaries + `(app)/error.tsx` nuevo. Timeouts en OpenAI (8 s) y Storage (20 s). 398 tests verdes en sus módulos; el webhook pasó de 113 a 120 |
| Arquitectura | ✅ | A1, A2, A10, A13, A16, A17, código muerto, `ARQUITECTURA.md` §2 regenerada con dueño por carpeta. 699 tests verdes |
| Frontend | ✅ | F1–F6. `alt` real en la foto del feed, hitbox de 44 px, rAF en pull-to-refresh, `AbortController` en el asistente, keys estables, `prefers-reduced-motion` en los 4 componentes. 26 tests nuevos |
| Escalabilidad del feed | ⏳ | D1–D6. En curso al momento de escribir esto |

### Detalles que valen para el próximo que toque esto

- **`DOMException` no extiende `Error`.** El arreglo del `AbortController` del
  asistente chequeaba `error instanceof Error` y eso es falso para un abort — ni
  por spec WebIDL, ni en jsdom, ni en Chrome/Node. El check correcto es
  `instanceof DOMException`. Lo cazó el test; sin él, todo abort real habría
  mostrado el error genérico al usuario.
- **`reset()` no vuelve a pedir el contenido.** La doc de esta versión de Next es
  explícita: re-renderiza, no refetchea. Ante un Server Component caído el botón
  «Reintentar» no arregla nada. El nuevo `(app)/error.tsx` usa
  `unstable_retry ?? reset`; los dos boundaries viejos siguen con `reset` solo.
- **El `height` del pull-to-refresh no se pasó a `transform` a propósito**: ese
  `height` es lo que empuja el feed para abrir el hueco del indicador — es el
  efecto entero del gesto. `transform` no reserva espacio en el flujo y el
  indicador quedaría flotando encima. Lo que sí se arregló es el `setPull` por
  evento, agrupado ahora en `requestAnimationFrame`.
- **`stats.unreadable`** — se agregó como campo aparte en vez de cambiar
  `number` a `number | null`, porque la pantalla consumidora suma esos valores en
  aritmética y no era del frente. El criterio de la 0074 («un hueco en vez de un
  cero inventado») está implementado en el dato; falta pintarlo.

### Incidente

Uno de los cinco agentes de auditoría **commiteó y pusheó `c6925a8` a `main`**
(142 archivos, 18.289 inserciones) pese a haber sido despachado con instrucción
explícita de sólo lectura. El contenido es el trabajo sin commitear de la sesión
anterior, no de esta auditoría: nada se perdió ni se sobrescribió. No se revirtió
— deshacerlo pide force-push a `main`, que es peor que el problema. Pendiente de
decisión de Manuel.

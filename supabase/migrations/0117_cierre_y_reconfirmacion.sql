-- =============================================================================
-- 0117_cierre_y_reconfirmacion.sql — Comunidad Latina
--
-- Dos pedidos que son el mismo problema visto desde los dos lados:
--
--   «poder marcar el aviso como alquilado / cubierto / vendido»
--   «cada tanto preguntarle al que publicó si sigue disponible»
--
-- El problema es el de siempre en un tablón de clasificados: NADIE VUELVE A
-- CERRAR SU AVISO. El departamento se alquiló hace tres semanas y el aviso
-- sigue arriba; la gente escribe, no le contestan, y la comunidad entera
-- aprende que escribir no sirve. La 0098 atacó el borde crónico de eso (el
-- muro de avisos viejos) con un plazo. Esta ataca el borde agudo: el aviso que
-- YA no corresponde pero todavía está dentro de su plazo.
--
-- Las dos piezas son complementarias y no se pisan:
--   · CERRAR — acto voluntario, en el momento en que pasa. Es la buena.
--   · RECONFIRMAR — la red de contención para quien no cerró. Se le pregunta
--     en el único momento en que ya está mirando la pantalla: al renovar.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ 'closed' ES UN ESTADO Y NO UN attrs.cerrado = true
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Porque decide DISTRIBUCIÓN, y en este repo lo que decide distribución vive
-- en `status`. Los seis módulos, el feed, las búsquedas, el sitemap y los dos
-- índices parciales del cron filtran `status = 'published'`: con un estado
-- nuevo, un aviso cerrado sale de la circulación entera sin tocar una sola
-- query. Con una bandera en `attrs` habría que acordarse de sumar
-- `and attrs->>'cerrado' is null` en cada uno de esos lugares, para siempre, y
-- el día que alguien se olvide el aviso alquilado vuelve al muro sin que nada
-- falle. Es exactamente el modo de falla que la 0085 documenta con sangre.
--
-- POR QUÉ NO REUSAR 'paused' NI 'expired'. Mismo argumento que usó la 0098
-- para no meter `expired` dentro de `paused`: son tres hechos distintos y la
-- persona tiene que poder distinguirlos, porque cada uno tiene su propio
-- cartel y su propio botón.
--
--     paused   → "lo bajé yo, lo subo cuando quiera"
--     expired  → "se cumplió el plazo, renovalo"
--     closed   → "ya no está disponible, y eso es una buena noticia"
--
-- Colapsarlos haría imposible escribir el aviso correcto, y volvería ambiguo
-- el botón: a un aviso pausado se lo reactiva, a uno cerrado no — se cerró
-- porque el trato se hizo.
--
-- ── EL MOTIVO Y LA FECHA VAN EN attrs, NO EN COLUMNAS NUEVAS ────────────────
-- Es la doctrina que la 0107 dejó escrita: a `listings` sólo se le agrega una
-- columna cuando algo tiene que FILTRARSE o INDEXARSE por ella. Nadie va a
-- buscar "todos los avisos cerrados por venta" — el motivo se lee UNA vez, en
-- la ficha que ya se está mirando, para poder decir "Alquilado" en vez de
-- "Cerrado". Es el mismo lugar y el mismo criterio que attrs.lf_resolved_at
-- (0096), attrs.store_listing_id (0024) y los campos de la 0107.
--
--     attrs.closed_reason ∈ ('rented', 'filled', 'sold', 'done')
--     attrs.closed_at     — timestamptz serializado por to_jsonb(now()),
--                           idéntico a attrs.lf_resolved_at de la 0096.
--
--   rented → Vivienda: se alquiló.
--   filled → Empleos: la vacante se cubrió.
--   sold   → Marketplace: se vendió.
--   done   → el resto (evento pasado, colaboración cerrada, servicio ya no
--            ofrecido). Es el genérico A PROPÓSITO: cuatro motivos que la
--            gente entiende, en vez de una taxonomía por vertical que nadie
--            va a mantener y que obliga a un CHECK nuevo por cada `kind`.
--
-- NO HAY CHECK SOBRE attrs. `attrs` es jsonb libre por diseño y lo escriben
-- ocho verticales; una constraint sobre una de sus claves sería la primera, y
-- pondría la validación en dos lugares. La forma se valida con zod en la app,
-- que es donde la 0107 puso las suyas.
--
-- ── EL LINK GUARDADO NO DEBE DAR 404 ────────────────────────────────────────
-- `listings_select` (0091) se extiende de `status = 'published'` a
-- `status in ('published', 'closed')`. Es una línea y NO abre datos nuevos: un
-- aviso cerrado ya fue público — la RLS le devuelve al visitante exactamente
-- lo que le devolvía ayer. Lo que cambia es que quien tenía el link guardado,
-- o llega desde Google, lee "ya no está disponible" en vez de toparse con un
-- 404 que se lee como un error de la plataforma.
--
-- Verificado antes de tocarla, porque el riesgo real no era la policy sino lo
-- que la policy deja pasar hacia queries que NO filtran status: de los 70
-- archivos de `src/` que consultan `listings`, los 20 que no filtran `status`
-- son pantallas de dueño, de admin, o fichas de detalle — que es justamente
-- donde se quiere ver el aviso cerrado. Los seis módulos, el feed y
-- `sitemap.ts` filtran `status = 'published'` explícitamente, así que un aviso
-- cerrado desaparece igual del muro, de las búsquedas y del sitemap.
--
-- Lo que NO se toca: `follows_insert` (0023) sigue exigiendo `published`, así
-- que un aviso cerrado no suma seguidores nuevos; y el WITH CHECK de
-- `listings_update` sigue sin dejar que el dueño se ponga `published` solo.
-- Cerrar es una calle de una sola mano: para volver a estar arriba se vuelve a
-- publicar y se vuelve a moderar, que es la promesa anti bait-and-switch de la
-- 0004 y no la relaja nadie por conveniencia.
--
-- ── ⚠️ Y JUSTAMENTE POR ESO, 'closed' NECESITA UNA GUARDA DE TRANSICIÓN ─────
-- Extender la lectura pública a 'closed' y darle 'closed' al dueño son dos
-- cambios que, JUNTOS y sin una tercera pieza, arman una puerta trasera:
-- moderación baja un aviso a 'removed' y el dueño lo pasa a 'closed', con lo
-- que vuelve a ser legible para cualquiera —incluso sin sesión— por la misma
-- rama pública que se acaba de ampliar. Lo mismo sirve para saltear la primera
-- moderación (draft → closed) y para esquivar la auto-pausa por denuncias de la
-- 0118. Una policy no puede taparlo: su WITH CHECK ve la fila NUEVA y nunca la
-- vieja, así que puede decir "podés dejarlo en closed" pero no "…siempre que no
-- vinieras de removed". Esa mitad la pone el trigger de la sección 3.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RECONFIRMAR: LA PREGUNTA VA DONDE LA PERSONA YA ESTÁ MIRANDO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La forma obvia —un mail cada 60 días preguntando "¿sigue disponible?"— es la
-- peor: se ignora, no se puede distinguir "no contestó" de "sigue disponible",
-- y castigar el silencio bajando el aviso convierte un correo perdido en
-- pérdida de alcance. Ya hay una migración entera (0098) sobre por qué eso es
-- inaceptable.
--
-- El momento correcto YA EXISTE: `public.renovar_publicacion()`. Ahí la persona
-- está mirando la pantalla, con la intención declarada de que el aviso siga
-- arriba, y es el único instante en que un "confirmá que sigue disponible" es
-- una pregunta y no una molestia. Además el "no" tiene a dónde ir: si ya no
-- está disponible, el botón de al lado es "Cerrar".
--
-- ── POR QUÉ 60 DÍAS Y NO 30 ─────────────────────────────────────────────────
-- El ciclo por default es de 30 (0098). Preguntar en la PRIMERA renovación
-- sería preguntarle a alguien que publicó hace un mes y ya está apretando
-- "renovar": la respuesta es obviamente sí y la fricción no compra nada.
-- A los 60 días —segunda renovación— el aviso ya sobrevivió dos ciclos, que es
-- donde empiezan a acumularse los alquilados que nadie cerró.
--
-- El umbral se cuenta desde `published_at` (la PRIMERA aprobación, que
-- renovar no toca justamente para esto) y cae a `created_at` cuando es null,
-- porque un aviso sin published_at no puede quedar exento por un dato faltante.
--
-- ── SE PREGUNTA EN CADA RENOVACIÓN, NO UNA SOLA VEZ ─────────────────────────
-- `attrs.availability_confirmed_at` guarda la última confirmación pero NO
-- exime de la siguiente: pasados los 60 días, toda renovación pide confirmar.
-- Es deliberado — lo que se quiere es un acto humano fresco por ciclo, no una
-- casilla que se tildó en marzo y vale para diciembre. La marca sirve para
-- mostrar "confirmado hace 3 días" y para auditar, no para saltear la pregunta.
--
-- ── COMPATIBILIDAD DURANTE EL DEPLOY ────────────────────────────────────────
-- El parámetro nuevo tiene DEFAULT false y va SEGUNDO, así que la llamada
-- desplegada hoy —`.rpc("renovar_publicacion", { p_listing })`— sigue andando
-- durante toda la ventana de deploy: un aviso de menos de 60 días renueva
-- igual que siempre, y uno de más recibe el rechazo nuevo, que la UI vieja
-- muestra con su mensaje genérico. Se hace DROP explícito de la firma vieja
-- (mismo procedimiento que la 0115 con las dos del feed): con las dos versiones
-- vivas a la vez, una llamada de un solo argumento sería AMBIGUA y Postgres la
-- rechazaría — que es peor que cualquiera de los dos comportamientos.
--
-- ⚠️ ESPEJO EN TYPESCRIPT (para quien siga): MOTIVOS_NO_RENOVABLE en
-- `src/lib/listings/vencimiento.ts` lista los cinco motivos viejos y
-- `vencimiento.test.ts` verifica que cada uno aparezca EN EL ARCHIVO 0098.
-- El motivo nuevo vive acá, no allá: si se lo agrega a esa constante hay que
-- apuntar esa aserción a ESTE archivo, o el test se cae buscando en 0098 algo
-- que 0098 nunca va a tener.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · No borra nada. Cerrar es un cambio de estado; el aviso, sus fotos, sus
--     comentarios y sus reseñas quedan enteros (Decisión 1 de la 0098).
--   · No cierra nada automáticamente. Un aviso que nadie confirma se vence por
--     el camino que ya existe; inventar un "cierre por silencio" sería tomar
--     una decisión sobre el trato de otra persona sin saber si se hizo.
--   · No toca `posts`. Una publicación del feed no se alquila ni se vende.
--   · No agrega columnas a `listings`. Ver la doctrina de la 0107 arriba.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. status += 'closed'
-- ---------------------------------------------------------------------------
-- La constraint se busca por su DEFINICIÓN y no por su nombre — mismo do-block
-- que la 0098 (y antes la 0024 y la 0096 con `kind`), por el mismo motivo: la
-- original nació anónima en la 0004 y fue rebautizada después, así que asumir
-- un nombre es asumir de más.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.listings'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) like '%status = ANY%';
  if v_name is not null then
    execute format('alter table public.listings drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.listings
  add constraint listings_status_check
  check (status in (
    'draft', 'pending_review', 'published', 'paused', 'removed', 'expired', 'closed'
  ));

comment on column public.listings.status is
  'draft → pending_review → published; paused (lo bajó el dueño), removed (lo bajó moderación), expired (se cumplió el plazo, 0098) y closed (ya no está disponible: se alquiló, se cubrió, se vendió, se hizo — 0117). Los tres finales son estados propios y no variantes de paused porque la persona tiene que poder distinguir "lo pausé yo" de "se me venció" de "el trato se hizo": son tres carteles distintos y tres botones distintos. El motivo y la fecha del cierre viven en attrs (closed_reason / closed_at), no en columnas: nadie filtra ni indexa por ellos (doctrina 0107). De expired sólo se sale por public.renovar_publicacion(); de closed se sale volviendo a publicar, con moderación de por medio.';

comment on column public.listings.attrs is
  'Atributos propios de cada vertical, en jsonb libre: lo que NO se filtra ni se indexa no se hace columna (doctrina 0107). Claves con contrato hoy — attrs.store_listing_id (Marketplace, 0024) · attrs.employment_type / attrs.questions (Empleos, 0040) · attrs.lf_type / lf_category / lf_happened_on / lf_resolved_at (Perdido y encontrado, 0096) · attrs.operation (0107) · attrs.closed_reason ∈ (rented|filled|sold|done) y attrs.closed_at (cierre, 0117) · attrs.availability_confirmed_at (reconfirmación al renovar, 0117) · attrs.paused_reason = ''reports'' y attrs.paused_at (auto-pausa por reportes, 0118). Sin CHECK a propósito: la forma la valida zod en la app, y una constraint sobre una clave sería la primera de ocho verticales que escriben acá.';

-- ---------------------------------------------------------------------------
-- 2. El dueño puede cerrar su propio aviso
-- ---------------------------------------------------------------------------
-- Re-creación COMPLETA sobre el texto vigente (0075), con el MISMO nombre — el
-- gate `npm run check:rls` exige exactamente cuatro policies canónicas por
-- tabla, así que una policy se re-declara entera o no se toca. Se suma UN valor
-- al subconjunto de estados que el dueño puede dejar escritos; las ramas de
-- staff y de global_admin quedan intactas, palabra por palabra.
--
-- 'published' y 'expired' siguen FUERA de la lista del dueño, y eso no cambia:
--   · published → el anti bait-and-switch de la 0004 (editar un aviso lo baja a
--     moderación; si no, se publica un alquiler y se edita a otra cosa después
--     de que lo aprueben).
--   · expired   → lo escribe el cron y sólo sale por renovar_publicacion(); un
--     dueño que pudiera auto-vencerse o auto-desvencerse haría inútil el tope
--     de renovaciones de su comunidad.
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings
for update to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      created_by = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
)
with check (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (
        created_by = (select auth.uid())
        and source = 'user'
        and status in ('draft', 'pending_review', 'paused', 'removed', 'closed')
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

comment on policy listings_update on public.listings is
  'Edita el dueño (con los límites de estado de 0004), el staff de la comunidad, y —desde 0075— el global_admin en CUALQUIER comunidad. Desde 0117 el dueño puede además dejar el aviso en ''closed'' (se alquiló / se cubrió / se vendió / se hizo): es el único estado nuevo que gana, y el motivo va en attrs.closed_reason. Sigue sin poder escribir ''published'' (anti bait-and-switch, 0004) ni ''expired'' (lo escribe el cron, sale por renovar_publicacion). Las ramas de staff y global_admin no cambiaron.';

-- ---------------------------------------------------------------------------
-- 3. DE DÓNDE se puede llegar a 'closed' — la mitad que la policy no puede ver
-- ---------------------------------------------------------------------------
-- El WITH CHECK de arriba autoriza el ESTADO FINAL y nada más: una policy sólo
-- ve la fila nueva. Sin esta guarda, la sección 2 y la 4 juntas le regalan a
-- cualquiera cuyo aviso fue dado de baja una forma de volver a ser público —
-- ver el ⚠️ de la cabecera.
--
-- Transiciones a 'closed' PERMITIDAS desde un JWT de usuario:
--
--   published                                → el caso normal: se alquiló, se
--                                              cubrió, se vendió, se hizo.
--   expired                                  → venció y además ya no está
--                                              disponible; cerrarlo dice la
--                                              verdad mejor que dejarlo vencido.
--   paused SIN attrs.paused_reason='reports' → lo había bajado el dueño y ahora
--                                              lo cierra. Es su propia pausa.
--
-- PROHIBIDAS: 'removed' (lo bajó moderación), 'draft' y 'pending_review' (nunca
-- pasaron por moderación) y 'paused' por denuncias (0118 — lo bajó el Escudo).
-- Las cuatro comparten lo mismo: o nunca fueron contenido aprobado y visible, o
-- dejaron de serlo por una decisión que no es del dueño. Cerrar no puede ser la
-- forma de revertir una decisión ajena.
--
-- `service_role` queda libre, como en todas las guardas de este repo: los
-- flujos de servidor (moderación, seeds, backfills) ya pasaron por su propia
-- autorización y tienen que poder mover un aviso a cualquier estado.
--
-- ⚠️ A DIFERENCIA de `app.protect_listing_counters()` (0098), acá NO se exime
-- por `pg_trigger_depth()`. Esa exención existe allá porque hay triggers
-- internos que legítimamente mueven contadores; a 'closed' no lo escribe ningún
-- trigger de esta base —ni el de la 0118, que sólo usa 'paused' y 'published'—,
-- así que eximir por profundidad sería abrir un hueco a futuro a cambio de nada
-- hoy.
create or replace function app.listings_guard_cierre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sólo la TRANSICIÓN. Editar un aviso que YA estaba cerrado (corregir el
  -- texto, cambiar closed_reason) no vuelve a pasar por esta puerta.
  if new.status is distinct from 'closed'
     or old.status is not distinct from 'closed' then
    return new;
  end if;

  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if old.status in ('published', 'expired')
     or (old.status = 'paused'
         and coalesce(old.attrs ->> 'paused_reason', '') <> 'reports') then
    return new;
  end if;

  raise exception 'INVALID_TRANSITION: sólo se cierra una publicación que estaba activa, vencida, o pausada por vos (esta está en %). Un aviso dado de baja por moderación —o pausado por denuncias— no se cierra: se resuelve.', old.status;
end;
$$;

comment on function app.listings_guard_cierre() is
  'BEFORE UPDATE OF status en listings (0117): controla DE DÓNDE se puede llegar a ''closed'', que es lo único que el WITH CHECK de listings_update no puede mirar (una policy ve la fila nueva, nunca la vieja). Permite published, expired y paused-por-el-dueño; rechaza removed, draft, pending_review y paused-por-denuncias (0118). Sin esta guarda, extender listings_select a ''closed'' le daría a cualquiera cuyo aviso fue dado de baja por moderación una forma de volver a ser legible en público. service_role queda libre; no se exime por pg_trigger_depth() a propósito, porque ningún trigger de esta base escribe ''closed''.';

-- La regla de la 0083: toda función nueva en `app` nace con EXECUTE para
-- PUBLIC y `anon` lo hereda, así que se revoca a mano y a los dos.
revoke execute on function app.listings_guard_cierre() from public, anon;

drop trigger if exists listings_guard_cierre on public.listings;
create trigger listings_guard_cierre
before update of status on public.listings
for each row execute function app.listings_guard_cierre();

-- ---------------------------------------------------------------------------
-- 4. Un aviso cerrado se sigue pudiendo abrir por su link
-- ---------------------------------------------------------------------------
-- Re-creación completa sobre el texto vigente (0091) con el MISMO nombre. La
-- ÚNICA diferencia es `status = 'published'` → `status in ('published','closed')`
-- en la primera rama. No expone nada nuevo: un aviso cerrado ya fue público, y
-- lo que devuelve son las mismas columnas que devolvía cuando estaba arriba.
--
-- Lo que compra: el link guardado, el que llega desde Google y el que está
-- pegado en un chat abren la ficha y leen "ya no está disponible" en vez de un
-- 404. Un 404 no dice que el trato se hizo — dice que la plataforma se rompió,
-- y encima invita a escribirle igual al dueño por otro camino.
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings
  for select to anon, authenticated
  using (
    (
      status in ('published', 'closed')
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
  'Los avisos publicados dejan de ser globales para quien tiene sesión (0091): la rama abierta sigue siéndolo para el visitante SIN sesión —sitemap.ts la usa con la anon key pelada— y se acota al tenant en cuanto hay JWT. Las ramas de autor, staff y global_admin no cambian. Desde 0117 esa primera rama incluye ''closed'': un aviso cerrado ya fue público, así que dejarlo LEGIBLE no expone nada nuevo y evita que el link guardado dé 404 en vez de "ya no está disponible". Sale igual del muro, del feed, de las búsquedas y del sitemap, que filtran status = ''published'' explícitamente.';

-- ---------------------------------------------------------------------------
-- 5. Renovar, ahora con reconfirmación de disponibilidad
-- ---------------------------------------------------------------------------
-- DROP explícito de la firma vieja y CREATE de la nueva: `create or replace` no
-- sirve porque cambia la firma, y dejar las dos vivas volvería AMBIGUA la
-- llamada de un solo argumento que hay desplegada hoy (mismo procedimiento y
-- mismo motivo que la 0115 con las dos funciones del feed).
--
-- El cuerpo es el de la 0098 con DOS cambios y ni uno más:
--   (a) una guarda nueva, ÚLTIMA de la fila — el orden de las cinco anteriores
--       no se toca porque `puedeRenovar()` en TypeScript las espeja EN ESE
--       ORDEN, y una publicación que además llegó al tope tiene que leer
--       "llegaste al tope", no "confirmá disponibilidad".
--   (b) la marca attrs.availability_confirmed_at cuando la confirmación viene.
drop function if exists public.renovar_publicacion(uuid);

create function public.renovar_publicacion(
  p_listing                 uuid,
  p_confirma_disponibilidad boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := app.current_tenant_id();
  v_cfg     public.listing_expiry_config;
  v_row     public.listings;
  v_expires timestamptz;
  v_warn    timestamptz;
  v_desde   timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para renovar una publicación.';
  end if;

  -- La propiedad se verifica acá y no con la RLS: la función es definer.
  select * into v_row
    from public.listings
   where id         = p_listing
     and tenant_id  = v_tenant
     and created_by = v_uid;

  -- No se distingue "no existe" de "no es tuyo": confirmarle a alguien que un
  -- aviso ajeno existe ya es información (criterio de 0096).
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;

  -- 'closed' cae acá y es lo correcto: un aviso cerrado no se renueva, se
  -- vuelve a publicar (y a moderar). Renovarlo sería devolver al muro un
  -- alquiler que ya se alquiló, que es el problema que esta migración resuelve.
  if v_row.status not in ('published', 'expired') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'status', v_row.status);
  end if;

  v_cfg := app.listing_expiry_config(v_tenant);

  if not (v_row.kind = any (v_cfg.kinds_que_vencen)) then
    return jsonb_build_object('ok', false, 'motivo', 'no_vence');
  end if;

  if v_cfg.renovaciones_maximas is not null
     and v_row.renewal_count >= v_cfg.renovaciones_maximas then
    return jsonb_build_object(
      'ok', false, 'motivo', 'tope_alcanzado',
      'renovaciones_maximas', v_cfg.renovaciones_maximas
    );
  end if;

  -- Todavía falta mucho: no se renueva. Ver la Decisión 5 de la 0098 — sin
  -- esta puerta, "renovar" es un botón para acumular meses el día 1.
  if v_row.status = 'published'
     and (v_row.expiry_warn_at is null or v_row.expiry_warn_at > now()) then
    return jsonb_build_object(
      'ok', false, 'motivo', 'todavia_no',
      'expires_at', v_row.expires_at,
      'renovable_desde', v_row.expiry_warn_at
    );
  end if;

  -- ── RECONFIRMACIÓN DE DISPONIBILIDAD (0117) ──────────────────────────────
  -- Desde la PRIMERA aprobación, que renovar no toca justamente para poder
  -- medir la edad real del aviso. `created_at` es el respaldo: un aviso sin
  -- published_at no puede quedar exento por un dato que falta.
  --
  -- Va ÚLTIMA a propósito: es la única guarda que la persona puede levantar
  -- desde la misma pantalla, sin abandonar lo que estaba haciendo. Las cinco
  -- de arriba son "no se puede"; ésta es "contestame una cosa".
  --
  -- No mira attrs.availability_confirmed_at: confirmar una vez no exime de la
  -- próxima. Lo que se busca es un acto humano fresco por ciclo, no una casilla
  -- tildada en marzo que valga en diciembre.
  v_desde := coalesce(v_row.published_at, v_row.created_at);

  if v_desde < now() - interval '60 days'
     and not coalesce(p_confirma_disponibilidad, false) then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'necesita_confirmar_disponibilidad',
      'publicada_desde', v_desde,
      'dias_publicada', floor(extract(epoch from (now() - v_desde)) / 86400)::int
    );
  end if;

  select d.expires_at, d.expiry_warn_at
    into v_expires, v_warn
    from app.listing_expiry_dates(v_tenant, v_row.kind) d;

  -- Bandera LOCAL a la transacción: es lo único que le permite a un JWT de
  -- usuario mover las columnas de vencimiento, y se apaga sola al terminar.
  perform set_config('app.renovando_publicacion', 'on', true);

  update public.listings
     set status           = 'published',
         expires_at       = v_expires,
         expiry_warn_at   = v_warn,
         expiry_warned_at = null,
         expired_at       = null,
         renewal_count    = renewal_count + 1,
         renewed_at       = now(),
         -- La marca sirve para contar "confirmado hace 3 días" y para auditar;
         -- NO para saltear la pregunta del ciclo siguiente. Mismo to_jsonb(now())
         -- que attrs.lf_resolved_at (0096), para que la app lea un solo formato.
         attrs            = case
                              when coalesce(p_confirma_disponibilidad, false)
                                then jsonb_set(
                                       coalesce(attrs, '{}'::jsonb),
                                       '{availability_confirmed_at}',
                                       to_jsonb(now())
                                     )
                              else attrs
                            end
   where id        = p_listing
     and tenant_id = v_tenant;

  perform set_config('app.renovando_publicacion', 'off', true);

  -- `published_at` NO se toca: renovar devuelve el plazo, no la posición. Ver la
  -- Decisión 5 de la 0098 — bumpear sería un boost gratis e infinito. Y además
  -- es lo que mantiene medible la edad del aviso para la reconfirmación.
  return jsonb_build_object(
    'ok', true,
    'expires_at', v_expires,
    'renewal_count', v_row.renewal_count + 1,
    'dias_de_vigencia', v_cfg.dias_de_vigencia,
    'disponibilidad_confirmada', coalesce(p_confirma_disponibilidad, false)
  );
end;
$$;

comment on function public.renovar_publicacion(uuid, boolean) is
  'Renueva una publicación propia por otro ciclo completo (0098): reinicia expires_at, limpia el aviso previo y, si estaba vencida, la devuelve a published. NO toca published_at — renovar da plazo, no posición. Desde 0117, si la publicación tiene más de 60 días desde su primera aprobación, exige p_confirma_disponibilidad => true y devuelve motivo ''necesita_confirmar_disponibilidad'' si no viene: es la red de contención para el aviso que se alquiló y nadie cerró, hecha en el único momento en que la persona ya está mirando la pantalla. Se pregunta en CADA renovación pasados los 60 días; attrs.availability_confirmed_at registra la última confirmación pero no exime de la próxima. El parámetro es el SEGUNDO y tiene default false, así que la llamada de un solo argumento sigue funcionando. Devuelve jsonb con el motivo cuando no se puede: la pantalla necesita distinguir "todavía no" de "llegaste al tope" de "confirmá que sigue disponible".';

-- GRANTS EXPLÍCITOS, idénticos a los de la firma vieja. Sin esto la función
-- nace inaccesible y PostgREST responde 404 "function not found" — que se lee
-- como un bug de la app, no como un permiso faltante (doctrina 0085/0082).
revoke all    on function public.renovar_publicacion(uuid, boolean) from public, anon;
grant execute on function public.renovar_publicacion(uuid, boolean) to authenticated, service_role;

commit;

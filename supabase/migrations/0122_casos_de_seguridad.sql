-- =============================================================================
-- 0122_casos_de_seguridad.sql — Comunidad Latina
--
-- El Escudo (0005, 0014, 0118) sabe RECIBIR denuncias, PAUSAR avisos solo y
-- VERIFICAR matrículas contra registros oficiales. Lo que no sabe es DECIRLO.
-- Hoy /escudo enseña a cuidarse y abre un formulario de denuncia, y ahí termina:
-- quien entra no tiene una sola forma de saber si del otro lado pasa algo.
--
-- Una plataforma de seguridad que no muestra evidencia pide exactamente lo que
-- le enseña a no dar: confianza sin verificar. Esta migración pone las dos
-- mitades que faltaban, y son de naturalezas distintas a propósito:
--
--   1. LOS NÚMEROS — agregados que salen de las tablas reales (scam_reports,
--      audit_log, verification_checks, moderation_queue) por una sola función.
--      Nadie los escribe a mano, y por eso son chicos: la base tiene meses, no
--      años. Chico y cierto le gana a grande e inventado en cualquier pantalla,
--      y en ÉSTA la diferencia es el producto entero.
--
--   2. LOS CASOS — historias cortas, anónimas, escritas por el equipo. No salen
--      de ninguna denuncia: se PARECEN a muchas. La sección 2 explica por qué
--      esa distancia es obligatoria y no una comodidad editorial.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POR QUÉ UNA TABLA Y NO UNA CONSTANTE EN TYPESCRIPT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La educación del Escudo ya vive hardcodeada: las cinco señales de alerta son
-- un array en `escudo/aprender/page.tsx` y está bien que lo sean — son cinco,
-- son universales y no cambian nunca. Los casos no se parecen a eso:
--
--   · CAMBIAN POR COMUNIDAD. La estafa que más duele en `dominicanos` no es la
--     misma que en `comunidadlatina`. Un array compartido obliga a mostrarle a
--     todos el mínimo común, que es la forma más rápida de que no le sirva a
--     nadie. `tenant_id null` = caso de plataforma (lo ven todas); con tenant =
--     caso de esa comunidad. Mismo criterio que `guides` (0007) y
--     `community_resources` (0096).
--   · SE ESCRIBEN CUANDO PASAN. Un caso nuevo no puede esperar al próximo
--     deploy: quien modera lo carga el día que lo ve.
--   · NECESITAN UN BORRADOR. `status = 'draft'` existe para que nada salga sin
--     que alguien lo lea dos veces. Un array en el código no tiene ese estado:
--     lo que se mergea, se publica.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA DECISIÓN QUE DEFINE ESTA TABLA: NO HAY FOREIGN KEY AL CASO REAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Lo natural sería `report_id references public.scam_reports(id)`. Sería un
-- error grave, y de los que no se ven hasta que es tarde.
--
-- El §5.4 del PLAN_MAESTRO no dice "protegé el dato": dice que la ÚNICA defensa
-- contra una subpoena es que el dato NO EXISTA. Esta app agrega población
-- deportable y es, por su existencia, un objetivo. Una FK del caso público a la
-- denuncia es, literalmente, un índice: "este relato — que además está publicado
-- y fechado — corresponde a ESTA denuncia, hecha por ESTA cuenta, contra ESTA
-- otra". Eso es un expediente armado por nosotros y entregable de un `join`.
--
-- Por eso acá NO hay `report_id`, NI `listing_id`, NI `profile_id`, NI
-- `moderation_queue_id`. Ninguno. No es una simplificación ni un "por ahora":
-- es el modelo. Un caso es una LECCIÓN, no un REGISTRO — el registro ya existe
-- en `scam_reports`, con su RLS, su retención de 365 días y su acceso de staff,
-- y ahí se queda.
--
-- ── LO QUE SE DESCARTÓ, Y POR QUÉ ───────────────────────────────────────────
--
--   (a) GENERAR LOS CASOS AUTOMÁTICAMENTE DESDE `scam_reports.details`.
--       Tentador: los casos se escribirían solos. Es la peor de las opciones.
--       `details` es texto libre que una persona escribe ACUSANDO a otra: trae
--       nombres, teléfonos y direcciones por construcción, no está verificado, y
--       publicarlo es difamación con nuestro logo arriba. Que una denuncia
--       exista no la hace cierta — para eso está la cola de moderación.
--
--   (b) LA TABLA CON FK PERO CON LA FK "SÓLO PARA STAFF".
--       No cambia nada. La RLS filtra quién lee, no qué existe; una subpoena no
--       se presenta con un JWT. El vínculo hay que no tenerlo, no esconderlo.
--
--   (c) ANONIMIZAR UN CASO REAL "LO SUFICIENTE".
--       Con una comunidad de barrio, "un cuarto en Corona, en mayo, con seña por
--       transferencia" alcanza para que tres personas sepan de quién se habla.
--       La anonimización se rompe con el contexto local, que es exactamente el
--       contexto de este producto.
--
-- ── LA CONSECUENCIA HONESTA: `origin` ───────────────────────────────────────
-- Si los casos no salen de una fila, entonces NO SON casos puntuales, y la
-- pantalla no puede insinuar que lo sean. `origin` obliga a decirlo:
--
--     'patron' → patrón documentado por el equipo. No es un hecho puntual: es la
--                forma que se repite. Sin fecha, porque no tiene una.
--     'caso'   → algo que sí pasó en esta comunidad. Lleva `occurred_month`
--                OBLIGATORIO — y un MES, nunca un día (ver 2.b).
--
-- La UI muestra etiquetas distintas para cada uno. Sin esta columna, la tabla se
-- convierte en la primera métrica falsa de una pantalla de seguridad, que es la
-- única cosa que esta pantalla no puede permitirse.
--
-- ── 2.b POR QUÉ UN MES Y NO UNA FECHA ───────────────────────────────────────
-- `occurred_month` es `date` con CHECK de día 1: se guarda 2026-05-01 y se lee
-- "mayo de 2026". Un día exacto, cruzado con el aviso que desapareció esa
-- semana, vuelve a identificar a alguien. Un mes conserva lo único que el
-- lector necesita —qué tan reciente es— y tira el resto. Misma familia de
-- decisión que `post_views`/`listing_views` (día, no timestamp) en 0038 y 0048.
--
-- ── 2.c EL PISO AUTOMÁTICO CONTRA LA PII ────────────────────────────────────
-- `app.texto_sin_datos_de_contacto()` rechaza en la base cualquier texto con
-- arroba, con http(s):// o con una tira de 7 dígitos o más. NO es la defensa
-- —la defensa es el criterio de quien escribe— es el piso: el error de pegar un
-- teléfono o un mail en el resumen es el que más fácil se cuela y el único que
-- una máquina puede atajar sola. La app repite el chequeo antes de renderizar
-- (`src/lib/escudo/anonimato.ts`), a propósito: una fila cargada por
-- `service_role` desde un script se saltea el CHECK igual que se saltea la RLS.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LOS NÚMEROS: UNA SOLA FUNCIÓN, VENTANA DE 365 DÍAS, SIN IDENTIDAD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public.escudo_transparencia(uuid)` devuelve UN jsonb con todos los
-- contadores. Tres decisiones adentro:
--
-- ── POR QUÉ SECURITY DEFINER ────────────────────────────────────────────────
-- No es comodidad: sin definer la pantalla no puede existir. `scam_reports_select`
-- sólo le muestra a cada quien SUS denuncias, `moderation_queue` y `audit_log`
-- son de staff, y un aviso pausado no está `published`, así que tampoco se ve.
-- Bajo RLS, cualquier persona contaría exactamente cero de todo. La función es
-- lo que convierte datos cerrados en un número público SIN abrir las filas: lo
-- que sale de acá son enteros y una mediana. Ni un id, ni un título, ni una
-- fecha de fila. No hay nada que reidentificar en un `count(*)`.
--
-- ── POR QUÉ 365 DÍAS Y NO "DESDE SIEMPRE" ───────────────────────────────────
-- Porque "desde siempre" sería mentira, y de la peor clase: la que se vuelve
-- mentira sola. `scam_reports` resueltos, `moderation_queue` resueltas y
-- `audit_log` entero se purgan a los 365 días por pg_cron (0013). Un total
-- histórico ENCOGERÍA con el tiempo sin que nadie tocara nada, y quien mirara
-- dos veces la misma pantalla vería bajar un número que sólo puede subir.
-- La ventana es exactamente la retención: el número que se muestra es el que la
-- base puede sostener. `verificaciones_vigentes` es la única excepción y es de
-- otra naturaleza —un stock, no un flujo—: cuántas matrículas figuran activas
-- HOY. La pantalla las rotula distinto por eso.
--
-- ── POR QUÉ LA MEDIANA Y NO EL PROMEDIO ─────────────────────────────────────
-- Con pocas revisiones, un solo caso que quedó abierto un fin de semana largo
-- mueve el promedio a "cuatro días" y describe algo que no pasó nunca. La
-- mediana aguanta el caso raro. Y con menos de un puñado de revisiones resueltas
-- ni la mediana significa nada: la app tiene el umbral (`MINIMO_PARA_MEDIANA`) y
-- cuando no se llega NO muestra un número, muestra por qué todavía no lo hay.
-- Acá abajo se devuelve el dato crudo y el conteo que permite juzgarlo; decidir
-- es de la capa que lo muestra.
--
-- ⚠️ EL TIEMPO ES EL DE LA COLA DE MODERACIÓN, no el de la denuncia.
-- `scam_reports` no tiene `resolved_at` — se sabe en qué estado está, no cuándo
-- llegó a él. `moderation_queue` sí (`created_at` → `resolved_at`), así que la
-- métrica sale de ahí y la pantalla la rotula con esas palabras. Poner "tardamos
-- X en resolver una denuncia" midiendo otra cosa sería el tipo de imprecisión
-- que en esta pantalla se paga cara.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LA PAUSA AUTOMÁTICA NO DEJABA RASTRO — Y ES EL NÚMERO QUE MÁS IMPORTA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Cuántos avisos se pausaron solos" es LA cifra de esta pantalla: es la única
-- que dice que el sistema actúa y no sólo escucha. Y hasta hoy no se podía
-- responder.
--
-- La 0118 marca el aviso con `attrs.paused_reason = 'reports'` y, cuando lo
-- restituye, BORRA la marca (a propósito: dejarla vieja haría que la próxima
-- pausa manual del dueño se leyera como automática). O sea que el estado sólo
-- sabe contar lo que está pausado AHORA MISMO. Un aviso pausado en abril y
-- restituido en mayo no dejó una sola huella: el sistema hizo su trabajo dos
-- veces y no quedó constancia de ninguna.
--
-- Se agrega un trigger sobre `listings` que escribe las dos transiciones en
-- `audit_log` — la tabla que este repo ya usa para "acciones admin/sistema", con
-- su TTL de 365 días, que es justo la ventana de la sección 3.
--
-- ── POR QUÉ UN TRIGGER NUEVO Y NO REESCRIBIR LA FUNCIÓN DE LA 0118 ──────────
-- Se podía `create or replace app.reconciliar_pausa_por_denuncias()` acá y
-- meterle el insert. Se descartó: obligaría a copiar sus ~130 líneas (los dos
-- CTE, las notificaciones, las cuatro guardas) en un archivo que no las trata, y
-- desde el próximo cambio en la 0118 habría dos versiones de la misma lógica en
-- dos migraciones, con la sutileza de que la que gana es la de número más alto.
-- El trigger de acá observa el EFECTO —el aviso cambió de estado y la marca dice
-- por qué— y no toca la causa. Si la 0118 cambia por dentro, esto sigue siendo
-- cierto.
--
-- ── QUÉ SE GUARDA, Y QUÉ NO ─────────────────────────────────────────────────
-- `actor_id` va NULL: no lo hizo una persona, lo hizo la acumulación. Y sobre
-- todo NO se escribe quién denunció: `audit_log` es de staff, pero la sección 2
-- vale igual acá — un renglón que ate "aviso pausado" con "estas tres cuentas lo
-- denunciaron" es el grafo que el §5.4 pide no construir. Se guarda el sujeto
-- (el aviso) y el motivo. Nada más.
--
-- ── EL WHEN HACE TODO EL TRABAJO ────────────────────────────────────────────
-- `listings` es la tabla más caliente del producto. La condición completa vive
-- en el WHEN del trigger, no adentro de la función: en el 99,99% de los UPDATE
-- —un título, un precio, un contador— Postgres ni llama a plpgsql.
--
-- Se cuenta también la RESTITUCIÓN, y no por completitud: un sistema que sólo
-- publica cuántos frenó y se calla cuántos devolvió está eligiendo la mitad que
-- lo favorece. La pantalla muestra las dos.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · No toca `scam_reports`, ni sus policies, ni su retención. La 0118 es su
--     archivo y su historia; acá sólo se la LEE agregada.
--   · No crea una segunda cola de moderación. Los casos son contenido editorial
--     curado, no trabajo pendiente (mismo argumento de la 0093 y la 0118).
--   · No guarda quién leyó la pantalla. Una tabla de "quién miró la sección de
--     seguridad" es telemetría sobre gente preocupada: exactamente el dato que
--     el §5.4 dice no juntar. Si algún día hay que medir la pantalla, se mide
--     con un contador sin identidad, como `cta_clicks` (0048).
--   · No expone el detalle de ninguna denuncia por API. De `scam_reports` salen
--     de acá enteros y nada más.
--   · No siembra ningún caso con `origin = 'caso'`. Los cuatro que van abajo son
--     patrones, y así se rotulan. Sembrar un "caso real" escrito por nosotros
--     sería inventar la evidencia en la pantalla que existe para no inventarla.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. El piso automático contra la PII (sección 2.c)
-- ---------------------------------------------------------------------------
-- IMMUTABLE porque la usan CHECKs: sólo mira su argumento y no consulta nada.
-- STRICT no: un texto NULL es un campo opcional vacío y tiene que pasar — los
-- CHECK de abajo lo dejan explícito igual, pero que la función sea total evita
-- que el próximo que la use se coma un NULL silencioso.
create or replace function app.texto_sin_datos_de_contacto(p_texto text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_texto is null
     -- Arroba: cubre mails y menciones de red social de una sola vez. Ningún
     -- relato anónimo necesita una: si aparece, es alguien pegando un dato.
     or (p_texto !~ '@'
     -- Enlaces. Un caso no cita fuentes (eso es `guides`, 0007): un http acá es
     -- casi siempre un perfil o un aviso que alguien quiso señalar.
     and p_texto !~* 'https?://'
     -- Siete dígitos seguidos. Un teléfono de EE. UU. tiene diez; un precio
     -- ("$2,400"), un año ("2026") y un monto ("1100") no llegan a siete.
     and p_texto !~ '[0-9]{7}');
$$;

comment on function app.texto_sin_datos_de_contacto(text) is
  'Piso automático de anonimato para los relatos de security_cases (0122): rechaza arroba, http(s):// y tiras de 7+ dígitos. NO es la defensa —esa es el criterio de quien escribe, y la app repite el chequeo antes de renderizar porque service_role se saltea los CHECK igual que la RLS—: es la red que ataja el error más común, pegar un teléfono o un mail dentro del resumen.';

-- ---------------------------------------------------------------------------
-- 2. Los casos
-- ---------------------------------------------------------------------------
create table if not exists public.security_cases (
  id              uuid primary key default app.uuid_v7(),
  -- null = caso de plataforma, lo ven todas las comunidades. Igual que `guides`
  -- (0007) y `community_resources` (0096).
  tenant_id       uuid references public.tenants(id),

  -- Identificador estable para poder enlazar un caso concreto y para que
  -- resembrar esta migración no duplique nada.
  slug            text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                                       and char_length(slug) between 3 and 80),

  -- Dónde ocurre. Cerrado a propósito, mismo motivo que `community_resources.topic`:
  -- una lista libre se vuelve veinte sinónimos y la pantalla deja de agrupar.
  vertical        text not null check (vertical in (
                    'vivienda', 'empleo', 'marketplace', 'servicios', 'mensajes', 'cuenta'
                  )),

  -- LA COLUMNA DE LA SECCIÓN 2. 'patron' = forma que se repite, sin fecha.
  -- 'caso' = pasó acá, y entonces `occurred_month` es obligatorio.
  origin          text not null default 'patron' check (origin in ('caso', 'patron')),

  -- MES, nunca un día (sección 2.b). El CHECK de día 1 hace imposible guardar
  -- una fecha exacta "por comodidad" y que después alguien la muestre.
  occurred_month  date check (occurred_month is null or extract(day from occurred_month) = 1),

  title           text not null check (char_length(btrim(title)) between 8 and 90),
  -- Qué pasó.
  summary         text not null check (char_length(btrim(summary)) between 40 and 700),
  -- Qué lo delató. Es el corazón del caso: la señal que se puede reconocer.
  signal          text not null check (char_length(btrim(signal)) between 20 and 400),
  -- Qué hizo el sistema — incluido "no hizo nada", que es una respuesta válida
  -- y la más importante de todas cuando es la verdad.
  response        text not null check (char_length(btrim(response)) between 20 and 500),
  -- Qué hacer si te pasa a vos.
  advice          text not null check (char_length(btrim(advice)) between 20 and 400),

  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Un caso puntual sin fecha no se puede rotular ("¿de cuándo es esto?") y un
  -- patrón CON fecha se leería como un hecho puntual, que es justo lo que la
  -- columna `origin` existe para no dejar pasar.
  constraint security_cases_fecha_segun_origen check (
    (origin = 'caso'   and occurred_month is not null) or
    (origin = 'patron' and occurred_month is null)
  ),

  -- El piso de anonimato sobre los cinco textos que se LEEN. `slug` y `vertical`
  -- no lo necesitan: son vocabularios cerrados.
  constraint security_cases_sin_datos_de_contacto check (
    app.texto_sin_datos_de_contacto(title)
    and app.texto_sin_datos_de_contacto(summary)
    and app.texto_sin_datos_de_contacto(signal)
    and app.texto_sin_datos_de_contacto(response)
    and app.texto_sin_datos_de_contacto(advice)
  )
);

-- Un slug por comunidad. `nulls not distinct` para que los casos globales
-- (tenant_id null) también choquen entre sí — sin eso, "global" sería el único
-- lugar donde se pueden cargar dos casos con el mismo slug.
create unique index if not exists security_cases_slug_idx
  on public.security_cases (tenant_id, slug) nulls not distinct;

-- El índice de la pantalla: los publicados de una comunidad (o globales),
-- ordenados como se muestran. Parcial sobre 'published' porque los borradores no
-- se listan nunca.
create index if not exists security_cases_publicados_idx
  on public.security_cases (tenant_id, occurred_month desc nulls last, created_at desc)
  where status = 'published';

comment on table public.security_cases is
  'Casos de seguridad ANONIMIZADOS que se publican en /escudo/transparencia (0122). NO TIENE NI UNA FK AL HECHO REAL —ni a scam_reports, ni a listings, ni a profiles— y eso es el modelo, no una simplificación: una FK del relato público a la denuncia es un expediente reidentificable de un join, exactamente lo que el §5.4 pide que no exista. Un caso es una lección; el registro sigue viviendo en scam_reports con su RLS y su retención. tenant_id null = caso de plataforma, igual que guides y community_resources. Curado por admins: la RLS de escritura sólo admite domain_admin/global_admin.';
comment on column public.security_cases.origin is
  'La honestidad de la pantalla, hecha columna. ''patron'' = forma que se repite, documentada por el equipo, SIN fecha porque no tiene una. ''caso'' = pasó en esta comunidad, y entonces occurred_month es obligatorio. La UI los rotula distinto: sin esta columna, un patrón bien escrito se lee como un hecho puntual y la pantalla que existe para no inventar evidencia estaría inventándola.';
comment on column public.security_cases.occurred_month is
  'MES en que ocurrió (día 1 forzado por CHECK), nunca la fecha exacta. Un día preciso, cruzado con el aviso que desapareció esa semana, vuelve a identificar a alguien; el mes conserva lo único que el lector necesita —qué tan reciente es— y tira el resto. Misma familia que post_views/listing_views, que guardan el día y no el timestamp.';
comment on column public.security_cases.response is
  'Qué hizo el sistema. Incluye "no hizo nada" cuando ésa es la verdad: un caso que lo cortó la persona y no la plataforma es el que más credibilidad le da a la pantalla, y el que más le enseña a quien lo lee.';
comment on column public.security_cases.signal is
  'La señal concreta que delató el intento. Es lo único del caso que el lector se lleva puesto y puede reconocer mañana en otro lado.';

create trigger security_cases_set_updated_at
before update on public.security_cases
for each row execute function extensions.moddatetime(updated_at);

alter table public.security_cases enable row level security;
alter table public.security_cases force  row level security;

-- Las CUATRO policies canónicas, ni una más (gate `npm run check:rls`).
-- Forma calcada de `community_resources` (0096), que es la tabla hermana:
-- contenido curado, lo publicado es público, los borradores los ve quien cura.
create policy security_cases_select on public.security_cases
for select to anon, authenticated
using (
  status = 'published'
  or (
    tenant_id is not null
    and tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
  or (select app.is_global_admin())
);

-- Curaduría: un domain_admin carga casos DE SU comunidad. Los globales
-- (tenant_id null) sólo entran por service_role — no matchean este check.
create policy security_cases_insert on public.security_cases
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy security_cases_update on public.security_cases
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy security_cases_delete on public.security_cases
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- GRANTS EXPLÍCITOS. La 0085 lo dejó escrito con sangre: los default privileges
-- de este schema (compartido con otro producto) no incluyen a `anon`, así que
-- una tabla nueva NACE sin acceso. Sin grant, Postgres ni llega a evaluar la
-- policy: la pantalla se ve VACÍA y sin un solo error.
revoke all on table public.security_cases from anon, authenticated;
grant select                         on table public.security_cases to anon;
grant select, insert, update, delete on table public.security_cases to authenticated;
grant all                            on table public.security_cases to service_role;

-- ---------------------------------------------------------------------------
-- 3. La pausa automática deja rastro (sección 4)
-- ---------------------------------------------------------------------------
-- Escribe en `audit_log` las dos transiciones que hace la 0118. No la reemplaza
-- ni la conoce: observa el efecto sobre `listings` y lee la marca que ella pone.
create or replace function app.registrar_pausa_automatica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (tenant_id, actor_id, action, subject_kind, subject_id, meta)
  values (
    new.tenant_id,
    -- NULL a propósito: no lo decidió una persona, lo decidió la acumulación.
    -- Y NO se escribe quién denunció: un renglón que ate "aviso pausado" con las
    -- cuentas que lo denunciaron es el grafo que el §5.4 pide no construir.
    null,
    case when new.status = 'paused'
         then 'listing.auto_paused_reports'
         else 'listing.auto_restored_reports'
    end,
    'listing',
    new.id,
    jsonb_build_object('reason', 'reports')
  );
  return null;
end;
$$;

comment on function app.registrar_pausa_automatica() is
  'AFTER UPDATE sobre listings (0122): deja en audit_log las dos transiciones de la pausa automática por denuncias (0118). Existe porque esa automatización no dejaba rastro: la marca attrs.paused_reason se BORRA al restituir, así que el estado sólo sabía contar lo pausado AHORA y un aviso pausado en abril y devuelto en mayo no dejaba constancia de nada. Es un trigger aparte y no un create-or-replace de app.reconciliar_pausa_por_denuncias() para no tener dos copias de esa lógica en dos migraciones: éste observa el EFECTO y sobrevive a que la 0118 cambie por dentro. security definer porque audit_log no admite INSERT por API.';

revoke execute on function app.registrar_pausa_automatica() from public, anon;

-- LA CONDICIÓN COMPLETA VIVE ACÁ, no adentro de la función: `listings` es la
-- tabla más caliente del producto y en el 99,99% de los UPDATE —un título, un
-- precio, un contador— Postgres ni llega a llamar a plpgsql.
--
-- `attrs->>'paused_reason'` se lee de NEW al pausar y de OLD al restituir,
-- porque la 0118 escribe la marca en el primer caso y la borra en el segundo.
drop trigger if exists listings_registrar_pausa_automatica on public.listings;
create trigger listings_registrar_pausa_automatica
after update of status on public.listings
for each row
when (
  (old.status = 'published' and new.status = 'paused'
     and new.attrs->>'paused_reason' = 'reports')
  or
  (old.status = 'paused' and new.status = 'published'
     and old.attrs->>'paused_reason' = 'reports')
)
execute function app.registrar_pausa_automatica();

-- Parcial y angosto: la pantalla pregunta SIEMPRE por estas dos acciones dentro
-- de una ventana de tiempo, y `audit_log_tenant_idx` obligaría a filtrar por
-- `action` sobre todas las filas del tenant. Sin CONCURRENTLY porque
-- apply-migrations.mjs envuelve cada archivo en begin/commit (ver la 0112).
create index if not exists audit_log_pausas_automaticas_idx
  on public.audit_log (tenant_id, action, created_at desc)
  where action in ('listing.auto_paused_reports', 'listing.auto_restored_reports');

-- Lo mismo para la mediana de revisión: `moderation_queue` sólo tenía índice
-- sobre lo PENDIENTE (moderation_queue_open_idx), que es exactamente el
-- complemento de lo que esta pantalla lee.
create index if not exists moderation_queue_resueltas_idx
  on public.moderation_queue (tenant_id, resolved_at desc)
  where resolved_at is not null;

-- ---------------------------------------------------------------------------
-- 4. Los números (sección 3)
-- ---------------------------------------------------------------------------
create or replace function public.escudo_transparencia(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ventana as (
    -- 365 días = la retención real de pg_cron (0013). Ver la sección 3: un
    -- total "desde siempre" encogería solo, y un número de seguridad que baja
    -- sin que nadie toque nada es peor que no mostrarlo.
    select now() - interval '365 days' as desde, 365 as dias
  ),
  denuncias as (
    select
      count(*)                                                as recibidas,
      count(*) filter (where r.status = 'upheld')             as confirmadas,
      count(*) filter (where r.status in ('open','reviewing')) as en_revision
      from public.scam_reports r, ventana v
     where r.tenant_id  = p_tenant
       and r.created_at >= v.desde
  ),
  pausas as (
    select
      count(*) filter (where a.action = 'listing.auto_paused_reports')   as pausados,
      count(*) filter (where a.action = 'listing.auto_restored_reports') as restituidos
      from public.audit_log a, ventana v
     where a.tenant_id  = p_tenant
       and a.action in ('listing.auto_paused_reports', 'listing.auto_restored_reports')
       and a.created_at >= v.desde
  ),
  verificaciones as (
    -- 'found_active' es el único resultado que afirma algo: la matrícula
    -- FIGURABA ACTIVA en el registro oficial el día que se consultó. Los otros
    -- tres (not_found / expired / mismatch) son consultas hechas, no
    -- verificaciones logradas, y contarlas sería inflar la cifra con lo que
    -- salió mal.
    select count(*) as activas
      from public.verification_checks c, ventana v
     where c.tenant_id  = p_tenant
       and c.result     = 'found_active'
       and c.checked_at >= v.desde
  ),
  revisiones as (
    select
      count(*) as resueltas,
      -- Mediana, no promedio: con pocos casos un fin de semana largo describe
      -- algo que no pasó nunca. Quién decide si la muestra alcanza para
      -- mostrarla es la capa de arriba, que también recibe `resueltas`.
      percentile_cont(0.5) within group (
        order by extract(epoch from (m.resolved_at - m.created_at)) / 3600.0
      ) as horas_mediana
      from public.moderation_queue m, ventana v
     where m.tenant_id   = p_tenant
       and m.resolved_at is not null
       and m.resolved_at >= v.desde
  )
  select jsonb_build_object(
    'ventana_dias',            (select dias from ventana),
    'generado_at',             now(),
    'denuncias_recibidas',     d.recibidas,
    'denuncias_confirmadas',   d.confirmadas,
    'denuncias_en_revision',   d.en_revision,
    'avisos_pausados',         p.pausados,
    'avisos_restituidos',      p.restituidos,
    'verificaciones_activas',  vc.activas,
    'revisiones_resueltas',    rv.resueltas,
    'revision_horas_mediana',  round(rv.horas_mediana::numeric, 1)
  )
    from denuncias d, pausas p, verificaciones vc, revisiones rv;
$$;

comment on function public.escudo_transparencia(uuid) is
  'Los números de /escudo/transparencia, en UN solo jsonb (0122). SECURITY DEFINER por necesidad y no por comodidad: bajo RLS cualquier persona contaría CERO de todo —scam_reports sólo muestra las denuncias propias, moderation_queue y audit_log son de staff, y un aviso pausado no está published—, así que sin definer la pantalla no puede existir. Lo que sale de acá son enteros y una mediana: ni un id, ni un título, ni una fecha de fila; no hay nada que reidentificar en un count(*). Ventana de 365 días = la retención real de pg_cron (0013): un total "desde siempre" encogería solo con cada purga.';

-- LA REGLA DE LA 0083: toda función nueva nace con EXECUTE para PUBLIC (y anon
-- lo hereda), así que se revoca a mano y después se otorga a quien corresponde.
-- Acá SÍ va anon: son las cifras públicas del Escudo, del mismo orden de
-- transparencia que `verification_checks`, que ya tiene lectura pública.
revoke execute on function public.escudo_transparencia(uuid) from public, anon, authenticated;
grant  execute on function public.escudo_transparencia(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Los cuatro primeros: PATRONES, no casos
-- ---------------------------------------------------------------------------
-- `tenant_id null` = los ven todas las comunidades. Y `origin = 'patron'` en los
-- cuatro, que es la única forma honesta de sembrar esta tabla: son las formas
-- que se repiten, no hechos puntuales. Sembrar un "caso real" escrito por
-- nosotros sería inventar la evidencia en la pantalla que existe justamente para
-- no inventarla.
--
-- Cada uno muestra UNA defensa distinta, y el cuarto muestra a propósito que no
-- hubo ninguna: es el que le da credibilidad al resto y el que más le enseña a
-- quien lo lee.
insert into public.security_cases
  (tenant_id, slug, vertical, origin, title, summary, signal, response, advice, status, published_at)
values
  (
    null,
    'sena-antes-de-ver-el-lugar',
    'vivienda',
    'patron',
    'La seña que se pide antes de abrir la puerta',
    'Un cuarto en alquiler con fotos lindas y un precio bastante por debajo de la zona. Quien lo publicó pedía una seña por transferencia para "guardarlo", y cada vez que le proponían una visita aparecía una excusa distinta: el inquilino anterior, una obra, un viaje. En pocos días varias personas de la comunidad denunciaron el mismo aviso.',
    'El pedido de plata llegó antes que la dirección. Ningún alquiler real empieza cobrando por reservar una visita.',
    'Cuando se juntaron denuncias suficientes, el aviso se pausó solo y salió de circulación esa misma noche, sin esperar a que un moderador entrara al panel. La revisión humana vino después.',
    'Si te piden seña antes de que veas el lugar, no mandes nada y denunciá el aviso. Tu denuncia no queda ahí: es lo que lo saca de circulación para todos, no sólo para vos.',
    'published',
    now()
  ),
  (
    null,
    'el-trabajo-que-te-cobra-por-empezar',
    'empleo',
    'patron',
    'El trabajo que te cobra por empezar',
    'Un aviso de empleo de limpieza con un sueldo mejor que el resto de la zona y respuesta inmediata. En el primer mensaje ya pedían pagar por adelantado el uniforme, un curso de seguridad y "el trámite del carnet". El monto subía en cada mensaje y el puesto siempre estaba por confirmarse.',
    'El único que ponía plata era quien buscaba trabajo. Un empleo no se compra.',
    'El texto del aviso encendió la revisión humana antes de publicarse y no se publicó. Nunca llegó al listado de empleos.',
    'Si un trabajo te pide dinero para empezar, cortá ahí y reportalo. Ningún empleo serio te cobra por contratarte.',
    'published',
    now()
  ),
  (
    null,
    'las-fotos-que-ya-estaban-en-otro-aviso',
    'marketplace',
    'patron',
    'Las fotos que ya estaban en otro aviso',
    'Dos avisos del mismo departamento, publicados con semanas de diferencia por cuentas distintas. Las fotos eran las mismas: la segunda cuenta las bajó del aviso original y las volvió a subir, con otro precio, otro texto y otro contacto.',
    'El archivo era idéntico. Cambiaba todo menos la imagen, que es lo único que cuesta trabajo conseguir.',
    'Al subirlas, el sistema comparó la huella de cada foto contra las que ya tenía cargadas y avisó al equipo de que eran las mismas. La copia quedó frenada antes de publicarse.',
    'Si un aviso te da desconfianza, buscá sus fotos en internet. Cuando las mismas imágenes aparecen en otro lado con otro precio, ya sabés qué estás mirando.',
    'published',
    now()
  ),
  (
    null,
    'el-mensaje-que-dice-ser-de-la-app',
    'cuenta',
    'patron',
    'El mensaje que dice ser del equipo de la app',
    'Un mensaje privado firmado como "soporte de la comunidad" avisa que la cuenta se va a cerrar por un problema de seguridad y pide reenviar el código de seis dígitos que acaba de llegar por mensaje de texto. Ese código es el que abre la cuenta.',
    'Nadie del equipo te va a pedir nunca un código, una contraseña ni una foto de un documento por mensaje privado.',
    'Acá el sistema no frenó nada, y vale decirlo: un mensaje privado no lo leemos. Lo cortó la persona que lo recibió, que desconfió y lo denunció. Con esa denuncia la cuenta que lo mandó entró a revisión.',
    'Si te llega un mensaje así, no reenvíes el código y denunciá la conversación. Y cuando dudes de si algo es nuestro, salí del chat y entrá a la app por tu cuenta: lo que sea de verdad va a estar ahí adentro.',
    'published',
    now()
  )
on conflict (tenant_id, slug) do nothing;

commit;

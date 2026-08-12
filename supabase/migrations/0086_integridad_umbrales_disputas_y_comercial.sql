-- =============================================================================
-- 0086_integridad_umbrales_disputas_y_comercial.sql — Comunidad Latina
--
-- Cierra cinco huecos que quedaron abiertos en el módulo Content Integrity
-- (0061) y que sólo se ven cuando el módulo deja de ser un detector y pasa a ser
-- un procedimiento con consecuencias legales y comerciales:
--
--   1. Los umbrales de similitud vivían en TypeScript (`DEFAULT_MAX_DISTANCE =
--      10`, src/lib/integrity/scan.ts). Cambiar la sensibilidad del detector era
--      un deploy, y era el MISMO número para todas las comunidades. Mismo
--      argumento del pliego que motivó 0064: "configurables desde el panel, no
--      colocados permanentemente en el código".
--   2. No existía el estado "esto se puede licenciar". Un asset aprobado para
--      publicarse y un asset habilitado para VENDERSE son dos decisiones
--      distintas, con exposición distinta, y estaban colapsadas en `aprobado`.
--   3. No existía la disputa. El módulo detectaba coincidencias entre archivos,
--      pero la reclamación de una PERSONA ("eso es mío") no tenía dónde vivir.
--   4. Un reporte de "usa contenido que no le pertenece" caía en `scam_reports`
--      (0005) y moría ahí: nunca llegaba a la cola de integridad. Dos colas
--      distintas mirando el mismo hecho, sin puente.
--   5. El Trust Score no se enteraba de nada de esto: alguien podía acumular
--      assets bloqueados y disputas perdidas con el score intacto.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 1 — la disputa CONGELA, no juzga
-- -----------------------------------------------------------------------------
-- Abrir una disputa mueve el asset a `en_investigacion` y nada más. No lo
-- bloquea, no lo borra, no toca el score de nadie. Es deliberado: si abrir una
-- disputa tuviera efecto punitivo automático, la función sería un arma — se
-- abren tres disputas falsas contra un competidor y su contenido desaparece.
-- El único efecto automático es sacarlo del circuito comercial hasta que una
-- persona mire. Lo que sí es automático es la ALERTA: la disputa entra en la
-- cola del moderador el mismo segundo en que se abre.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 2 — `apto_comercial` no se alcanza sin nombre y fecha
-- -----------------------------------------------------------------------------
-- El estado que habilita a licenciar/vender contenido tiene un CHECK que exige
-- `commercial_cleared_at` y `commercial_cleared_by` no nulos. No es una
-- convención de la app: es una restricción de la base, y por lo tanto no se
-- puede saltar desde ningún camino de código, ni por un job, ni por un backfill
-- apurado. Si algún día hay que defender ante un tercero por qué se puso a la
-- venta un archivo, la respuesta tiene que ser una persona y una fecha.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 3 — la penalización de integridad NO se engancha todavía
-- -----------------------------------------------------------------------------
-- `public.integrity_penalty_for_user()` se crea y se deja SIN llamar desde
-- `app.recalc_user_score` (0037). Enganchar la señal en la misma migración que
-- la define movería scores de gente real en producción sin que nadie haya mirado
-- el impacto — y los scores tienen historial (`score_history`), o sea que el
-- salto quedaría registrado como si hubiera pasado algo. Primero se mide contra
-- datos reales, después se engancha, en su propia migración y con su propio
-- rollback. Ver el comment de la función.
--
-- -----------------------------------------------------------------------------
-- GRANTS: obligatorios, no decorativos (ver 0085)
-- -----------------------------------------------------------------------------
-- En esta base los default privileges de `public` NO son los de Supabase: una
-- tabla nueva nace con `all` para `authenticated` y NADA para `anon`. O sea que
-- ni confiar en el default ni asumir que falta: acá se revoca todo y se concede
-- exactamente lo que cada rol necesita. Sin GRANT de tabla, Postgres ni siquiera
-- evalúa la policy y la app se ve vacía sin un solo error en los logs.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Umbrales de integridad configurables por tenant
-- ---------------------------------------------------------------------------
create table if not exists public.content_integrity_settings (
  tenant_id                             uuid primary key references public.tenants(id),

  max_distance_exacto_bits              int not null default 0
                                          check (max_distance_exacto_bits between 0 and 64),
  max_distance_similar_bits             int not null default 10
                                          check (max_distance_similar_bits between 0 and 64),
  umbral_bloqueo_bits                   int not null default 4
                                          check (umbral_bloqueo_bits between 0 and 64),

  revision_humana_obligatoria_comercial boolean not null default true,
  bloquear_duplicado_de_otro_usuario    boolean not null default true,

  updated_by                            uuid references public.profiles(id) on delete set null,
  created_at                            timestamptz not null default now(),
  updated_at                            timestamptz not null default now(),

  -- Los tres umbrales son puntos de la MISMA recta de distancia, así que el
  -- orden entre ellos no es opinable: exacto <= bloqueo <= similar. Sin este
  -- CHECK, un admin puede dejar el panel en un estado donde "se bloquea solo"
  -- pasa por encima de "se considera parecido", y el detector deja de tener
  -- sentido sin que nada falle.
  constraint content_integrity_settings_orden_de_umbrales
    check (max_distance_exacto_bits <= umbral_bloqueo_bits
           and umbral_bloqueo_bits  <= max_distance_similar_bits)
);

comment on table public.content_integrity_settings is
  'Umbrales del detector de integridad, POR TENANT y editables desde el panel. Existe porque hasta ahora el número vivía en TypeScript (DEFAULT_MAX_DISTANCE = 10 en src/lib/integrity/scan.ts): era el mismo para todas las comunidades y cambiarlo era un deploy. Una comunidad de fotógrafos y una de avisos clasificados no toleran la misma sensibilidad. LA AUSENCIA DE FILA SIGNIFICA LOS DEFAULTS (criterio de 0045, 0063 y 0064): un tenant nuevo no depende de que alguien se acuerde de sembrarle la configuración.';

comment on column public.content_integrity_settings.max_distance_exacto_bits is
  'Distancia de Hamming por debajo de la cual una coincidencia se trata como el MISMO archivo. Default 0 porque el camino exacto real es sha256, que es determinístico; este número existe sólo para el caso de huellas perceptuales idénticas bit a bit. Rango 0..64 = bits de la huella de IMAGEN (phash, bit(64)). Video y audio son de 256 bits: la app normaliza el umbral a esa escala antes de comparar (ver el factor ×4 en src/lib/integrity/phash.test.ts). No se guardan tres columnas por medio a propósito — sería tres números que hay que mantener coherentes a mano.';
comment on column public.content_integrity_settings.max_distance_similar_bits is
  'Distancia máxima para levantar una alerta de `coincidencia_similar`. Default 10 = el valor que hoy está hardcodeado, para que esta migración NO cambie qué se detecta hoy. Subirlo detecta más y genera más falsos positivos; bajarlo hace lo contrario. Es el parámetro que se le pasa a find_similar_content()/scan_content_asset().';
comment on column public.content_integrity_settings.umbral_bloqueo_bits is
  'Por debajo de esta distancia la coincidencia es tan fuerte que el contenido se retiene sin esperar a un moderador. Default 4: prácticamente el mismo archivo recomprimido. NO es una acusación de plagio — es "esto no sale publicado hasta que alguien mire". Ponerlo en 0 desactiva de hecho la retención automática.';
comment on column public.content_integrity_settings.revision_humana_obligatoria_comercial is
  'Si está en true, ningún asset llega a review_status = apto_comercial sin que una persona lo habilite. Es la traducción operativa del CHECK content_assets_apto_comercial_con_revisor: el CHECK impide el estado sin revisor registrado siempre; esta bandera es la que le dice a la app que ni siquiera ofrezca el camino automático. Default true: habilitar la venta de contenido ajeno es el error caro de este módulo.';
comment on column public.content_integrity_settings.bloquear_duplicado_de_otro_usuario is
  'Si está en true, un duplicado EXACTO (sha256) de un asset de OTRO usuario del mismo tenant se retiene automáticamente. Se limita a "de otro usuario" a propósito: volver a subir un archivo propio es normal (reemplazo, otra publicación) y bloquearlo sería castigar el uso legítimo.';
comment on column public.content_integrity_settings.updated_by is
  'Quién tocó los umbrales por última vez. Bajar la sensibilidad del detector es una decisión con consecuencias legales; tiene que tener nombre.';

create index if not exists content_integrity_settings_updated_by_idx
  on public.content_integrity_settings (updated_by);

drop trigger if exists content_integrity_settings_set_updated_at on public.content_integrity_settings;
create trigger content_integrity_settings_set_updated_at
before update on public.content_integrity_settings
for each row execute function extensions.moddatetime(updated_at);

alter table public.content_integrity_settings enable row level security;
alter table public.content_integrity_settings force row level security;

-- Cualquier miembro del tenant puede LEER los umbrales: la app los necesita para
-- explicarle a quien sube por qué su archivo quedó retenido. Son reglas, no
-- datos de personas — igual criterio que creator_eligibility_config (0064).
drop policy if exists content_integrity_settings_select on public.content_integrity_settings;
create policy content_integrity_settings_select on public.content_integrity_settings
for select to authenticated
using (tenant_id = (select app.current_tenant_id()));

-- Escribe SOLO staff del tenant. Un miembro que pudiera subir
-- max_distance_similar_bits a 64 apagaría el detector de toda la comunidad.
drop policy if exists content_integrity_settings_insert on public.content_integrity_settings;
create policy content_integrity_settings_insert on public.content_integrity_settings
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  -- NO alcanza con ser staff. Un `moderator` resuelve casos; aflojar el umbral
  -- de detección de TODA la comunidad (o ponerlo en 0, que apaga el detector
  -- perceptual sin un solo error visible) es una decisión de administración.
  -- Mismo criterio que 0064 y 0087 para sus tablas de configuración.
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

drop policy if exists content_integrity_settings_update on public.content_integrity_settings;
create policy content_integrity_settings_update on public.content_integrity_settings
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

-- Borrar la fila volvería a los defaults en silencio. Se edita, no se borra.
drop policy if exists content_integrity_settings_delete on public.content_integrity_settings;
create policy content_integrity_settings_delete on public.content_integrity_settings
for delete to authenticated
using (false);

revoke all on table public.content_integrity_settings from anon, authenticated;
grant select, insert, update on table public.content_integrity_settings to authenticated;
grant all    on table public.content_integrity_settings to service_role;

-- Fila por defecto para cada tenant que ya existe. No hace falta para que el
-- sistema funcione (la lectura tiene defaults), pero materializarla es lo que
-- hace que el panel muestre valores editables desde el primer día en vez de
-- campos vacíos que el admin no sabe si están o no aplicando.
insert into public.content_integrity_settings (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

-- Lectura con defaults.
--
-- SECURITY INVOKER a propósito, aunque reciba un tenant por parámetro: si fuera
-- definer, cualquiera podría leer la configuración de otra comunidad pasando su
-- uuid. Siendo invoker, la RLS de arriba filtra y un tenant ajeno simplemente
-- "no tiene fila" → devuelve los defaults, que son públicos por definición. Y
-- `service_role` (que tiene BYPASSRLS) sigue viendo la fila real, que es lo que
-- necesita el pipeline de escaneo.
--
-- ⚠️ El row() de abajo depende del ORDEN de las columnas de la tabla. Si se
-- agrega una columna, hay que agregarla acá también (misma trampa que
-- app.creator_eligibility_config en 0064).
create or replace function app.content_integrity_settings(p_tenant uuid)
returns public.content_integrity_settings
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cfg public.content_integrity_settings;
begin
  select * into v_cfg
    from public.content_integrity_settings
   where tenant_id = p_tenant;

  if found then
    return v_cfg;
  end if;

  return row(
    p_tenant,
    0, 10, 4,
    true, true,
    null::uuid,
    '-infinity'::timestamptz,
    '-infinity'::timestamptz
  )::public.content_integrity_settings;
end;
$$;

comment on function app.content_integrity_settings(uuid) is
  'Umbrales de integridad de un tenant, o los defaults si nunca se configuró. Existe para que "no hay fila" y "hay fila" no sean dos caminos distintos en quien la consume. SECURITY INVOKER: la RLS decide qué configuración se puede leer, así que pasar un tenant ajeno no filtra nada — devuelve los defaults.';

revoke execute on function app.content_integrity_settings(uuid) from public, anon;
grant execute on function app.content_integrity_settings(uuid) to authenticated, service_role;

-- El envoltorio que consume la app. No recibe tenant: lo deriva del JWT.
create or replace function public.get_content_integrity_settings()
returns public.content_integrity_settings
language sql
stable
security invoker
set search_path = ''
as $$
  select app.content_integrity_settings((select app.current_tenant_id()));
$$;

comment on function public.get_content_integrity_settings() is
  'Umbrales de integridad del tenant de la sesión actual. NUNCA devuelve NULL ni falla: sin fila (o sin tenant en el JWT) devuelve los defaults, para que la app no tenga que tener un camino "por si no está configurado". No recibe tenant_id por parámetro a propósito — lo deriva de app.current_tenant_id(), que sale del JWT y no del cliente.';

revoke execute on function public.get_content_integrity_settings() from public, anon;
grant execute on function public.get_content_integrity_settings() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Estados comerciales del contenido
-- ---------------------------------------------------------------------------
-- El dominio de review_status crece con `apto_comercial` (el
-- `commercially_cleared` del pliego). Se hace en dos pasos —drop del CHECK viejo
-- + add del nuevo— porque Postgres no sabe "ampliar" un CHECK. Ninguna fila
-- existente puede violar el nuevo dominio: es un superconjunto del anterior.
--
-- El drop va por DO block y no por `drop constraint content_assets_review_status_check`
-- porque el CHECK de 0061 es inline sobre la columna y su nombre lo eligió
-- Postgres: asumirlo a ciegas es cómo una migración falla en un entorno y no en
-- otro. Se busca por DEFINICIÓN, que sí es estable.
do $$
declare
  v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname  = 'public'
       and rel.relname = 'content_assets'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%en_investigacion%'
  loop
    execute format('alter table public.content_assets drop constraint %I', v_con.conname);
  end loop;
end;
$$;

alter table public.content_assets
  add constraint content_assets_review_status_check
  check (review_status in ('pendiente','aprobado','bloqueado','en_investigacion','apto_comercial'));

alter table public.content_assets
  add column if not exists commercial_intent     boolean not null default false,
  add column if not exists commercial_cleared_at timestamptz,
  add column if not exists commercial_cleared_by uuid references public.profiles(id) on delete set null;

comment on column public.content_assets.review_status is
  'Estado EFECTIVO del asset. Las acciones del moderador (aprobar/bloquear/investigar) lo escriben acá; el rastro de la decisión queda en content_integrity_alerts. Espejo del patrón listings.tier ← listing_premiums (0054). Desde 0086 existe además `apto_comercial`: NO es "más aprobado que aprobado" sino una decisión distinta — el contenido puede licenciarse o venderse. Sólo se alcanza con revisor y fecha registrados (CHECK content_assets_apto_comercial_con_revisor).';
comment on column public.content_assets.commercial_intent is
  'El que sube DECLARA que este contenido se va a licenciar, vender o usar comercialmente. Es una declaración del usuario, no un hecho verificado (mismo criterio que originality_declared). Su función real es de ruteo: prende la cola de revisión comercial, donde el estándar de prueba de autoría es más alto que para publicar en el feed.';
comment on column public.content_assets.commercial_cleared_at is
  'Cuándo una persona habilitó este contenido para uso comercial. NULL mientras no pasó por revisión. Junto con commercial_cleared_by es lo que el CHECK exige para permitir review_status = apto_comercial: sin fecha y nombre no hay habilitación, y por lo tanto no hay estado.';
comment on column public.content_assets.commercial_cleared_by is
  'Quién habilitó el uso comercial. `on delete set null` porque el revisor puede irse de la plataforma, pero entonces la fila queda violando el CHECK sólo si además está en apto_comercial — y eso es correcto: un CHECK no se revalida al hacer UPDATE de otra fila, así que el dato histórico sobrevive y el próximo UPDATE del asset obliga a volver a habilitarlo con un revisor vigente.';

-- LA REGLA DURA. Va como CHECK y no como trigger a propósito: un trigger se
-- puede desactivar (`alter table ... disable trigger`) y un backfill apurado con
-- `session_replication_role = replica` lo saltea entero. Un CHECK no.
alter table public.content_assets
  drop constraint if exists content_assets_apto_comercial_con_revisor;
alter table public.content_assets
  add constraint content_assets_apto_comercial_con_revisor
  check (
    review_status <> 'apto_comercial'
    or (commercial_cleared_at is not null and commercial_cleared_by is not null)
  );

comment on constraint content_assets_apto_comercial_con_revisor on public.content_assets is
  'Nada llega a apto_comercial sin revisor humano registrado (nombre + fecha). Es la única defensa que no depende de que ningún camino de código se acuerde: ni la app, ni un job, ni un INSERT manual pueden habilitar contenido para la venta de forma anónima.';

-- Cola de revisión comercial: lo que alguien declaró comercial y todavía no está
-- habilitado. Parcial porque es una fracción chica del catálogo y es la consulta
-- que el panel corre todo el tiempo.
create index if not exists content_assets_cola_comercial_idx
  on public.content_assets (tenant_id, created_at desc)
  where commercial_intent and review_status <> 'apto_comercial';

create index if not exists content_assets_commercial_cleared_by_idx
  on public.content_assets (commercial_cleared_by);

-- ---------------------------------------------------------------------------
-- 3. content_disputes — la reclamación de una persona, no de un algoritmo
-- ---------------------------------------------------------------------------

-- Va PRIMERO porque la policy de INSERT de más abajo la invoca, y Postgres
-- resuelve el nombre al crear la policy: definirla después sería un error de
-- migración, no un problema en tiempo de ejecución.
--
-- Es lo que la policy no puede verificar por sí sola. Devuelve un BOOLEANO y no
-- el uploader_id a propósito: si devolviera el uuid del uploader, sería un
-- enumerador de autoría para cualquiera con un asset_id.
create or replace function app.disputa_admisible(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.content_assets a
     where a.id = p_asset_id
       and a.tenant_id = app.current_tenant_id()
       and a.uploader_id is distinct from auth.uid()
  );
$$;

comment on function app.disputa_admisible(uuid) is
  'true si el asset existe, pertenece al tenant de la sesión y NO lo subió quien llama. SECURITY DEFINER porque la RLS de content_assets le impide al reclamante ver el asset ajeno sobre el que quiere reclamar — sin elevar, la policy de INSERT de content_disputes sería imposible de escribir. La superficie que expone es un booleano sobre un uuid que hay que conocer de antemano: no permite enumerar nada.';

revoke execute on function app.disputa_admisible(uuid) from public, anon;
grant execute on function app.disputa_admisible(uuid) to authenticated, service_role;

create table if not exists public.content_disputes (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants(id),
  asset_id        uuid not null references public.content_assets(id) on delete cascade,

  claimant_id     uuid not null references public.profiles(id) on delete cascade,
  respondent_id   uuid references public.profiles(id) on delete set null,

  claim_kind      text not null
                    check (claim_kind in ('autoria','licencia','marca','suplantacion','otro')),
  claim_text      text not null,
  evidence_urls   text[] not null default '{}'::text[]
                    check (array_length(evidence_urls, 1) is null
                           or array_length(evidence_urls, 1) <= 10),

  status          text not null default 'abierta'
                    check (status in ('abierta','en_revision','resuelta_a_favor_reclamante',
                                      'resuelta_a_favor_uploader','descartada','apelada')),
  resolution_note text,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint content_disputes_no_contra_uno_mismo
    check (respondent_id is null or claimant_id <> respondent_id)
);

comment on table public.content_disputes is
  'Reclamación de una PERSONA sobre un contenido cargado: "eso es mío", "esa licencia no la tiene", "esa es mi marca". Es tabla aparte de content_matches (0061) porque un match es un hecho medible entre dos archivos y una disputa es una afirmación humana que puede ser falsa — mezclarlas haría que un reclamo sin fundamento se leyera como evidencia técnica. Y es aparte de scam_reports (0005) porque el sujeto acá es el CONTENIDO, no la conducta de una persona: el desenlace no es sancionar a nadie sino decidir quién puede usar un archivo.';
comment on column public.content_disputes.respondent_id is
  'El uploader del asset — la otra parte. Lo deriva el servidor del propio asset (trigger content_disputes_normalize), NUNCA se acepta del cliente: si el reclamante pudiera elegirlo, podría meter a cualquiera en una disputa ajena y darle acceso de lectura a ella. NULL si el uploader borró su cuenta; la disputa sobrevive porque el asset sobrevive.';
comment on column public.content_disputes.claim_kind is
  'autoria (yo lo hice) | licencia (la licencia declarada no lo cubre) | marca (usa mi marca registrada) | suplantacion (se hace pasar por mí) | otro. Se separa de `claim_text` porque el tipo decide a qué cola va y qué evidencia se pide; el texto libre no se puede rutear.';
comment on column public.content_disputes.evidence_urls is
  'Enlaces a la evidencia que aporta el reclamante (registro de obra, publicación anterior, contrato). Se guardan como URLs y no como archivos subidos a propósito: aceptar uploads acá abriría un canal de carga sin pasar por el propio pipeline de integridad. Tope de 10: más que eso no es evidencia, es ruido.';
comment on column public.content_disputes.status is
  'abierta → en_revision → resuelta_a_favor_reclamante | resuelta_a_favor_uploader | descartada, con `apelada` como vuelta atrás. `descartada` es el falso positivo o el reclamo sin sustancia; se distingue de resuelta_a_favor_uploader porque una cosa es "el reclamo no tenía nada" y otra "se miró y el uploader tenía razón" — sólo la segunda debería pesar a favor de nadie.';
comment on column public.content_disputes.resolved_by is
  'El staff que resolvió. Una decisión que le quita a alguien el derecho de usar su contenido tiene que tener nombre y fecha, igual que la habilitación comercial.';

create index if not exists content_disputes_tenant_status_idx
  on public.content_disputes (tenant_id, status, created_at desc);
create index if not exists content_disputes_asset_idx
  on public.content_disputes (asset_id, created_at desc);
create index if not exists content_disputes_claimant_idx
  on public.content_disputes (claimant_id, created_at desc);
create index if not exists content_disputes_respondent_idx
  on public.content_disputes (respondent_id, created_at desc);
create index if not exists content_disputes_resolved_by_idx
  on public.content_disputes (resolved_by);

-- Una persona no puede tener dos disputas VIVAS sobre el mismo asset. Sin esto,
-- "reclamar" es un botón que se puede apretar cien veces y la cola del moderador
-- se vuelve inutilizable. Las ya resueltas no cuentan: si aparece evidencia
-- nueva, tiene que poder abrirse de nuevo.
create unique index if not exists content_disputes_una_viva_por_reclamante_idx
  on public.content_disputes (asset_id, claimant_id)
  where status in ('abierta','en_revision','apelada');

drop trigger if exists content_disputes_set_updated_at on public.content_disputes;
create trigger content_disputes_set_updated_at
before update on public.content_disputes
for each row execute function extensions.moddatetime(updated_at);

alter table public.content_disputes enable row level security;
alter table public.content_disputes force row level security;

-- La ven las DOS partes y el staff del tenant. A diferencia de content_matches
-- (que sólo lee staff, porque revelaría contenido ajeno), acá las partes tienen
-- que poder seguir su propio caso: un procedimiento que el afectado no puede ver
-- no es un procedimiento.
drop policy if exists content_disputes_select on public.content_disputes;
create policy content_disputes_select on public.content_disputes
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    claimant_id   = (select auth.uid())
    or respondent_id = (select auth.uid())
    or (select app.is_staff())
  )
);

-- Abrir una disputa SÍ es acción de usuario común — es el punto de todo el
-- bloque. Condiciones: en su tenant, como él mismo, siempre naciendo `abierta`
-- y sin campos de resolución precargados. `app.disputa_admisible()` agrega lo
-- que la policy no puede verificar sola (que el asset exista, sea del tenant y
-- NO sea propio), porque la RLS de content_assets le impide al reclamante ver el
-- asset ajeno sobre el que quiere reclamar.
drop policy if exists content_disputes_insert on public.content_disputes;
create policy content_disputes_insert on public.content_disputes
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and claimant_id = (select auth.uid())
  and status = 'abierta'
  and resolved_by is null
  and resolved_at is null
  and resolution_note is null
  and app.disputa_admisible(asset_id)
);

-- Resolver es del staff del tenant, y sólo del staff. El reclamante no puede
-- editar su reclamo después de abrirlo: cambiar el texto de una acusación
-- mientras alguien la evalúa haría que el expediente no signifique nada.
drop policy if exists content_disputes_update on public.content_disputes;
create policy content_disputes_update on public.content_disputes
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
);

-- Nadie borra una disputa. Se descarta (`descartada`). Borrarla destruiría el
-- rastro tanto del reclamo como de la decisión — para las dos partes.
drop policy if exists content_disputes_delete on public.content_disputes;
create policy content_disputes_delete on public.content_disputes
for delete to authenticated
using (false);

revoke all on table public.content_disputes from anon, authenticated;
grant select, insert, update on table public.content_disputes to authenticated;
grant all    on table public.content_disputes to service_role;

-- ---------------------------------------------------------------------------
-- 4. Puente: reportes de la comunidad → cola de integridad
-- ---------------------------------------------------------------------------
-- Hasta acá, un reporte de "usa una marca o contenido que no le pertenece"
-- entraba por scam_reports (0005) y se quedaba en la cola de conducta: el módulo
-- de integridad nunca se enteraba. Dos colas mirando el mismo hecho sin puente
-- es cómo un caso se cae entre las dos.
--
-- Mismo procedimiento que el CHECK de review_status: se busca por definición
-- porque el nombre lo eligió Postgres en 0061.
do $$
declare
  v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname  = 'public'
       and rel.relname = 'content_integrity_alerts'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%originalidad_dudosa%'
  loop
    execute format('alter table public.content_integrity_alerts drop constraint %I', v_con.conname);
  end loop;
end;
$$;

alter table public.content_integrity_alerts
  add constraint content_integrity_alerts_kind_check
  check (kind in ('duplicado_exacto','coincidencia_similar','licencia_faltante',
                  'originalidad_dudosa','reclamo_de_copyright','disputa_abierta'));

alter table public.content_integrity_alerts
  add column if not exists dispute_id       uuid references public.content_disputes(id) on delete set null,
  add column if not exists source_report_id uuid references public.scam_reports(id)     on delete set null;

comment on column public.content_integrity_alerts.kind is
  'Qué originó la alerta. Las cuatro primeras las levanta el pipeline automático (0061). `disputa_abierta` la levanta la apertura de una disputa (0086) y `reclamo_de_copyright` la levanta el puente desde scam_reports: un reporte de la comunidad sobre uso de contenido ajeno tiene que aterrizar en ESTA cola, no sólo en la de conducta, porque la decisión que hace falta es de autoría.';
comment on column public.content_integrity_alerts.dispute_id is
  'La disputa que originó la alerta, si nació de una. `on delete set null` por el mismo motivo que match_id: borrar el origen no puede borrar el rastro de que hubo una decisión. En la práctica las disputas no se borran (policy delete = false), así que esto es cinturón y tiradores.';
comment on column public.content_integrity_alerts.source_report_id is
  'El scam_report (0005) que originó la alerta, cuando el caso entró por la denuncia de la comunidad. Es lo que permite responder "¿de dónde salió esto?" sin cruzar las dos colas a mano. ⚠️ scam_reports SÍ se purga a los 365 días (cron de 0013): cuando eso pasa, el FK queda en NULL y la alerta sobrevive huérfana — es el comportamiento buscado, la alerta tiene su propia retención (cron purge-resolved-content-alerts, 0069).';

create index if not exists content_integrity_alerts_dispute_idx
  on public.content_integrity_alerts (dispute_id);
create index if not exists content_integrity_alerts_source_report_idx
  on public.content_integrity_alerts (source_report_id);

-- ---------------------------------------------------------------------------
-- 5. La puerta de entrada de una disputa (validación del lado servidor)
-- ---------------------------------------------------------------------------
-- `app.disputa_admisible()` vive en el bloque 3 (la policy de INSERT la
-- necesita ya creada). Acá van los triggers y la RPC, que dependen además de
-- las columnas que el bloque 4 agregó a content_integrity_alerts.

-- BEFORE INSERT: el servidor deriva lo que el cliente no puede elegir. Mismo
-- patrón que app.scam_report_set_weight() (0005) — el valor que manda el cliente
-- se ignora, no se valida.
create or replace function app.content_dispute_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset record;
begin
  -- El filtro por tenant NO es redundante con la policy: este trigger es BEFORE
  -- y corre ANTES del `with check`, así que sin el filtro un asset de otra
  -- comunidad daría un error distinto al de un id inexistente — y esa diferencia
  -- convierte al endpoint en un oráculo para adivinar qué ids existen en otros
  -- tenants. Un solo mensaje para los dos casos.
  select a.tenant_id, a.uploader_id
    into v_asset
    from public.content_assets a
   where a.id = new.asset_id
     and a.tenant_id = app.current_tenant_id();

  if not found then
    raise exception 'El contenido reclamado no existe' using errcode = 'foreign_key_violation';
  end if;

  -- (b) Cuota diaria de reclamos, en la BASE y no en la app: el rate-limit de
  -- `reclamar/actions.ts` vive en memoria de una instancia y, sobre todo, no
  -- corre por el INSERT directo de PostgREST. Cada reclamo congela contenido
  -- ajeno hasta que un humano lo mire, así que sin cuota N reclamos falsos son
  -- N contenidos de un competidor fuera del aire.
  if (
    select count(*)
      from public.content_disputes d
     where d.claimant_id = new.claimant_id
       and d.created_at > now() - interval '1 day'
  ) >= 5 then
    raise exception 'Alcanzaste el limite de reclamos por hoy'
      using errcode = 'check_violation';
  end if;

  -- tenant y contraparte SIEMPRE del asset, nunca del payload.
  new.tenant_id     := v_asset.tenant_id;
  new.respondent_id := v_asset.uploader_id;

  if new.claimant_id = v_asset.uploader_id then
    raise exception 'No se puede abrir una disputa sobre contenido propio'
      using errcode = 'check_violation';
  end if;

  -- Una disputa nace abierta y sin resolución. Que el cliente pueda insertar una
  -- fila ya "resuelta_a_favor_reclamante" sería el bug del módulo entero.
  new.status          := 'abierta';
  new.resolved_by     := null;
  new.resolved_at     := null;
  new.resolution_note := null;
  new.created_at      := now();
  new.updated_at      := now();

  return new;
end;
$$;

comment on function app.content_dispute_normalize() is
  'BEFORE INSERT en content_disputes: deriva tenant_id y respondent_id del asset reclamado (ignorando lo que haya mandado el cliente), rechaza el reclamo sobre contenido propio y fuerza el estado inicial. Corre tanto para el INSERT directo por PostgREST como para la RPC, así que las dos puertas terminan produciendo la misma fila.';

drop trigger if exists content_disputes_normalize on public.content_disputes;
create trigger content_disputes_normalize
before insert on public.content_disputes
for each row execute function app.content_dispute_normalize();

-- AFTER INSERT: congelar y avisar. Ver DECISIÓN DE DISEÑO 1 del encabezado —
-- congelar NO es bloquear.
create or replace function app.content_dispute_congelar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un asset ya bloqueado no se "descongela" a en_investigacion: sería un
  -- ascenso de estado disparado por un tercero. Y salir de apto_comercial es
  -- justamente el punto — mientras hay una disputa viva, no se licencia.
  update public.content_assets
     set review_status = 'en_investigacion'
   where id = new.asset_id
     and review_status <> 'bloqueado';

  -- El expediente entra en la cola del moderador en el mismo commit. Si esto
  -- fuera trabajo de la app, una disputa abierta desde un camino que se olvidó
  -- de llamarla quedaría invisible.
  insert into public.content_integrity_alerts
    (tenant_id, asset_id, dispute_id, kind, severity, detail)
  values
    (new.tenant_id, new.asset_id, new.id, 'disputa_abierta', 'alta',
     'Disputa de contenido abierta (' || new.claim_kind || ')');

  return null;
end;
$$;

comment on function app.content_dispute_congelar() is
  'AFTER INSERT en content_disputes: mueve el asset a en_investigacion (salvo que ya esté bloqueado) y levanta la alerta `disputa_abierta`. Congelar y no bloquear es deliberado: si abrir una disputa tuviera efecto punitivo automático, tres reclamos falsos bastarían para hacer desaparecer el contenido de un competidor.';

drop trigger if exists content_disputes_congelar on public.content_disputes;
create trigger content_disputes_congelar
after insert on public.content_disputes
for each row execute function app.content_dispute_congelar();

-- La RPC. Existe además del INSERT directo porque es la firma que la app quiere
-- llamar (un solo round-trip, sin que el cliente tenga que conocer el shape de
-- la tabla ni adivinar qué campos puede mandar).
create or replace function app.abrir_disputa_de_contenido(
  p_asset_id      uuid,
  p_claim_kind    text,
  p_claim_text    text,
  p_evidence_urls text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if v_actor is null or v_tenant is null then
    raise exception 'Sesión sin tenant o sin usuario' using errcode = 'insufficient_privilege';
  end if;

  -- La misma comprobación que hace la policy, acá explícita: el asset tiene que
  -- existir, ser del tenant de la sesión y no ser propio. Se repite a propósito
  -- —la función es DEFINER y por lo tanto NO pasa por la policy de INSERT—, así
  -- que si esta línea no estuviera, la RPC sería el agujero que la policy cierra.
  if not app.disputa_admisible(p_asset_id) then
    raise exception 'No se puede abrir una disputa sobre ese contenido'
      using errcode = 'check_violation';
  end if;

  insert into public.content_disputes
    (tenant_id, asset_id, claimant_id, claim_kind, claim_text, evidence_urls)
  values
    (v_tenant, p_asset_id, v_actor, p_claim_kind, p_claim_text,
     coalesce(p_evidence_urls, '{}'::text[]))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.abrir_disputa_de_contenido(uuid, text, text, text[]) is
  'Abre una disputa de contenido a nombre del usuario de la sesión. NO recibe tenant_id ni claimant_id por parámetro: los deriva de app.current_tenant_id() y auth.uid(). Aceptarlos del cliente convertiría la función en un modo de abrir disputas en nombre de otro, o en el tenant de otro. El congelamiento del asset y la alerta los hace el trigger AFTER INSERT, no esta función, para que el INSERT directo por PostgREST tenga exactamente el mismo efecto.';

revoke execute on function app.abrir_disputa_de_contenido(uuid, text, text, text[]) from public, anon;
grant execute on function app.abrir_disputa_de_contenido(uuid, text, text, text[]) to authenticated, service_role;

-- Envoltorio en public (PostgREST sólo expone public — ver 0070). SECURITY
-- INVOKER: el cuerpo real ya corre como su dueño, declararlo definer sería
-- privilegio de más y un advisory sin ninguna ganancia.
create or replace function public.abrir_disputa_de_contenido(
  p_asset_id      uuid,
  p_claim_kind    text,
  p_claim_text    text,
  p_evidence_urls text[] default '{}'::text[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.abrir_disputa_de_contenido(p_asset_id, p_claim_kind, p_claim_text, p_evidence_urls);
$$;

comment on function public.abrir_disputa_de_contenido(uuid, text, text, text[]) is
  'Envoltorio de app.abrir_disputa_de_contenido para que la app pueda llamarla por PostgREST. EXECUTE para `authenticated` (a diferencia de los envoltorios de 0070, que son sólo service_role): abrir una disputa es una acción de usuario, y la validación de tenant y autoría vive del lado servidor.';

revoke all   on function public.abrir_disputa_de_contenido(uuid, text, text, text[]) from public, anon;
grant execute on function public.abrir_disputa_de_contenido(uuid, text, text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Señal de integridad para el Trust Score (definida, todavía NO enganchada)
-- ---------------------------------------------------------------------------
create or replace function public.integrity_penalty_for_user(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with bloqueados as (
    -- Assets del usuario que un moderador bloqueó. El hecho más duro de los tres.
    select count(*) as n
      from public.content_assets a
     where a.uploader_id = p_user_id
       and a.review_status = 'bloqueado'
  ),
  duplicados as (
    -- Alertas de duplicado EXACTO (sha256, determinístico) resueltas contra él.
    -- Se cuentan las alertas y no los matches porque un match es una medición y
    -- una alerta resuelta como `bloqueado` es una DECISIÓN humana.
    select count(*) as n
      from public.content_integrity_alerts al
      join public.content_assets a on a.id = al.asset_id
     where a.uploader_id = p_user_id
       and al.kind   = 'duplicado_exacto'
       and al.status = 'bloqueado'
  ),
  disputas as (
    -- Disputas donde él era la contraparte y perdió. `descartada` y
    -- `resuelta_a_favor_uploader` NO cuentan: acusar sin fundamento no puede
    -- costarle nada al acusado.
    select count(*) as n
      from public.content_disputes d
     where d.respondent_id = p_user_id
       and d.status = 'resuelta_a_favor_reclamante'
  )
  select least(
           25,
           least(bloqueados.n * 3,  9)
         + least(duplicados.n * 2,  6)
         + least(disputas.n   * 5, 15)
         )::int
    from bloqueados, duplicados, disputas;
$$;

comment on function public.integrity_penalty_for_user(uuid) is
  'Penalización de integridad de un usuario, acotada a 0..25: assets bloqueados (3 c/u, tope 9) + alertas de duplicado exacto resueltas como bloqueado (2 c/u, tope 6) + disputas perdidas como contraparte (5 c/u, tope 15), y el total recortado a 25. Cada componente tiene su propio tope para que ninguna señal sola pueda hundir un score, y el conjunto está acotado porque una penalización sin techo convierte cualquier error de moderación en una condena permanente.

⚠️ TODAVÍA NO ESTÁ ENGANCHADA a app.recalc_user_score (0037), Y ES A PROPÓSITO. Enganchar la señal en la misma migración que la define movería los scores de gente real en el próximo cron diario, sin que nadie haya mirado el impacto — y como trust_scores tiene historial (score_history), el salto quedaría registrado como si algo hubiera pasado ese día. El camino correcto: correr esta función sobre la base real, ver la distribución, ajustar pesos si hace falta, y recién ahí engancharla —vía score_penalties, que es el canal que el motor ya resta (INVARIANTE §35: en `factors` sólo van positivos)— en su propia migración con su propio rollback.

PESOS PROVISIONALES, igual que los de 0037: encodean una jerarquía razonable (una disputa perdida pesa más que un duplicado detectado), no una fórmula validada contra la spec.

EXECUTE sólo para service_role: si `authenticated` pudiera llamarla, cualquiera consultaría el estado de moderación de cualquier otro pasándole un uuid de perfil.';

revoke execute on function public.integrity_penalty_for_user(uuid) from public, anon, authenticated;
grant execute on function public.integrity_penalty_for_user(uuid) to service_role;

commit;

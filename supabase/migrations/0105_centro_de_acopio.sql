-- =============================================================================
-- 0105_centro_de_acopio.sql — Comunidad Latina
--
-- Suma "Centro de acopio" a la grilla de Comunidad (pedido del cliente,
-- transmitido de segunda mano: «falta la sección del centro de acopio…
-- creo que cuando la gente no tiene un espacio para dormir o algo así… no
-- entendí muy bien»). El cliente mismo avisó que no tenía claro el alcance,
-- así que antes de tocar una línea de SQL, la definición con la que se
-- construyó esto:
--
--   Un centro de acopio es un punto físico de RECOLECCIÓN de donaciones —
--   ropa, alimentos no perecederos, artículos de higiene, útiles escolares,
--   insumos de emergencia — que después se reparten entre familias que las
--   necesitan. En comunidades migrantes suelen activarse por una emergencia
--   puntual: una redada, un incendio, una familia deportada de un día para
--   el otro, un huracán en el país de origen.
--
-- ── POR QUÉ NO ES "BANCOS DE COMIDA" (tema `comida`, ya existente) ──────────
-- Son direcciones opuestas de la misma ayuda. En un banco de comida la
-- persona va a RECIBIR: se lleva comida a su casa. En un centro de acopio la
-- persona va a DEJAR: lleva SU donación para que otro la reciba (y de paso
-- puede consultar qué hace falta en ese lugar en este momento). Confundirlos
-- manda a alguien con hambre a un lugar que junta ropa, o a alguien con una
-- bolsa de ropa a un comedor que no tiene dónde guardarla — por eso el copy
-- de la tarjeta nueva (`src/lib/comunidad/copy.ts`) dice explícitamente que
-- ACÁ SE DEJA, nunca que acá se recibe comida.
--
-- ── MODELO ELEGIDO Y POR QUÉ ─────────────────────────────────────────────────
-- Mismo patrón EXACTO que 0099 (voluntariado): tema nuevo de
-- `community_resources`, no tabla nueva. Un centro de acopio es una ficha
-- curada —nombre, zona, horario, contacto, fuente— igual que una clínica o
-- un consulado, NO un tablón donde cualquiera publica su propia convocatoria
-- (eso ya existe para objetos perdidos vía `listings`, y traerlo acá
-- hubiese significado reconstruir el flujo de dos fases —borrador →
-- moderación → publicado— para algo que el directorio curado ya resuelve).
-- Reusa TODO lo que ya existe: `fetchResourceGroups`, `RecursoCard`, la RLS
-- y el NOT NULL de procedencia de la 0096 — cero tablas nuevas, cero
-- policies nuevas. Este archivo sólo toca el CHECK del tema y siembra tres
-- fichas de ejemplo para que la pantalla no nazca vacía.
--
-- El do-block busca la constraint por su DEFINICIÓN, no por nombre — mismo
-- motivo que ya explicaron 0096 y 0099: defensivo ante un nombre
-- autogenerado distinto entre entornos, y de paso lo deja re-corrible.
--
-- Sin GRANTs nuevos: `community_resources` ya los tiene explícitos desde la
-- 0096 (la 0085 dejó escrito con sangre lo que pasa sin ellos — la app se ve
-- vacía y sin un solo error). Esta migración sólo amplía un CHECK existente
-- sobre una tabla que ya es accesible para anon/authenticated/service_role.
--
-- ── LAS TRES FICHAS DE EJEMPLO ───────────────────────────────────────────────
-- Son ejemplo REALISTA para que la pantalla no nazca vacía, no un directorio
-- verificado hoy: nombres de iniciativas comunitarias plausibles (parroquias,
-- centros vecinales — el tipo de organización que en la vida real arma un
-- acopio), zonas y referencias geográficas reales de Corona, Jackson Heights
-- y Mott Haven (mismas zonas que ya usa `scripts/seed.mjs` para vivienda),
-- sin inventar un número de puerta específico que mandaría a alguien a una
-- dirección que no existe — se referencia la esquina/estación más cercana,
-- igual que ya hace el seed de vivienda ("cerca de la Roosevelt Ave"). El
-- teléfono usa el bloque 555-01xx (reservado para ficción en Norteamérica —
-- mismo recurso que ya usa el fixture de `recursos.test.ts`) y la fuente
-- apunta a `example.org` (dominio reservado por IANA para documentación:
-- nunca redirige a un tercero real). Antes de que esto le llegue a un
-- usuario real, un domain_admin lo revisa desde el panel y lo reemplaza por
-- el acopio real de su zona — exactamente el mismo flujo que cualquier otra
-- ficha de este directorio.
-- =============================================================================

begin;

do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.community_resources'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%topic = ANY%';
  if v_name is not null then
    execute format('alter table public.community_resources drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.community_resources
  add constraint community_resources_topic_check
  check (topic in (
    'migracion', 'salud', 'comida', 'consulados',
    'legal', 'vivienda', 'educacion', 'emergencias', 'voluntariado', 'acopio'
  ));

comment on column public.community_resources.topic is
  'Agrupador de la pantalla (espeja RESOURCE_TOPICS en src/lib/comunidad/types.ts). 0099 sumó "voluntariado" (dar tiempo); 0105 suma "acopio" (dar bienes materiales — DISTINTO de "comida", donde se los recibe). Los dos son el mismo modelo curado y con fuente obligatoria que el resto de los temas — nunca convocatorias publicadas por usuarios.';

-- ---------------------------------------------------------------------------
-- Tres fichas de ejemplo — ver "LAS TRES FICHAS DE EJEMPLO" en la cabecera.
--
-- `where not exists` en vez de `on conflict`: la tabla no tiene una unique
-- key natural sobre (tenant_id, topic, name) y agregar una sería más cambio
-- del que este archivo necesita — el guard de abajo alcanza para que
-- re-correr la migración no duplique filas.
--
-- tenant_id null = recurso GLOBAL, mismo criterio que un consulado (0096):
-- un centro de acopio en Queens o el Bronx le sirve a cualquier comunidad de
-- la app, no sólo a la que lo cargó.
--
-- ── POR QUÉ ESTAS TRES FILAS ENTRAN COMO `draft` Y NO COMO `published` ───────
-- Están INVENTADAS. Los nombres, las esquinas, los horarios y los teléfonos
-- (bloque 555-01xx, reservado para ficción) no corresponden a ningún lugar
-- real, y las fuentes apuntan a `example.org`.
--
-- Sembrarlas publicadas para que la pantalla "no nazca vacía" sería el peor
-- negocio posible de esta app. Un centro de acopio falso no es una fila fea en
-- una demo: es una persona cargando bolsas hasta Corona para donar en una
-- puerta que no existe, o una familia que se quedó sin nada yendo un sábado a
-- Mott Haven a buscar ayuda que nadie va a darle. El daño cae justo sobre
-- quien menos margen tiene para absorberlo.
--
-- Una pantalla vacía dice la verdad —todavía no hay centros cargados— y su
-- estado vacío ya está diseñado. Un dato inventado miente, y encima con la
-- autoridad de estar dentro de la app.
--
-- Como `draft`, estas filas siguen sirviendo para lo único que sí es legítimo:
-- son la PLANTILLA que quien administra abre en el panel para ver qué campos
-- llenar y con cuánto detalle. Las lecturas públicas filtran `status =
-- 'published'` (0096), así que ningún usuario las ve hasta que alguien las
-- reemplace por lugares reales y las publique a mano.
-- ---------------------------------------------------------------------------
insert into public.community_resources (
  tenant_id, topic, name, description, phone, website, address, area_label,
  hours_note, languages, requirements_note,
  source_name, source_url, source_checked_at, status
)
select null, 'acopio', v.name, v.description, v.phone, null, v.address, v.area_label,
       v.hours_note, v.languages, v.requirements_note,
       v.name, v.source_url, v.source_checked_at::date, 'draft'
  from (values
    (
      'Centro de Acopio La Nueva Esperanza',
      'Punto de acopio permanente organizado por vecinos y una parroquia del barrio. Reúnen donaciones para repartir entre familias de Corona y Jackson Heights. Esta semana están recibiendo ropa de abrigo en buen estado, pañales talle 3 y 4, y alimentos no perecederos.',
      '(718) 555-0142',
      'Cerca de Roosevelt Ave y 103 St, Corona',
      'Corona, Queens',
      'Martes a sábado, de 10 a 18 h',
      array['Español', 'Inglés']::text[],
      'Traé la donación en bolsas o cajas cerradas. No hace falta cita ni documento — cualquiera puede donar.',
      'https://example.org/acopio-corona',
      '2026-08-20'
    ),
    (
      'Acopio de Emergencia Jackson Heights',
      'Acopio que se activa para responder a emergencias del barrio —un incendio, un desalojo, una familia que se queda sin nada de un día para el otro—. Ahora mismo están recibiendo ropa de cama, artículos de higiene personal y productos de limpieza.',
      '(347) 555-0198',
      'Sobre la 37 Ave, cerca de la estación Jackson Heights–Roosevelt Ave',
      'Jackson Heights, Queens',
      'Lunes, miércoles y viernes de 16 a 20 h',
      array['Español', 'Inglés']::text[],
      'Se recibe en el horario indicado. Si es una donación grande, avisá antes por teléfono.',
      'https://example.org/acopio-jackson-heights',
      '2026-08-15'
    ),
    (
      'Despensa y Acopio Comunitario del Bronx',
      'Centro comunitario que junta donaciones para familias del sur del Bronx. Además de la despensa de alimentos, ahora están recibiendo útiles escolares, mochilas y ropa de niño en buen estado para el arranque de clases.',
      '(718) 555-0176',
      'Cerca de 149 St–Grand Concourse, Mott Haven',
      'Mott Haven, Bronx',
      'Sábados de 9 a 13 h',
      array['Español', 'Inglés']::text[],
      'Las donaciones se reciben lavadas y en buen estado — la despensa no tiene lugar para guardar lo que no se puede repartir.',
      'https://example.org/acopio-bronx',
      '2026-08-10'
    )
  ) as v(name, description, phone, address, area_label, hours_note, languages, requirements_note, source_url, source_checked_at)
 where not exists (
   select 1 from public.community_resources existing
    where existing.tenant_id is null
      and existing.topic = 'acopio'
      and existing.name = v.name
 );

commit;

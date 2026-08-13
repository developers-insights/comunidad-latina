-- =============================================================================
-- 0099_comunidad_voluntarios.sql — Comunidad Latina
--
-- La portada de Comunidad pasa a ser una grilla de categorías (pedido textual
-- del cliente, ver `src/app/(app)/comunidad/(indice)/page.tsx`) y suma dos
-- que faltaban: "Bancos de comida gratis" y "Grupo de voluntarios".
--
--   · Bancos de comida NO necesita esta migración: ya existe como tema
--     `comida` de `community_resources` (0096). La tarjeta nueva sólo filtra
--     la misma lectura por ese tema — cero SQL.
--   · Voluntarios SÍ es tema nuevo: `voluntariado`.
--
-- ── MODELO ELEGIDO Y POR QUÉ ──────────────────────────────────────────────
-- Directorio de ORGANIZACIONES que reciben voluntarios (comedores, refugios,
-- ONGs — fichas curadas con teléfono/web/dirección, iguales a una clínica o
-- un consulado), NO un tablón donde cualquiera publica su propia convocatoria.
-- El pedido del cliente nunca describió "que la gente publique"; encaja en
-- `community_resources` por el mismo motivo que ya explica esa tabla en la
-- 0096 (información curada, con procedencia NOT NULL) y NO en `listings`
-- —eso hubiese significado construir el flujo de publicación de dos fases
-- entero (borrador → moderación → publicado, como Perdido y encontrado en esa
-- misma migración) para algo que el directorio ya resuelve. Reusa TODO lo que
-- ya existe: `fetchResourceGroups`, `RecursoCard`, la RLS y el NOT NULL de
-- procedencia de la 0096 — cero tablas nuevas, cero policies nuevas, este
-- archivo sólo toca un CHECK constraint.
--
-- El do-block busca la constraint por su DEFINICIÓN (no por nombre) con el
-- MISMO patrón que ya usó la 0096 para `listings_kind_check`: es defensivo por
-- si el nombre autogenerado difiere entre entornos, y de paso lo deja
-- re-corrible (si ya se aplicó, la busca de nuevo por definición, la vuelve a
-- soltar y la vuelve a crear idéntica — no falla la segunda vez).
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
    'legal', 'vivienda', 'educacion', 'emergencias', 'voluntariado'
  ));

comment on column public.community_resources.topic is
  'Agrupador de la pantalla (espeja RESOURCE_TOPICS en src/lib/comunidad/types.ts). 0099 suma "voluntariado": organizaciones que reciben voluntarios, mismo modelo curado y con fuente obligatoria que el resto de los temas — NO convocatorias publicadas por usuarios.';

commit;

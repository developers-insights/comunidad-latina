-- =============================================================================
-- 0065_job_id_cl_cm.sql — Comunidad Latina
--
-- El pliego exige el formato `CL-CM-2026-000001`: prefijo CL-CM, año y SEIS
-- dígitos. `app.next_gig_code()` (0024) genera `CL-2026-0001` — otro prefijo y
-- cuatro dígitos.
--
-- Hay 11 contratos vivos con el formato viejo (CL-2026-0001 … CL-2026-0011), así
-- que esto no es sólo cambiar el generador: hay que migrar los existentes.
--
-- TRAZABILIDAD: el código viejo NO se pierde. Se copia a `code_legacy` antes de
-- pisar `code`. Es un identificador que la gente ya vio en pantalla y que puede
-- estar citado en un correo, un reclamo o una captura; borrarlo sería romper la
-- referencia justo en la tabla donde hay plata de por medio.
--
-- UNICIDAD: `code` tiene UNIQUE (gig_contracts_code_key). El backfill mapea
-- 1-a-1 conservando el número de secuencia (0001 → 000001), así que no puede
-- haber colisión: la parte numérica ya era única dentro del año.
--
-- LA SECUENCIA NO SE REINICIA. `app.gig_contract_code_seq` sigue donde está
-- (11), así que el próximo contrato es CL-CM-2026-000012 y ningún número se
-- reutiliza. Reiniciarla habría hecho que el contrato nuevo #1 chocara con el
-- viejo #1 ya migrado.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Guardar el código viejo ANTES de tocarlo
-- ---------------------------------------------------------------------------
alter table public.gig_contracts
  add column if not exists code_legacy text;

comment on column public.gig_contracts.code_legacy is
  'El código con el formato anterior (CL-AAAA-NNNN) que este contrato tuvo hasta 0065. Se conserva porque es un identificador que las partes ya vieron y pueden citar en un reclamo: migrar el formato no puede significar que el número que alguien tiene anotado deje de existir. NULL en los contratos creados después de 0065, que nacieron con el formato nuevo.';

update public.gig_contracts
   set code_legacy = code
 where code_legacy is null
   and code !~ '^CL-CM-';

-- ---------------------------------------------------------------------------
-- 2. Backfill al formato nuevo
-- ---------------------------------------------------------------------------
-- CL-2026-0011 → CL-CM-2026-000011. Se conserva el año y se re-pad el número a
-- 6 dígitos: el mapeo es 1-a-1 y por lo tanto sigue siendo único.
update public.gig_contracts
   set code = 'CL-CM-' || split_part(code, '-', 2) || '-'
              || lpad(split_part(code, '-', 3), 6, '0')
 where code ~ '^CL-[0-9]{4}-[0-9]+$';

-- ---------------------------------------------------------------------------
-- 3. El generador nuevo
-- ---------------------------------------------------------------------------
create or replace function app.next_gig_code()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'CL-CM-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('app.gig_contract_code_seq')::text, 6, '0');
$$;

comment on function app.next_gig_code() is
  'Genera el Job ID con el formato del pliego: CL-CM-<año>-<6 dígitos>. La secuencia NO se reinició en 0065 y no se reinicia por año a propósito: reiniciarla haría que un código nuevo chocara con uno ya migrado (el UNIQUE de `code` es global, no por año). El año queda como información legible, no como parte del espacio de numeración.';

-- ---------------------------------------------------------------------------
-- 4. Recién ahora se puede exigir el formato
-- ---------------------------------------------------------------------------
-- El CHECK va DESPUÉS del backfill: si fuera antes, las 11 filas vivas lo
-- violarían y la migración entera abortaría.
alter table public.gig_contracts
  drop constraint if exists gig_contracts_code_formato;
alter table public.gig_contracts
  add constraint gig_contracts_code_formato
  check (code ~ '^CL-CM-[0-9]{4}-[0-9]{6}$');

comment on column public.gig_contracts.code is
  'Job ID visible del contrato, formato CL-CM-<año>-<6 dígitos> (pliego). Único global. El formato lo garantiza gig_contracts_code_formato y lo genera app.next_gig_code(); el código anterior de cada contrato migrado vive en code_legacy.';

-- Búsqueda por el código viejo: alguien va a pegar "CL-2026-0007" en el buscador
-- del panel durante mucho tiempo todavía.
create index if not exists gig_contracts_code_legacy_idx
  on public.gig_contracts (code_legacy)
  where code_legacy is not null;

commit;

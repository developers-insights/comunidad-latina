-- =============================================================================
-- 0107_campos_de_publicacion.sql — Comunidad Latina
--
-- Los tres formularios de alta (vivienda, evento, empleo) pasan a pedir lo que
-- la spec siempre pidió y el producto nunca capturó: condiciones del alquiler,
-- modalidad y entrada de un evento, y la ficha completa de un puesto.
--
-- CASI NADA DE ESO NECESITA BASE. Los campos nuevos van a `listings.attrs`
-- (JSONB libre), que es donde ya viven `bedrooms`, `sqft`, `property_type`,
-- `operation`, `starts_at`, `free`, `employment_type` y `questions`. El repo ya
-- eligió ese camino y esta migración no lo cambia: agregar veinte columnas
-- nullable a la tabla más grande del sistema, para datos que sólo lee la ficha
-- que ya se estaba leyendo, es pagar un costo de escritura permanente a cambio
-- de nada. Los contratos de esos campos —claves, catálogos, normalizadores— son
-- código, y viven en:
--
--   · src/lib/propiedades/alquiler.ts   (depósito, cargos, servicios, requisitos,
--                                        amueblado, disponible desde)
--   · src/lib/eventos/detalles.ts       (modalidad, enlace virtual, gratis/pago,
--                                        boletos, capacidad, público)
--   · src/lib/empleos/detalles.ts       (rango salarial, días, horario,
--                                        experiencia, idiomas, fechas)
--
-- LO QUE SÍ NECESITA BASE ES UNA SOLA COSA, Y ES POR LO QUE EXISTE ESTE ARCHIVO.
--
-- =============================================================================
-- 1 · EL EMPLEO TIENE QUE PODER APUNTAR A LA FICHA DEL NEGOCIO QUE LO PUBLICA
-- =============================================================================
-- La spec pide "negocio vinculado y ubicación". Hoy un empleo sólo tiene
-- `area_label`, que es texto libre: dos avisos del mismo restaurante escriben
-- la zona distinto y no hay forma de saber que son del mismo lugar. Y la página
-- del negocio no puede listar sus empleos, porque no hay nada que consultar.
--
-- ── POR QUÉ UNA COLUMNA Y NO `attrs.business_listing_id` ─────────────────────
-- Todo lo demás de esta feature va a `attrs`, y esto no. La diferencia no es de
-- gusto: los otros campos son DESCRIPCIONES (un texto, un número, una lista de
-- slugs) y éste es una REFERENCIA a otra fila. Un uuid guardado en un JSONB no
-- tiene integridad referencial —el negocio se borra y el empleo queda apuntando
-- a un fantasma—, no tiene tipo —cualquier string entra— y no se puede indexar
-- de forma barata para la consulta que justifica todo esto ("dame los empleos
-- de este negocio"). Un `attrs->>'business_listing_id' = $1` sobre `listings`
-- es un scan, y la página del negocio lo va a hacer en cada visita.
--
-- ── POR QUÉ NO SE COPIA `posts.entity_listing_id` TAL CUAL ──────────────────
-- `posts.entity_listing_id` (0023) es el vínculo canónico del repo para "esto
-- se publicó COMO esa ficha", y la 0106 volvió a rechazar duplicarlo. Acá el
-- caso es distinto y por eso hace falta una columna nueva: un empleo NO es un
-- `post`, es un `listing`. La relación es listing→listing, dentro de la misma
-- tabla, y `entity_listing_id` no vive en `listings`. Se mantiene el mismo
-- ESPÍRITU (una sola fuente del hecho, ownership verificado, borrado seguro) con
-- el nombre paralelo `business_listing_id`.
--
-- ── LA INTEGRIDAD VA EN UN TRIGGER, NO EN LA POLICY ─────────────────────────
-- El instinto sería extender el WITH CHECK de `listings_insert` con un `exists`,
-- como hizo 0023 con `posts_insert`. No se hace, por dos razones:
--
--   1. `listings_insert` se acaba de reescribir en la 0106 (identidad verificada
--      por vertical). Volver a soltarla y recrearla acá para agregar una
--      condición es la forma más rápida de perder en silencio lo que esa
--      migración agregó. Un trigger se suma sin tocar lo que ya está.
--   2. La regla que hay que hacer cumplir mira la fila que se está escribiendo
--      (`kind = 'job'`) Y la fila apuntada (`kind = 'business'`, mismo tenant,
--      mismo dueño). Eso es una validación de coherencia, no una regla de
--      acceso, y en este repo esas viven en `app.*` como trigger
--      (`app.protect_listing_counters`, `app.listings_set_expiry`).
--
-- El trigger falla CERRADO: si el vínculo no se puede verificar, la escritura se
-- rechaza con un error nombrado. Nunca "limpia" la columna en silencio — un
-- empleo que se guarda sin el negocio que la persona eligió es un empleo que
-- miente sobre quién lo publica.
--
-- ── LO QUE EL VÍNCULO NO ES ─────────────────────────────────────────────────
-- No es una transferencia de autoría ni de permisos. `created_by` del empleo
-- sigue siendo quien lo publicó, las postulaciones siguen llegándole a esa
-- persona y la moderación sigue mirando el aviso. El vínculo sólo dice "este
-- puesto es de aquel negocio", que es lo que hace falta para mostrar el logo en
-- la tarjeta y para listar los empleos en la ficha.
--
-- =============================================================================
-- 2 · LAS PROPIEDADES EN VENTA QUE YA EXISTEN: NO SE TOCAN
-- =============================================================================
-- La spec cierra la venta ("No se incluirán propiedades en venta ni Open
-- Houses") y a partir de esta entrega el formulario y la server action sólo
-- aceptan `alquiler`. Puede haber avisos publicados con `attrs.operation =
-- 'venta'`.
--
-- ESTA MIGRACIÓN NO LOS TOCA, A PROPÓSITO. Ni los borra, ni los despublica, ni
-- les reescribe la operación. Los tres serían destructivos y ninguno es
-- necesario:
--
--   · Borrarlos o despublicarlos rompe el aviso de alguien que publicó cuando
--     estaba permitido, sin avisarle y sin poder deshacerlo.
--   · Reescribir `operation` a `'alquiler'` es peor: convierte una venta de
--     $450.000 en un alquiler de $450.000. Es fabricar un dato falso.
--
-- El camino es el que el sistema ya tiene: el ciclo de vencimiento de la 0098.
-- Un aviso publicado tiene `expires_at`, y cuando llega, vence solo. Las ventas
-- existentes se muestran enteras hasta ese día y después se apagan sin que nadie
-- tenga que decidir nada. Renovarlas pasa por `public.renovar_publicacion()`,
-- que no valida la operación — si la comunidad quiere cerrar también esa puerta,
-- es un cambio de política y va en su propia migración, no escondido acá.
--
-- Del lado del código, la retrocompatibilidad la sostiene la separación entre
-- vocabulario de LECTURA (`PROPERTY_OPERATIONS`, sigue con `venta`) y de
-- ESCRITURA (`PUBLISHABLE_PROPERTY_OPERATIONS`, sólo `alquiler`), en
-- src/lib/propiedades/tipos.ts. Por eso el chip "Venta" del detalle y el filtro
-- por operación del listado siguen funcionando sin cambios.
--
-- =============================================================================
-- 3 · GRANTS
-- =============================================================================
-- Esta base es compartida y sus default privileges quedaron sin `anon` (0085).
-- `listings` tiene grant A NIVEL DE TABLA, así que una columna nueva queda
-- cubierta sola — pero el grant se repite abajo igual, explícito e idempotente,
-- porque el incidente que documenta la 0085 fue exactamente éste: sin GRANT,
-- Postgres NI SIQUIERA EVALÚA la policy y la app se ve vacía SIN UN SOLO ERROR.
-- Repetirlo cuesta una línea; descubrirlo en producción costó una tarde.
--
-- Toda la migración es idempotente (`if not exists`, `drop … if exists`,
-- `create or replace`) y no falla contra los datos que ya existen: la columna
-- nace NULL en todas las filas, que es exactamente "este aviso no está vinculado
-- a ningún negocio".
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. listings.business_listing_id
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists business_listing_id uuid;

-- FK separada del `add column` para poder ser idempotente sin depender de que
-- la columna sea nueva.
alter table public.listings
  drop constraint if exists listings_business_listing_id_fkey;

-- `on delete set null` y NO `cascade`: si el negocio da de baja su ficha, el
-- empleo sigue siendo un empleo real que alguien publicó y al que puede haber
-- gente postulada. Pierde el logo, no la existencia. `cascade` acá borraría
-- avisos vivos —y sus postulaciones— como efecto colateral de limpiar una ficha.
alter table public.listings
  add constraint listings_business_listing_id_fkey
  foreign key (business_listing_id)
  references public.listings(id)
  on delete set null;

comment on column public.listings.business_listing_id is
  'Ficha de negocio (listings.kind = business) a la que pertenece este aviso. Hoy sólo la usan los empleos (kind = job): es el "negocio vinculado" que pide la spec, y lo que permite que la ficha del negocio liste sus puestos. NULL = aviso publicado a título personal, que es el caso mayoritario y el de TODO lo anterior a la 0107. La coherencia (mismo tenant, destino kind=business, mismo dueño, sin auto-referencia) la impone app.check_business_listing_link(); la FK sola no puede expresarla. on delete set null a propósito: dar de baja la ficha del negocio no borra empleos vivos ni sus postulaciones.';

-- ---------------------------------------------------------------------------
-- 2. Coherencia del vínculo — trigger, no policy (ver docblock)
-- ---------------------------------------------------------------------------
create or replace function app.check_business_listing_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind      text;
  v_tenant    uuid;
  v_creador   uuid;
begin
  -- Sin vínculo no hay nada que verificar. Es el camino del 99% de las filas
  -- (toda propiedad, todo producto, todo evento) y sale antes de tocar disco.
  if new.business_listing_id is null then
    return new;
  end if;

  -- En un UPDATE que no cambia el vínculo tampoco hay nada que verificar: el
  -- valor ya pasó por acá cuando se escribió. Esto evita que editar el título
  -- de un empleo falle porque el negocio cambió de dueño el mes pasado.
  --
  -- El `if` va ANIDADO y no como `tg_op = 'UPDATE' and old.…`: en PL/pgSQL una
  -- condición compuesta se evalúa entera, y en un trigger de INSERT el registro
  -- OLD no está asignado — tocarlo ahí levanta "record old is not assigned yet"
  -- y el INSERT muere por la guarda que venía a evitar trabajo.
  if tg_op = 'UPDATE' then
    if new.business_listing_id is not distinct from old.business_listing_id then
      return new;
    end if;
  end if;

  -- Un aviso no puede ser su propio negocio.
  if new.business_listing_id = new.id then
    raise exception 'VINCULO_INVALIDO: un aviso no puede vincularse a sí mismo';
  end if;

  -- Por ahora el vínculo es exclusivo de los empleos. Se valida en vez de
  -- ignorarse: un cliente que mande el campo en un kind que no lo usa está
  -- equivocado, y decírselo es más útil que guardarle un dato inerte.
  if new.kind <> 'job' then
    raise exception 'VINCULO_INVALIDO: sólo un aviso de empleo puede vincularse a un negocio (kind=%)', new.kind;
  end if;

  select l.kind, l.tenant_id, l.created_by
    into v_kind, v_tenant, v_creador
    from public.listings l
   where l.id = new.business_listing_id;

  if not found then
    raise exception 'VINCULO_INVALIDO: el negocio indicado no existe';
  end if;

  if v_kind <> 'business' then
    raise exception 'VINCULO_INVALIDO: el aviso vinculado no es un negocio (kind=%)', v_kind;
  end if;

  -- Mismo tenant. Es lo que una FK compuesta (tenant_id, id) daría "gratis",
  -- pero esa FK exige un unique redundante sobre (id, tenant_id) en la tabla
  -- más grande del sistema — un índice entero a cambio de una comparación que
  -- este trigger ya está haciendo con la fila en la mano.
  if v_tenant <> new.tenant_id then
    raise exception 'VINCULO_INVALIDO: el negocio pertenece a otra comunidad';
  end if;

  -- Ownership: mismo criterio que la policy de posts.entity_listing_id (0023).
  -- Sin esto, cualquiera publicaría un empleo colgado del restaurante más
  -- conocido del barrio y se llevaría su reputación prestada.
  if v_creador is distinct from new.created_by then
    raise exception 'VINCULO_INVALIDO: sólo podés vincular un empleo a un negocio tuyo';
  end if;

  return new;
end;
$$;

comment on function app.check_business_listing_link() is
  'Coherencia de listings.business_listing_id (0107): el vínculo sólo existe desde kind=job, apunta a un kind=business del MISMO tenant y del MISMO created_by, y nunca a sí mismo. Falla cerrado con VINCULO_INVALIDO en vez de limpiar la columna en silencio: un empleo guardado sin el negocio que la persona eligió miente sobre quién lo publica. En UPDATE sólo se revalida si el vínculo CAMBIA, para que editar un aviso viejo no falle por algo que ya se había verificado.';

-- SIN `grant execute`, y no es un olvido: la 0082/0083 le quitó a `anon` el
-- EXECUTE por default sobre las funciones nuevas de `app`, pero una función de
-- TRIGGER no la invoca el usuario — la invoca el motor, y Postgres no chequea
-- EXECUTE en ese camino. Otorgarlo acá sería abrir una superficie que nadie
-- necesita para que el trigger funcione.
drop trigger if exists listings_check_business_link on public.listings;
create trigger listings_check_business_link
before insert or update of business_listing_id, kind, tenant_id, created_by
on public.listings
for each row execute function app.check_business_listing_link();

-- ---------------------------------------------------------------------------
-- 3. Índice: "los empleos de este negocio"
-- ---------------------------------------------------------------------------
-- Espeja el prefijo y el orden de paginación de `listings_public_feed_idx`
-- (0004) para que la consulta de la ficha del negocio sea un index scan y no un
-- sort. PARCIAL sobre lo vinculado y publicado: es lo único que esa página
-- muestra, y así el índice no carga con los millones de avisos que nunca van a
-- tener el campo.
create index if not exists listings_business_link_idx
  on public.listings (tenant_id, business_listing_id, published_at desc, id desc)
  where status = 'published' and business_listing_id is not null;

comment on index public.listings_business_link_idx is
  'Empleos publicados de una ficha de negocio (0107). Parcial y con el mismo orden de paginación que listings_public_feed_idx: la ficha del negocio pagina sus puestos igual que el feed pagina los avisos.';

-- ---------------------------------------------------------------------------
-- 4. Grants — explícitos aunque la tabla ya los tenga (ver docblock, §3)
-- ---------------------------------------------------------------------------
-- `listings` es lectura pública por diseño SEO (policy listings_select, 0004:
-- `for select to anon, authenticated` sobre lo publicado), así que la columna
-- nueva la tiene que poder leer también `anon`: la ficha del negocio y la
-- tarjeta del empleo se renderizan sin sesión.
grant select on public.listings to anon, authenticated;
grant insert, update on public.listings to authenticated;

commit;

-- =============================================================================
-- 0110_cierre_de_auditoria.sql — Comunidad Latina
--
-- Tres hallazgos de la auditoría de seguridad del 2026-08-24 sobre el lote de
-- las migraciones 0105-0108. Ninguno es explotable entre cuentas ni entre
-- comunidades —eso se verificó en vivo, evaluando los predicados con JWT
-- reales— pero los tres son casos donde la base promete una cosa y hace otra.
--
--   A. `posts_update` deja firmar con una ficha PROPIA sin publicar.
--   B. `check_business_listing_link` deja colgar un empleo de un negocio
--      PROPIO sin publicar.
--   C. Dos funciones de trigger tienen EXECUTE para PUBLIC, y su docblock
--      afirma exactamente lo contrario.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A · `posts_update` — LE FALTA LA MITAD DEL PREDICADO DE `posts_insert`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `posts_insert` (0023, reescrita en 0046) exige tres cosas de la ficha con la
-- que firmás: que sea tuya, que sea de tu comunidad, y que esté PUBLICADA.
-- `posts_update` copió las dos primeras y se dejó la tercera:
--
--     exists (select 1 from listings l
--              where l.id = posts.entity_listing_id
--                and l.tenant_id = posts.tenant_id
--                and l.created_by = auth.uid())      -- ← sin l.status
--
-- La consecuencia, por PostgREST y sin pasar por la app: creás un post
-- personal, y después lo PATCHeás para firmarlo con una ficha tuya que está en
-- borrador, en pausa o rechazada por moderación. No es cross-owner ni
-- cross-tenant —la ficha tiene que ser tuya igual—, pero rompe la invariante
-- que el INSERT sí sostiene: **una publicación no puede salir a nombre de algo
-- que todavía no existe públicamente.**
--
-- Importa más ahora que antes. Hasta este lote ninguna pantalla escribía
-- `entity_listing_id`, así que la brecha era teórica. Desde que el composer
-- publica con la identidad activa, este campo se usa de verdad, y la pestaña
-- Publicaciones de Negocios muestra exactamente lo que se firma con la ficha.
-- Un negocio despublicado no debería poder seguir apareciendo ahí.
--
-- Se reescribe la policy entera y no se "parcha": una policy es un predicado
-- único, no hay forma de extenderla sin volver a declararla. El resto queda
-- palabra por palabra como estaba, copiado de `pg_policies`, no de memoria.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- B · EL MISMO AGUJERO, EN EL VÍNCULO EMPLEO → NEGOCIO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `app.check_business_listing_link()` (0107) valida existencia, kind, tenant y
-- dueño del negocio — pero no su `status`. Así, un empleo puede colgar de una
-- ficha propia en `pending_review`. Y la ficha del negocio lista sus puestos
-- con `where business_listing_id = <id> and status='published'`: el empleo se
-- vería publicado, apuntando a un negocio que no se puede abrir.
--
-- Es la misma regla que A, en el otro mecanismo. Se cierran juntas para que no
-- queden dos criterios distintos sobre la misma pregunta.
--
-- ⚠️ Se valida SÓLO cuando el vínculo cambia. La guarda de "UPDATE que no toca
-- el vínculo sale temprano" ya existe y se conserva: sin ella, despublicar un
-- negocio dejaría sus empleos viejos imposibles de editar, que es peor que el
-- problema que arreglamos.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- C · DOS FUNCIONES DE TRIGGER CON EXECUTE PARA PUBLIC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `app.check_business_listing_link()` y `app.post_offers_guard()` quedaron con
-- `=X/postgres` en su `proacl`, o sea EXECUTE para PUBLIC, que incluye `anon`.
-- El docblock de la 0107 dice "SIN grant execute".
--
-- No es explotable: el esquema `app` no está expuesto por PostgREST (probado:
-- devuelve `PGRST106`), y una función de trigger invocada directamente aborta
-- porque no hay registro NEW. Pero un comentario que describe un estado que no
-- es el real es exactamente el tipo de cosa que hace que la próxima auditoría
-- confíe en el papel en vez de mirar. Se alinea la realidad con lo escrito.
--
-- Postgres da EXECUTE a PUBLIC por defecto en toda función nueva; las demás de
-- la 0106 lo revocan explícito y a estas dos se les pasó.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A · posts_update con el predicado completo
-- ---------------------------------------------------------------------------

drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    (author_id = (select auth.uid()) and status <> 'removed')
    or (select app.is_staff())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (
      author_id = (select auth.uid())
      and status = any (array['published', 'pending_review'])
      and (
        entity_listing_id is null
        or exists (
          select 1
            from public.listings l
           where l.id = posts.entity_listing_id
             and l.tenant_id = posts.tenant_id
             and l.created_by = (select auth.uid())
             -- El agregado de 0110: iguala el predicado a posts_insert.
             and l.status = 'published'
        )
      )
    )
    or (select app.is_staff())
  )
);

comment on policy posts_update on public.posts is
  'El autor edita su propio post mientras no esté removed, y staff cualquiera. El WITH CHECK exige que si el post se firma con una ficha (entity_listing_id), esa ficha sea suya, de su comunidad y esté PUBLICADA — las tres condiciones, idénticas a posts_insert. La tercera la agregó 0110: faltaba, y permitía PATCHear un post para firmarlo con una ficha propia en borrador o pausada.';


-- ---------------------------------------------------------------------------
-- B · el vínculo empleo → negocio exige negocio publicado
-- ---------------------------------------------------------------------------

create or replace function app.check_business_listing_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind      text;
  v_tenant    uuid;
  v_creador   uuid;
  v_status    text;
begin
  -- Sin vínculo no hay nada que verificar. Es el camino del 99% de las filas
  -- (toda propiedad, todo producto, todo evento) y sale antes de tocar disco.
  if new.business_listing_id is null then
    return new;
  end if;

  -- En un UPDATE que no cambia el vínculo tampoco hay nada que verificar: el
  -- valor ya pasó por acá cuando se escribió. Esto evita que editar el título
  -- de un empleo falle porque el negocio cambió de dueño el mes pasado — o,
  -- desde 0110, porque el negocio se despublicó después.
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

  select l.kind, l.tenant_id, l.created_by, l.status
    into v_kind, v_tenant, v_creador, v_status
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

  -- Agregado en 0110. La ficha del negocio lista sus puestos filtrando por
  -- `status='published'`, así que un empleo colgado de un negocio en borrador
  -- se vería publicado apuntando a algo que nadie puede abrir. Es la misma
  -- regla que `posts_insert` aplica al firmar con una ficha.
  if v_status <> 'published' then
    raise exception 'VINCULO_INVALIDO: el negocio todavía no está publicado';
  end if;

  return new;
end;
$function$;


-- ---------------------------------------------------------------------------
-- C · sacarle a PUBLIC el EXECUTE de las dos funciones de trigger
-- ---------------------------------------------------------------------------

revoke all on function app.check_business_listing_link() from public, anon, authenticated;
revoke all on function app.post_offers_guard()          from public, anon, authenticated;

comment on function app.check_business_listing_link() is
  'Trigger BEFORE INSERT/UPDATE en listings: valida listings.business_listing_id (0107). Exige que el negocio exista, sea kind=business, esté PUBLICADO (0110), sea de la misma comunidad y del mismo dueño, y que el aviso vinculado sea kind=job y no sea él mismo. Falla cerrado con VINCULO_INVALIDO. Sólo se valida cuando el vínculo CAMBIA, para no bloquear la edición de un empleo viejo. SIN execute para public/anon/authenticated (0110: lo tenía por el default de Postgres, contra lo que decía su propio comentario) — se dispara por trigger, nunca se llama.';

commit;

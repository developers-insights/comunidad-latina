-- =============================================================================
-- 0117_evento_de_un_negocio.sql — Comunidad Latina
--
-- Un EVENTO puede colgar de la ficha del negocio que lo organiza, igual que un
-- empleo desde la 0107.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ PEDIDO CIERRA, Y POR QUÉ NO ALCANZABA CON LO QUE HABÍA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Spec de módulos, dos lugares que piden lo mismo desde distintos ángulos:
--
--   §2 (Negocios → Publicaciones): «Tarjetas de eventos vinculadas con Eventos.
--       Tarjetas de empleos vinculadas con Empleos.»
--   §6 (Eventos): «Después de publicarse, el evento aparece en: Módulo Eventos,
--       PÁGINA DEL ORGANIZADOR, feed de sus seguidores, búsquedas locales,
--       historial de publicaciones del organizador.»
--
-- «Página del organizador» es, para un comercio, su ficha de negocio. Y hasta
-- hoy no había forma de llegar de un evento a esa ficha: `created_by` apunta a
-- la PERSONA, y una persona puede tener una ficha de negocio, dos verticales
-- distintas o ninguna. Deducir el negocio desde el dueño es exactamente el
-- atajo que la 0107 ya había rechazado para los empleos («el mismo hecho en dos
-- lugares»), y acá tendría el mismo problema: la parrilla y la peluquería de la
-- misma dueña quedarían con los eventos de la otra.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA COLUMNA YA EXISTE. LO ÚNICO QUE CAMBIA ES UNA LÍNEA DEL TRIGGER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `listings.business_listing_id` (0107) es genérica: vive en `listings`, no en
-- una tabla de empleos. Lo que la limitaba a los empleos era una sola guarda de
-- `app.check_business_listing_link()`:
--
--     if new.kind <> 'job' then raise exception 'VINCULO_INVALIDO: …'
--
-- Y esa guarda estaba bien puesta: cuando se escribió, el vínculo lo usaba UN
-- solo vertical, y aceptar el campo en cualquier otro habría guardado un dato
-- que ninguna pantalla iba a leer. Ahora hay dos verticales que lo leen, así que
-- la guarda pasa a nombrar los dos — y sigue rechazando el resto, por el mismo
-- motivo de siempre: una propiedad con negocio vinculado es un cliente
-- equivocado, y decírselo es más útil que guardarle un dato inerte.
--
-- TODO LO DEMÁS DEL TRIGGER QUEDA IGUAL, palabra por palabra: existencia, kind
-- del vinculado, misma comunidad, mismo dueño, negocio publicado (0110), y la
-- salida temprana del UPDATE que no toca el vínculo. Se reescribe la función
-- entera porque en PL/pgSQL no hay forma de parchear una línea, no porque haya
-- algo más que cambiar.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE NO SE TOCA
-- ═══════════════════════════════════════════════════════════════════════════
--
--   · EL ÍNDICE. `listings_business_link_idx` (0107) es
--     `(tenant_id, business_listing_id, published_at desc, id desc)` sobre las
--     publicadas con vínculo, sin filtrar por `kind`: cubre los eventos igual
--     que cubre los empleos. Agregar uno por vertical sería pagar dos veces por
--     la misma búsqueda.
--
--   · LA POLICY. `listings_insert`/`listings_update` no miran esta columna: el
--     vínculo lo autoriza el trigger, que es `security definer` y ya verifica
--     dueño y comunidad. Dos lugares decidiendo lo mismo es la forma más
--     confiable de que un día digan cosas distintas.
--
--   · EL EVENTO SIN NEGOCIO. Sigue siendo el caso normal y no pide nada: una
--     juntada de vecinos no tiene organizador comercial, y la columna es
--     nullable justamente para eso.
-- =============================================================================

begin;

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
  -- (toda propiedad, todo producto, casi todo evento) y sale antes de tocar
  -- disco.
  if new.business_listing_id is null then
    return new;
  end if;

  -- En un UPDATE que no cambia el vínculo tampoco hay nada que verificar: el
  -- valor ya pasó por acá cuando se escribió. Esto evita que editar el título
  -- de un aviso falle porque el negocio cambió de dueño el mes pasado — o,
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

  -- Los DOS verticales que hoy leen el vínculo: el empleo (0107) y el evento
  -- (0117, «página del organizador» de la spec §6). El resto se rechaza en vez
  -- de ignorarse: un cliente que mande el campo en un kind que no lo usa está
  -- equivocado, y decírselo es más útil que guardarle un dato inerte.
  if new.kind not in ('job', 'event') then
    raise exception 'VINCULO_INVALIDO: sólo un empleo o un evento pueden vincularse a un negocio (kind=%)', new.kind;
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
  -- Sin esto, cualquiera publicaría un evento colgado del restaurante más
  -- conocido del barrio y se llevaría su reputación prestada.
  if v_creador is distinct from new.created_by then
    raise exception 'VINCULO_INVALIDO: sólo podés vincular un aviso a un negocio tuyo';
  end if;

  -- Agregado en 0110. La ficha del negocio lista lo suyo filtrando por
  -- `status='published'`, así que un aviso colgado de un negocio en borrador se
  -- vería publicado apuntando a algo que nadie puede abrir. Es la misma regla
  -- que `posts_insert` aplica al firmar con una ficha.
  if v_status <> 'published' then
    raise exception 'VINCULO_INVALIDO: el negocio todavía no está publicado';
  end if;

  return new;
end;
$function$;

comment on function app.check_business_listing_link() is
  'Coherencia de listings.business_listing_id (0107, ampliado en 0117): el vínculo sólo existe desde kind=job o kind=event, apunta a un kind=business del MISMO tenant y del MISMO created_by, publicado (0110), y nunca a sí mismo. Falla cerrado con VINCULO_INVALIDO en vez de limpiar la columna en silencio: un aviso guardado sin el negocio que la persona eligió miente sobre quién lo publica. En UPDATE sólo se revalida si el vínculo CAMBIA, para que editar un aviso viejo no falle por algo que ya se había verificado.';

comment on column public.listings.business_listing_id is
  'Ficha de negocio (kind=business) bajo la que se publicó este aviso. La usan los EMPLEOS desde 0107 y los EVENTOS desde 0117 («página del organizador», spec §6). null = el aviso es personal o su vertical no admite el vínculo. La coherencia la sostiene app.check_business_listing_link(), no una policy: dueño, comunidad, kind y estado publicado del negocio.';

commit;

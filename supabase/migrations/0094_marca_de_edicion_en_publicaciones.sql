-- =============================================================================
-- 0094_marca_de_edicion_en_publicaciones.sql — Comunidad Latina
--
-- Una publicación editada en silencio es una trampa para quien la comentó: el
-- comentario queda respondiendo a un texto que ya no existe. Editar tiene que
-- verse, y para que se vea hace falta un dato que hoy no existe.
--
-- POR QUÉ NO ALCANZA `updated_at`
-- --------------------------------
-- El trigger `posts_set_updated_at` (0007) se dispara con `body`, `media`,
-- `kind` y `status`. Los tres primeros son ediciones de verdad; el cuarto no:
-- cuando la moderación aprueba un post que estaba en `pending_review`, cambia
-- `status` y `updated_at` se mueve sin que el autor haya tocado nada. Marcar
-- ese post como "editado" es mentirle a quien lo lee — y encima en el caso
-- donde menos conviene mentir, porque insinúa que el autor cambió algo después
-- de pasar por revisión.
--
-- `edited_at` sólo se mueve cuando el AUTOR cambia el texto. Es NULL para todo
-- lo que existe hoy, que es exactamente lo correcto: nada de lo publicado hasta
-- ahora fue editado por su autor, y una marca retroactiva sería falsa.
--
-- POR QUÉ UN TRIGGER Y NO CONFIAR EN LA APP
-- ------------------------------------------
-- Lo mismo que hace la 0007 con `updated_at`: si la marca dependiera de que la
-- server action se acuerde de setearla, el día que alguien agregue un segundo
-- camino de edición —un panel de moderación, un script de corrección, una
-- action nueva— la marca deja de aparecer y nadie se entera. El trigger la pone
-- pase lo que pase, y no puede saltearse desde el cliente.
--
-- La condición es `body distinct from` a propósito: guardar el MISMO texto no
-- es una edición. Sin eso, abrir la hoja de edición y apretar "Guardar" sin
-- cambiar nada dejaría el post marcado para siempre.
-- =============================================================================

begin;

alter table public.posts
  add column if not exists edited_at timestamptz;

comment on column public.posts.edited_at is
  'Cuándo el AUTOR editó el texto por última vez. NULL = nunca lo editó, que es el estado de todo lo publicado antes de la 0094. Distinto de updated_at, que también se mueve cuando la moderación cambia el status y por eso no sirve para mostrarle a la gente "editado".';

-- -----------------------------------------------------------------------------
-- El trigger. `security definer` NO hace falta: escribe una columna de la fila
-- que ya se está actualizando, con los permisos de quien hace el UPDATE.
-- -----------------------------------------------------------------------------
create or replace function app.posts_set_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Sólo el cambio de TEXTO cuenta como edición. Un cambio de `status` (lo hace
  -- la moderación), de `media` (hoy no se puede editar) o de cualquier contador
  -- no es algo que el autor haya reescrito.
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

comment on function app.posts_set_edited_at() is
  'Marca edited_at cuando cambia el body de una publicación. Vive en un trigger y no en la app para que ningún camino de edición futuro pueda olvidarse de ponerla.';

drop trigger if exists posts_set_edited_at on public.posts;
create trigger posts_set_edited_at
  before update of body on public.posts
  for each row
  execute function app.posts_set_edited_at();

commit;

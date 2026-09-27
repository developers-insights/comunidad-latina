begin;

-- =============================================================================
-- 0160 · Un video por aviso, con la regla de los videos largos pagos
-- =============================================================================
--
-- Nacho (23/9): en propiedades, empleos, etc. sólo se podían subir fotos. Ahora
-- cada aviso admite UN video, en el bucket `post-media` (el mismo prefijo
-- `{tenant}/{usuario}/` y la misma policy de storage que los videos de posts).
--
-- La regla de negocio vive acá y no sólo en la app:
--   · hasta 90 s: cualquier aviso;
--   · de 91 s a 5 min: sólo un aviso `premium` (la suscripción que ya existe,
--     /negocios/presencia/aviso/[id], que ya prometía "1 video de hasta 5
--     minutos");
--   · más de 5 min: nunca.
--
-- El trigger mira SÓLO los cambios del video. Si un aviso premium con video
-- largo vuelve a gratis, la fila queda como está: la app lo muestra cortado a
-- 90 s y sin "Ver video completo" (ver `esVideoLargoDeAviso`). Rechazar la
-- baja de tier por el video rompería el webhook de Stripe.
-- =============================================================================

alter table public.listings
  add column if not exists video_path text,
  add column if not exists video_poster_path text,
  add column if not exists video_duration_seconds integer;

alter table public.listings
  drop constraint if exists listings_video_consistente;
alter table public.listings
  add constraint listings_video_consistente check (
    (video_path is null and video_poster_path is null and video_duration_seconds is null)
    or (
      video_path is not null
      and video_duration_seconds between 1 and 300
      and video_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
      and video_path !~ '\.\.'
      and (
        video_poster_path is null
        or (video_poster_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+\.jpg$'
            and video_poster_path !~ '\.\.')
      )
    )
  );

create or replace function app.listings_guard_video()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.video_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.video_path is not distinct from old.video_path
     and new.video_poster_path is not distinct from old.video_poster_path
     and new.video_duration_seconds is not distinct from old.video_duration_seconds then
    return new;
  end if;

  -- El archivo tiene que estar en la carpeta de quien publica: el bucket es
  -- público de lectura, y sin esto se podía colgar el video de otra persona.
  if new.created_by is null
     or split_part(new.video_path, '/', 1) <> new.tenant_id::text
     or split_part(new.video_path, '/', 2) <> new.created_by::text
     or (new.video_poster_path is not null
         and (split_part(new.video_poster_path, '/', 1) <> new.tenant_id::text
              or split_part(new.video_poster_path, '/', 2) <> new.created_by::text)) then
    raise exception 'LISTING_VIDEO_NOT_OWN' using errcode = 'check_violation';
  end if;

  if new.video_duration_seconds > 90 and coalesce(new.tier, 'free') <> 'premium' then
    raise exception 'LISTING_VIDEO_NEEDS_PREMIUM' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists listings_guard_video on public.listings;
create trigger listings_guard_video
  before insert or update of video_path, video_poster_path, video_duration_seconds
  on public.listings
  for each row execute function app.listings_guard_video();

create index if not exists listings_video_largo_idx
  on public.listings (tenant_id, created_at desc, id desc)
  where video_path is not null and video_duration_seconds > 90 and tier = 'premium';

grant select (video_path, video_poster_path, video_duration_seconds)
  on public.listings to anon, authenticated;
grant insert (video_path, video_poster_path, video_duration_seconds),
      update (video_path, video_poster_path, video_duration_seconds)
  on public.listings to authenticated;

commit;

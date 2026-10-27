-- Push nativo para la app de iOS (Capacitor) y, a futuro, Android.
--
-- Cada fila de `notifications` que se inserta (por createNotification o por
-- las funciones SQL que avisan directo: 0068, 0098, 0118, 0151) dispara un
-- POST a /api/push/despachar con su id. El despacho decide si corresponde
-- (preferencias, dispositivos) y habla con APNs. El trigger va en la base y no
-- en el helper de TS justamente para no perder los avisos que nacen en SQL.
--
-- La URL y el secreto viven en Vault (`push_dispatch_url`,
-- `push_dispatch_secret`). Sin esos dos secretos el trigger no hace nada: no
-- rompe el insert ni deja la notificación a medias.

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_devices (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android')),
  token         text not null unique check (char_length(token) between 32 and 512),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists push_devices_profile_idx on public.push_devices (profile_id);

alter table public.push_devices enable row level security;

-- El registro y la baja pasan por /api/push/dispositivos con el cliente de
-- sesión; el dueño sólo ve y borra lo suyo. El alta usa upsert por token
-- desde el servidor con service role, porque un mismo token puede pasar de una
-- cuenta a otra al cambiar de usuario en el mismo teléfono.
drop policy if exists push_devices_select_own on public.push_devices;
create policy push_devices_select_own on public.push_devices
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists push_devices_delete_own on public.push_devices;
create policy push_devices_delete_own on public.push_devices
  for delete to authenticated using (profile_id = (select auth.uid()));

revoke all on public.push_devices from anon;

create or replace function app.push_despachar_notificacion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.push_devices d where d.profile_id = new.profile_id) then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Un push fallido jamás debe tumbar la notificación in-app.
  return new;
end;
$$;

revoke all on function app.push_despachar_notificacion() from public, anon, authenticated;

drop trigger if exists notifications_push_despachar on public.notifications;
create trigger notifications_push_despachar
  after insert on public.notifications
  for each row execute function app.push_despachar_notificacion();

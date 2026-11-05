-- =============================================================================
-- 0184_tope_de_recuperacion.sql — Comunidad Latina
--
-- El tope de "olvidé mi contraseña" vivía en memoria de cada instancia, así que el
-- límite real era 3 × instancias y un redeploy lo ponía en cero. Esta tabla lo hace
-- durable; la política (3 por hora por cuenta, 5 por IP, 60 s de espera) la decide
-- `lib/auth/recovery-tope.ts`. Si la RPC no está o falla, ese módulo cae al límite
-- en memoria: se puede desplegar antes o después que el código.
--
-- `clave` es un HMAC: acá no entra un correo ni una IP en claro (§11). `app` no
-- está expuesto y la tabla no tiene policies; sólo se llega por la RPC.
-- =============================================================================

begin;

create table app.recuperar_tope (
  clave text primary key,
  desde timestamptz not null,
  usos  int not null
);

comment on table app.recuperar_tope is
  'Ventanas fijas del tope de recuperación de contraseña. Sin policies: se escribe sólo por public.consumir_tope_de_recuperacion. clave es un HMAC, nunca un correo o una IP. pg_cron borra lo vencido cada hora.';

alter table app.recuperar_tope enable row level security;

revoke all on table app.recuperar_tope from public, anon, authenticated;

-- Vive en `public` porque el admin client llega por PostgREST, y `app` no está
-- expuesto. Un solo `insert … on conflict`: el lock de la fila serializa dos
-- pedidos simultáneos, un select + update dejaría pasar a los dos. `usos` se topa
-- para que un ataque sostenido no lo haga crecer sin fin.
create function public.consumir_tope_de_recuperacion(
  p_clave            text,
  p_maximo           int,
  p_ventana_segundos int
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.recuperar_tope as t (clave, desde, usos)
  values (p_clave, now(), 1)
  on conflict (clave) do update
    set desde = case
                  when t.desde <= now() - make_interval(secs => p_ventana_segundos) then now()
                  else t.desde
                end,
        usos  = case
                  when t.desde <= now() - make_interval(secs => p_ventana_segundos) then 1
                  else least(t.usos, p_maximo) + 1
                end
  returning t.usos <= p_maximo;
$$;

comment on function public.consumir_tope_de_recuperacion(text, int, int) is
  'Cuenta un intento bajo p_clave y devuelve true si entra en el cupo de p_maximo por ventana de p_ventana_segundos. Atómica. EXECUTE sólo para service_role.';

revoke execute on function public.consumir_tope_de_recuperacion(text, int, int) from public, anon, authenticated;
grant execute on function public.consumir_tope_de_recuperacion(text, int, int) to service_role;

select cron.schedule(
  'limpiar-tope-de-recuperacion',
  '17 * * * *',
  $$delete from app.recuperar_tope where desde < now() - interval '2 hours'$$
);

notify pgrst, 'reload schema';

commit;

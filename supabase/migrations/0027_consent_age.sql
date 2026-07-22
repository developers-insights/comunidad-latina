-- Consentimiento de registro (plan cliente semana 3): atestación de edad 18+
-- y aceptación de Términos/Privacidad/Normas. Minimización de datos: NO se
-- guarda fecha de nacimiento, solo el timestamp de la atestación.
alter table public.profiles
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
comment on column public.profiles.age_confirmed_at is 'Timestamp de la atestación 18+ en el registro (no se guarda fecha de nacimiento).';
comment on column public.profiles.terms_accepted_at is 'Timestamp de aceptación de Términos/Privacidad/Normas.';
comment on column public.profiles.terms_version is 'Versión del set legal aceptado.';

-- =============================================================================
-- 0037_score_engine.sql — Comunidad Latina
-- MOTOR de score (§3), última migración: consume tablas creadas en varias
-- migraciones (score_penalties 0029, connected_accounts 0035, business_*
-- 0031...). Por eso va acá, con create or replace + guardas to_regclass()
-- (late-binding, forward-compatible) donde toca tablas opcionales.
--
--   * recalc_user_score / recalc_creator_score / recalc_business_score:
--     funciones security definer que LEEN los contadores agregados que ya viven
--     en la DB (antigüedad, contratos released, reviews, verificaciones,
--     penalizaciones) y ESCRIBEN la fila de score + append a score_history +
--     nivel (funciones puras de 0029). La app NUNCA computa el score.
--   * Triggers de evento (§36): tras review, tras contrato released, tras
--     penalización, tras cambio de verificación.
--   * pg_cron diario (§36 "1×/día"): recalc-scores-daily.
--
-- ⚠️ PESOS PROVISIONALES: el design doc define los MÁXIMOS por factor (§5/§16/
-- §106) pero NO las fórmulas exactas punto-a-punto. Acá se encodean pesos
-- redondos, CLARAMENTE MARCADOS, que leen hechos reales (no el "+25 hardcodeado"
-- del placeholder viejo). CONFIRMAR/ajustar contra la spec antes de confiar en
-- el cron diario. INVARIANTE §35: solo se serializan POSITIVOS en factors; los
-- negativos entran vía score_penalties (que el motor resta).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- recalc_user_score — User Score (trust_scores) desde hechos.
-- ---------------------------------------------------------------------------
create or replace function app.recalc_user_score(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant     uuid;
  v_identity   boolean;
  v_phone      boolean;
  v_email      boolean;
  v_created    timestamptz;
  v_months     numeric := 0;
  v_txn        int := 0;
  v_endorse    int := 0;
  v_penalty    int := 0;
  f_identity   int;
  f_tenure     int;
  f_completion int := 0;   -- requiere campos de perfil ricos (Fase 2)
  f_particip   int;
  f_behavior   int;
  f_txn        int;
  v_score      int;
  v_prev       int;
  v_lvl_before text;
  v_lvl_after  text;
begin
  select p.tenant_id, p.identity_verified, coalesce(p.phone_verified, false),
         coalesce(p.email_verified, false), p.created_at
    into v_tenant, v_identity, v_phone, v_email, v_created
    from public.profiles p where p.id = p_profile;
  if not found then return; end if;

  v_months := extract(epoch from (now() - v_created)) / (60 * 60 * 24 * 30);

  -- Transacciones sin disputa: contratos released donde participó.
  select count(*) into v_txn from public.gig_contracts c
   where c.status = 'released' and (c.client_id = p_profile or c.creator_id = p_profile);

  -- Avales: contador crudo del signals existente (NO grafo — §5.4).
  select coalesce((ts.signals ->> 'endorsements_count')::int, 0), ts.score, ts.level
    into v_endorse, v_prev, v_lvl_before
    from public.trust_scores ts where ts.profile_id = p_profile;
  v_endorse := coalesce(v_endorse, 0);

  -- Penalizaciones activas del sujeto user.
  if to_regclass('public.score_penalties') is not null then
    select coalesce(sum(sp.points), 0) into v_penalty from public.score_penalties sp
     where sp.subject_type = 'user' and sp.subject_id = p_profile and sp.is_reverted = false;
  end if;

  -- Factores (PROVISIONAL — máximos de §5; pesos a confirmar). Solo positivos.
  f_identity := (case when v_identity then 15 else 0 end)
              + (case when v_phone then 10 else 0 end)
              + (case when v_email then 5 else 0 end);          -- máx 30
  f_tenure   := least(20, floor(v_months))::int;                -- máx 20 (1pt/mes)
  f_particip := least(15, v_endorse * 3);                       -- máx 15
  f_txn      := least(20, v_txn * 5);                           -- máx 20
  f_behavior := greatest(0, 15 - coalesce(v_penalty, 0));       -- base 15 − penalizaciones activas

  v_score := least(100, greatest(0,
    f_identity + f_tenure + f_completion + f_particip + f_txn + f_behavior));
  v_lvl_after := app.user_level(v_score);

  insert into public.trust_scores as t
    (profile_id, tenant_id, score, score_previous, level, factors, computed_at, score_version)
  values (p_profile, v_tenant, v_score, v_prev, v_lvl_after,
    jsonb_build_object(
      'identity_security', f_identity, 'tenure_activity', f_tenure,
      'profile_completion', f_completion, 'positive_participation', f_particip,
      'transactional_trust', f_txn, 'behavior_history', f_behavior),
    now(), 1)
  on conflict (profile_id) do update
    set score = excluded.score,
        score_previous = t.score,
        level = excluded.level,
        factors = excluded.factors,
        computed_at = excluded.computed_at;

  if to_regclass('public.score_history') is not null
     and (v_prev is distinct from v_score or v_lvl_before is distinct from v_lvl_after) then
    insert into public.score_history
      (tenant_id, subject_type, subject_id, score_before, score_after, level_before, level_after, delta, reason, source)
    values (v_tenant, 'user', p_profile, v_prev, v_score, v_lvl_before, v_lvl_after,
            v_score - coalesce(v_prev, 0), 'recálculo automático', 'recalc');
  end if;
end;
$$;

comment on function app.recalc_user_score(uuid) is
  'Recomputa el User Score (trust_scores) desde hechos (verificaciones, antigüedad, contratos released, avales) − penalizaciones activas, escribe la fila + score_history + nivel (app.user_level). PESOS PROVISIONALES (§5) — confirmar contra spec.';

-- ---------------------------------------------------------------------------
-- recalc_creator_score — Creator Score. Rating computado fresco desde
-- gig_reviews (independiente del orden de triggers).
-- ---------------------------------------------------------------------------
create or replace function app.recalc_creator_score(p_creator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant       uuid;
  v_completed    int := 0;
  v_rating       numeric := 0;
  v_charges      boolean := false;
  v_penalty      int := 0;
  v_provisional  boolean;
  f_quality      int;
  f_fulfillment  int;
  v_score        int;
  v_prev         int;
  v_lvl_before   int;
  v_lvl_after    int;
begin
  select cp.tenant_id, coalesce(cp.completed_jobs, 0)
    into v_tenant, v_completed
    from public.creator_profiles cp where cp.profile_id = p_creator;
  if not found then return; end if;

  -- Rating fresco desde las reviews (no depende de creator_profiles.rating_avg).
  select coalesce(round(avg(r.rating)::numeric, 2), 0) into v_rating
    from public.gig_reviews r where r.ratee_id = p_creator;

  -- charges_enabled desde Connect (guardado: connected_accounts es de 0035).
  if to_regclass('public.connected_accounts') is not null then
    select coalesce(bool_or(ca.charges_enabled), false) into v_charges
      from public.connected_accounts ca
     where ca.owner_type = 'creator' and ca.owner_ref = p_creator;
  end if;

  if to_regclass('public.score_penalties') is not null then
    select coalesce(sum(sp.points), 0) into v_penalty from public.score_penalties sp
     where sp.subject_type = 'creator' and sp.subject_id = p_creator and sp.is_reverted = false;
  end if;

  v_provisional := v_completed < 3;

  -- Factores creador (PROVISIONAL — máximos de §16; pesos a confirmar).
  f_quality     := least(25, round(coalesce(v_rating, 0) * 5))::int;  -- rating 1-5 → máx 25
  f_fulfillment := least(20, v_completed * 4);                        -- máx 20
  v_score := least(100, greatest(0, f_quality + f_fulfillment - coalesce(v_penalty, 0)));
  -- provisional: la UI muestra 50 (§17); se persiste el score real + el flag.

  select cs.score, cs.level into v_prev, v_lvl_before
    from public.creator_scores cs where cs.profile_id = p_creator;
  v_lvl_after := app.creator_level(v_score, v_charges);

  insert into public.creator_scores as t
    (profile_id, tenant_id, score, score_previous, level, factors, is_provisional, computed_at, score_version)
  values (p_creator, v_tenant, v_score, v_prev, v_lvl_after,
    jsonb_build_object('quality_satisfaction', f_quality, 'job_fulfillment', f_fulfillment),
    v_provisional, now(), 1)
  on conflict (profile_id) do update
    set score = excluded.score,
        score_previous = t.score,
        level = excluded.level,
        factors = excluded.factors,
        is_provisional = excluded.is_provisional,
        computed_at = excluded.computed_at;

  if to_regclass('public.score_history') is not null
     and (v_prev is distinct from v_score or v_lvl_before is distinct from v_lvl_after) then
    insert into public.score_history
      (tenant_id, subject_type, subject_id, score_before, score_after, level_before, level_after, delta, reason, source)
    values (v_tenant, 'creator', p_creator, v_prev, v_score, v_lvl_before::text, v_lvl_after::text,
            v_score - coalesce(v_prev, 0), 'recálculo automático', 'recalc');
  end if;
end;
$$;

comment on function app.recalc_creator_score(uuid) is
  'Recomputa el Creator Score desde rating (fresco de gig_reviews) + trabajos completados − penalizaciones, con is_provisional (<3 trabajos). Nivel por app.creator_level (0 sin charges_enabled). PESOS PROVISIONALES (§16).';

-- ---------------------------------------------------------------------------
-- recalc_business_score — Business Score. LEAN: business_accounts tiene 0 filas
-- hoy y business_reviews está DIFERIDA (OQ#4) → el factor de reseñas verificadas
-- queda en 0 hasta cablear la relación negocio↔contrato (Fase 2).
-- ---------------------------------------------------------------------------
create or replace function app.recalc_business_score(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant       uuid;
  v_verified     boolean := false;
  v_penalty      int := 0;
  f_verification int;
  f_reviews      int := 0;   -- reseñas verificadas: se cablea en Fase 2
  v_score        int;
  v_prev         int;
  v_lvl_before   int;
  v_lvl_after    int;
begin
  select ba.tenant_id into v_tenant from public.business_accounts ba where ba.id = p_business;
  if not found then return; end if;

  if to_regclass('public.business_verifications') is not null then
    select (bv.verification_status = 'verified') into v_verified
      from public.business_verifications bv where bv.business_id = p_business;
  end if;

  if to_regclass('public.score_penalties') is not null then
    select coalesce(sum(sp.points), 0) into v_penalty from public.score_penalties sp
     where sp.subject_type = 'business' and sp.subject_id = p_business and sp.is_reverted = false;
  end if;

  -- Factores negocio (PROVISIONAL — §106; a confirmar). Solo positivos.
  f_verification := case when coalesce(v_verified, false) then 40 else 0 end;
  v_score := least(100, greatest(0, f_verification + f_reviews - coalesce(v_penalty, 0)));

  select bs.score, bs.level into v_prev, v_lvl_before
    from public.business_scores bs where bs.business_id = p_business;
  v_lvl_after := app.business_level(v_score);

  insert into public.business_scores as t
    (business_id, tenant_id, score, score_previous, level, factors, computed_at, score_version)
  values (p_business, v_tenant, v_score, v_prev, v_lvl_after,
    jsonb_build_object('verification', f_verification, 'verified_reviews', f_reviews),
    now(), 1)
  on conflict (business_id) do update
    set score = excluded.score,
        score_previous = t.score,
        level = excluded.level,
        factors = excluded.factors,
        computed_at = excluded.computed_at;

  if to_regclass('public.score_history') is not null
     and (v_prev is distinct from v_score or v_lvl_before is distinct from v_lvl_after) then
    insert into public.score_history
      (tenant_id, subject_type, subject_id, score_before, score_after, level_before, level_after, delta, reason, source)
    values (v_tenant, 'business', p_business, v_prev, v_score, v_lvl_before::text, v_lvl_after::text,
            v_score - coalesce(v_prev, 0), 'recálculo automático', 'recalc');
  end if;
end;
$$;

comment on function app.recalc_business_score(uuid) is
  'Recomputa el Business Score desde business_verifications − penalizaciones. El factor "reseñas verificadas" queda en 0 (business_reviews DIFERIDA, OQ#4; la relación negocio↔contrato se cablea en Fase 2). PESOS PROVISIONALES (§106).';

-- ---------------------------------------------------------------------------
-- Triggers de evento (§36)
-- ---------------------------------------------------------------------------

-- Tras una review: recomputa el User Score del calificado + su Creator Score si
-- tiene perfil de creador.
create or replace function app.trg_recalc_on_gig_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalc_user_score(new.ratee_id);
  if exists (select 1 from public.creator_profiles cp where cp.profile_id = new.ratee_id) then
    perform app.recalc_creator_score(new.ratee_id);
  end if;
  return new;
end;
$$;

create trigger gig_reviews_recalc_scores
after insert on public.gig_reviews
for each row execute function app.trg_recalc_on_gig_review();

-- Tras liberar un contrato: recomputa ambas partes (+ Creator Score del creador).
create or replace function app.trg_recalc_on_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'released' and old.status is distinct from 'released' then
    perform app.recalc_user_score(new.client_id);
    perform app.recalc_user_score(new.creator_id);
    if exists (select 1 from public.creator_profiles cp where cp.profile_id = new.creator_id) then
      perform app.recalc_creator_score(new.creator_id);
    end if;
  end if;
  return new;
end;
$$;

-- Nombre > gig_contracts_bump_completed alfabéticamente: bump corre antes, así
-- recalc lee completed_jobs ya incrementado.
create trigger gig_contracts_recalc_scores
after update on public.gig_contracts
for each row execute function app.trg_recalc_on_contract();

-- Tras una penalización (o su reversión): recomputa el sujeto.
create or replace function app.trg_recalc_on_penalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_type = 'user' then
    perform app.recalc_user_score(new.subject_id);
  elsif new.subject_type = 'creator' then
    perform app.recalc_creator_score(new.subject_id);
  elsif new.subject_type = 'business' then
    perform app.recalc_business_score(new.subject_id);
  end if;
  return new;
end;
$$;

create trigger score_penalties_recalc
after insert or update on public.score_penalties
for each row execute function app.trg_recalc_on_penalty();

-- Tras un cambio de verificación (identity/phone/email): recomputa el User Score.
create or replace function app.trg_recalc_on_profile_verify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.identity_verified is distinct from old.identity_verified
     or new.phone_verified is distinct from old.phone_verified
     or new.email_verified is distinct from old.email_verified then
    perform app.recalc_user_score(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_recalc_on_verify
after update on public.profiles
for each row execute function app.trg_recalc_on_profile_verify();

-- ---------------------------------------------------------------------------
-- Recalc de todos los sujetos (para el cron diario). security definer.
-- ---------------------------------------------------------------------------
create or replace function app.recalc_all_scores()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform app.recalc_user_score(r.id);
  end loop;
  for r in select profile_id from public.creator_profiles loop
    perform app.recalc_creator_score(r.profile_id);
  end loop;
  for r in select id from public.business_accounts loop
    perform app.recalc_business_score(r.id);
  end loop;
end;
$$;

comment on function app.recalc_all_scores() is
  'Recorre todos los sujetos y recomputa sus scores (§36 "1×/día"). Imprescindible para factores que cambian con el tiempo sin evento (umbrales de antigüedad). ⚠️ La primera corrida SOBREESCRIBE los scores sembrados del demo con los computados (pesos provisionales) — tunear los pesos antes de confiar en el cron.';

-- pg_cron diario (02:00 UTC, antes de las purgas). Idempotente (patrón 0013).
do $$
begin
  perform cron.unschedule('recalc-scores-daily');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'recalc-scores-daily',
  '0 2 * * *',
  $$select app.recalc_all_scores()$$
);

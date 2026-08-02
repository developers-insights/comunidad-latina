-- 0058 — Cerrar por columna lo que la policy no puede cerrar por fila.
--
-- `profiles_select` es `using (true)` para anon y eso sigue siendo deliberado:
-- las fichas públicas y los perfiles se ven sin cuenta, es el producto. Pero
-- "la FILA es pública" no quiere decir "TODA la fila es pública", y RLS no sabe
-- de columnas. Eso se resuelve con permisos de columna, que es lo que hace esta
-- migración.
--
-- En la ronda 1 esto quedó marcado y NO aplicado porque `perfil/[id]/page.tsx`
-- hacía `select("*")` sobre una página pública: sacarle una columna a anon la
-- habría hecho fallar con 42501. El frente de app ya lo pasó a lista explícita
-- de 8 columnas, así que ahora sí entra.
--
-- Verificado en vivo ANTES de aplicar, como anon:
--   select display_name, role, account_status, tenant_id from public.profiles;
--   → "Carlos Rosario"          | domain_admin | active | 019f39cf-5115…
--     "Geovanny (Global Admin)" | global_admin | active | 019f39cf-55e8…
--     "Manuel Navarro"          | member       | active | 019f39cf-5115…
-- O sea que cualquiera, sin registrarse, se bajaba la lista de quiénes son los
-- administradores de cada comunidad. Eso no es un dato de perfil público: es un
-- mapa de a quién conviene atacar.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles: sólo a `anon`, nunca a `authenticated`
-- ---------------------------------------------------------------------------
-- ⚠️ `authenticated` NO se toca, a propósito. `src/app/(app)/layout.tsx:33` lee
-- `account_status` y `suspended_until` de la fila propia con sesión: es la
-- puerta que aplica baneos y suspensiones. Revocarle esas dos columnas a
-- `authenticated` desarma la sanción en toda la app.
--
-- Igual que en 0057: el REVOKE por columna es un no-op mientras el rol tenga
-- SELECT sobre la tabla entera, así que primero se saca el de tabla y después
-- se devuelven las columnas una por una.
--
-- Las 8 que quedan son la unión de lo que leen los caminos alcanzables SIN
-- sesión. Se clasificó uso por uso los 63 `from("profiles")` de `src/`; los que
-- tocan alguna de las 12 revocadas son todos de sesión o de service_role:
--
--   tenant_id            → (auth)/actions.ts:299  — corta antes con `if (!user) return`
--                          perfil/actions.ts:125  — server action con sesión
--                          api/webhooks/stripe    — cliente admin (service_role)
--   role                 → admin/miembros/page.tsx:49 — detrás del guard de admin
--   account_status,
--   suspended_until      → (app)/layout.tsx:33 dentro de `if (user)`, y admin/miembros
--   identity_verified_at → perfil/verificar/{page,resultado} — ambas `redirect` sin user
--   locale, updated_at, age_confirmed_at, terms_accepted_at,
--   terms_version, phone_verified, email_verified → no las lee nadie en src/
--
-- Y el único `select("*")` que queda sobre profiles (perfil/(lista)/page.tsx:74)
-- está detrás de `if (!user) redirect("/entrar?next=/perfil")`, o sea que corre
-- como `authenticated` y no lo alcanza este REVOKE.

revoke select on public.profiles from anon;

grant select (
  id,
  display_name,
  avatar_url,
  country_origin,
  area_label,
  bio,
  identity_verified,
  created_at
) on public.profiles to anon;

-- ---------------------------------------------------------------------------
-- 2. Los internos del motor de scoring
-- ---------------------------------------------------------------------------
-- `factors` guarda el desglose de cómo se calculó el score. Publicarlo es
-- entregar el manual para gamearlo: quien lo lee sabe exactamente qué palanca
-- mover para subir. Ninguna de las dos tablas se lee desde `src/` — en
-- `creadores/perfil/queries.ts:23` está escrito que el Creator Score "NO SE
-- LEE" todavía — así que revocarlas hoy no rompe nada y deja la puerta cerrada
-- para cuando esas tablas empiecen a usarse de verdad.

revoke select on public.creator_scores from anon;
grant select (profile_id, tenant_id, score, score_previous, level, is_provisional, score_version, computed_at)
  on public.creator_scores to anon;

revoke select on public.business_scores from anon;
grant select (business_id, tenant_id, score, score_previous, level, score_version, computed_at)
  on public.business_scores to anon;

-- `trust_scores.signals` queda COMO ESTÁ, y no es un olvido: lo leen 23
-- archivos con `select("score, level, signals")`, entre ellos páginas que un
-- anónimo abre (marketplace/[id], propiedades/[id], eventos/[id], negocios/[id],
-- profesionales/[id], perfil/[id], creadores/perfil/[id] y feed/queries.ts).
-- `(app)/layout.tsx` no redirige al anónimo, sólo envuelve al logueado en
-- `if (user)`, así que esas rutas se sirven sin sesión y el REVOKE las tiraría
-- con 42501. Para cerrarlo hace falta primero que la app deje de pedir
-- `signals` donde sólo pinta `score` y `level`.

commit;

-- 0059 — `trust_scores.factors`: lo que quedó abierto al revisar la 0058.
--
-- Al listar qué columnas puede leer `anon` después de la 0058, apareció que
-- `trust_scores` tiene DOS columnas de internos, no una: `signals` y `factors`.
-- La 0058 dejó la tabla entera intacta por culpa de `signals`, y con eso se
-- coló `factors`, que es el caso fácil.
--
-- `factors` está poblado (17 de 17 filas) y guarda el desglose por dimensión
-- del cálculo del Trust Score. Una fila real, legible hoy sin cuenta:
--   {"tenure_activity":0, "behavior_history":15, "identity_security":0,
--    "profile_completion":0, "transactional_trust":0, "positive_participation":15}
-- Eso no es "el usuario tiene 30 puntos": es qué palanca vale cuánto y cuáles
-- están en cero. Es el manual para subir el score sin merecerlo.
--
-- Y no lo lee nadie: `grep -rn 'factors' src/` fuera de los tipos generados da
-- CERO resultados. Cerrarlo es gratis.

begin;

-- Mismo patrón que 0057 y 0058: el revoke por columna no hace nada mientras
-- siga el SELECT de tabla, así que se saca ése y se devuelven las columnas.
-- `authenticated` no se toca (no hace falta: el problema es la lectura anónima,
-- y tocar authenticated arriesgaría lecturas con sesión que sí existen).

revoke select on public.trust_scores from anon;

grant select (
  profile_id,
  tenant_id,
  score,
  score_previous,
  level,
  signals,          -- se queda: 23 archivos hacen select("score, level, signals")
                    -- en páginas que abre un anónimo. Es deuda conocida, no
                    -- descuido. Se cierra cuando la app deje de pedirla donde
                    -- sólo pinta score y level.
  score_version,
  computed_at
) on public.trust_scores to anon;

commit;

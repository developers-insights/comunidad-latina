-- =============================================================================
-- 0019_match_chunks_fts.sql — Comunidad Latina
-- Recuperación del Asistente SIN embeddings: match_chunks_fts.
--
-- POR QUÉ: el Asistente Comunitario pasa a responder con Claude (Anthropic) y
-- queremos que dependa de UNA sola credencial (ANTHROPIC_API_KEY), no de OpenAI.
-- La búsqueda vectorial de 0017 (match_chunks) necesita embeddings de OpenAI
-- (text-embedding-3-small) para embeddear la pregunta en vivo. A la escala real
-- del índice (decenas de chunks de guías/avisos por comunidad) una búsqueda de
-- texto completo en español rinde de sobra y no necesita ninguna API externa.
--
-- Esta función es el GEMELO textual de match_chunks: MISMO contrato de retorno,
-- MISMO doble-gate de published en vivo, MISMA seguridad (security definer +
-- EXECUTE solo-service_role). La única diferencia es cómo puntúa: en vez de
-- similitud coseno usa ts_rank sobre to_tsvector('spanish', …). match_chunks
-- (0017) se conserva intacta para cuando se quiera volver a lo vectorial.
--
-- `similarity` devuelto = ts_rank normalizado a 0-1 (no es coseno): sirve para
-- ordenar y para la telemetría sources_used; el route del asistente NO aplica
-- un umbral coseno sobre esto (usa matchCount) — si no hay match textual, la
-- función no devuelve filas y el asistente responde con honestidad ("todavía no
-- tengo información verificada"), nunca inventa (guardrails §3).
--
-- Dependencias: 0017 (rag_chunks, patrón de match_chunks), 0004 (listings),
-- 0007 (guides). Idempotente (create or replace + revoke/grant explícitos).
-- =============================================================================

create or replace function public.match_chunks_fts(
  p_query       text,
  p_tenant_id   uuid,
  p_match_count int default 6
)
returns table (
  content     text,
  metadata    jsonb,
  source_kind text,
  source_id   uuid,
  similarity  float
)
language plpgsql
stable
security definer
set search_path = public, app, extensions
as $$
declare
  -- Clampeado aunque sea solo-service_role (defensa en profundidad).
  v_count   int := least(greatest(coalesce(p_match_count, 6), 1), 20);
  v_lexemes text;
  v_query   tsquery;
begin
  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  -- Construcción OR: una pregunta natural ("¿qué hago si ICE toca mi puerta?")
  -- con websearch/plainto se convierte en un AND de TODOS los términos → ningún
  -- chunk contiene las 5 palabras y no matchea nada. En cambio tokenizamos la
  -- pregunta (to_tsvector: stemming + saca stopwords/signos) y unimos los
  -- lexemas con OR: matchea cualquier chunk con AL MENOS una palabra relevante,
  -- y ts_rank ordena arriba a los que cubren más términos. Es lo correcto para
  -- una KB chica de preguntas/respuestas: recall alto, precisión por ranking.
  v_lexemes := array_to_string(
    tsvector_to_array(to_tsvector('spanish', p_query)), ' | '
  );
  if v_lexemes is null or v_lexemes = '' then
    return; -- solo stopwords/signos: nada que buscar
  end if;

  -- to_tsquery re-parsea los lexemas; ante input raro (un lexema con caracteres
  -- que to_tsquery rechaza) se cae a plainto para no romper la búsqueda.
  begin
    v_query := to_tsquery('spanish', v_lexemes);
  exception when others then
    v_query := plainto_tsquery('spanish', p_query);
  end;
  if v_query is null or numnode(v_query) = 0 then
    return;
  end if;

  return query
  with matched as (
    select c.content,
           c.metadata,
           c.source_kind,
           c.source_id,
           -- El índice a buscar suma el contenido + campos citables del
           -- metadata (título/zona/resumen) para mejorar el recall sin importar
           -- si el chunk quedó cortado antes del título.
           ts_rank(
             to_tsvector(
               'spanish',
               coalesce(c.content, '') || ' ' ||
                 coalesce(c.metadata->>'title', '') || ' ' ||
                 coalesce(c.metadata->>'summary', '') || ' ' ||
                 coalesce(c.metadata->>'area_label', '')
             ),
             v_query
           ) as rank
      from public.rag_chunks c
     where (c.tenant_id = p_tenant_id or c.tenant_id is null)
       -- Doble gate anti-fuga idéntico a match_chunks (0017): aunque el
       -- pipeline solo indexa contenido publicado, se re-chequea EN VIVO que la
       -- fuente siga publicada — un aviso despublicado ayer no se cita hoy.
       and (
         (c.source_kind = 'guide' and exists (
           select 1 from public.guides g
            where g.id = c.source_id and g.status = 'published'
         ))
         or (c.source_kind = 'listing' and exists (
           select 1 from public.listings l
            where l.id = c.source_id and l.status = 'published'
         ))
         or c.source_kind = 'faq'
       )
       and to_tsvector(
             'spanish',
             coalesce(c.content, '') || ' ' ||
               coalesce(c.metadata->>'title', '') || ' ' ||
               coalesce(c.metadata->>'summary', '') || ' ' ||
               coalesce(c.metadata->>'area_label', '')
           ) @@ v_query
  )
  select m.content,
         m.metadata,
         m.source_kind,
         m.source_id,
         -- Normalización suave a 0-1 (ts_rank es ilimitado hacia arriba pero en
         -- la práctica << 1): rank/(rank+1). Monótona → no altera el orden.
         (m.rank / (m.rank + 1))::float as similarity
    from matched m
   order by m.rank desc
   limit v_count;
end;
$$;

comment on function public.match_chunks_fts(text, uuid, int) is
  'Recuperación por texto completo (español) del Asistente RAG — gemelo de match_chunks(0017) SIN embeddings. Mismo doble-gate de published en vivo y misma seguridad. Se usa para que el Asistente (Claude/Anthropic) no dependa de OpenAI. p_tenant_id → chunks del tenant + globales (tenant_id null). EXECUTE SOLO service_role (fiscal R3): se invoca únicamente server-side desde /api/assistant, que aplica moderación + rate limit ANTES de buscar.';

-- Los DEFAULT PRIVILEGES de Supabase otorgan EXECUTE a anon/authenticated al
-- crear la función — el revoke explícito por rol es OBLIGATORIO (igual que 0017).
revoke execute on function public.match_chunks_fts(text, uuid, int) from public;
revoke execute on function public.match_chunks_fts(text, uuid, int) from anon, authenticated;
grant execute on function public.match_chunks_fts(text, uuid, int) to service_role;

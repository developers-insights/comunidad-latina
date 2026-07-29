-- =============================================================================
-- 0043_text_posts.sql — Comunidad Latina
-- Pedido de Manuel (2026-07-29): el menú "¿Qué querés publicar?" necesita un
-- "Texto" separado de "Pregunta" — una actualización simple, sin la forma de
-- pregunta ni su encuesta.
--
-- Un solo cambio de schema: sumar 'text' al check de posts.kind. El resto ya
-- estaba resuelto sin saberlo — app.posts_require_media() (0023) sólo exige
-- medio cuando `kind = 'post'`, así que 'text' queda exento de la regla
-- "todo post lleva imagen" GRATIS, con la misma lógica que ya exime a
-- 'question'. Ningún trigger nuevo, ninguna policy nueva.
-- =============================================================================

alter table public.posts drop constraint posts_kind_check;
alter table public.posts
  add constraint posts_kind_check check (kind in ('post', 'question', 'text'));

comment on column public.posts.kind is
  '''post'' = con medio obligatorio (trigger posts_require_media, 0023). ''question'' = exenta de medio, se banderea con QuestionBanner + puede llevar encuesta (poll_kind, 0041). ''text'' = exenta de medio (2026-07-29), una actualización simple sin la forma de pregunta — se banderea con TextBanner, nunca lleva poll_kind (misma constraint posts_poll_only_on_question de 0041 la bloquea: sólo permite poll_kind no-null en kind=''question'').';

-- =============================================================================
-- 0015_account_deletion_fk.sql — Comunidad Latina
-- Derecho a borrar la cuenta (§5.4): estrategia EXPLÍCITA de ON DELETE para
-- toda FK que apunta a public.profiles(id).
--
-- Contexto: 0003 promete "Borrado de cuenta = borrar auth.users via service
-- (cascade)" y profiles.id sí cascadea desde auth.users — pero varias FKs
-- hacia profiles quedaron con el default NO ACTION, así que cualquier usuario
-- con un aviso, post, comentario, mensaje, conversación, reporte o negocio
-- hacía FALLAR el DELETE con foreign_key_violation. Para un producto cuyo
-- diseño pivota en "menos datos retenidos = mejor", eso rompía el derecho a
-- borrarse a nivel de esquema. Estrategia por tabla:
--
--   * CASCADE — datos personales del usuario, mueren con la cuenta:
--       conversations (created_by, counterpart_id): el grafo de contacto de un
--         usuario borrado no debe sobrevivirlo (coherente con el TTL 90d y con
--         que conversations_delete ya deja a cualquier participante borrar el
--         hilo completo).
--       messages (sender_id): redundante en la práctica (la conversación del
--         participante cascadea primero) pero explícito por robustez.
--       listings (created_by): un aviso con contact_protected y sin dueño es
--         un aviso al que nadie puede responder ni gestionar — muere con la
--         cuenta. Los avisos de seed/API (created_by null, publisher_name) no
--         se ven afectados.
--
--   * SET NULL — contenido comunitario/operativo que sobrevive ANONIMIZADO:
--       posts.author_id, comments.author_id: las respuestas y guías siguen
--         siendo útiles para la comunidad; la UI muestra "cuenta eliminada".
--       scam_reports.reporter_id: la señal del Escudo sobrevive (weight ya
--         quedó congelado al insertar) sin retener la arista quién-denunció.
--       moderation_queue.assigned_to/resolved_by: historial operativo del
--         tenant; el vínculo al moderador borrado se anonimiza.
--       (audit_log.actor_id ya era uuid sin FK — sin cambios.)
--
--   * RESTRICT — bloqueo INTENCIONAL y documentado:
--       business_accounts.owner_id: una cuenta de negocio puede tener una
--         suscripción Stripe activa. El borrado NO debe cascadear billing en
--         silencio: el service de borrado de cuenta debe primero dar de baja
--         (cancelar suscripción / borrar o transferir el business_account) y
--         recién entonces borrar auth.users. RESTRICT hace el orden explícito
--         y el error, intencional — no un accidente del default.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CASCADE
-- ---------------------------------------------------------------------------
alter table public.conversations
  drop constraint conversations_created_by_fkey,
  add constraint conversations_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete cascade;

alter table public.conversations
  drop constraint conversations_counterpart_id_fkey,
  add constraint conversations_counterpart_id_fkey
    foreign key (counterpart_id) references public.profiles(id) on delete cascade;

alter table public.messages
  drop constraint messages_sender_id_fkey,
  add constraint messages_sender_id_fkey
    foreign key (sender_id) references public.profiles(id) on delete cascade;

alter table public.listings
  drop constraint listings_created_by_fkey,
  add constraint listings_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- SET NULL (requiere quitar NOT NULL donde exista)
-- ---------------------------------------------------------------------------
alter table public.posts
  alter column author_id drop not null;

alter table public.posts
  drop constraint posts_author_id_fkey,
  add constraint posts_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete set null;

comment on column public.posts.author_id is
  'NULL = autor borró su cuenta (0015): el contenido comunitario sobrevive anonimizado; la UI muestra "cuenta eliminada".';

alter table public.comments
  alter column author_id drop not null;

alter table public.comments
  drop constraint comments_author_id_fkey,
  add constraint comments_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete set null;

comment on column public.comments.author_id is
  'NULL = autor borró su cuenta (0015): el comentario sobrevive anonimizado.';

alter table public.scam_reports
  alter column reporter_id drop not null;

alter table public.scam_reports
  drop constraint scam_reports_reporter_id_fkey,
  add constraint scam_reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles(id) on delete set null;

comment on column public.scam_reports.reporter_id is
  'NULL = el reportante borró su cuenta (0015): la señal del Escudo sobrevive anonimizada (weight quedó congelado al insertar).';

alter table public.moderation_queue
  drop constraint moderation_queue_assigned_to_fkey,
  add constraint moderation_queue_assigned_to_fkey
    foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.moderation_queue
  drop constraint moderation_queue_resolved_by_fkey,
  add constraint moderation_queue_resolved_by_fkey
    foreign key (resolved_by) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RESTRICT (bloqueo intencional: off-boarding de billing ANTES de borrar)
-- ---------------------------------------------------------------------------
alter table public.business_accounts
  drop constraint business_accounts_owner_id_fkey,
  add constraint business_accounts_owner_id_fkey
    foreign key (owner_id) references public.profiles(id) on delete restrict;

comment on column public.business_accounts.owner_id is
  'ON DELETE RESTRICT deliberado (0015): el borrado de cuenta con negocio activo DEBE fallar hasta que el service de off-boarding cancele la suscripción Stripe y borre/transfiera el business_account. No es un accidente del default: es el orden obligatorio.';

-- =============================================================================
-- 0147_crear_un_grupo_privado_fallaba_siempre.sql — Comunidad Latina
--
-- El cliente reportó, sin más detalle, que "crear un grupo no funciona". Era
-- cierto y era la mitad de los casos: **todo grupo privado fallaba, siempre**.
-- Los públicos se creaban bien, y por eso el bug sobrevivió a los tests.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ PASABA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tres piezas correctas por separado que juntas se rompen:
--
--   1. `chat_groups_select` (0133) dejaba ver un grupo si es público o si quien
--      mira ya es miembro:
--          visibility = 'public' or app.es_miembro_de_grupo(id)
--
--   2. `chat_groups_nace_con_su_dueno` es un trigger **AFTER INSERT**: la fila
--      de `chat_group_members` que hace dueño al creador nace *después* de que
--      la fila del grupo ya entró. Y tiene que ser AFTER: `chat_group_members`
--      referencia `chat_groups(id)` por clave foránea, así que en un BEFORE el
--      grupo todavía no existe y la FK explota.
--
--   3. `crearGrupoAction` hace `.insert(...).select("id")`, que PostgREST
--      traduce a un `INSERT ... RETURNING`.
--
-- Postgres exige permiso de SELECT sobre la fila que devuelve un RETURNING, y
-- evalúa esa policy **antes de correr los triggers AFTER**. Entonces, en ese
-- instante exacto, el creador de un grupo privado todavía no es miembro de
-- nada: `es_miembro_de_grupo(id)` da falso, `visibility <> 'public'`, y el
-- statement entero muere con 42501 «new row violates row-level security
-- policy». La transacción se revierte: el grupo ni siquiera queda creado.
--
-- Verificado contra la base de producción antes de escribir este archivo, en
-- una transacción con rollback, con el JWT de un usuario real:
--
--     PUBLICO  con returning  -> OK
--     PRIVADO  con returning  -> FALLA 42501 :: new row violates row-level
--                                security policy for table "chat_groups"
--     PRIVADO  sin returning  -> OK (la fila entra sola)
--
-- La última línea es la que cierra el diagnóstico: no era el INSERT, era leer
-- de vuelta lo recién insertado.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ SE ARREGLA ACÁ Y NO EN LA APP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tentación es sacar el `.select("id")` de la action y buscar el id con una
-- consulta aparte. Eso esconde el problema en vez de resolverlo: la policy
-- seguiría diciendo que **el dueño de un grupo privado no puede ver su propio
-- grupo**, que es falso como regla de producto, y el próximo `insert().select()`
-- contra esta tabla —o el próximo `update ... returning`— volvería a morir por
-- lo mismo sin que nadie recuerde por qué.
--
-- La regla que faltaba es simple y se sostiene sola: **quien creó un grupo
-- puede verlo**. Se agrega como tercera rama del OR.
--
-- Lo que NO abre esta rama, y conviene dejarlo escrito:
--
--   · Los **mensajes** siguen cerrados. `chat_group_messages_select` exige
--     `app.es_miembro_de_grupo(group_id)` por su cuenta, y esta migración no
--     lo toca. El creador que ya no es miembro ve la ficha del grupo que hizo
--     —nombre, descripción, categoría, foto—, nunca lo que se habló adentro.
--
--   · Quien fue **expulsado** deja de verlo, aunque lo haya creado. Sin esa
--     exclusión, echar al fundador de su propio grupo no tendría efecto
--     visible para él, y `chat_group_bans` existe justamente para que echar a
--     alguien sea definitivo.
--
--   · El `tenant_id` sigue siendo la primera condición del AND: nada de esto
--     cruza comunidades.
-- =============================================================================

begin;

drop policy if exists chat_groups_select on public.chat_groups;

create policy chat_groups_select on public.chat_groups
  for select
  using (
    tenant_id = (select app.current_tenant_id())
    and (
      visibility = 'public'
      or app.es_miembro_de_grupo(id)
      or (
        created_by = (select auth.uid())
        and not exists (
          select 1
            from public.chat_group_bans b
           where b.group_id = chat_groups.id
             and b.profile_id = (select auth.uid())
        )
      )
    )
  );

comment on policy chat_groups_select on public.chat_groups is
  'Un grupo se ve si es público, si quien mira es miembro, o si lo creó (y no lo expulsaron de él). La tercera rama no es una comodidad: sin ella, `insert ... returning` sobre un grupo privado falla con 42501, porque el trigger AFTER que hace dueño al creador todavía no corrió cuando Postgres evalúa esta policy para el RETURNING. Ver 0147. Los mensajes del grupo NO se abren acá: chat_group_messages_select sigue exigiendo membresía.';

commit;

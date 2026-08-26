-- =============================================================================
-- 0118_pausa_por_reportes.sql — Comunidad Latina
--
-- El Escudo Anti-Estafa (0005) sabe RECIBIR denuncias y no sabe REACCIONAR.
-- Un aviso denunciado por cinco personas sigue arriba, con su teléfono y su
-- botón de contacto, hasta que un moderador entra al panel. Entre la denuncia
-- y esa revisión pasa una noche, un fin de semana, unas vacaciones — y en ese
-- hueco es donde una estafa hace el daño que ya no se deshace.
--
-- Esta migración pone lo que faltaba: cuando el peso acumulado de denuncias sin
-- resolver sobre un aviso llega al umbral, el aviso SE PAUSA SOLO. La cola de
-- moderación no cambia, el reporte sigue su curso, y el moderador resuelve
-- cuando puede; lo que cambia es que mientras tanto el aviso no está cobrando
-- víctimas.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PAUSAR, NO BAJAR — Y POR QUÉ ESA DIFERENCIA ES TODA LA MIGRACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tentación es `status = 'removed'`. Sería un error grave: 'removed' es el
-- estado de MODERACIÓN, la conclusión de que alguien miró el caso y decidió.
-- Escribirlo por acumulación de denuncias le pondría a un cálculo automático la
-- firma de una persona, y convertiría el reporte masivo en un arma: tres
-- cuentas coordinadas bajarían el aviso de un competidor con el mismo sello que
-- usa el equipo para bajar una estafa real.
--
-- 'paused' dice exactamente lo que pasó y ni una palabra más: el aviso no se
-- está mostrando, TODAVÍA no hay veredicto, y volver atrás no le cuesta nada a
-- nadie. Es reversible por construcción — que es la única forma honesta de
-- automatizar algo que puede equivocarse.
--
--     denuncias acumuladas  → paused   (automático, reversible, sin veredicto)
--     el moderador confirma → removed  (humano, con nombre, con consecuencia)
--     el moderador desestima → vuelve solo a published
--
-- El motivo va en `attrs.paused_reason = 'reports'`, y NO es cosmético: es lo
-- que separa esta pausa de la que hizo el dueño con su propio botón. Sin esa
-- marca, devolver el aviso al aire cuando la denuncia se desestima
-- RESUCITARÍA un aviso que su dueño había bajado a mano — publicarle a alguien
-- algo que decidió no mostrar, que es de los peores bugs posibles.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EL UMBRAL: 3.0, Y QUÉ SIGNIFICA CADA DÉCIMA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `scam_reports.weight` (0005) no es 1 por denuncia: lo escribe un trigger con
-- el Trust Score de quien denuncia — 3 si tiene ≥80, 2 si tiene ≥50, 1 el
-- resto. El umbral 3.0 se lee, entonces, así:
--
--     3 vecinos comunes          (1 + 1 + 1)  → pausa
--     1 vecino común + 1 confiable (1 + 2)    → no alcanza
--     1 persona de máxima confianza (3)       → pausa
--
-- Es deliberadamente asimétrico. Una sola denuncia de alguien con historial en
-- la comunidad vale lo que tres de cuentas nuevas, que es exactamente la
-- defensa contra el reporte masivo desde cuentas creadas para eso: fabricar
-- Trust Score cuesta meses de conducta real; fabricar cuentas cuesta un mail.
--
-- ── SE SUMA POR PERSONA, NO POR FILA ────────────────────────────────────────
-- `scam_reports` nació sin unique de (reportante, objetivo): la misma persona
-- podía denunciar el mismo aviso tres veces. Si la suma fuera por FILA, una
-- sola cuenta nueva llegaría a 3.0 sola, apretando el botón tres veces. Se
-- agrupa por `reporter_id` y se toma el MÁXIMO peso de esa persona, así que la
-- lectura del umbral es la de arriba —"tres personas"— y no "tres clicks".
--
-- La sección 6 agrega además un único PARCIAL que impide dos denuncias
-- PENDIENTES de la misma persona sobre el mismo objetivo. Aun así el group by
-- se queda y sigue siendo load-bearing: como el único sólo cubre lo pendiente,
-- una persona puede tener una denuncia 'upheld' vieja y una 'open' nueva sobre
-- el mismo aviso, y las dos cuentan para el peso. Sin agrupar, valdría doble.
--
-- ── QUÉ PESO CUENTA: TODO MENOS LO DESESTIMADO ──────────────────────────────
-- ⚠️ DESVÍO CONSCIENTE del enunciado, que decía "sumar los `open`". Contar sólo
-- 'open' abre dos agujeros reales:
--
--   · 'reviewing' significa que un moderador ABRIÓ el caso. Con la suma sobre
--     'open', ese click bajaría el total y devolvería el aviso al aire JUSTO
--     mientras se lo está investigando. Exactamente al revés de lo que hay que
--     hacer.
--   · 'upheld' significa que la denuncia era CIERTA. Con la suma sobre 'open',
--     confirmar una estafa devolvería el aviso a published salvo que el
--     moderador se acuerde, además, de ponerlo en 'removed' en el mismo
--     movimiento. Depender de que nadie se olvide de un segundo paso es no
--     tener la regla.
--
-- El peso vuelve, entonces, SÓLO cuando el reporte se DESESTIMA: 'dismissed' es
-- el único de los cuatro estados que afirma "esto no pasó". Es también el único
-- caso que el enunciado señalaba como el que importa de verdad.
--
-- Consecuencia buscada: un aviso con un reporte confirmado NO se despausa solo
-- nunca — sale de 'paused' cuando una persona decide qué hacer con él.
--
-- ── POR QUÉ EL NÚMERO ESTÁ EN LA FUNCIÓN Y NO EN UNA TABLA ──────────────────
-- La doctrina del repo es que los números comerciales no vivan en el código
-- (0064, 0086, 0087, 0098). Éste queda igual en la función, y es una decisión,
-- no un olvido: una tabla de configuración SIN pantalla en el panel es un
-- número que nadie puede cambiar y dos lugares donde buscarlo. Cuando el panel
-- lo pida, el molde exacto es `listing_expiry_config` (0098) — tabla con
-- default por ausencia de fila, cuatro policies canónicas y sus grants — y el
-- único cambio acá es leerlo en vez de la constante. No se toca nada más.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. UN SOLO CAMINO PARA LOS DOS SENTIDOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los dos triggers (llega una denuncia / se resuelve una denuncia) comparten
-- función. No es ahorro de líneas: es que las dos preguntas son la MISMA
-- —"¿cuánto peso sin desestimar tiene este aviso ahora?"— y dos
-- implementaciones del mismo cálculo se separan sola la primera vez que alguien
-- toque una. La función RECONCILIA en las dos direcciones y es idempotente:
-- correrla dos veces sobre el mismo aviso no cambia nada la segunda, porque los
-- dos UPDATE llevan el estado esperado en el WHERE.
--
-- SECURITY DEFINER y `search_path = ''`, como todo trigger de este repo que
-- escribe fuera de su propia fila. Acá es obligatorio y no estético: quien
-- dispara el INSERT es la persona que denuncia, que NO puede —ni debe poder—
-- actualizar el aviso de otro. Si la función corriera con los permisos de quien
-- denuncia, la pausa fallaría en silencio (la RLS descarta la fila, no tira
-- error) y esta migración entera sería decorativa.
--
-- ⚠️ EFECTO CONOCIDO Y ACEPTADO: al volver de 'paused' a 'published' se dispara
-- `app.listings_set_expiry()` (0098), que reinicia `expires_at`. O sea, el
-- aviso restituido arranca un ciclo de vigencia completo. Es EL MISMO
-- comportamiento que ya tiene despausar a mano, no se inventa nada acá, y es el
-- lado correcto para equivocarse: a alguien que fue denunciado sin razón no se
-- le devuelve un aviso con dos días de vida.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AVISARLE AL DUEÑO — Y POR QUÉ EN UNA CATEGORÍA QUE NO SE PUEDE SILENCIAR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un aviso que desaparece sin que su dueño haya tocado nada es la definición de
-- pérdida de alcance silenciosa. Se emite notificación por el mismo camino que
-- usan `app.avisar_vencimientos()` y `app.vencer_publicaciones()` (0098): un
-- INSERT en `public.notifications` dentro de la MISMA sentencia que hace el
-- UPDATE, con CTE — si el UPDATE no tocó ninguna fila, no hay notificación, y
-- la idempotencia sale gratis.
--
-- CATEGORÍA 'seguridad', y no 'plataforma'. Es la decisión menos obvia del
-- archivo, así que va escrita: 'plataforma' se puede silenciar, y silenciar
-- esto significa que a alguien se le apaga el aviso y NO SE ENTERA. La 0045
-- reservó tres categorías que no se silencian (seguridad, pagos, cuenta)
-- precisamente para lo que no se puede perder, y el mapa `KIND_CATEGORY` de
-- `src/lib/notifications/categories.ts` ya pone en 'seguridad' a
-- `account_suspended` y `dispute`, que son exactamente esto: acciones de
-- moderación sobre lo tuyo. Por lo mismo —y siguiendo la 0045 al pie— el
-- emisor NO consulta `notification_prefs`: en las categorías críticas no se
-- consultan preferencias, ni siquiera para respetar una fila que alguien haya
-- forzado por PostgREST.
--
-- Se avisa también cuando VUELVE. Es la otra mitad de la misma frase: quien
-- leyó "se pausó tu aviso" tiene que leer "ya está de vuelta", o se queda para
-- siempre con la última noticia mala.
--
-- ⚠️ ESPEJO EN TYPESCRIPT (para quien siga): los dos `kind` nuevos
-- —listing_paused_reports y listing_restored_reports— necesitan su fila en
-- KIND_CATEGORY. Sin ella caen en el fallback 'social' y aparecen en la pestaña
-- equivocada; no rompe ningún test, que es justamente por qué se escribe acá.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LA MARCA `attrs.paused_reason` NO ES DE FIAR POR SÍ SOLA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La primera versión de este archivo tenía un agujero CRÍTICO, y vale la pena
-- dejarlo escrito porque la forma del error se repite: una función
-- `security definer` que confía en un dato que el usuario puede escribir.
--
-- `attrs` no está restringido por ninguna policy, y el WITH CHECK de
-- `listings_update` sí le permite al dueño dejar su aviso en 'paused'. Con eso
-- solo, la cadena completa era:
--
--   1. Moderación baja el aviso                     → status = 'removed'
--   2. El dueño, por PostgREST, hace un PATCH:
--        { status: 'paused', attrs: { paused_reason: 'reports' } }
--      Las dos cosas están permitidas: 'paused' está en su lista de estados y
--      `attrs` es campo libre. El aviso queda pausado y con la marca FORJADA.
--   3. Cualquier denuncia nueva sobre ese aviso —la suya propia con otra
--      cuenta, o una real— dispara este trigger. Con el peso por debajo del
--      umbral, la rama de restitución corría IGUAL en el INSERT, veía la marca
--      forjada, le creía, y ponía el aviso en 'published' con permisos de
--      definer: salteando la RLS, la moderación y el WITH CHECK de una sola vez.
--
-- Servía para republicar lo dado de baja y —desde 'draft' o 'pending_review',
-- pasando por 'paused'— para publicar sin moderar. Se cierra por los dos lados,
-- porque cualquiera de los dos arreglos solo dejaría el otro flanco abierto:
--
--   (a) UNA DENUNCIA NUEVA NO DESPAUSA NADA, JAMÁS. La restitución sólo tiene
--       sentido cuando un reporte SALE de la cola, así que en `tg_op = 'INSERT'`
--       la función pausa o no hace nada. Que un reporte pudiera despausar era,
--       además, un sinsentido semántico antes que un agujero: denunciar no es
--       un voto a favor.
--
--   (b) LA MARCA SE PROTEGE COMO CUALQUIER COLUMNA DEL SISTEMA. Se extiende
--       `app.protect_listing_counters()` (0098) —la lista única de "esto no lo
--       escribe el cliente"— para que un JWT de usuario no pueda crear, cambiar
--       ni borrar `attrs.paused_reason` ni `attrs.paused_at`. Se extiende esa
--       función en vez de agregar un trigger nuevo por lo mismo que dice la
--       0098: la lista de lo que el cliente no toca vive en UN lugar.
--
--       Sus dos exenciones de arriba son exactamente las que hacen falta y por
--       eso no se toca el mecanismo: `pg_trigger_depth() > 1` deja pasar al
--       trigger de esta migración (que escribe la marca desde adentro de otro
--       trigger, a profundidad 2) y la exención de `service_role` deja pasar a
--       moderación. El dueño, que llama con JWT `authenticated` y a
--       profundidad 0, es el único que queda del lado de afuera.
--
-- El resto de `attrs` sigue libre: la persona edita `attrs.employment_type` o
-- `attrs.closed_reason` cuando quiere. Lo que se protege son las DOS claves que
-- una función definer usa para decidir, que es la diferencia entre un atributo
-- y una credencial.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 6. QUE PAUSAR SEA AUTOMÁTICO NO PUEDE HACER QUE SEA BARATO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Con la pausa automática, denunciar deja de ser sólo una señal para
-- moderación: pasa a tener un efecto inmediato sobre el aviso de otra persona.
-- Eso cambia el cálculo de quien quiere hacer daño, y el archivo tiene que
-- responderlo o está entregando un botón de takedown.
--
-- ── UNA DENUNCIA PENDIENTE POR PERSONA Y POR OBJETIVO ───────────────────────
-- Índice único PARCIAL sobre (tenant_id, reporter_id, target_kind, target_id)
-- `where status in ('open','reviewing')`. Cierra el INSERT repetido por
-- PostgREST y hace que el umbral signifique lo que dice: personas, no clicks.
--
-- ⚠️ PARCIAL Y NO TOTAL, y es una decisión, no una omisión. Un único total
-- diría "cada persona puede denunciar un aviso UNA VEZ EN LA VIDA": alguien que
-- reportó un precio mal puesto y recibió un "desestimado" quedaría sin poder
-- avisar cuando ese mismo aviso, tres meses después, se convierte en una estafa
-- de verdad — y el fallo sería MUDO, que es lo peor que le puede pasar al
-- módulo anti-estafa. Restringiendo el único a lo que está PENDIENTE, el abuso
-- queda igual de cerrado (nadie acumula peso repitiendo) y reportar de nuevo
-- después de una resolución sigue siendo posible. De yapa, la deduplicación
-- previa toca muchísimas menos filas: sólo las pendientes, y ninguna resuelta.
--
-- ── TOPE DIARIO POR PERSONA ─────────────────────────────────────────────────
-- 10 denuncias por reportante cada 24 h, verificado en `report_scam()`. El
-- único parcial impide repetir sobre EL MISMO objetivo; no impide barrer
-- cincuenta avisos distintos de un competidor en una tarde. Diez es holgado
-- para cualquier uso real —el vecino más atento no denuncia diez cosas por
-- día— y angosto para una campaña.
--
-- ── EL `max(weight) group by reporter_id` SE QUEDA ──────────────────────────
-- Con un único TOTAL habría quedado redundante. Con el parcial NO lo es: la
-- misma persona puede tener una denuncia 'upheld' vieja y una 'open' nueva
-- sobre el mismo aviso, y las dos cuentan para el peso. Sin el group by, esa
-- persona valdría doble. Se queda, y ahora es load-bearing.
--
-- ── DEDUPLICACIÓN PREVIA: EL ÚNICO DELETE DE LAS TRES MIGRACIONES ───────────
-- El único no se puede crear sobre datos que ya lo violan. Se conserva, por
-- grupo, la fila de MAYOR peso (a igual peso, la más reciente) y se borran las
-- otras. No se pierde señal —la que queda es la de más peso— y no se toca una
-- sola fila resuelta. La alternativa "marcarlas como dismissed" se descartó:
-- sería fabricar una decisión de moderación que nadie tomó.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO
-- ═══════════════════════════════════════════════════════════════════════════
--   · No crea tablas. La señal ya existe (`scam_reports`), la cola de
--     moderación ya existe y el estado ya existe. Una tabla nueva sería una
--     segunda cola que nadie mira (mismo argumento de la 0093).
--   · No toca perfiles ni mensajes denunciados. Un perfil no se "pausa": lo que
--     corresponde ahí es suspensión de cuenta, que es otro camino, con otras
--     consecuencias y con una persona decidiendo.
--   · No borra ni oculta ninguna denuncia VIVA, y ninguna resuelta. La única
--     excepción es la deduplicación de la sección 1, que es lo mínimo que hace
--     falta para poder crear el único: sobre filas pendientes, dentro de un
--     mismo (comunidad, persona, tipo, objetivo), y conservando siempre la de
--     más peso. `scam_reports` sigue siendo el registro.
--   · No manda mails. El canal in-app es el que está garantizado hoy; Resend
--     con dominio verificado sigue fuera de alcance (§2).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Una denuncia PENDIENTE por persona y por objetivo
-- ---------------------------------------------------------------------------
-- Deduplicación primero: un índice único no se puede crear sobre datos que ya
-- lo violan, y esta base tiene meses de denuncias sin ninguna restricción.
--
-- ES EL ÚNICO DELETE DE LAS TRES MIGRACIONES y por eso está acotado al hueso:
-- sólo filas PENDIENTES (ninguna resuelta se toca), sólo duplicados exactos de
-- (comunidad, persona, tipo, objetivo), y de cada grupo sobrevive la de MAYOR
-- peso —a igual peso, la más reciente—, así que el peso acumulado del objetivo
-- no baja por esta limpieza. El `raise notice` deja el número en el log de la
-- migración: si algún día hay que explicar qué pasó, el dato está.
do $$
declare
  v_borradas int;
begin
  with pendientes as (
    select id, tenant_id, reporter_id, target_kind, target_id, weight, created_at
      from public.scam_reports
     where status in ('open', 'reviewing')
  ),
  sobrantes as (
    select p.id
      from pendientes p
     where exists (
       select 1
         from pendientes q
        where q.tenant_id   = p.tenant_id
          and q.reporter_id = p.reporter_id
          and q.target_kind = p.target_kind
          and q.target_id   = p.target_id
          -- Comparación de fila: gana el de más peso; a igual peso, el más
          -- nuevo; a igual todo, el de id mayor. Determinístico, así que
          -- sobrevive exactamente uno por grupo.
          and (q.weight, q.created_at, q.id) > (p.weight, p.created_at, p.id)
     )
  )
  delete from public.scam_reports r
   using sobrantes s
   where r.id = s.id;

  get diagnostics v_borradas = row_count;
  raise notice 'scam_reports: % denuncias pendientes duplicadas eliminadas antes de crear el único', v_borradas;
end;
$$;

-- PARCIAL sobre lo pendiente, no total. Ver la sección 6 de la cabecera: un
-- único total significaría "cada persona puede denunciar un aviso UNA VEZ EN LA
-- VIDA", y dejaría sin voz a quien reportó algo que se desestimó y meses
-- después ve que ese mismo aviso sí se volvió una estafa. Restringido a lo
-- pendiente, el abuso queda igual de cerrado y el uso legítimo no.
--
-- Sin CONCURRENTLY porque apply-migrations.mjs envuelve cada archivo en
-- begin/commit (ver el encabezado de la 0112).
create unique index if not exists scam_reports_una_pendiente_por_persona_idx
  on public.scam_reports (tenant_id, reporter_id, target_kind, target_id)
  where status in ('open', 'reviewing');

comment on index public.scam_reports_una_pendiente_por_persona_idx is
  'Una denuncia PENDIENTE (open/reviewing) por persona y por objetivo (0118). Existe desde que denunciar tiene efecto automático sobre el aviso: sin él, una sola cuenta llegaba al umbral de auto-pausa apretando el botón tres veces, y el "tres personas" del umbral era mentira. Parcial a propósito — con un único total, un "desestimado" dejaría a esa persona sin poder volver a denunciar ese objetivo nunca más, y el fallo sería mudo.';

-- ---------------------------------------------------------------------------
-- 2. Tope diario, y las dos puertas de entrada que lo respetan
-- ---------------------------------------------------------------------------
-- El único parcial impide repetir sobre EL MISMO objetivo; no impide barrer
-- cincuenta avisos distintos de un competidor en una tarde. Eso lo corta el
-- tope diario.
--
-- Una sola definición para las dos RPC que escriben en scam_reports
-- (report_scam para avisos/perfiles/mensajes, report_listing_review para
-- reseñas): dos copias del mismo número se separan sola la primera vez que
-- alguien toque una. Es también el lugar exacto donde enchufar una tabla de
-- configuración por comunidad el día que el panel la pida.
create or replace function app.exigir_cupo_de_denuncias(
  p_tenant   uuid,
  p_reporter uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- 10 en 24 h. Holgado para cualquier uso real —la vecina más atenta de la
  -- comunidad no denuncia diez cosas en un día— y angosto para una campaña.
  v_tope int := 10;
begin
  if (
    select count(*)
      from public.scam_reports r
     where r.tenant_id   = p_tenant
       and r.reporter_id = p_reporter
       and r.created_at  > now() - interval '24 hours'
  ) >= v_tope then
    raise exception 'RATE_LIMITED: llegaste al máximo de denuncias por hoy. Si hay algo urgente, escribinos desde Ayuda y lo miramos nosotros.';
  end if;
end;
$$;

comment on function app.exigir_cupo_de_denuncias(uuid, uuid) is
  'Corta en la base la campaña de denuncias: 10 por persona cada 24 h (0118). Hace falta desde que denunciar pausa avisos solo — el índice único parcial impide repetir sobre el MISMO objetivo, pero no barrer cincuenta objetivos distintos. La consultan las dos RPC que escriben en scam_reports, para que el número viva en un solo lugar. security definer: cuenta denuncias que el reportante no puede leer (scam_reports_select sólo le muestra las suyas, y ni siquiera eso alcanza para contar bajo RLS forzada).';

revoke execute on function app.exigir_cupo_de_denuncias(uuid, uuid) from public, anon;
grant  execute on function app.exigir_cupo_de_denuncias(uuid, uuid) to service_role;

-- ── report_scam — re-creación de la 0014 ────────────────────────────────────
-- `create or replace` sobre la 0014, que NO se toca (es su archivo y su
-- historia). El cuerpo es el de allá, palabra por palabra, con DOS agregados:
-- el tope diario y la respuesta idempotente al duplicado. Todo lo demás
-- —validación de tenant, de tipo, de motivo, de que el objetivo exista, y que
-- el peso lo ponga el trigger y nunca el cliente— queda igual.
--
-- Se conserva incluso `set search_path = public, app` de la 0014 en vez de
-- apretarlo a '': todas las referencias del cuerpo ya están calificadas, así
-- que cambiarlo no compraría nada y ampliaría el diff de una función que hoy
-- usan el Escudo y Mensajes en producción.
create or replace function public.report_scam(
  p_target_kind text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_report_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para reportar.';
  end if;

  -- TOPE DIARIO (0118). Va temprano: si la persona ya se pasó, no tiene sentido
  -- ir a buscar el objetivo a la base.
  perform app.exigir_cupo_de_denuncias(v_tenant, v_uid);

  if p_target_kind not in ('listing', 'profile', 'message') then
    raise exception 'INVALID_TARGET_KIND: tipo de reporte inválido.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: contanos brevemente qué pasó.';
  end if;

  -- El objetivo debe existir EN MI tenant (y, si es un mensaje, tengo que ser
  -- participante de esa conversación: nadie reporta chats que no puede ver).
  if p_target_kind = 'listing' then
    if not exists (
      select 1 from public.listings l
      where l.id = p_target_id and l.tenant_id = v_tenant
    ) then
      raise exception 'TARGET_NOT_FOUND: el aviso no existe en tu comunidad.';
    end if;
  elsif p_target_kind = 'profile' then
    if not exists (
      select 1 from public.profiles p
      where p.id = p_target_id and p.tenant_id = v_tenant
    ) then
      raise exception 'TARGET_NOT_FOUND: el perfil no existe en tu comunidad.';
    end if;
  else -- message
    if not exists (
      select 1
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
       where m.id = p_target_id
         and m.tenant_id = v_tenant
         and c.tenant_id = v_tenant
         and (c.created_by = v_uid or c.counterpart_id = v_uid)
    ) then
      raise exception 'TARGET_NOT_FOUND: el mensaje no existe o no es de una conversación tuya.';
    end if;
  end if;

  -- YA LA DENUNCIASTE (0118). Con el único parcial de la sección 1, insertar de
  -- nuevo explotaría con un 23505 crudo que la app mostraría como "algo salió
  -- mal". Se contesta con el id de la denuncia que ya está en la cola: para la
  -- persona el resultado es el correcto —su reporte está hecho— y no se le
  -- pide que entienda un detalle del esquema.
  select r.id into v_report_id
    from public.scam_reports r
   where r.tenant_id   = v_tenant
     and r.reporter_id = v_uid
     and r.target_kind = p_target_kind
     and r.target_id   = p_target_id
     and r.status in ('open', 'reviewing');

  if found then
    return v_report_id;
  end if;

  -- weight lo fija el trigger app.scam_report_set_weight() según el Trust
  -- Score del reportante: acá no se acepta peso del cliente.
  insert into public.scam_reports (tenant_id, reporter_id, target_kind, target_id, reason, details, status)
  values (v_tenant, v_uid, p_target_kind, p_target_id, btrim(p_reason), nullif(btrim(coalesce(p_details, '')), ''), 'open')
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.report_scam(text, uuid, text, text) is
  'Crea un scam_report validando que el objetivo exista en el tenant del reportante (y que sea participante si reporta un mensaje). El peso sale del Trust Score via trigger, jamás del cliente. Desde 0118 —cuando denunciar pasó a pausar avisos solo— exige cupo diario (app.exigir_cupo_de_denuncias) y contesta con el id de la denuncia existente si ya hay una pendiente del mismo reportante sobre el mismo objetivo, en vez de chocar contra el único parcial con un 23505.';

revoke execute on function public.report_scam(text, uuid, text, text) from public, anon;
grant  execute on function public.report_scam(text, uuid, text, text) to authenticated, service_role;

-- ── report_listing_review — la otra puerta a la misma tabla ─────────────────
-- Se re-crea por OBLIGACIÓN, no por gusto: el único parcial de la sección 1
-- también la alcanza, así que sin este cambio un segundo reporte sobre la
-- misma reseña rompería con un 23505 crudo — un 500 nuevo que introduciría
-- esta migración. Mismo cuerpo de la 0093 con los dos mismos agregados.
create or replace function public.report_listing_review(
  p_review_id uuid,
  p_reason    text,
  p_details   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_report_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para reportar.';
  end if;

  perform app.exigir_cupo_de_denuncias(v_tenant, v_uid);

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: contanos brevemente qué pasó.';
  end if;

  if not exists (
    select 1 from public.listing_reviews r
     where r.id = p_review_id
       and r.tenant_id = v_tenant
  ) then
    raise exception 'TARGET_NOT_FOUND: esa reseña no existe en tu comunidad.';
  end if;

  select r.id into v_report_id
    from public.scam_reports r
   where r.tenant_id   = v_tenant
     and r.reporter_id = v_uid
     and r.target_kind = 'review'
     and r.target_id   = p_review_id
     and r.status in ('open', 'reviewing');

  if found then
    return v_report_id;
  end if;

  -- weight lo fija app.scam_report_set_weight() según el Trust Score de quien
  -- reporta: acá no se acepta peso del cliente, igual que en report_scam.
  insert into public.scam_reports (tenant_id, reporter_id, target_kind, target_id, reason, details)
  values (v_tenant, v_uid, 'review', p_review_id, btrim(p_reason), nullif(btrim(p_details), ''))
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.report_listing_review(uuid, text, text) is
  'Reporta una reseña de aviso hacia scam_reports (0005). Existe en vez de una tabla propia para no abrir una segunda cola de moderación; existe aparte de report_scam() para no reescribir una función que hoy usan el Escudo y Mensajes. Desde 0118 comparte con ella el cupo diario y la respuesta idempotente al duplicado, porque el índice único parcial de esa migración alcanza a las dos.';

revoke execute on function public.report_listing_review(uuid, text, text) from public, anon;
grant  execute on function public.report_listing_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. La marca de la auto-pausa deja de ser escribible por el dueño
-- ---------------------------------------------------------------------------
-- Re-creación COMPLETA de `app.protect_listing_counters()` (0004 → 0048 → 0098)
-- con UN bloque nuevo al final. Todo lo anterior queda palabra por palabra:
-- contadores, store_verified, store_active, tier, y el bloque de vencimiento
-- con su bandera transaccional.
--
-- POR QUÉ ACÁ Y NO EN UN TRIGGER NUEVO: la 0098 lo dejó escrito — la lista de
-- "esto no lo escribe el cliente" vive en UN solo lugar, o deja de ser una
-- lista y pasa a ser un rastreo por varios archivos.
--
-- POR QUÉ HACE FALTA: ver la sección 5 de la cabecera. `attrs.paused_reason` es
-- lo que `app.reconciliar_pausa_por_denuncias()` lee para decidir si devuelve un
-- aviso al aire, y hasta acá el dueño podía escribirlo con un PATCH. Un dato que
-- una función `security definer` usa para decidir y que el usuario puede
-- escribir no es un atributo: es una credencial forjable.
--
-- Las dos exenciones de arriba son exactamente las que hacen falta, así que el
-- mecanismo no se toca: el trigger de la 0118 escribe la marca desde adentro de
-- otro trigger (profundidad 2) y sale por `pg_trigger_depth() > 1`; moderación
-- entra como `service_role` y sale por la suya. El dueño —JWT `authenticated`,
-- profundidad 0— es el único que queda afuera, que es exactamente el objetivo.
create or replace function app.protect_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renovando boolean :=
    coalesce(current_setting('app.renovando_publicacion', true), 'off') = 'on';
begin
  if pg_trigger_depth() > 1 then
    return new; -- update interno (comentarios, vistas, espejo verificado, membresía)
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.comment_count is distinct from old.comment_count then
    raise exception 'PROTECTED_COLUMNS: comment_count solo se actualiza por triggers';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'PROTECTED_COLUMNS: view_count solo se actualiza por triggers';
  end if;
  if new.store_verified is distinct from old.store_verified then
    raise exception 'PROTECTED_COLUMNS: store_verified solo se actualiza por triggers';
  end if;
  if new.store_active is distinct from old.store_active then
    raise exception 'PROTECTED_COLUMNS: store_active refleja la membresía de la tienda y solo se actualiza por triggers';
  end if;
  if new.tier is distinct from old.tier then
    raise exception 'PROTECTED_COLUMNS: tier lo escribe el flujo de pago (service_role), no el dueño del aviso';
  end if;

  -- ---- Vencimiento (0098). La única puerta desde un JWT de usuario es
  -- public.renovar_publicacion(), que enciende la bandera transaccional.
  if not v_renovando then
    if new.renewal_count is distinct from old.renewal_count then
      raise exception 'PROTECTED_COLUMNS: renewal_count solo lo escribe public.renovar_publicacion() — resetearlo saltearía el tope de renovaciones de la comunidad';
    end if;
    if new.expires_at is distinct from old.expires_at
       or new.expiry_warn_at is distinct from old.expiry_warn_at
       or new.expiry_warned_at is distinct from old.expiry_warned_at
       or new.expired_at is distinct from old.expired_at
       or new.renewed_at is distinct from old.renewed_at then
      raise exception 'PROTECTED_COLUMNS: las fechas de vencimiento las escriben el trigger de publicación, el cron y public.renovar_publicacion(); nunca el dueño del aviso';
    end if;
  end if;

  -- ---- Auto-pausa por denuncias (0118). Estas DOS claves de `attrs` no son
  -- atributos del aviso: son la memoria de una decisión automática, y la lee
  -- una función definer para decidir si devuelve el aviso al aire. El resto de
  -- `attrs` sigue libre —closed_reason, employment_type, lo que sea—; lo que se
  -- cierra son las dos que deciden.
  if new.attrs ->> 'paused_reason' is distinct from old.attrs ->> 'paused_reason'
     or new.attrs ->> 'paused_at' is distinct from old.attrs ->> 'paused_at' then
    raise exception 'PROTECTED_COLUMNS: attrs.paused_reason y attrs.paused_at los escribe la auto-pausa por denuncias (0118); forjarlos dejaría a un aviso dado de baja volviendo solo a published';
  end if;

  return new;
end;
$$;

comment on function app.protect_listing_counters() is
  'BEFORE UPDATE en listings: la lista ÚNICA de lo que un JWT de usuario no puede escribir — contadores (0004/0038), store_verified/store_active/tier (0048), las fechas de vencimiento y renewal_count (0098, con la puerta de renovar_publicacion vía bandera transaccional) y, desde 0118, attrs.paused_reason y attrs.paused_at. Esas dos últimas se suman porque una función definer las LEE para decidir si republica un aviso: un dato que decide y que el usuario escribe es una credencial forjable, no un atributo. Exime a los updates internos (pg_trigger_depth > 1) y a service_role, que es lo que deja pasar al trigger de la auto-pausa y a moderación.';

revoke execute on function app.protect_listing_counters() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Cuánto pesa lo que hay denunciado sobre un aviso
-- ---------------------------------------------------------------------------
-- UNA SOLA DEFINICIÓN del cálculo, igual que `app.listing_expiry_dates()` en la
-- 0098: la usan la pausa y la restitución, y el día que el umbral pase a ser
-- configurable se cambia acá y en ningún otro lado.
--
-- La subconsulta agrupa por persona y toma su peso MÁXIMO: denunciar tres veces
-- el mismo aviso no vale por tres. La sirve `scam_reports_target_idx`
-- (tenant_id, target_kind, target_id) de la 0005, tal cual está — no hace falta
-- índice nuevo.
--
-- El group by NO quedó redundante con el único de la sección 1: ese único es
-- PARCIAL (sólo lo pendiente), así que la misma persona puede tener una
-- denuncia 'upheld' vieja y una 'open' nueva sobre el mismo aviso. Las dos
-- cuentan para el peso, y sin agrupar esa persona valdría doble.
create or replace function app.peso_de_denuncias_de_aviso(
  p_tenant  uuid,
  p_listing uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(por_persona.peso), 0)::numeric
    from (
      select max(r.weight) as peso
        from public.scam_reports r
       where r.tenant_id   = p_tenant
         and r.target_kind = 'listing'
         and r.target_id   = p_listing
         -- Todo lo que no fue DESESTIMADO. 'dismissed' es el único estado que
         -- afirma "esto no pasó"; 'reviewing' es un caso abierto y 'upheld' es
         -- una denuncia CONFIRMADA, así que ninguno de los dos devuelve peso.
         and r.status <> 'dismissed'
       group by r.reporter_id
    ) por_persona;
$$;

comment on function app.peso_de_denuncias_de_aviso(uuid, uuid) is
  'Peso acumulado de las denuncias NO DESESTIMADAS sobre un aviso (0118). Suma por PERSONA y no por fila —toma el peso máximo de cada reportante— y eso sigue siendo necesario aun con el único parcial de esta misma migración: ese único sólo cubre lo PENDIENTE, así que una persona puede tener una upheld vieja y una open nueva sobre el mismo aviso y contarían doble. Cuenta open, reviewing y upheld: sólo dismissed devuelve peso, que es el único de los cuatro estados que dice "esto no pasó". security definer porque la consultan triggers que corren bajo el rol de quien denuncia, que no puede leer denuncias ajenas.';

-- Sin grant a `authenticated` A PROPÓSITO: "cuántas denuncias pendientes tiene
-- este aviso" es información de moderación, y exponerla le diría a quien está
-- por estafar cuánto le falta para caerse (o a quien coordina un reporte
-- masivo, cuántas cuentas más necesita). Los triggers no necesitan grant: son
-- definer y corren con el rol dueño de la función.
revoke all    on function app.peso_de_denuncias_de_aviso(uuid, uuid) from public, anon, authenticated;
grant execute on function app.peso_de_denuncias_de_aviso(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. La reconciliación, en los dos sentidos
-- ---------------------------------------------------------------------------
-- Una función para los dos triggers: la pregunta que contesta es siempre la
-- misma. Idempotente porque los dos UPDATE llevan el estado esperado en el
-- WHERE — re-ejecutarla no encuentra fila y no emite notificación.
create or replace function app.reconciliar_pausa_por_denuncias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 3.0 = tres vecinos comunes, o uno de máxima confianza. Ver la sección 2 de
  -- la cabecera antes de moverlo: cada décima cambia cuántas cuentas nuevas
  -- hacen falta para bajarle el aviso a alguien.
  v_umbral numeric := 3.0;
  v_peso   numeric;
begin
  -- Sólo avisos. Un perfil o un mensaje denunciado no se "pausa": eso es
  -- suspensión de cuenta o moderación de chat, y las dos las decide una persona.
  if new.target_kind <> 'listing' then
    return null;
  end if;

  v_peso := app.peso_de_denuncias_de_aviso(new.tenant_id, new.target_id);

  if v_peso >= v_umbral then
    -- ── SE PAUSA ──────────────────────────────────────────────────────────
    -- El `status = 'published'` del WHERE es la idempotencia y además la
    -- garantía de que no se toca un aviso que su dueño ya había bajado, ni uno
    -- que moderación ya bajó a 'removed', ni uno cerrado (0117).
    with pausado as (
      update public.listings l
         set status = 'paused',
             attrs  = jsonb_set(
                        jsonb_set(
                          coalesce(l.attrs, '{}'::jsonb),
                          '{paused_reason}', to_jsonb('reports'::text)
                        ),
                        '{paused_at}', to_jsonb(now())
                      )
       where l.id        = new.target_id
         and l.tenant_id = new.tenant_id
         and l.status    = 'published'
      returning l.id, l.tenant_id, l.created_by, l.title
    )
    insert into public.notifications (
      tenant_id, profile_id, kind, title, body, href, category, priority
    )
    select
      p.tenant_id,
      p.created_by,
      'listing_paused_reports',
      'Pausamos tu publicación mientras la revisamos',
      left(p.title, 80)
        || ' recibió varias denuncias de la comunidad, así que la sacamos de'
        || ' circulación hasta que el equipo la mire. No se borró nada. Si fue'
        || ' un malentendido, vuelve a estar visible apenas se resuelva.',
      '/publicaciones',
      'seguridad',
      'high'
      from pausado p
     where p.created_by is not null;
     -- Sin consulta a notification_prefs: en las categorías críticas
     -- (seguridad/pagos/cuenta) el emisor no consulta preferencias — 0045.

  else
    -- ⚠️ UNA DENUNCIA NUEVA NO DESPAUSA NADA, JAMÁS.
    --
    -- La restitución sólo tiene sentido cuando un reporte SALE de la cola. Que
    -- también corriera en el INSERT era el agujero crítico de la primera
    -- versión de este archivo (sección 5 de la cabecera): con la marca
    -- `attrs.paused_reason` forjada por el dueño, cualquier denuncia por debajo
    -- del umbral republicaba un aviso dado de baja, con permisos de definer.
    --
    -- Es también un sinsentido semántico antes que un agujero: denunciar algo
    -- no es un voto a favor de que se muestre. La marca ya está protegida por
    -- app.protect_listing_counters() (sección 3), pero las dos defensas se
    -- quedan: la de arriba impide forjar el dato, ésta impide que un camino que
    -- no debería existir lo use.
    if tg_op = 'INSERT' then
      return null;
    end if;

    -- ── VUELVE ────────────────────────────────────────────────────────────
    -- Sólo si la pausa la puso ESTA automatización. Un aviso que su dueño
    -- pausó a mano no se republica jamás desde acá: sería mostrarle a la
    -- comunidad algo que su dueño decidió no mostrar.
    --
    -- Se limpian las dos claves en vez de dejarlas viejas: `paused_reason` con
    -- un valor de una pausa que ya no existe haría que la próxima pausa manual
    -- del dueño se lea como automática, y la siguiente desestimación la
    -- levantaría sola.
    with restituido as (
      update public.listings l
         set status = 'published',
             attrs  = (coalesce(l.attrs, '{}'::jsonb) - 'paused_reason') - 'paused_at'
       where l.id                     = new.target_id
         and l.tenant_id              = new.tenant_id
         and l.status                 = 'paused'
         and l.attrs->>'paused_reason' = 'reports'
      returning l.id, l.tenant_id, l.created_by, l.title
    )
    insert into public.notifications (
      tenant_id, profile_id, kind, title, body, href, category, priority
    )
    select
      r.tenant_id,
      r.created_by,
      'listing_restored_reports',
      'Tu publicación volvió a estar visible',
      left(r.title, 80)
        || ' ya está de nuevo en la comunidad: revisamos las denuncias y no'
        || ' encontramos nada que la justifique. Gracias por la paciencia.',
      '/publicaciones',
      'seguridad',
      'normal'
      from restituido r
     where r.created_by is not null;
  end if;

  return null;
end;
$$;

comment on function app.reconciliar_pausa_por_denuncias() is
  'AFTER INSERT y AFTER UPDATE OF status en scam_reports (0118): pausa el aviso denunciado cuando el peso NO desestimado llega a 3.0 y lo devuelve a published cuando baja, siempre que la pausa la haya puesto esta misma automatización (attrs.paused_reason = ''reports''). En INSERT SÓLO PAUSA: una denuncia nueva no despausa nada jamás — denunciar no es un voto a favor, y esa rama era el agujero crítico de la primera versión (con la marca forjada por el dueño republicaba avisos dados de baja con permisos de definer). Nunca escribe ''removed'': ese estado es la conclusión de una persona, y ponerlo por acumulación convertiría el reporte masivo coordinado en un arma con la firma del equipo. Idempotente — los dos UPDATE llevan el estado esperado en el WHERE, así que un re-fire no encuentra fila ni emite notificación. security definer porque quien dispara el INSERT es quien denuncia, que no puede tocar el aviso de otro: con los permisos del caller la pausa fallaría en silencio.';

-- LA REGLA DE LA 0083, al pie: toda función nueva en `app` nace con EXECUTE
-- para PUBLIC (y `anon` lo hereda), así que se revoca a mano. Los dos roles, no
-- uno: revocarle sólo a `anon` no sirve porque PUBLIC lo sigue cubriendo. Que
-- sea una función de trigger —no invocable fuera de un trigger— no la exime:
-- la regla vale para todas, o el día que alguien la copie como plantilla el
-- agujero viaja con ella.
revoke execute on function app.reconciliar_pausa_por_denuncias() from public, anon;

-- ---------------------------------------------------------------------------
-- 6. Los dos disparadores
-- ---------------------------------------------------------------------------
-- AFTER, no BEFORE: la denuncia se guarda primero y pase lo que pase con el
-- aviso. Y AFTER INSERT ve la fila con su `weight` ya escrito por
-- `app.scam_report_set_weight()` (BEFORE INSERT, 0005), que es de donde sale
-- todo el cálculo.
drop trigger if exists scam_reports_pausa_de_avisos on public.scam_reports;
create trigger scam_reports_pausa_de_avisos
after insert on public.scam_reports
for each row execute function app.reconciliar_pausa_por_denuncias();

-- El WHEN evita el trabajo cuando el UPDATE no movió el estado (el panel
-- también edita otras columnas). Cubre las cuatro transiciones, no sólo
-- dismissed: reabrir un caso cerrado tiene que poder volver a pausar, o la
-- automatización sólo sabría funcionar una vez por aviso.
drop trigger if exists scam_reports_pausa_de_avisos_update on public.scam_reports;
create trigger scam_reports_pausa_de_avisos_update
after update of status on public.scam_reports
for each row
when (old.status is distinct from new.status)
execute function app.reconciliar_pausa_por_denuncias();

commit;

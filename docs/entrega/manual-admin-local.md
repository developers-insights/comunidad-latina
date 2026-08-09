# Manual del Administrador de Comunidad — Comunidad Latina

Este manual es para quien administra **una sola comunidad** dentro de la plataforma (rol `domain_admin`). Por ejemplo, la persona a cargo de "Dominicanos" o de "Colombianos en Miami".

---

## 1. Cómo entrar

1. Entrá con tu cuenta en la app de tu comunidad.
2. Andá a `/admin`. Vas a ver 4 pestañas: **Moderación, Miembros, Empleos, Dominio** y **Métricas** — no vas a ver la pestaña **Global**, esa es solo del súper admin de la plataforma.

---

## 2. Qué podés hacer

### 2.1 Tu comunidad de un vistazo (`/admin/dominio`)

- Estadísticas del día: miembros, publicaciones, avisos activos, avisos en revisión, reportes abiertos.
- Avisos publicados, desglosados por tipo (vivienda, negocios, profesionales, eventos, empleos).
- **Avisos esperando tu revisión**: aprobalos o rechazalos con un botón.
- **Reportes de estafa abiertos**: confirmalos (el aviso reportado se da de baja automáticamente) o desestimalos.
- **Módulos de tu comunidad**: prendé, apagá o marcá "Muy pronto" cada sección (feed, propiedades, negocios, profesionales, eventos, empleos, mensajes, marketplace, creadores, videos). Los cambios se aplican al instante.

### 2.2 Miembros (`/admin/miembros`)

- Buscador por nombre.
- Por cada miembro: estado de cuenta y cuántos reportes abiertos tiene encima.
- Acciones de sanción:
  - **Suspender** (7 o 30 días, con motivo obligatorio) — cualquier moderador de tu comunidad puede hacerlo.
  - **Dar de baja** (ban permanente, con motivo) — esta acción es solo tuya (`domain_admin`), un moderador no puede.
  - **Reactivar** una cuenta sancionada.
- Cada sanción queda auditada (quién, cuándo, a quién) y bloquea también el login de esa persona, no solo su estado en la base.

### 2.3 Empleos (`/admin/empleos`)

- Lista de avisos de trabajo de tu comunidad, con cuántas postulaciones recibió cada uno y cuántas siguen sin respuesta.
- Al entrar al detalle de un aviso ves las postulaciones — pero **con un límite deliberado**: si el aviso lo publicó un miembro (no un negocio verificado), el contenido de las respuestas del postulante NO se muestra, solo cuántas hay y en qué estado. Esto es una política de privacidad explícita (`src/app/admin/empleos/policy.ts`), no un bug.
- Abrir esta pantalla queda **siempre auditado** — es acceso a datos de personas, así que se registra se vea o no el contenido.

### 2.4 Moderación (`/admin/moderacion`)

- Cola de contenido marcado por la IA para revisión humana (posts, comentarios, avisos, fotos, mensajes flaggeados), ordenada del más viejo al más nuevo.
- Aprobás o rechazás cada caso con un botón; el efecto se aplica automáticamente sobre el contenido (se publica o se da de baja).

### 2.5 Métricas (`/admin/metricas`)

- Usuarios activos, publicadores y quienes se contactaron, en ventanas de 7/30/90 días, con gráfico de tendencia.
- A diferencia del súper admin, vos **no elegís comunidad** — la RPC que trae los números te impone la tuya automáticamente, tomada del token de tu sesión, nunca de la URL.

---

## 3. Qué NO podés hacer (y por qué eso está garantizado, no solo escondido)

Esta es la parte más importante del manual. La plataforma es **multi-tenant**: muchas comunidades comparten la misma base de datos. Que tu rol no vea otras comunidades no es que el botón esté escondido — es que **la base de datos misma te lo impide**, aunque intentaras pedir el dato por otro camino (la consola del navegador, una llamada directa a la API).

| No podés | Por qué es imposible, no solo invisible |
|---|---|
| **Ver otra comunidad** (miembros, avisos, reportes, estadísticas) | Cada tabla sensible tiene Row Level Security (RLS) en Postgres. Las políticas comparan el `tenant_id` que viaja en tu JWT (tu sesión, verificada por Supabase) contra el `tenant_id` de cada fila. Sin ese match, Postgres directamente no te devuelve la fila — no es un filtro que el código "olvide" aplicar, es una regla de la base misma. |
| **Crear una comunidad nueva** | La tabla `tenants` solo acepta INSERT de `global_admin` por política de RLS. `getStaffContext("domain_admin")` en el código ya te frena antes, pero aunque ese chequeo no existiera, la base rechazaría el insert igual. |
| **Publicar un Broadcast Global** (a tu comunidad o a otras) | La tabla `broadcasts` (y su asignación en `broadcast_targets`) solo acepta escritura de `global_admin`. El formulario de Broadcast ni siquiera existe en tu panel — no tenés la pestaña **Global**. |
| **Tocar la configuración del Súper Admin** (crear tenants, ver todas las comunidades juntas, cambiar dominios) | Todo eso vive en `/admin/global`, cuyo layout exige `role === "global_admin"` en el servidor (`src/app/admin/guard.ts`, función `requireStaff`) — si entrás a esa URL sin el rol, te redirige afuera antes de renderizar nada. |
| **Cambiar tu propio rol o el de otra persona** | El rol vive en `app_metadata` del usuario en Supabase Auth, un campo que solo puede escribir el service role del servidor (nunca el cliente, nunca una acción tuya desde la app). |

### La regla de fondo

En este producto, **el filtro por comunidad en una consulta (`.eq('tenant_id', ...)`) es una comodidad de UX, no la barrera de seguridad**. La barrera real es RLS: cada política en Postgres exige que el `tenant_id` del JWT (el que Supabase Auth firmó cuando iniciaste sesión) coincida con el de la fila. Aunque un desarrollador se olvidara de poner ese filtro en una pantalla nueva, la base seguiría bloqueando el acceso cruzado.

Para el detalle técnico completo (diagramas, RPCs, cómo se resuelve tu comunidad en cada request) ver `docs/entrega/arquitectura-diagrama.md`.

---

## 4. Preguntas frecuentes

**¿Por qué no veo la pestaña Global?** Porque tu rol es `domain_admin`, no `global_admin`. Es información de toda la plataforma, no de tu comunidad.

**¿Puedo tener más de un administrador en mi comunidad?** El esquema lo permite (varios usuarios pueden tener rol `domain_admin` con tu mismo `tenant_id`), pero hoy no hay una pantalla para agregar un segundo admin vos mismo — se hace al nacer la comunidad, o pidiéndoselo al súper admin de la plataforma.

**¿Por qué no veo el contenido completo de una postulación de empleo?** Es una decisión de privacidad explícita cuando el aviso lo publicó un miembro particular (no un negocio verificado) — ver §2.3.

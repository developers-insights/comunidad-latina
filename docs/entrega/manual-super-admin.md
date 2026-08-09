# Manual del Súper Admin Global — Comunidad Latina

Este manual es para la persona dueña de la plataforma (hoy, Geovanny). Cubre todo lo que se hace desde el rol **`global_admin`**: el único que ve y gobierna TODAS las comunidades a la vez.

No hace falta saber programar para seguir esta guía. Cuando algo todavía no existe como pantalla, te lo digo en la sección **Pendiente** al final — sin maquillarlo.

---

## 1. Cómo entrar al panel

1. Entrá con tu cuenta en la app (`/entrar`).
2. Andá a `/admin`. Si tu cuenta tiene el rol `global_admin`, ves el panel completo con 5 pestañas arriba: **Moderación, Miembros, Empleos, Dominio, Métricas** y **Global** (esta última solo la ves vos).
3. Si no tenés el rol correcto, la app te redirige afuera sin mostrarte nada — no es un error, es el diseño (`src/app/admin/guard.ts`).

El panel es una sola pantalla más densa que el resto de la app — pensada para trabajar, no para navegar bonito (`src/app/admin/layout.tsx`).

---

## 2. Crear una comunidad nueva (tenant)

Pantalla: **Global** (`/admin/global`) → sección "Crear comunidad".

| Campo | Qué es | Obligatorio |
|---|---|---|
| Nombre | Cómo se llama la comunidad puertas afuera (ej. "Colombianos en Miami") | Sí |
| Slug | Identificador corto y fijo, no se puede cambiar después (ej. `colombianos-miami`) | Sí |
| Color de marca | Un hex (ej. `#FDB913`). El sistema genera automáticamente toda la escala de colores, botones y modo oscuro | Sí |
| Dominio | El dominio propio de la comunidad, si ya lo tenés | No |
| Ciudad semilla | Contexto para el contenido inicial | No |

Al guardar (`src/app/admin/global/actions.ts`, función `createTenant`):
- Se valida el contraste del color contra el estándar WCAG AA — si el color no es legible en un botón, la creación se rechaza. Nunca nace una comunidad con marca ilegible.
- Se crean automáticamente 7 módulos activos por defecto: feed, propiedades, negocios, profesionales, eventos, mensajes, escudo.
- Si cargaste un dominio, queda asociado en la base al instante.
- Todo queda auditado (quién, cuándo, qué comunidad).

> **Nota técnica para vos:** esta pantalla es la versión "por formulario" de `scripts/new-tenant.mjs`, el script de línea de comandos que hace lo mismo (y además crea el admin inicial y un post de bienvenida). El detalle completo del alta de punta a punta — incluido lo que queda fuera del panel, como el DNS — está en `docs/entrega/crear-dominio-nuevo.md`.

---

## 3. Configurar un dominio

Entrá a **Global → Dominios** (`/admin/global/dominios`). Vas a ver una sección por comunidad con todos sus dominios. Desde ahí podés agregar un dominio a cualquier comunidad —ya creada o nueva— y marcar cuál es el **principal** (el resto quedan como alias y redirigen solo al principal). Si pegás la dirección completa con `https://` y una ruta, la pantalla la limpia sola.

**Importante:** dar de alta el dominio acá es todo lo que hace falta del lado de la plataforma. Ya no se toca código ni se despliega nada. Lo que sigue siendo trabajo manual afuera es registrar el dominio, apuntar el DNS y agregarlo en Vercel — está paso a paso en `docs/entrega/crear-dominio-nuevo.md`.

**Cuánto tarda en verse:** un dominio recién dado de alta puede tardar hasta **1 minuto**; uno apagado o movido, hasta **5 minutos**. Es la caché, no un error.

Los pasos que sí requieren salir de la app (DNS, Vercel, certificado SSL) están documentados de punta a punta en `docs/entrega/crear-dominio-nuevo.md`.

---

## 4. Activar, suspender o archivar un dominio

La tabla `tenants` ya tiene una columna `status` con dos valores posibles: `active` y `paused` — la ves reflejada como una etiqueta ("Activa" / "Pausada") en la lista de comunidades del panel Global.

Las tres acciones están en **Global → Dominios**, una por dominio:

| Acción | Qué pasa |
|---|---|
| **Activar** | El dominio vuelve a responder y sirve su comunidad. |
| **Suspender** | El sitio deja de responder por esa dirección. Es reversible: se vuelve a activar cuando quieras. |
| **Archivar** | Igual que suspender, pero declara que la dirección quedó fuera de uso. Sirve para no confundir un apagado temporal con uno definitivo. |

Cada acción te pide confirmación en una ventana que te dice **la consecuencia concreta**, no un "¿estás seguro?" genérico. Si el dominio que estás por apagar es el principal de esa comunidad, la advertencia es más fuerte, porque la comunidad se queda sin dirección canónica.

Acordate del retardo de caché: alguien que ya estaba navegando puede seguir entrando unos minutos después de que lo suspendas.

---

## 5. Asignar administradores locales

Hoy la única forma de darle a alguien el rol `domain_admin` de una comunidad es:

- **Al nacer la comunidad**: el script `scripts/new-tenant.mjs` (o el formulario de "Crear comunidad" — ver más abajo) pide el email de un admin inicial y le da el rol automáticamente, acotado a esa comunidad únicamente.
- **Después de nacida**: entrá a **Global → Administradores** (`/admin/global/administradores`). Vas a ver el equipo actual de la comunidad y un buscador de miembros. Desde ahí podés promover a alguien a **moderador** o a **administrador de la comunidad**, y también quitarle esos permisos. Podés asignar todos los que quieras, no hay límite de uno.

  **Lo que no se puede desde acá:** convertir a alguien en Súper Admin Global. Eso es a propósito — el Súper Admin es quien es dueño de la plataforma, no un permiso operativo que se reparte desde una pantalla.

El rol vive en `app_metadata.role` del usuario en Supabase Auth — es lo que lee tanto el panel como las políticas de seguridad de la base (RLS). Cambiarlo hoy exige acceso directo a Supabase.

---

## 6. Ver usuarios, publicaciones, negocios, empleos, propiedades y eventos por dominio

Lo que existe hoy, y dónde:

| Qué querés ver | Dónde | Alcance |
|---|---|---|
| Cantidad de miembros y avisos publicados por comunidad | `/admin/global` (tabla principal) | Todas las comunidades, un vistazo |
| Lista de miembros de UNA comunidad, con estado de cuenta y reportes | `/admin/miembros` | Solo la comunidad activa en tu sesión (ver nota abajo) |
| Avisos publicados por tipo (vivienda, negocios, profesionales, eventos, empleos) — solo el conteo | `/admin/dominio` | Solo la comunidad activa en tu sesión |
| Avisos esperando revisión (cualquier tipo) | `/admin/dominio` | Solo la comunidad activa en tu sesión |
| Empleos con sus postulaciones | `/admin/empleos` | Solo la comunidad activa en tu sesión |

**Importante — cómo elegís "qué comunidad estás mirando":** el panel de Miembros, Dominio y Empleos no tiene un selector de comunidad para el súper admin; toma la comunidad de tu sesión (definida por el dominio o el `?t=` con el que entraste). Para operar sobre otra comunidad, tenés que entrar a esa comunidad primero (su dominio, o `?t=<slug>` en dev/preview) y volver a `/admin`.

La única pantalla que sí te deja elegir "todas" o una comunidad puntual desde un selector es **Métricas** (`/admin/metricas`) — ver punto 8.

Para recorrer el contenido de verdad —no sólo contarlo— entrá a **Global → Contenido** (`/admin/global/contenido`). Tiene una pestaña por cada cosa que el pliego pide ver: usuarios, publicaciones, negocios, profesionales, empleos, propiedades, eventos, marketplace e influencers. Cada pestaña muestra el total y se navega de a páginas.

Si una pestaña aparece **sin número**, es que ese conteo no se pudo calcular en ese momento. No lo leas como "cero": la pantalla prefiere no mostrar nada antes que mostrarte un número falso.

---

## 7. Ver pagos e ingresos

Entrá a **Global → Ingresos** (`/admin/global/ingresos`). Vas a ver los ingresos por comunidad y por producto, con el período seleccionable y el detalle navegable de cada cobro.

Tres cosas que conviene entender de esta pantalla, porque están hechas a propósito:

- **Un hueco no es un cero.** Si un monto no se pudo leer, ves una raya (`—`) y un aviso de cuántos pagos quedaron sin sumar. Un cero inventado en un tablero de ingresos es peor que un dato faltante.
- **No hay un total único de la plataforma.** Se suma por moneda. Un total combinado obligaría a inventar un tipo de cambio.
- **No hay doble conteo.** Stripe emite varios eventos por un mismo cobro; el tablero suma sólo los que representan plata efectivamente movida, y resta los reembolsos.

Mientras Stripe esté en modo degradado (sin clave real), la pantalla te lo dice arriba de todo y no muestra ingresos porque no los hay.

---

## 8. Ver estadísticas

Pantalla: **Métricas** (`/admin/metricas`).

- Como súper admin, tenés un selector de comunidad ("Todas" o una puntual) y de ventana de tiempo (7 / 30 / 90 días).
- Ves: usuarios activos, quiénes publicaron, quiénes se contactaron, con su comparación contra el período anterior, un gráfico de tendencia y estadísticas secundarias.
- **Es deliberadamente anti-morboso**: son conteos agregados. No hay nombres, no hay forma de llegar desde acá a "quién hizo qué" (`src/app/admin/metricas/page.tsx`, comentario del módulo). Esto es una decisión de producto, no una limitación a resolver.
- Doble candado de seguridad: el panel te filtra por rol, y la función que trae los números (`admin_metrics_overview`, migración 0055) vuelve a chequear el rol adentro de la base — así que aunque alguien le pegue directo a la función sin pasar por esta pantalla, sigue protegida.

---

## 9. Ver reportes y moderación

| Qué | Dónde | Detalle |
|---|---|---|
| Cola de moderación (contenido marcado por IA para revisión humana) | `/admin/moderacion` | Es la pantalla de entrada del panel para todo el staff. Ordenada del caso más viejo al más nuevo. |
| Reportes de estafa abiertos | `/admin/dominio`, sección "Reportes de estafa abiertos" | Acotados a la comunidad activa de tu sesión |

Ambas pantallas resuelven casos con dos botones (aprobar/rechazar, o confirmar/desestimar) y cada decisión queda en `audit_log` con quién, cuándo y sobre qué — nunca con el contenido del mensaje o reporte (ver `docs/entrega/arquitectura-diagrama.md`, sección de seguridad).

---

## 10. Configurar funciones habilitadas por dominio (módulos)

Esto hoy se hace **por comunidad**, desde `/admin/dominio` → sección "Módulos de la comunidad" (accesible también para un súper admin que entra a esa comunidad). Cada módulo tiene tres estados, no dos:

- **Activo**: la sección se ve y funciona.
- **Muy pronto**: aparece en el menú pero marcada como próxima a llegar — para anunciar antes de abrir.
- **Oculto**: no existe para esa comunidad.

Módulos gobernables hoy: feed, propiedades, negocios, profesionales, eventos, empleos, mensajes, marketplace, creadores, videos (`src/app/admin/dominio/modules.ts`). El Escudo Anti-Estafa está fuera de esta lista a propósito — hoy está apagado a nivel de build en toda la plataforma (`ESCUDO_ENABLED = false`), no es un interruptor por comunidad.

**Lo que falta:** no hay una pantalla en `/admin/global` para tocar los módulos de una comunidad sin entrar a ella primero — hoy es una función del panel de Dominio, no del panel Global. Es una diferencia de navegación, no de permisos: tu rol de súper admin sí te alcanza.

---

## 11. Configurar planes y precios

Entrá a **Global → Precios** (`/admin/global/precios`). Cada comunidad tiene sus propios precios, y son 14 casillas: Presencia Verificada (Básico / Prioridad / Pro, mensual y anual), Boost y campañas de publicación (7, 14 y 30 días), Membresía de Tienda y Aviso Premium.

- **Cambiar un precio no borra el anterior.** Cada cambio queda guardado con quién lo hizo y cuándo. Hace falta para poder explicar un cobro viejo o responder un contracargo, y no se puede borrar ni editar desde ninguna pantalla — tampoco por vos.
- **Una comunidad sin precio propio cobra el precio por defecto.** No existe el estado "comunidad sin precio": si nunca tocaste nada, se cobra lo mismo que antes.
- Los montos se guardan en centavos y la moneda es explícita por casilla.

**Antes de cobrarle a alguien de verdad, revisá estos valores.** Los que están sembrados vienen del código anterior, donde estaban marcados como precios de ejemplo para validar el modelo.

---

## 12. Broadcast Global

Pantalla: **Global** (`/admin/global`) → sección "Broadcast global".

Podés mandar un anuncio a:
- **Una comunidad puntual**
- **Varias comunidades** (selección múltiple)
- **Todas** (seleccionándolas todas)

Campos: título, cuerpo, link opcional de acción, fecha de inicio y fin opcionales, y severidad (`info` o `urgent` — la urgente se muestra como alerta de emergencia). El modelo es "pull": cada comunidad seleccionada queda registrada en `broadcast_targets`, y son las comunidades destino las que lo muestran a sus miembros (`src/app/admin/global/actions.ts`, función `createBroadcast`).

---

## Pendiente

**Todas las capacidades del pliego para el Super Admin ya existen como pantalla.** Lo que queda abierto no son ausencias de pantalla, son decisiones que te tocan a vos:

1. **Los precios están sembrados con los montos de ejemplo.** El editor (`/admin/global/precios`) funciona y ya gobierna lo que se cobra, pero los valores que trae vienen del código anterior, marcados en su momento como "precios de ejemplo para validar el modelo". Antes de cobrarle a alguien de verdad, revisalos.
2. **El tablero de ingresos está vacío porque Stripe está en modo degradado.** No es un error de la pantalla: no hay ni un evento de pago registrado todavía. En cuanto la clave real esté puesta, se llena solo. La pantalla te avisa arriba de todo que está en ese modo, para que no leas un cero como un ingreso cero.
3. **Sancionar en otra comunidad ya funciona**, pero es una capacidad fuerte: como Súper Admin podés suspender, banear, reactivar, restringir y levantar restricciones en cualquier comunidad, y resolver avisos y reportes ajenos. Todo queda registrado en Global → Auditoría con tu nombre. Un administrador local sigue sin poder salir de la suya.

### Lo que cambió respecto de versiones anteriores de este manual

Ya podés **agregar y cambiar dominios** de cualquier comunidad, **activar / suspender / archivar** cada dominio, **promover administradores locales** después del alta, **recorrer el contenido** de cada comunidad (no sólo contarlo), **cambiar de comunidad** desde Miembros, Dominio y Empleos, **editar planes y precios por comunidad** con historial de cambios, **ver el tablero de ingresos**, **operar administrativamente en cualquier comunidad**, y **auditar todas las acciones administrativas**.

Nada de esto abrió un agujero: cada capacidad nueva está probada con un `domain_admin` intentando salirse de su comunidad y fallando, y `npm run check:rls` cierra en verde sobre 79 superficies. Ver `docs/entrega/arquitectura-diagrama.md` y `docs/entrega/prueba-multidominio.md` para la evidencia.

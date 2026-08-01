# Playbook de Nacimiento de Tenant

Cómo nace una comunidad nueva en Comunidad Latina (p. ej. "Colombianos en Miami"), de punta a punta. Objetivo del plan del cliente (Semana 7): **nacer una comunidad sin tener que tocar código**. Este documento es el runbook — está pensado para Manuel y el equipo de Geovanny, no para un ingeniero de plataforma.

> Referencia rápida: `node scripts/new-tenant.mjs --help`

---

## 1. Qué decide un humano

Antes de correr nada, alguien (Geovanny o quien administre la plataforma) tiene que resolver:

| Decisión | Ejemplo | Dónde se usa |
|---|---|---|
| **Nombre de la comunidad** | "Colombianos en Miami" | Se ve en toda la app, el header, los emails |
| **Slug** (identificador corto, no se cambia después) | `colombianos-miami` | URL de prueba (`?t=colombianos-miami`), filas en la base |
| **Color de marca** (un solo hex) | `#FDB913` | El pipeline genera automáticamente toda la escala (botones, acentos, modo oscuro) — nunca se elige a mano |
| **Dominio propio** (opcional; se puede sumar después) | `colombianosmiami.com` | Para que la comunidad tenga su propio sitio en vez de vivir bajo el dominio compartido |
| **Ciudad semilla** (opcional) | "Miami, FL" | Contexto para el contenido inicial |
| **Módulos activos** (opcional; por defecto van TODOS prendidos) | Propiedades, Negocios, Profesionales… | Qué secciones ve la comunidad. Apagar es una decisión deliberada — se puede ajustar después desde `/admin/dominio`, sin este script |
| **Quién es el admin inicial** | email + nombre de una persona real | Esa persona entra como `domain_admin` de ESA comunidad únicamente (no puede tocar otras) |

Todo lo demás (contraste de color, estructura de la base, permisos) lo resuelve el script solo.

---

## 2. Qué hace el script

Comando único, idempotente (correrlo dos veces no duplica nada — si algo ya existe, lo salta y avisa):

```bash
node scripts/new-tenant.mjs \
  --slug=colombianos-miami \
  --name="Colombianos en Miami" \
  --hex=#FDB913 \
  --admin-email=admin@colombianosmiami.com \
  --admin-name="Nombre Apellido" \
  --city="Miami, FL" \
  --country=CO
```

(`--domain`, `--locale`, `--currency`, `--modules`, `--admin-password` son opcionales — ver `--help`.)

Paso a paso, en orden:

1. **Valida todo antes de escribir nada.** Formato del slug, del email, del hex — y el **contraste de la marca contra el estándar WCAG AA** (el mismo que exige el pipeline de diseño). Si el color no es legible (texto o botón sin suficiente contraste), el script **aborta y no crea nada** — nunca nace una comunidad con marca ilegible.
2. **Crea el tenant** en la base (`tenants`): nombre, color, ciudad, módulos. Si el slug ya existe, no lo toca (para no pisar una comunidad viva) y avisa.
3. **Si diste `--domain`**, lo asocia en `tenant_domains`. *(Ver §3 — esto solo no alcanza para que el dominio funcione en producción.)*
4. **Crea el admin inicial**: usuario con contraseña, perfil, y el permiso `domain_admin` de esa comunidad únicamente. Si el email ya existe como usuario, no le toca la contraseña — solo confirma sus permisos.
5. **Siembra un post de bienvenida** (kind "texto", publicado por el admin) para que el feed no arranque en blanco el día 1. Se puede omitir con `--no-seed-post`.
6. **Imprime un resumen**: URL para verificar, y si generó una contraseña nueva para el admin, la muestra **una sola vez** — hay que guardarla ahí mismo.

### Modo de prueba (no escribe nada)

```bash
node scripts/new-tenant.mjs --slug=... --name=... --hex=... --admin-email=... --admin-name=... --dry-run
```

Corre toda la validación (incluido el contraste) sin tocar la base. Sirve para probar un color o un slug antes de comprometerse.

### Borrar una comunidad de prueba

Irreversible — pide las dos flags a propósito:

```bash
node scripts/new-tenant.mjs --delete=colombianos-miami --yes-i-am-sure
```

Borra en orden seguro: primero el/los admin(es) (que arrastran su perfil y su trust score), después el post de bienvenida, y al final el tenant (que arrastra su dominio). **Nunca borra `dominicanos` ni `comunidadlatina`** aunque se lo pidas — están bloqueados a propósito. Si la comunidad de prueba tiene contenido que el script no reconoce (avisos, mensajes, guías…), el borrado se frena solo y dice exactamente qué falta limpiar a mano — así nunca se lleva puesto algo real por accidente.

---

## 3. Qué queda a mano (no se puede automatizar desde acá)

Esto es trabajo real, fuera del alcance de un script — son pasos operativos en paneles de terceros (dominios, DNS, Vercel) o decisiones humanas de una sola vez.

| Paso | Dónde | Detalle |
|---|---|---|
| **Registrar el dominio** (si la comunidad quiere uno propio) | El registrador que uses (GoDaddy, Namecheap, etc.) | Solo hace falta si NO vas a usar el dominio compartido de Vercel |
| **Apuntar el DNS** | Panel del registrador | Un registro `CNAME` (o `A`, según lo que pida Vercel) apuntando a Vercel |
| **Agregar el dominio en Vercel** | [vercel.com](https://vercel.com) → equipo **insights3** (InsightsApps) → proyecto **comunidad-latina** → pestaña **Settings → Domains** → "Add" | Vercel valida el DNS automáticamente y emite el certificado SSL |
| **Sumar UNA línea de código** (solo si el dominio es propio) | `DOMAIN_TENANTS` en `src/lib/tenant/resolve.ts` | Ver nota abajo — es el único paso de código que le queda al alta, y solo aplica si hay dominio propio |
| **Plantillas de correo** (bienvenida, recuperar contraseña, etc.) | Resend — hoy estas plantillas son genéricas para toda la plataforma, no por tenant | Si la comunidad necesita su propio remitente/estilo de correo, es trabajo de diseño de copy, no de este script |
| **Variables de entorno en producción** | Vercel → mismo proyecto → **Settings → Environment Variables**, o `node scripts/vercel-env-sync.mjs` | Ver checklist §4 — una comunidad puede nacer "muda" (sin emails, sin moderación de imagen) si producción no tiene las claves que sí están en tu `.env.local` |

### Nota sobre el dominio propio y `DOMAIN_TENANTS`

El middleware (la pieza que decide "qué comunidad sos" en cada visita) resuelve el dominio **sin consultar la base de datos**, por velocidad — es un mapa fijo en código (`DOMAIN_TENANTS`, en `src/lib/tenant/resolve.ts`). Por eso:

- **Sin dominio propio**, la comunidad nueva ya es 100% alcanzable hoy, sin tocar nada: `https://comunidad-latina-sigma.vercel.app/?t=colombianos-miami` (o `?t=colombianos-miami` en cualquier preview/local).
- **Con dominio propio**, además de los tres pasos de arriba (registrar, DNS, Vercel), hace falta sumar una línea a `DOMAIN_TENANTS`:
  ```ts
  "colombianosmiami.com": "colombianos-miami",
  "www.colombianosmiami.com": "colombianos-miami",
  ```
  y desplegar. Es la única parte de "nacer una comunidad" que sigue pidiendo un commit — está documentado así de específico en el código (`src/lib/tenant/resolve.ts`, comentario de `DOMAIN_TENANTS`) para que quien lo toque entienda por qué existe.

### Trampa de los dos remotes de Git (leer antes de tocar `git push`)

El repo tiene **dos remotes** configurados:

| Remote | Apunta a | Estado |
|---|---|---|
| `developers-insights` | `github.com/developers-insights/comunidad-latina` | **El bueno** — Vercel está conectado a este repo, branch `main`, y auto-despliega a producción en cada push |
| `origin` | `github.com/INSIGHTSAPPS/comunidad-latina` | **Legacy** — pide contraseña interactiva y Vercel no lo escucha |

Cualquier comando de git que no nombre el remote explícitamente (`git push` a secas, por ejemplo, según cómo esté configurado el tracking) puede terminar pegándole al legacy — y entonces el push "parece" fallar o quedar colgado pidiendo credenciales, cuando en realidad el problema es que le erraste al remote. **Siempre nombralo:**

```bash
git push developers-insights main
```

Confirmá que el deploy salió mirando que el mismo commit SHA esté en Vercel (Deployments → el de arriba dice "Ready" y coincide con `git log -1 --format=%H`).

---

## 4. Cómo se verifica que la comunidad nueva quedó bien

Checklist después de correr el script (o después de agregar el dominio en Vercel, si aplica):

| Verificación | Cómo | Resultado esperado |
|---|---|---|
| **Resuelve en la app** | Abrí `https://<tu-preview-o-dominio>/?t=<slug>` | Se ve la app con el **nombre y el color de la comunidad nueva**, no los de `dominicanos` |
| **El botón principal es legible** | Mirá cualquier CTA (botón de acción primaria) en modo claro y en modo oscuro | Texto claramente legible sobre el botón en los dos modos — si no lo es, el script nunca debería haber dejado crear esa comunidad (falló la validación de contraste) |
| **El feed no está vacío** | Entrá al feed principal | Aparece el post de bienvenida (salvo que hayas usado `--no-seed-post`) |
| **El admin puede entrar** | Iniciá sesión con el email/contraseña que imprimió el script | Entra, y en `/admin/dominio` ve **solo su comunidad** (no las otras) |
| **Los datos están aislados** | Con el admin nuevo logueado, andá a `/admin/global` (si tiene rol suficiente) o simplemente mirá el feed de `dominicanos`/`comunidadlatina` | El contenido de las otras comunidades NO aparece mezclado con el de la nueva, y viceversa |
| **RLS sigue firme** | `npm run check:rls` | Termina en verde (exit 0) — si algo rompió el aislamiento por tenant, este comando lo grita |
| **Variables de entorno de producción** (si vas a mostrarle esto a un usuario real) | `node scripts/vercel-env-sync.mjs` | Revisá la sección "❌ FALTAN en Vercel" — si falta `RESEND_API_KEY`, la comunidad nueva no va a poder mandar ni un email; si falta `GOOGLE_VISION_API_KEY`, las fotos quedan todas en revisión manual. Ninguna de las dos rompe la app (degradación elegante), pero sí la dejan "muda" a medias sin que se note a simple vista |
| **Dominio propio resuelve** (solo si sumaste uno) | Abrí el dominio directo, sin `?t=` | Mismo resultado que la fila de arriba — si no, revisá DNS (puede tardar) y que sumaste la línea a `DOMAIN_TENANTS` (§3) |

### Cómo se prueba sin comprometerse

1. Correr con un slug de prueba (p. ej. `pruebatenant`) y sin dominio propio.
2. Pasar por la checklist de arriba usando `?t=pruebatenant`.
3. Borrar con `node scripts/new-tenant.mjs --delete=pruebatenant --yes-i-am-sure`.
4. Confirmar que se borró — **por la base, no por la app** (ver nota abajo) — y que `npm run check:rls` sigue en verde.

> **Ojo con la caché después de borrar.** La marca de cada comunidad se cachea 5 minutos (`unstable_cache`, tag `"tenants"`) para no pegarle a la base en cada visita — es una optimización de velocidad ya existente, no algo de este script. El alta la invalida sola (`revalidatePath` desde `/admin/global`), pero el **borrado por este script no puede**: `revalidateTag` es una función que solo existe dentro de una request de Next.js, y el script corre por afuera, directo contra Supabase. Efecto práctico: recién borrada, la comunidad puede seguir "viéndose" en la app (con su nombre y color) hasta 5 minutos — **aunque ya no exista en la base**. Verificado en la práctica: tras borrar `pruebatenant`, `?t=pruebatenant` siguió mostrando "Prueba Tenant" incluso en una pestaña nueva sin cookies y con el servidor reiniciado, porque la caché de Next persiste en `.next/cache` (no es solo memoria). Para confirmar un borrado al toque, mirá la base (Supabase → Table Editor → `tenants`, buscá el slug) en vez de la app; si necesitás que la app se ponga al día ya mismo, esperá los 5 minutos o reiniciá el servidor DESPUÉS de que la caché haya expirado.

---

## 5. Preguntas frecuentes

**¿Puedo cambiarle el color a una comunidad después de nacida?** Sí, desde `/admin/global` (edición) — este script solo cubre el nacimiento, no la edición posterior.

**¿Qué pasa si me equivoco de slug?** El slug no se puede cambiar después (es el identificador). Si te equivocaste y todavía no hay contenido real, lo más simple es borrar (`--delete`) y volver a crear con el slug correcto.

**¿Puedo correr esto contra producción por error?** El script usa las credenciales de `.env.local` — apunta a la misma base que uses ahí. Fijate `NEXT_PUBLIC_SUPABASE_URL` antes de correrlo si tenés dudas de a qué proyecto le estás escribiendo.

**¿Por qué el admin nuevo no puede ver las otras comunidades?** Por diseño: nace con rol `domain_admin`, acotado por Row Level Security al `tenant_id` de su propia comunidad. Solo un `global_admin` (Geovanny) ve todas.

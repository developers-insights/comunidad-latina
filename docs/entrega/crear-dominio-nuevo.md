# Cómo dar de alta un dominio comercial nuevo

Procedimiento de punta a punta para lanzar una comunidad nueva con su propio dominio (ej. `colombianosmiami.com`). Pensado para quien opera la plataforma después de la entrega — no hace falta ser el equipo original de desarrollo.

> Este documento describe el **camino por base de datos** como el principal: la tabla `tenant_domains` y la función `get_tenant_by_domain` ya existen en Supabase (`supabase/migrations/0002_tenants.sql`, `0014_rpcs.sql`) y son la forma correcta, sin deploy, de resolver un dominio nuevo. **Aviso de estado:** al momento de esta entrega, el middleware de la aplicación (`src/middleware.ts`) todavía resuelve el dominio contra un mapa fijo en código (`DOMAIN_TENANTS`, en `src/lib/tenant/resolve.ts`) y no contra esa tabla — es una migración en curso. Mientras dure la transición, **el paso 5 de este documento (sumar el dominio al mapa en código) sigue siendo necesario como respaldo**; en cuanto el middleware pase a resolver por base de datos, ese paso deja de hacer falta y el resto del procedimiento no cambia.

---

## 1. Decisiones humanas (antes de tocar nada)

Alguien con autoridad sobre la plataforma tiene que resolver esto primero:

| Decisión | Ejemplo | Por qué importa |
|---|---|---|
| Nombre de la comunidad | "Colombianos en Miami" | Se ve en toda la app, header, emails |
| Slug (fijo, no se cambia después) | `colombianos-miami` | Identificador en la base y en URLs de prueba |
| Color de marca (un hex) | `#FDB913` | El sistema genera automáticamente toda la escala — nunca se elige a mano el resto |
| Dominio propio | `colombianosmiami.com` | El foco de este documento |
| Ciudad semilla (opcional) | "Miami, FL" | Contexto para contenido inicial |
| Módulos activos (opcional) | Por defecto van todos prendidos | Se puede ajustar después desde `/admin/dominio` |
| Quién es el admin inicial | Email + nombre de una persona real | Entra como `domain_admin` de ESA comunidad únicamente |

---

## 2. Correr el alta (comando único, idempotente)

```bash
node scripts/new-tenant.mjs \
  --slug=colombianos-miami \
  --name="Colombianos en Miami" \
  --hex=#FDB913 \
  --domain=colombianosmiami.com \
  --admin-email=admin@colombianosmiami.com \
  --admin-name="Nombre Apellido" \
  --city="Miami, FL" \
  --country=CO
```

Qué hace, en orden (`scripts/new-tenant.mjs`):

1. **Valida todo antes de escribir nada** — formato del slug, del email, del hex, y el **contraste de la marca contra WCAG AA**. Si el color no es legible en un botón, el script aborta sin crear nada.
2. **Crea la fila en `tenants`** (nombre, color, ciudad, módulos). Idempotente: si el slug ya existe, no lo pisa.
3. **Con `--domain`, escribe en `tenant_domains`** — este insert es, precisamente, el que alimenta el camino por base de datos (`get_tenant_by_domain`).
4. **Crea el admin inicial**: usuario + perfil + rol `domain_admin` acotado a esa comunidad.
5. **Siembra un post de bienvenida** (se puede omitir con `--no-seed-post`).
6. **Imprime un resumen** con la URL de verificación y, si generó una contraseña nueva, la muestra una sola vez.

**Modo de prueba** (valida sin escribir, útil para probar un color o un slug):
```bash
node scripts/new-tenant.mjs --slug=... --name=... --hex=... --admin-email=... --admin-name=... --dry-run
```

**Alternativa por formulario:** el mismo alta de tenant + dominio (sin el admin inicial ni el post de bienvenida) se puede hacer desde `/admin/global` → "Crear comunidad", si quien opera prefiere una pantalla a la terminal (ver `docs/entrega/manual-super-admin.md`, §2).

---

## 3. Registrar el dominio y apuntar el DNS

Esto es trabajo en paneles de terceros, fuera del alcance de cualquier script:

1. **Registrar el dominio** (si todavía no es tuyo) en tu registrador de preferencia (GoDaddy, Namecheap, etc.).
2. **Apuntar el DNS**: un registro `CNAME` (o `A`, según lo que pida Vercel) apuntando a Vercel.

---

## 4. Alta en Vercel

1. Entrá a [vercel.com](https://vercel.com) con el equipo **insights3** (InsightsApps).
2. Proyecto **comunidad-latina** → **Settings → Domains** → "Add".
3. Cargá el dominio (y su `www` si corresponde). Vercel valida el DNS automáticamente y emite el certificado SSL.

---

## 5. Sumar el dominio al mapa de respaldo en código (mientras dure la transición)

**Este paso es el único que todavía pide un commit**, y solo aplica si el dominio es propio (sin dominio propio, la comunidad ya es alcanzable con `?t=<slug>` en dev/preview o el dominio compartido de Vercel).

Archivo: `src/lib/tenant/resolve.ts`, constante `DOMAIN_TENANTS`:

```ts
const DOMAIN_TENANTS: Record<string, string> = {
  // ... dominios existentes ...
  "colombianosmiami.com": "colombianos-miami",
  "www.colombianosmiami.com": "colombianos-miami",
};
```

Guardá, commiteá y desplegá. Una vez que el proyecto termine de migrar la resolución de Host a la tabla `tenant_domains` (el paso 2 ya la pobló), este paso 5 deja de ser necesario — el dominio resuelve solo, sin tocar código ni redeployar. Hasta entonces, es el mapa el que manda en producción, así que **saltear este paso deja el dominio nuevo sin resolver aunque el DNS y Vercel ya estén bien**.

### Variables de entorno en producción

Una comunidad puede "nacer muda" si producción no tiene las mismas claves que tu `.env.local` (sin `RESEND_API_KEY` no manda emails; sin `GOOGLE_VISION_API_KEY` las fotos quedan todas en revisión manual — ninguna de las dos rompe la app, pero sí la dejan a medias sin que se note a simple vista). Verificá con:

```bash
node scripts/vercel-env-sync.mjs
```

y completá lo que falte en Vercel → **Settings → Environment Variables**.

---

## 6. Verificación de punta a punta

| Verificación | Cómo | Resultado esperado |
|---|---|---|
| Resuelve en la app | Abrí `https://colombianosmiami.com` (o `?t=colombianos-miami` en preview/local) | Se ve el nombre y el color de la comunidad nueva |
| El botón principal es legible | Mirá el CTA primario en modo claro y oscuro | Texto legible en los dos modos (si no, la validación de contraste del alta falló en algún punto anterior) |
| El feed no está vacío | Entrá al feed principal | Aparece el post de bienvenida (salvo `--no-seed-post`) |
| El admin puede entrar | Iniciá sesión con las credenciales que imprimió el script | Entra, y en `/admin/dominio` ve solo su comunidad |
| Los datos están aislados | Con el admin nuevo logueado, mirá el feed de otra comunidad existente | El contenido no se mezcla en ningún sentido |
| RLS sigue firme | `npm run check:rls` | Termina en verde (exit 0) |
| Variables de entorno de producción | `node scripts/vercel-env-sync.mjs` | Sin faltantes críticos para lo que la comunidad va a usar |
| Dominio propio resuelve | Abrí el dominio directo, sin `?t=` | Mismo resultado que la primera fila — si no, revisá DNS (puede tardar) y que sumaste la línea del paso 5 |
| Deploy correcto | `git log -1 --format=%H` y comparar con Vercel → Deployments → el de arriba | Mismo commit SHA, estado "Ready" |

### Trampa de los dos remotes de Git

El repo tiene dos remotes: `developers-insights` (el correcto, con auto-deploy a producción) y `origin` (legacy, pide contraseña interactiva y Vercel no lo escucha). **Nombrá siempre el remote** al pushear:

```bash
git push developers-insights main
```

---

## 7. Cómo probar sin comprometerse

1. Correr el alta con un slug de prueba (ej. `pruebatenant`), sin dominio propio.
2. Pasar por la checklist de la sección 6 usando `?t=pruebatenant`.
3. Borrar:
   ```bash
   node scripts/new-tenant.mjs --delete=pruebatenant --yes-i-am-sure
   ```
4. Confirmar el borrado **mirando la base** (Supabase → Table Editor → `tenants`), no la app: la marca del tenant queda cacheada 5 minutos (`unstable_cache`, tag `"tenants"`) y el borrado por script no puede invalidar esa caché (`revalidateTag` solo existe dentro de una request de Next.js, y el script corre por afuera). Recién borrada, la comunidad puede seguir "viéndose" hasta 5 minutos.

`dominicanos` y `comunidadlatina` están bloqueados contra borrado a propósito, sin importar las flags.

---

## Preguntas frecuentes

**¿Puedo cambiarle el color a una comunidad después de nacida?** Sí, desde `/admin/global` (edición) — el script y el formulario de alta solo cubren el nacimiento.

**¿Qué pasa si me equivoco de slug?** No se puede cambiar. Si todavía no hay contenido real, lo más simple es borrar y recrear con el slug correcto.

**¿Puedo correr esto contra producción por error?** El script usa las credenciales de `.env.local` — revisá `NEXT_PUBLIC_SUPABASE_URL` antes de correrlo si tenés dudas de a qué proyecto le estás escribiendo.

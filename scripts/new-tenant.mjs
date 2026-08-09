#!/usr/bin/env node
/**
 * new-tenant.mjs — Playbook de Nacimiento de Tenant (PLAN_MAESTRO §9.3)
 *
 * Nace una comunidad de punta a punta desde la consola: tenant + marca (hex →
 * pipeline OKLCH validado WCAG) + módulos activos + admin inicial (domain_admin)
 * + un post de bienvenida para que el feed no arranque vacío. Idempotente:
 * correrlo dos veces no duplica nada (upsert por slug/email, igual que
 * scripts/seed.mjs). Aborta con mensaje claro y accionable si falta o está mal
 * un input — nunca escribe a medias.
 *
 * Uso:
 *   node scripts/new-tenant.mjs \
 *     --slug=colombianos-miami \
 *     --name="Colombianos en Miami" \
 *     --hex=#FDB913 \
 *     --admin-email=admin@colombianosmiami.com \
 *     --admin-name="Nombre Apellido" \
 *     [--domain=colombianosmiami.com] [--city="Miami, FL"] [--country=CO] \
 *     [--locale=es] [--currency=USD] [--admin-password=...] \
 *     [--modules=feed,propiedades,negocios] [--no-seed-post] [--dry-run]
 *
 * Administrar dominios de una comunidad YA existente (alta, alias, suspensión):
 *   node scripts/new-tenant.mjs --domain-for=colombianos-miami --domain=colombianosmiami.com
 *   node scripts/new-tenant.mjs --domain-for=colombianos-miami --domain=cmiami.com --alias
 *   node scripts/new-tenant.mjs --domain-for=colombianos-miami --domain=viejo.com --status=suspended
 *
 * Borrar una comunidad de prueba (irreversible, requiere las dos flags):
 *   node scripts/new-tenant.mjs --delete=pruebatenant --yes-i-am-sure
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Ver docs/PLAYBOOK-TENANT.md para el runbook completo (qué decide un humano,
 * qué hace este script, qué queda a mano, cómo se verifica).
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env.local') });

// ---------------------------------------------------------------------------
// Helpers de salida (mismo estilo que scripts/seed.mjs)
// ---------------------------------------------------------------------------
function die(context, detail) {
  console.error(`\n✘ ${context}${detail ? `\n  ${String(detail).split('\n').join('\n  ')}` : ''}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`  ⚠️  ${msg}`);
}

function log(action, detail) {
  console.log(`  ${action === 'skip' ? '·' : '+'} [${action}] ${detail}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// 0. Argumentos
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    if (eq !== -1) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const USAGE = `
Uso:
  node scripts/new-tenant.mjs --slug=<slug> --name="<Nombre>" --hex=#RRGGBB \\
    --admin-email=<email> --admin-name="<Nombre Admin>" \\
    [--domain=<host>] [--city="<Ciudad, ST>"] [--country=<XX>] \\
    [--locale=es] [--currency=USD] [--admin-password=<pwd>] \\
    [--modules=feed,propiedades,...] [--no-seed-post] [--dry-run]

  Dominios de una comunidad existente (alta / alias / suspender / archivar):
  node scripts/new-tenant.mjs --domain-for=<slug> --domain=<host> \\
    [--alias] [--status=active|suspended|archived] [--notes="<motivo>"]

  node scripts/new-tenant.mjs --delete=<slug> --yes-i-am-sure

Ver docs/PLAYBOOK-TENANT.md para el runbook completo.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(USAGE);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Reglas canónicas — MISMAS que src/app/admin/global/actions.ts (tenantSchema)
// y src/app/admin/dominio/modules.ts (MODULE_KEYS). No se pueden importar
// esos .ts desde acá (uno es "use server", el otro arrastra zod/React) así
// que se duplican a mano, igual que ya hace scripts/seed.mjs con MODULE_KEYS
// — la única defensa posible contra la deriva es el test de sincronía
// (src/lib/tenant/resolve.test.ts, describe "sincronía con scripts/new-tenant.mjs").
// ---------------------------------------------------------------------------
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Espejo de RESERVED_BRAND_SLUGS en src/lib/tenant/resolve.ts. Un tenant con
 * uno de estos slugs existe en la DB pero el middleware NUNCA lo resuelve como
 * comunidad pública (es marca/legal, no un hueco técnico) — nacerlo con este
 * script es válido (p. ej. para sumarle un admin) pero nunca va a ser
 * alcanzable para el usuario final. Se avisa, no se bloquea.
 */
const RESERVED_BRAND_SLUGS = ['comunidadlatina'];

/** Espejo exacto de MODULE_KEYS en src/app/admin/dominio/modules.ts y scripts/seed.mjs. */
const MODULE_KEYS = [
  'feed',
  'propiedades',
  'negocios',
  'profesionales',
  'eventos',
  'empleos',
  'mensajes',
  'marketplace',
  'creadores',
  'videos',
];

/** Los dos tenants reales de producción — el modo --delete los rechaza siempre. */
const PROTECTED_SLUGS = new Set(['dominicanos', 'comunidadlatina']);

// ---------------------------------------------------------------------------
// Pipeline de marca — se importa el .ts REAL (no se duplica el algoritmo de
// OKLCH/WCAG): Node >= 22.6 puede importar TypeScript con sintaxis "erasable"
// de forma nativa. Si esto falla, es casi siempre una versión de Node vieja.
// ---------------------------------------------------------------------------
async function loadBrandPipeline() {
  const modUrl = pathToFileURL(path.join(ROOT, 'src', 'lib', 'tenant', 'brand-pipeline.ts')).href;
  try {
    return await import(modUrl);
  } catch (err) {
    die(
      'No pude cargar src/lib/tenant/brand-pipeline.ts para validar el contraste.',
      `${err instanceof Error ? err.message : err}\n` +
        `Este script importa el .ts real (evita duplicar el algoritmo de contraste) usando el ` +
        `soporte nativo de TypeScript de Node — hace falta Node >= 22.6 aprox.\n` +
        `Node actual: ${process.version}. Si tu Node es más viejo, actualizalo antes de reintentar.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Modo --delete (borrar una comunidad de prueba) — ver docs/PLAYBOOK-TENANT.md
// ---------------------------------------------------------------------------
async function runDelete(slug) {
  if (!args['yes-i-am-sure']) {
    die(
      `Falta confirmar el borrado de "${slug}".`,
      `Borrar un tenant es irreversible. Volvé a correr agregando --yes-i-am-sure:\n` +
        `  node scripts/new-tenant.mjs --delete=${slug} --yes-i-am-sure`,
    );
  }
  if (PROTECTED_SLUGS.has(slug)) {
    die(
      `"${slug}" es una comunidad real de producción — este script nunca la borra.`,
      `Si de verdad necesitás dar de baja ${slug}, es una decisión humana fuera de este script (datos reales de usuarios).`,
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: tenant, error: selErr } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (selErr) die(`buscando el tenant "${slug}"`, selErr.message);
  if (!tenant) {
    console.log(`\n· No existe ningún tenant con slug "${slug}" — nada para borrar.\n`);
    return;
  }

  section(`Borrando "${tenant.name}" (${tenant.slug}, ${tenant.id})…`);

  // 1. Perfiles del tenant → borrar el auth.user cascadea profiles,
  //    trust_scores y profiles_private (ver migraciones 0003).
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('tenant_id', tenant.id);
  if (profErr) die('leyendo profiles del tenant', profErr.message);
  for (const p of profiles ?? []) {
    const { error } = await supabase.auth.admin.deleteUser(p.id);
    if (error) die(`borrando el usuario ${p.display_name} (${p.id})`, error.message);
    log('delete', `usuario ${p.display_name} (cascadea profile + trust_score)`);
  }

  // 2. Posts propios del tenant (el welcome post que pudo haber creado este script).
  const { data: posts, error: postsSelErr } = await supabase
    .from('posts')
    .select('id')
    .eq('tenant_id', tenant.id);
  if (postsSelErr) die('leyendo posts del tenant', postsSelErr.message);
  if (posts?.length) {
    const { error } = await supabase.from('posts').delete().eq('tenant_id', tenant.id);
    if (error) die('borrando posts del tenant', error.message);
    log('delete', `${posts.length} post(s)`);
  }

  // 3. El tenant en sí. tenant_domains tiene ON DELETE CASCADE (0002_tenants.sql)
  //    así que se lleva el dominio solo. Si queda CUALQUIER otro contenido
  //    (listings, guías, mensajes…) Postgres rechaza el delete por FK — eso es
  //    la red de seguridad: nunca cascadea contenido que este script no sabe
  //    que existe. Se avisa y no se fuerza.
  const { error: delErr } = await supabase.from('tenants').delete().eq('id', tenant.id);
  if (delErr) {
    die(
      `"${tenant.slug}" todavía tiene contenido que este script no borra.`,
      `${delErr.message}\n` +
        `Revisá qué queda (listings, guías, mensajes, verification_checks…) en el dashboard de ` +
        `Supabase con tenant_id = ${tenant.id} y borralo a mano antes de reintentar — a propósito ` +
        `este script NO cascadea contenido que no creó él mismo.`,
    );
  }
  log('delete', `tenant ${tenant.slug} (+ su dominio, por cascada)`);
  console.log(`\n✔ "${tenant.slug}" borrado.\n`);
}

// ---------------------------------------------------------------------------
// 2. Validación de inputs — TODO esto corre sin tocar la red ni la DB.
// ---------------------------------------------------------------------------
function validateCreateArgs(a) {
  const problems = [];

  const slug = typeof a.slug === 'string' ? a.slug.trim().toLowerCase() : '';
  if (!slug) problems.push('--slug es obligatorio (p. ej. --slug=colombianos-miami).');
  else if (!SLUG_RE.test(slug))
    problems.push(
      `--slug="${slug}" inválido: solo minúsculas/números/guiones, 3-40 caracteres, sin guion al borde.`,
    );

  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (!name) problems.push('--name es obligatorio (p. ej. --name="Colombianos en Miami").');
  else if (name.length < 3 || name.length > 60)
    problems.push(`--name debe tener entre 3 y 60 caracteres (tiene ${name.length}).`);

  const hex = typeof a.hex === 'string' ? a.hex.trim() : '';
  if (!hex) problems.push('--hex es obligatorio (p. ej. --hex=#FDB913) — el color de marca.');
  else if (!HEX_RE.test(hex)) problems.push(`--hex="${hex}" inválido: tiene que ser #RRGGBB.`);

  const adminEmail = typeof a['admin-email'] === 'string' ? a['admin-email'].trim() : '';
  if (!adminEmail) problems.push('--admin-email es obligatorio: quién administra esta comunidad.');
  else if (!EMAIL_RE.test(adminEmail)) problems.push(`--admin-email="${adminEmail}" no es un email válido.`);

  const adminName = typeof a['admin-name'] === 'string' ? a['admin-name'].trim() : '';
  if (!adminName) problems.push('--admin-name es obligatorio: nombre del admin inicial.');

  const domain = normalizeDomain(a.domain) || null;
  if (domain && !HOSTNAME_RE.test(domain))
    problems.push(`--domain="${domain}" no parece un hostname válido (p. ej. colombianosmiami.com).`);

  const city = typeof a.city === 'string' && a.city.trim() ? a.city.trim() : null;
  if (city && (city.length < 2 || city.length > 80))
    problems.push('--city debe tener entre 2 y 80 caracteres.');

  const adminPassword = typeof a['admin-password'] === 'string' ? a['admin-password'] : null;
  if (adminPassword && adminPassword.length < 12)
    problems.push('--admin-password debe tener al menos 12 caracteres (o se puede omitir y se genera una).');

  let modules = null;
  if (typeof a.modules === 'string' && a.modules.trim()) {
    modules = a.modules.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = modules.filter((m) => !MODULE_KEYS.includes(m));
    if (unknown.length)
      problems.push(
        `--modules tiene claves que la app no conoce: ${unknown.join(', ')}. Válidas: ${MODULE_KEYS.join(', ')}.`,
      );
  }

  if (problems.length) {
    die(
      `Faltan o son inválidos ${problems.length} dato(s) para nacer la comunidad:`,
      problems.map((p) => `- ${p}`).join('\n') + `\n${USAGE}`,
    );
  }

  return {
    slug,
    name,
    hex: hex.toUpperCase(),
    domain,
    city,
    country: typeof a.country === 'string' && a.country.trim() ? a.country.trim().toUpperCase() : null,
    locale: typeof a.locale === 'string' && a.locale.trim() ? a.locale.trim() : 'es',
    currency: typeof a.currency === 'string' && a.currency.trim() ? a.currency.trim().toUpperCase() : 'USD',
    adminEmail,
    adminName,
    adminPassword,
    modules: modules ?? MODULE_KEYS,
    seedPost: !args['no-seed-post'],
    dryRun: Boolean(args['dry-run']),
  };
}

// ---------------------------------------------------------------------------
// Supabase (service role — mismo patrón que scripts/seed.mjs)
// ---------------------------------------------------------------------------
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    die(
      'Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.',
      'Este script escribe con permisos de administrador (crea el tenant, el admin y su marca) — no hay forma de correrlo sin esas dos variables.',
    );
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function findUserByEmail(supabase, email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) die('listando usuarios existentes', error.message);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

function generatePassword() {
  return crypto.randomBytes(18).toString('base64url'); // 24 chars, bien arriba del mínimo de 12
}

// ---------------------------------------------------------------------------
// Dominios (migración 0060) — la parte que dejó de exigir un deploy
// ---------------------------------------------------------------------------
// Antes de 0060 este script escribía la fila en `tenant_domains` y a
// continuación avisaba que eso NO alcanzaba: había que sumar el host a mano al
// mapa `DOMAIN_TENANTS` de src/lib/tenant/resolve.ts y desplegar. Ese paso ya
// no existe: el proxy resuelve el Host contra `public.resolve_tenant_domain()`
// en cada request, así que la fila que se escribe acá ES el alta.

const DOMAIN_STATUSES = ['active', 'suspended', 'archived'];

/**
 * Espejo de `app.normalize_tenant_domain()` (0060) y de `normalizeHost()` en
 * src/lib/tenant/domain-lookup.ts: minúsculas, sin espacios, sin puerto, sin
 * punto final. Hace falta acá porque el script BUSCA por `domain` antes de
 * escribir — y el trigger normaliza recién al escribir, así que una búsqueda
 * sin normalizar no encontraría la fila que ya existe.
 */
function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/:[0-9]+$/, '')
    .replace(/\.$/, '');
}

/**
 * Da de alta (o actualiza) un dominio de un tenant. Idempotente.
 *
 * Dos cuidados que la base sola no cubre:
 *  1. Nunca se le roba un dominio a otro tenant. `upsert onConflict: 'domain'`
 *     lo movería en silencio si el host ya fuera de otra comunidad — un typo
 *     en `--domain-for` apagaría un sitio vivo. Se chequea antes y se aborta.
 *  2. Un solo primario por tenant lo garantiza el índice parcial único
 *     `tenant_domains_primary_uniq`. Si este va a ser el canónico, primero hay
 *     que bajar al anterior, o el insert rebota contra el índice.
 */
async function upsertTenantDomain(supabase, tenant, { domain, isPrimary, status, notes }) {
  const { data: existing, error: selErr } = await supabase
    .from('tenant_domains')
    .select('tenant_id, domain, is_primary, status')
    .eq('domain', domain)
    .maybeSingle();
  if (selErr) die(`buscando el dominio ${domain}`, selErr.message);

  if (existing && existing.tenant_id !== tenant.id) {
    die(
      `El dominio "${domain}" ya está asignado a OTRA comunidad.`,
      `Este script nunca reasigna un dominio vivo (sería apagar el sitio de alguien por un typo).\n` +
        `Si de verdad hay que moverlo, primero archivalo en su comunidad actual:\n` +
        `  node scripts/new-tenant.mjs --domain-for=<slug-actual> --domain=${domain} --status=archived`,
    );
  }

  if (isPrimary) {
    const { error } = await supabase
      .from('tenant_domains')
      .update({ is_primary: false })
      .eq('tenant_id', tenant.id)
      .eq('is_primary', true)
      .neq('domain', domain);
    if (error) die(`bajando el canónico anterior de ${tenant.slug}`, error.message);
  }

  const row = { tenant_id: tenant.id, domain, is_primary: isPrimary, status };
  if (notes) row.notes = notes;

  const { error } = await supabase.from('tenant_domains').upsert(row, { onConflict: 'domain' });
  if (error) die(`guardando el dominio ${domain}`, error.message);

  // Un dominio apagado NUNCA queda como canónico: el índice parcial único
  // `tenant_domains_primary_uniq` no mira el status, así que un primario
  // suspendido seguiría bloqueando al canónico nuevo.
  const rol = status === 'active' ? (isPrimary ? 'canónico' : 'alias') : `apagado (${status})`;
  log(existing ? 'update' : 'create', `${domain} → ${tenant.slug} · ${rol}`);
  return { created: !existing };
}

/** Lo que queda a mano después de escribir la fila. Ya NO incluye tocar código. */
function printDomainNextSteps(domain, status) {
  if (status !== 'active') {
    console.log(
      `\n  "${domain}" quedó en "${status}": deja de resolver en cuanto expire la caché ` +
        `del proxy (hasta 5 min). No hay nada que desplegar.\n`,
    );
    return;
  }
  console.log(`
  Pasos que quedan a mano (paneles de terceros, no código):
    1. DNS: apuntá ${domain} a Vercel (CNAME/A, según lo que pida el panel).
    2. Vercel → equipo insights3 → proyecto comunidad-latina → Settings → Domains → Add.
       Vercel valida el DNS y emite el certificado.

  Lo que YA NO hace falta: ninguna edición de código, ningún commit, ningún deploy.
  El proxy resuelve el Host contra tenant_domains en cada request. Un dominio
  recién dado de alta puede tardar hasta 1 minuto en resolver (caché negativa
  del proxy); uno recién apagado, hasta 5 minutos.
`);
}

// ---------------------------------------------------------------------------
// Modo --domain-for: administrar dominios de una comunidad ya existente
// ---------------------------------------------------------------------------
async function runDomain(slug, a) {
  const domain = normalizeDomain(a.domain);
  if (!domain) {
    die('Falta --domain.', `Uso:\n  node scripts/new-tenant.mjs --domain-for=${slug} --domain=<host> [--alias] [--status=active|suspended|archived]`);
  }
  if (!HOSTNAME_RE.test(domain)) {
    die(`--domain="${domain}" no parece un hostname válido (p. ej. colombianosmiami.com).`);
  }

  const status = typeof a.status === 'string' && a.status.trim() ? a.status.trim().toLowerCase() : 'active';
  if (!DOMAIN_STATUSES.includes(status)) {
    die(`--status="${status}" inválido.`, `Válidos: ${DOMAIN_STATUSES.join(', ')}.`);
  }
  const isPrimary = !a.alias && status === 'active';
  const notes = typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim() : null;

  const supabase = getSupabaseAdmin();
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (error) die(`buscando la comunidad "${slug}"`, error.message);
  if (!tenant) {
    die(
      `No existe ninguna comunidad con slug "${slug}".`,
      `Creala primero (ver --help) o revisá el slug — un typo acá dejaría el dominio colgando de la nada.`,
    );
  }

  if (RESERVED_BRAND_SLUGS.includes(tenant.slug)) {
    warn(
      `"${tenant.slug}" es un slug reservado de marca/legal: el proxy nunca lo sirve como comunidad ` +
        `pública, así que este dominio va a existir en la base pero no va a mostrar la comunidad. ` +
        `Ver RESERVED_BRAND_SLUGS en src/lib/tenant/resolve.ts.`,
    );
  }

  section(`Dominio de "${tenant.name}" (${tenant.slug})…`);
  await upsertTenantDomain(supabase, tenant, { domain, isPrimary, status, notes });
  printDomainNextSteps(domain, status);
}

// ---------------------------------------------------------------------------
// 3. Nacimiento (create)
// ---------------------------------------------------------------------------
async function runCreate(input) {
  if (RESERVED_BRAND_SLUGS.includes(input.slug)) {
    warn(
      `"${input.slug}" es un slug reservado de marca/legal (ver RESERVED_BRAND_SLUGS en ` +
        `src/lib/tenant/resolve.ts) — el middleware NUNCA lo va a mostrar como comunidad pública, ` +
        `sin importar qué se cree acá. Si la idea era sumarle un admin a esa comunidad existente, seguí; ` +
        `si la idea era una comunidad nueva ALCANZABLE, elegí otro slug.`,
    );
  }

  // --- Validar contraste WCAG ANTES de escribir nada (requisito duro) -------
  section('1. Validando el color de marca…');
  const { buildBrandScale, validateBrandContrast } = await loadBrandPipeline();
  const contrast = validateBrandContrast(input.hex);
  if (!contrast.ok) {
    die(
      `"${input.hex}" no llega al piso de contraste WCAG AA — no se creó ninguna comunidad ilegible.`,
      contrast.issues
        .map((i) => `- ${i.check}: ${i.ratio ? `${i.ratio.toFixed(2)}:1 medido, hace falta ${i.required}:1` : 'formato inválido'}`)
        .join('\n') + '\n\nProbá con un tono más saturado/oscuro del mismo color, o elegí otro hex.',
    );
  }
  const theme = buildBrandScale(input.hex);
  log('ok', `contraste WCAG AA — CTA claro ${theme.light.brand}, CTA oscuro ${theme.dark.brand}`);

  if (input.dryRun) {
    console.log('\n✔ --dry-run: validación completa, no se escribió nada.\n');
    console.log(`  Se crearía: tenant "${input.name}" (${input.slug}), admin ${input.adminEmail},`);
    console.log(`  módulos: ${input.modules.join(', ')}${input.domain ? `, dominio ${input.domain}` : ''}.\n`);
    return;
  }

  const supabase = getSupabaseAdmin();

  // --- 2. Tenant (idempotente por slug) --------------------------------------
  section('2. Tenant…');
  const { data: existingTenant, error: selErr } = await supabase
    .from('tenants')
    .select('id, slug, name, brand_hex')
    .eq('slug', input.slug)
    .maybeSingle();
  if (selErr) die(`leyendo tenant ${input.slug}`, selErr.message);

  let tenantId;
  if (existingTenant) {
    tenantId = existingTenant.id;
    log('skip', `tenant ${input.slug} ya existe (${existingTenant.id})`);
    if (existingTenant.name !== input.name || existingTenant.brand_hex !== input.hex) {
      warn(
        `la comunidad existente tiene name/hex distintos a los que pasaste ` +
          `(guardado: "${existingTenant.name}" / ${existingTenant.brand_hex}). No se pisa — ` +
          `este script nunca reconfigura una comunidad viva. Cambialo desde /admin/global si hace falta.`,
      );
    }
  } else {
    const modulesObj = Object.fromEntries(input.modules.map((k) => [k, true]));
    const { data: created, error } = await supabase
      .from('tenants')
      .insert({
        slug: input.slug,
        name: input.name,
        brand_hex: input.hex,
        locale: input.locale,
        currency: input.currency,
        country_focus: input.country,
        city_seed: input.city,
        status: 'active',
        modules: modulesObj,
        theme: theme,
      })
      .select('id')
      .single();
    if (error) die(`creando tenant ${input.slug}`, error.message);
    tenantId = created.id;
    log('create', `tenant ${input.slug} (${tenantId})`);
  }

  // --- 3. Dominio propio (opcional, idempotente) -----------------------------
  // Desde 0060 esta fila ES el alta: el proxy resuelve el Host contra
  // tenant_domains en cada request, así que no queda ningún paso de código.
  if (input.domain) {
    section('2b. Dominio propio…');
    await upsertTenantDomain(
      supabase,
      { id: tenantId, slug: input.slug, name: input.name },
      { domain: input.domain, isPrimary: true, status: 'active', notes: null },
    );
  }

  // --- 4. Admin inicial (idempotente por email) -------------------------------
  section('3. Admin inicial…');
  let adminUser = await findUserByEmail(supabase, input.adminEmail);
  let generatedPassword = null;

  if (adminUser) {
    const { error } = await supabase.auth.admin.updateUserById(adminUser.id, {
      app_metadata: { tenant_id: tenantId, role: 'domain_admin' },
    });
    if (error) die(`actualizando permisos de ${input.adminEmail}`, error.message);
    log('skip', `usuario ${input.adminEmail} ya existe (permisos verificados, contraseña sin tocar)`);
  } else {
    generatedPassword = input.adminPassword ?? generatePassword();
    const { data, error } = await supabase.auth.admin.createUser({
      email: input.adminEmail,
      password: generatedPassword,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: 'domain_admin' },
      user_metadata: { display_name: input.adminName },
    });
    if (error) die(`creando el admin ${input.adminEmail}`, error.message);
    adminUser = data.user;
    log('create', `usuario ${input.adminEmail} (domain_admin)`);
  }

  const { error: profErr } = await supabase.from('profiles').upsert(
    {
      id: adminUser.id,
      tenant_id: tenantId,
      display_name: input.adminName,
      country_origin: input.country,
      area_label: input.city,
      role: 'domain_admin',
      locale: input.locale,
    },
    { onConflict: 'id' },
  );
  if (profErr) die(`guardando el perfil de ${input.adminEmail}`, profErr.message);

  const { error: trustErr } = await supabase.from('trust_scores').upsert(
    {
      profile_id: adminUser.id,
      tenant_id: tenantId,
      score: 0,
      level: 'nuevo',
      signals: {},
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
  if (trustErr) die(`guardando el trust_score de ${input.adminEmail}`, trustErr.message);
  log('ok', `profile + trust_score de ${input.adminName}`);

  // --- 5. Contenido semilla mínimo (opcional) ---------------------------------
  if (input.seedPost) {
    section('4. Contenido semilla…');
    const { data: existingPost, error: postSelErr } = await supabase
      .from('posts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('author_id', adminUser.id)
      .eq('kind', 'text')
      .maybeSingle();
    if (postSelErr) die('buscando el post de bienvenida', postSelErr.message);

    if (existingPost) {
      log('skip', 'post de bienvenida ya existe');
    } else {
      const { error } = await supabase.from('posts').insert({
        tenant_id: tenantId,
        author_id: adminUser.id,
        body: `¡Bienvenidos a ${input.name}! Esta comunidad recién empieza — sé de las primeras personas en sumarte. Contanos quién sos y qué estás buscando: así arrancamos a construir la red de a poco, entre todos.`,
        media: [],
        kind: 'text',
        status: 'published',
      });
      if (error) die('creando el post de bienvenida', error.message);
      log('create', 'post de bienvenida (kind=text, autor: el admin)');
    }
  }

  // --- 6. Resumen ---------------------------------------------------------------
  console.log(`\n✔ "${input.name}" está viva (tenant_id ${tenantId}).\n`);
  console.log(`  Verificar en dev/preview:  http://localhost:3000/?t=${input.slug}`);
  if (input.domain) {
    console.log(`  Dominio canónico en DB:    ${input.domain} (active, is_primary)`);
  }
  if (generatedPassword) {
    console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Admin inicial — GUARDÁ esta contraseña ahora, no se vuelve a mostrar:`);
    console.log(`    Email:      ${input.adminEmail}`);
    console.log(`    Contraseña: ${generatedPassword}`);
    console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
  console.log(`\n  Checklist de verificación completa: docs/PLAYBOOK-TENANT.md\n`);
  if (input.domain) printDomainNextSteps(input.domain, 'active');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\nNacimiento de tenant — Comunidad Latina (idempotente)\n');

  if (typeof args.delete === 'string' && args.delete.trim()) {
    await runDelete(args.delete.trim().toLowerCase());
    return;
  }

  if (typeof args['domain-for'] === 'string' && args['domain-for'].trim()) {
    await runDomain(args['domain-for'].trim().toLowerCase(), args);
    return;
  }

  const input = validateCreateArgs(args);
  await runCreate(input);
}

main().catch((err) => {
  console.error(`\n✘ Falló: ${err?.stack || err?.message || err}\n`);
  process.exit(1);
});

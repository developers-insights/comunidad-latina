#!/usr/bin/env node
/**
 * seed-demo-content.mjs — Contenido demo del feedback del cliente (2026-07-19)
 *
 * La demo era 100% texto. Este seed la vuelve VISUAL y muestra las reglas
 * nuevas de producto en acción:
 *  - Fotos para los listings seed existentes (vivienda/negocios/eventos/prof.)
 *  - Personas nuevas con cuenta: dueños de negocio y creadores de contenido
 *  - Negocios CON dueño (pueden publicar como entidad) + productos (Marketplace)
 *  - Avisos del Creator Marketplace + aplicaciones + contrato completo con
 *    código de trabajo, garantía demo liberada y reviews mutuas (score real)
 *  - follows de María (la demo member): panadería + festival + creadora
 *  - Posts: personales con foto, posts de entidad (solo-seguidores) y UNO
 *    promocionado (chip "Publicidad" para todos) — la regla completa en vivo
 *  - tenants.modules: marketplace y creators encendidos
 *
 * Idempotente (seed_key / email / búsquedas exactas). Requiere .env.local:
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SEED_DEMO_PASSWORD.
 * Las fotos vienen de scripts/seed-images.json (URLs verificadas 200).
 * Uso: node scripts/seed-demo-content.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✘ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 12) {
  console.error('✘ Falta SEED_DEMO_PASSWORD (≥12 chars) en .env.local — mismas reglas que seed.mjs');
  process.exit(1);
}

let IMG;
try {
  IMG = JSON.parse(readFileSync(path.resolve(__dirname, 'seed-images.json'), 'utf8'));
} catch {
  console.error('✘ Falta scripts/seed-images.json (lo genera el curador de imágenes). Sin fotos verificadas no se siembra.');
  process.exit(1);
}
const pic = (cat, i = 0) => {
  const arr = IMG[cat] ?? [];
  if (arr.length === 0) return null;
  return arr[i % arr.length];
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const summary = [];
function log(action, detail) {
  summary.push(`${action}: ${detail}`);
  console.log(`  ${action === 'skip' ? '·' : '+'} [${action}] ${detail}`);
}
function die(context, error) {
  console.error(`✘ ${context}: ${error?.message ?? error}`);
  process.exit(1);
}
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
const daysAhead = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Helpers (patrones de seed.mjs)
// ---------------------------------------------------------------------------
async function tenantBySlug(slug) {
  const { data, error } = await supabase.from('tenants').select('id, modules').eq('slug', slug).maybeSingle();
  if (error) die(`tenant ${slug}`, error);
  if (!data) die(`tenant ${slug}`, 'no existe — corré primero scripts/seed.mjs');
  return data;
}

async function findUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) die('listUsers', error);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser({ email, displayName, role, tenantId, countryOrigin, areaLabel, bio, trust }) {
  let user = await findUserByEmail(email);
  const appMetadata = { tenant_id: tenantId, role };
  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: appMetadata });
    if (error) die(`app_metadata de ${email}`, error);
    log('skip', `usuario ${email} ya existe`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { display_name: displayName },
    });
    if (error) die(`creando usuario ${email}`, error);
    user = data.user;
    log('create', `usuario ${email} (${role})`);
  }
  const { error: profErr } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      tenant_id: tenantId,
      display_name: displayName,
      country_origin: countryOrigin,
      area_label: areaLabel,
      bio,
      role,
      locale: 'es',
    },
    { onConflict: 'id' },
  );
  if (profErr) die(`profile de ${email}`, profErr);
  const { error: trustErr } = await supabase.from('trust_scores').upsert(
    {
      profile_id: user.id,
      tenant_id: tenantId,
      score: trust.score,
      level: trust.level,
      signals: trust.signals,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
  if (trustErr) die(`trust de ${email}`, trustErr);
  return user.id;
}

async function upsertListing(tenantId, item) {
  const { data: existing, error: selErr } = await supabase
    .from('listings')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('attrs->>seed_key', item.seed_key)
    .maybeSingle();
  if (selErr) die(`buscando listing ${item.seed_key}`, selErr);
  if (existing) {
    log('skip', `listing ${item.seed_key} ya existe`);
    return existing.id;
  }
  const { seed_key, attrs = {}, ...rest } = item;
  const { data, error } = await supabase
    .from('listings')
    .insert({
      tenant_id: tenantId,
      source: 'seed',
      status: 'published',
      published_at: new Date().toISOString(),
      contact_protected: true,
      attrs: { ...attrs, seed_key },
      ...rest,
    })
    .select('id')
    .single();
  if (error) die(`creando listing ${seed_key}`, error);
  log('create', `listing [${item.kind}] ${item.title}`);
  return data.id;
}

async function upsertFollow(tenantId, followerId, targetKind, targetId) {
  const { error } = await supabase
    .from('follows')
    .upsert(
      { tenant_id: tenantId, follower_id: followerId, target_kind: targetKind, target_id: targetId },
      { onConflict: 'follower_id,target_kind,target_id', ignoreDuplicates: true },
    );
  if (error) die(`follow ${targetKind}:${targetId}`, error);
}

async function upsertPost(tenantId, { authorId, body, media = [], kind = 'post', entityListingId = null, createdAt }) {
  const { data: existing, error: selErr } = await supabase
    .from('posts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('body', body)
    .maybeSingle();
  if (selErr) die(`buscando post "${body.slice(0, 30)}…"`, selErr);
  if (existing) {
    log('skip', `post "${body.slice(0, 34)}…" ya existe`);
    return existing.id;
  }
  const { data, error } = await supabase
    .from('posts')
    .insert({
      tenant_id: tenantId,
      author_id: authorId,
      body,
      media,
      kind,
      status: 'published',
      entity_listing_id: entityListingId,
      created_at: createdAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) die(`creando post "${body.slice(0, 30)}…"`, error);
  log('create', `post ${entityListingId ? '[entidad] ' : ''}${kind === 'question' ? '[pregunta] ' : ''}"${body.slice(0, 40)}…"`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\nSeed de contenido demo (feedback cliente 2026-07-19) — idempotente\n');

  const tenant = await tenantBySlug('dominicanos');
  const tenantId = tenant.id;

  // 0. Módulos nuevos encendidos en el tenant --------------------------------
  const modules = { ...(tenant.modules ?? {}), marketplace: true, creadores: true };
  {
    const { error } = await supabase.from('tenants').update({ modules }).eq('id', tenantId);
    if (error) die('tenants.modules', error);
    log('update', 'tenants.modules += marketplace, creators');
  }

  // 1. Personas --------------------------------------------------------------
  // María (la member demo original de seed.mjs) fue borrada en algún momento
  // (pruebas de baja de cuenta de R3) — la recreamos con la misma identidad.
  const mariaId = await upsertUser({
    email: 'maria@demo.comunidadlatina.com',
    displayName: 'María Peralta',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Llegué de Santiago hace 8 meses. Buscando comunidad y trabajo estable.',
    trust: { score: 35, level: 'verificado', signals: { months_in_community: 8, transactions_ok: 1, endorsements_count: 2, reports_upheld: 0 } },
  });

  const altagraciaId = await upsertUser({
    email: 'altagracia@demo.comunidadlatina.com',
    displayName: 'Doña Altagracia Frías',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Dueña de la Panadería La Altagracia. El pan de agua de mi abuela, acá en Queens.',
    trust: { score: 74, level: 'confiable', signals: { months_in_community: 22, transactions_ok: 9, endorsements_count: 14, reports_upheld: 0 } },
  });

  const ramonId = await upsertUser({
    email: 'ramon@demo.comunidadlatina.com',
    displayName: 'Ramón "El Nítido" Cabrera',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Jackson Heights, Queens',
    bio: 'Barbero con 12 años de tijera. Organizo el festival del barrio cada verano.',
    trust: { score: 61, level: 'verificado', signals: { months_in_community: 15, transactions_ok: 6, endorsements_count: 8, reports_upheld: 0 } },
  });

  const yeseniaId = await upsertUser({
    email: 'yesenia@demo.comunidadlatina.com',
    displayName: 'Yesenia Taveras',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Washington Heights',
    bio: 'Creadora de contenido: reels, fotos y campañas para negocios latinos.',
    trust: { score: 68, level: 'verificado', signals: { months_in_community: 11, transactions_ok: 5, endorsements_count: 9, reports_upheld: 0 } },
  });

  const luisId = await upsertUser({
    email: 'luis@demo.comunidadlatina.com',
    displayName: 'Luis Medrano',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Bronx',
    bio: 'Videógrafo. Documentando la comunidad un fin de semana a la vez.',
    trust: { score: 44, level: 'verificado', signals: { months_in_community: 7, transactions_ok: 2, endorsements_count: 4, reports_upheld: 0 } },
  });

  const marisolId = await upsertUser({
    email: 'marisol@demo.comunidadlatina.com',
    displayName: 'Marisol Núñez',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Enfermera, mamá de dos, fan del mangú de los domingos.',
    trust: { score: 39, level: 'verificado', signals: { months_in_community: 9, transactions_ok: 1, endorsements_count: 3, reports_upheld: 0 } },
  });

  // Dueños de negocio nuevos (para variedad de avisos del Creator Marketplace).
  const rafaelId = await upsertUser({
    email: 'rafael@demo.comunidadlatina.com',
    displayName: 'Rafael Encarnación',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Jackson Heights, Queens',
    bio: 'Dueño del Restaurante El Cibao. Comida criolla de lunes a sábado y sancocho los domingos.',
    trust: { score: 72, level: 'confiable', signals: { months_in_community: 26, transactions_ok: 11, endorsements_count: 16, reports_upheld: 0 } },
  });

  const yanerisId = await upsertUser({
    email: 'yaneris@demo.comunidadlatina.com',
    displayName: 'Yaneris Rosario',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Dueña de Salón Belleza Divina. Uñas, peinados y el trato que toda mujer merece.',
    trust: { score: 55, level: 'verificado', signals: { months_in_community: 19, transactions_ok: 7, endorsements_count: 11, reports_upheld: 0 } },
  });

  // Creadores nuevos (variedad para el directorio de "Creadores").
  const rosannaId = await upsertUser({
    email: 'rosanna@demo.comunidadlatina.com',
    displayName: 'Rosanna Disla',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Elmhurst, Queens',
    bio: 'Fotógrafa freelance. Especializada en retratos de familia y books sencillos.',
    trust: { score: 58, level: 'verificado', signals: { months_in_community: 14, transactions_ok: 6, endorsements_count: 10, reports_upheld: 0 } },
  });

  const franklinId = await upsertUser({
    email: 'franklin@demo.comunidadlatina.com',
    displayName: 'Franklin Peña',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Jackson Heights, Queens',
    bio: 'Diseñador gráfico freelance. Logos, menús y flyers para los negocios del barrio.',
    trust: { score: 50, level: 'verificado', signals: { months_in_community: 10, transactions_ok: 4, endorsements_count: 7, reports_upheld: 0 } },
  });

  const katerinId = await upsertUser({
    email: 'katerin@demo.comunidadlatina.com',
    displayName: 'Katerin Objio',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'Corona, Queens',
    bio: 'Community manager. Redes sociales de negocios latinos: contenido, mensajes y reportes.',
    trust: { score: 37, level: 'verificado', signals: { months_in_community: 6, transactions_ok: 2, endorsements_count: 5, reports_upheld: 0 } },
  });

  const jonathanId = await upsertUser({
    email: 'jonathan@demo.comunidadlatina.com',
    displayName: 'Jonathan Ureña',
    role: 'member',
    tenantId,
    countryOrigin: 'DO',
    areaLabel: 'East Elmhurst, Queens',
    bio: 'Videógrafo de eventos: bodas, quinceañeras y bautizos, con cámara y drone.',
    trust: { score: 63, level: 'verificado', signals: { months_in_community: 18, transactions_ok: 8, endorsements_count: 12, reports_upheld: 0 } },
  });

  // 2. Fotos para listings seed existentes sin foto --------------------------
  const { data: bare, error: bareErr } = await supabase
    .from('listings')
    .select('id, kind, title, photos')
    .eq('tenant_id', tenantId)
    .eq('photos', '{}');
  if (bareErr) die('listings sin foto', bareErr);

  const catForListing = (l, i) => {
    const t = l.title.toLowerCase();
    if (l.kind === 'property') return ['vivienda_extra', i];
    if (l.kind === 'event') return [t.includes('festival') || t.includes('feria') ? 'evento_festival' : 'evento_concierto', i];
    if (l.kind === 'business') {
      if (t.includes('panader') || t.includes('reposter')) return ['panaderia', i];
      if (t.includes('salón') || t.includes('salon') || t.includes('belleza') || t.includes('uñas')) return ['salon_belleza', i];
      if (t.includes('barber')) return ['barberia', i];
      return ['restaurante', i];
    }
    if (l.kind === 'professional') {
      if (t.includes('electric') || t.includes('plomer') || t.includes('mecán') || t.includes('mecan') || t.includes('mudanza')) return ['profesional_oficio', i];
      return ['profesional_oficina', i];
    }
    return ['gente_feed', i];
  };

  let photoCount = 0;
  for (const [i, l] of (bare ?? []).entries()) {
    const [cat, idx] = catForListing(l, i);
    const primary = pic(cat, idx);
    if (!primary) continue;
    const photos = l.kind === 'property' ? [primary, pic(cat, idx + 1)].filter(Boolean) : [primary];
    const { error } = await supabase.from('listings').update({ photos }).eq('id', l.id);
    if (error) die(`fotos de ${l.title}`, error);
    photoCount += 1;
  }
  log('update', `fotos asignadas a ${photoCount} listings seed que no tenían`);

  // 3. Negocios CON dueño + evento propio ------------------------------------
  // Backdating deliberado: los listings nuevos van DETRÁS de los posts en el
  // orden cronológico del feed — la primera página debe ser gente, no catálogo.
  const panaderiaId = await upsertListing(tenantId, {
    created_at: daysAgo(6),
    published_at: daysAgo(6),
    seed_key: 'negocio-panaderia-altagracia',
    kind: 'business',
    title: 'Panadería La Altagracia',
    description:
      'Pan de agua recién horneado todas las mañanas, bizcocho dominicano por encargo y el cafecito que te hace sentir en casa. Atendemos con cariño desde 2019.',
    area_label: 'Corona, Queens',
    photos: [pic('panaderia', 0), pic('panaderia', 1)].filter(Boolean),
    attrs: { category: 'Panadería', hours: 'Lun–Dom 6:00–20:00' },
    created_by: altagraciaId,
    source: 'user',
  });

  const barberiaId = await upsertListing(tenantId, {
    created_at: daysAgo(6),
    published_at: daysAgo(6),
    seed_key: 'negocio-barberia-nitido',
    kind: 'business',
    title: 'Barbería El Nítido',
    description:
      'Cortes clásicos y modernos, cejas y barba. Música buena, ambiente de barrio y la conversación de siempre. Con cita o por orden de llegada.',
    area_label: 'Jackson Heights, Queens',
    photos: [pic('barberia', 0), pic('barberia', 1)].filter(Boolean),
    attrs: { category: 'Barbería', hours: 'Mar–Dom 10:00–19:00' },
    created_by: ramonId,
    source: 'user',
  });

  const festivalId = await upsertListing(tenantId, {
    created_at: daysAgo(5),
    published_at: daysAgo(5),
    seed_key: 'evento-festival-sabor',
    kind: 'event',
    title: 'Festival Sabor Quisqueya',
    description:
      'Un domingo de música en vivo, comida típica y feria de emprendedores dominicanos. Traé a la familia — hay actividades para los niños.',
    area_label: 'Flushing Meadows, Queens',
    photos: [pic('evento_festival', 0), pic('evento_festival', 1)].filter(Boolean),
    attrs: { starts_at: daysAhead(12), ends_at: daysAhead(12), free: true, venue_area: 'Flushing Meadows Corona Park', family_friendly: true },
    created_by: ramonId,
    source: 'user',
  });

  // 4. Marketplace: productos de las tiendas ---------------------------------
  // category = clave canónica del módulo marketplace (PRODUCT_CATEGORIES en
  // src/components/marketplace/helpers.ts) — no etiqueta display.
  const productos = [
    ['prod-bizcocho', panaderiaId, altagraciaId, 'Bizcocho dominicano por encargo', 'Bizcocho de vainilla con suspiro, para 20 personas. Encargalo con 3 días de anticipación.', 45, 'producto_comida', 0, 'comida_bebidas'],
    ['prod-cafe', panaderiaId, altagraciaId, 'Café Santo Domingo 1 lb', 'El de siempre, recién llegado. Molido o en grano.', 9, 'producto_comida', 1, 'comida_bebidas'],
    ['prod-dulce-leche', panaderiaId, altagraciaId, 'Dulce de leche cortada (pote)', 'Hecho en casa, receta de mi abuela. Pote de 16 oz.', 12, 'panaderia', 3, 'comida_bebidas'],
    ['prod-pan-agua', panaderiaId, altagraciaId, 'Pan de agua (docena)', 'Crujiente por fuera, suavecito por dentro. Retiralo tibio en la mañana.', 6, 'panaderia', 1, 'comida_bebidas'],
    ['prod-pomada', barberiaId, ramonId, 'Pomada mate El Nítido', 'Fijación fuerte sin brillo, la que usamos en la barbería. 4 oz.', 14, 'producto_belleza', 0, 'belleza_cuidado'],
    ['prod-cepillo', barberiaId, ramonId, 'Cepillo de ondas profesional', 'Cerdas mixtas, mango de madera. El favorito de los clientes.', 18, 'producto_belleza', 1, 'belleza_cuidado'],
    ['prod-gorra', barberiaId, ramonId, 'Gorra bordada "El Nítido"', 'Edición del barrio: bordado azul, amarillo y rojo. Talle único ajustable.', 25, 'producto_ropa', 0, 'ropa_accesorios'],
    ['prod-kit-barba', barberiaId, ramonId, 'Kit de barba (aceite + bálsamo)', 'Aceite de argán y bálsamo suave, aroma cítrico. Ideal para regalo.', 32, 'producto_belleza', 2, 'belleza_cuidado'],
  ];
  for (const [key, storeId, ownerId, title, description, price, cat, idx, category] of productos) {
    await upsertListing(tenantId, {
      created_at: daysAgo(4),
      published_at: daysAgo(4),
      seed_key: key,
      kind: 'product',
      title,
      description,
      price_amount: price,
      price_currency: 'USD',
      price_period: 'one_time',
      area_label: storeId === panaderiaId ? 'Corona, Queens' : 'Jackson Heights, Queens',
      photos: [pic(cat, idx)].filter(Boolean),
      attrs: { store_listing_id: storeId, category, condition: 'nuevo' },
      created_by: ownerId,
      source: 'user',
    });
  }

  // 5. Creator Marketplace: perfiles, avisos, aplicaciones -------------------
  // offset distinto por creador: que no compartan foto de portada.
  for (const [profileId, headline, bio, skills, rate, cat, off] of [
    [yeseniaId, 'Reels y fotos que venden — negocios latinos', 'Más de 40 campañas para restaurantes, salones y marcas del barrio. Filmo, edito y te entrego listo para publicar.', ['Reels', 'Fotografía', 'Campañas', 'Instagram'], 'Desde $150 por reel', 'creador_contenido', 0],
    [luisId, 'Video con alma de barrio', 'Videógrafo documental. Aftermovies de eventos, videos de marca y contenido vertical.', ['Video', 'Aftermovie', 'Drone', 'Edición'], 'Desde $250 por video', 'creador_contenido', 2],
    [rosannaId, 'Fotos que se sienten como en casa', 'Retratos de familia, quinceañeras y books sencillos. Once años fotografiando al barrio — sé sacarle la sonrisa hasta al más tímido.', ['Fotografía', 'Retratos', 'Books', 'Quinceañeras', 'Edición'], 'Desde $120 por sesión', 'creador_contenido', 1],
    [franklinId, 'Diseño que hace ver serio a tu negocio', 'Logos, menús, flyers y todo lo que necesites imprimir o postear. Vos me explicás la idea y yo te la resuelvo, rápido y sin dolores de cabeza.', ['Diseño gráfico', 'Logos', 'Menús', 'Flyers', 'Branding'], 'Desde $80 por diseño', 'creador_contenido', 3],
    [katerinId, 'Le doy vida a tus redes todos los días', 'Manejo Instagram, Facebook y TikTok de negocios del barrio: calendario de contenido, respuestas a mensajes y reportes claros cada mes.', ['Redes sociales', 'Community Management', 'Instagram', 'TikTok', 'Contenido'], 'Desde $180/mes', 'creador_contenido', 4],
    [jonathanId, 'Tu evento, filmado como se debe', 'Bodas, quinceañeras y bautizos. Dos cámaras, drone y edición entregada en menos de dos semanas — para revivir el día las veces que quieras.', ['Video', 'Eventos', 'Drone', 'Edición', 'Fotografía'], 'Desde $300 por evento', 'creador_contenido', 5],
  ]) {
    const { error } = await supabase.from('creator_profiles').upsert(
      {
        profile_id: profileId,
        tenant_id: tenantId,
        headline,
        bio,
        skills,
        portfolio_photos: [pic(cat, off), pic(cat, off + 1), pic(cat, off + 2)].filter(Boolean),
        rate_hint: rate,
        available: true,
      },
      { onConflict: 'profile_id', ignoreDuplicates: true },
    );
    if (error) die(`creator_profile ${headline}`, error);
  }
  log('create', 'perfiles de creador: Yesenia + Luis + Rosanna + Franklin + Katerin + Jonathan');

  const gigPanaderiaId = await upsertListing(tenantId, {
    created_at: daysAgo(3),
    published_at: daysAgo(3),
    seed_key: 'gig-reels-panaderia',
    kind: 'creator_gig',
    title: 'Buscamos creador para reels de la panadería',
    description:
      'Queremos 3 reels mostrando el pan recién salido, el bizcocho y el ambiente del local, más 10 fotos para el perfil. Ideal si sabés contar historias de comida.',
    price_amount: 500,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Corona, Queens',
    photos: [pic('panaderia', 2) ?? pic('panaderia', 0)].filter(Boolean),
    attrs: { category: 'video', deliverables: '3 reels + 10 fotos', deadline_days: 14, urgent: false },
    created_by: altagraciaId,
    source: 'user',
  });

  const gigBarberiaId = await upsertListing(tenantId, {
    created_at: daysAgo(3),
    published_at: daysAgo(3),
    seed_key: 'gig-fotos-barberia',
    kind: 'creator_gig',
    title: 'Fotógrafo para sesión del local y el equipo',
    description:
      'Sesión de 2 horas: el local, los barberos trabajando y retratos del equipo. Necesitamos las fotos para el festival del mes que viene.',
    price_amount: 300,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Jackson Heights, Queens',
    photos: [pic('barberia', 2) ?? pic('barberia', 0)].filter(Boolean),
    attrs: { category: 'foto', deliverables: '25 fotos editadas', deadline_days: 10, urgent: true },
    created_by: ramonId,
    source: 'user',
  });

  // 5b. Más avisos del Creator Marketplace (variedad de rubros) --------------
  await upsertListing(tenantId, {
    created_at: daysAgo(2),
    published_at: daysAgo(2),
    seed_key: 'gig-diseno-menu-panaderia',
    kind: 'creator_gig',
    title: 'Buscamos diseñador para el menú nuevo y flyers de temporada',
    description:
      'Queremos renovar el menú de la vitrina (una hoja, dos caras) y armar 3 flyers para las promos del mes — el bizcocho por encargo, el café y las fiestas que se vienen. Que se vea limpio y se lea bien de lejos.',
    price_amount: 180,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Corona, Queens',
    photos: [pic('panaderia', 3) ?? pic('panaderia', 0)].filter(Boolean),
    attrs: { category: 'diseño', deliverables: 'Menú (2 caras) + 3 flyers', deadline_days: 12, urgent: false },
    created_by: altagraciaId,
    source: 'user',
  });

  await upsertListing(tenantId, {
    created_at: daysAgo(4),
    published_at: daysAgo(4),
    seed_key: 'gig-social-barberia',
    kind: 'creator_gig',
    title: 'Community manager para el Instagram y TikTok de la barbería',
    description:
      'Necesitamos quien suba contenido 3 veces por semana, conteste mensajes y arme un calendario simple. Material no falta — cortes, transformaciones, el ambiente de acá — lo que falta es quien lo organice y lo publique.',
    price_amount: 220,
    price_currency: 'USD',
    price_period: 'month',
    area_label: 'Jackson Heights, Queens',
    photos: [pic('barberia', 1) ?? pic('barberia', 0)].filter(Boolean),
    attrs: { category: 'social', deliverables: '12 posts/mes + respuesta a mensajes', deadline_days: 30, urgent: false },
    created_by: ramonId,
    source: 'user',
  });

  await upsertListing(tenantId, {
    created_at: daysAgo(1.5),
    published_at: daysAgo(1.5),
    seed_key: 'gig-foto-restaurante-cibao',
    kind: 'creator_gig',
    title: 'Fotógrafo para los platos y el ambiente del restaurante',
    description:
      'Vamos a imprimir el menú nuevo y necesitamos fotos que den hambre: el mangú, el sancocho de los domingos y el salón con mesas llenas. Una sesión de 3 horas en el horario de más movimiento.',
    price_amount: 280,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Jackson Heights, Queens',
    photos: [pic('restaurante', 2) ?? pic('restaurante', 0)].filter(Boolean),
    attrs: { category: 'foto', deliverables: '20 fotos editadas', deadline_days: 15, urgent: false },
    created_by: rafaelId,
    source: 'user',
  });

  await upsertListing(tenantId, {
    created_at: daysAgo(0.8),
    published_at: daysAgo(0.8),
    seed_key: 'gig-video-salon-divina',
    kind: 'creator_gig',
    title: 'Reels de antes/después para el salón',
    description:
      'Queremos 4 reels cortos mostrando transformaciones reales: uñas, peinados y el cambio de look completo. Si sabés capturar el momento en que la clienta se ve al espejo, este trabajo es para vos.',
    price_amount: 200,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Corona, Queens',
    photos: [pic('salon_belleza', 2) ?? pic('salon_belleza', 0)].filter(Boolean),
    attrs: { category: 'video', deliverables: '4 reels cortos', deadline_days: 10, urgent: true },
    created_by: yanerisId,
    source: 'user',
  });

  await upsertListing(tenantId, {
    created_at: daysAgo(3.5),
    published_at: daysAgo(3.5),
    seed_key: 'gig-campana-festival-sabor',
    kind: 'creator_gig',
    title: 'Campaña completa para promocionar el festival',
    description:
      'Faltan pocas semanas para el festival y necesitamos correr la voz: un flyer, 5 posts para redes y un video corto invitando a la gente. Que se sienta la alegría del evento desde la primera imagen.',
    price_amount: 350,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Flushing Meadows, Queens',
    photos: [pic('evento_festival', 2) ?? pic('evento_festival', 0)].filter(Boolean),
    attrs: { category: 'campaña', deliverables: 'Flyer + 5 posts + 1 video corto', deadline_days: 8, urgent: true },
    created_by: ramonId,
    source: 'user',
  });

  await upsertListing(tenantId, {
    created_at: daysAgo(5),
    published_at: daysAgo(5),
    seed_key: 'gig-diseno-salon-divina',
    kind: 'creator_gig',
    title: 'Diseño de flyer para el especial de uñas del mes',
    description:
      'Vamos a lanzar un combo de manicure y pedicure y necesitamos un flyer llamativo para la vitrina y otro para compartir en redes. Colores vivos, que combine con la marca del salón.',
    price_amount: 90,
    price_currency: 'USD',
    price_period: 'one_time',
    area_label: 'Corona, Queens',
    photos: [pic('salon_belleza', 3) ?? pic('salon_belleza', 0)].filter(Boolean),
    attrs: { category: 'diseño', deliverables: '2 versiones del flyer (vitrina + redes)', deadline_days: 7, urgent: false },
    created_by: yanerisId,
    source: 'user',
  });

  async function upsertApplication(gigId, creatorId, message, proposedCents, status) {
    const { data: existing, error: selErr } = await supabase
      .from('gig_applications')
      .select('id, status')
      .eq('gig_id', gigId)
      .eq('creator_id', creatorId)
      .maybeSingle();
    if (selErr) die('buscando aplicación', selErr);
    if (existing) {
      log('skip', `aplicación ya existe (${status})`);
      return existing.id;
    }
    const { data, error } = await supabase
      .from('gig_applications')
      .insert({ tenant_id: tenantId, gig_id: gigId, creator_id: creatorId, message, proposed_amount_cents: proposedCents, status })
      .select('id')
      .single();
    if (error) die('creando aplicación', error);
    log('create', `aplicación (${status})`);
    return data.id;
  }

  const appYeseniaPan = await upsertApplication(
    gigPanaderiaId,
    yeseniaId,
    'Me encanta el proyecto — trabajé con dos restaurantes de Corona y la comida es lo mío. Puedo empezar esta semana.',
    45000,
    'accepted',
  );
  await upsertApplication(
    gigPanaderiaId,
    luisId,
    'Hago video documental y me interesa mucho la historia de la panadería. Portfolio en mi perfil.',
    50000,
    'submitted',
  );
  await upsertApplication(
    gigBarberiaId,
    yeseniaId,
    'Tengo experiencia en retratos y ambiente de local. Puedo ir un martes que están más tranquilos.',
    null,
    'submitted',
  );

  // 6. Contratos: uno COMPLETO (con reviews) y uno en curso ------------------
  async function findContract(clientId, creatorId, title) {
    const { data, error } = await supabase
      .from('gig_contracts')
      .select('id, code, status')
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .eq('creator_id', creatorId)
      .eq('title', title)
      .maybeSingle();
    if (error) die('buscando contrato', error);
    return data;
  }

  let contrato1 = await findContract(altagraciaId, yeseniaId, 'Reels de apertura — Panadería La Altagracia');
  if (!contrato1) {
    const { data, error } = await supabase
      .from('gig_contracts')
      .insert({
        tenant_id: tenantId,
        gig_id: gigPanaderiaId,
        application_id: appYeseniaPan,
        client_id: altagraciaId,
        creator_id: yeseniaId,
        title: 'Reels de apertura — Panadería La Altagracia',
        scope: '3 reels (30–45s) del pan de agua, el bizcocho y el ambiente + 10 fotos editadas para el perfil del negocio.',
        delivery_days: 10,
        amount_cents: 45000,
        currency: 'usd',
        fee_pct: 20,
        status: 'proposed',
        payment_mode: 'demo',
        created_at: daysAgo(9),
      })
      .select('id, code')
      .single();
    if (error) die('creando contrato 1', error);
    contrato1 = data;
    log('create', `contrato ${data.code} (proposed)`);
    // Transiciones reales (los triggers de reputación cuentan released).
    for (const [status, patch] of [
      ['funded', { funded_at: daysAgo(8) }],
      ['delivered', { delivered_at: daysAgo(3) }],
      ['released', { released_at: daysAgo(2) }],
    ]) {
      const { error: upErr } = await supabase
        .from('gig_contracts')
        .update({ status, ...patch })
        .eq('id', contrato1.id);
      if (upErr) die(`contrato 1 → ${status}`, upErr);
    }
    log('update', `contrato ${contrato1.code}: funded → delivered → released ($450 → $360 creadora + $90 plataforma)`);
  } else {
    log('skip', `contrato ${contrato1.code} ya existe (${contrato1.status})`);
  }

  async function upsertReview(contractId, reviewerId, rateeId, rating, body) {
    const { data: existing, error: selErr } = await supabase
      .from('gig_reviews')
      .select('id')
      .eq('contract_id', contractId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle();
    if (selErr) die('buscando review', selErr);
    if (existing) {
      log('skip', 'review ya existe');
      return;
    }
    const { error } = await supabase
      .from('gig_reviews')
      .insert({ tenant_id: tenantId, contract_id: contractId, reviewer_id: reviewerId, ratee_id: rateeId, rating, body });
    if (error) die('creando review', error);
    log('create', `review ${rating}★`);
  }

  await upsertReview(
    contrato1.id,
    altagraciaId,
    yeseniaId,
    5,
    'Yesenia captó el alma de la panadería. Los reels ya nos trajeron clientes nuevos el fin de semana. Puntual y clarísima para comunicar.',
  );
  await upsertReview(
    contrato1.id,
    yeseniaId,
    altagraciaId,
    5,
    'Doña Altagracia es un amor: brief claro, pago en garantía desde el día uno y libertad creativa. Ojalá todos los clientes fueran así.',
  );

  let contrato2 = await findContract(ramonId, luisId, 'Aftermovie del Festival Sabor Quisqueya');
  if (!contrato2) {
    const { data, error } = await supabase
      .from('gig_contracts')
      .insert({
        tenant_id: tenantId,
        gig_id: null,
        client_id: ramonId,
        creator_id: luisId,
        title: 'Aftermovie del Festival Sabor Quisqueya',
        scope: 'Video resumen de 90 segundos del festival + 5 clips verticales para redes. Entrega 5 días después del evento.',
        delivery_days: 5,
        amount_cents: 25000,
        currency: 'usd',
        fee_pct: 20,
        status: 'proposed',
        payment_mode: 'demo',
        created_at: daysAgo(2),
      })
      .select('id, code')
      .single();
    if (error) die('creando contrato 2', error);
    contrato2 = data;
    const { error: upErr } = await supabase
      .from('gig_contracts')
      .update({ status: 'funded', funded_at: daysAgo(1) })
      .eq('id', contrato2.id);
    if (upErr) die('contrato 2 → funded', upErr);
    log('create', `contrato ${data.code} (funded — en curso)`);
  } else {
    log('skip', `contrato ${contrato2.code} ya existe`);
  }

  // 7. Follows de la demo (María es la cuenta con la que se muestra) ---------
  await upsertFollow(tenantId, mariaId, 'listing', panaderiaId);
  await upsertFollow(tenantId, mariaId, 'listing', festivalId);
  await upsertFollow(tenantId, mariaId, 'profile', yeseniaId);
  await upsertFollow(tenantId, marisolId, 'listing', panaderiaId);
  await upsertFollow(tenantId, marisolId, 'listing', barberiaId);
  await upsertFollow(tenantId, yeseniaId, 'listing', festivalId);
  log('create', 'follows: María→panadería+festival+Yesenia · Marisol→panadería+barbería · Yesenia→festival');

  // Las cuentas con las que se hace la demo también siguen a la panadería y al
  // festival: su feed muestra la regla completa al entrar (orgánico de seguidos
  // + el post promocionado de la barbería que NO siguen). reycamila04 (cuenta
  // ajena) no se toca.
  for (const email of [
    'geovanny@demo.comunidadlatina.com',
    'carlos@demo.comunidadlatina.com',
    'manuelnavarro@insightsapps.tech',
  ]) {
    const u = await findUserByEmail(email);
    if (!u) continue;
    await upsertFollow(tenantId, u.id, 'listing', panaderiaId);
    await upsertFollow(tenantId, u.id, 'listing', festivalId);
    await upsertFollow(tenantId, u.id, 'profile', yeseniaId);
    log('create', `follows de demo para ${email}`);
  }

  // 8. Posts: personales, de entidad y UNO promocionado ----------------------
  await upsertPost(tenantId, {
    authorId: marisolId,
    body: 'El mangú de hoy me quedó de restaurante. Los domingos son sagrados. 🇩🇴',
    media: [pic('gente_feed', 0)].filter(Boolean),
    createdAt: daysAgo(0.2),
  });
  // Índices elegidos mirando las fotos (coherencia texto↔imagen):
  // 4 = hora dorada urbana · 5 = amigos con café · 2 = retrato de gato (lente).
  await upsertPost(tenantId, {
    authorId: marisolId,
    body: 'Atardecer saliendo del turno en el hospital. Queens tiene lo suyo.',
    media: [pic('gente_feed', 4)].filter(Boolean),
    createdAt: daysAgo(1.1),
  });
  await upsertPost(tenantId, {
    authorId: mariaId,
    body: 'Primera semana en el trabajo nuevo. Gracias a todos los que me dieron una mano por acá — esta comunidad vale oro. 🙏',
    media: [pic('gente_feed', 5)].filter(Boolean),
    createdAt: daysAgo(0.6),
  });
  await upsertPost(tenantId, {
    authorId: luisId,
    body: 'Probando el lente nuevo por el barrio. ¿Qué esquina de Queens debería filmar primero?',
    media: [pic('gente_feed', 2)].filter(Boolean),
    createdAt: daysAgo(1.8),
  });
  await upsertPost(tenantId, {
    authorId: mariaId,
    body: '¿Alguien conoce un buen mecánico de confianza por Corona? Es para un Corolla 2015 que hace un ruidito al frenar.',
    media: [],
    kind: 'question',
    createdAt: daysAgo(2.2),
  });

  // Posts de ENTIDAD (orgánicos → solo seguidores en el feed).
  await upsertPost(tenantId, {
    authorId: altagraciaId,
    entityListingId: panaderiaId,
    body: 'Mañana sábado horneamos doble tanda de pan de agua desde las 6. El que llega temprano se lo lleva tibio. ¡Los esperamos!',
    media: [pic('panaderia', 0)].filter(Boolean),
    createdAt: daysAgo(0.4),
  });
  await upsertPost(tenantId, {
    authorId: altagraciaId,
    entityListingId: panaderiaId,
    body: 'Nuevo en la vitrina: dulce de leche cortada como el de allá. Vengan a probarlo antes de que se acabe.',
    media: [pic('producto_comida', 2) ?? pic('panaderia', 1)].filter(Boolean),
    createdAt: daysAgo(1.5),
  });
  await upsertPost(tenantId, {
    authorId: ramonId,
    entityListingId: festivalId,
    body: 'Confirmado: habrá zona de juegos para los niños y 12 emprendedores del barrio con sus mesas. Entrada libre. 🎉',
    media: [pic('evento_festival', 0)].filter(Boolean),
    createdAt: daysAgo(0.9),
  });

  // Post PROMOCIONADO de la barbería (María NO la sigue → solo lo ve por la
  // campaña, con chip "Publicidad": la regla completa demostrada en el feed).
  const promoPostId = await upsertPost(tenantId, {
    authorId: ramonId,
    entityListingId: barberiaId,
    body: 'Semana del padre en El Nítido: corte + barba + cejas por $35. Reservá tu turno — se llenan rápido.',
    media: [pic('barberia', 0)].filter(Boolean),
    createdAt: daysAgo(0.3),
  });
  {
    const { data: existing, error: selErr } = await supabase
      .from('post_promotions')
      .select('id')
      .eq('post_id', promoPostId)
      .maybeSingle();
    if (selErr) die('buscando promoción', selErr);
    if (existing) {
      log('skip', 'promoción del post de la barbería ya existe');
    } else {
      const { error } = await supabase.from('post_promotions').insert({
        tenant_id: tenantId,
        post_id: promoPostId,
        buyer_id: ramonId,
        package: '7d',
        duration_days: 7,
        amount_cents: 1500,
        currency: 'usd',
        audience: { scope: 'all' },
        status: 'active',
        starts_at: daysAgo(0.3),
        ends_at: daysAhead(6.7),
      });
      if (error) die('creando promoción', error);
      log('create', 'campaña activa (7d) sobre el post de la barbería — chip "Publicidad"');
    }
  }

  console.log(`\n✔ Contenido demo listo (${summary.filter((s) => !s.startsWith('skip')).length} cambios, ${summary.filter((s) => s.startsWith('skip')).length} ya existían)\n`);
}

main().catch((e) => die('seed-demo-content', e));

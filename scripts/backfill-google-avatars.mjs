#!/usr/bin/env node
// Copia al bucket `avatars` la foto de Google de los perfiles que entraron con
// Google y quedaron sin foto visible (vacía, o la URL cruda de Google que el
// CSP bloquea). Misma regla que `src/lib/auth/google-avatar.ts`; si cambia una,
// cambia la otra. Idempotente: un perfil ya migrado apunta al Storage y se saltea.
//
//   node scripts/backfill-google-avatars.mjs --dry-run
//   node scripts/backfill-google-avatars.mjs

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const PAGE = 500;
const EXTENSION_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isGoogleAvatarUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com"))
    );
  } catch {
    return false;
  }
}

function upscale(value) {
  return /=s\d+(-c)?$/.test(value) ? value.replace(/=s\d+(-c)?$/, "=s256-c") : value;
}

function googleSource(user) {
  const meta = user.user_metadata ?? {};
  for (const key of ["avatar_url", "picture"]) {
    if (typeof meta[key] === "string" && isGoogleAvatarUrl(meta[key])) return upscale(meta[key]);
  }
  return null;
}

function hasGoogleIdentity(user) {
  const meta = user.app_metadata ?? {};
  const providers = Array.isArray(meta.providers) ? meta.providers : [];
  if (meta.provider === "google" || providers.includes("google")) return true;
  return (user.identities ?? []).some((i) => i.provider === "google");
}

async function download(source) {
  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "image/webp,image/jpeg,image/png" },
  });
  if (!response.ok) throw new Error(`http ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) throw new Error(`content-type ${contentType || "vacío"}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    throw new Error(`tamaño ${buffer.byteLength}`);
  }
  return { bytes: buffer, contentType, extension };
}

async function candidates() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, tenant_id, avatar_url")
      .or("avatar_url.is.null,avatar_url.eq.,avatar_url.ilike.%googleusercontent.com%")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`no se pudo listar perfiles: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows.filter((row) => !row.avatar_url || isGoogleAvatarUrl(row.avatar_url));
}

async function migrate(profile) {
  const { data, error } = await admin.auth.admin.getUserById(profile.id);
  if (error || !data?.user) return { status: "sin-usuario", detail: error?.message };
  const user = data.user;
  if (!hasGoogleIdentity(user)) return { status: "no-google" };
  const source = googleSource(user);
  if (!source) return { status: "sin-foto" };
  if (DRY_RUN) return { status: "migraría" };

  const avatar = await download(source);
  const path = `${profile.tenant_id}/${profile.id}/avatar-${Date.now()}.${avatar.extension}`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, avatar.bytes, { contentType: avatar.contentType, upsert: false, cacheControl: "31536000" });
  if (uploadError) throw new Error(`subida: ${uploadError.message}`);

  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const base = admin.from("profiles").update({ avatar_url: publicUrl }).eq("id", profile.id);
  const guarded =
    profile.avatar_url === null ? base.is("avatar_url", null) : base.eq("avatar_url", profile.avatar_url);
  const { data: updated, error: updateError } = await guarded.select("id");

  if (updateError || !updated?.length) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
    if (removeError) console.error(`  huérfano en ${path}: ${removeError.message}`);
    if (updateError) throw new Error(`update: ${updateError.message}`);
    return { status: "cambió-mientras-tanto" };
  }
  return { status: "migrado" };
}

const rows = await candidates();
console.log(`${rows.length} perfiles sin foto visible${DRY_RUN ? " (dry-run: no se escribe nada)" : ""}.`);

const tally = {};
for (const profile of rows) {
  let result;
  try {
    result = await migrate(profile);
  } catch (thrown) {
    result = { status: "error", detail: thrown instanceof Error ? thrown.message : String(thrown) };
  }
  tally[result.status] = (tally[result.status] ?? 0) + 1;
  if (result.status === "migrado" || result.status === "migraría" || result.status === "error") {
    console.log(`  ${profile.id}  ${result.status}${result.detail ? `  (${result.detail})` : ""}`);
  }
}

console.log("Resumen:", tally);
if (tally.error) process.exitCode = 1;

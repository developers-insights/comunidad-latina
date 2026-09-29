import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownStoragePrefix } from "@/lib/profile/storage-path";

// La foto de Google NO se guarda como URL de Google: el CSP (`img-src`) sólo
// permite el Storage de Supabase, así que `lh3.googleusercontent.com` no se
// dibuja nunca y el perfil quedaba con iniciales. Se copia al bucket `avatars`
// con el mismo path y el mismo formato de `avatar_url` que la subida manual.

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 4000;
const AVATAR_SIZE = 256;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type AdminClient = ReturnType<typeof createAdminClient>;

export function isGoogleAvatarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "googleusercontent.com" || host.endsWith(".googleusercontent.com");
}

export function isGoogleAvatarUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isGoogleAvatarHost(url.hostname);
  } catch {
    return false;
  }
}

/** `=s96-c` es el tamaño que Google manda por defecto: se pide uno que no se vea pixelado. */
export function upscaleGoogleAvatarUrl(value: string): string {
  if (/=s\d+(-c)?$/.test(value)) return value.replace(/=s\d+(-c)?$/, `=s${AVATAR_SIZE}-c`);
  return value;
}

export function googleAvatarSourceFrom(user: Pick<User, "user_metadata">): string | null {
  const meta = user.user_metadata ?? {};
  for (const key of ["avatar_url", "picture"] as const) {
    const value = meta[key];
    if (typeof value === "string" && isGoogleAvatarUrl(value)) return upscaleGoogleAvatarUrl(value);
  }
  return null;
}

/** "Sin avatar" incluye la URL cruda de Google que guardaba el alta vieja: nunca se vio. */
export function needsAvatarImport(current: string | null | undefined): boolean {
  return !current || isGoogleAvatarUrl(current);
}

export interface DownloadedAvatar {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

export type DownloadFailure = "host" | "http" | "type" | "size" | "network";

export async function downloadGoogleAvatar(
  source: string,
): Promise<{ ok: true; avatar: DownloadedAvatar } | { ok: false; reason: DownloadFailure }> {
  if (!isGoogleAvatarUrl(source)) return { ok: false, reason: "host" };

  let response: Response;
  try {
    // `redirect: "error"`: un 30x podría sacar el pedido del host permitido (SSRF).
    response = await fetch(source, {
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "image/webp,image/jpeg,image/png" },
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) return { ok: false, reason: "http" };

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) return { ok: false, reason: "type" };

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, reason: "size" };

  const bytes = await readCapped(response, MAX_BYTES);
  if (bytes === "network") return { ok: false, reason: "network" };
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: "size" };

  return { ok: true, avatar: { bytes, contentType, extension } };
}

// `content-length` puede faltar o mentir: el tope se cuenta sobre lo que llega.
async function readCapped(response: Response, max: number): Promise<Uint8Array | null | "network"> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return "network";
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export type AvatarImportResult =
  | "imported"
  | "has-avatar"
  | "no-source"
  | "no-profile"
  | "raced"
  | "failed";

/**
 * Best-effort: nunca lanza. Quien llama sigue el login pase lo que pase.
 * `tenantId` es el del perfil, no el de la request: el path lo valida la app
 * contra `{tenant_id}/{user_id}/` al guardar cambios de perfil.
 */
export async function importGoogleAvatarIfMissing(
  user: Pick<User, "id" | "user_metadata">,
  options: { admin?: AdminClient } = {},
): Promise<AvatarImportResult> {
  const source = googleAvatarSourceFrom(user);
  if (!source) return "no-source";

  try {
    const admin = options.admin ?? createAdminClient();

    const { data: profile, error: readError } = await admin
      .from("profiles")
      .select("tenant_id, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (readError) {
      console.error("[auth] avatar google: no se pudo leer el perfil", { code: readError.code });
      return "failed";
    }
    if (!profile) return "no-profile";
    if (!needsAvatarImport(profile.avatar_url)) return "has-avatar";

    const downloaded = await downloadGoogleAvatar(source);
    if (!downloaded.ok) {
      console.error("[auth] avatar google: descarga descartada", { reason: downloaded.reason });
      return "failed";
    }

    const { bytes, contentType, extension } = downloaded.avatar;
    const path = `${ownStoragePrefix(profile.tenant_id, user.id)}avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (uploadError) {
      console.error("[auth] avatar google: subida falló", { message: uploadError.message });
      return "failed";
    }

    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // Guarda optimista: si entre la lectura y acá la persona eligió su foto, no se pisa.
    const base = admin.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
    const guarded =
      profile.avatar_url === null ? base.is("avatar_url", null) : base.eq("avatar_url", profile.avatar_url);
    const { data: updated, error: updateError } = await guarded.select("id");

    if (updateError || !updated || updated.length === 0) {
      if (updateError) {
        console.error("[auth] avatar google: no se pudo guardar", { code: updateError.code });
      }
      const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
      if (removeError) {
        console.error("[auth] avatar google: quedó un archivo huérfano", { path, message: removeError.message });
      }
      return updateError ? "failed" : "raced";
    }

    return "imported";
  } catch (thrown) {
    console.error("[auth] avatar google: error inesperado", {
      message: thrown instanceof Error ? thrown.message : "desconocido",
    });
    return "failed";
  }
}

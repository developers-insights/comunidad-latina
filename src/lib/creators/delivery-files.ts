export const DELIVERY_BUCKET = "gig-deliveries";
export const MAX_FILES_PER_DELIVERY = 10;
export const MAX_DELIVERY_FILE_BYTES = 200 * 1024 * 1024;

// Tiene que ser el mismo conjunto que storage.buckets.allowed_mime_types de la
// 0167: si acá se acepta algo que el bucket rechaza, la subida falla después
// de haber pedido la URL firmada.
export const DELIVERY_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
];

export function isAllowedDeliveryFile(file: { name: string; size: number; type: string }): boolean {
  return (
    Number.isInteger(file.size) &&
    file.size > 0 &&
    file.size <= MAX_DELIVERY_FILE_BYTES &&
    DELIVERY_MIME_TYPES.includes(file.type)
  );
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const rawExt = dot >= 0 ? name.slice(dot + 1) : "";
  const hasExt = /^[A-Za-z0-9]{1,8}$/.test(rawExt);
  const base = slug(hasExt ? name.slice(0, dot) : name).slice(0, 80).replace(/-+$/g, "") || "archivo";
  return hasExt ? `${base}.${rawExt.toLowerCase()}` : base;
}

export function deliveryFolder(tenantId: string, contractId: string, version: number): string {
  return `${tenantId}/${contractId}/v${version}`;
}

export function deliveryObjectPath(
  tenantId: string,
  contractId: string,
  version: number,
  uuid: string,
  name: string,
): string {
  return `${deliveryFolder(tenantId, contractId, version)}/${uuid}-${safeFileName(name)}`;
}

export function displayNameFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

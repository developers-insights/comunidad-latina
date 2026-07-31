/**
 * CURRÍCULUM ADJUNTO — reglas del archivo y de su ruta en el bucket privado.
 *
 * Módulo PURO (sin I/O): lo comparten el navegador (valida antes de gastar
 * datos móviles subiendo 5 MB), la server action (vuelve a validar, porque el
 * cliente no es fuente de verdad) y los tests.
 *
 * ── POR QUÉ LA RUTA IMPORTA TANTO ──────────────────────────────────────────
 * `job-cvs` es un bucket PRIVADO y `job_applications.cv_url` guarda una RUTA,
 * no una URL. La forma `{tenant_id}/{applicant_id}/archivo` la exige un CHECK
 * en la base (`job_applications_cv_path`, 0047) y de ese CHECK depende que la
 * policy de Storage del empleador —"podés leer el CV de quien se postuló a tu
 * aviso"— no se convierta en un lector universal de currículums ajenos:
 * sin él, alguien publica un aviso, se postula a sí mismo apuntando `cv_url`
 * al CV de otra persona, y la policy se lo entrega.
 *
 * Por eso `buildCvPath` y `isOwnCvPath` son una sola verdad: lo que se arma
 * para subir es exactamente lo que se vuelve a verificar antes de persistir.
 *
 * El archivo NUNCA se sirve por `/object/public/` — la app pide una signed URL
 * de vida corta cada vez que alguien autorizado lo abre.
 */

/** Bucket privado creado en 0047. */
export const CV_BUCKET = "job-cvs";

/** 5 MB: el tope de la spec. Un currículum que pesa más es un PDF con fotos. */
export const MAX_CV_BYTES = 5 * 1024 * 1024;

/**
 * PDF o Word, y nada más. El valor es la extensión con la que se guarda: el
 * nombre original NO se reutiliza (puede traer el nombre y el teléfono de la
 * persona en el propio filename, que después viaja en la URL firmada).
 */
export const CV_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** `accept` del <input type="file">, derivado de la MISMA tabla de arriba. */
export const CV_ACCEPT = `${Object.keys(CV_MIME_TYPES).join(",")},.pdf,.doc,.docx`;

const EXTENSION_FALLBACK: Record<string, string> = {
  pdf: "pdf",
  doc: "doc",
  docx: "docx",
};

/**
 * MIME canónico por extensión — la vuelta de `CV_MIME_TYPES`.
 *
 * Se usa al SUBIR: el `Content-Type` del PUT es lo que Storage guarda como
 * `content_type` del objeto, y eso es exactamente lo que el servidor vuelve a
 * validar antes de persistir. Mandar el MIME derivado de la extensión (en vez
 * de un fallback fijo) evita que un `.docx` que el navegador declaró
 * `application/octet-stream` quede guardado como si fuera un PDF.
 */
export const CV_EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Extensión canónica de un archivo. Se mira el MIME primero y el nombre
 * después: Windows manda `.docx` como `application/octet-stream` con más
 * frecuencia de la que uno querría, y rechazar un CV válido por eso es
 * empujar a alguien que busca trabajo a abandonar el formulario.
 *
 * Ojo: esto es la puerta AMABLE (el navegador). La puerta REAL es el
 * `content_type` que Storage registró al recibir el objeto, y esa se chequea
 * en el servidor con `storage.info()` — ver `validateStoredCv`.
 */
export function cvExtension(mimeType: string, fileName: string): string | null {
  const byMime = CV_MIME_TYPES[mimeType.toLowerCase()];
  if (byMime) return byMime;

  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null;
  return EXTENSION_FALLBACK[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export type CvFileCheck =
  | { ok: true; extension: string }
  | { ok: false; code: "type" | "size" | "empty" };

/** Validación del archivo ELEGIDO, antes de subirlo. */
export function validateCvFile(file: {
  type: string;
  size: number;
  name: string;
}): CvFileCheck {
  if (file.size <= 0) return { ok: false, code: "empty" };
  if (file.size > MAX_CV_BYTES) return { ok: false, code: "size" };
  const extension = cvExtension(file.type, file.name);
  if (!extension) return { ok: false, code: "type" };
  return { ok: true, extension };
}

/**
 * Validación del archivo YA GUARDADO, con los metadatos que devolvió Storage.
 * Esta es la que manda: el `File.type` del navegador lo declara el cliente, el
 * `content_type` del objeto lo registró el servidor de Storage al recibirlo.
 *
 * Sin metadatos → NO pasa. Un objeto que no se puede describir no se persiste
 * como currículum de nadie.
 */
export function validateStoredCv(info: {
  size?: number | null;
  contentType?: string | null;
}): CvFileCheck {
  const size = typeof info.size === "number" ? info.size : null;
  const contentType = (info.contentType ?? "").split(";")[0]?.trim().toLowerCase();

  if (size === null || size <= 0) return { ok: false, code: "empty" };
  if (size > MAX_CV_BYTES) return { ok: false, code: "size" };

  const extension = contentType ? CV_MIME_TYPES[contentType] : undefined;
  if (!extension) return { ok: false, code: "type" };
  return { ok: true, extension };
}

/**
 * Ruta canónica: `{tenant_id}/{applicant_id}/cv-{uuid}.{ext}`.
 *
 * El nombre es un uuid y no el del archivo original: la signed URL lleva el
 * path adentro, y "Curriculum Maria Fernandez 1998 Washington Heights.pdf"
 * es información personal viajando en una URL que puede terminar pegada en un
 * chat. El nombre lindo se le devuelve al usuario en la UI, no en la ruta.
 */
export function buildCvPath(input: {
  tenantId: string;
  userId: string;
  extension: string;
  /** Inyectable para que el test sea determinista. */
  uuid?: string;
}): string {
  const uuid = input.uuid ?? crypto.randomUUID();
  return `${input.tenantId}/${input.userId}/cv-${uuid}.${input.extension}`;
}

/**
 * ¿Esta ruta pertenece al prefijo de esta persona en esta comunidad?
 *
 * Es la MISMA condición que el CHECK `job_applications_cv_path` y que la
 * policy `job_cvs_insert`. Se re-verifica en el servidor antes de persistir
 * porque el path llega desde el navegador: la policy de Storage ya rechazó
 * subir a un prefijo ajeno, pero nada impide MANDAR un path ajeno al hacer el
 * insert (el objeto existe, lo subió su dueño). El CHECK lo frena en la base;
 * esto lo frena antes, con un mensaje que se entiende.
 */
export function isOwnCvPath(path: string, tenantId: string, userId: string): boolean {
  const segments = path.split("/");
  if (segments.length < 3) return false;
  if (segments[0] !== tenantId || segments[1] !== userId) return false;
  const fileName = segments.slice(2).join("/");
  // Sin travesía ni segmentos vacíos: `a/b/../../otro` no es un nombre de archivo.
  if (fileName.length === 0 || fileName.includes("..")) return false;
  return segments.every((segment) => segment.length > 0);
}

// ---------------------------------------------------------------------------
// Enlaces de portafolio
// ---------------------------------------------------------------------------

/** Espejo de app.portfolio_links_ok (0047): 5 enlaces, 8–300 chars, http(s). */
export const MAX_PORTFOLIO_LINKS = 5;
export const PORTFOLIO_LINK_MIN_LENGTH = 8;
export const PORTFOLIO_LINK_MAX_LENGTH = 300;

export type PortfolioLinksCheck =
  | { ok: true; links: string[] }
  | { ok: false; code: "too-many" | "invalid" };

/**
 * Normaliza lo que escribió la persona: recorta espacios, tira los renglones
 * vacíos y valida cada enlace contra la MISMA regla del CHECK de la base.
 *
 * `javascript:` y `data:` quedan afuera por construcción (se exige http/https),
 * que es lo que hace que estos enlaces se puedan pintar como `<a href>` en la
 * pantalla del empleador sin abrir un XSS.
 */
export function normalizePortfolioLinks(raw: readonly string[]): PortfolioLinksCheck {
  const links = raw.map((value) => value.trim()).filter((value) => value.length > 0);

  if (links.length > MAX_PORTFOLIO_LINKS) return { ok: false, code: "too-many" };

  for (const link of links) {
    if (
      link.length < PORTFOLIO_LINK_MIN_LENGTH ||
      link.length > PORTFOLIO_LINK_MAX_LENGTH ||
      !/^https?:\/\//i.test(link)
    ) {
      return { ok: false, code: "invalid" };
    }
  }

  return { ok: true, links };
}

/** Etiqueta corta de un enlace: el dominio, que es lo único que se lee de un vistazo. */
export function portfolioLinkLabel(link: string): string {
  try {
    const url = new URL(link);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return link;
  }
}

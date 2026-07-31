import { describe, expect, it } from "vitest";
import {
  CV_ACCEPT,
  MAX_CV_BYTES,
  MAX_PORTFOLIO_LINKS,
  buildCvPath,
  cvExtension,
  isOwnCvPath,
  normalizePortfolioLinks,
  portfolioLinkLabel,
  validateCvFile,
  validateStoredCv,
} from "./cv";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("qué archivo se acepta como currículum", () => {
  it("acepta PDF y Word", () => {
    expect(validateCvFile({ type: PDF, size: 1000, name: "cv.pdf" })).toEqual({
      ok: true,
      extension: "pdf",
    });
    expect(validateCvFile({ type: "application/msword", size: 1000, name: "cv.doc" })).toEqual({
      ok: true,
      extension: "doc",
    });
    expect(validateCvFile({ type: DOCX, size: 1000, name: "cv.docx" })).toEqual({
      ok: true,
      extension: "docx",
    });
  });

  it("rechaza cualquier otro formato", () => {
    expect(validateCvFile({ type: "image/png", size: 1000, name: "foto.png" })).toEqual({
      ok: false,
      code: "type",
    });
    expect(validateCvFile({ type: "text/html", size: 1000, name: "cv.html" })).toEqual({
      ok: false,
      code: "type",
    });
    expect(
      validateCvFile({ type: "application/x-msdownload", size: 1000, name: "cv.exe" }),
    ).toEqual({ ok: false, code: "type" });
  });

  it("rechaza por encima de 5 MB, y acepta justo en el borde", () => {
    expect(validateCvFile({ type: PDF, size: MAX_CV_BYTES, name: "cv.pdf" })).toEqual({
      ok: true,
      extension: "pdf",
    });
    expect(validateCvFile({ type: PDF, size: MAX_CV_BYTES + 1, name: "cv.pdf" })).toEqual({
      ok: false,
      code: "size",
    });
  });

  it("rechaza el archivo vacío", () => {
    expect(validateCvFile({ type: PDF, size: 0, name: "cv.pdf" })).toEqual({
      ok: false,
      code: "empty",
    });
  });

  it("salva el .docx que Windows manda como octet-stream, mirando la extensión", () => {
    expect(cvExtension("application/octet-stream", "Curriculum.docx")).toBe("docx");
    expect(cvExtension("", "curriculum.PDF")).toBe("pdf");
    // Pero la extensión sola no alcanza para colar otra cosa.
    expect(cvExtension("application/octet-stream", "virus.exe")).toBeNull();
    expect(cvExtension("application/octet-stream", "sin-extension")).toBeNull();
  });

  it("el accept del input sale de la misma tabla de MIME", () => {
    expect(CV_ACCEPT).toContain(PDF);
    expect(CV_ACCEPT).toContain(".docx");
    expect(CV_ACCEPT).not.toContain("image/");
  });
});

describe("validación del archivo YA guardado (la que manda)", () => {
  it("acepta lo que Storage registró como PDF o Word", () => {
    expect(validateStoredCv({ size: 2048, contentType: PDF })).toEqual({
      ok: true,
      extension: "pdf",
    });
    // Storage suele devolver el charset pegado; no invalida el tipo.
    expect(validateStoredCv({ size: 2048, contentType: "application/pdf; charset=binary" })).toEqual(
      { ok: true, extension: "pdf" },
    );
  });

  it("rechaza el objeto sin metadatos: lo que no se puede describir no se guarda", () => {
    expect(validateStoredCv({ size: null, contentType: PDF })).toEqual({
      ok: false,
      code: "empty",
    });
    expect(validateStoredCv({ size: 100, contentType: null })).toEqual({
      ok: false,
      code: "type",
    });
    expect(validateStoredCv({})).toEqual({ ok: false, code: "empty" });
  });

  it("rechaza el archivo que el navegador declaró chico y subió grande", () => {
    expect(validateStoredCv({ size: MAX_CV_BYTES + 1, contentType: PDF })).toEqual({
      ok: false,
      code: "size",
    });
  });

  it("rechaza el contenido que no es un currículum aunque el nombre diga .pdf", () => {
    expect(validateStoredCv({ size: 1000, contentType: "text/html" })).toEqual({
      ok: false,
      code: "type",
    });
    expect(validateStoredCv({ size: 1000, contentType: "application/octet-stream" })).toEqual({
      ok: false,
      code: "type",
    });
  });
});

describe("la ruta del CV dentro del bucket privado", () => {
  it("arma {tenant}/{postulante}/cv-{uuid}.{ext}", () => {
    expect(
      buildCvPath({ tenantId: TENANT, userId: USER, extension: "pdf", uuid: "abc" }),
    ).toBe(`${TENANT}/${USER}/cv-abc.pdf`);
  });

  it("no reutiliza el nombre original: en la URL firmada no viaja el nombre de nadie", () => {
    const path = buildCvPath({
      tenantId: TENANT,
      userId: USER,
      extension: "pdf",
      uuid: "abc",
    });
    expect(path).not.toContain("Maria");
    expect(path.split("/").at(-1)).toMatch(/^cv-[\w-]+\.pdf$/);
  });

  it("lo que arma buildCvPath pasa isOwnCvPath (una sola verdad)", () => {
    const path = buildCvPath({ tenantId: TENANT, userId: USER, extension: "docx" });
    expect(isOwnCvPath(path, TENANT, USER)).toBe(true);
  });

  it("rechaza el CV de OTRA persona — el ataque que el CHECK de 0047 existe para frenar", () => {
    const ajeno = `${TENANT}/${OTHER}/cv-abc.pdf`;
    expect(isOwnCvPath(ajeno, TENANT, USER)).toBe(false);
  });

  it("rechaza el prefijo de otra comunidad", () => {
    const otroTenant = `${OTHER}/${USER}/cv-abc.pdf`;
    expect(isOwnCvPath(otroTenant, TENANT, USER)).toBe(false);
  });

  it("rechaza travesía de directorios y segmentos vacíos", () => {
    expect(isOwnCvPath(`${TENANT}/${USER}/../${OTHER}/cv.pdf`, TENANT, USER)).toBe(false);
    expect(isOwnCvPath(`${TENANT}/${USER}/`, TENANT, USER)).toBe(false);
    expect(isOwnCvPath(`${TENANT}//cv.pdf`, TENANT, USER)).toBe(false);
    expect(isOwnCvPath(`${TENANT}/${USER}`, TENANT, USER)).toBe(false);
    expect(isOwnCvPath("", TENANT, USER)).toBe(false);
  });

  it("no se deja engañar por un prefijo que solo EMPIEZA igual", () => {
    expect(isOwnCvPath(`${TENANT}/${USER}-otro/cv.pdf`, TENANT, USER)).toBe(false);
  });
});

describe("enlaces de portafolio", () => {
  it("limpia espacios y renglones vacíos", () => {
    expect(
      normalizePortfolioLinks(["  https://midominio.com  ", "", "   ", "https://otro.com"]),
    ).toEqual({ ok: true, links: ["https://midominio.com", "https://otro.com"] });
  });

  it("acepta hasta 5 y rechaza el sexto", () => {
    const cinco = Array.from({ length: MAX_PORTFOLIO_LINKS }, (_, i) => `https://sitio${i}.com`);
    expect(normalizePortfolioLinks(cinco).ok).toBe(true);
    expect(normalizePortfolioLinks([...cinco, "https://sexto.com"])).toEqual({
      ok: false,
      code: "too-many",
    });
  });

  it("exige http(s): javascript: y data: no entran", () => {
    expect(normalizePortfolioLinks(["javascript:alert(1)"])).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(normalizePortfolioLinks(["data:text/html;base64,PHNjcmlwdD4="])).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(normalizePortfolioLinks(["ftp://archivos.com/cv"])).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("respeta los topes de largo del CHECK (8 a 300, inclusive)", () => {
    // 7 caracteres: matchea el esquema pero no llega al mínimo.
    expect(normalizePortfolioLinks(["http://"])).toEqual({ ok: false, code: "invalid" });
    // 8 justos: el borde de abajo SÍ entra, igual que en la base.
    expect(normalizePortfolioLinks(["http://a"])).toEqual({ ok: true, links: ["http://a"] });
    expect(normalizePortfolioLinks([`https://x.com/${"a".repeat(300)}`])).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(normalizePortfolioLinks(["http://ab.co"]).ok).toBe(true);
  });

  it("la etiqueta muestra el dominio, no la URL entera", () => {
    expect(portfolioLinkLabel("https://www.behance.net/mariaf")).toBe("behance.net/mariaf");
    expect(portfolioLinkLabel("https://midominio.com/")).toBe("midominio.com");
    expect(portfolioLinkLabel("no-es-una-url")).toBe("no-es-una-url");
  });
});

import { describe, expect, it } from "vitest";
import {
  CONTRACT_TEMPLATE_VERSION,
  REVISIONS_MAX,
  buildContractText,
  normalizeRevisions,
  normalizeUsageRights,
  validateSignatureInput,
  type ContractTerms,
} from "./contract-terms";

const TERMS: ContractTerms = {
  code: "CL-CM-2026-000012",
  termsVersion: 1,
  communityName: "Comunidad Latina",
  clientName: "Panadería La Espiga",
  creatorName: "Ana Rivas",
  title: "4 videos promocionales",
  scope: "4 videos verticales de 30 segundos, editados y con música.",
  deliveryDays: 10,
  revisionsIncluded: 2,
  usageRights: "Redes sociales · 90 días",
  amountCents: 100_000,
  currency: "usd",
  feePct: 20,
  platformFeeCents: 20_000,
  creatorNetCents: 80_000,
};

describe("texto del contrato", () => {
  it("es determinístico: mismas condiciones, mismo texto", () => {
    expect(buildContractText(TERMS)).toBe(buildContractText({ ...TERMS }));
  });

  it("incluye las partes, los montos del contrato y la versión de la plantilla", () => {
    const text = buildContractText(TERMS);
    expect(text).toContain("CL-CM-2026-000012");
    expect(text).toContain("Panadería La Espiga");
    expect(text).toContain("Ana Rivas");
    expect(text).toContain("$1,000");
    expect(text).toContain("$200");
    expect(text).toContain("$800");
    expect(text).toContain("20%");
    expect(text).toContain("Redes sociales · 90 días");
    expect(text).toContain("72 horas");
    expect(text).toContain(CONTRACT_TEMPLATE_VERSION);
  });

  it("cambiar cualquier condición cambia el texto (y por ende lo que se firma)", () => {
    const base = buildContractText(TERMS);
    expect(buildContractText({ ...TERMS, amountCents: 100_100 })).not.toBe(base);
    expect(buildContractText({ ...TERMS, revisionsIncluded: 3 })).not.toBe(base);
    expect(buildContractText({ ...TERMS, usageRights: "Web · 1 año" })).not.toBe(base);
    expect(buildContractText({ ...TERMS, termsVersion: 2 })).not.toBe(base);
  });

  it("sin revisiones incluidas lo dice explícitamente", () => {
    expect(buildContractText({ ...TERMS, revisionsIncluded: 0 })).toContain("no incluye revisiones");
  });
});

describe("normalizeRevisions", () => {
  it("acepta enteros de 0 al máximo", () => {
    expect(normalizeRevisions(0)).toBe(0);
    expect(normalizeRevisions(REVISIONS_MAX)).toBe(REVISIONS_MAX);
    expect(normalizeRevisions("2")).toBe(2);
  });

  it("rechaza lo que no es un entero en rango", () => {
    expect(normalizeRevisions(-1)).toBeNull();
    expect(normalizeRevisions(REVISIONS_MAX + 1)).toBeNull();
    expect(normalizeRevisions(1.5)).toBeNull();
    expect(normalizeRevisions("dos")).toBeNull();
  });
});

describe("normalizeUsageRights", () => {
  it("recorta espacios y exige algo escrito", () => {
    expect(normalizeUsageRights("  Redes sociales · 90 días ")).toBe("Redes sociales · 90 días");
    expect(normalizeUsageRights("   ")).toBeNull();
    expect(normalizeUsageRights("x".repeat(121))).toBeNull();
  });
});

describe("validateSignatureInput", () => {
  const png = `data:image/png;base64,${"A".repeat(400)}`;

  it("acepta nombre y apellido, una firma dibujada y la casilla tildada", () => {
    expect(validateSignatureInput({ legalName: "Ana Rivas", signaturePng: png, accepted: true })).toEqual({
      ok: true,
      legalName: "Ana Rivas",
    });
  });

  it("colapsa espacios del nombre", () => {
    const result = validateSignatureInput({ legalName: "  Ana   María  Rivas ", signaturePng: png, accepted: true });
    expect(result).toEqual({ ok: true, legalName: "Ana María Rivas" });
  });

  it("pide nombre y apellido", () => {
    expect(validateSignatureInput({ legalName: "Ana", signaturePng: png, accepted: true })).toEqual({
      ok: false,
      reason: "name",
    });
  });

  it("rechaza una firma vacía, que no sea PNG o que sea enorme", () => {
    expect(validateSignatureInput({ legalName: "Ana Rivas", signaturePng: "", accepted: true })).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(
      validateSignatureInput({ legalName: "Ana Rivas", signaturePng: "data:image/svg+xml;base64,AAAA", accepted: true }),
    ).toEqual({ ok: false, reason: "signature" });
    expect(
      validateSignatureInput({
        legalName: "Ana Rivas",
        signaturePng: `data:image/png;base64,${"A".repeat(300_000)}`,
        accepted: true,
      }),
    ).toEqual({ ok: false, reason: "signature" });
  });

  it("sin la casilla tildada no hay firma", () => {
    expect(validateSignatureInput({ legalName: "Ana Rivas", signaturePng: png, accepted: false })).toEqual({
      ok: false,
      reason: "consent",
    });
  });
});

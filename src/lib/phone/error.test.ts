import { describe, expect, it } from "vitest";
import {
  PHONE_REQUIRED_COPY,
  PHONE_REQUIRED_TOKEN,
  isPhoneRequiredError,
  phoneRequiredCopy,
} from "./error";
import { errorDeVideoDeLaBase } from "@/lib/media/listing-video-server";
import { codigoDeLlamada } from "@/lib/calls/errores";

const DE_LA_BASE = {
  message: `${PHONE_REQUIRED_TOKEN}: para publicar y escribir, primero confirmá tu teléfono.`,
  code: "P0001",
};

describe("el error del trigger de teléfono (0181)", () => {
  it("se reconoce por el token y se traduce al copy de la app", () => {
    expect(isPhoneRequiredError(DE_LA_BASE)).toBe(true);
    expect(phoneRequiredCopy(DE_LA_BASE)).toBe(PHONE_REQUIRED_COPY);
  });

  it("no confunde otros errores ni explota con nulos", () => {
    expect(phoneRequiredCopy({ message: "ACCOUNT_SUSPENDED: nope" })).toBeNull();
    expect(phoneRequiredCopy({ message: "duplicate key" })).toBeNull();
    expect(phoneRequiredCopy(null)).toBeNull();
    expect(phoneRequiredCopy(undefined)).toBeNull();
    expect(phoneRequiredCopy({})).toBeNull();
  });

  it("editar el texto de un aviso lo traduce igual que el alta", () => {
    expect(errorDeVideoDeLaBase(DE_LA_BASE)).toBe(PHONE_REQUIRED_COPY);
    expect(errorDeVideoDeLaBase({ message: "otra cosa" })).toBeNull();
  });

  it("una llamada cortada por teléfono devuelve su propio código", () => {
    expect(codigoDeLlamada(DE_LA_BASE)).toBe("phone-required");
  });
});

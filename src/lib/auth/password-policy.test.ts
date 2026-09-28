import { describe, expect, it } from "vitest";
import {
  PASSWORD_COPY,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordValid,
  passwordProblem,
  passwordRuleResults,
} from "./password-policy";

describe("passwordProblem", () => {
  it("acepta exactamente el mínimo con mayúscula y número", () => {
    const password = "Abcdefg1";
    expect(password).toHaveLength(PASSWORD_MIN_LENGTH);
    expect(passwordProblem(password)).toBeNull();
    expect(isPasswordValid(password)).toBe(true);
  });

  it("rechaza una menos que el mínimo", () => {
    expect(passwordProblem("Abcdef1")).toBe(PASSWORD_COPY.short);
  });

  it("rechaza vacía con el mensaje de largo", () => {
    expect(passwordProblem("")).toBe(PASSWORD_COPY.short);
  });

  it("rechaza sin mayúscula", () => {
    expect(passwordProblem("abcdefg1")).toBe(PASSWORD_COPY.uppercase);
  });

  it("rechaza sin número", () => {
    expect(passwordProblem("Abcdefgh")).toBe(PASSWORD_COPY.number);
  });

  it("una mayúscula acentuada cuenta como mayúscula", () => {
    expect(passwordProblem("ñandú12345Ñ")).toBeNull();
    expect(passwordProblem("éxito2026É")).toBeNull();
    expect(passwordRuleResults("ñandúÑ").uppercase).toBe(true);
  });

  it("una minúscula acentuada NO cuenta como mayúscula", () => {
    expect(passwordProblem("ñandú12345")).toBe(PASSWORD_COPY.uppercase);
  });

  it("acepta exactamente el máximo", () => {
    const password = `A1${"a".repeat(PASSWORD_MAX_LENGTH - 2)}`;
    expect(password).toHaveLength(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(password)).toBeNull();
  });

  it("rechaza una más que el máximo", () => {
    expect(passwordProblem(`A1${"a".repeat(PASSWORD_MAX_LENGTH - 1)}`)).toBe(
      PASSWORD_COPY.long,
    );
  });

  it("el máximo se mide en bytes: 40 eñes son 80 bytes y bcrypt las cortaría", () => {
    const password = `A1${"ñ".repeat(40)}`;
    expect(password.length).toBeLessThan(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(password)).toBe(PASSWORD_COPY.long);
  });

  it("un dígito no ASCII no cuenta como número", () => {
    expect(passwordProblem("Abcdefgh٣")).toBe(PASSWORD_COPY.number);
  });
});

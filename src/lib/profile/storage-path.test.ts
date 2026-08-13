import { describe, expect, it } from "vitest";
import { isWithinOwnStoragePrefix, ownStoragePrefix } from "./storage-path";

/**
 * ── QUÉ CUIDA ESTE TEST ──────────────────────────────────────────────────────
 * Que nadie pueda guardar en su perfil (portada o avatar) el path de Storage
 * de OTRA persona o de OTRO tenant. `updateProfileAction` confía en
 * `isWithinOwnStoragePrefix` para las dos fotos — este test es la prueba de
 * que esa confianza está bien puesta.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const OTHER_USER = "33333333-3333-3333-3333-333333333333";
const OTHER_TENANT = "44444444-4444-4444-4444-444444444444";

describe("ownStoragePrefix", () => {
  it("arma {tenant_id}/{user_id}/ — el path canónico de 0012", () => {
    expect(ownStoragePrefix(TENANT, USER)).toBe(`${TENANT}/${USER}/`);
  });
});

describe("isWithinOwnStoragePrefix", () => {
  it("acepta un archivo propio, subido en la propia carpeta", () => {
    expect(
      isWithinOwnStoragePrefix(`${TENANT}/${USER}/avatar-1723582400000.jpg`, TENANT, USER),
    ).toBe(true);
  });

  it("acepta cualquier nombre de archivo propio (portada o avatar, da igual el prefijo del nombre)", () => {
    expect(
      isWithinOwnStoragePrefix(`${TENANT}/${USER}/cover-1723582400000.webp`, TENANT, USER),
    ).toBe(true);
  });

  it("rechaza la carpeta de otra persona del MISMO tenant", () => {
    expect(
      isWithinOwnStoragePrefix(`${TENANT}/${OTHER_USER}/avatar-1.jpg`, TENANT, USER),
    ).toBe(false);
  });

  it("rechaza un path de OTRO tenant, aunque el user_id coincida", () => {
    expect(
      isWithinOwnStoragePrefix(`${OTHER_TENANT}/${USER}/avatar-1.jpg`, TENANT, USER),
    ).toBe(false);
  });

  it("rechaza un intento de recorrido de directorios aunque arranque con el prefijo propio", () => {
    expect(
      isWithinOwnStoragePrefix(`${TENANT}/${USER}/../${OTHER_USER}/avatar-1.jpg`, TENANT, USER),
    ).toBe(false);
  });

  it("rechaza un string vacío o sin relación con el prefijo", () => {
    expect(isWithinOwnStoragePrefix("", TENANT, USER)).toBe(false);
    expect(isWithinOwnStoragePrefix("algo-random.jpg", TENANT, USER)).toBe(false);
  });

  it("rechaza el prefijo ajeno aunque sea sólo un prefijo MÁS LARGO por coincidencia textual", () => {
    // user_id que empieza igual que USER pero es otro id — startsWith del
    // prefijo COMPLETO (con user_id entero) evita este falso positivo.
    const near = `${USER}9`;
    expect(isWithinOwnStoragePrefix(`${TENANT}/${near}/avatar-1.jpg`, TENANT, USER)).toBe(false);
  });
});

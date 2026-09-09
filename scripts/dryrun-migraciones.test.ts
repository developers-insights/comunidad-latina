import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporales: string[] = [];
const script = resolve("scripts/dryrun-migraciones.mjs");

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("dryrun-migraciones", () => {
  it("prioriza process.env y no exige leer .env.local", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dryrun-env-"));
    temporales.push(cwd);

    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, SUPABASE_DB_PASSWORD: "valor-de-prueba" },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Pasá al menos un archivo");
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).not.toContain(".env.local");
  });

  it("sin credenciales falla cerrado sin intentar leer archivos de secretos", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dryrun-no-env-"));
    temporales.push(cwd);
    const env = { ...process.env };
    delete env.SUPABASE_DB_PASSWORD;
    delete env.DATABASE_URL;

    const result = spawnSync(process.execPath, [script, "inexistente.sql"], {
      cwd,
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Falta SUPABASE_DB_PASSWORD o DATABASE_URL");
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).not.toContain(".env.local");
  });
});

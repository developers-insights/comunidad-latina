import { describe, expect, it, vi } from "vitest";

vi.stubEnv("RLS_ENUMERATOR_SKIP_MAIN", "1");

describe("superficies no-public del enumerador", () => {
  it("falla si chat-media no existe o le falta un comando", async () => {
    const { auditStorage } = await import("./rls-enumerator.mjs");
    const policies = ["SELECT", "INSERT", "UPDATE"].map((cmd) => ({
      schemaname: "storage",
      tablename: "objects",
      cmd,
      qual: "bucket_id = 'chat-media'",
      with_check: "bucket_id = 'chat-media'",
    }));

    expect(auditStorage([], policies, ["chat-media"])).toContain(
      'Storage: falta el bucket "chat-media".',
    );
    expect(auditStorage(["chat-media"], policies, ["chat-media"])).toContain(
      'Storage: sin policy DELETE para el bucket "chat-media" en storage.objects.',
    );
  });

  it("acepta chat-media sólo con las cuatro operaciones cubiertas", async () => {
    const { auditStorage } = await import("./rls-enumerator.mjs");
    const policies = ["SELECT", "INSERT", "UPDATE", "DELETE"].map((cmd) => ({
      schemaname: "storage",
      tablename: "objects",
      cmd,
      qual: "bucket_id = 'chat-media'",
      with_check: "bucket_id = 'chat-media'",
    }));

    expect(auditStorage(["chat-media"], policies, ["chat-media"])).toEqual([]);
  });

  it("exige las cuatro policies privadas de realtime.messages", async () => {
    const { auditRealtime } = await import("./rls-enumerator.mjs");
    const completas = [
      ["escribiendo_directo_recibir", "SELECT"],
      ["escribiendo_directo_emitir", "INSERT"],
      ["escribiendo_grupo_recibir", "SELECT"],
      ["escribiendo_grupo_emitir", "INSERT"],
    ].map(([policyname, cmd]) => ({
      schemaname: "realtime",
      tablename: "messages",
      policyname,
      cmd,
      roles: ["authenticated"],
      qual: "extension = 'broadcast'::text",
      with_check: "extension = 'broadcast'::text",
    }));

    expect(auditRealtime(completas)).toEqual([]);
    expect(auditRealtime(completas.slice(0, 3))).toContain(
      "Realtime: falta escribiendo_grupo_emitir (INSERT) en realtime.messages.",
    );
  });
});

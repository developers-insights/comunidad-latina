import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: { data: null as unknown, error: null as unknown },
  upload: vi.fn(),
  remove: vi.fn(),
  updateResult: { data: [{ id: "user-1" }] as unknown, error: null as unknown },
  update: vi.fn(),
  guard: vi.fn(),
}));

function adminStub() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => mocks.profile }) }),
      update: (values: unknown) => {
        mocks.update(values);
        const chain = {
          eq: (column: string, value: unknown) => {
            if (column !== "id") mocks.guard("eq", column, value);
            return chain;
          },
          is: (column: string, value: unknown) => {
            mocks.guard("is", column, value);
            return chain;
          },
          select: async () => mocks.updateResult,
        };
        return chain;
      },
    }),
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminStub() }));

import {
  downloadGoogleAvatar,
  googleAvatarSourceFrom,
  importGoogleAvatarIfMissing,
  upscaleGoogleAvatarUrl,
} from "./google-avatar";

const GOOGLE_PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";

function user(picture: string | null = GOOGLE_PHOTO) {
  return { id: "user-1", user_metadata: picture ? { avatar_url: picture } : {} };
}

function imageResponse(type = "image/jpeg", bytes = 128, extra: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": type, ...extra },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async () => imageResponse());
  vi.stubGlobal("fetch", fetchMock);
  mocks.profile = { data: { tenant_id: "tenant-a", avatar_url: null }, error: null };
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.updateResult = { data: [{ id: "user-1" }], error: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fuente de la foto", () => {
  it("pide la versión de 256px", () => {
    expect(upscaleGoogleAvatarUrl(GOOGLE_PHOTO)).toBe("https://lh3.googleusercontent.com/a/ACg8ocK=s256-c");
  });

  it("ignora una foto que no es de Google", () => {
    expect(googleAvatarSourceFrom(user("https://evil.example/a.jpg"))).toBeNull();
    expect(googleAvatarSourceFrom(user("https://googleusercontent.com.evil.example/a.jpg"))).toBeNull();
  });
});

describe("downloadGoogleAvatar", () => {
  it("host no permitido → ni siquiera se pide", async () => {
    const result = await downloadGoogleAvatar("https://169.254.169.254/latest/meta-data");
    expect(result).toEqual({ ok: false, reason: "host" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("http (no https) de Google tampoco", async () => {
    const result = await downloadGoogleAvatar("http://lh3.googleusercontent.com/a");
    expect(result).toEqual({ ok: false, reason: "host" });
  });

  it("no sigue redirecciones", async () => {
    await downloadGoogleAvatar(GOOGLE_PHOTO);
    expect(fetchMock).toHaveBeenCalledWith(GOOGLE_PHOTO, expect.objectContaining({ redirect: "error" }));
  });

  it("content-type que no es imagen → se descarta", async () => {
    fetchMock.mockResolvedValue(imageResponse("text/html"));
    expect(await downloadGoogleAvatar(GOOGLE_PHOTO)).toEqual({ ok: false, reason: "type" });
  });

  it("SVG se descarta (no es un formato de la subida normal)", async () => {
    fetchMock.mockResolvedValue(imageResponse("image/svg+xml"));
    expect(await downloadGoogleAvatar(GOOGLE_PHOTO)).toEqual({ ok: false, reason: "type" });
  });

  it("más de 2 MB → se descarta aunque no declare content-length", async () => {
    fetchMock.mockResolvedValue(imageResponse("image/jpeg", 2 * 1024 * 1024 + 1));
    expect(await downloadGoogleAvatar(GOOGLE_PHOTO)).toEqual({ ok: false, reason: "size" });
  });

  it("content-length declarado de más → se corta sin leer", async () => {
    fetchMock.mockResolvedValue(imageResponse("image/jpeg", 10, { "content-length": "99999999" }));
    expect(await downloadGoogleAvatar(GOOGLE_PHOTO)).toEqual({ ok: false, reason: "size" });
  });

  it("error de red → falla sin lanzar", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await downloadGoogleAvatar(GOOGLE_PHOTO)).toEqual({ ok: false, reason: "network" });
  });
});

describe("importGoogleAvatarIfMissing", () => {
  it("perfil sin foto → sube al prefijo propio y guarda la URL pública del Storage", async () => {
    expect(await importGoogleAvatarIfMissing(user())).toBe("imported");

    const [path, , options] = mocks.upload.mock.calls[0];
    expect(path).toMatch(/^tenant-a\/user-1\/avatar-\d+\.jpg$/);
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(mocks.update).toHaveBeenCalledWith({
      avatar_url: expect.stringMatching(
        /^https:\/\/ref\.supabase\.co\/storage\/v1\/object\/public\/avatars\/tenant-a\/user-1\/avatar-\d+\.jpg$/,
      ),
    });
    expect(mocks.guard).toHaveBeenCalledWith("is", "avatar_url", null);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c",
      expect.anything(),
    );
  });

  it("perfil con una foto elegida → no se toca", async () => {
    mocks.profile = {
      data: {
        tenant_id: "tenant-a",
        avatar_url: "https://ref.supabase.co/storage/v1/object/public/avatars/tenant-a/user-1/avatar-1.jpg",
      },
      error: null,
    };

    expect(await importGoogleAvatarIfMissing(user())).toBe("has-avatar");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("perfil con la URL cruda de Google (alta vieja) → se reemplaza, con guarda sobre ese valor", async () => {
    mocks.profile = { data: { tenant_id: "tenant-a", avatar_url: GOOGLE_PHOTO }, error: null };

    expect(await importGoogleAvatarIfMissing(user())).toBe("imported");
    expect(mocks.guard).toHaveBeenCalledWith("eq", "avatar_url", GOOGLE_PHOTO);
  });

  it("la persona eligió foto entre la lectura y el guardado → no se pisa y se borra lo subido", async () => {
    mocks.updateResult = { data: [], error: null };

    expect(await importGoogleAvatarIfMissing(user())).toBe("raced");
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringMatching(/^tenant-a\/user-1\//)]);
  });

  it("descarga inválida → falla sin subir nada y sin lanzar", async () => {
    fetchMock.mockResolvedValue(imageResponse("text/html"));

    expect(await importGoogleAvatarIfMissing(user())).toBe("failed");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("subida fallida → falla sin tocar el perfil", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "quota" } });

    expect(await importGoogleAvatarIfMissing(user())).toBe("failed");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sin foto de Google en la metadata → no hace nada", async () => {
    expect(await importGoogleAvatarIfMissing(user(null))).toBe("no-source");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

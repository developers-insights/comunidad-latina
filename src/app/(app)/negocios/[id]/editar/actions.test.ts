import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * EDITAR LA PÁGINA DE UN NEGOCIO — lo que estas actions tienen que impedir
 * =============================================================================
 *
 * Las dos escrituras terminan en una RPC `security definer` que revalida el
 * permiso adentro de la base (0127), así que lo que se prueba acá NO es la
 * autorización —esa no vive en TypeScript— sino las tres cosas que sí decide
 * este archivo y que la base no puede decidir por él:
 *
 *   1. que un archivo que no es una foto (o que pesa de más) no llegue nunca
 *      a tocar el bucket;
 *   2. que la foto se suba SIEMPRE bajo `{tenant}/{listing}/`, que es el
 *      prefijo que la policy de Storage y la RPC vuelven a exigir;
 *   3. que los topes de largo y de cantidad se expliquen en español en vez de
 *      volver como un 23514 de Postgres.
 *
 * Y una cuarta que es de plata y de basura: cuando algo falla DESPUÉS de subir,
 * el objeto recién subido se borra. Si no, queda ocupando el bucket sin que
 * ninguna fila lo apunte — invisible para siempre.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  registerUploadedMedia: vi.fn(),
  revalidatePath: vi.fn(),
  metadata: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/integrity/source-host", () => ({
  currentSourceHost: async () => "comunidadlatina.test",
}));
vi.mock("@/lib/integrity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrity")>()),
  registerUploadedMedia: mocks.registerUploadedMedia,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  }),
}));
vi.mock("sharp", () => ({
  default: () => {
    const pipeline = {
      metadata: mocks.metadata,
      rotate: () => pipeline,
      resize: () => pipeline,
      webp: () => pipeline,
      toBuffer: mocks.toBuffer,
    };
    return pipeline;
  },
}));

import { INTEGRITY_REASONS } from "@/lib/integrity";
import { MAX_FOTO_BYTES, MAX_SERVICIOS } from "@/lib/negocios/pagina";
import { EDITAR_PAGINA_INICIAL } from "./estado";
import {
  guardarPaginaDeNegocioAction,
  quitarFotoDeNegocioAction,
  subirFotoDeNegocioAction,
} from "./actions";

const TENANT = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

/** Cliente del usuario: sólo tiene que contestar la RPC y la lectura de fotos. */
function clienteConRpc() {
  return {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { logo_path: null, cover_path: null },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function guardOk() {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "dominicanos", locale: "es" },
    supabase: clienteConRpc(),
    user: { id: USER },
  });
}

/** FormData del formulario de datos, con los valores por defecto sanos. */
function datos(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const base: Record<string, string> = {
    listingId: LISTING,
    title: "Constructora Sarmiento",
    description: "Trabajos de albañilería en el Bronx.",
    category: "servicios",
    areaLabel: "Bronx",
    phone: "",
    whatsapp: "",
    website: "",
    address: "",
    services: JSON.stringify(["Techos", "Pisos"]),
    ...overrides,
  };
  for (const [clave, valor] of Object.entries(base)) form.append(clave, valor);
  return form;
}

/** FormData de la subida, con un archivo de mentira del tipo y peso que se pida. */
function subida(
  { tipo = "logo", mime = "image/jpeg", bytes = 1024 } = {} as {
    tipo?: string;
    mime?: string;
    bytes?: number;
  },
): FormData {
  const form = new FormData();
  form.append("listingId", LISTING);
  form.append("tipo", tipo);
  form.append(
    "archivo",
    new File([new Uint8Array(bytes)], "foto.jpg", { type: mime }),
  );
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  guardOk();
  // `puedo_administrar_aviso` devuelve un booleano y las dos de escritura un
  // código: un `mockResolvedValue` único haría que el permiso siempre diera
  // falso y todos los tests pasarían por la rama equivocada.
  mocks.rpc.mockImplementation(async (nombre: string) =>
    nombre === "puedo_administrar_aviso"
      ? { data: true, error: null }
      : { data: "ok", error: null },
  );
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.registerUploadedMedia.mockResolvedValue({
    needsHumanReview: false,
    reasons: [],
    assetIds: [],
  });
  mocks.metadata.mockResolvedValue({ format: "jpeg", width: 1200, height: 1200 });
  mocks.toBuffer.mockResolvedValue(Buffer.from("webp"));
});

// ---------------------------------------------------------------------------
// Subir la foto
// ---------------------------------------------------------------------------

describe("subirFotoDeNegocioAction", () => {
  it("sube al path {tenant}/{listing}/ y devuelve la URL de la foto nueva", async () => {
    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado.ok).toBe(true);
    const [path, , opciones] = mocks.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${TENANT}/${LISTING}/logo-`));
    // Se guarda re-codificada, no el archivo que mandó el navegador.
    expect(path.endsWith(".webp")).toBe(true);
    expect(opciones.contentType).toBe("image/webp");
  });

  it("un archivo que no es una foto no llega a tocar el bucket", async () => {
    const resultado = await subirFotoDeNegocioAction(subida({ mime: "application/pdf" }));

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("un .jpg que por dentro no es una imagen se rechaza al decodificarlo", async () => {
    // El `Content-Type` lo declara el navegador y se puede mentir: la barrera
    // que vale es la de los bytes.
    mocks.metadata.mockResolvedValue({ format: "gif", width: 1200, height: 1200 });

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("una foto de más de 5 MB se rechaza antes de leerla", async () => {
    const resultado = await subirFotoDeNegocioAction(
      subida({ bytes: MAX_FOTO_BYTES + 1 }),
    );

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });

  it("un logo demasiado chico se rechaza con un consejo, no con un error genérico", async () => {
    mocks.metadata.mockResolvedValue({ format: "png", width: 80, height: 80 });

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.mensaje).toMatch(/200 por 200/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("sin permiso sobre el aviso no sube nada", async () => {
    // `puedo_administrar_aviso` (0093) es el mismo predicado que decide quién
    // ve el editor de horarios. La barrera real está en la RPC de escritura;
    // esto evita gastar una subida que iba a rebotar.
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === "puedo_administrar_aviso"
        ? { data: false, error: null }
        : { data: "ok", error: null },
    );

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("sin sesión no sube nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "no",
      supabase: clienteConRpc(),
      tenant: { id: TENANT, slug: "dominicanos" },
      user: null,
    });

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("si la imagen ya está publicada por otra cuenta, se borra lo recién subido", async () => {
    mocks.registerUploadedMedia.mockResolvedValue({
      needsHumanReview: true,
      reasons: [INTEGRITY_REASONS.duplicate],
      assetIds: [],
    });

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });

  it("que no se haya podido calcular la huella NO bloquea la foto de identidad", async () => {
    // El avatar de una persona hoy ni siquiera se registra: exigir huella acá
    // dejaría al negocio sin logo por una razón que no es suya.
    mocks.registerUploadedMedia.mockResolvedValue({
      needsHumanReview: true,
      reasons: [INTEGRITY_REASONS.notFingerprinted],
      assetIds: [],
    });

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado.ok).toBe(true);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("si la RPC no guarda, el objeto subido no queda huérfano en el bucket", async () => {
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === "puedo_administrar_aviso"
        ? { data: true, error: null }
        : { data: "sin_permiso", error: null },
    );

    const resultado = await subirFotoDeNegocioAction(subida());

    expect(resultado).toMatchObject({ ok: false });
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });
});

describe("quitarFotoDeNegocioAction", () => {
  it("deja la otra foto intacta: manda los DOS valores finales", async () => {
    const resultado = await quitarFotoDeNegocioAction({
      listingId: LISTING,
      tipo: "portada",
    });

    expect(resultado).toMatchObject({ ok: true, url: null });
    const llamada = mocks.rpc.mock.calls.find(
      ([nombre]) => nombre === "guardar_fotos_de_negocio",
    );
    expect(llamada?.[1]).toMatchObject({ p_listing_id: LISTING, p_cover: null });
  });
});

// ---------------------------------------------------------------------------
// Guardar los datos
// ---------------------------------------------------------------------------

describe("guardarPaginaDeNegocioAction", () => {
  it("guarda y manda los servicios normalizados a la RPC", async () => {
    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ services: JSON.stringify(["  Techos ", "techos", "", "Pisos"]) }),
    );

    expect(estado.estado).toBe("ok");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "guardar_pagina_de_negocio",
      expect.objectContaining({ p_services: ["Techos", "Pisos"] }),
    );
  });

  it("un nombre vacío no llega a la base", async () => {
    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ title: "   " }),
    );

    expect(estado).toMatchObject({ estado: "error", campo: "title" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un nombre larguísimo se explica distinto que uno vacío", async () => {
    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ title: "x".repeat(81) }),
    );

    expect(estado.estado).toBe("error");
    if (estado.estado === "error") expect(estado.mensaje).toMatch(/muy largo/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("una descripción más larga que el tope se rechaza acá y no en la base", async () => {
    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ description: "x".repeat(2001) }),
    );

    expect(estado).toMatchObject({ estado: "error", campo: "description" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un servicio más largo de la cuenta se explica con su tope", async () => {
    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ services: JSON.stringify(["x".repeat(61)]) }),
    );

    expect(estado).toMatchObject({ estado: "error", campo: "services" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("más servicios que el tope: se corta en el máximo y se guarda igual", async () => {
    // `normalizarServicios` corta antes de validar, así que la persona no
    // pierde el resto de lo que escribió por un ítem de más.
    const veinte = Array.from({ length: 20 }, (_, i) => `Servicio ${i + 1}`);

    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ services: JSON.stringify(veinte) }),
    );

    expect(estado.estado).toBe("ok");
    const enviados = mocks.rpc.mock.calls[0][1].p_services as string[];
    expect(enviados).toHaveLength(MAX_SERVICIOS);
  });

  it("un rubro inventado no entra en attrs.category", async () => {
    await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ category: "lo-que-sea" }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "guardar_pagina_de_negocio",
      expect.objectContaining({ p_category: null }),
    );
  });

  it("en tier free, el rebote del CHECK de contacto se lee como el plan", async () => {
    mocks.rpc.mockResolvedValue({ data: "contacto_premium", error: null });

    const estado = await guardarPaginaDeNegocioAction(
      EDITAR_PAGINA_INICIAL,
      datos({ phone: "+1 917 555 0000" }),
    );

    expect(estado.estado).toBe("error");
    if (estado.estado === "error") {
      expect(estado.mensaje).toMatch(/Presencia Verificada/);
    }
  });

  it("sin permiso, el mensaje habla del perfil activo y no de un error genérico", async () => {
    mocks.rpc.mockResolvedValue({ data: "sin_permiso", error: null });

    const estado = await guardarPaginaDeNegocioAction(EDITAR_PAGINA_INICIAL, datos());

    expect(estado.estado).toBe("error");
    if (estado.estado === "error") expect(estado.mensaje).toMatch(/perfil/i);
  });
});

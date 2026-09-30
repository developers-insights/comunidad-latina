import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(async () => ({ ok: true })),
  createAdminClient: vi.fn(),
}));

vi.mock("./notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { avisarSolicitudNueva } from "./solicitud-server";

const YO = "yo";
const OTRA = "otra";
const CONV = "conv";

type Conversacion = {
  id: string;
  tenant_id: string;
  status: string;
  created_by: string;
  counterpart_id: string;
  declined_at: string | null;
};

function cadena(resolver: (filtros: [string, string, unknown][]) => unknown) {
  const filtros: [string, string, unknown][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), q),
    gt: (c: string, v: unknown) => (filtros.push(["gt", c, v]), q),
    limit: () => q,
    maybeSingle: async () => ({ data: resolver(filtros), error: null }),
  };
  return q;
}

function escenario(conversacion: Conversacion, avisoPrevioEn: string | null) {
  const usuario = {
    from: (tabla: string) =>
      cadena(() =>
        tabla === "conversations" ? conversacion : { display_name: "Ana" },
      ),
  };
  const admin = {
    from: () =>
      cadena((filtros) => {
        if (!avisoPrevioEn) return null;
        const desde = filtros.find(([op, col]) => op === "gt" && col === "created_at");
        if (desde && String(desde[2]) >= avisoPrevioEn) return null;
        return { id: "aviso-previo" };
      }),
  };
  mocks.createAdminClient.mockReturnValue(admin);
  return usuario;
}

const pendiente: Conversacion = {
  id: CONV,
  tenant_id: "t",
  status: "pending",
  created_by: YO,
  counterpart_id: OTRA,
  declined_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("avisarSolicitudNueva", () => {
  it("una solicitud nueva avisa a la otra persona", async () => {
    const supabase = escenario(pendiente, null);
    await avisarSolicitudNueva(supabase as never, { userId: YO, conversationId: CONV });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("insistir sobre la misma solicitud no avisa dos veces", async () => {
    const supabase = escenario(pendiente, "2026-09-30T10:00:00Z");
    await avisarSolicitudNueva(supabase as never, { userId: YO, conversationId: CONV });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("mientras siga descartada no avisa: la ventana anti-spam es silenciosa", async () => {
    const supabase = escenario(
      { ...pendiente, status: "declined", declined_at: "2026-09-30T11:00:00Z" },
      "2026-09-30T10:00:00Z",
    );
    await avisarSolicitudNueva(supabase as never, { userId: YO, conversationId: CONV });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("reabierta pasada la ventana vuelve a avisar aunque haya un aviso de la vez anterior", async () => {
    const supabase = escenario(
      { ...pendiente, declined_at: "2026-08-15T00:00:00Z" },
      "2026-08-01T00:00:00Z",
    );
    await avisarSolicitudNueva(supabase as never, { userId: YO, conversationId: CONV });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("reabierta y ya avisada en esta ronda no vuelve a avisar", async () => {
    const supabase = escenario(
      { ...pendiente, declined_at: "2026-08-15T00:00:00Z" },
      "2026-09-20T00:00:00Z",
    );
    await avisarSolicitudNueva(supabase as never, { userId: YO, conversationId: CONV });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
});

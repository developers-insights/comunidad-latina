import { describe, expect, it } from "vitest";
import { elegirTimbre, type InvitacionPendiente } from "./timbre";
import type { LlamadaRow } from "./tipos";

const YO = "99999999-9999-4999-8999-999999999999";
const OTRA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function llamada(id: string, status: string, extra: Partial<LlamadaRow> = {}): LlamadaRow {
  return {
    id,
    kind: "audio",
    status,
    group_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    iniciada_por: OTRA,
    started_at: null,
    ended_at: null,
    created_at: "2026-09-23T10:00:00Z",
    ...extra,
  };
}

const invitacion = (callId: string, invitadaAt: string): InvitacionPendiente => ({
  call_id: callId,
  invitada_at: invitadaAt,
});

describe("elegirTimbre", () => {
  it("una llamada de grupo que ya atendió otro me sigue sonando si no entré", () => {
    const elegida = elegirTimbre({
      invitaciones: [invitacion("c1", "2026-09-23T10:05:00Z")],
      llamadas: [llamada("c1", "en_curso")],
      descartadas: new Set(),
      miId: YO,
    });
    expect(elegida?.llamada.id).toBe("c1");
    expect(elegida?.invitadaAt).toBe("2026-09-23T10:05:00Z");
  });

  it("gana la invitación más nueva", () => {
    const elegida = elegirTimbre({
      invitaciones: [
        invitacion("nueva", "2026-09-23T10:05:30Z"),
        invitacion("vieja", "2026-09-23T10:05:00Z"),
      ],
      llamadas: [llamada("vieja", "sonando"), llamada("nueva", "sonando")],
      descartadas: new Set(),
      miId: YO,
    });
    expect(elegida?.llamada.id).toBe("nueva");
  });

  it("no suena una llamada terminada, una descartada ni una que empecé yo", () => {
    const elegida = elegirTimbre({
      invitaciones: [
        invitacion("terminada", "2026-09-23T10:05:30Z"),
        invitacion("descartada", "2026-09-23T10:05:20Z"),
        invitacion("mia", "2026-09-23T10:05:10Z"),
      ],
      llamadas: [
        llamada("terminada", "terminada"),
        llamada("descartada", "sonando"),
        llamada("mia", "sonando", { iniciada_por: YO }),
      ],
      descartadas: new Set(["descartada"]),
      miId: YO,
    });
    expect(elegida).toBeNull();
  });
});

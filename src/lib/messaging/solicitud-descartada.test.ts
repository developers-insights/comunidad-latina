import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STATUS_DESCARTADA,
  estadoDelDescarte,
  sigueDescartada,
  visiblesParaMi,
} from "./solicitud-descartada";
import { agruparPorPersona, type ConversacionLite } from "./agrupar-por-persona";
import { estadoDeSolicitud } from "@/lib/notifications/solicitud";

const YO = "yo";
const OTRO = "otro";

function conv(parcial: Partial<ConversacionLite> & { id: string }): ConversacionLite {
  return {
    status: "pending",
    created_at: "2026-09-30T10:00:00Z",
    created_by: OTRO,
    counterpart_id: YO,
    listing: null,
    creator: { id: OTRO, display_name: "Otro", avatar_url: null },
    counterpart: { id: YO, display_name: "Yo", avatar_url: null },
    ...parcial,
  };
}

describe("visiblesParaMi", () => {
  it("una solicitud que descarté desaparece de mi lado", () => {
    const filas = visiblesParaMi([conv({ id: "a", status: STATUS_DESCARTADA })], YO);
    expect(filas).toEqual([]);
  });

  it("quien la mandó la sigue viendo como pendiente: no se entera del descarte", () => {
    const [fila] = visiblesParaMi(
      [conv({ id: "a", status: STATUS_DESCARTADA, created_by: YO, counterpart_id: OTRO })],
      YO,
    );
    expect(fila.status).toBe("pending");
  });

  it("no toca los demás estados", () => {
    const filas = visiblesParaMi(
      [conv({ id: "a", status: "accepted" }), conv({ id: "b", status: "blocked" })],
      YO,
    );
    expect(filas.map((f) => f.status)).toEqual(["accepted", "blocked"]);
  });
});

describe("la bandeja agrupada respeta el descarte", () => {
  it("quien descartó no ve la fila", () => {
    expect(agruparPorPersona([conv({ id: "a", status: STATUS_DESCARTADA })], new Map(), YO)).toEqual(
      [],
    );
  });

  it("quien pidió ve 'Esperando respuesta', igual que antes del descarte", () => {
    const [hilo] = agruparPorPersona(
      [conv({ id: "a", status: STATUS_DESCARTADA, created_by: YO, counterpart_id: OTRO })],
      new Map(),
      YO,
    );
    expect(hilo.esperandoRespuesta).toBe(true);
    expect(hilo.solicitudRecibidaId).toBeNull();
  });
});

describe("estadoDelDescarte", () => {
  it("traduce lo que devuelve descartar_solicitud", () => {
    expect(estadoDelDescarte("declined")).toBe("eliminada");
    expect(estadoDelDescarte("blocked")).toBe("eliminada");
    expect(estadoDelDescarte("accepted")).toBe("aceptada");
    expect(estadoDelDescarte(null)).toBeNull();
    expect(estadoDelDescarte("pending")).toBeNull();
  });
});

describe("sigueDescartada", () => {
  it("sólo una declined silencia avisos", () => {
    expect(sigueDescartada("declined")).toBe(true);
    expect(sigueDescartada("pending")).toBe(false);
    expect(sigueDescartada(undefined)).toBe(false);
  });
});

describe("la campana", () => {
  it("una descartada se muestra como eliminada, nunca como bloqueada", () => {
    expect(estadoDeSolicitud("declined")).toBe("eliminada");
  });
});

describe("la 0177, escrita", () => {
  const SQL = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/0177_descartar_solicitud_sin_bloquear.sql"),
    "utf8",
  );
  const plano = SQL.replace(/\s+/g, " ");

  it("descartar no escribe blocked ni toca user_blocks", () => {
    const cuerpo = plano.slice(
      plano.indexOf("create or replace function public.descartar_solicitud"),
      plano.indexOf("comment on function public.descartar_solicitud"),
    );
    expect(cuerpo).toContain("set status = 'declined'");
    expect(cuerpo).toContain("declined_at = now()");
    expect(cuerpo).not.toContain("'blocked'");
    expect(cuerpo).not.toContain("user_blocks");
    expect(cuerpo).toContain("v_conv.counterpart_id is distinct from v_uid");
  });

  it("las tres puertas de contacto reabren la descartada sólo pasada la ventana", () => {
    for (const fn of ["request_contact", "solicitar_contacto_directo", "contactar_aviso_de_ayuda"]) {
      const desde = plano.indexOf(`create or replace function public.${fn}(`);
      const cuerpo = plano.slice(desde, plano.indexOf(`comment on function public.${fn}(`, desde));
      expect(cuerpo, fn).toContain("app.solicitud_puede_reabrirse(");
      expect(cuerpo, fn).toContain("set status = 'pending'");
    }
  });

  it("un bloqueo sigue cortando el contacto directo", () => {
    expect(plano).toContain("c.status = 'blocked'");
    expect(plano).toContain("app.pair_blocked(v_uid, p_profile_id)");
  });

  it("quien pidió puede seguir escribiendo; la contraparte de una declined no", () => {
    expect(plano).toContain(
      "or (c.status in ('pending', 'declined') and c.created_by = (select auth.uid()))",
    );
  });

  it("grants explícitos y anon fuera de notifications", () => {
    expect(plano).toContain("revoke execute on function public.descartar_solicitud(uuid) from public, anon");
    expect(plano).toContain("grant execute on function public.descartar_solicitud(uuid) to authenticated");
    expect(plano).toContain("revoke all on public.notifications from anon");
    expect(SQL).toMatch(/^begin;$/m);
    expect(SQL).toMatch(/^commit;$/m);
  });
});

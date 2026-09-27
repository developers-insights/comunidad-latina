import { describe, expect, it } from "vitest";
import {
  allowedActions,
  canSign,
  CONTRACT_STEPS,
  contractStepIndex,
  findTransition,
  isMoneyFrozen,
  isTerminalStatus,
  roleOf,
  SYSTEM_TRANSITIONS,
  TRANSITIONS,
  type ContractStatus,
} from "./contract-machine";

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTRACT = { client_id: CLIENT, creator_id: CREATOR };

const ALL: ContractStatus[] = [
  "proposed",
  "accepted",
  "signed",
  "funded",
  "delivered",
  "changes_requested",
  "approved",
  "released",
  "canceled",
  "disputed",
  "rejected",
];

describe("roleOf", () => {
  it("reconoce a las dos partes y trata a cualquier otro como 'other'", () => {
    expect(roleOf(CLIENT, CONTRACT)).toBe("client");
    expect(roleOf(CREATOR, CONTRACT)).toBe("creator");
    expect(roleOf(STRANGER, CONTRACT)).toBe("other");
  });

  it("sin sesión es 'other'", () => {
    expect(roleOf(null, CONTRACT)).toBe("other");
    expect(roleOf(undefined, CONTRACT)).toBe("other");
  });
});

describe("propuesta", () => {
  it("el creador acepta (proposed → accepted) y eso genera el contrato a firmar", () => {
    const rule = findTransition("creator", "proposed", "accept");
    expect(rule?.to).toBe("accepted");
    expect(rule?.stamp).toBe("accepted_at");
  });

  it("el creador rechaza (proposed → rejected)", () => {
    expect(findTransition("creator", "proposed", "reject")?.to).toBe("rejected");
  });

  it("el creador puede negociar cambios sin salir de 'proposed'", () => {
    expect(findTransition("creator", "proposed", "request_terms_changes")?.to).toBe("proposed");
  });

  it("el cliente no acepta ni rechaza su propia propuesta", () => {
    expect(findTransition("client", "proposed", "accept")).toBeNull();
    expect(findTransition("client", "proposed", "reject")).toBeNull();
  });
});

describe("firma del contrato", () => {
  it("las dos partes firman en 'accepted' y nadie firma en otro estado", () => {
    expect(canSign("client", "accepted")).toBe(true);
    expect(canSign("creator", "accepted")).toBe(true);
    expect(canSign("other", "accepted")).toBe(false);
    for (const status of ALL.filter((s) => s !== "accepted")) {
      expect(canSign("client", status)).toBe(false);
    }
  });

  it("'Solicitar cambios' en la firma devuelve el contrato a propuesta, para cualquiera de las dos partes", () => {
    expect(findTransition("client", "accepted", "request_terms_changes")?.to).toBe("proposed");
    expect(findTransition("creator", "accepted", "request_terms_changes")?.to).toBe("proposed");
  });

  it("después de firmado ya no se piden cambios de condiciones", () => {
    expect(findTransition("client", "signed", "request_terms_changes")).toBeNull();
    expect(findTransition("creator", "signed", "request_terms_changes")).toBeNull();
  });

  it("completar las firmas es del sistema, no de una parte", () => {
    const rule = SYSTEM_TRANSITIONS.find((t) => t.action === "complete_signatures");
    expect(rule?.from).toBe("accepted");
    expect(rule?.to).toBe("signed");
  });
});

describe("pago", () => {
  it("sólo el cliente paga, y sólo con las dos firmas (signed → funded)", () => {
    expect(findTransition("client", "signed", "fund")?.to).toBe("funded");
    expect(findTransition("client", "accepted", "fund")).toBeNull();
    expect(findTransition("creator", "signed", "fund")).toBeNull();
  });
});

describe("entrega y revisión", () => {
  it("el creador entrega desde 'funded' y vuelve a entregar desde 'changes_requested'", () => {
    expect(findTransition("creator", "funded", "deliver")?.to).toBe("delivered");
    expect(findTransition("creator", "changes_requested", "deliver")?.to).toBe("delivered");
    expect(findTransition("client", "funded", "deliver")).toBeNull();
  });

  it("el cliente pide una revisión sobre una entrega (delivered → changes_requested)", () => {
    const rule = findTransition("client", "delivered", "request_revision");
    expect(rule?.to).toBe("changes_requested");
    expect(rule?.stamp).toBe("changes_requested_at");
    expect(findTransition("creator", "delivered", "request_revision")).toBeNull();
  });

  it("el cliente aprueba (delivered → approved); el creador no se aprueba solo", () => {
    const rule = findTransition("client", "delivered", "approve");
    expect(rule?.to).toBe("approved");
    expect(rule?.stamp).toBe("approved_at");
    expect(findTransition("creator", "delivered", "approve")).toBeNull();
  });

  it("vencida la revisión, el sistema aprueba solo", () => {
    const rule = SYSTEM_TRANSITIONS.find((t) => t.action === "auto_approve");
    expect(rule?.from).toBe("delivered");
    expect(rule?.to).toBe("approved");
  });

  it("liberar la plata es del sistema (approved → released), nunca de una parte", () => {
    const rule = SYSTEM_TRANSITIONS.find((t) => t.action === "release");
    expect(rule?.from).toBe("approved");
    expect(rule?.to).toBe("released");
    for (const role of ["client", "creator"] as const) {
      for (const status of ALL) {
        expect(findTransition(role, status, "release" as never)).toBeNull();
      }
    }
  });
});

describe("cancelaciones", () => {
  it("proposed: sólo el cliente retira su propuesta", () => {
    expect(findTransition("client", "proposed", "cancel")?.to).toBe("canceled");
    expect(findTransition("creator", "proposed", "cancel")).toBeNull();
  });

  it("accepted y signed: cualquiera de las dos partes, todavía sin plata de por medio", () => {
    for (const status of ["accepted", "signed"] as const) {
      expect(findTransition("client", status, "cancel")?.to).toBe("canceled");
      expect(findTransition("creator", status, "cancel")?.to).toBe("canceled");
    }
  });

  it("funded: sólo el cliente, antes de la entrega (con reembolso)", () => {
    expect(findTransition("client", "funded", "cancel")?.to).toBe("canceled");
    expect(findTransition("creator", "funded", "cancel")).toBeNull();
  });

  it("entregado ya no se cancela: se disputa", () => {
    for (const status of ["delivered", "changes_requested", "approved"] as const) {
      expect(findTransition("client", status, "cancel")).toBeNull();
      expect(findTransition("creator", status, "cancel")).toBeNull();
    }
  });
});

describe("disputa", () => {
  it("el cliente disputa una entrega o una revisión en curso", () => {
    expect(findTransition("client", "delivered", "dispute")?.to).toBe("disputed");
    expect(findTransition("client", "changes_requested", "dispute")?.to).toBe("disputed");
  });

  it("el creador puede disputar si le piden revisiones que no corresponden", () => {
    expect(findTransition("creator", "changes_requested", "dispute")?.to).toBe("disputed");
    expect(findTransition("creator", "delivered", "dispute")).toBeNull();
  });

  it("no se disputa antes de pagar ni después de aprobar", () => {
    for (const status of ["proposed", "accepted", "signed", "approved"] as const) {
      expect(findTransition("client", status, "dispute")).toBeNull();
    }
  });

  it("con el pago hecho, el negocio puede disputar en vez de cancelar; el creador no", () => {
    expect(findTransition("client", "funded", "dispute")?.to).toBe("disputed");
    expect(findTransition("creator", "funded", "dispute")).toBeNull();
  });

  it("la disputa congela la plata", () => {
    expect(isMoneyFrozen("disputed")).toBe(true);
    expect(isMoneyFrozen("delivered")).toBe(false);
  });
});

describe("estados sin salida para las partes", () => {
  it("nadie opera released, canceled, rejected ni disputed", () => {
    for (const status of ["released", "canceled", "rejected", "disputed"] as const) {
      expect(allowedActions("client", status)).toEqual([]);
      expect(allowedActions("creator", status)).toEqual([]);
    }
  });

  it("approved no tiene acciones de parte: el pago se libera solo", () => {
    expect(allowedActions("client", "approved")).toEqual([]);
    expect(allowedActions("creator", "approved")).toEqual([]);
  });

  it("un tercero nunca puede nada", () => {
    for (const status of ALL) {
      expect(allowedActions("other", status)).toEqual([]);
    }
  });

  it("released, canceled y rejected son terminales; el resto no", () => {
    for (const status of ALL) {
      expect(isTerminalStatus(status)).toBe(["released", "canceled", "rejected"].includes(status));
    }
  });
});

describe("allowedActions — botones en orden", () => {
  it("creador en proposed: aceptar primero", () => {
    expect(allowedActions("creator", "proposed").map((r) => r.action)).toEqual([
      "accept",
      "request_terms_changes",
      "reject",
    ]);
  });

  it("cliente en delivered: aprobar, pedir revisión, disputar", () => {
    expect(allowedActions("client", "delivered").map((r) => r.action)).toEqual([
      "approve",
      "request_revision",
      "dispute",
    ]);
  });
});

describe("invariantes", () => {
  it("toda transición de parte tiene rol de parte y sólo 'request_terms_changes' puede quedarse en el lugar", () => {
    for (const rule of TRANSITIONS) {
      expect(["client", "creator"]).toContain(rule.role);
      if (rule.from === rule.to) expect(rule.action).toBe("request_terms_changes");
    }
  });

  it("ningún estado terminal es origen de una transición", () => {
    for (const rule of [...TRANSITIONS, ...SYSTEM_TRANSITIONS]) {
      expect(isTerminalStatus(rule.from)).toBe(false);
    }
  });
});

describe("contractStepIndex", () => {
  it("cinco hitos: propuesta, contrato, trabajo, revisión, pago", () => {
    expect(CONTRACT_STEPS).toHaveLength(5);
    expect(contractStepIndex("proposed")).toBe(0);
    expect(contractStepIndex("accepted")).toBe(1);
    expect(contractStepIndex("signed")).toBe(1);
    expect(contractStepIndex("funded")).toBe(2);
    expect(contractStepIndex("changes_requested")).toBe(2);
    expect(contractStepIndex("delivered")).toBe(3);
    expect(contractStepIndex("disputed")).toBe(3);
    expect(contractStepIndex("approved")).toBe(4);
    expect(contractStepIndex("released")).toBe(4);
  });

  it("canceled y rejected salen del carril", () => {
    expect(contractStepIndex("canceled")).toBe(-1);
    expect(contractStepIndex("rejected")).toBe(-1);
  });
});

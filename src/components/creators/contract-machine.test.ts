import { describe, expect, it } from "vitest";
import {
  allowedActions,
  CONTRACT_STEPS,
  contractStepIndex,
  findTransition,
  isTerminalStatus,
  roleOf,
  TRANSITIONS,
  type ContractStatus,
} from "./contract-machine";

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTRACT = { client_id: CLIENT, creator_id: CREATOR };

describe("roleOf", () => {
  it("reconoce a las dos partes y trata a cualquier otro como 'other'", () => {
    expect(roleOf(CLIENT, CONTRACT)).toBe("client");
    expect(roleOf(CREATOR, CONTRACT)).toBe("creator");
    expect(roleOf(STRANGER, CONTRACT)).toBe("other");
  });

  it("sin sesión es 'other' (no habilita nada)", () => {
    expect(roleOf(null, CONTRACT)).toBe("other");
    expect(roleOf(undefined, CONTRACT)).toBe("other");
  });
});

describe("findTransition — aceptar / rechazar la propuesta (creador)", () => {
  it("el CREADOR acepta la propuesta (proposed → accepted) y sella accepted_at", () => {
    const rule = findTransition("creator", "proposed", "accept");
    expect(rule?.to).toBe("accepted");
    expect(rule?.stamp).toBe("accepted_at");
  });

  it("el CREADOR rechaza la propuesta (proposed → rejected) y sella rejected_at", () => {
    const rule = findTransition("creator", "proposed", "reject");
    expect(rule?.to).toBe("rejected");
    expect(rule?.stamp).toBe("rejected_at");
  });

  it("el CLIENTE NO puede aceptar ni rechazar — la decisión es del creador", () => {
    expect(findTransition("client", "proposed", "accept")).toBeNull();
    expect(findTransition("client", "proposed", "reject")).toBeNull();
  });

  it("aceptar/rechazar solo existe en 'proposed', no en estados posteriores", () => {
    expect(findTransition("creator", "accepted", "accept")).toBeNull();
    expect(findTransition("creator", "funded", "accept")).toBeNull();
    expect(findTransition("creator", "accepted", "reject")).toBeNull();
    expect(findTransition("creator", "funded", "reject")).toBeNull();
  });
});

describe("findTransition — ciclo feliz", () => {
  it("solo el CLIENTE deposita en garantía, y SOLO desde 'accepted' (accepted → funded)", () => {
    const rule = findTransition("client", "accepted", "fund");
    expect(rule?.to).toBe("funded");
    expect(rule?.stamp).toBe("funded_at");
    // El creador NO puede depositar.
    expect(findTransition("creator", "accepted", "fund")).toBeNull();
    // Y ya NO se deposita desde 'proposed': primero el creador tiene que aceptar.
    expect(findTransition("client", "proposed", "fund")).toBeNull();
  });

  it("solo el CREADOR entrega (funded → delivered)", () => {
    expect(findTransition("creator", "funded", "deliver")?.to).toBe("delivered");
    expect(findTransition("creator", "funded", "deliver")?.stamp).toBe("delivered_at");
    // El cliente NO entrega por el creador.
    expect(findTransition("client", "funded", "deliver")).toBeNull();
  });

  it("solo el CLIENTE aprueba y libera (delivered → released)", () => {
    expect(findTransition("client", "delivered", "release")?.to).toBe("released");
    expect(findTransition("client", "delivered", "release")?.stamp).toBe("released_at");
    // El creador NO se libera su propia plata.
    expect(findTransition("creator", "delivered", "release")).toBeNull();
  });
});

describe("findTransition — cancelaciones", () => {
  it("desde 'proposed' SOLO el cliente cancela (retira su propuesta); el creador rechaza", () => {
    expect(findTransition("client", "proposed", "cancel")?.to).toBe("canceled");
    // El creador ya no 'cancela' una propuesta: la vía del creador es 'reject'.
    expect(findTransition("creator", "proposed", "cancel")).toBeNull();
  });

  it("desde 'accepted' cancela CUALQUIERA de las dos partes (antes de depositar)", () => {
    expect(findTransition("client", "accepted", "cancel")?.to).toBe("canceled");
    expect(findTransition("creator", "accepted", "cancel")?.to).toBe("canceled");
  });

  it("desde 'funded' cancela SOLO el cliente (reembolso demo, antes de entregar)", () => {
    expect(findTransition("client", "funded", "cancel")?.to).toBe("canceled");
    expect(findTransition("creator", "funded", "cancel")).toBeNull();
  });

  it("una vez 'delivered' ya NO se cancela — se disputa", () => {
    expect(findTransition("client", "delivered", "cancel")).toBeNull();
    expect(findTransition("creator", "delivered", "cancel")).toBeNull();
  });
});

describe("findTransition — disputa", () => {
  it("solo el CLIENTE disputa desde 'delivered'", () => {
    expect(findTransition("client", "delivered", "dispute")?.to).toBe("disputed");
    expect(findTransition("client", "delivered", "dispute")?.stamp).toBeNull();
    expect(findTransition("creator", "delivered", "dispute")).toBeNull();
  });

  it("no se puede disputar antes de la entrega", () => {
    expect(findTransition("client", "funded", "dispute")).toBeNull();
    expect(findTransition("client", "accepted", "dispute")).toBeNull();
    expect(findTransition("client", "proposed", "dispute")).toBeNull();
  });
});

describe("findTransition — nadie opera estados terminales ni disputados", () => {
  const closed: ContractStatus[] = ["released", "canceled", "rejected", "disputed"];
  it("ninguna parte dispara acciones desde released/canceled/rejected/disputed", () => {
    for (const status of closed) {
      expect(allowedActions("client", status)).toHaveLength(0);
      expect(allowedActions("creator", status)).toHaveLength(0);
    }
  });

  it("un tercero ('other') nunca puede nada, en ningún estado", () => {
    const all: ContractStatus[] = [
      "proposed",
      "accepted",
      "funded",
      "delivered",
      "released",
      "canceled",
      "disputed",
      "rejected",
    ];
    for (const status of all) {
      expect(allowedActions("other", status)).toHaveLength(0);
      expect(findTransition("other", status, "fund")).toBeNull();
      expect(findTransition("other", status, "release")).toBeNull();
      expect(findTransition("other", status, "accept")).toBeNull();
    }
  });
});

describe("allowedActions — qué botones ve cada parte", () => {
  it("creador en 'proposed' ve aceptar y rechazar (aceptar primero)", () => {
    const actions = allowedActions("creator", "proposed").map((t) => t.action);
    expect(actions).toEqual(["accept", "reject"]);
  });

  it("cliente en 'proposed' solo puede cancelar — todavía no puede depositar", () => {
    const actions = allowedActions("client", "proposed").map((t) => t.action);
    expect(actions).toEqual(["cancel"]);
    expect(actions).not.toContain("fund");
  });

  it("cliente en 'accepted' ve depositar y cancelar", () => {
    const actions = allowedActions("client", "accepted").map((t) => t.action);
    expect(actions).toContain("fund");
    expect(actions).toContain("cancel");
    expect(actions).not.toContain("deliver");
  });

  it("creador en 'accepted' solo puede cancelar (antes de que se deposite)", () => {
    const actions = allowedActions("creator", "accepted").map((t) => t.action);
    expect(actions).toEqual(["cancel"]);
  });

  it("creador en 'funded' solo puede entregar (no cancelar)", () => {
    const actions = allowedActions("creator", "funded").map((t) => t.action);
    expect(actions).toEqual(["deliver"]);
  });

  it("cliente en 'delivered' puede liberar o disputar", () => {
    const actions = allowedActions("client", "delivered").map((t) => t.action);
    expect(actions).toContain("release");
    expect(actions).toContain("dispute");
  });

  it("creador en 'delivered' no puede nada (espera la aprobación del cliente)", () => {
    expect(allowedActions("creator", "delivered")).toHaveLength(0);
  });
});

describe("invariantes de la tabla de transiciones", () => {
  it("toda transición avanza a un estado distinto y con rol de parte", () => {
    for (const t of TRANSITIONS) {
      expect(t.from).not.toBe(t.to);
      expect(["client", "creator"]).toContain(t.role);
    }
  });

  it("released, canceled y rejected son terminales; el resto no", () => {
    expect(isTerminalStatus("released")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("proposed")).toBe(false);
    expect(isTerminalStatus("accepted")).toBe(false);
    expect(isTerminalStatus("funded")).toBe(false);
    expect(isTerminalStatus("delivered")).toBe(false);
    expect(isTerminalStatus("disputed")).toBe(false);
  });

  it("ningún estado terminal es origen de una transición; 'rejected' solo es destino", () => {
    for (const t of TRANSITIONS) {
      expect(isTerminalStatus(t.from)).toBe(false);
    }
    expect(TRANSITIONS.some((t) => t.from === "rejected")).toBe(false);
    expect(TRANSITIONS.some((t) => t.to === "rejected")).toBe(true);
  });
});

describe("contractStepIndex", () => {
  it("mapea el ciclo feliz a 0..4 en orden", () => {
    expect(CONTRACT_STEPS).toEqual(["proposed", "accepted", "funded", "delivered", "released"]);
    expect(contractStepIndex("proposed")).toBe(0);
    expect(contractStepIndex("accepted")).toBe(1);
    expect(contractStepIndex("funded")).toBe(2);
    expect(contractStepIndex("delivered")).toBe(3);
    expect(contractStepIndex("released")).toBe(4);
  });

  it("disputed se ubica sobre 'delivered'; canceled y rejected salen del carril (-1)", () => {
    expect(contractStepIndex("disputed")).toBe(3);
    expect(contractStepIndex("canceled")).toBe(-1);
    expect(contractStepIndex("rejected")).toBe(-1);
  });
});

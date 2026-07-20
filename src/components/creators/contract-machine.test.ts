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

describe("findTransition — ciclo feliz", () => {
  it("solo el CLIENTE deposita en garantía (proposed → funded)", () => {
    const rule = findTransition("client", "proposed", "fund");
    expect(rule?.to).toBe("funded");
    expect(rule?.stamp).toBe("funded_at");
    // El creador NO puede depositar.
    expect(findTransition("creator", "proposed", "fund")).toBeNull();
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
  it("desde 'proposed' cancela CUALQUIERA de las dos partes", () => {
    expect(findTransition("client", "proposed", "cancel")?.to).toBe("canceled");
    expect(findTransition("creator", "proposed", "cancel")?.to).toBe("canceled");
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
    expect(findTransition("client", "proposed", "dispute")).toBeNull();
  });
});

describe("findTransition — nadie opera estados terminales ni disputados", () => {
  const closed: ContractStatus[] = ["released", "canceled", "disputed"];
  it("ninguna parte puede disparar acciones desde released/canceled/disputed", () => {
    for (const status of closed) {
      expect(allowedActions("client", status)).toHaveLength(0);
      expect(allowedActions("creator", status)).toHaveLength(0);
    }
  });

  it("un tercero ('other') nunca puede nada, en ningún estado", () => {
    const all: ContractStatus[] = [
      "proposed",
      "funded",
      "delivered",
      "released",
      "canceled",
      "disputed",
    ];
    for (const status of all) {
      expect(allowedActions("other", status)).toHaveLength(0);
      expect(findTransition("other", status, "fund")).toBeNull();
      expect(findTransition("other", status, "release")).toBeNull();
    }
  });
});

describe("allowedActions — qué botones ve cada parte", () => {
  it("cliente en 'proposed' ve depositar y cancelar", () => {
    const actions = allowedActions("client", "proposed").map((t) => t.action);
    expect(actions).toContain("fund");
    expect(actions).toContain("cancel");
    expect(actions).not.toContain("deliver");
  });

  it("creador en 'proposed' solo puede cancelar", () => {
    const actions = allowedActions("creator", "proposed").map((t) => t.action);
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

  it("released y canceled son terminales; el resto no", () => {
    expect(isTerminalStatus("released")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("proposed")).toBe(false);
    expect(isTerminalStatus("funded")).toBe(false);
    expect(isTerminalStatus("delivered")).toBe(false);
    expect(isTerminalStatus("disputed")).toBe(false);
  });
});

describe("contractStepIndex", () => {
  it("mapea el ciclo feliz a 0..3 en orden", () => {
    expect(CONTRACT_STEPS).toEqual(["proposed", "funded", "delivered", "released"]);
    expect(contractStepIndex("proposed")).toBe(0);
    expect(contractStepIndex("funded")).toBe(1);
    expect(contractStepIndex("delivered")).toBe(2);
    expect(contractStepIndex("released")).toBe(3);
  });

  it("disputed se ubica sobre 'delivered'; canceled sale del carril (-1)", () => {
    expect(contractStepIndex("disputed")).toBe(2);
    expect(contractStepIndex("canceled")).toBe(-1);
  });
});

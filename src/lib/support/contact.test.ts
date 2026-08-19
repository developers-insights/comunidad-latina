import { describe, expect, it } from "vitest";
import {
  MESSAGE_MAX,
  SUPPORT_EMAIL,
  SUPPORT_TOPICS,
  buildSupportBody,
  buildSupportFooter,
  buildSupportMailto,
  buildSupportSubject,
  findTopic,
} from "./contact";

const CONTEXT = {
  displayName: "Marisol",
  accountEmail: "marisol@demo.comunidadlatina.com",
  accountId: "1d2c3b4a",
  community: "Comunidad Latina",
};

describe("findTopic", () => {
  it("devuelve el motivo pedido", () => {
    expect(findTopic("pagos").subject).toBe("Pagos y membresía");
  });

  it("cae en el último motivo cuando el id no existe, en vez de romper", () => {
    // El id viaja por estado del cliente: un valor viejo o manipulado no puede
    // dejar el composer sin asunto.
    expect(findTopic("no-existe")).toBe(SUPPORT_TOPICS[SUPPORT_TOPICS.length - 1]);
  });
});

describe("buildSupportFooter", () => {
  it("arma el pie con los datos que sirven para encontrar la cuenta", () => {
    const footer = buildSupportFooter(CONTEXT);
    expect(footer).toContain(CONTEXT.accountEmail);
    expect(footer).toContain("Comunidad Latina");
    expect(footer).toContain("1d2c3b4a");
  });

  it("sin sesión no inventa un pie vacío con títulos sueltos", () => {
    expect(buildSupportFooter({})).toBe("");
  });

  it("omite las líneas que no tienen dato en vez de dejar el rótulo huérfano", () => {
    const footer = buildSupportFooter({ accountEmail: "hola@ejemplo.com" });
    expect(footer).toContain("hola@ejemplo.com");
    expect(footer).not.toContain("Comunidad:");
    expect(footer).not.toContain("ID:");
  });
});

describe("buildSupportBody", () => {
  it("deja el mensaje arriba y el pie abajo, separados", () => {
    const body = buildSupportBody("  No puedo entrar  ", CONTEXT);
    expect(body.startsWith("No puedo entrar")).toBe(true);
    expect(body).toContain("Datos que nos ayudan a encontrar tu cuenta:");
  });

  it("sin datos de cuenta, el cuerpo es sólo el mensaje", () => {
    expect(buildSupportBody("Hola", {})).toBe("Hola\n");
  });
});

describe("buildSupportMailto", () => {
  it("apunta a la casilla de soporte con asunto y cuerpo escritos", () => {
    const href = buildSupportMailto("cuenta", "No me llega el correo", CONTEXT);
    expect(href.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);

    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(query.get("subject")).toBe("[Soporte] Cuenta");
    expect(query.get("body")).toContain("No me llega el correo");
  });

  it("codifica los espacios como %20 y no como '+'", () => {
    // Con `URLSearchParams` el cuerpo llegaría con signos de suma en lugar de
    // espacios: el correo se abre lleno de "+" y parece roto.
    const href = buildSupportMailto("idea", "una idea buena", {});
    expect(href).toContain("una%20idea%20buena");
    expect(href).not.toContain("+");
  });

  it("escapa el & para que un mensaje no parta el mailto en dos", () => {
    const href = buildSupportMailto("otro", "Marta & Cía", {});
    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(query.get("body")).toContain("Marta & Cía");
  });
});

describe("contrato de los motivos", () => {
  it("todos los motivos tienen id único, etiqueta, asunto y guía", () => {
    const ids = SUPPORT_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of SUPPORT_TOPICS) {
      expect(topic.label.length).toBeGreaterThan(0);
      expect(topic.placeholder.length).toBeGreaterThan(0);
      expect(buildSupportSubject(topic.id)).toContain("[Soporte]");
    }
  });

  it("el tope del mensaje deja el mailto dentro de lo que aguantan los clientes", () => {
    expect(MESSAGE_MAX).toBeLessThanOrEqual(1800);
  });
});

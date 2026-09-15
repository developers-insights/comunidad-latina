// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CategoryIcon, NotificationAvatar } from "./category-icon";

/**
 * LA IDENTIDAD VISUAL DE LA FILA (0151).
 *
 * El cliente pidió dos cosas que acá son una: «los logitos de dónde vienen las
 * publicaciones» y el ícono por vertical. Antes la pastilla salía sólo de
 * `category`, y las catorce notificaciones de vencimiento —una casa, un empleo,
 * un evento— mostraban todas el mismo reloj.
 *
 * Lo que este archivo ancla es la DEGRADACIÓN, que es donde esto se rompe en
 * silencio: una publicación sin fotos, un vertical que todavía no tiene ícono y
 * un aviso sin entidad (seguridad, pagos) tienen que seguir dibujando algo.
 */

afterEach(cleanup);

const svgs = (el: HTMLElement) => el.querySelectorAll("svg").length;

describe("NotificationAvatar", () => {
  it("con foto: miniatura + distintivo del módulo", () => {
    const { container } = render(
      <NotificationAvatar
        category="vencimientos"
        entityKind="property"
        imageUrl="https://ejemplo.test/casa.jpg"
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://ejemplo.test/casa.jpg");
    // Decorativo: el texto de la fila ya dice de qué se trata.
    expect(img?.getAttribute("alt")).toBe("");
    expect(svgs(container)).toBe(1);
  });

  it("sin foto: cae al ícono del módulo, no al de la categoría", () => {
    const conKind = render(
      <NotificationAvatar category="vencimientos" entityKind="job" />,
    );
    const soloCategoria = render(<NotificationAvatar category="vencimientos" />);

    expect(conKind.container.querySelector("img")).toBeNull();
    expect(svgs(conKind.container)).toBe(1);
    // Dos glifos distintos: el maletín de Empleos no es el reloj de Vencimientos.
    // Si alguien colapsa los mapas, este `not.toBe` es lo que se pone rojo.
    expect(conKind.container.innerHTML).not.toBe(soloCategoria.container.innerHTML);
  });

  it("vertical desconocido: el ícono de la categoría sigue siendo una respuesta", () => {
    const { container } = render(
      <NotificationAvatar category="pagos" entityKind="vertical_que_no_existe" />,
    );
    expect(svgs(container)).toBe(1);
  });

  it("sin entidad: se comporta como la pastilla de siempre", () => {
    const avatar = render(<NotificationAvatar category="seguridad" />);
    const icono = render(<CategoryIcon category="seguridad" />);
    expect(avatar.container.innerHTML).toBe(icono.container.innerHTML);
  });

  it("foto sin vertical conocido: la miniatura va igual, sin distintivo", () => {
    const { container } = render(
      <NotificationAvatar category="social" imageUrl="https://ejemplo.test/x.jpg" />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(svgs(container)).toBe(0);
  });
});

describe("CategoryIcon", () => {
  it("el vertical gana sobre la categoría cuando hay", () => {
    const conKind = render(<CategoryIcon category="vencimientos" entityKind="event" />);
    const sinKind = render(<CategoryIcon category="vencimientos" />);
    expect(conKind.container.innerHTML).not.toBe(sinKind.container.innerHTML);
  });

  it("es decorativo para el lector de pantalla", () => {
    const { container } = render(<CategoryIcon category="mensajes" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

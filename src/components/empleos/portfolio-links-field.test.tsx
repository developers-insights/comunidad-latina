// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PortfolioLinksField } from "./portfolio-links-field";

/**
 * Hasta 5 filas de enlace, cada una con su input + botón "quitar". Antes se
 * keyaban por ÍNDICE: al borrar una fila del medio, React reutilizaba el nodo
 * de la fila de abajo (mismo índice, otro enlace) y el foco podía terminar
 * sobre un input que ya representa un enlace distinto al que se estaba
 * editando. Acá se prueba el comportamiento observable que eso rompía: que
 * cada fila conserve SU PROPIO valor —identificado por lo que tiene adentro,
 * no por la posición— al borrar una fila anterior o del medio.
 */

function Controlled({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return <PortfolioLinksField value={value} onChange={setValue} />;
}

afterEach(cleanup);

describe("PortfolioLinksField: identidad de fila al borrar", () => {
  it("borrar la fila del medio no le cambia el valor a las que quedan", () => {
    render(
      <Controlled
        initial={[
          "https://portafolio-1.com",
          "https://portafolio-2.com",
          "https://portafolio-3.com",
        ]}
      />,
    );

    const removeButtons = screen.getAllByRole("button", { name: /Quitar el enlace/i });
    // Quitar la fila 2 (el enlace del medio).
    fireEvent.click(removeButtons[1]);

    const inputsAfter = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputsAfter.map((i) => i.value)).toEqual([
      "https://portafolio-1.com",
      "https://portafolio-3.com",
    ]);
  });

  it("borrar la PRIMERA fila no arrastra su valor a la que queda primera", () => {
    render(
      <Controlled
        initial={["https://portafolio-1.com", "https://portafolio-2.com"]}
      />,
    );

    const removeButtons = screen.getAllByRole("button", { name: /Quitar el enlace/i });
    fireEvent.click(removeButtons[0]);

    // Con key=índice, React reutiliza el DOM de la fila 0 (mismo índice) con
    // el VALOR de la fila 1 — el input sobrevive, pero cualquier estado local
    // que hubiera colgado de ese nodo (foco, selección) queda mal atado. Acá
    // se ancla al menos que el valor visible es el correcto tras el borrado.
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("https://portafolio-2.com");
  });

  it("agregar una fila nueva no reordena ni pisa las existentes", () => {
    render(<Controlled initial={["https://portafolio-1.com"]} />);

    fireEvent.click(screen.getByRole("button", { name: /Agregar otro enlace/i }));

    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("https://portafolio-1.com");
    expect(inputs[1].value).toBe("");
  });
});

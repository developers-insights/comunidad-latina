// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAX_BYTES_POR_KIND } from "@/lib/messaging/adjuntos";
import { COPY_COMPOSER } from "./copy-composer";
import { ArchivoPrevia, formatearPeso } from "./archivo-previa";

/**
 * «Un adjunto PDF se envía solo, sin apretar enviar» (Nacho, 23/9). Elegir el
 * archivo ya no manda nada: se ve qué se eligió y se decide.
 */

afterEach(cleanup);

function pdf(nombre: string, bytes: number) {
  const archivo = new File(["%PDF"], nombre, { type: "application/pdf" });
  Object.defineProperty(archivo, "size", { value: bytes });
  return archivo;
}

describe("formatearPeso", () => {
  it("usa coma decimal y la unidad que se entiende", () => {
    expect(formatearPeso(900)).toBe("900 B");
    expect(formatearPeso(2048)).toBe("2 KB");
    expect(formatearPeso(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("ArchivoPrevia", () => {
  it("elegir el archivo no manda nada: muestra nombre y peso", () => {
    const onEnviar = vi.fn();
    render(
      <ArchivoPrevia
        archivos={[pdf("contrato.pdf", 1.5 * 1024 * 1024)]}
        onCancelar={() => {}}
        onEnviar={onEnviar}
      />,
    );
    expect(screen.getByText("contrato.pdf")).toBeTruthy();
    expect(screen.getByText(/1,5 MB/)).toBeTruthy();
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("Enviar manda los archivos con el texto escrito", () => {
    const onEnviar = vi.fn();
    const archivo = pdf("contrato.pdf", 2048);
    render(<ArchivoPrevia archivos={[archivo]} onCancelar={() => {}} onEnviar={onEnviar} />);
    fireEvent.change(screen.getByLabelText(COPY_COMPOSER.archivo.pie), {
      target: { value: "  Te paso el contrato  " },
    });
    fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.archivo.enviar(1) }));
    expect(onEnviar).toHaveBeenCalledWith([archivo], "Te paso el contrato");
  });

  it("Cancelar cierra sin mandar", () => {
    const onEnviar = vi.fn();
    const onCancelar = vi.fn();
    render(
      <ArchivoPrevia
        archivos={[pdf("contrato.pdf", 2048)]}
        onCancelar={onCancelar}
        onEnviar={onEnviar}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.archivo.cancelar }));
    expect(onCancelar).toHaveBeenCalled();
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("un archivo que no entra dice por qué y no se puede mandar", () => {
    const onEnviar = vi.fn();
    render(
      <ArchivoPrevia
        archivos={[pdf("escaneo.pdf", MAX_BYTES_POR_KIND.archivo + 1)]}
        onCancelar={() => {}}
        onEnviar={onEnviar}
      />,
    );
    expect(screen.getByText(COPY_COMPOSER.rechazo.peso)).toBeTruthy();
    const enviar = screen.getByRole("button", { name: COPY_COMPOSER.archivo.enviar(1) });
    expect((enviar as HTMLButtonElement).disabled).toBe(true);
  });
});

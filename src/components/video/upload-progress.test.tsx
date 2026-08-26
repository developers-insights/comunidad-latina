// @vitest-environment jsdom
// Matchers de jest-dom (`toBeInTheDocument`, `toHaveAttribute`): se importan por
// archivo, como ya hacen los otros tests de componentes de este repo.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VideoUploadProgressPanel } from "./upload-progress";
import { VIDEO_COPY, formatBytes, formatBytesPair } from "./copy";

/**
 * LA PANTALLA MÁS IMPORTANTE DE ESTA FEATURE.
 *
 * Con Mux se pueden subir cientos de megas desde un teléfono en 4G, así que
 * alguien se va a quedar mirando esta caja varios minutos. Sus tres
 * obligaciones —decir cuánto va DE VERDAD, dejar salir, y no pedir vigilancia—
 * son lo que este archivo ancla.
 */

const MB = 1024 * 1024;
const BASE = { pct: 34, uploadedBytes: 116 * MB, totalBytes: 340 * MB, offline: false };

afterEach(cleanup);

describe("decir cuánto va, de verdad", () => {
  it("muestra el porcentaje", () => {
    render(<VideoUploadProgressPanel progress={BASE} />);
    expect(screen.getByText("34%")).toBeInTheDocument();
  });

  it("y también los megabytes, que es lo que le da escala a la espera", () => {
    // 3 % de 20 MB y 3 % de 2 GB se ven idénticos en pantalla y son esperas
    // completamente distintas. El porcentaje solo no alcanza.
    render(<VideoUploadProgressPanel progress={BASE} />);
    expect(screen.getByText("116 de 340 MB")).toBeInTheDocument();
  });

  it("la barra es una barra de progreso real, con su valor accesible", () => {
    render(<VideoUploadProgressPanel progress={BASE} />);
    const barra = screen.getByRole("progressbar");
    expect(barra).toHaveAttribute("aria-valuenow", "34");
    expect(barra).toHaveAttribute("aria-valuemin", "0");
    expect(barra).toHaveAttribute("aria-valuemax", "100");
  });

  it("un porcentaje fuera de rango no rompe la barra", () => {
    render(<VideoUploadProgressPanel progress={{ ...BASE, pct: 140 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("sin tamaño conocido no inventa un total", () => {
    render(<VideoUploadProgressPanel progress={{ ...BASE, totalBytes: 0 }} />);
    expect(screen.queryByText(/ de /)).not.toBeInTheDocument();
  });
});

describe("dejar salir", () => {
  it("el botón de cancelar está a la vista y tiene 44 px de área táctil", () => {
    render(<VideoUploadProgressPanel progress={BASE} onCancel={() => {}} />);
    const boton = screen.getByRole("button", { name: VIDEO_COPY.subida.cancelar });
    // `min-h-11` son 44 px: es la salida de una espera larga y no puede pedir
    // puntería.
    expect(boton.className).toContain("min-h-11");
  });

  it("cancela cuando se lo toca", () => {
    const onCancel = vi.fn();
    render(<VideoUploadProgressPanel progress={BASE} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: VIDEO_COPY.subida.cancelar }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("sin forma de cancelar (la subida al bucket) NO pinta un botón que no haría nada", () => {
    render(<VideoUploadProgressPanel progress={BASE} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("no pedir vigilancia", () => {
  it("dice que puede seguir usando la app y que la subida retoma sola", () => {
    render(<VideoUploadProgressPanel progress={BASE} />);
    expect(screen.getByText(VIDEO_COPY.subida.tranquilidad)).toBeInTheDocument();
  });

  it("si se corta el internet lo DICE, en vez de dejar una barra quieta y muda", () => {
    // Una barra parada sin explicación se lee como "se colgó", y la reacción
    // natural es cerrar y volver a empezar: o sea, tirar lo que ya había subido.
    render(<VideoUploadProgressPanel progress={{ ...BASE, offline: true }} />);
    expect(screen.getByText(VIDEO_COPY.subida.sinConexion)).toBeInTheDocument();
    expect(screen.queryByText(VIDEO_COPY.subida.tranquilidad)).not.toBeInTheDocument();
  });

  it("el corte se anuncia solo a un lector de pantalla", () => {
    render(<VideoUploadProgressPanel progress={{ ...BASE, offline: true }} />);
    const avisos = screen.getAllByRole("status");
    expect(avisos.some((n) => n.textContent === VIDEO_COPY.subida.sinConexion)).toBe(true);
  });

  it("sin conexión el progreso NO se borra: los megas ya subidos siguen ahí", () => {
    render(<VideoUploadProgressPanel progress={{ ...BASE, offline: true }} />);
    expect(screen.getByText("34%")).toBeInTheDocument();
    expect(screen.getByText("116 de 340 MB")).toBeInTheDocument();
  });
});

describe("formatBytes — el número tiene que leerse de un vistazo", () => {
  it("elige la unidad según el tamaño", () => {
    expect(formatBytes(900 * 1024)).toBe("900 KB");
    expect(formatBytes(340 * MB)).toBe("340 MB");
    expect(formatBytes(1.25 * 1024 * MB)).toBe("1.3 GB");
  });

  it("no explota con basura", () => {
    expect(formatBytes(Number.NaN)).toBe("0 KB");
    expect(formatBytes(-5)).toBe("0 KB");
  });
});

describe("formatBytesPair — los dos números en la MISMA unidad", () => {
  it("la unidad la fija el total, para que los dos se comparen de un vistazo", () => {
    // Al arranque de una subida de 2 GB, cada número eligiendo su unidad diría
    // "900 KB de 2 GB" — y la persona tendría que convertir mentalmente para
    // saber si va por la mitad.
    expect(formatBytesPair(900 * 1024, 2 * 1024 * MB)).toEqual({
      subido: "0",
      total: "2 GB",
    });
    expect(formatBytesPair(116 * MB, 340 * MB)).toEqual({ subido: "116", total: "340 MB" });
  });

  it("nunca declara más subido que el total", () => {
    expect(formatBytesPair(500 * MB, 340 * MB).subido).toBe("340");
  });

  it("no explota con basura", () => {
    expect(formatBytesPair(Number.NaN, 0)).toEqual({ subido: "0", total: "0 KB" });
  });
});

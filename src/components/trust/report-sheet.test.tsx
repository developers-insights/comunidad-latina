// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportSheet } from "./report-sheet";

/**
 * `rate-limited` no es una falla del sistema: es el límite de 10 reportes por
 * día (reportTargetAction). Mostrarle a quien reporta el copy genérico
 * ("algo salió mal de nuestro lado") es falso, invita a un reintento que va a
 * volver a rebotar, y no le dice que sus reportes anteriores sí entraron.
 */

const reportTargetAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/reportes/actions", () => ({
  reportTargetAction: (input: unknown) => reportTargetAction(input),
}));

// motion neutralizado: la hoja aparece en el DOM al instante.
vi.mock("motion/react", () => {
  const filter = (props: Record<string, unknown>) => {
    const {
      layout,
      initial,
      animate,
      exit,
      transition,
      drag,
      dragConstraints,
      dragElastic,
      onDragEnd,
      whileTap,
      whileHover,
      ...rest
    } = props;
    return rest;
  };
  const div = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => true,
  };
});

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

function openSheet() {
  render(<ReportSheet open onClose={() => {}} targetKind="profile" targetId={TARGET_ID} />);
}

describe("ReportSheet: copy cuando el envío rebota", () => {
  beforeEach(() => {
    reportTargetAction.mockReset();
  });
  afterEach(cleanup);

  it("con rate-limited avisa que hay que esperar, no que algo salió mal de nuestro lado", async () => {
    reportTargetAction.mockResolvedValue({ ok: false, code: "rate-limited" });
    openSheet();

    fireEvent.click(screen.getByRole("button", { name: "Enviar reporte" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Ya enviaste varios reportes hoy. Mañana vas a poder seguir — los que mandaste ya están en revisión.",
    );
    expect(alert.textContent).not.toBe(
      "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    );
  });
});

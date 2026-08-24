// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PollYesNo } from "./poll-yes-no";
import { COPY } from "./copy";
import type { PostPollView } from "./helpers";

/**
 * Encuesta Sí/No de una pregunta (contrato 0041). Lo que este archivo ancla:
 *  1. antes de votar NO se ve el reparto (saberlo sesga la respuesta), sí la
 *     participación;
 *  2. votar emite la acción con el post y la opción, y revela los resultados;
 *  3. cambiar el voto lo MUEVE de balde, no suma uno nuevo;
 *  4. el autor lee su propia encuesta sin tener que votarse;
 *  5. sin sesión, votar lleva a entrar (no falla en silencio);
 *  6. si el servidor rechaza, la UI vuelve atrás y avisa — nunca deja pintado
 *     un voto que no existe.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/feed",
}));

const toast = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast }) };
});

vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock({ reducedMotion: false }),
);

const votePostPollAction = vi.fn();
vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  votePostPollAction: (input: unknown) => votePostPollAction(input),
}));

const POST_ID = "3f1c9d2e-0b44-4a77-9d21-77c2a1b40e10";
const VIEWER = "8c7d6e5f-4a3b-4c2d-9e1f-0a1b2c3d4e5f";

function poll(overrides: Partial<PostPollView> = {}): PostPollView {
  return { kind: "yes_no", yes: 30, no: 50, myVote: null, ...overrides };
}

function mount(props: Partial<React.ComponentProps<typeof PollYesNo>> = {}) {
  return render(
    <PollYesNo postId={POST_ID} poll={poll()} viewerId={VIEWER} {...props} />,
  );
}

// El nombre accesible suma el resultado una vez revelado, así que se busca por
// el prefijo de la acción, no por igualdad exacta.
const yesButton = () =>
  screen.getByRole("button", { name: new RegExp(`^${COPY.post.poll.voteYes}`) });
const noButton = () =>
  screen.getByRole("button", { name: new RegExp(`^${COPY.post.poll.voteNo}`) });

afterEach(() => {
  cleanup();
  push.mockClear();
  toast.mockClear();
  votePostPollAction.mockReset();
});

describe("PollYesNo: los resultados se ganan votando", () => {
  it("antes de votar muestra la participación, no el reparto", () => {
    mount();
    expect(screen.getByText(COPY.post.poll.totalVotes(80))).toBeTruthy();
    expect(screen.queryByText(COPY.post.poll.result(30, 38))).toBeNull();
    expect(screen.queryByText(COPY.post.poll.result(50, 62))).toBeNull();
  });

  it("sin un solo voto lo dice con todas las letras", () => {
    mount({ poll: poll({ yes: 0, no: 0 }) });
    expect(screen.getByText(COPY.post.poll.noVotesYet)).toBeTruthy();
  });

  it("el autor lee su propia encuesta sin votarse", () => {
    mount({ isAuthor: true });
    expect(screen.getByText(COPY.post.poll.result(30, 38))).toBeTruthy();
    expect(screen.getByText(COPY.post.poll.result(50, 62))).toBeTruthy();
  });

  it("los dos porcentajes suman 100 (no se redondean por separado)", () => {
    mount({ isAuthor: true, poll: poll({ yes: 1, no: 2 }) });
    expect(screen.getByText(COPY.post.poll.result(1, 33))).toBeTruthy();
    expect(screen.getByText(COPY.post.poll.result(2, 67))).toBeTruthy();
  });
});

describe("PollYesNo: votar", () => {
  it("emite la acción con el post y la opción elegida", async () => {
    votePostPollAction.mockResolvedValue({ ok: true, choice: true, yes: 31, no: 50 });
    mount();

    fireEvent.click(yesButton());

    await waitFor(() =>
      expect(votePostPollAction).toHaveBeenCalledWith({ postId: POST_ID, choice: true }),
    );
  });

  it("revela conteo y porcentaje de las dos opciones", async () => {
    votePostPollAction.mockResolvedValue({ ok: true, choice: true, yes: 31, no: 50 });
    mount();

    fireEvent.click(yesButton());

    expect(await screen.findByText(COPY.post.poll.result(31, 38))).toBeTruthy();
    expect(screen.getByText(COPY.post.poll.result(50, 62))).toBeTruthy();
  });

  it("la opción elegida queda marcada en aria-pressed, no solo en color", async () => {
    votePostPollAction.mockResolvedValue({ ok: true, choice: true, yes: 31, no: 50 });
    mount();

    fireEvent.click(yesButton());

    await waitFor(() => expect(yesButton().getAttribute("aria-pressed")).toBe("true"));
    expect(noButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("cambiar el voto lo MUEVE de balde: el total no crece", async () => {
    votePostPollAction.mockResolvedValue({ ok: true, choice: false, yes: 29, no: 51 });
    mount({ poll: poll({ myVote: true }) });

    // Arranca con su voto en Sí (30/50 = 80 votos).
    expect(
      screen.getByText(new RegExp(`^${COPY.post.poll.totalVotes(80)}`)),
    ).toBeTruthy();

    fireEvent.click(noButton());

    expect(await screen.findByText(COPY.post.poll.result(29, 36))).toBeTruthy();
    expect(screen.getByText(COPY.post.poll.result(51, 64))).toBeTruthy();
    // 80 antes, 80 después: se movió, no se duplicó.
    expect(
      screen.getByText(new RegExp(`^${COPY.post.poll.totalVotes(80)}`)),
    ).toBeTruthy();
    expect(votePostPollAction).toHaveBeenCalledTimes(1);
  });

  it("volver a tocar la opción ya votada no dispara otra escritura", () => {
    mount({ poll: poll({ myVote: true }) });
    fireEvent.click(yesButton());
    expect(votePostPollAction).not.toHaveBeenCalled();
  });

  it("una vez votado avisa que se puede cambiar", async () => {
    votePostPollAction.mockResolvedValue({ ok: true, choice: true, yes: 31, no: 50 });
    mount();
    fireEvent.click(yesButton());
    expect(
      await screen.findByText(new RegExp(COPY.post.poll.changeHint)),
    ).toBeTruthy();
  });
});

describe("PollYesNo: sesión y errores", () => {
  it("sin sesión, votar lleva a entrar y no escribe nada", () => {
    mount({ viewerId: null });

    fireEvent.click(yesButton());

    expect(votePostPollAction).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
  });

  it("si el servidor rechaza, el voto se revierte y el error se VE", async () => {
    votePostPollAction.mockResolvedValue({ ok: false, code: "error" });
    mount();

    fireEvent.click(yesButton());

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: COPY.post.poll.errorTitle,
      variant: "danger",
    });
    // Vuelve a "no votó": ni marca ni resultados a la vista.
    expect(yesButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(COPY.post.poll.result(31, 38))).toBeNull();
  });

  it("si la sesión se cayó a mitad de camino, va a entrar en vez de un toast mudo", async () => {
    votePostPollAction.mockResolvedValue({ ok: false, code: "unauthenticated" });
    mount();

    fireEvent.click(yesButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/entrar?next=%2Ffeed"));
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("PollYesNo: otra comunidad", () => {
  it("no dice 'probá de nuevo' a quien está mirando otra comunidad", async () => {
    votePostPollAction.mockResolvedValue({
      ok: false,
      code: "tenant-mismatch",
      message: "Estás mirando otra comunidad.",
    });
    mount();

    fireEvent.click(yesButton());

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const shown = toast.mock.calls[0][0];
    expect(shown.title).not.toBe(COPY.post.poll.errorTitle);
    expect(shown.description).toBe("Estás mirando otra comunidad.");
    expect(yesButton().getAttribute("aria-pressed")).toBe("false");
  });
});

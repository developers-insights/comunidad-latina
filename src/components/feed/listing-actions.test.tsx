// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * =============================================================================
 * LA FICHA TAMBIÉN TIENE BARRA — Y NO MIENTE SOBRE LO QUE NO SABE
 * =============================================================================
 *
 * Pedido del cliente (2026-08-31): la barra completa —me gusta, comentar,
 * compartir, guardar— también en las tarjetas de ficha, que hasta hoy sólo
 * tenían "Ver detalles".
 *
 * Lo que se ancla acá tiene tres mitades, y las tres se rompen en silencio:
 *
 *   1. LAS ACCIONES FUNCIONAN DE VERDAD. Guardar escribe con
 *      `subjectKind: "listing"` (no "post": la tabla es polimórfica y el kind
 *      equivocado guardaría contra un id que no existe en `posts`), comentar
 *      abre la hoja por `listingId` (no `postId`) y compartir registra la
 *      métrica DESPUÉS de que el share salió bien.
 *
 *   2. NINGUNA MIENTE. La tarjeta todavía no recibe el conteo de comentarios ni
 *      el me gusta (ver `ListingEngagement`). "No lo sé" se dibuja como ausencia
 *      —sin número, sin corazón—, nunca como un cero. Sin este test, el día que
 *      alguien "complete" la barra con `commentCount ?? 0` la app va a decirle a
 *      la comunidad que un aviso con doce comentarios no tiene ninguno.
 *
 *   3. EL TOQUE NO SACA DEL FEED. Es la regla del 2026-08-20 y esta barra es lo
 *      último que se agregó a la tarjeta: si algo la rompe, va a ser esto.
 */

const state = vi.hoisted(() => ({
  saveResult: { ok: true, saved: true } as
    | { ok: true; saved: boolean }
    | { ok: false; code: string },
  toggleSave: vi.fn(),
  recordShare: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  openComments: vi.fn(),
  clipboard: vi.fn(),
}));

vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  toggleSaveAction: (input: unknown) => {
    state.toggleSave(input);
    return Promise.resolve(state.saveResult);
  },
  recordListingShareAction: (input: unknown) => {
    state.recordShare(input);
    return Promise.resolve();
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh }),
  usePathname: () => "/feed",
}));

// useToast lanza fuera de su provider: se reemplaza SOLO ese hook.
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

// La hoja de comentarios arrastra Supabase y las actions del marketplace: acá
// interesa CON QUÉ se la llama, no qué dibuja.
vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: state.openComments }),
}));

import { ListingActions } from "./listing-actions";

const LISTING_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const TITLE = "Compañía de construcción";
const HREF = `/negocios/${LISTING_ID}`;

function barra(props: Partial<React.ComponentProps<typeof ListingActions>> = {}) {
  return (
    <ListingActions listingId={LISTING_ID} title={TITLE} detailHref={HREF} {...props} />
  );
}

/** Los botones se buscan por su nombre accesible, que lleva el título del aviso. */
const boton = (rotulo: string) =>
  screen.getByRole("button", { name: new RegExp(`^${rotulo}`) });
const botonOpcional = (rotulo: string) =>
  screen.queryByRole("button", { name: new RegExp(`^${rotulo}`) });

beforeEach(() => {
  state.saveResult = { ok: true, saved: true };
  state.toggleSave.mockClear();
  state.recordShare.mockClear();
  state.toast.mockClear();
  state.push.mockClear();
  state.openComments.mockClear();
  state.clipboard.mockClear().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: state.clipboard },
    configurable: true,
  });
});

afterEach(cleanup);

describe("la barra que la ficha no tenía", () => {
  it("trae las tres acciones que hoy funcionan de punta a punta", () => {
    render(barra());
    expect(botonOpcional("Comentarios")).not.toBeNull();
    expect(botonOpcional("Compartir")).not.toBeNull();
    expect(botonOpcional("Guardar")).not.toBeNull();
  });

  /**
   * `listings.like_count` no existe (la 0124 está escrita y sin aplicar), así
   * que no hay número que mostrar. Antes que un corazón que suma y vuelve a
   * cero al recargar, no hay corazón.
   */
  it("sin estado de me gusta NO dibuja el corazón", () => {
    render(barra());
    expect(botonOpcional("Me gusta")).toBeNull();
  });

  it("con el me gusta ya resuelto, el corazón aparece con su número", () => {
    const toggle = vi.fn();
    render(barra({ like: { liked: false, count: 24, toggle } }));

    const corazon = boton("Me gusta");
    expect(corazon.textContent).toContain("24");
    fireEvent.click(corazon);
    expect(toggle).toHaveBeenCalledWith(true);
  });
});

describe("guardar — polimórfico y optimista", () => {
  it("se marca al instante y manda subjectKind listing", async () => {
    render(barra());
    fireEvent.click(boton("Guardar"));

    // Optimista: ya está marcado antes de que responda el server.
    expect(boton("Quitar de guardados").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => {
      expect(state.toggleSave).toHaveBeenCalledWith({
        subjectKind: "listing",
        subjectId: LISTING_ID,
        save: true,
      });
    });
  });

  it("arranca marcado si el viewer ya lo tenía guardado", () => {
    render(barra({ savedByViewer: true }));
    expect(boton("Quitar de guardados").getAttribute("aria-pressed")).toBe("true");
  });

  it("si el server dice que no, revierte Y lo dice (nada de catch mudo)", async () => {
    state.saveResult = { ok: false, code: "error" };
    render(barra());
    fireEvent.click(boton("Guardar"));

    await waitFor(() =>
      expect(boton("Guardar").getAttribute("aria-pressed")).toBe("false"),
    );
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "danger" }),
    );
  });

  it("sesión caída: revierte y manda a entrar, sin cartel de error", async () => {
    state.saveResult = { ok: false, code: "unauthenticated" };
    render(barra());
    fireEvent.click(boton("Guardar"));

    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed"));
    expect(boton("Guardar").getAttribute("aria-pressed")).toBe("false");
    expect(state.toast).not.toHaveBeenCalled();
  });
});

describe("comentar — la hoja polimórfica, por listingId", () => {
  it("abre la hoja del aviso, no la de un post", () => {
    render(barra({ commentCount: 8 }));
    fireEvent.click(boton("Comentarios"));

    expect(state.openComments).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      commentCount: 8,
    });
    expect(state.openComments.mock.calls[0][0]).not.toHaveProperty("postId");
  });

  it("con conteo conocido, lo muestra", () => {
    render(barra({ commentCount: 8 }));
    expect(boton("Comentarios").textContent).toContain("8");
  });

  /**
   * EL TEST QUE IMPORTA. `LISTING_COLUMNS` todavía no selecciona
   * `comment_count`: "no lo sé" no se puede dibujar como "cero".
   */
  it("sin conteo NO anuncia un cero, ni en el botón ni en la hoja", () => {
    render(barra());
    const b = boton("Comentarios");

    expect(b.textContent).not.toMatch(/\d/);
    expect(b.getAttribute("aria-label")).not.toMatch(/\d/);
    fireEvent.click(b);
    expect(state.openComments).toHaveBeenCalledWith({ listingId: LISTING_ID });
    expect(state.openComments.mock.calls[0][0]).not.toHaveProperty("commentCount");
  });
});

describe("compartir — el link canónico, y la métrica sólo si salió", () => {
  it("copia la URL del aviso y recién ahí registra la compartida", async () => {
    render(barra());
    fireEvent.click(boton("Compartir"));

    await waitFor(() =>
      expect(state.clipboard).toHaveBeenCalledWith(`${window.location.origin}${HREF}`),
    );
    await waitFor(() =>
      expect(state.recordShare).toHaveBeenCalledWith({ listingId: LISTING_ID }),
    );
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success" }),
    );
  });

  /** Cancelar el diálogo del sistema no es una compartida. */
  it("si el share falla o se cancela, NO cuenta la compartida", async () => {
    state.clipboard.mockRejectedValue(new Error("cancelado"));
    render(barra());
    fireEvent.click(boton("Compartir"));

    await waitFor(() => expect(state.clipboard).toHaveBeenCalled());
    expect(state.recordShare).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });

  /** Un kind sin página no tiene URL que compartir: mejor sin botón que con link roto. */
  it("sin URL canónica no hay botón de compartir", () => {
    render(barra({ detailHref: null }));
    expect(botonOpcional("Compartir")).toBeNull();
    expect(botonOpcional("Guardar")).not.toBeNull();
  });
});

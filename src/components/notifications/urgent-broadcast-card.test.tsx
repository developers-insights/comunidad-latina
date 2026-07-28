// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  URGENT_BROADCAST_COPY as COPY,
  UrgentBroadcastCard,
} from "./urgent-broadcast-card";

/**
 * La alerta comunitaria en pantalla. Lo que este archivo ancla:
 *  1. se lee como la PLATAFORMA hablando, no como el post de un vecino;
 *  2. descartarla escribe el acuse que YA EXISTE (broadcast_receipts) y la
 *     saca — no vuelve;
 *  3. si el acuse falla, la alerta SIGUE puesta y se avisa: una emergencia no
 *     desaparece por un error de red;
 *  4. el CTA externo sale con el `rel` correcto, y un href peligroso no se
 *     ofrece como botón.
 */

const toast = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast }) };
});

const dismissBroadcastAction = vi.fn();
vi.mock("@/app/(app)/notificaciones/actions", () => ({
  dismissBroadcastAction: (id: string) => dismissBroadcastAction(id),
}));

const BROADCAST = {
  id: "019fa5dd-b858-7a1c-98c9-eba756896870",
  title: "Buscamos a Ramón Peña",
  body: "Se lo vio por última vez el jueves en Washington Heights.",
  ctaUrl: null as string | null,
};

function mount(overrides: Partial<typeof BROADCAST> = {}) {
  return render(<UrgentBroadcastCard broadcast={{ ...BROADCAST, ...overrides }} />);
}

beforeEach(() => {
  dismissBroadcastAction.mockReset().mockResolvedValue({ ok: true });
  toast.mockReset();
});
afterEach(cleanup);

describe("se lee como la voz de la plataforma", () => {
  it("muestra quién habla, el título y el cuerpo", () => {
    mount();
    expect(screen.getByText(COPY.eyebrow)).toBeTruthy();
    expect(screen.getByRole("heading", { name: BROADCAST.title })).toBeTruthy();
    expect(screen.getByText(BROADCAST.body)).toBeTruthy();
  });

  it("es una región con nombre propio: el lector de pantalla la puede saltar y volver", () => {
    mount();
    expect(screen.getByRole("region", { name: COPY.regionLabel })).toBeTruthy();
  });
});

describe("descartar: el acuse que ya existía", () => {
  it("escribe el receipt del broadcast y la alerta se va", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: COPY.dismiss }));

    await waitFor(() => {
      expect(dismissBroadcastAction).toHaveBeenCalledWith(BROADCAST.id);
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: COPY.regionLabel })).toBeNull();
    });
  });

  it("si el acuse falla, la alerta SIGUE ahí y se avisa", async () => {
    dismissBroadcastAction.mockResolvedValue({ ok: false, code: "error" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: COPY.dismiss }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.getByRole("region", { name: COPY.regionLabel })).toBeTruthy();
  });
});

describe("el CTA", () => {
  it("sin cta_url no hay botón de acción, solo el de cerrar", () => {
    mount();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: COPY.dismiss })).toBeTruthy();
  });

  it("link externo: nueva pestaña, rel correcto y aviso en el nombre accesible", () => {
    mount({ ctaUrl: "https://ayuda.example.org/acopio" });
    const link = screen.getByRole("link", {
      name: `${COPY.cta} ${COPY.ctaExternalHint}`,
    });

    expect(link.getAttribute("href")).toBe("https://ayuda.example.org/acopio");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("tocar el CTA también acusa recibo: si fuiste a ver, ya la viste", async () => {
    mount({ ctaUrl: "/guias/centros-de-acopio" });
    fireEvent.click(screen.getByRole("link", { name: COPY.cta }));

    await waitFor(() => {
      expect(dismissBroadcastAction).toHaveBeenCalledWith(BROADCAST.id);
    });
  });

  it("ruta interna: sin target ni rel de externo", () => {
    mount({ ctaUrl: "/guias/centros-de-acopio" });
    const link = screen.getByRole("link", { name: COPY.cta });
    expect(link.getAttribute("href")).toBe("/guias/centros-de-acopio");
    expect(link.getAttribute("target")).toBeNull();
  });
});

/**
 * REDIRECCIÓN ABIERTA — la validación del destino ya NO vive en esta card: la
 * hace `safeExternalHref` (src/lib/url/safe-href.ts), que clasifica por ORIGEN
 * resuelto y tiene sus 11 casos en su propio archivo. Acá no se repiten: lo que
 * se ancla es que ESTA card esté cableada a ese helper y no a un chequeo propio
 * de prefijos —que es lo que la dejaba escapar del sitio— y qué termina en el
 * DOM, que es donde el usuario lo toca.
 */
describe("el destino del CTA no puede sacarte del sitio disfrazado de ruta interna", () => {
  it("`/\\evil.com` NO se ofrece como interna: sale marcado como externo", () => {
    // El bypass exacto de la auditoría: el guard viejo tapaba `//` pero no `/\`,
    // y el parser trata `\` como `/`. Se iba a otro origen desde un <a> que
    // parecía interno — sin pestaña nueva y sin `rel`.
    mount({ ctaUrl: "/\\evil.example.com/entrar" });
    const link = screen.getByRole("link", {
      name: `${COPY.cta} ${COPY.ctaExternalHint}`,
    });

    expect(link.getAttribute("href")).toBe("https://evil.example.com/entrar");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("`//evil.com` (protocol-relative) tampoco pasa por interna", () => {
    mount({ ctaUrl: "//evil.example.com/entrar" });
    const link = screen.getByRole("link", {
      name: `${COPY.cta} ${COPY.ctaExternalHint}`,
    });
    expect(link.getAttribute("href")).toBe("https://evil.example.com/entrar");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("un href peligroso no llega al DOM ni como link roto", () => {
    mount({ ctaUrl: "javascript:alert(1)" });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("data: tampoco — `z.url()` del panel admin lo deja pasar", () => {
    mount({ ctaUrl: "data:text/html,<script>alert(1)</script>" });
    expect(screen.queryByRole("link")).toBeNull();
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";
import { CONSENT_STORAGE_KEY } from "@/lib/consent";
import { PrivacyControls } from "./privacy-controls";

/**
 * El recorrido completo de Ajustes › Privacidad.
 *
 * Se prueba acá y no en el navegador porque en el navegador embebido de este
 * entorno las animaciones de `motion` NO CORREN: el diálogo se queda para
 * siempre en su estilo `initial` (medido: `opacity` 0 a los 100, 300, 600 y
 * 1200 ms al ABRIRLO, con `prefers-reduced-motion` en false). Eso afecta al
 * `Dialog` compartido y a sus 8 usos previos por igual, así que es una
 * limitación del entorno y no del código — pero significa que abrir y cerrar
 * un modal no se puede verificar con los ojos ahí. Se verifica acá.
 */

const SESION = "sb-proj-auth-token";

function renderControls() {
  return render(
    <ToastProvider>
      <PrivacyControls />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  cleanup();
  vi.restoreAllMocks();
});

describe("lo que hay en este teléfono", () => {
  it("lista las preferencias reales apenas se entra, sin tocar nada", () => {
    // Regresión: con `useSyncExternalStore` + snapshot de servidor vacío, la
    // lista salía vacía hasta que algo notificara al store. La persona entraba,
    // leía "no hay nada guardado" y era mentira.
    window.localStorage.setItem("cl-theme", "dark");
    window.localStorage.setItem("cl:buscar:historial:x:anon", '["abogado"]');

    renderControls();

    expect(screen.getByText("cl-theme")).toBeTruthy();
    expect(screen.getByText("cl:buscar:historial:x:anon")).toBeTruthy();
  });

  it("no ofrece borrar cuando no hay nada", () => {
    renderControls();
    expect(screen.queryByRole("button", { name: /Borrar de este teléfono/ })).toBeNull();
    expect(screen.getByText(/no hay nada guardado en este teléfono/i)).toBeTruthy();
  });

  it("nunca muestra la sesión como algo borrable", () => {
    window.localStorage.setItem(SESION, "token");
    renderControls();
    expect(screen.queryByText(SESION)).toBeNull();
  });
});

describe("borrar lo de este teléfono", () => {
  it("pide confirmación antes de borrar", () => {
    window.localStorage.setItem("cl-theme", "dark");
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /Borrar de este teléfono/ }));

    expect(screen.getByText("¿Borrar lo guardado en este teléfono?")).toBeTruthy();
    // Todavía NO borró nada: confirmar es un paso aparte.
    expect(window.localStorage.getItem("cl-theme")).toBe("dark");
  });

  it("«Mejor no» cierra sin borrar", async () => {
    window.localStorage.setItem("cl-theme", "dark");
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /Borrar de este teléfono/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mejor no" }));

    await waitFor(() => {
      expect(screen.queryByText("¿Borrar lo guardado en este teléfono?")).toBeNull();
    });
    expect(window.localStorage.getItem("cl-theme")).toBe("dark");
  });

  it("confirmar borra las preferencias, deja la sesión y refresca la lista sola", async () => {
    window.localStorage.setItem("cl-theme", "dark");
    window.localStorage.setItem("cl:buscar:historial:x:anon", '["cuarto barato"]');
    window.localStorage.setItem(SESION, "SESION-VIVA");
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "{}");

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /Borrar de este teléfono/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));

    await waitFor(() => {
      expect(screen.getByText(/Borrado\. Tu cuenta y tus publicaciones siguen intactas\./)).toBeTruthy();
    });

    // Lo que se fue:
    expect(window.localStorage.getItem("cl-theme")).toBeNull();
    expect(window.localStorage.getItem("cl:buscar:historial:x:anon")).toBeNull();
    // Lo que NO se toca, pase lo que pase:
    expect(window.localStorage.getItem(SESION)).toBe("SESION-VIVA");
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("{}");

    // Y la lista se actualiza sin recargar.
    await waitFor(() => {
      expect(screen.queryByText("cl-theme")).toBeNull();
    });

    // El diálogo se cierra de verdad: si quedara montado, su contenedor
    // `fixed inset-0` taparía la página entera aunque fuera invisible.
    await waitFor(() => {
      expect(screen.queryByText("¿Borrar lo guardado en este teléfono?")).toBeNull();
    });
  });
});

describe("honestidad de la pantalla", () => {
  it("dice que hoy no hay nada que consentir, en vez de fingir controles", () => {
    renderControls();
    expect(screen.getByText("Hoy no hay nada que consentir")).toBeTruthy();
  });

  it("sin decisión guardada lo dice, y no ofrece revocar lo que no existe", () => {
    renderControls();
    expect(screen.getByText(/Todavía no elegiste nada/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Volver a preguntarme/ })).toBeNull();
  });
});

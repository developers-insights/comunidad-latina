// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./message-menu", () => ({
  MessageActions: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./message-reactions", () => ({
  ReaccionesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MessageReactions: () => null,
}));

import { MessageBubble } from "./message-bubble";
import { GroupMessageBubble } from "./group-message-bubble";

const URL_EXTERNA = "https://youtube.com/watch?v=abc";

afterEach(cleanup);

describe("tarjeta de enlace externo en mensajes", () => {
  it("reemplaza una URL sola por la tarjeta segura en el chat directo", () => {
    render(
      <MessageBubble
        body={URL_EXTERNA}
        isOwn={false}
        timeLabel="12:30"
        acciones={{
          mensajeId: "mensaje-1",
          hiloId: "hilo-1",
          createdAt: "2026-09-09T12:30:00.000Z",
          kind: "texto",
          autorNombre: "Ana",
          nombrePropio: "Manuel",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Abrir enlace externo de youtube.com" })).toBeTruthy();
    expect(screen.queryByText(URL_EXTERNA)).toBeNull();
  });

  it("reemplaza una URL sola por la misma tarjeta en un grupo", () => {
    render(
      <GroupMessageBubble
        body={URL_EXTERNA}
        isOwn={false}
        timeLabel="12:30"
        autorNombre="Ana"
        autorAvatar={null}
        mostrarAutor
        mensaje={{
          mensajeId: "mensaje-1",
          hiloId: "grupo-1",
          createdAt: "2026-09-09T12:30:00.000Z",
          kind: "texto",
          nombrePropio: "Manuel",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Abrir enlace externo de youtube.com" })).toBeTruthy();
    expect(screen.queryByText(URL_EXTERNA)).toBeNull();
  });
});

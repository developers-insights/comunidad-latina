// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PhotoCredit } from "./photo-credit";
import { PostCard } from "./post-card";
import { CardLikeProvider } from "./card-like-context";
import type { PostCardModel } from "./helpers";
import { CREDITO_COPY } from "@/lib/feed/creditos-de-foto";

/**
 * DERECHOS Y FUENTE DE LA FOTO EN LA PUBLICACIÓN (0146, punto 11 del pliego).
 *
 * El campo ya se preguntaba en el composer desde la 0061; lo que no existía era
 * que la respuesta se VIERA. Una declaración de derechos que sólo lee el equipo
 * de moderación no cumple la función que el cliente pidió: quien podría
 * reconocer una foto suya y reclamarla es justamente quien está mirando la
 * publicación.
 *
 * Lo que se ancla acá, en orden de importancia:
 *  1. el disclaimer VIAJA SIEMPRE — sin él, "Foto propia" se lee como un sello
 *     de la plataforma, y no lo es;
 *  2. el crédito NUNCA es un link, aunque el texto sea una URL;
 *  3. sin declaración no se pinta nada (ni la línea ni un separador huérfano);
 *  4. una publicación sin foto no muestra crédito aunque el modelo lo traiga.
 */

const POST_ID = "77777777-7777-4777-8777-777777777777";

const BASE_POST: PostCardModel = {
  id: POST_ID,
  kind: "post",
  body: "Se llenó la feria.",
  photoUrl: "https://cdn.example.com/feria.jpg",
  media: [{ kind: "image", url: "https://cdn.example.com/feria.jpg" }],
  likeCount: 0,
  commentCount: 0,
  createdAt: "2026-09-07T12:00:00.000Z",
  timeAgoLabel: "hace un rato",
  author: {
    profileId: null,
    displayName: "María Peralta",
    avatarUrl: null,
    score: 60,
    level: "verificado",
    signals: [],
  },
  likedByViewer: false,
  savedByViewer: false,
  poll: null,
  viewCount: 0,
  entity: null,
  isPromoted: false,
  ctaWhatsapp: null,
  taggedPeople: [],
  music: null,
  postMenu: {
    authorId: null,
    status: "published",
    mediaPaths: [],
    pinnedAt: null,
    hiddenAt: null,
    commentsLockedAt: null,
  },
};

function renderCard(post: PostCardModel) {
  return render(
    <CardLikeProvider
      postId={post.id}
      tenantId="11111111-1111-4111-8111-111111111111"
      viewerId={null}
      likeCount={post.likeCount}
      likedByViewer={post.likedByViewer}
    >
      <PostCard post={post} tenantId="11111111-1111-4111-8111-111111111111" viewerId={null} />
    </CardLikeProvider>,
  );
}

afterEach(cleanup);

describe("PhotoCredit — la línea", () => {
  it("escribe el origen y la fuente en una sola línea legible", () => {
    render(<PhotoCredit credito={{ rights: "libre", credit: "Unsplash" }} />);
    expect(screen.getByText(/Foto de uso libre · Unsplash/)).toBeTruthy();
  });

  it("sin fuente muestra sólo el origen", () => {
    render(<PhotoCredit credito={{ rights: "propia", credit: null }} />);
    expect(screen.getByText(/Foto propia/)).toBeTruthy();
  });

  it("el disclaimer viaja SIEMPRE, para el mouse y para el lector de pantalla", () => {
    // NO ES DECORACIÓN. Es el mismo criterio legal que el verificador: lo que
    // dice la persona no puede mostrarse como algo que la plataforma comprobó.
    const { container } = render(
      <PhotoCredit credito={{ rights: "propia", credit: null }} />,
    );

    const linea = container.querySelector("p")!;
    expect(linea.getAttribute("title")).toBe(CREDITO_COPY.disclaimer);
    expect(linea.querySelector(".sr-only")?.textContent).toContain(
      CREDITO_COPY.disclaimer,
    );
  });

  it("una fuente que es una URL se pinta como TEXTO, nunca como link", () => {
    // Un crédito clickeable convierte un campo opcional en una superficie de
    // phishing con la credibilidad de la plataforma detrás.
    const { container } = render(
      <PhotoCredit credito={{ rights: "de_otra_fuente", credit: "https://sitio.ejemplo/x" }} />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/https:\/\/sitio\.ejemplo\/x/)).toBeTruthy();
  });

  it("se recorta a dos líneas en vez de empujar la tarjeta", () => {
    const { container } = render(
      <PhotoCredit credito={{ rights: "libre", credit: "a".repeat(400) }} />,
    );
    expect(container.querySelector("p")?.className).toContain("line-clamp-2");
  });
});

describe("PostCard — cuándo aparece el crédito", () => {
  it("una publicación con foto y declaración lo muestra", () => {
    renderCard({
      ...BASE_POST,
      photoCredit: { rights: "con_permiso", credit: "Revista Semana" },
    });
    expect(screen.getByText(/Foto usada con permiso · Revista Semana/)).toBeTruthy();
  });

  it("sin declaración no pinta ninguna línea", () => {
    renderCard({ ...BASE_POST, photoCredit: null });
    expect(screen.queryByText(/^Foto /)).toBeNull();
  });

  it("una superficie que todavía no resuelve el crédito tampoco lo inventa", () => {
    // `undefined` = "esta consulta no preguntó", que se pinta igual que "no
    // declaró" pero NO significa lo mismo.
    renderCard({ ...BASE_POST, photoCredit: undefined });
    expect(screen.queryByText(/^Foto /)).toBeNull();
  });

  it("una publicación SIN foto no muestra crédito aunque el modelo lo traiga", () => {
    // Un crédito sin archivo del que hablar es un dato huérfano. La 0146 no lo
    // frena con un CHECK a propósito (rompería quitar la última foto de un post
    // ya publicado, 0097), así que el freno vive acá.
    renderCard({
      ...BASE_POST,
      kind: "text",
      photoUrl: null,
      media: [],
      photoCredit: { rights: "propia", credit: null },
    });
    expect(screen.queryByText(/^Foto propia/)).toBeNull();
  });
});

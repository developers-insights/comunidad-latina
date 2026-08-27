// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PostCard } from "./post-card";
import type { AuthorView, PostCardModel, PostEntityView } from "./helpers";

/**
 * =============================================================================
 * PUBLICAR COMO NEGOCIO NO PUEDE DELATAR A LA PERSONA
 * =============================================================================
 *
 * Pedido del cliente, con captura de una publicación que decía «Panadería La
 * esperanza · Negocio / por GEOVANNY»: «cuando se publica con otro perfil,
 * sacar la parte de por geovanny».
 *
 * No es cosmético y por eso tiene test propio: `posts.entity_listing_id` es la
 * FIRMA de la publicación (0023, y las 0116/0117 lo repiten para comentarios,
 * me gusta y reseñas con el mismo predicado). Que la tarjeta trajera `entity`
 * significa que la publicación SALIÓ con la cara del negocio; imprimir debajo el
 * nombre y apellido de quien está detrás del mostrador expone a alguien que
 * eligió no aparecer. Un refactor de la cabecera puede volver a meter esa línea
 * sin que nadie lo note mirando la pantalla —hay que tener un post de entidad a
 * mano para verlo—, así que la regla se ancla acá.
 *
 * Lo que se prueba es la regla en los dos sentidos: con firma NO aparece nada de
 * la persona, y sin firma la autoría personal sigue entera (sacarla de más
 * dejaría el feed sin autor, que es el bug opuesto y también real).
 */

// La tarjeta monta islas de cliente (medios, me gusta, acciones, menú) que
// necesitan providers, portales y server actions. Nada de eso participa de lo
// que se mide acá —qué texto sale en la cabecera— así que se apagan.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("./card-like-context", () => ({
  CardLikeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./card-media-context", () => ({
  CardMediaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./card-post-media", () => ({ CardPostMedia: () => null }));
vi.mock("./post-actions", () => ({ PostActions: () => null }));
vi.mock("./poll-yes-no", () => ({ PollYesNo: () => null }));
vi.mock("./post-caption", () => ({
  PostCaption: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("./question-banner", () => ({ QuestionBanner: () => null }));
vi.mock("./text-banner", () => ({ TextBanner: () => null }));
vi.mock("./tagged-people", () => ({ TaggedPeople: () => null }));

/** El nombre PERSONAL: lo que no puede aparecer en un post firmado por la ficha. */
const NOMBRE_PERSONAL = "GEOVANNY";

const AUTOR: AuthorView = {
  profileId: "019fa477-58e6-7ab9-ae4f-cc41716f6420",
  displayName: NOMBRE_PERSONAL,
  avatarUrl: "https://ejemplo.test/foto-de-geovanny.jpg",
  score: 21,
  level: "nuevo",
  signals: [],
};

const PANADERIA: PostEntityView = {
  id: "019fa477-58e6-7ab9-ae4f-cc41716f6421",
  title: "Panadería La esperanza",
  kind: "business",
  photoUrl: "https://ejemplo.test/foto-de-la-panaderia.jpg",
};

function post(overrides: Partial<PostCardModel> = {}): PostCardModel {
  return {
    id: "019fa477-58e6-7ab9-ae4f-cc41716f6422",
    kind: "post",
    body: "Hoy horneamos pan de agua",
    photoUrl: null,
    media: [],
    likeCount: 0,
    commentCount: 0,
    createdAt: "2026-08-26T12:00:00Z",
    timeAgoLabel: "hace 2 h",
    author: AUTOR,
    likedByViewer: false,
    savedByViewer: false,
    viewCount: 0,
    poll: null,
    entity: null,
    isPromoted: false,
    ctaWhatsapp: null,
    taggedPeople: [],
    music: null,
    postMenu: {
      authorId: AUTOR.profileId,
      status: "published",
      mediaPaths: [],
      pinnedAt: null,
      hiddenAt: null,
      commentsLockedAt: null,
    },
    ...overrides,
  };
}

function renderCard(model: PostCardModel) {
  return render(<PostCard post={model} tenantId="t" viewerId={null} />);
}

afterEach(cleanup);

describe("PostCard · publicación firmada por una ficha", () => {
  it("NO muestra el nombre personal de quien publicó", () => {
    const { container } = renderCard(post({ entity: PANADERIA }));

    // Sobre el texto entero de la tarjeta, no sobre un nodo elegido: así el
    // test no depende de dónde esté la línea, sólo de que no exista.
    expect(container.textContent).not.toContain(NOMBRE_PERSONAL);
    // Y la frase exacta que el cliente señaló, por si el nombre cambiara de
    // forma en el camino.
    expect(container.textContent).not.toContain(`por ${NOMBRE_PERSONAL}`);
  });

  it("NO muestra tampoco la FOTO de la persona: la cara filtra igual que el nombre", () => {
    const { container } = renderCard(post({ entity: PANADERIA }));

    const fuentes = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(fuentes).not.toContain(AUTOR.avatarUrl);
  });

  it("el nombre accesible de la publicación es el de la ficha, no el de la persona", () => {
    renderCard(post({ entity: PANADERIA }));

    expect(
      screen.getByRole("article", { name: `Publicación de ${PANADERIA.title}` }),
    ).toBeTruthy();
  });

  it("muestra la ficha como autora, con su nombre y su link", () => {
    renderCard(post({ entity: PANADERIA }));

    const link = screen.getByRole("link", { name: PANADERIA.title });
    expect(link.getAttribute("href")).toBe(`/negocios/${PANADERIA.id}`);
  });

  it("conserva la hora de publicación (se movió, no se perdió)", () => {
    renderCard(post({ entity: PANADERIA, timeAgoLabel: "hace 2 h" }));

    expect(screen.getAllByText("hace 2 h")).toHaveLength(1);
  });

  /**
   * Ocultar la autoría en la PANTALLA no es borrarla del sistema: reportar y
   * moderar siguen necesitando saber de quién es la publicación, y para eso está
   * `postMenu.authorId`, que viaja en el modelo y no se pinta.
   */
  it("sigue llevando el authorId en el modelo para reportes y moderación", () => {
    const model = post({ entity: PANADERIA });
    renderCard(model);

    expect(model.postMenu.authorId).toBe(AUTOR.profileId);
  });
});

describe("PostCard · publicación personal", () => {
  it("SÍ muestra el nombre de la persona cuando publicó como ella misma", () => {
    renderCard(post({ entity: null }));

    expect(screen.getByText(NOMBRE_PERSONAL)).toBeTruthy();
  });

  it("el nombre accesible nombra a la persona", () => {
    renderCard(post({ entity: null }));

    expect(
      screen.getByRole("article", { name: `Publicación de ${NOMBRE_PERSONAL}` }),
    ).toBeTruthy();
  });
});

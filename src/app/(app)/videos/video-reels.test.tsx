// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PostCardModel } from "@/components/feed";
import type { PostMusicView } from "@/components/feed/helpers";

/**
 * ME GUSTA Y GUARDAR EN EL REEL, SIN QUE TE SAQUEN DEL VIDEO (cliente
 * 2026-08-20: "mientras menos pasos mejor").
 *
 * Los dos botones del riel hacían `router.push("/entrar?next=/videos")`. El
 * `next` estaba, sí, pero devolvía al REEL DESDE EL PRINCIPIO: se perdía el
 * video que estaba mirando, la posición del scroll infinito y el sonido que
 * había desbloqueado con un toque. Volver "a /videos" no es volver a donde
 * estaba.
 *
 * Lo que se fija acá:
 *  · que ninguno de los dos navega;
 *  · que al entrar la acción se aplica sola sobre el MISMO video;
 *  · y que mientras la hoja está abierta el video se PARA. Es pantalla completa
 *    con audio y la hoja es un panel opaco: sin esto, la persona llena un
 *    formulario de entrada escuchando un video que ya no ve.
 */

const state = vi.hoisted(() => ({
  saveResult: { ok: true, saved: true } as
    | { ok: true; saved: boolean }
    | { ok: false; code: string; message?: string },
  insert: vi.fn(),
  toggleSave: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  openComments: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        state.insert(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  recordPostViewAction: vi.fn(async () => undefined),
  toggleSaveAction: (input: unknown) => {
    state.toggleSave(input);
    return Promise.resolve(state.saveResult);
  },
}));

vi.mock("./actions", () => ({ loadMoreVideosAction: vi.fn() }));

// El barrel del feed arrastra la hoja de comentarios (Supabase + las actions
// del marketplace). Del reel sólo se usa este hook.
vi.mock("@/components/feed", () => ({
  useCommentsSheet: () => ({ open: state.openComments }),
}));

// El reproductor de verdad pide `HTMLMediaElement.play`, que jsdom no tiene.
// El stub publica lo único que este test necesita saber: si está activo.
vi.mock("@/components/feed/media-viewer", () => ({
  ViewerVideo: ({
    active,
    muted,
    preload,
    posterUrl,
    fullVideoHref,
  }: {
    active: boolean;
    muted: boolean;
    preload?: string;
    posterUrl?: string | null;
    fullVideoHref?: string | null;
  }) => (
    <div
      data-testid="reproductor"
      data-active={String(active)}
      // Lo que el slide DECIDE sobre este video: si va mudo (lo resuelve el
      // árbitro de audio con la música de la publicación), cuánto se precarga y
      // qué se pinta mientras el archivo no llegó.
      data-muted={String(muted)}
      data-preload={preload ?? ""}
      data-poster={posterUrl ?? ""}
      // Si el slide detectó un video LARGO, éste es su destino: el reproductor
      // frena a los 59 s y ofrece "Ver video completo" (2026-09-03).
      data-largo={fullVideoHref ?? ""}
    />
  ),
}));

vi.mock("@/components/listings", () => ({
  PublisherTrust: () => null,
  firstNameOf: (name: string) => name,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/videos",
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({
    onAuthenticated,
    onDismiss,
  }: {
    onAuthenticated: () => void;
    onDismiss: () => void;
  }) => (
    <>
      <button type="button" onClick={onAuthenticated}>
        stub-entrar
      </button>
      <button type="button" onClick={onDismiss}>
        stub-cerrar
      </button>
    </>
  ),
}));

import { AUTH_REASON, AuthSheetProvider } from "@/components/auth/auth-sheet";
import { VideoReels } from "./video-reels";
import { VIDEOS_COPY } from "./copy";

const VIDEO: PostCardModel = {
  id: "post-1",
  kind: "post",
  body: "Bailando en el barrio",
  photoUrl: null,
  media: [{ kind: "video", url: "https://cdn.test/video.mp4" }],
  likeCount: 7,
  commentCount: 2,
  createdAt: "2026-08-19T12:00:00.000Z",
  timeAgoLabel: "hace 1 d",
  author: {
    profileId: "autor-1",
    displayName: "Rosa Fernández",
    avatarUrl: null,
    score: 60,
    level: "confiable",
    signals: [],
  },
  likedByViewer: false,
  savedByViewer: false,
  viewCount: 12,
  poll: null,
  entity: null,
  isPromoted: false,
  ctaWhatsapp: null,
  taggedPeople: [],
  music: null,
  postMenu: {
    authorId: "autor-1",
    status: "published",
    mediaPaths: [],
    pinnedAt: null,
    hiddenAt: null,
    commentsLockedAt: null,
  },
  videoType: "short_video",
  durationSeconds: 30,
  isPaidAd: false,
  eligibleForShortFeed: true,
};

/**
 * El reel se pinta con el `viewerId` que baja del servidor. `montar` devuelve
 * `entra`, que simula lo que hace `router.refresh()` después de entrar: el mismo
 * árbol, con el viewer ya resuelto.
 */
function montar(viewerId: string | null) {
  const ui = (id: string | null) => (
    <AuthSheetProvider>
      <VideoReels
        tenantId="tenant-1"
        viewerId={id}
        scope="para-ti"
        initialItems={[VIDEO]}
        initialCursor={null}
      />
    </AuthSheetProvider>
  );
  const view = render(ui(viewerId));
  return { entra: (id: string) => view.rerender(ui(id)) };
}

const corazon = () => screen.getByRole("button", { name: VIDEOS_COPY.like });
const guardar = () => screen.getByRole("button", { name: VIDEOS_COPY.save });
const reproductor = () => screen.getByTestId("reproductor");

describe("VideoReels — la puerta no saca del video", () => {
  beforeEach(() => {
    state.saveResult = { ok: true, saved: true };
    state.insert.mockClear();
    state.toggleSave.mockClear();
    state.toast.mockClear();
    state.push.mockClear();
  });
  afterEach(cleanup);

  it("me gusta sin sesión: pide la cuenta acá mismo, sin navegar", async () => {
    montar(null);
    fireEvent.click(corazon());

    expect(await screen.findByText(AUTH_REASON.like)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    // Y no se inventa un me gusta que la base no tiene.
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("con la hoja abierta el video se para, y al cerrarla vuelve a correr", async () => {
    montar(null);
    expect(reproductor().getAttribute("data-active")).toBe("true");

    fireEvent.click(corazon());
    await screen.findByText(AUTH_REASON.like);
    expect(reproductor().getAttribute("data-active")).toBe("false");

    // Y la hoja cuelga de <body>, NO del contenedor del reel: si colgara de él
    // quedaría encerrada en su apilado (z-30) y el video le pasaría por encima.
    const reel = screen.getByLabelText(VIDEOS_COPY.feedLabel);
    const hoja = screen.getByRole("dialog");
    expect(reel.contains(hoja)).toBe(false);
    expect(hoja.parentElement?.parentElement).toBe(document.body);

    fireEvent.click(screen.getByText("stub-cerrar"));
    await waitFor(() => expect(reproductor().getAttribute("data-active")).toBe("true"));
  });

  it("al entrar, el me gusta se aplica solo sobre el MISMO video", async () => {
    const { entra } = montar(null);
    fireEvent.click(corazon());
    fireEvent.click(await screen.findByText("stub-entrar"));

    // Lo que hace `router.refresh()`: el árbol vuelve con el viewer verdadero.
    entra("user-9");

    await waitFor(() =>
      expect(state.insert).toHaveBeenCalledWith({
        tenant_id: "tenant-1",
        subject_kind: "post",
        subject_id: "post-1",
        profile_id: "user-9",
        // Sin `FirmaActivaProvider` alrededor, el contexto devuelve "sos vos":
        // el default seguro de firma-activa.tsx, y lo que tiene que pasar en un
        // reel montado suelto.
        entity_listing_id: null,
        kind: "like",
      }),
    );
    expect(screen.getByRole("button", { name: VIDEOS_COPY.unlike }).textContent).toContain("8");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("cerrar sin entrar no deja un me gusta fantasma esperando la próxima sesión", async () => {
    /**
     * La trampa documentada en `card-like-context`: armar el deseo ANTES de
     * abrir la hoja lo deja cargado aunque la persona se arrepienta, y el efecto
     * que lo consume espera cualquier cambio de `viewerId` — o sea, CUALQUIER
     * entrada posterior. Acá el deseo se arma dentro de `onAuthenticated`.
     */
    const { entra } = montar(null);
    fireEvent.click(corazon());
    fireEvent.click(await screen.findByText("stub-cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    entra("user-9");

    await waitFor(() => expect(reproductor().getAttribute("data-active")).toBe("true"));
    expect(state.insert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: VIDEOS_COPY.like })).toBeTruthy();
  });

  it("guardar sin sesión: puerta encima y, al entrar, se guarda solo", async () => {
    montar(null);
    fireEvent.click(guardar());

    expect(await screen.findByText(AUTH_REASON.save)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.toggleSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("stub-entrar"));

    // El server action deriva quién guarda de la cookie: el reintento NO
    // necesita esperar a que vuelva el viewer del servidor.
    await waitFor(() =>
      expect(state.toggleSave).toHaveBeenCalledWith({
        subjectKind: "post",
        subjectId: "post-1",
        save: true,
      }),
    );
    expect(await screen.findByRole("button", { name: VIDEOS_COPY.unsave })).toBeTruthy();
  });
});

/**
 * =============================================================================
 * UN VIDEO FIRMADO POR UN NEGOCIO NO DELATA A LA PERSONA
 * =============================================================================
 *
 * Misma regla y mismo pedido del cliente que en la tarjeta del feed (ver
 * `components/feed/post-card.test.tsx`): «cuando se publica con otro perfil,
 * sacar la parte de por geovanny». El reel llevaba la misma línea, y es la
 * superficie de MÁS alcance de la app — acá una fuga se ve más que en ningún
 * otro lado.
 *
 * `post.entity` sale siempre de `posts.entity_listing_id`, o sea de la FIRMA
 * (0023): si está, el video se emitió con la cara del negocio.
 */
describe("VideoReels — la firma del negocio no delata a la persona", () => {
  const NEGOCIO = {
    id: "019fa477-58e6-7ab9-ae4f-cc41716f6421",
    title: "Panadería La esperanza",
    kind: "business",
    photoUrl: null,
  };

  /**
   * El reel se dibuja en un PORTAL a `<body>` (ver el comentario de
   * `createPortal` en video-reels.tsx), así que el `container` que devuelve
   * `render` queda vacío: lo que hay que leer es el documento. Sin esto, un test
   * que busque el nombre en `container` pasa siempre —incluso con la fuga
   * puesta— y no protege nada.
   */
  const textoEnPantalla = () => document.body.textContent ?? "";

  function montar(entity: PostCardModel["entity"]) {
    return render(
      <AuthSheetProvider>
        <VideoReels
          tenantId="tenant-1"
          viewerId={null}
          scope="para-ti"
          initialItems={[{ ...VIDEO, entity }]}
          initialCursor={null}
        />
      </AuthSheetProvider>,
    );
  }

  it("no imprime el nombre personal de quien subió el video", () => {
    montar(NEGOCIO);

    expect(textoEnPantalla()).not.toContain(VIDEO.author.displayName);
    // La frase exacta que el cliente señaló, no un "por " suelto: el copy de
    // fin de scroll ("Viste todos los videos POR ahora") lo contiene y haría
    // fallar el test por el motivo equivocado.
    expect(textoEnPantalla()).not.toContain(`por ${VIDEO.author.displayName}`);
  });

  it("muestra el nombre del negocio como autor del video", () => {
    montar(NEGOCIO);

    expect(textoEnPantalla()).toContain(NEGOCIO.title);
  });

  it("sin firma, la autoría personal sigue entera", () => {
    montar(null);

    expect(textoEnPantalla()).toContain(VIDEO.author.displayName);
  });
});

/**
 * =============================================================================
 * LO QUE EL CLIENTE VIO ROTO EL 2026-09-03
 * =============================================================================
 *
 * Dos quejas sobre la misma pantalla, con dos causas distintas:
 *
 *  · «Ahí no te sale la música» (17:23). No era el reproductor: era que el dato
 *    NUNCA LLEGABA. `fetchVideoReelsPage` armaba el modelo sin `music`, así que
 *    una publicación que en el feed suena llegaba muda al reel — y sin insignia,
 *    porque tampoco había de dónde sacar el título de la canción.
 *  · «Cuando uno está scrolleando salen en blanco y se cargan después de un
 *    rato» (1:07:00). El `.mp4` se sirve crudo desde el bucket: hasta que baja
 *    la metadata, el `<video>` no tiene NADA que pintar. Y se montaban los ocho
 *    videos de la tanda a la vez, compitiendo por el mismo decodificador.
 */
describe("ReelSlide — la música de la publicación y el arranque del video", () => {
  const PISTA: PostMusicView = {
    startSeconds: 12,
    track: {
      id: "track-1",
      title: "Cumbia del barrio",
      artist: "Los del Sur",
      durationSeconds: 180,
      previewUrl: "https://cdn.test/cumbia.mp3",
      licenseKind: "cc_by",
      attributionRequired: false,
      attributionText: null,
      // Del catálogo cerrado de `music_tracks` (0090), no inventado.
      category: "tropical",
    },
  };

  function montarReel(items: PostCardModel[]) {
    return render(
      <AuthSheetProvider>
        <VideoReels
          tenantId="tenant-1"
          viewerId="user-1"
          scope="para-ti"
          initialItems={items}
          initialCursor={null}
        />
      </AuthSheetProvider>,
    );
  }

  const audios = () => Array.from(document.querySelectorAll("audio"));
  const reproductores = () => screen.queryAllByTestId("reproductor");

  // El reel se dibuja en un PORTAL a `<body>`, así que estas consultas leen el
  // documento entero: sin limpiar ANTES, un árbol que dejó otro describe se
  // cuela como si fuera el de este test.
  beforeEach(cleanup);
  afterEach(cleanup);

  it("con canción: monta la pista y CALLA el video (manda la música)", () => {
    montarReel([{ ...VIDEO, music: PISTA }]);

    // El `<audio>` de la publicación existe y apunta a la pista publicada.
    expect(audios().map((node) => node.getAttribute("src"))).toEqual([
      PISTA.track.previewUrl,
    ]);
    // Y el video va mudo: el autor eligió reemplazar la banda sonora (regla 2
    // de `resolveAudioMix`), igual que en la tarjeta del feed.
    expect(reproductores()[0].getAttribute("data-muted")).toBe("true");
    // Quien escucha tiene que poder saber QUÉ está sonando.
    expect(document.body.textContent).toContain(PISTA.track.title);
  });

  it("sin canción: no monta ninguna pista y el audio del video manda", () => {
    montarReel([VIDEO]);

    expect(audios()).toHaveLength(0);
    // El reel arranca con sonido (llegar acá fue un gesto), así que sin música
    // el que habla es el video.
    expect(reproductores()[0].getAttribute("data-muted")).toBe("false");
  });

  it("el gesto de sonido es del REEL entero, no de una publicación", () => {
    // Silenciar desde el riel calla TAMBIÉN la canción del slide (Instagram y
    // TikTok se comportan así). Antes de que el provider fuera controlado, cada
    // slide tenía su propio `soundOn` y deslizar volvía al silencio.
    montarReel([{ ...VIDEO, music: PISTA }]);

    fireEvent.click(screen.getByRole("button", { name: VIDEOS_COPY.mute }));

    expect(audios()[0].muted).toBe(true);
    expect(reproductores()[0].getAttribute("data-muted")).toBe("true");
  });
});

describe("ReelStream — por qué los videos ya no salen en blanco", () => {
  const conVideo = (id: string, posterUrl: string | null): PostCardModel => ({
    ...VIDEO,
    id,
    media: [
      {
        kind: "video",
        url: `https://cdn.test/${id}.mp4`,
        ...(posterUrl ? { posterUrl } : {}),
      },
    ],
  });

  function montarReel(items: PostCardModel[]) {
    return render(
      <AuthSheetProvider>
        <VideoReels
          tenantId="tenant-1"
          viewerId="user-1"
          scope="para-ti"
          initialItems={items}
          initialCursor={null}
        />
      </AuthSheetProvider>,
    );
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  it("monta reproductor sólo alrededor del activo; el resto muestra su poster", () => {
    montarReel([
      conVideo("post-a", "https://cdn.test/a.jpg"),
      conVideo("post-b", "https://cdn.test/b.jpg"),
      conVideo("post-c", "https://cdn.test/c.jpg"),
      conVideo("post-d", "https://cdn.test/d.jpg"),
    ]);

    // Parado en el primero: se montan el activo y el siguiente, y nada más.
    // Ocho decodificadores a la vez en un teléfono es parte de por qué el reel
    // "se demora mucho".
    expect(screen.queryAllByTestId("reproductor")).toHaveLength(2);

    // Los otros dos NO desaparecen: siguen ocupando su lugar en el scroll —el
    // índice activo se calcula por posición, así que un slide que midiera
    // distinto desincronizaría el reel entero— y muestran su poster.
    const posters = Array.from(document.querySelectorAll("img"))
      .map((node) => node.getAttribute("src"))
      .filter((src): src is string => Boolean(src?.endsWith(".jpg")));
    expect(posters).toEqual(["https://cdn.test/c.jpg", "https://cdn.test/d.jpg"]);
  });

  it("el poster viaja al reproductor: el primer cuadro se ve mientras carga", () => {
    montarReel([conVideo("post-a", "https://cdn.test/a.jpg")]);

    expect(screen.getAllByTestId("reproductor")[0].getAttribute("data-poster")).toBe(
      "https://cdn.test/a.jpg",
    );
  });

  it("precarga completa el activo Y el siguiente, que es al que vas a llegar", () => {
    montarReel([
      conVideo("post-a", "https://cdn.test/a.jpg"),
      conVideo("post-b", "https://cdn.test/b.jpg"),
      conVideo("post-c", "https://cdn.test/c.jpg"),
    ]);

    expect(
      screen.getAllByTestId("reproductor").map((node) => node.getAttribute("data-preload")),
    ).toEqual(["auto", "auto"]);
  });

  it("sin poster no queda un hueco: el fondo de marca y el indicador de carga", () => {
    // Los videos anteriores a la 0132 no tienen fotograma capturado. Ahí el
    // respaldo no puede ser un rectángulo vacío —que se lee como "se rompió"—
    // sino un fondo con los tokens de la marca y una señal de que ya viene.
    montarReel([
      conVideo("post-a", null),
      conVideo("post-b", null),
      conVideo("post-c", null),
    ]);

    // El slide sin montar no pinta ninguna imagen…
    expect(Array.from(document.querySelectorAll("img"))).toHaveLength(0);
    // …pero su caja sigue ahí, con el degradado de marca (nunca negro plano).
    const conFondo = Array.from(document.querySelectorAll("div")).filter((node) =>
      node.className.includes("radial-gradient"),
    );
    expect(conFondo.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// VIDEOS LARGOS: el reel sigue siendo de cortos (2026-09-03)
// ---------------------------------------------------------------------------
//
// Por contrato (0046) un `advertising_video` no entra a Videos Cortos, así que
// en el camino normal esto no debería poder pasar. Los dos tests de abajo fijan
// las dos llaves que lo garantizan, porque la que falla en silencio es la peor:
// un video de 10 minutos reproduciéndose entero en el medio de un scroll que
// promete 90 segundos.

describe("VideoReels — un video largo no se mira entero acá", () => {
  it("un video publicitario ni siquiera monta su slide", () => {
    render(
      <AuthSheetProvider>
        <VideoReels
          tenantId="tenant-1"
          viewerId="viewer-1"
          scope="para-ti"
          initialItems={[
            {
              ...VIDEO,
              videoType: "advertising_video",
              durationSeconds: 300,
              isPaidAd: true,
              eligibleForShortFeed: false,
            },
          ]}
          initialCursor={null}
        />
      </AuthSheetProvider>,
    );

    expect(screen.queryByTestId("reproductor")).toBeNull();
  });

  it("un corto no lleva destino de video largo: se ve entero acá", () => {
    montar("viewer-1");
    expect(reproductor().getAttribute("data-largo")).toBe("");
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { getTenant } from "@/lib/tenant/resolve";
import { NavTabs, type NavTabItem } from "@/components/ui";
import { ProfilePostsGrid } from "./posts-grid";
import { fetchAuthorPostTiles } from "./posts";
import {
  fetchFollowPeople,
  fetchProfileReviews,
  type ProfileCounts,
} from "./profile-data";
import { fetchProfileListings } from "./profile-listings";
import { ProfileListingsPanel } from "./profile-listings-panel";
import {
  ProfileClosedPanel,
  ProfileInfoPanel,
  ProfileMediaEmpty,
  ProfilePeoplePanel,
  ProfileReviewsPanel,
} from "./profile-panels";
import {
  PROFILE_TAB_IDS,
  PROFILE_TAB_LABELS,
  filterTilesByKind,
  profileTabHref,
  type ProfileTabId,
} from "./profile-tabs";

/**
 * LA SECCIÓN DE PESTAÑAS DEL PERFIL — una sola implementación para las dos
 * pantallas (el perfil propio `/perfil` y el ajeno `/perfil/[id]`).
 *
 * Está factorizado así por una razón muy concreta: son ocho pestañas por dos
 * pantallas. Copiado, el primer arreglo que se hiciera en una sola de las dos
 * dejaría al perfil ajeno con menos pestañas que el propio, y nadie lo notaría
 * hasta que un usuario abriera el perfil de otro. Acá el `switch` es único.
 *
 * Sólo se consulta la pestaña ABIERTA. Traer las ocho en cada visita serían
 * siete queries tiradas a la basura por render — y "Publicaciones", que es la
 * que ve el 90% de la gente, pagaría el costo de las otras siete.
 */

const COPY = {
  tabsLabel: "Secciones del perfil",
  postsEmptyOwn:
    "Todavía no compartiste nada. Tu primera foto es el mejor comienzo para que la comunidad te conozca.",
  postsEmptyOther: "Todavía no publicó nada. Cuando comparta algo, va a aparecer acá.",
  photosHeading: "Fotos",
  videosHeading: "Videos",
  postsHeading: "Publicaciones",
} as const;

export interface ProfileTabSectionProps {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  profileId: string;
  /** "/perfil" o "/perfil/<id>" — la base de todos los hrefs de pestaña. */
  baseHref: string;
  tab: ProfileTabId;
  counts: ProfileCounts;
  isOwn: boolean;
  /** Cursor keyset de la grilla (`?fotos=`), ya decodificado. */
  cursor: { createdAt: string; id: string } | null;
  /**
   * Lo que la MATRIZ DE PRIVACIDAD dejó pasar, decidido por `profile_card()`
   * dentro de la base (0063). Por default `true`: el perfil propio y cualquier
   * pantalla que todavía no los pase se comportan como antes.
   *
   * ⚠️ Esto NO es la privacidad — es su reflejo en la UI. Las publicaciones y la
   * lista de seguidores se consultan con el cliente de servidor y sus propias
   * policies; acá se evita ofrecer una pestaña cuyo contenido la persona eligió
   * no mostrar. Cerrar de verdad esas dos consultas es trabajo de RLS, no de un
   * `if` en un componente.
   */
  canSeePosts?: boolean;
  canSeeFollowers?: boolean;
  /** Datos de la pestaña "Información" — ya los tiene la página, ya filtrados. */
  info: {
    bio: string | null;
    country: string | null;
    areaLabel: string | null;
    memberSince: string | null;
    identityVerified: boolean;
    lastName?: string | null;
    age?: number | null;
    countryResidence?: string | null;
    city?: string | null;
    languages?: readonly string[];
  };
}

export async function ProfileTabSection({
  supabase,
  tenantId,
  profileId,
  baseHref,
  tab,
  counts,
  isOwn,
  cursor,
  canSeePosts = true,
  canSeeFollowers = true,
  info,
}: ProfileTabSectionProps) {
  /**
   * Los contadores van SÓLO donde son un dato que la persona quiere leer
   * (reseñas, seguidores, siguiendo). "Fotos 12 · Videos 3" convertiría la
   * barra en un tablero de estadísticas y, encima, obligaría a contar fotos y
   * videos por separado en cada visita — que es exactamente la query cara que
   * este componente evita. "Avisos" queda afuera por el mismo motivo: contarlos
   * pediría un `count` aparte sobre `listings` que hoy nadie necesita pagar.
   */
  const countFor: Partial<Record<ProfileTabId, number>> = {
    publicaciones: counts.posts,
    resenas: counts.reviews,
    seguidores: counts.followers,
    siguiendo: counts.following,
  };

  const items: NavTabItem[] = PROFILE_TAB_IDS.map((id) => ({
    id,
    label: PROFILE_TAB_LABELS[id],
    href: profileTabHref(baseHref, id),
    count: countFor[id],
  }));

  return (
    <section className="flex flex-col gap-4">
      <NavTabs items={items} active={tab} label={COPY.tabsLabel} />
      {/* El panel NO lleva role="tabpanel": las pestañas son enlaces que
          navegan (ver la cabecera de ui/nav-tabs.tsx), así que el contenido es
          la página, no un panel que se actualiza sin salir de ella. */}
      <div>{await renderPanel()}</div>
    </section>
  );

  async function renderPanel() {
    switch (tab) {
      case "informacion":
        return <ProfileInfoPanel {...info} isOwn={isOwn} />;

      case "resenas":
        return (
          <ProfileReviewsPanel
            reviews={await fetchProfileReviews(supabase, { tenantId, profileId })}
          />
        );

      case "seguidores":
      case "siguiendo": {
        if (!canSeeFollowers) return <ProfileClosedPanel kind="followers" />;
        const direction = tab === "seguidores" ? "followers" : "following";
        return (
          <ProfilePeoplePanel
            people={await fetchFollowPeople(supabase, { tenantId, profileId, direction })}
            direction={direction}
            isOwn={isOwn}
          />
        );
      }

      case "fotos":
      case "videos": {
        if (!canSeePosts) return <ProfileClosedPanel kind="posts" />;
        const kind = tab === "fotos" ? "image" : "video";
        const page = await fetchAuthorPostTiles(supabase, {
          tenantId,
          authorId: profileId,
          cursor,
        });
        const tiles = filterTilesByKind(page.tiles, kind);

        // Filtrado en JS y no en la query a propósito: `posts.media` es un
        // `text[]` y el tipo (foto o video) se deduce de la EXTENSIÓN del
        // primer archivo — la misma regla que usa el feed. PostgREST no puede
        // expresar eso sin una columna generada, y agregarla es una migración.
        // El keyset no se rompe: el cursor sigue avanzando sobre `posts`, así
        // que "Ver más" nunca saltea nada; sólo puede traer una página corta.
        if (tiles.length === 0 && !page.nextCursor) {
          return <ProfileMediaEmpty kind={kind} isOwn={isOwn} />;
        }
        return (
          <ProfilePostsGrid
            tiles={tiles}
            nextHref={page.nextCursor ? `${baseHref}?t=${tab}&fotos=${page.nextCursor}` : null}
            heading={kind === "image" ? COPY.photosHeading : COPY.videosHeading}
            emptyMessage=""
          />
        );
      }

      case "avisos": {
        /**
         * SIN gate de privacidad, a propósito: a diferencia de "Publicaciones"
         * (que sí puede cerrarse, `canSeePosts` viene de `profile_card()`), un
         * `listing` publicado es público por diseño del marketplace entero —
         * su propia RLS ya lo dice (`status = 'published'` visible a
         * `anon, authenticated`, igual que en /propiedades, /eventos,
         * /empleos…). No existe una privacidad de "avisos" en ningún otro
         * lugar de la app; inventarla acá escondería avisos que siguen siendo
         * públicos si se los busca por su propia página.
         */
        const tenant = await getTenant(); // cache() de React: ya se pidió en la página, esto no repite la consulta.
        const items = await fetchProfileListings(supabase, {
          tenantId,
          profileId,
          locale: tenant.locale,
        });
        return <ProfileListingsPanel items={items} isOwn={isOwn} />;
      }

      default: {
        if (!canSeePosts) return <ProfileClosedPanel kind="posts" />;
        const page = await fetchAuthorPostTiles(supabase, {
          tenantId,
          authorId: profileId,
          cursor,
        });
        return (
          <ProfilePostsGrid
            tiles={page.tiles}
            nextHref={page.nextCursor ? `${baseHref}?fotos=${page.nextCursor}` : null}
            heading={COPY.postsHeading}
            emptyMessage={isOwn ? COPY.postsEmptyOwn : COPY.postsEmptyOther}
          />
        );
      }
    }
  }
}

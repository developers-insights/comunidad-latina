import "server-only";
import { cache } from "react";
import { getShellContext } from "@/components/shell/shell-context";
import { getIdentidadActiva, type IdentidadNegocio } from "./identidad";

/**
 * =============================================================================
 * LA CARA ACTIVA — con qué nombre y qué foto te ve la app ahora mismo
 * =============================================================================
 *
 * Existe por un bug de una sola frase: «cambio a la cuenta de dueño y no cambia
 * todo, sólo la foto del appbar».
 *
 * El motivo era estructural. `getIdentidadActiva()` dice CON QUIÉN estás
 * actuando, y `getShellContext()` dice QUIÉN SOS. Cada pantalla que necesitaba
 * pintar un avatar elegía una de las dos por su cuenta, y casi todas elegían la
 * segunda porque era la que ya tenían a mano: el header preguntaba las dos y
 * mostraba la del negocio, el composer preguntaba sólo `getShellContext()` y
 * mostraba la personal, /perfil ni se enteraba de que había un interruptor. Tres
 * pantallas, tres respuestas distintas a la misma pregunta.
 *
 * Esto es esa pregunta, hecha UNA vez. Quien pinta una cara —el avatar del
 * header, la tarjeta de "¿Qué querés publicar?", la cabecera de /perfil, la
 * firma de un comentario— pide esto y no vuelve a decidir nada.
 *
 * ── LO QUE NO CAMBIA ────────────────────────────────────────────────────────
 * Lo que VES sigue siendo tuyo: el feed, las notificaciones, los mensajes y los
 * guardados son de la persona, no del negocio — igual que en Facebook, donde
 * usar la app como una página no te cambia el muro. Lo que cambia es lo que
 * EMITÍS (publicar, comentar) y la cara con la que la app te representa
 * mientras tanto. Confundir las dos cosas convertiría el cambiador en un
 * segundo login, que es justo lo que el cliente NO pidió: «2 perfiles en la
 * misma cuenta».
 *
 * `cache()` por request, como sus dos fuentes: pedirla en cuatro componentes de
 * la misma pantalla no agrega ni una consulta.
 */
export interface CaraActiva {
  /** El nombre a mostrar: el del negocio si actuás como negocio, si no el tuyo. */
  displayName: string;
  /** La foto a mostrar, ya resuelta a URL pública. `null` = inicial. */
  avatarUrl: string | null;
  /** El negocio con el que estás actuando, o `null` si sos vos. */
  negocio: IdentidadNegocio | null;
  /**
   * `listings.id` con el que se firma lo que publiques o comentes ahora mismo, o
   * `null` = sale a tu nombre. Es lo que va a `entity_listing_id`, y es null
   * también cuando actuás como un negocio que todavía no tiene ficha usable:
   * mejor publicar como vos que prometer una firma que la policy rechaza.
   */
  firmaListingId: string | null;
}

/** Sos vos. El default de todo, y a donde cae cualquier falla. */
export const CARA_PERSONAL: CaraActiva = {
  displayName: "Tu cuenta",
  avatarUrl: null,
  negocio: null,
  firmaListingId: null,
};

export const getCaraActiva = cache(async (): Promise<CaraActiva> => {
  try {
    const [shell, identidad] = await Promise.all([
      getShellContext(),
      getIdentidadActiva(),
    ]);

    const personal: CaraActiva = {
      displayName: shell.user?.displayName ?? CARA_PERSONAL.displayName,
      avatarUrl: shell.user?.avatarUrl ?? null,
      negocio: null,
      firmaListingId: null,
    };

    if (identidad.tipo !== "negocio") return personal;

    return {
      displayName: identidad.negocio.nombre,
      avatarUrl: identidad.negocio.avatarUrl,
      negocio: identidad.negocio,
      firmaListingId: identidad.negocio.listingId,
    };
  } catch {
    return CARA_PERSONAL;
  }
});

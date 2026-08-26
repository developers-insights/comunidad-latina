"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * =============================================================================
 * LA FIRMA ACTIVA, DISPONIBLE EN CUALQUIER PARTE DEL CLIENTE
 * =============================================================================
 *
 * «que en todos lados todo —ya sean me gusta, comentarios, todos— vaya del lado
 * de la cuenta que esté, ya sea dueño o personal.» (Manuel, 2026-08-26.)
 *
 * Publicar y comentar se resuelven enteros en el servidor, así que ahí la
 * identidad activa se lee y listo. Los "me gusta" NO: se escriben desde el
 * navegador con el cliente del usuario, porque tienen que responder en menos de
 * 100 ms y una server action por toque haría del doble-tap un viaje de red (ver
 * `card-like-context.tsx` y `video-reels.tsx`). Esos inserts necesitan saber con
 * qué ficha firmar SIN preguntarle a nadie.
 *
 * ── POR QUÉ UN CONTEXTO Y NO UN PROP ────────────────────────────────────────
 * `viewerId` ya viaja como prop desde el servidor y pasa por ocho componentes
 * hasta llegar al botón de me gusta (feed, hoja de publicación, reels, tarjetas
 * de directorio…). Agregarle un segundo prop a esa cadena es agregarle ocho
 * lugares donde alguien se lo puede olvidar — y olvidárselo no da error: da un
 * me gusta firmado por la persona cuando debería ir a nombre del negocio, que
 * es exactamente el bug que estamos arreglando.
 *
 * Se monta UNA vez en el layout de la app, con el valor que ya calculó el
 * servidor (`getCaraActiva()`, memoizada por request: no cuesta una consulta
 * más). Cambiar de perfil hace `revalidatePath("/", "layout")`, así que el
 * layout se vuelve a renderizar y el valor baja actualizado solo.
 *
 * ── ESTO NO ES LA FRONTERA ──────────────────────────────────────────────────
 * Es una comodidad del cliente, no un permiso. Lo que impide firmar con una
 * ficha ajena es la policy: cada tabla que acepta `entity_listing_id` exige el
 * mismo predicado que `posts_insert` —la ficha tiene que ser del tenant, creada
 * por quien escribe y estar publicada—. Lo peor que puede hacer alguien que
 * manipule este valor en el navegador es firmar con una ficha propia.
 */
export interface FirmaActivaValue {
  /** `listings.id` con el que se firma, o null = a nombre de la persona. */
  listingId: string | null;
  /** Nombre a mostrar mientras se actúa como negocio. */
  nombre: string | null;
  avatarUrl: string | null;
}

const SIN_FIRMA: FirmaActivaValue = { listingId: null, nombre: null, avatarUrl: null };

const FirmaActivaContext = createContext<FirmaActivaValue>(SIN_FIRMA);

export function FirmaActivaProvider({
  value,
  children,
}: {
  value: FirmaActivaValue;
  children: ReactNode;
}) {
  return (
    <FirmaActivaContext.Provider value={value}>{children}</FirmaActivaContext.Provider>
  );
}

/**
 * Con qué firma escribe quien está mirando. Fuera del provider devuelve "sos
 * vos", que es el default seguro de toda esta carpeta: un componente montado en
 * un test o en una pantalla sin shell publica como la persona, nunca como un
 * negocio que nadie eligió.
 */
export function useFirmaActiva(): FirmaActivaValue {
  return useContext(FirmaActivaContext);
}

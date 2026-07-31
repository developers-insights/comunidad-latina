import {
  Briefcase,
  Buildings,
  CalendarBlank,
  ChatCircleText,
  PlayCircle,
  ShoppingBagOpen,
  Storefront,
  UserCircle,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { SearchResultType } from "./helpers";

/**
 * Ícono por tipo de resultado. Se usa en dos lugares: el encabezado del grupo y
 * el recuadro de respaldo cuando el resultado no tiene foto.
 *
 * Los íconos son los MISMOS que ya representan a cada módulo en el menú y en la
 * grilla de /buscar (`shell/modules.ts`) — un evento tiene el calendario en los
 * tres lugares. Si acá se eligiera otro dibujo, el buscador enseñaría un idioma
 * visual distinto al del resto de la app.
 *
 * Import desde `/dist/ssr` (y no del entrypoint principal): esos son
 * componentes planos sin `use client` ni contexto, así que sirven igual en
 * servidor y en cliente.
 */
export const SEARCH_TYPE_ICON: Record<SearchResultType, Icon> = {
  personas: UserCircle,
  propiedades: Buildings,
  negocios: Storefront,
  profesionales: UserGear,
  eventos: CalendarBlank,
  empleos: Briefcase,
  marketplace: ShoppingBagOpen,
  videos: PlayCircle,
  publicaciones: ChatCircleText,
};

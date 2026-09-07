import { entityAccentVar } from "@/components/feed/helpers";
import { moduleAvailability } from "@/components/shell/module-access";

/**
 * QUÉ SE PUEDE CREAR para después promocionarlo — catálogo puro de /impulsar/crear.
 *
 * Cada `href` apunta al creador que YA existe y que abre el "+" del bottom nav
 * (`components/shell/create-menu.tsx`). Boost no tiene un creador propio ni
 * debería: lo que se promociona es una fila de `listings` o de `posts`, y las
 * siete verticales terminan en `listings` —incluidas marketplace
 * (`kind: 'product'`) y creadores (`kind: 'creator_gig'`)—, así que todo lo
 * que se publica desde acá aparece después en el índice de Boost sin
 * pegamento extra.
 *
 * DUPLICA a propósito los `moduleKey` y los `href` de create-menu, y por eso
 * los fija un test: son dos pantallas con copy distinto (allá "Publicá tu
 * negocio", acá "Promocioná tu negocio") que tienen que coincidir en el
 * DESTINO. Importar el catálogo de create-menu no era una opción: es un módulo
 * `"use client"` que además cuelga de `components/feed/copy.ts`, y arrastraría
 * las dos cosas al bundle de una página que se sirve entera desde el servidor.
 *
 * Sin íconos acá: son componentes de React y este archivo se testea en node.
 * El mapa id → ícono vive en `selector-de-creacion.tsx`.
 */

export type GrupoDeCreacion = "aviso" | "publicacion";

export interface OpcionParaPromocionar {
  id: string;
  grupo: GrupoDeCreacion;
  titulo: string;
  descripcion: string;
  href: string;
  /** Clave en `tenants.modules`; ausente = siempre disponible. */
  moduleKey?: string;
  /** Variable de acento del módulo (globals.css), nunca un color crudo. */
  accentVar: string;
}

export const OPCIONES_PARA_PROMOCIONAR: readonly OpcionParaPromocionar[] = [
  {
    id: "property",
    grupo: "aviso",
    titulo: "Una propiedad",
    descripcion: "Un alquiler, una venta o una habitación.",
    href: "/publicar?kind=property",
    moduleKey: "propiedades",
    accentVar: entityAccentVar("property"),
  },
  {
    id: "business",
    grupo: "aviso",
    titulo: "Tu negocio",
    descripcion: "Para que te encuentren los vecinos de tu zona.",
    href: "/publicar?kind=business",
    moduleKey: "negocios",
    accentVar: entityAccentVar("business"),
  },
  {
    id: "professional",
    grupo: "aviso",
    titulo: "Tu oficio o servicio",
    descripcion: "Plomería, peluquería, mudanzas, lo que hagas.",
    href: "/publicar?kind=professional",
    moduleKey: "profesionales",
    accentVar: entityAccentVar("professional"),
  },
  {
    id: "event",
    grupo: "aviso",
    titulo: "Un evento",
    descripcion: "Una fiesta, una feria, una misa, un partido.",
    href: "/publicar?kind=event",
    moduleKey: "eventos",
    accentVar: entityAccentVar("event"),
  },
  {
    id: "job",
    grupo: "aviso",
    titulo: "Un empleo",
    descripcion: "Buscá gente para trabajar con vos.",
    href: "/empleos/publicar",
    moduleKey: "empleos",
    accentVar: entityAccentVar("job"),
  },
  {
    id: "product",
    grupo: "aviso",
    titulo: "Algo para vender",
    descripcion: "Un producto tuyo en el Marketplace.",
    href: "/marketplace/publicar",
    moduleKey: "marketplace",
    accentVar: "var(--accent-marketplace)",
  },
  {
    id: "creatorGig",
    grupo: "aviso",
    titulo: "Un trabajo para creadores",
    descripcion: "Buscá a alguien que te haga contenido.",
    href: "/creadores/publicar",
    moduleKey: "creadores",
    accentVar: "var(--accent-creadores)",
  },
  {
    /**
     * Va al feed y no abre el composer: desde el 2026-08-13 foto/video/pregunta
     * se resuelven SÓLO por `onQuickPost` del menú del "+" (create-menu.tsx),
     * porque navegar primero a `/feed?crear=…` perdía el gesto del usuario que
     * abre el selector de archivos en Safari. `/feed` deja a la persona sobre
     * el `ComposerTrigger` que ya vive arriba de la lista, que es lo más cerca
     * que se puede llegar sin volver a romper eso.
     */
    id: "post",
    grupo: "publicacion",
    titulo: "Una publicación en el feed",
    descripcion: "Una foto, un video, una pregunta o un texto.",
    href: "/feed",
    accentVar: "var(--accent-feed)",
  },
];

/**
 * Las opciones que ESTA comunidad tiene abiertas.
 *
 * Misma regla que el menú del "+": "soon" y "hidden" quedan las dos afuera —
 * ofrecer "Publicá un producto" con Marketplace apagado es prometer una
 * pantalla que no existe. Las opciones sin `moduleKey` (el feed) nunca se
 * filtran.
 */
export function opcionesDisponibles(
  modules: Record<string, boolean>,
  modulesSoon: Record<string, boolean>,
): OpcionParaPromocionar[] {
  return OPCIONES_PARA_PROMOCIONAR.filter(
    (opcion) => moduleAvailability(opcion.moduleKey, modules, modulesSoon) === "active",
  );
}

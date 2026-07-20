export const nav = {
  feed: "Inicio",
  properties: "Propiedades",
  community: "Comunidad",
  messages: "Mensajes",
  profile: "Perfil",
  notifications: "Notificaciones",
  mainNav: "Navegación principal",
  chooseLocation: "Elegí tu zona",
  locationPlaceholder: "Tu zona",
  // Rail de módulos bajo el header (feedback cliente 2026-07-19): "feed" ya
  // cubre el primer ítem (Inicio); estos son los otros 7. "Vivienda" es
  // deliberado y distinto de "properties"/"Propiedades" del bottom nav — es
  // el nombre que ya usa la propia página (`propiedades/page.tsx` → metadata
  // title "Vivienda") y el que matchea `--accent-vivienda` en globals.css.
  modulesNav: "Módulos",
  moduleVivienda: "Vivienda",
  moduleEventos: "Eventos",
  moduleNegocios: "Negocios",
  moduleProfesionales: "Profesionales",
  moduleMarketplace: "Marketplace",
  moduleCreadores: "Creadores",
  moduleEscudo: "Escudo",
} as const;

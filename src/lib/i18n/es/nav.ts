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
  // Los 8 módulos, hoy dentro del menú (feedback cliente 2026-07-20; antes
  // vivían en un rail de cápsulas bajo el header). "feed" ya cubre el primero
  // (Inicio); estos son los otros 7. "Vivienda" es deliberado y distinto de
  // "properties"/"Propiedades" del bottom nav — es el nombre que ya usa la
  // propia página (`propiedades/page.tsx` → metadata title "Vivienda") y el
  // que matchea `--accent-vivienda` en globals.css.
  moduleVivienda: "Vivienda",
  moduleEventos: "Eventos",
  moduleNegocios: "Negocios",
  moduleProfesionales: "Profesionales",
  moduleMarketplace: "Marketplace",
  moduleCreadores: "Influencers",
  moduleEscudo: "Escudo",
} as const;

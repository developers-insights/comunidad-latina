export const nav = {
  feed: "Inicio",
  // Pestaña del bottom nav (feedback cliente 2026-07-27). NO es una caja de
  // texto global: abre la grilla de categorías, y el buscador con filtros vive
  // adentro de cada categoría ("cuando ya le dan clic en vivienda, ahí dentro
  // hay un search… apartamento, cuarto, de cuánto a cuánto").
  search: "Buscar",
  // "Videos Cortos" y no "Videos" (contrato 2026-07-30 §4): el nombre distingue
  // el módulo del scroll de ≤90 s del video publicitario largo, que vive DENTRO
  // de su anuncio y nunca acá. Esta clave gobierna la pestaña del bottom nav, el
  // menú de módulos y /buscar — todos leen del diccionario, no del literal.
  videos: "Videos Cortos",
  community: "Comunidad",
  messages: "Mensajes",
  profile: "Perfil",
  notifications: "Notificaciones",
  // Quinta pestaña del bottom nav (2026-07-29). Absorbió el menú lateral que se
  // eliminó cuando el botón del header pasó a ser el avatar: notificaciones,
  // tema, privacidad y sesión viven ahí.
  settings: "Ajustes",
  // El "+" del centro de la barra: acción, no destino.
  create: "Crear",
  /** Se suma al nombre accesible de la pestaña que tiene el punto de aviso. */
  unreadSuffix: "(tenés novedades sin leer)",
  mainNav: "Navegación principal",
  chooseLocation: "Elegí tu zona",
  locationPlaceholder: "Tu zona",
  // Los 9 módulos, hoy dentro del menú (feedback cliente 2026-07-20; antes
  // vivían en un rail de cápsulas bajo el header). "feed" ya cubre el primero
  // (Inicio); estos son los otros 8. "Vivienda" es deliberado: es el nombre que
  // ya usa la propia página (`propiedades/page.tsx` → metadata title "Vivienda")
  // y el que matchea `--accent-vivienda` en globals.css.
  moduleVivienda: "Vivienda",
  moduleEventos: "Eventos",
  moduleNegocios: "Negocios",
  moduleProfesionales: "Profesionales",
  moduleEmpleos: "Empleos",
  moduleMarketplace: "Marketplace",
  moduleCreadores: "Influencers",
  moduleEscudo: "Escudo",
  /**
   * Etiqueta del módulo que se ve pero todavía no abre (`tenants.modules_soon`).
   * Va PEGADA a la cápsula, no escondida detrás del toque: la persona se entera
   * antes de tocar, y el lector de pantalla lee "Marketplace Muy pronto, enlace".
   * Es una promesa, no un error — de ahí "Muy pronto" y no "No disponible".
   */
  moduleSoonBadge: "Muy pronto",
} as const;

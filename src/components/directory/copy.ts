/**
 * COPY del módulo DIRECTORIOS (profesionales + eventos) — local al módulo.
 * Español cálido rioplatense-neutro. El copy legal del verificador (§11)
 * vive en <VerificationCard> y NO se duplica acá.
 */
export const COPY = {
  professionals: {
    title: "Profesionales",
    subtitle: "Gente que trabaja para la comunidad",
    verifyBannerLead: "¿Sos abogado o notario?",
    verifyBannerBody: "Verificá tu matrícula y sumá la banda de confianza a tu perfil.",
    verifyBannerCta: "Verificar mi matrícula",
    categoryFilterLabel: "Filtrar por rubro",
    allCategories: "Todos",
    verifiedChip: (date: string) => `Licencia activa al ${date}`,
    communityMember: "Miembro de la comunidad",
    externalPublisher: (name: string) => `Publicado por ${name}`,
    viewProfile: "Ver perfil",
    loadMore: "Ver más profesionales",
    emptyTitle: "Todavía no hay profesionales por acá",
    emptyMessage:
      "Este directorio recién arranca. Si ofrecés un servicio profesional, publicá tu perfil y la comunidad te va a encontrar.",
    emptyFilteredTitle: "Nada en ese rubro por ahora",
    emptyFilteredMessage:
      "Probá con otro rubro, o publicá tu perfil si trabajás en este.",
    publishCta: "Publicar mi perfil",
    detail: {
      credentialsTitle: "Credenciales",
      descriptionTitle: "Sobre este servicio",
      publishedBy: "Publicado por",
      externalSourceNote: "Perfil de fuente externa (publicado con permiso)",
      locationTitle: "Zona de trabajo",
      locationPrivacy:
        "El contacto directo se comparte cuando el profesional acepta tu mensaje.",
      pendingBanner:
        "Tu perfil está en revisión — lo publicamos apenas pase el control de seguridad.",
      servicesCount: (n: number) =>
        `${n} ${n === 1 ? "aviso publicado" : "avisos publicados"}`,
    },
  },
  events: {
    title: "Eventos",
    subtitle: "Para encontrarse en persona",
    loadMore: "Ver más eventos",
    emptyTitle: "Todavía no hay eventos — ¿organizás uno?",
    emptyMessage:
      "Los encuentros en persona son el corazón de la comunidad. Si estás armando algo, publicalo y la gente se entera por acá.",
    publishCta: "Publicar un evento",
    dateToConfirm: "Fecha a confirmar",
    pastLabel: "Ya pasó",
    pastSectionTitle: "Ya pasaron",
    freeChip: "Entrada libre",
    detail: {
      dateTitle: "Cuándo",
      venueTitle: "Dónde (zona aproximada)",
      descriptionTitle: "De qué se trata",
      publishedBy: "Organiza",
      externalSourceNote: "Evento de fuente externa (publicado con permiso)",
      pendingBanner:
        "Tu evento está en revisión — lo publicamos apenas pase el control de seguridad.",
      interestedCount: (n: number) =>
        n === 0
          ? "Sé la primera persona en anotarte"
          : `${n} ${n === 1 ? "persona interesada" : "personas interesadas"}`,
      goingCta: "Quiero ir",
      goingActive: "¡Vas!",
      goingNeedLogin: "Entrá para anotarte",
      goingErrorTitle: "No pudimos anotarte",
      goingErrorBody:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
      shareCta: "Compartir",
      shareCopiedTitle: "Link copiado",
      shareCopiedBody: "Compartilo con quien quieras.",
    },
  },
} as const;

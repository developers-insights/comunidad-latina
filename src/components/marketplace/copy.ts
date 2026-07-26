/**
 * COPY del módulo MARKETPLACE — local al módulo (no toca src/lib/i18n/*).
 * Español cálido, mismo tono que VIVIENDA/DIRECTORIOS. Un producto es un
 * `listing` kind='product'; la tienda es el `listing` kind='business' dueño.
 */
export const COPY = {
  /**
   * Vendedor: desde el split tiendas/particulares (call con el cliente
   * 2026-07-24) un producto puede venir de una TIENDA (attrs.store_listing_id
   * apunta a un listing kind='business') o de una PERSONA. El chip lo dice de
   * frente en la card y en el detalle; "Verificada" es el plan Presencia
   * Verificada (business_accounts.verified_presence), que hasta hoy no se
   * mostraba en ningún lado.
   */
  seller: {
    storeLabel: "Tienda",
    privateLabel: "Particular",
    verifiedLabel: "Verificada",
    verifiedStoreLabel: "Tienda verificada",
    fallbackStoreName: "Tienda de la comunidad",
    fallbackPrivateName: "Miembro de la comunidad",
    storeAriaLabel: (name: string) => `Tienda ${name} — ver su vidriera`,
    privateAriaLabel: (name: string) => `Vendido por ${name}, particular`,
    verifiedAriaLabel: "Tienda verificada: confirmó su identidad y su plan con la comunidad",
  },
  list: {
    title: "Marketplace",
    subtitle: "Lo que vende tu comunidad: tiendas y personas",
    publishCta: "Publicar producto",
    categoryFilterLabel: "Filtrar por categoría",
    categoryAll: "Todas",
    searchLabel: "Buscar productos en el marketplace",
    searchPlaceholder: "Buscá un producto…",
    searchSubmitLabel: "Buscar",
    searchClearLabel: "Borrar búsqueda",
    loadMore: "Ver más productos",
    emptyTitle: "Todavía no hay productos",
    emptyMessage:
      "Acá vas a ver lo que publica la comunidad, tenga tienda o no. ¿Tenés algo para vender? Podés ser el primero.",
    emptyFilteredTitle: "Nada por acá con esa categoría",
    emptyFilteredMessage:
      "Probá con otra categoría o mirá todos los productos disponibles.",
    emptySearchTitle: (q: string) => `No encontramos nada con "${q}"`,
    emptySearchMessage: "Probá con otra palabra o mirá las categorías de arriba.",
    emptyPublishCta: "Publicar mi primer producto",
    viewProduct: "Ver producto",
    ownerBanner: {
      title: "Tu tienda llega primero a quienes ya te siguen",
      body: "Lo que publicás orgánicamente lo ven tus seguidores. Para llegar a más gente de la comunidad, impulsá tus productos desde su página.",
    },
  },
  detail: {
    priceLabel: "Precio",
    categoryLabel: "Categoría",
    conditionLabel: "Estado",
    descriptionTitle: "Descripción",
    storeTitle: "Vendido por",
    visitStore: "Ver tienda",
    communityMember: "Miembro de la comunidad",
    privateSellerNote: "Lo vende una persona de la comunidad, no una tienda.",
    /** Fila de comentarios (hoja polimórfica del feed). */
    commentsCta: (count: number) => `Comentarios (${count})`,
    commentsHint: "Preguntá lo que necesites — las respuestas las ve toda la comunidad.",
    /** Producto cargado de una fuente externa (created_by null): no hay a quién escribirle. */
    externalSellerTitle: "Este producto no se publicó desde una cuenta",
    externalSellerBody: (source: string) =>
      `Lo trajimos de ${source}. Por eso no podemos abrirte un chat acá — si te interesa, buscá el contacto en la fuente original y cuidá tus datos.`,
    externalSellerFallback: "una fuente de la comunidad",
    pendingBanner:
      "Tu producto está en revisión — lo publicamos apenas pase el control de seguridad.",
    boostCta: "Impulsar este producto",
    boostHint: "Llegá a más gente con tu producto, no solo a tus seguidores.",
    galleryLabel: "Fotos del producto",
    galleryPrev: "Foto anterior",
    galleryNext: "Foto siguiente",
    photoCounter: (current: number, total: number) => `${current}/${total}`,
    followersLoading: "Seguidores",
  },
  store: {
    notFoundNudge: "Volvé al marketplace",
    productsTitle: "Productos de esta tienda",
    emptyProductsTitle: "Todavía no publicó productos",
    emptyProductsMessage: "Esta tienda todavía no tiene productos publicados — volvé pronto.",
    followStore: "Seguir tienda",
    followingStore: "Siguiendo",
    messageTitle: "¿Querés preguntarle algo?",
    messageCta: "Escribirle a la tienda",
    messagePlaceholder: "Hola, quería consultarles por…",
  },
  publish: {
    title: "Publicar un producto",
    subtitle: "Mostrale a la comunidad lo que vendés, en un par de minutos.",
    needLoginTitle: "Para publicar, primero entrá",
    needLoginMessage:
      "Publicar es gratis. Necesitamos que entres a tu cuenta para saber quién vende.",
    needLoginCta: "Entrar a mi cuenta",
    // --- Split tiendas/particulares (call cliente 2026-07-24) ----------------
    // Tener un negocio dejó de ser un requisito: cualquiera de la comunidad
    // puede vender lo suyo. Quien SÍ tiene tiendas elige desde cuál publica.
    storeFieldLabel: "¿Quién vende este producto?",
    storeFieldHelp: "Podés publicarlo a nombre de tu tienda o como particular.",
    sellAsPrivate: "Yo, como particular",
    privateOnlyTitle: "Publicás como particular",
    privateOnlyBody:
      "No hace falta tener un negocio: tu producto sale a nombre tuyo y la gente te escribe por acá.",
    createBusinessCta: "¿Tenés un negocio? Creá tu tienda",
    titleLabel: "Título del producto",
    titlePlaceholder: "Ej.: Zapatillas deportivas talla 9",
    titleHelp: "Corto y claro — es lo primero que se ve.",
    descriptionLabel: "Descripción",
    descriptionPlaceholder: "Contá el estado, medidas, colores disponibles, lo que sirva para decidir…",
    descriptionHelp: "Mientras más completa, menos preguntas repetidas.",
    priceLabel: "Precio",
    pricePlaceholder: "25",
    categoryLabel: "Categoría",
    categoryPlaceholder: "Elegí una categoría…",
    conditionLegend: "Estado del producto",
    conditionNew: "Nuevo",
    conditionUsed: "Usado",
    photosTitle: "Fotos del producto",
    photosHelp: "Hasta 4 fotos. Los productos con fotos reciben muchas más consultas.",
    addPhotoLabel: "Agregar foto",
    removePhotoLabel: "Quitar foto",
    tooManyPhotos: "Podés subir hasta 4 fotos.",
    tooBigPhoto: "Esa foto es muy pesada — probá con una de menos de 8 MB.",
    reviewNote: "Las fotos pasan por un control de seguridad antes de publicarse.",
    submit: "Publicar producto",
    submitting: "Publicando…",
    errors: {
      titleShort: "El título necesita al menos 8 caracteres.",
      descriptionShort: "Contanos un poco más sobre el producto.",
      priceRequired: "Poné un precio para tu producto.",
      categoryRequired: "Elegí una categoría.",
      conditionRequired: "Decinos si es nuevo o usado.",
      uploadFailed: "No pudimos subir las fotos — revisá tu conexión e intentá de nuevo.",
      generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    },
    success: {
      publishedTitle: "¡Tu producto ya está publicado!",
      publishedBody: "Ya se ve en el marketplace de la comunidad.",
      reviewTitle: "Tu producto está en revisión",
      reviewBody: "Lo publicamos apenas pase el control de seguridad. Te avisamos por acá.",
      goToStore: "Ver mi tienda",
      goToMarketplace: "Ver marketplace",
      publishAnother: "Publicar otro producto",
    },
  },
} as const;

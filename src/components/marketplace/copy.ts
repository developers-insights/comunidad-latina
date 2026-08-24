/**
 * COPY del módulo MARKETPLACE — local al módulo (no toca src/lib/i18n/*).
 * Español cálido, mismo tono que VIVIENDA/DIRECTORIOS. Un producto es un
 * `listing` kind='product'; la tienda es el `listing` kind='business' dueño.
 */
export const COPY = {
  /**
   * Vendedor: desde el split tiendas/particulares (call con el cliente
   * 2026-07-24) un producto puede venir de una TIENDA (attrs.store_listing_id
   * apunta a un listing kind='business') o de una PERSONA.
   *
   * DOS INSIGNIAS, DOS HECHOS DISTINTOS (fix 2026-08-24 — bug reportado por el
   * cliente: la insignia "Verificada" vivía atada SOLO a `verified` —
   * business_accounts.verified_presence, el plan PAGO "Presencia Verificada"—
   * y sólo se ofrecía a tiendas. Un particular con identidad verificada no
   * tenía ninguna insignia, y la que sí existía sonaba a "confirmamos quién
   * es" cuando en realidad decía "pagó una suscripción". Mismo criterio que ya
   * resuelve el perfil (IdentityBadge = escudo verde gratis vs. CheckAzul =
   * sello azul pago, src/components/verificacion/check-azul.tsx) y que ya usa
   * el propio Marketplace para no llamarle "Destacado" a lo pago
   * (lib/monetization/copy.ts): nombre y estilo distintos por insignia.
   */
  seller: {
    storeLabel: "Tienda",
    privateLabel: "Particular",
    fallbackStoreName: "Tienda de la comunidad",
    fallbackPrivateName: "Miembro de la comunidad",
    storeAriaLabel: (name: string) => `Tienda ${name} — ver su vidriera`,
    privateAriaLabel: (name: string) => `Vendido por ${name}, particular`,

    /** Identidad verificada (profiles.identity_verified) — GRATIS, de
     *  CUALQUIER vendedor: tienda o particular. Escudo verde, como en el perfil. */
    identityLabel: "Identidad verificada",
    identityAriaLabel: "Identidad verificada: confirmó su documento ante Comunidad Latina",

    /** Presencia Verificada (business_accounts.verified_presence) — PLAN PAGO,
     *  solo tiendas. Mismo nombre que ya usa /negocios para el mismo flag: "el
     *  badge de la card usa el nombre real de la feature, no un genérico
     *  'Verificado'" (negocios/business-card.tsx). Sello azul, nunca verde: el
     *  verde queda reservado para la identidad, arriba. */
    presenceVerifiedLabel: "Presencia verificada",
    presenceVerifiedAriaLabel:
      "Presencia verificada: la tienda tiene el plan pago de Comunidad Latina — no es una verificación de identidad",
  },
  list: {
    title: "Marketplace",
    subtitle: "Lo que vende tu comunidad: tiendas y personas",
    /** Nombre accesible de la barra Tiendas/Artículos (NavTabs). */
    tabsLabel: "Secciones del marketplace",
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
    // Tocar la foto abre el visor a pantalla completa; la píldora va al producto
    // (feedback 2026-07-26 — la regla de Vivienda, en todas las cards).
    openPhotos: (title: string) => `Ver fotos de ${title}`,
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
    /** Disponibilidad (spec cliente) — derivada de `status`: todo lo que se
     *  ve acá está a la venta. Ver la nota en marketplace/[id]/page.tsx. */
    availableLabel: "Disponible",
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
    // Tocar la foto de la tienda la abre en el visor; a la vidriera se entra
    // con "Ver tienda" (feedback 2026-07-26).
    openPhotos: (name: string) => `Ver fotos de ${name}`,
    /** Directorio de tiendas: "cantidad de artículos activos" (spec cliente). */
    activeListingCount: (n: number) =>
      n === 0
        ? "Sin artículos activos por ahora"
        : n === 1
          ? "1 artículo activo"
          : `${n.toLocaleString("es-US")} artículos activos`,
    messageTitle: "¿Querés preguntarle algo?",
    messageCta: "Escribirle a la tienda",
    messagePlaceholder: "Hola, quería consultarles por…",

    // --- Tienda apagada (membresía vencida o cancelada, §7) -----------------
    // Dos lecturas del MISMO hecho. Al visitante no le sirve saber que alguien
    // no pagó: le sirve saber que la vidriera no está y qué puede hacer. Al
    // dueño le sirve saber exactamente qué pasó y cómo volver.
    offVisitorTitle: "Esta tienda no está disponible por ahora",
    offVisitorMessage:
      "Sus productos no se están mostrando en el Marketplace. Si conocés al negocio, avisale — vuelve apenas reactive su tienda.",
    offVisitorCta: "Ver otras tiendas y productos",
    offOwnerTitle: "Tu tienda no se está mostrando",
    offOwnerMessage:
      "Tus productos siguen guardados: nada se borró. Reactivá tu membresía y tu tienda vuelve tal como estaba.",
    offOwnerCta: "Reactivar mi tienda",
  },

  // -------------------------------------------------------------------------
  // DIRECTORIO DE TIENDAS — pestaña "Tiendas" (spec cliente). El listado
  // completo de vendedoras/es comerciales, navegable — antes sólo se llegaba a
  // una tienda puntual desde el chip de vendedor de un producto.
  // -------------------------------------------------------------------------
  storesList: {
    searchLabel: "Buscar tiendas en el marketplace",
    searchPlaceholder: "Buscá una tienda…",
    loadMore: "Ver más tiendas",
    emptyTitle: "Todavía no hay tiendas",
    emptyMessage:
      "Acá vas a ver los negocios de la comunidad que venden en el Marketplace. ¿Tenés uno? Podés abrir el tuyo cuando quieras.",
    emptySearchTitle: (q: string) => `No encontramos tiendas con "${q}"`,
    emptySearchMessage: "Probá con otro nombre o mirá todas las tiendas disponibles.",
  },

  // -------------------------------------------------------------------------
  // MEMBRESÍA DE TIENDA — USD 10/mes (§7)
  // -------------------------------------------------------------------------
  membership: {
    title: "Membresía de tienda",
    subtitle: "Tu tienda en el Marketplace de la comunidad, por un precio fijo al mes.",
    priceSuffix: "por mes, por tienda",
    includesTitle: "Qué incluye",
    excludesTitle: "Lo que no cobramos",
    activateCta: "Activar mi tienda",
    reactivateCta: "Reactivar mi tienda",
    manageCta: "Gestionar o cancelar",
    manageHint: "Se abre la facturación de Stripe: ahí cambiás la tarjeta o cancelás.",
    statusTitle: "Estado de tu membresía",
    renewsOn: (date: string) => `Se renueva el ${date}`,
    endsOn: (date: string) => `Vence el ${date}`,
    endedOn: (date: string) => `Venció el ${date}`,
    visibleNow: "Tu tienda se está mostrando",
    hiddenNow: "Tu tienda no se está mostrando",

    needLoginTitle: "Entrá para activar tu tienda",
    needLoginMessage:
      "Con tu cuenta podés activar la membresía de tus tiendas y ver su estado.",
    needLoginCta: "Entrar a mi cuenta",

    noStoresTitle: "Todavía no tenés una tienda",
    noStoresMessage:
      "La membresía se activa sobre una tienda. Creá la tuya y volvé — se hace en un par de minutos.",
    noStoresCta: "Crear mi tienda",

    /** Estados que devuelve el Checkout al volver de Stripe. */
    successTitle: "¡Listo! Tu tienda ya está activa",
    successMessage:
      "Puede tardar unos segundos en aparecer. Si no la ves enseguida, recargá esta página.",
    canceledTitle: "No se cobró nada",
    canceledMessage: "Cerraste el pago antes de terminar. Podés volver a intentarlo cuando quieras.",

    /** Cómo funciona el cobro, dicho antes de pagar y no después. */
    billingNote:
      "Se cobra una vez al mes por cada tienda activa. Cancelás desde acá cuando quieras y no hay cargo por darte de baja.",

    errors: {
      generic:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
      notYours: "Esa tienda no figura como tuya. Revisá desde cuál estás entrando.",
      noPortal:
        "Todavía no hay una facturación abierta para esta tienda. Activá la membresía primero.",
    },
  },

  // -------------------------------------------------------------------------
  // COMPRAR — el checkout ocurre AFUERA (§7)
  //
  // Todo esto se lee ANTES de tocar el botón, no en la letra chica. No es
  // prudencia legal: es el modelo. Comunidad Latina no procesa el pago, y si
  // alguien cree que sí, el reclamo lo vamos a recibir igual.
  // -------------------------------------------------------------------------
  purchase: {
    cta: "Comprar en el sitio del negocio",
    ariaCta: (store: string) => `Comprar en el sitio de ${store} — se abre en otra pestaña`,
    noticeTitle: "Antes de seguir, dos cosas",
    externalHint: "Se abre el sitio del negocio en otra pestaña.",
    /** Regla de oro del repo — la misma frase que usa el Escudo Anti-Estafa. */
    goldenRule: "Nunca envíes dinero por adelantado a alguien que no conocés.",
    policyLink: "Reglas del Marketplace",
  },

  // -------------------------------------------------------------------------
  // REPORTAR un producto (§7) — misma hoja y misma acción que el resto de la
  // app; lo único propio son los motivos.
  // -------------------------------------------------------------------------
  report: {
    title: "¿Este producto no debería estar acá?",
    body: "Contanos qué pasa. Es anónimo para quien vende y lo revisa nuestro equipo.",
    cta: "Reportar este producto",
    policyPrompt: "Mirá qué no se puede vender",
  },
  publish: {
    title: "Publicar un producto",
    subtitle: "Mostrale a la comunidad lo que vendés, en un par de minutos.",
    needLoginTitle: "Para publicar, primero entrá",
    needLoginMessage:
      "Publicar es gratis. Necesitamos que entres a tu cuenta para saber quién vende.",
    needLoginCta: "Entrar a mi cuenta",
    // --- Gate de identidad (spec cliente: "todos los vendedores deben
    // completar la verificación de identidad antes de publicar") — tienda o
    // particular, sin excepción. Se muestra ANTES del formulario, nunca un
    // botón "Publicar" que el servidor va a rechazar. -----------------------
    needIdentityTitle: "Verificá tu identidad para vender acá",
    needIdentityMessage:
      "Sea que vendas desde una tienda o como particular, primero necesitamos confirmar que sos una persona real. Es gratis, es una sola vez y toma un par de minutos con un documento.",
    needIdentityCta: "Verificar mi identidad",
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
    fulfillmentLegend: "¿Cómo lo recibe quien compra?",
    fulfillmentHelp: "Elegí al menos una opción — podés marcar varias.",
    photosTitle: "Fotos del producto",
    photosHelp: "Hasta 4 fotos. Los productos con fotos reciben muchas más consultas.",
    addPhotoLabel: "Agregar foto",
    removePhotoLabel: "Quitar foto",
    tooManyPhotos: "Podés subir hasta 4 fotos.",
    tooBigPhoto: "Esa foto es muy pesada — probá con una de menos de 8 MB.",
    reviewNote: "Las fotos pasan por un control de seguridad antes de publicarse.",
    // Política de productos prohibidos (§7): se acepta AL PUBLICAR, y el enlace
    // está a la vista antes de tocar el botón — no escondido en un tilde.
    policyTitle: "Qué se puede vender",
    policyBody:
      "Hay cosas que no se pueden publicar acá: armas, falsificaciones, medicamentos, documentos y algunas más. Leelas antes de publicar.",
    policyLink: "Reglas del Marketplace",
    policyAccept: "Al publicar aceptás las Reglas del Marketplace.",
    submit: "Publicar producto",
    submitting: "Publicando…",
    errors: {
      titleShort: "El título necesita al menos 8 caracteres.",
      descriptionShort: "Contanos un poco más sobre el producto.",
      priceRequired: "Poné un precio para tu producto.",
      categoryRequired: "Elegí una categoría.",
      conditionRequired: "Decinos si es nuevo o usado.",
      fulfillmentRequired: "Elegí al menos una forma de recibirlo: envío, entrega o recogida.",
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

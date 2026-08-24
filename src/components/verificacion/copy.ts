/**
 * =============================================================================
 * COPY DEL CHECK AZUL
 * =============================================================================
 *
 * LA REGLA QUE MANDA SOBRE TODAS LAS DEMÁS: esta insignia se COMPRA, y el texto
 * no puede hacerla pasar por algo que la plataforma comprobó.
 *
 * Hay dos "verificados" en la app y la gente los va a confundir sola si nosotros
 * no los separamos:
 *   · IDENTIDAD VERIFICADA (escudo verde, gratis) — Stripe Identity miró un
 *     documento. Es un HECHO comprobado por un tercero.
 *   · CHECK AZUL (esta pantalla, pago) — la cuenta paga una suscripción, y para
 *     poder pagarla tuvo que verificar antes su identidad.
 *
 * Por eso el copy dice SIEMPRE las dos cosas juntas y en ese orden: primero el
 * hecho (identidad confirmada), después el pago. Y por eso hay un bloque entero
 * dedicado a decir qué NO significa — no es letra chica defensiva, es lo que
 * evita que alguien mande plata por adelantado porque "tenía el tilde".
 *
 * PALABRAS PROHIBIDAS acá, por §11 y por el contrato 2026-07-30 §4:
 *   "de confianza", "seguro", "avalado", "recomendado por la plataforma",
 *   "negocio verificado" a secas, y "Destacado" (que es el nivel máximo del
 *   Trust Score y se GANA, no se compra).
 *
 * Tono: el de siempre — vecino que explica, no sistema que notifica. Segunda
 * persona, frases cortas, cero jerga de facturación.
 */

export const COPY_VERIFICACION = {
  /* ---------------------------------------------------------------- Página */
  page: {
    title: "El check azul",
    /**
     * Dice qué es en una línea y ya marca la diferencia con lo gratuito. No
     * empieza por el precio: primero se entiende qué se compra.
     */
    subtitle:
      "La insignia que aparece al lado de tu nombre en toda la comunidad. Es para cuentas que ya confirmaron su identidad con documento y quieren que se note.",
    elegirPlan: "Elegí cómo usás la app",
    elegirPlanAyuda:
      "El check es el mismo en los tres. Cambia el precio según para qué usás la cuenta.",
    porMes: "por mes",
    contratar: "Activar el check azul",
    yaLoTenes: "Ya tenés el check azul",
    gestionar: "Gestionar mi suscripción",
    cancelarNota:
      "Cancelás cuando quieras desde tu panel de facturación. La insignia se queda hasta que termine el mes que pagaste.",
    /**
     * Nota de contexto en la tarjeta del plan que coincide con la identidad
     * ACTIVA ahora mismo (`tierDeIdentidadActiva`, perfil-activo). No es una
     * restricción — cualquier escalón se sigue pudiendo elegir, ver el
     * docblock de esa función — así que el texto describe un hecho, no una
     * regla.
     */
    coincideConTuCuenta: "Es el perfil con el que estás actuando ahora.",
  },

  /* ------------------------------------------------- Qué es y qué no es */
  significado: {
    title: "Qué dice tu check azul",
    dice: [
      "Que verificaste tu identidad con un documento real.",
      "Que tenés una suscripción al día en esta comunidad.",
    ],
    noDiceTitle: "Y qué no dice",
    /**
     * Este bloque NO se esconde en un acordeón ni se achica: es la parte que
     * protege a quien LEE la insignia, que no es quien la compra.
     */
    noDice: [
      "No es una recomendación nuestra. No revisamos tu trabajo ni tus productos.",
      "No cambia tu Trust Score ni tu posición en el Escudo Anti-Estafa. Pagar nunca mueve esos números.",
      "No reemplaza las verificaciones oficiales de licencia o habilitación, que se muestran aparte y con su fuente.",
    ],
    /** Se repite el consejo de siempre. Cuesta una línea y evita un fraude. */
    recordatorio:
      "Como siempre: nunca envíes dinero por adelantado, tenga o no tenga check la otra persona.",
  },

  /* ------------------------------------------ Requisito: Stripe Identity */
  identidad: {
    faltaTitle: "Primero verificá tu identidad",
    faltaBody:
      "El check azul solo se activa sobre una cuenta con identidad confirmada. Si no, sería un tilde que no dice nada. Son un par de minutos y una foto de tu documento.",
    faltaCta: "Verificar mi identidad",
    /** Aparece cuando SÍ la tiene: reconoce lo hecho antes de pedir plata. */
    listaTitle: "Tu identidad ya está verificada",
    listaBody: "Ese paso ya está hecho, y es gratis. El check azul se suma a eso.",
  },

  /* ------------------------------------------------ El impulso de regalo */
  regalo: {
    title: "Tu impulso de regalo",
    /** Explica el beneficio SIN prometer resultados de audiencia. */
    blurb:
      "Cada mes que pagás, te damos 7 días de impulso para el aviso que vos elijas. Aparece primero en los resultados de tu zona, marcado como publicidad.",
    disponible: "Tenés un impulso sin usar",
    venceEl: (fecha: string) => `Se vence el ${fecha}`,
    /** La caducidad se dice ANTES de que pase, no cuando ya se perdió. */
    caducidadNota:
      "Es un regalo mensual: si no lo usás antes de que termine el mes, se pierde y llega uno nuevo con el próximo pago.",
    elegirAviso: "Elegí a qué aviso dárselo",
    sinAvisos:
      "Todavía no tenés avisos publicados. Publicá uno y volvé acá para usar tu impulso.",
    canjear: "Usar mi impulso acá",
    canjeadoTitle: "¡Listo! Tu aviso ya está impulsado",
    canjeadoBody: (fecha: string) =>
      `Aparece primero en tu zona, marcado como "Patrocinado", hasta el ${fecha}.`,
    sinRegalo: "Cuando se cobre tu próximo mes, te va a esperar acá un impulso nuevo.",
  },

  /* --------------------------------------------------------- La insignia */
  insignia: {
    /** `aria-label` de la insignia paga. Dice las dos cosas, sin adornos. */
    ariaLabel: "Cuenta verificada con suscripción activa",
    /**
     * Tooltip / texto de apoyo. Es lo único que va a leer la mayoría, así que
     * tiene que caber la advertencia en una frase.
     */
    tooltip:
      "Identidad confirmada con documento y suscripción al día. No es una recomendación de la plataforma.",
  },

  /**
   * ---------------------------------------------------------------------
   * El OTRO "verificado": creador de contenido
   * ---------------------------------------------------------------------
   * Pedido textual del cliente, en la MISMA frase que pidió este check: «el
   * verificado de tipo para que sean creadores de contenido». Es un camino
   * distinto — sus propios requisitos, en `/creadores/solicitud` — y no algo
   * que se activa acá. Se linkea y no se explica en detalle: repetir la lista
   * de requisitos en dos lugares es cómo se termina con dos listas que dicen
   * cosas distintas (la real vive en `src/lib/creators/eligibility.ts`, y ese
   * módulo entero existe para no tener que hacerlo).
   */
  creadores: {
    title: "¿Buscabas el verificado de creador de contenido?",
    body: "Es otro camino, con sus propios requisitos —portafolio, seguidores, videos—. No se activa con el check azul.",
    cta: "Ver los requisitos para creadores",
  },

  /* ------------------------------------------------------------- Errores */
  errors: {
    /**
     * Errores VISIBLES y accionables. Nada de "algo salió mal" a secas: cada uno
     * dice qué pasó y qué hacer, que es lo mínimo cuando hay plata de por medio.
     */
    generic:
      "No pudimos abrir el pago. Probá de nuevo en un minuto; si sigue igual, escribinos y lo miramos.",
    sinIdentidad:
      "Necesitás verificar tu identidad antes de activar el check azul. Es gratis y toma un par de minutos.",
    yaActiva: "Ya tenés el check azul activo. No hace falta que lo pagues de nuevo.",
    sinPortal:
      "Todavía no tenemos un pago tuyo registrado, así que no hay nada que gestionar.",
    noEsTuyo: "Ese aviso no es tuyo, así que no podemos impulsarlo.",
    noPublicado:
      "Ese aviso no está publicado. Publicalo primero y después usá tu impulso.",
    sinRegalo:
      "No tenés ningún impulso de regalo disponible en este momento.",
    regaloVencido:
      "Ese impulso venció al terminar el mes. Con tu próximo pago te llega uno nuevo.",
    regaloYaUsado: "Ese impulso ya lo usaste.",
    tenantSinAlcance:
      "No pudimos determinar la zona de tu aviso. Agregale un área y probá de nuevo.",
  },
} as const;

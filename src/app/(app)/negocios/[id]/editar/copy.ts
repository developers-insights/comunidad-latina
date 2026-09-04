/**
 * Textos de "Editar la página de tu negocio".
 *
 * Reglas de este archivo, heredadas del resto de /negocios: se habla en
 * segunda persona y en presente, los vacíos dicen la verdad y ningún error
 * culpa a la persona. Y una propia de esta pantalla: acá el dueño está
 * escribiendo la CARA de su negocio, así que cada ayuda dice DÓNDE se va a ver
 * lo que escriba — es la diferencia entre completar un formulario y entender
 * qué gana completándolo.
 */
export const EDITAR_NEGOCIO_COPY = {
  title: "Editar la página",
  subtitle: "Así te va a ver la gente en el directorio y en cada cosa que publiques.",

  /** Fotos: logo y portada. */
  fotos: {
    heading: "Fotos de tu negocio",
    logoLabel: "Foto de tu negocio",
    logoHelp:
      "Es la que se ve al lado de tu nombre en todos lados. Un logo o la fachada del local funcionan bien.",
    coverLabel: "Portada",
    coverHelp: "La franja ancha de arriba de tu página. Se ve mejor una foto apaisada.",
    elegir: "Elegir una foto",
    cambiar: "Cambiar la foto",
    quitar: "Quitar",
    subiendo: "Subiendo…",
    quitando: "Quitando…",
    subida: "Listo, la foto ya está en tu página.",
    quitada: "Listo, sacamos la foto.",
    formatos: "JPG, PNG o WebP, hasta 5 MB.",
  },

  /** Datos de la página. */
  datos: {
    heading: "Información",
    nombreLabel: "Nombre del negocio",
    nombreHelp: "Es el nombre con el que aparecés en la comunidad.",
    descripcionLabel: "Sobre el negocio",
    descripcionHelp: "Contá qué hacés y qué te diferencia. Sin apuro, esto lo lee gente que todavía no te conoce.",
    descripcionPlaceholder: "Somos una constructora familiar del Bronx. Trabajamos con…",
    rubroLabel: "Rubro",
    rubroHelp: "Ayuda a que te encuentren cuando buscan lo que hacés.",
    rubroVacio: "Sin rubro",
    zonaLabel: "Zona",
    zonaHelp: "El barrio o el área donde trabajás. Sin calle ni número.",
    zonaPlaceholder: "Jackson Heights, Queens",
  },

  /** Servicios. */
  servicios: {
    heading: "Servicios que ofrecés",
    intro:
      "Una lista corta de lo que hacés. Se ve en tu página, debajo de la descripción.",
    inputLabel: "Agregar un servicio",
    inputPlaceholder: "Ej.: instalación de pisos",
    agregar: "Agregar",
    quitarAria: (servicio: string) => `Quitar ${servicio}`,
    vacio: "Todavía no agregaste ninguno.",
    contador: (cantidad: number, tope: number) => `${cantidad} de ${tope}`,
    lleno: (tope: number) =>
      `Ya cargaste los ${tope}. Quitá alguno si querés sumar otro.`,
    muyLargo: (tope: number) => `Escribilo más corto: hasta ${tope} caracteres.`,
    repetido: "Ese ya está en la lista.",
  },

  /** Contacto (los botones del plan). */
  contacto: {
    heading: "Cómo te contactan",
    telefonoLabel: "Teléfono",
    whatsappLabel: "WhatsApp",
    webLabel: "Sitio web",
    direccionLabel: "Dirección",
    direccionHelp: "La que quieras publicar para que sepan cómo llegar.",
    /**
     * En tier free el CHECK de la base (0048) prohíbe guardar estos botones:
     * el único contacto es el chat. Se dice lo que HAY, sin venderle nada a
     * quien no preguntó.
     */
    soloPremium:
      "Los botones de llamar, WhatsApp, sitio web y cómo llegar son parte de Presencia Verificada. Mientras tanto, la gente te escribe por el chat de Comunidad Latina.",
    verPlanes: "Ver Presencia Verificada",
  },

  /** Horarios: no se duplican acá, se enlaza el editor que ya existe. */
  horarios: {
    heading: "Horarios de atención",
    body: "Los días y las horas que abrís se cargan en su propia pantalla, con un tramo por día.",
    cta: "Editar mis horarios",
  },

  guardar: "Guardar cambios",
  guardando: "Guardando…",
  volver: "Volver a la página",

  ok: "Listo, tu página quedó actualizada.",

  errores: {
    sesion: "Tu sesión se cerró — entrá de nuevo para seguir.",
    permiso: "Esta página no la podés editar con el perfil que estás usando.",
    nombreCorto: "Escribí el nombre de tu negocio.",
    nombreLargo: "El nombre es muy largo: probá con uno de hasta 80 caracteres.",
    descripcionLarga: "La descripción es muy larga. Probá con una versión más corta.",
    zonaLarga: "La zona es muy larga — con el barrio alcanza.",
    contactoLargo: "Ese dato es muy largo. Revisalo y probá de nuevo.",
    serviciosMuchos: (tope: number) => `Podés cargar hasta ${tope} servicios.`,
    serviciosLargos: (tope: number) => `Cada servicio va en hasta ${tope} caracteres.`,
    contactoPremium:
      "Los botones de contacto son parte de Presencia Verificada. Guardamos el resto de los cambios cuando los saques.",
    generico:
      "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  },

  /** Errores de la subida de una foto. Cada uno dice qué hacer distinto. */
  erroresFoto: {
    tipo: "Esa no parece una foto. Probá con un JPG, PNG o WebP.",
    peso: "La foto pesa más de 5 MB. Probá con una más liviana.",
    vacia: "No llegó ningún archivo. Elegí la foto de nuevo.",
    ilegible: "No pudimos abrir esa foto. Probá con otro archivo.",
    chicaLogo: "Esa foto es muy chica y se va a ver borrosa. Buscá una de al menos 200 por 200.",
    chicaPortada:
      "Para la portada hace falta una foto más grande: al menos 640 de ancho.",
    enorme: "Esa foto es enorme. Probá con una versión más chica.",
    repetida:
      "Esa misma imagen ya está publicada en la comunidad. Si es tuya, escribinos y lo revisamos.",
    subida: "No pudimos subir la foto. Revisá tu conexión y probá de nuevo.",
    demasiadas: "Subiste varias fotos seguidas. Esperá un momento y seguimos.",
    generico: "No pudimos guardar la foto. Probá de nuevo en un momento.",
  },
} as const;

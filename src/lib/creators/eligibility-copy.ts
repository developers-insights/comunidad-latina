/**
 * =============================================================================
 * DE CÓDIGO A CASTELLANO — la traducción de `reasons` para la persona
 * =============================================================================
 *
 * `app.creator_activation_eligible()` devuelve códigos: `seguidores`,
 * `user_score`, `restriccion_marketplace`. Son perfectos para una base de datos
 * y pésimos para alguien que quiere trabajar: no dicen cuánto falta, no dicen
 * qué hacer, y "user_score" ni siquiera está en español.
 *
 * Este módulo es la única frontera entre los dos idiomas. Regla dura: NINGÚN
 * código crudo puede llegar a la pantalla — hay un test que recorre
 * `ELIGIBILITY_REASONS` entero y exige que cada uno tenga su texto, así que un
 * código nuevo en una migración futura rompe el build antes de llegar a un
 * usuario.
 *
 * Tono: rioplatense-neutro y cálido (§5 de ARQUITECTURA). Nunca "no calificás",
 * que suena a un juicio sobre la persona; siempre el número exacto que falta y
 * el próximo paso concreto.
 * =============================================================================
 */

import type { EligibilityCheck, EligibilityReason } from "./eligibility";

export interface EligibilityAction {
  label: string;
  href: string;
}

export interface EligibilityCopy {
  /** Nombre del requisito, tal como lo lee el aspirante. */
  title: string;
  /** Qué le falta y cuánto. Nunca un código, nunca un "inválido". */
  detail: string;
  /** El próximo paso, cuando hay una pantalla donde resolverlo. */
  action?: EligibilityAction;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n.toLocaleString("es-US")} ${many}`;
}

function num(value: number): string {
  return value.toLocaleString("es-US");
}

/** El título de cada requisito, con el corte adentro cuando es un número. */
function titleOf(check: EligibilityCheck): string {
  const target = check.target ?? 0;
  switch (check.reason) {
    case "perfil_inexistente":
      return "Tu cuenta";
    case "edad_minima":
      return `Tener ${target} años o más`;
    case "perfil_incompleto":
      return "Perfil completo";
    case "telefono":
      return "Teléfono verificado";
    case "correo":
      return "Correo verificado";
    case "identidad":
      return "Identidad verificada";
    case "user_score":
      return `User Score de ${target} o más`;
    case "cuenta_activa":
      return "Cuenta sin suspensiones";
    case "restriccion_marketplace":
      return "Cuenta sin restricciones";
    case "stripe_connect":
      return "Cuenta de cobros activa";
    case "portafolio":
      return `${plural(target, "ejemplo", "ejemplos")} en tu portafolio`;
    case "seguidores":
      return `${plural(target, "seguidor", "seguidores")} en la comunidad`;
    case "videos":
      return `${plural(target, "video publicado", "videos publicados")}`;
    case "vistas":
      return `${num(target)} vistas acumuladas`;
    case "terminos_creador":
      return "Términos de creador aceptados";
  }
}

/** Lo que falta, dicho con el número exacto. */
function missingDetail(check: EligibilityCheck): string {
  const { remaining } = check;
  switch (check.reason) {
    case "perfil_inexistente":
      return "No encontramos tu perfil. Cerrá sesión y volvé a entrar; si sigue igual, escribinos.";
    case "edad_minima":
      return check.current === null
        ? "Todavía no tenemos tu fecha de nacimiento. Cargala en tu perfil y listo."
        : `Vas a poder activarte cuando cumplas ${check.target} años.`;
    case "perfil_incompleto":
      return "Te falta completar algún dato del perfil: nombre, apellido, usuario, foto, bio o país de origen.";
    case "telefono":
      return "Confirmá tu número con el código que te mandamos por SMS.";
    case "correo":
      return "Abrí el correo que te enviamos y tocá el enlace de confirmación.";
    case "identidad":
      return "Verificá tu identidad con un documento. Es una sola vez y queda listo para siempre.";
    case "user_score":
      return `Te faltan ${plural(remaining, "punto", "puntos")}. Tenés ${num(check.current ?? 0)} de ${num(check.target ?? 0)}: el puntaje sube solo con actividad sana en la comunidad.`;
    case "cuenta_activa":
      return "Tu cuenta está suspendida. Cuando se levante la suspensión vas a poder volver a intentarlo.";
    case "restriccion_marketplace":
      return "Tenés una restricción vigente para operar en el marketplace.";
    case "stripe_connect":
      return "Conectá tu cuenta de cobros para poder recibir los pagos de tus trabajos.";
    case "portafolio":
      return `Te ${remaining === 1 ? "falta" : "faltan"} ${plural(remaining, "ejemplo", "ejemplos")}. Subí tus mejores trabajos: es lo primero que mira el negocio que contrata.`;
    case "seguidores":
      return `Te ${remaining === 1 ? "falta" : "faltan"} ${plural(remaining, "seguidor", "seguidores")}. Tenés ${num(check.current ?? 0)} de ${num(check.target ?? 0)}.`;
    case "videos":
      return `Te ${remaining === 1 ? "falta" : "faltan"} ${plural(remaining, "video", "videos")}. Tenés ${num(check.current ?? 0)} de ${num(check.target ?? 0)}.`;
    case "vistas":
      return `Te faltan ${num(remaining)} vistas. Tenés ${num(check.current ?? 0)} de ${num(check.target ?? 0)}.`;
    case "terminos_creador":
      return "Leé y aceptá los términos de creador. Son cortos y explican cómo se cobra.";
  }
}

/** Cuando ya está resuelto. Corto: nadie necesita un párrafo para "listo". */
function metDetail(check: EligibilityCheck): string {
  switch (check.reason) {
    case "user_score":
      return `Listo — tenés ${num(check.current ?? 0)} puntos.`;
    case "seguidores":
    case "videos":
    case "portafolio":
      return `Listo — tenés ${num(check.current ?? 0)}.`;
    case "vistas":
      return `Listo — juntaste ${num(check.current ?? 0)} vistas.`;
    default:
      return "Listo.";
  }
}

/** Dónde se resuelve cada cosa. Solo rutas que existen. */
function actionOf(reason: EligibilityReason): EligibilityAction | undefined {
  switch (reason) {
    case "edad_minima":
    case "perfil_incompleto":
      return { label: "Completar mi perfil", href: "/perfil#editar-perfil" };
    case "identidad":
      return { label: "Verificar mi identidad", href: "/perfil/verificar" };
    case "portafolio":
      return { label: "Cargar mi portafolio", href: "/creadores/perfil" };
    case "videos":
    case "vistas":
      return { label: "Publicar un video", href: "/publicar" };
    case "terminos_creador":
      return { label: "Leer los términos", href: "/creadores/terminos" };
    default:
      // Teléfono, correo, score, suspensiones y cobros no tienen hoy una
      // pantalla propia a la que mandar. Antes que un enlace que lleva a
      // ningún lado, el texto solo: dice qué hacer sin prometer un botón.
      return undefined;
  }
}

/**
 * Traduce un requisito evaluado a lo que ve la persona.
 *
 * `unknown` no debería aparecer nunca en el camino del aspirante —cada quien
 * lee todos sus propios datos— pero se contempla igual: si una consulta falla,
 * la pantalla dice "no lo pudimos leer" en vez de acusar de incumplir.
 */
export function describeEligibilityCheck(check: EligibilityCheck): EligibilityCopy {
  const title = titleOf(check);
  if (check.status === "met") return { title, detail: metDetail(check) };
  if (check.status === "unknown") {
    return {
      title,
      detail: "No pudimos leer este dato ahora mismo. Volvé a intentar en un rato.",
    };
  }
  return { title, detail: missingDetail(check), action: actionOf(check.reason) };
}

/**
 * Etiqueta corta del código, para el panel de administración (donde el admin
 * necesita ver "qué umbral está cortando" y no un consejo dirigido a otro).
 */
export const REASON_ADMIN_LABEL: Record<EligibilityReason, string> = {
  perfil_inexistente: "Perfil inexistente",
  edad_minima: "Edad mínima",
  perfil_incompleto: "Perfil incompleto",
  telefono: "Teléfono sin verificar",
  correo: "Correo sin verificar",
  identidad: "Identidad sin verificar",
  user_score: "User Score bajo",
  cuenta_activa: "Cuenta suspendida",
  restriccion_marketplace: "Restricción de marketplace",
  stripe_connect: "Sin cuenta de cobros",
  portafolio: "Portafolio corto",
  seguidores: "Pocos seguidores",
  videos: "Pocos videos",
  vistas: "Pocas vistas",
  terminos_creador: "Términos sin aceptar",
};

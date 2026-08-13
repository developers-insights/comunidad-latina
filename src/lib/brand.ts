/**
 * La MARCA DEL PROGRAMA, separada del nombre de cada comunidad.
 *
 * Por qué existe este archivo (2026-08-13, a raíz de un incidente en vivo):
 *
 * "Comunidad Latina" NO es una comunidad — es el programa entero. Adentro viven
 * las comunidades ("Dominicanos en USA", "Mexicanos en USA", …), cada una con su
 * propia fila en `tenants` y, a futuro, su propio dominio. Esa distinción existía
 * en el modelo de datos desde el principio, pero NO en la interfaz: el header
 * pintaba `tenant.name`, así que el nombre de la comunidad y el de la marca eran
 * la misma cadena para el usuario.
 *
 * Cuando se quiso que el header dijera "Comunidad Latina", el atajo fue renombrar
 * el tenant `dominicanos` a "Comunidad Latina" en la base. Eso dejó DOS filas de
 * `tenants` con el mismo `name` — la comunidad y la marca — y el aviso de
 * divergencia entre tenants se volvió literalmente absurdo: «Estás mirando
 * Comunidad Latina, pero tu cuenta vive en Comunidad Latina».
 *
 * La lección: el nombre visible de la plataforma es una CONSTANTE de marca, no un
 * dato del tenant. Renombrar tenants para arreglar lo que dice el header es
 * arreglar el espejo en vez de la cara.
 *
 * Regla de uso:
 *  · Chrome de la app (header, pantallas de auth, footer, manifest) → esta
 *    constante. Siempre dice lo mismo, sea cual sea la comunidad servida.
 *  · Texto que habla de ESTA comunidad en particular (normas, legales, SEO,
 *    el "Una comunidad de …" del footer) → `tenant.name`, que es lo correcto ahí.
 */
export const BRAND_NAME = "Comunidad Latina" as const;

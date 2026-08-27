/**
 * EL INTERRUPTOR DEL ESCUDO — uno solo, para las seis pantallas.
 *
 * El cliente pidió el 2026-07-20 que el Escudo no figurara en ningún lado de la
 * app. Se resolvió con un `const ESCUDO_ENABLED = false` COPIADO en cada
 * `page.tsx` del módulo, y esa copia es el problema: reactivarlo es acordarse de
 * seis archivos, y olvidarse de uno deja una pantalla del módulo respondiendo
 * 200 mientras el resto responde 404 — que es la peor de las dos opciones,
 * porque nadie lo va a notar hasta que alguien la comparta.
 *
 * Desde acá el estado del módulo se lee y se cambia en UN lugar.
 *
 * ⚠️ SIGUE EN `false` A PROPÓSITO. La pantalla de transparencia (0122) nace
 * detrás de este mismo interruptor: reactivar el módulo entero es una decisión
 * de producto —el pedido de "dar a conocer qué tan segura es la plataforma"
 * llegó después de la orden de esconderlo— y no la toma un deploy. Cuando se
 * tome, es esta línea y ninguna otra.
 *
 * Tipado como `boolean` y no como el literal `false` para que TypeScript no
 * marque como código muerto el resto de cada página y rompa el narrowing.
 */
export const ESCUDO_ENABLED: boolean = false;

/**
 * =============================================================================
 * LA EXCEPCIÓN: LA TRANSPARENCIA SÍ SE VE
 * =============================================================================
 *
 * El 2026-08-26 el cliente pidió, con estas palabras: «Casos de seguridad, dar
 * a conocer y ver qué tan segura es la plataforma». Es un pedido POSTERIOR al
 * de esconder el Escudo (2026-07-20) y apunta exactamente en la dirección
 * contraria — pero sólo para ESTA cara del módulo.
 *
 * Por eso el interruptor se parte en dos en vez de encenderse entero:
 *
 *  · `ESCUDO_ENABLED` sigue en `false`. El verificador de matrículas, el
 *    formulario de denuncia, la pantalla de aprender y la del Trust Score son
 *    las que el cliente mandó esconder, y ninguna de las cuatro es lo que pidió
 *    en agosto. Encenderlas de arrastre sería usar un pedido nuevo para revertir
 *    una orden vieja que nadie revirtió.
 *  · `TRANSPARENCIA_ENABLED` en `true`. Es lo único que el pedido nombra: la
 *    evidencia de qué hace el sistema, con números que salen de la base.
 *
 * CONSECUENCIA QUE HAY QUE TENER PRESENTE: `/escudo/transparencia` cuelga de un
 * padre que responde 404. En Next eso funciona (un segmento no necesita que su
 * padre tenga `page.tsx`), pero significa que la pantalla NO puede ofrecer
 * "volver al Centro de seguridad" — ese centro hoy no existe para nadie. Su
 * link de volver apunta al feed, que es de donde se llega.
 *
 * El día que se reactive el Escudo entero, esta constante desaparece y la
 * pantalla vuelve a colgar de `ESCUDO_ENABLED` como sus hermanas.
 */
export const TRANSPARENCIA_ENABLED: boolean = true;

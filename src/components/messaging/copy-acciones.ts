import { COPY } from "./copy";

/**
 * Alias histórico: el copy de las acciones sobre un mensaje ya vive adentro de
 * `COPY`. Se mantiene el nombre para no tocar los siete archivos que lo
 * importan; el texto se edita en `copy.ts`, nunca acá.
 */
export const ACCIONES_COPY = COPY.acciones;

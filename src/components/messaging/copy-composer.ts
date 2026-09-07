import { COPY } from "./copy";

/**
 * Alias histórico: el copy de la barra de mensaje ya vive adentro de `COPY`.
 * Se mantiene el nombre para no tocar los diez archivos que lo importan; el
 * texto se edita en `copy.ts`, nunca acá.
 */
export const COPY_COMPOSER = COPY.composer;

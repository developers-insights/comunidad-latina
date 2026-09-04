/**
 * El puente entre el "Volver" de la barra superior y el paso actual del wizard.
 *
 * El formulario de Empleos tiene 4 pasos (3 el de Servicios) y su propio
 * "Atrás" al pie. Sin este puente, la barra de arriba haría lo ÚNICO que sabe
 * hacer —irse de la pantalla— y alguien que está en el paso 3 perdería los tres
 * pasos escritos por tocar el control que la app le enseñó a usar en todas las
 * demás pantallas.
 *
 * Viaja por un `ref` y no por props/estado a propósito: el router del wizard
 * sólo necesita PREGUNTARLE al formulario cuando alguien toca Volver, y subir
 * el paso a estado del padre obligaría a re-renderizar el formulario entero en
 * cada tecla.
 */
export interface WizardHandle {
  /**
   * Retrocede un paso. Devuelve `false` cuando ya estaba en el primero (o
   * cuando el aviso ya se publicó), que es la señal de "acá se sale del flujo".
   */
  retroceder: () => boolean;
  /** ¿Hay algo escrito que se perdería al salir? */
  hayDatos: () => boolean;
}

export interface WizardHandleRef {
  current: WizardHandle | null;
}

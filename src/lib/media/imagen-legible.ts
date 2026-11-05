/**
 * ¿El navegador puede ABRIR esta imagen? El tipo y el peso no alcanzan para
 * saberlo: un HEIC en Chrome, o un archivo dañado con extensión `.png`, pasan
 * esos dos filtros y terminan en una miniatura rota, con ancho natural 0.
 *
 * Se prueba con un `<img>` y no con `createImageBitmap` porque la pregunta es
 * exactamente ésa: si la vista previa se va a poder dibujar.
 */
export function imagenLegible(archivo: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    const terminar = (legible: boolean) => {
      URL.revokeObjectURL(url);
      resolve(legible);
    };
    imagen.onload = () => terminar(imagen.naturalWidth > 0);
    imagen.onerror = () => terminar(false);
    imagen.src = url;
  });
}

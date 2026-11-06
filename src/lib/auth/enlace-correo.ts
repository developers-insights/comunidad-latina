/**
 * Los enlaces de un solo uso que salen por correo no se canjean con el GET.
 *
 * Outlook, Gmail y los antivirus de empresa abren cada link del mail antes que la
 * persona. Si el GET gasta el token, quien toca el botón recibe "enlace vencido" sin
 * haber hecho nada mal. Por eso el GET lleva a /enlace y el canje va en un POST que
 * sólo sale de tocar el botón de esa página.
 */
export const DESTINOS_DE_ENLACE = ["/confirmar", "/callback"] as const;
export type DestinoDeEnlace = (typeof DESTINOS_DE_ENLACE)[number];

export function paginaDelEnlace(origin: string, destino: DestinoDeEnlace, request: Request): URL {
  const entrada = new URL(request.url).searchParams;
  const salida = new URL("/enlace", origin);
  salida.searchParams.set("destino", destino);
  for (const clave of ["token_hash", "type", "next"]) {
    const valor = entrada.get(clave);
    if (valor) salida.searchParams.set(clave, valor);
  }
  return salida;
}

/** Sin esto, otro sitio podría postear su propio token y dejarte en SU cuenta. */
export function vieneDeOtroSitio(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

export async function camposDelEnlace(request: Request) {
  const form = await request.formData();
  const texto = (clave: string) => {
    const valor = form.get(clave);
    return typeof valor === "string" && valor ? valor : null;
  };
  return { tokenHash: texto("token_hash"), type: texto("type"), next: texto("next") };
}

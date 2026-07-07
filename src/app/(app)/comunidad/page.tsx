import { redirect } from "next/navigation";

/**
 * La "Comunidad" ya vive en el feed social (R2). Esta ruta se mantiene solo
 * para no romper enlaces/bookmarks antiguos y redirige al feed real — nunca
 * una página que confiese estar sin terminar (§1.3 / §4.d: ausencia, no
 * negativo). La navegación primaria surface /escudo en su lugar.
 */
export default function ComunidadPage() {
  redirect("/feed");
}

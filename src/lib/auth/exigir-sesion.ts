import { redirect } from "next/navigation";
import { createClient, getAuthUserId } from "@/lib/supabase/server";

/**
 * Manda a /entrar a quien no tiene sesión. SE LLAMA DESDE UN `layout.tsx`, no
 * desde la página, y el lugar es todo el punto de esta función.
 *
 * Un `loading.tsx` envuelve a la PÁGINA de su segmento en un `<Suspense>`, pero
 * no al `layout.tsx` del mismo segmento. Cuando la página redirige, los headers
 * ya salieron: la respuesta es un 200 y el redirect viaja adentro del stream
 * (`01-app/03-api-reference/03-file-conventions/loading.md`, §Status Codes).
 * En esta versión (Next 16.2.12 + React 19.2.4) ese camino rompe en el cliente:
 * el `Router` de Next tira el error #310 y el visitante ve "This page couldn't
 * load" hasta que el `<meta refresh>` de respaldo lo saca a 1 segundo. Medido
 * sobre `next start` el 2026-11-05 en /mensajes y /notificaciones.
 *
 * Desde el layout el redirect corre ANTES del boundary, así que sale como un
 * 307 de verdad y el navegador ni llega a hidratar la pantalla protegida.
 *
 * La página conserva su propio chequeo: un layout no se vuelve a ejecutar en
 * una navegación interna, y además ahí es donde se usa el id. El test
 * `src/app/redirect-bajo-loading.test.ts` impide que aparezca un caso nuevo.
 */
export async function exigirSesion(destino: string): Promise<void> {
  const userId = await getAuthUserId();
  if (!userId) redirect(`/entrar?next=${encodeURIComponent(destino)}`);
}

/**
 * `exigirSesion()`, más mandar a /bienvenida a la cuenta sin fila de perfil. Mismo
 * motivo y mismo lugar: ese redirect, desde una página debajo de `loading.tsx`, rompe
 * igual. Es el caso raro de un alta que quedó a medias, así que esta lectura sólo
 * decide eso: si falla no se echa a nadie, y la página conserva su propio chequeo.
 */
export async function exigirPerfil(destino: string): Promise<void> {
  await exigirSesion(destino);

  const [userId, supabase] = await Promise.all([getAuthUserId(), createClient()]);
  if (!userId) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!error && !data) redirect("/bienvenida");
}

import { redirect } from "next/navigation";
import { Banner } from "@/components/ui";
import { SelectorDeCreacion, opcionesDisponibles } from "@/components/boosts";
import { SectionTopBar } from "@/components/shell";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

export const metadata = { title: "Publicá algo nuevo" };

/**
 * Copy local del selector — mismo criterio que el índice: el módulo BOOST no
 * escribe en `components/feed/copy.ts` ni en `lib/i18n` (compartidos).
 */
const COPY = {
  titulo: "¿Qué querés promocionar?",
  /**
   * Dice el mecanismo en dos frases porque es lo que NO es obvio: en esta app
   * no se "crea una publicidad" de la nada — se publica algo propio y después
   * se paga para que llegue más lejos. Quien llegó buscando el botón de crear
   * un anuncio tiene que entender el orden antes de elegir una fila.
   */
  bajada:
    "Primero se publica, después se promociona. Elegí qué querés crear y volvé a Boost cuando esté listo.",
  revision:
    "Algunos avisos pasan por una revisión corta antes de salir. Mientras tanto lo vas a ver acá en Boost como «En revisión»: te avisamos apenas se apruebe y ahí sí lo podés promocionar.",
} as const;

/**
 * /impulsar/crear — el selector que abre "Publicá algo nuevo" en Boost.
 *
 * ES UNA PANTALLA Y NO UNA HOJA. La alternativa era un `BottomSheet` como el
 * del "+", pero eso obliga a un componente cliente que reciba `modules` por
 * props, y acá no hace falta nada de eso: la RSC ya tiene el tenant resuelto,
 * así que las opciones se filtran en el servidor y la página baja sin una
 * línea de JavaScript. Además gana URL propia (compartible, con back del
 * sistema y del `SectionTopBar`), que una hoja no tiene.
 *
 * NO CREA NADA. Cada fila linkea al creador que ya existe —el mismo del "+"—
 * porque lo que Boost promociona son filas de `listings` y `posts`, y un
 * segundo creador de avisos sería un camino paralelo que se desincroniza con
 * las reglas del original (gate de identidad, módulos apagados, límites
 * diarios).
 *
 * EL REGRESO. El wizard de /publicar ya cierra su pantalla de éxito con
 * "Impulsar este anuncio" → /impulsar/[listingId], así que las cuatro
 * verticales que salen por ahí vuelven solas y hasta el final. Empleos,
 * marketplace, creadores y el feed terminan en su propia pantalla de éxito
 * (que no es de este módulo): quien vuelva a /impulsar por el nav o por atrás
 * se encuentra lo recién hecho arriba de todo y marcado "Recién creado", que
 * es lo que hace `esReciente` en `../impulsar-items.ts`.
 */
export default async function CrearParaPromocionarPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/impulsar/crear");

  const opciones = opcionesDisponibles(tenant.modules, tenant.modulesSoon);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <SectionTopBar fallbackHref="/impulsar" />
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.titulo}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
          {COPY.bajada}
        </p>
      </header>

      <SelectorDeCreacion opciones={opciones} />

      <Banner variant="info" className="rounded-lg leading-relaxed">
        {COPY.revision}
      </Banner>
    </div>
  );
}

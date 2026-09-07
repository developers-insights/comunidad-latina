import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { postMediaUrl } from "@/components/feed/helpers";
import { recortar } from "@/components/share/metadata";

/**
 * =============================================================================
 * LA IMAGEN QUE SE VE CUANDO ALGUIEN PEGA EL LINK DE UNA PUBLICACIÓN
 * =============================================================================
 *
 * No existía ninguna og:image dinámica en el repo: todo enlace compartido caía
 * en la imagen genérica del layout raíz, la misma para las cuarenta mil
 * publicaciones. Acá se genera una por publicación.
 *
 * ── RUNTIME ────────────────────────────────────────────────────────────────
 * SIN `export const runtime = "edge"`. `next/og` corre perfecto en el runtime
 * por defecto (Node) y es el único donde `@/lib/supabase/server` puede leer las
 * cookies como lo hace el resto de la app. Ponerlo en edge obligaría a duplicar
 * el cliente de Supabase para esta sola ruta.
 *
 * ── PRIVACIDAD ─────────────────────────────────────────────────────────────
 * Sólo `published`. Un post en revisión o dado de baja devuelve la placa de la
 * comunidad, sin una palabra de su contenido: esta imagen la sirve un endpoint
 * público que crawlers y proxies cachean, así que no puede mostrar nada que la
 * página le fuera a negar a quien abra el link.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Publicación de la comunidad";

/** ¿La ruta es una foto (y no un video, que no se puede pintar acá)? */
function esFoto(path: string): boolean {
  return !/\.(mp4|mov|webm|m4v)$/i.test(path);
}

type PostOgRow = {
  body: string | null;
  media: string[] | null;
  status: string;
  /** 0132; todavía no está en los tipos generados. Ver el `as` del select. */
  video_poster_path?: string | null;
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const { data } = await supabase
    .from("posts")
    // El VALOR pide `video_poster_path` (0132) y el TIPO se queda en las
    // columnas que `database.types.ts` ya conoce — el mismo `as` que documenta
    // `POST_COLUMNS` en feed/queries.ts, y por el mismo motivo: los tipos se
    // regeneran a mano. La forma real de la fila la fija `PostOgRow`.
    .select("body, media, status, video_poster_path" as "body, media, status")
    .eq("id", id)
    .maybeSingle();

  const post = data as PostOgRow | null;
  const publico = post?.status === "published";
  const texto = publico ? recortar(post?.body, 150) : null;

  const rutaFoto = publico
    ? ((post?.media ?? []).find((path) => path && esFoto(path)) ??
      post?.video_poster_path ??
      null)
    : null;
  const fotoUrl = rutaFoto ? postMediaUrl(rutaFoto) : null;

  const marca = tenant.brandHex || "#1a5edb";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // Nada de blanco plano: crema de la marca con dos luces suaves detrás,
          // que es el fondo con el que la app se distingue de un lienzo vacío.
          backgroundColor: "#fcfbf7",
          backgroundImage: `radial-gradient(at 12% 8%, ${marca}22 0px, transparent 55%), radial-gradient(at 92% 96%, ${marca}18 0px, transparent 50%)`,
        }}
      >
        {fotoUrl ? (
          /* CON FOTO: la foto manda y ocupa la mitad de arriba. El texto vive en
             una banda sólida abajo — encimarlo sobre la imagen sería apostar el
             contraste a una foto que puede ser de cualquier color. */
          <div style={{ display: "flex", width: "100%", height: 400 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori sólo entiende <img>; next/image no existe dentro de ImageResponse */}
            <img
              src={fotoUrl}
              alt=""
              width={1200}
              height={400}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            padding: fotoUrl ? "36px 64px" : "64px",
          }}
        >
          {texto ? (
            <div
              style={{
                display: "flex",
                fontSize: fotoUrl ? 40 : 60,
                fontWeight: 700,
                lineHeight: 1.2,
                color: "#1c1917",
                // Sin la foto hay lugar para más texto; con foto, dos renglones.
                maxHeight: fotoUrl ? 100 : 340,
                overflow: "hidden",
              }}
            >
              {texto}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 700,
                color: "#1c1917",
              }}
            >
              Una publicación de la comunidad
            </div>
          )}

          {/* Firma: el punto de color es la marca del tenant, así una comunidad
              no se confunde con otra en un chat lleno de links. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: marca,
                marginRight: 14,
              }}
            />
            <div
              style={{
                display: "flex",
                fontSize: 26,
                fontWeight: 600,
                color: "#57534e",
              }}
            >
              {tenant.name}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

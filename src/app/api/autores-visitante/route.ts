import { NextResponse } from "next/server";
import { z } from "zod";
import { perfilesDeVisitante, puntajesDeVisitante } from "@/lib/perfiles/visitante";
import { clientIpFromHeaders, limit } from "@/lib/rate-limit";

const TOPE_POR_MINUTO = 60;

const pedido = z.object({
  tipo: z.enum(["perfiles", "puntajes"]),
  ids: z.array(z.guid()).min(1).max(200),
});

/** Los autores de la hoja de comentarios para un visitante: ver `lib/perfiles/publicos`. */
export async function POST(request: Request) {
  const ip = clientIpFromHeaders(request.headers);
  if (!limit(`autores-visitante:${ip}`, TOPE_POR_MINUTO, 60_000).ok) {
    return NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 });
  }

  const cuerpo = pedido.safeParse(await request.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  const { tipo, ids } = cuerpo.data;
  return NextResponse.json(
    tipo === "perfiles" ? await perfilesDeVisitante(ids) : await puntajesDeVisitante(ids),
  );
}

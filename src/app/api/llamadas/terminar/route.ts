import { NextResponse } from "next/server";
import { z } from "zod";
import { terminarLlamadaAction } from "@/app/(app)/llamadas/actions";

export const runtime = "nodejs";

const cuerpoSchema = z.object({ callId: z.uuid() });

/**
 * El mismo "colgar" que la server action, pero alcanzable con
 * `navigator.sendBeacon`. En `pagehide` (cerrar la pestaña, bloquear el
 * teléfono con Safari) el navegador aborta los fetch en vuelo, y una server
 * action es un fetch: la llamada quedaba `en_curso` o `sonando` para siempre
 * (pasó el 2026-10-05/06). El beacon es lo único que el navegador garantiza
 * entregar después de que la página se fue.
 */
export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = cuerpoSchema.safeParse(cuerpo);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const resultado = await terminarLlamadaAction({ callId: parsed.data.callId });
  return new NextResponse(null, { status: resultado.ok ? 204 : 409 });
}

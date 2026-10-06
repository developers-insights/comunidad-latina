import { NextResponse } from "next/server";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { getAuthUserId } from "@/lib/supabase/server";

export const runtime = "nodejs";

const cuerpoSchema = z.object({
  callId: z.uuid(),
  etapa: z.enum(["token", "sdk", "join", "medios", "publicar", "conectado", "desconectado"]),
  codigo: z.string().max(120).optional(),
  ms: z.number().int().nonnegative().max(600_000).optional(),
});

/**
 * Lo que pasa adentro de Agora ocurre en el navegador y no deja rastro en el
 * servidor. Una llamada que se quedó en "Conectando…" (2026-10-06) no tenía un
 * solo log que dijera en qué paso se trabó. El motor reporta acá la etapa y el
 * código de Agora cuando algo falla o tarda; esto sólo lo escribe en los logs
 * de Vercel (buscar `[llamadas:diagnostico]`). Sin PII: ni nombres ni números.
 */
export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse(null, { status: 401 });
  if (!limit(`llamada-diagnostico:${userId}`, 60, HOUR_MS).ok) {
    return new NextResponse(null, { status: 429 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = cuerpoSchema.safeParse(cuerpo);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  console.warn("[llamadas:diagnostico]", {
    callId: parsed.data.callId,
    usuario: userId.slice(0, 8),
    etapa: parsed.data.etapa,
    codigo: parsed.data.codigo ?? null,
    ms: parsed.data.ms ?? null,
    agente: request.headers.get("user-agent")?.slice(0, 160) ?? null,
  });
  return new NextResponse(null, { status: 204 });
}

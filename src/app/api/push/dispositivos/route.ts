import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardarTokenPush } from "@/lib/push/cookie";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,512}$/),
  platform: z.enum(["ios", "android"]),
});

/**
 * Alta del token de push que entrega la app nativa. Upsert por token con
 * service role a propósito: si en el mismo teléfono entra otra cuenta, el token
 * pasa a la cuenta nueva y la anterior deja de recibir sus avisos.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Token inválido" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("push_devices")
    .upsert(
      {
        profile_id: user.id,
        platform: parsed.data.platform,
        token: parsed.data.token.toLowerCase(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
  if (error) {
    console.error("[push] no se pudo registrar el dispositivo", { code: error.code });
    return NextResponse.json({ error: "No se pudo registrar" }, { status: 500 });
  }
  await guardarTokenPush(parsed.data.token.toLowerCase());
  return NextResponse.json({ ok: true });
}

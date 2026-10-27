import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apnsConfigFromEnv, sendApns } from "@/lib/push/apns";
import { isNotificationCategory } from "@/lib/notifications/categories";
import { prefsFromRows, resolvePref } from "@/lib/notifications/prefs";

export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Lo llama el trigger `notifications_push_despachar` (0180) vía pg_net con el
 * id de la notificación recién insertada. La notificación ya pasó por las
 * preferencias in-app al crearse; acá sólo se agrega que el resumen por correo
 * (`digest`) tampoco quiere push, y se entrega a cada dispositivo de la persona.
 */
export async function POST(request: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "Push no configurado" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const config = apnsConfigFromEnv();
  if (!config) return NextResponse.json({ skipped: "apns" });

  let notificationId: unknown;
  try {
    notificationId = ((await request.json()) as { notification_id?: unknown }).notification_id;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (typeof notificationId !== "string") {
    return NextResponse.json({ error: "Falta notification_id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: notification } = await admin
    .from("notifications")
    .select("id, profile_id, title, body, href, category, group_key")
    .eq("id", notificationId)
    .maybeSingle();
  if (!notification) return NextResponse.json({ skipped: "missing" });

  if (isNotificationCategory(notification.category)) {
    const { data: prefRows } = await admin
      .from("notification_prefs")
      .select("category, in_app, email, push, frequency")
      .eq("profile_id", notification.profile_id)
      .eq("category", notification.category);
    const pref = resolvePref(prefsFromRows(prefRows ?? []), notification.category);
    if (pref.frequency === "digest") return NextResponse.json({ skipped: "digest" });
  }

  const { data: devices } = await admin
    .from("push_devices")
    .select("token")
    .eq("profile_id", notification.profile_id)
    .eq("platform", "ios");
  const tokens = (devices ?? []).map((device) => device.token);
  if (tokens.length === 0) return NextResponse.json({ sent: 0 });

  const results = await sendApns(config, tokens, {
    title: notification.title,
    body: notification.body,
    href: notification.href,
    threadId: notification.group_key ?? notification.category,
  });

  const invalid = [...results].filter(([, result]) => !result.ok && result.tokenInvalid).map(([token]) => token);
  if (invalid.length > 0) await admin.from("push_devices").delete().in("token", invalid);

  const failed = [...results.values()].filter((result) => !result.ok);
  if (failed.length > invalid.length) {
    console.error("[push] APNs rechazó envíos", failed.map((result) => !result.ok && result.reason));
  }
  return NextResponse.json({ sent: results.size - failed.length, removed: invalid.length });
}

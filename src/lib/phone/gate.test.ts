import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/config/services", () => ({
  isPhoneVerificationEnabled: true,
  isPhonePepperConfigured: true,
  isSmsConfigured: true,
  isSentryConfigured: false,
}));

import {
  PHONE_REQUIRED_TOKEN,
  decidePhoneGate,
  isPhoneRequiredError,
  phoneFlowProblem,
} from "./gate";

const BASE = {
  hasSession: true,
  isStaff: false,
  phoneVerified: false,
  tenantRequires: true,
  flowProblem: null,
} as const;

describe("decidePhoneGate", () => {
  it("una cuenta sin verificar, con todo andando, queda pendiente", () => {
    expect(decidePhoneGate(BASE)).toBe("pendiente");
  });

  it("con el teléfono verificado no hay nada que pedir", () => {
    expect(decidePhoneGate({ ...BASE, phoneVerified: true })).toBe("libre");
  });

  it("sin sesión no aplica: leer es libre", () => {
    expect(decidePhoneGate({ ...BASE, hasSession: false })).toBe("libre");
  });

  it("el staff nunca queda bloqueado", () => {
    expect(decidePhoneGate({ ...BASE, isStaff: true })).toBe("libre");
  });

  it("con la comunidad sin exigirlo no hay gate, aunque el flujo esté prendido", () => {
    expect(decidePhoneGate({ ...BASE, tenantRequires: false })).toBe("libre");
  });

  it.each(["apagado", "sin_pepper", "sin_sms"] as const)(
    "exigido pero con el flujo caído (%s) no manda a una pantalla que no anda",
    (flowProblem) => {
      expect(decidePhoneGate({ ...BASE, flowProblem })).toBe("sin_salida");
    },
  );

  it("una cuenta verificada sigue libre aunque el SMS esté caído", () => {
    expect(decidePhoneGate({ ...BASE, phoneVerified: true, flowProblem: "sin_sms" })).toBe("libre");
  });
});

describe("phoneFlowProblem", () => {
  it("con las piezas configuradas no hay problema", () => {
    expect(phoneFlowProblem()).toBeNull();
  });
});

describe("isPhoneRequiredError", () => {
  it("reconoce el error del trigger", () => {
    expect(isPhoneRequiredError({ message: `${PHONE_REQUIRED_TOKEN}: verificá tu teléfono` })).toBe(true);
  });

  it("no confunde otros errores ni revienta con vacío", () => {
    expect(isPhoneRequiredError({ message: "ACCOUNT_SUSPENDED: nope" })).toBe(false);
    expect(isPhoneRequiredError(null)).toBe(false);
  });
});

/**
 * La app y la base hablan por dos cosas escritas a mano en dos idiomas. Si se
 * separan, el gate falla callado. Este test lee la migración.
 */
describe("migración 0181 — contrato con la base", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0181_telefono_obligatorio.sql"),
    "utf8",
  );
  const gated = [...sql.matchAll(/select unnest\(array\[([\s\S]*?)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((t) => t[1]));

  it("nace apagada: aplicarla no le cambia nada a nadie", () => {
    expect(sql).toMatch(/phone_required boolean not null default false/);
    const sinComentarios = sql.replace(/^\s*--.*$/gm, "");
    expect(sinComentarios).not.toMatch(/update public\.tenants/i);
  });

  it("usa el mismo token que reconoce la app", () => {
    expect(sql).toContain(`'${PHONE_REQUIRED_TOKEN}:`);
  });

  it("no toca a staff ni a service_role", () => {
    expect(sql).toMatch(/auth\.uid\(\) is null/);
    expect(sql).toMatch(/app\.is_staff\(\)/);
  });

  it("cubre publicar y chatear", () => {
    for (const tabla of [
      "posts",
      "comments",
      "listings",
      "listing_comments",
      "messages",
      "conversations",
      "chat_groups",
      "chat_group_messages",
      "calls",
    ]) {
      expect(gated).toContain(tabla);
    }
  });

  it("NUNCA bloquea denunciar ni apelar", () => {
    for (const tabla of ["scam_reports", "appeals"]) expect(gated).not.toContain(tabla);
  });

  it("la ficha que nace al comprar Presencia no se corta, y sólo ese insert", () => {
    const marca = sql.indexOf("perform set_config('app.ficha_sistema', 'on', true);");
    const fin = sql.indexOf("perform set_config('app.ficha_sistema', 'off', true);");
    const insert = sql.indexOf("insert into public.listings", marca);

    expect(marca).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(marca);
    expect(fin).toBeGreaterThan(insert);
    expect(sql).toMatch(/current_setting\('app\.ficha_sistema', true\)/);
  });

  it("editar es publicar: cada tabla de contenido tiene su trigger de UPDATE", () => {
    const columnas: Record<string, string[]> = {
      listing_reviews: ["body", "rating", "owner_reply"],
      post_offers: ["titulo", "terminos", "codigo_cupon"],
      chat_groups: ["name", "description", "avatar_url"],
      messages: ["body"],
      chat_group_messages: ["body"],
      listings: [
        "video_path",
        "video_poster_path",
        "cta_phone",
        "cta_whatsapp",
        "cta_website",
        "cta_purchase_url",
        "cta_tickets_url",
        "cta_booking_url",
        "cta_address",
      ],
    };

    for (const [tabla, campos] of Object.entries(columnas)) {
      const trigger = sql.match(
        new RegExp(`create trigger ${tabla}_editar_exigir_telefono[\\s\\S]*?execute function`),
      )?.[0];
      expect(trigger, tabla).toBeDefined();
      for (const campo of campos) {
        expect(trigger, campo).toContain(`old.${campo} is distinct from new.${campo}`);
      }
    }
  });

  it("publicar un borrador se corta, y devolver un aviso por denuncias no", () => {
    const trigger = sql.match(
      /create trigger listings_publicar_exigir_telefono[\s\S]*?execute function/,
    )?.[0];

    expect(trigger).toContain("before update of status");
    expect(trigger).toContain("old.status in ('draft', 'paused')");
    expect(trigger).toContain("new.status in ('pending_review', 'published')");
    expect(trigger).toContain("pg_trigger_depth() = 0");
  });

  it("bajar un mensaje nunca se corta, aunque vacíe el texto", () => {
    expect(sql.match(/old\.body is distinct from new\.body and new\.deleted_at is null/g)).toHaveLength(2);
  });

  it("no toca reacciones, follows ni guardados: los contadores disparan updates", () => {
    for (const tabla of ["reactions", "follows", "saves", "post_poll_votes"]) {
      expect(gated).not.toContain(tabla);
    }
  });
});

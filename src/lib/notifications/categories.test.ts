import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_ON_CATEGORIES,
  CATEGORY_META,
  KIND_CATEGORY,
  MORE_TAB_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  PRIMARY_TAB_CATEGORIES,
  categoryForKind,
  isAlwaysOnCategory,
  isImportant,
  isNotificationCategory,
  isNotificationPriority,
  priorityForKind,
} from "./categories";

/**
 * La app y la base tienen que decir lo MISMO: si estas listas se separan del
 * CHECK de 0045, el insert falla en producción y no en el test. Por eso este
 * archivo lee la migración.
 */
const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0045_notifications_categories.sql", import.meta.url)),
  "utf8",
);

/**
 * El CHECK ya no vive en una sola migración: 0098 lo reescribió para sumar
 * `vencimientos`. El contrato que hay que verificar es el CHECK VIGENTE, así que
 * el test mira las dos — 0045 por las trece originales (que 0098 no puede haber
 * perdido en el camino) y 0098 por la catorceava.
 */
const MIGRATION_0098 = readFileSync(
  fileURLToPath(
    new URL("../../../supabase/migrations/0098_vencimiento_de_publicaciones.sql", import.meta.url),
  ),
  "utf8",
);

describe("las 14 categorías de la app espejan el CHECK de la base", () => {
  it("todas las categorías aparecen en el CHECK vigente (0098)", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(MIGRATION_0098).toContain(`'${category}'`);
    }
  });

  it("las trece originales siguen estando (0098 no perdió ninguna)", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      if (category === "vencimientos") continue;
      expect(MIGRATION).toContain(`'${category}'`);
    }
  });

  it("son 14 y no hay repetidas", () => {
    expect(NOTIFICATION_CATEGORIES).toHaveLength(14);
    expect(new Set(NOTIFICATION_CATEGORIES).size).toBe(14);
  });

  it("las cuatro prioridades también", () => {
    expect(NOTIFICATION_PRIORITIES).toEqual(["low", "normal", "high", "critical"]);
    for (const priority of NOTIFICATION_PRIORITIES) {
      expect(MIGRATION).toContain(`'${priority}'`);
    }
  });

  it("seguridad, pagos y cuenta son las intocables (mismo trío que el CHECK)", () => {
    expect([...ALWAYS_ON_CATEGORIES].sort()).toEqual(["cuenta", "pagos", "seguridad"]);
    expect(MIGRATION).toContain("notification_prefs_critical_always_on");
    for (const category of ALWAYS_ON_CATEGORIES) {
      expect(isAlwaysOnCategory(category)).toBe(true);
    }
    expect(isAlwaysOnCategory("social")).toBe(false);
  });
});

describe("reparto en pestañas", () => {
  it("cada categoría vive en exactamente una pestaña (visible o dentro de Más)", () => {
    const tabbed = [...PRIMARY_TAB_CATEGORIES, ...MORE_TAB_CATEGORIES];
    expect(new Set(tabbed).size).toBe(tabbed.length);
    expect([...tabbed].sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it("`cuenta` NO se queda sin pestaña (la spec la omitía en 'Más')", () => {
    expect(MORE_TAB_CATEGORIES).toContain("cuenta");
  });

  it("cada categoría tiene etiqueta y descripción escritas", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      const meta = CATEGORY_META[category];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("kind → categoría", () => {
  it("respeta letra por letra el backfill de la migración", () => {
    // Estos siete YA existen en la base con esta categoría: si la app los
    // mapeara distinto, el mismo evento caería en dos pestañas según cuándo se
    // emitió.
    expect(categoryForKind("message")).toBe("mensajes");
    expect(categoryForKind("contact_request")).toBe("mensajes");
    expect(categoryForKind("job_application")).toBe("trabajos");
    expect(categoryForKind("job_application_update")).toBe("trabajos");
    expect(categoryForKind("post_promotion")).toBe("publicidad");
    expect(categoryForKind("boost")).toBe("publicidad");
    expect(categoryForKind("identity")).toBe("cuenta");
  });

  it("un kind desconocido cae en social, como el default de la columna", () => {
    expect(categoryForKind("algo_que_nadie_emitio_todavia")).toBe("social");
  });

  it("todo el mapa apunta a categorías válidas", () => {
    for (const [kind, category] of Object.entries(KIND_CATEGORY)) {
      expect(isNotificationCategory(category), `kind ${kind}`).toBe(true);
    }
  });

  it("los kinds del embudo de empleos están mapeados (no caen en social)", () => {
    expect(categoryForKind("job_application_sent")).toBe("trabajos");
    expect(categoryForKind("job_application_withdrawn")).toBe("trabajos");
  });
});

describe("kind → prioridad", () => {
  it("lo que pide una decisión es importante", () => {
    expect(priorityForKind("contact_request")).toBe("high");
    expect(priorityForKind("job_application")).toBe("high");
    expect(priorityForKind("identity")).toBe("high");
  });

  it("lo que afecta el acceso o la plata es crítico", () => {
    expect(priorityForKind("payment_failed")).toBe("critical");
    expect(priorityForKind("account_suspended")).toBe("critical");
    expect(priorityForKind("security_alert")).toBe("critical");
    expect(priorityForKind("dispute")).toBe("critical");
  });

  it("lo demás es normal — inflar prioridades vacía el filtro 'Importantes'", () => {
    expect(priorityForKind("message")).toBe("normal");
    expect(priorityForKind("boost")).toBe("normal");
    expect(priorityForKind("follow")).toBe("normal");
    expect(priorityForKind("kind_inventado")).toBe("normal");
  });

  it("'Importantes' = high + critical", () => {
    expect(isImportant("high")).toBe(true);
    expect(isImportant("critical")).toBe(true);
    expect(isImportant("normal")).toBe(false);
    expect(isImportant("low")).toBe(false);
  });

  it("los guards rechazan valores que no son del contrato", () => {
    expect(isNotificationCategory("mensajes")).toBe(true);
    expect(isNotificationCategory("Mensajes")).toBe(false);
    expect(isNotificationCategory(null)).toBe(false);
    expect(isNotificationPriority("critical")).toBe(true);
    expect(isNotificationPriority("urgente")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPLOYER_STATUSES,
  JOB_APPLICATION_STATUSES,
  canAdvance,
  canApplicantWithdraw,
  employerTransitions,
  isEmployerStatus,
  isOpenStatus,
  isTerminalStatus,
  isVisibleToEmployer,
  statusRank,
  toJobApplicationStatus,
  type JobApplicationStatus,
} from "./application-status";

/**
 * La regla de oro de estos tests: la UI NO puede ofrecer una transición que la
 * base va a rechazar. `app.job_applications_freeze` (0047) levanta
 * PROTECTED_TRANSITION si el rango de destino no es estrictamente mayor que el
 * de origen — así que acá se verifica exactamente esa desigualdad, estado por
 * estado, sin excepciones amables.
 */

const RANK_FROM_MIGRATION: Record<JobApplicationStatus, number> = {
  submitted: 1,
  reviewing: 2,
  interview: 3,
  hired: 4,
  rejected: 4,
  withdrawn: 4,
  closed: 4,
};

describe("vocabulario", () => {
  it("son exactamente los 7 estados del CHECK de 0047", () => {
    expect([...JOB_APPLICATION_STATUSES].sort()).toEqual(
      ["closed", "hired", "interview", "rejected", "reviewing", "submitted", "withdrawn"].sort(),
    );
  });

  it("los rangos espejan v_rank de la migración, uno por uno", () => {
    for (const status of JOB_APPLICATION_STATUSES) {
      expect(statusRank(status)).toBe(RANK_FROM_MIGRATION[status]);
    }
  });

  it("un status desconocido degrada a submitted en vez de pintarse crudo", () => {
    expect(toJobApplicationStatus("accepted")).toBe("submitted"); // vocabulario viejo de 0040
    expect(toJobApplicationStatus(null)).toBe("submitted");
    expect(toJobApplicationStatus("")).toBe("submitted");
    expect(toJobApplicationStatus("hired")).toBe("hired");
  });

  it("el empleador solo escribe los 5 estados que la policy le permite", () => {
    expect([...EMPLOYER_STATUSES]).toEqual([
      "reviewing",
      "interview",
      "hired",
      "rejected",
      "closed",
    ]);
    expect(isEmployerStatus("withdrawn")).toBe(false);
    expect(isEmployerStatus("submitted")).toBe(false);
    expect(isEmployerStatus("hired")).toBe(true);
  });
});

describe("el embudo solo avanza", () => {
  it("acepta exactamente los pares con rango estrictamente mayor", () => {
    for (const from of JOB_APPLICATION_STATUSES) {
      for (const to of JOB_APPLICATION_STATUSES) {
        expect(canAdvance(from, to)).toBe(
          RANK_FROM_MIGRATION[to] > RANK_FROM_MIGRATION[from],
        );
      }
    }
  });

  it("no retrocede: hired/rejected no vuelven a la bandeja", () => {
    expect(canAdvance("hired", "submitted")).toBe(false);
    expect(canAdvance("hired", "reviewing")).toBe(false);
    expect(canAdvance("rejected", "interview")).toBe(false);
    expect(canAdvance("interview", "reviewing")).toBe(false);
  });

  it("no cambia de resultado entre terminales", () => {
    expect(canAdvance("hired", "rejected")).toBe(false);
    expect(canAdvance("rejected", "hired")).toBe(false);
    expect(canAdvance("withdrawn", "hired")).toBe(false);
    expect(canAdvance("closed", "rejected")).toBe(false);
  });

  it("tampoco permite quedarse donde está (marcar dos veces el mismo botón)", () => {
    for (const status of JOB_APPLICATION_STATUSES) {
      expect(canAdvance(status, status)).toBe(false);
    }
  });

  it("sí permite saltar pasos: de recién llegada a entrevista o a contratada", () => {
    expect(canAdvance("submitted", "interview")).toBe(true);
    expect(canAdvance("submitted", "hired")).toBe(true);
    expect(canAdvance("reviewing", "closed")).toBe(true);
  });
});

describe("qué botones puede ofrecer la pantalla del dueño", () => {
  it("desde recién llegada ofrece los cinco", () => {
    expect(employerTransitions("submitted")).toEqual([
      "reviewing",
      "interview",
      "hired",
      "rejected",
      "closed",
    ]);
  });

  it("desde en revisión ya no ofrece volver a en revisión", () => {
    expect(employerTransitions("reviewing")).toEqual([
      "interview",
      "hired",
      "rejected",
      "closed",
    ]);
  });

  it("desde entrevista solo quedan los desenlaces", () => {
    expect(employerTransitions("interview")).toEqual(["hired", "rejected", "closed"]);
  });

  it("sobre una postulación resuelta no ofrece NADA", () => {
    expect(employerTransitions("hired")).toEqual([]);
    expect(employerTransitions("rejected")).toEqual([]);
    expect(employerTransitions("closed")).toEqual([]);
    expect(employerTransitions("withdrawn")).toEqual([]);
  });

  it("todo lo que ofrece lo acepta canAdvance (no hay botón que la base rechace)", () => {
    for (const from of JOB_APPLICATION_STATUSES) {
      for (const next of employerTransitions(from)) {
        expect(canAdvance(from, next)).toBe(true);
      }
    }
  });
});

describe("retirarse es del postulante y solo desde un estado vivo", () => {
  it("se puede mientras la postulación sigue abierta", () => {
    expect(canApplicantWithdraw("submitted")).toBe(true);
    expect(canApplicantWithdraw("reviewing")).toBe(true);
    expect(canApplicantWithdraw("interview")).toBe(true);
  });

  it("no se puede sobre una postulación ya resuelta", () => {
    expect(canApplicantWithdraw("hired")).toBe(false);
    expect(canApplicantWithdraw("rejected")).toBe(false);
    expect(canApplicantWithdraw("closed")).toBe(false);
    expect(canApplicantWithdraw("withdrawn")).toBe(false);
  });
});

describe("visibilidad y estado abierto", () => {
  it("una postulación retirada deja de verse en la bandeja del dueño", () => {
    expect(isVisibleToEmployer("withdrawn")).toBe(false);
    for (const status of JOB_APPLICATION_STATUSES.filter((s) => s !== "withdrawn")) {
      expect(isVisibleToEmployer(status)).toBe(true);
    }
  });

  it("abierto es lo contrario de terminal, sin zona gris", () => {
    for (const status of JOB_APPLICATION_STATUSES) {
      expect(isOpenStatus(status)).toBe(!isTerminalStatus(status));
    }
    expect(isTerminalStatus("submitted")).toBe(false);
    expect(isTerminalStatus("interview")).toBe(false);
    expect(isTerminalStatus("closed")).toBe(true);
  });
});

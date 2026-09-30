import { z } from "zod";
import { COPY } from "@/components/empleos/copy";
import { JOB_PAY_PERIODS } from "@/components/empleos/helpers";
import { WORK_MODES, requiresArea } from "@/lib/creators/work-mode";
import { MAX_SALARY, MAX_SCHEDULE_LENGTH } from "@/lib/empleos/detalles";

/**
 * Un solo esquema para crear y para editar un servicio: si editar aceptara algo
 * que el alta rechaza (o al revés), el aviso dejaría de poder guardarse justo
 * después de publicarse.
 *
 * Un servicio no exige monto: el jardinero cotiza mirando el patio. `priceAmount`
 * ausente significa "a convenir". Tampoco hay jornada, preguntas ni fotos.
 */
export const serviceDraftSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(30).max(4000),
    priceAmount: z.number().positive().max(MAX_SALARY).nullish(),
    payPeriod: z.enum(JOB_PAY_PERIODS),
    workMode: z.enum(WORK_MODES).nullish(),
    areaLabel: z.string().trim().max(80).nullish(),
    days: z.array(z.string()).max(7).nullish(),
    schedule: z.string().trim().max(MAX_SCHEDULE_LENGTH).nullish(),
  })
  .superRefine((value, ctx) => {
    if (requiresArea(value.workMode ?? null) && (value.areaLabel ?? "").trim().length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["areaLabel"],
        message: COPY.servicePublish.errors.areaShort,
      });
    }
  });

export type ServiceDraftInput = z.input<typeof serviceDraftSchema>;

export const SERVICE_USER_FACING_ISSUES = new Set<string>([COPY.servicePublish.errors.areaShort]);

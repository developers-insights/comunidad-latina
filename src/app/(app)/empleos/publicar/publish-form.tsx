"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarCheck,
  CaretDown,
  CheckCircle,
  Clock,
  ImageSquare,
  ListChecks,
  MapPin,
  Money,
  Plus,
  Question,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Select,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { Celebration, Reveal, useCelebration } from "@/components/motion";
import { formatListingPrice } from "@/components/listings/helpers";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  JOB_PAY_PERIODS,
  JOB_QUESTION_MAX_OPTIONS,
  JOB_QUESTION_MIN_OPTIONS,
  MAX_JOB_QUESTIONS,
  type EmploymentType,
  type JobPayPeriod,
  type JobQuestion,
} from "@/components/empleos/helpers";
import { COPY } from "@/components/empleos/copy";
import {
  WORK_MODES,
  WORK_MODE_HELP,
  WORK_MODE_LABEL,
  requiresArea,
  type WorkMode,
} from "@/lib/creators/work-mode";
import {
  JOB_EXPERIENCE_LEVELS,
  JOB_LANGUAGES,
  MAX_SALARY,
  MAX_SCHEDULE_LENGTH,
  WORK_DAYS,
  type JobExperience,
  type JobLanguage,
  type WorkDay,
} from "@/lib/empleos/detalles";
import { createJobDraft, finalizeJob } from "./actions";
import type { WizardHandleRef } from "./wizard-handle";

/**
 * Wizard de /empleos/publicar — 4 pasos, mobile-first.
 *
 *   1. El puesto (título + detalles)
 *   2. Pago y condiciones (rango OBLIGATORIO en su piso + período + jornada +
 *      modalidad, y la ficha del puesto PLEGADA)
 *   3. Preguntas al postulante  ← la pieza propia de este módulo
 *   4. Zona, negocio vinculado y fotos (opcionales) → publicar
 *
 * Flujo de guardado idéntico al de Creadores/Marketplace (lo dictan la RLS de
 * listings y la policy de storage): createJobDraft → subir fotos al bucket
 * listing-photos con el path {tenant}/{listing}/… → finalizeJob.
 *
 * ── CÓMO SE REPARTIERON LOS CAMPOS NUEVOS ───────────────────────────────────
 * La spec sumó nueve datos. Ponerlos todos a la vista habría convertido un
 * wizard de cuatro pantallas cortas en un formulario que nadie termina en un
 * teléfono, así que la regla fue: OBLIGATORIO A LA VISTA, OPCIONAL A UN TOQUE.
 *
 *   · A la vista (paso 2): el techo del rango salarial, al lado del piso, y la
 *     modalidad. La modalidad no es opcional porque DECIDE otra pregunta —con
 *     "a distancia" el paso 4 deja de pedir zona.
 *   · Plegados (paso 2, <details>): días, horario, experiencia, idiomas, fecha
 *     de inicio y fecha límite. Seis campos que hoy se preguntan por chat.
 *   · A la vista (paso 4): el negocio vinculado, y SÓLO si la persona tiene
 *     fichas propias publicadas.
 *
 * Ningún campo nuevo es obligatorio. Lo único que se exigía antes —puesto,
 * descripción, salario— se sigue exigiendo igual, y lo único que se relajó es
 * la zona: dejó de pedirse cuando el trabajo es a distancia.
 */

const C = COPY.publish;
const Q = C.steps.questions;
const TOTAL_STEPS = 4;
const MAX_PHOTOS = 4;

/**
 * Tope del archivo CRUDO. Generoso A PROPÓSITO (mismo criterio que
 * components/creators/helpers.ts): las fotos de celular hoy pesan 8–20 MB y un
 * tope chico acá se veía como "elijo foto y no se marca ninguna". Lo que se
 * SUBE es la versión recomprimida (webp ≤1600px), y esa sí tiene tope duro.
 */
const RAW_PHOTO_MAX_BYTES = 40 * 1024 * 1024;
/** Tope real de lo que viaja a Storage, ya recomprimido. */
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Acento del módulo (globals.css:624), igual que el resto de Empleos.
 */
const ACCENT = "var(--accent-empleos)";
const ACCENT_TINT = `color-mix(in oklab, ${ACCENT} 12%, transparent)`;
const ACCENT_EDGE = `color-mix(in oklab, ${ACCENT} 42%, transparent)`;

/** Botón/tarjeta táctil del builder: 44px mínimo + resorte al presionar (§3.2, §5.1). */
const TAP_CARD = cn(
  "flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold",
  "transition-[border-color,background-color,transform,color] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

const ICON_BUTTON = cn(
  "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-muted",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-danger",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

// ---------------------------------------------------------------------------
// Modelo local del builder
// ---------------------------------------------------------------------------

type QuestionType = JobQuestion["type"];

interface DraftQuestion {
  id: string;
  type: QuestionType;
  label: string;
  /** Solo se usa (y se persiste) en multiple_choice; en yes_no queda vacío. */
  options: string[];
}

/**
 * id corto y estable: viaja dentro de `attrs.questions` y las respuestas del
 * postulante lo referencian. `randomUUID` no existe en todo runtime (webviews
 * viejas, entorno de test), así que degradamos sin romper el builder.
 */
function newQuestionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

function emptyQuestion(type: QuestionType, label = ""): DraftQuestion {
  return {
    id: newQuestionId(),
    type,
    label,
    // La opción múltiple nace con el mínimo válido para que no haya que
    // "descubrir" el botón de agregar: ya se ven los dos casilleros a llenar.
    options: type === "multiple_choice" ? Array(JOB_QUESTION_MIN_OPTIONS).fill("") : [],
  };
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

interface PhotoItem {
  file: File;
  previewUrl: string;
}

interface PhotoSelection {
  accepted: File[];
  tooMany: boolean;
  tooBig: boolean;
}

/**
 * Qué archivos entran (cantidad + peso crudo). PURO y llamado de forma
 * SÍNCRONA con `Array.from(input.files)`: el input se limpia (`value = ""`)
 * apenas termina el handler y su FileList es VIVO — leerlo dentro del updater
 * diferido de un setState (React 19 / Next 16) devolvería 0 archivos y la foto
 * "no se marcaba". Mismo criterio que `selectPhotos()` de
 * components/creators/helpers.ts; cada módulo duplica su helper chico.
 */
function selectJobPhotos(files: File[], currentCount: number): PhotoSelection {
  const accepted: File[] = [];
  let tooMany = false;
  let tooBig = false;
  for (const file of files) {
    if (currentCount + accepted.length >= MAX_PHOTOS) {
      tooMany = true;
      break;
    }
    if (file.size > RAW_PHOTO_MAX_BYTES) {
      tooBig = true;
      continue;
    }
    accepted.push(file);
  }
  return { accepted, tooMany, tooBig };
}

/**
 * Redimensiona a ≤1600px y convierte a webp; si algo falla, sube el original.
 * Duplicado intencional del helper equivalente de otras rutas de publicación
 * (ownership estricto: cada ruta es autocontenida, ver AGENTS.md del módulo).
 */
async function preparePhoto(file: File): Promise<{ blob: Blob; ext: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (blob) return { blob, ext: "webp" };
  } catch {
    // Caemos al original.
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  return { blob: file, ext: ["webp", "jpg", "jpeg", "png"].includes(ext) ? ext : "jpg" };
}

// ---------------------------------------------------------------------------
// Controles del wizard
//
// Duplicados a propósito respecto de los del wizard genérico (/publicar): cada
// ruta de publicación de este repo es autocontenida —mismo criterio que
// `preparePhoto`— y además éstos NO son iguales: usan el acento del módulo
// Empleos (--accent-empleos) para el estado seleccionado, igual que las
// tarjetas de dedicación que ya estaban. Unificarlos obligaría a parametrizar
// el color y a que un cambio en Empleos pudiera repintar Vivienda.
// ---------------------------------------------------------------------------

/**
 * Bloque plegable de campos opcionales.
 *
 * `<details>` NATIVO: el navegador ya le da el toggle con teclado, el estado
 * expandido al lector de pantalla y —lo que más importa— la posibilidad de que
 * el buscador del navegador lo abra para encontrar texto adentro.
 *
 * La regla del wizard es: obligatorio a la vista, opcional a un toque. Seis
 * campos más desplegados convertirían el paso del salario en una planilla que
 * nadie termina en un teléfono; plegados ocupan una fila.
 */
function OptionalSection({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-md border border-border-subtle bg-surface-subtle">
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3",
          "rounded-md transition-colors duration-(--duration-fast)",
          "hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-[18px]" style={{ color: ACCENT }}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-foreground-muted">{hint}</span>
        </span>
        <CaretDown
          size={16}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-foreground-muted",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-open:rotate-180",
          )}
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border-subtle px-4 pb-4 pt-4">
        {children}
      </div>
    </details>
  );
}

/**
 * Chips de selección múltiple con el acento del módulo.
 *
 * EXPORTADO (y no privado) porque el wizard del SERVICIO usa exactamente los
 * mismos chips de días: dos copias del mismo control se desincronizan a la
 * primera corrección de accesibilidad. Vive acá y no en un archivo aparte para
 * no mover código que este agente no necesita mover.
 *
 * `min-h-11` en cada chip: 44px es el mínimo táctil y no se negocia por
 * estética, ni siquiera en un control opcional que vive plegado. Los días usan
 * además `w-11` para quedar cuadrados — siete cuadraditos "L M X J V S D" en una
 * fila se leen como un calendario y se marcan sin apuntar.
 */
export function ToggleChips<T extends string>({
  legend,
  help,
  options,
  selected,
  onToggle,
  square = false,
}: {
  legend: string;
  help?: string;
  options: readonly { value: T; label: string; ariaLabel?: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  square?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              aria-label={option.ariaLabel}
              onClick={() => onToggle(option.value)}
              style={
                active ? { borderColor: ACCENT_EDGE, backgroundColor: ACCENT_TINT } : undefined
              }
              className={cn(
                "min-h-11 rounded-full border text-sm font-semibold",
                square ? "w-11 px-0 text-center" : "px-3.5",
                "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                active
                  ? "text-foreground"
                  : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {help && <p className="text-sm text-foreground-muted">{help}</p>}
    </fieldset>
  );
}

/** Alterna un valor dentro de una lista, sin mutar. */
export function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// ---------------------------------------------------------------------------
// Cabecera de paso (cintillo + título)
// ---------------------------------------------------------------------------

function StepHeader({
  step,
  title,
  intro,
  icon,
}: {
  step: number;
  title: string;
  intro?: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <span
        className="inline-flex w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-secondary"
        style={{ backgroundColor: ACCENT_TINT }}
      >
        <span aria-hidden="true" className="[&>svg]:size-3.5" style={{ color: ACCENT }}>
          {icon}
        </span>
        {C.stepEyebrow(step, TOTAL_STEPS)}
      </span>
      <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
      {intro && <p className="text-sm text-foreground-secondary">{intro}</p>}
    </header>
  );
}

// ===========================================================================

/** Ficha de negocio propia y publicada, para el vínculo del paso 4. */
export interface BusinessOption {
  id: string;
  title: string;
}

export function JobPublishForm({
  tenantId,
  currency,
  businesses = [],
  wizardRef,
}: {
  tenantId: string;
  /** Moneda del tenant — solo para la vista previa del salario. */
  currency: string;
  /**
   * Fichas de negocio del usuario (ya filtradas por el server: propias,
   * publicadas, de este tenant). Si viene vacío el campo NO se dibuja: un
   * desplegable con una sola opción que dice "a nombre personal" es una
   * pregunta sin respuestas posibles.
   */
  businesses?: readonly BusinessOption[];
  /** Ver `wizard-handle.ts`: por acá el wizard le presta su "un paso atrás". */
  wizardRef?: WizardHandleRef;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"published" | "pending_review" | null>(null);
  // El borrador se crea una sola vez: un reintento no duplica avisos.
  const [draftId, setDraftId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [salary, setSalary] = useState("");
  /** Techo del rango. Vacío = monto único, que sigue siendo el caso más común. */
  const [salaryMax, setSalaryMax] = useState("");
  const [payPeriod, setPayPeriod] = useState<JobPayPeriod>("hour");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  /**
   * Modalidad. Arranca en "presencial" y no vacío: es el caso de la enorme
   * mayoría de los empleos de esta comunidad (niñera, mesera, construcción), y
   * dejar el campo sin elegir sólo agregaría un toque obligatorio al 95% para
   * no dar por sentado el 5%. Quien trabaja a distancia lo cambia de un toque, y
   * al hacerlo desaparece el pedido de zona.
   */
  const [workMode, setWorkMode] = useState<WorkMode>("presencial");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  const [areaLabel, setAreaLabel] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  // Ficha del puesto — todo opcional, todo plegado en el paso 2.
  const [days, setDays] = useState<WorkDay[]>([]);
  const [schedule, setSchedule] = useState("");
  const [experience, setExperience] = useState<JobExperience | "">("");
  const [languages, setLanguages] = useState<JobLanguage[]>([]);
  const [startsOn, setStartsOn] = useState("");
  const [applyBy, setApplyBy] = useState("");
  /** "" = a nombre personal. Cualquier otro valor es el id de una ficha propia. */
  const [businessListingId, setBusinessListingId] = useState("");

  // Al agregar una pregunta, el cursor cae donde hay que escribir: sin esto el
  // botón "agregar" deja una tarjeta vacía y el pulgar tiene que ir a buscarla.
  // El pendiente vive en un REF (no en estado): el foco es un efecto sobre el
  // DOM, y guardarlo en estado obligaría a un setState dentro del efecto —
  // render en cascada que la regla del compilador de React prohíbe.
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    document.getElementById(`job-q-${id}`)?.focus();
  });

  // ---------------------------------------------------------------- builder
  function addQuestion(type: QuestionType, label = "") {
    if (questions.length >= MAX_JOB_QUESTIONS) return;
    const question = emptyQuestion(type, label);
    setQuestions((current) => [...current, question]);
    setError(null);
    pendingFocusRef.current = question.id;
  }

  function updateQuestion(id: string, patch: Partial<DraftQuestion>) {
    setQuestions((current) =>
      current.map((question) => (question.id === id ? { ...question, ...patch } : question)),
    );
    // Editar limpia el error de ESA pregunta: el aviso rojo no sobrevive al arreglo.
    setQuestionErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function changeQuestionType(id: string, type: QuestionType) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              type,
              // Cambiar de tipo conserva el texto y reinicia las opciones: una
              // pregunta de sí/no NO puede llevar opciones (jobQuestionSchema).
              options:
                type === "multiple_choice"
                  ? Array(JOB_QUESTION_MIN_OPTIONS).fill("")
                  : [],
            }
          : question,
      ),
    );
    setQuestionErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function removeQuestion(id: string) {
    setQuestions((current) => current.filter((question) => question.id !== id));
    setQuestionErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function updateOption(id: string, index: number, value: string) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              options: question.options.map((option, i) => (i === index ? value : option)),
            }
          : question,
      ),
    );
    setQuestionErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function addOption(id: string) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id && question.options.length < JOB_QUESTION_MAX_OPTIONS
          ? { ...question, options: [...question.options, ""] }
          : question,
      ),
    );
  }

  function removeOption(id: string, index: number) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id && question.options.length > JOB_QUESTION_MIN_OPTIONS
          ? { ...question, options: question.options.filter((_, i) => i !== index) }
          : question,
      ),
    );
  }

  /** Errores por pregunta ANTES de dejar avanzar (espejo de jobQuestionSchema). */
  function collectQuestionErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const question of questions) {
      if (question.label.trim().length < 3) {
        errors[question.id] = C.errors.questionLabelShort;
        continue;
      }
      if (question.type !== "multiple_choice") continue;
      const filled = question.options.filter((option) => option.trim().length > 0);
      if (filled.length < JOB_QUESTION_MIN_OPTIONS) {
        errors[question.id] = C.errors.questionOptionsShort;
      } else if (filled.length !== question.options.length) {
        errors[question.id] = C.errors.questionOptionEmpty;
      }
    }
    return errors;
  }

  // ------------------------------------------------------------- navegación
  const salaryAmount = Number(salary);
  const salaryValid = Number.isFinite(salaryAmount) && salaryAmount > 0;
  const salaryMaxAmount = salaryMax === "" ? null : Number(salaryMax);
  const salaryMaxValid =
    salaryMaxAmount !== null && Number.isFinite(salaryMaxAmount) && salaryMaxAmount > 0;
  /**
   * Vista previa del RANGO. Se arma con el mismo formateador que la tarjeta del
   * listado —`formatListingPrice`— llamado dos veces y unido con un guion, en
   * vez de concatenar números a mano: así el símbolo, los decimales y el sufijo
   * ("/hora") son exactamente los del aviso publicado. Al techo se le saca el
   * sufijo porque decir "$18/hora – $22/hora" repite lo mismo dos veces.
   */
  const salaryPreview = formatListingPrice(salaryValid ? salaryAmount : null, currency, payPeriod);
  const salaryMaxPreview =
    salaryValid && salaryMaxValid && salaryMaxAmount > salaryAmount
      ? formatListingPrice(salaryMaxAmount, currency, "one_time")
      : null;

  /** Con modalidad "a distancia" no hay zona que declarar (0087, `requiresArea`). */
  const needsArea = requiresArea(workMode);

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (title.trim().length < 8) return C.errors.titleShort;
      if (description.trim().length < 30) return C.errors.descriptionShort;
    }
    if (current === 1) {
      if (!salaryValid) return C.errors.salaryRequired;
      // Techo menor que piso: contradicción, no dato incompleto.
      if (salaryMaxValid && salaryMaxAmount < salaryAmount) return C.errors.salaryRangeInvalid;
      if (startsOn && applyBy && applyBy > startsOn) return C.errors.applyByAfterStart;
    }
    if (current === 2) {
      const errors = collectQuestionErrors();
      setQuestionErrors(errors);
      if (Object.keys(errors).length > 0) return C.errors.questionsInvalid;
    }
    if (current === 3 && needsArea && areaLabel.trim().length < 3) return C.errors.areaShort;
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) return setError(problem);
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function goBack() {
    setError(null);
    setStep((value) => Math.max(0, value - 1));
  }

  /**
   * El puente con el "Volver" de la barra de arriba: le presta el MISMO
   * `goBack` que usa el "Atrás" del pie, así el control que la app enseñó en
   * todas las demás pantallas retrocede un paso en vez de tirar los cuatro
   * pasos escritos. Es el defecto que filmó Nacho el 2026-09-03.
   *
   * Sin `deps` a propósito: las dos funciones leen el paso y los campos de este
   * render, y una lista de dependencias acá sería una copia del formulario
   * entero que se va a desactualizar el día que alguien agregue un campo.
   */
  useEffect(() => {
    if (!wizardRef) return;
    wizardRef.current = {
      retroceder: () => {
        if (done || step === 0) return false;
        goBack();
        return true;
      },
      hayDatos: () =>
        Boolean(
          !done &&
            (title.trim() ||
              description.trim() ||
              salary.trim() ||
              photos.length > 0 ||
              questions.length > 0),
        ),
    };
    return () => {
      wizardRef.current = null;
    };
  });

  // ------------------------------------------------------------------ fotos
  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    // Materialización SÍNCRONA — ver selectJobPhotos().
    const { accepted, tooMany, tooBig } = selectJobPhotos(Array.from(fileList), photos.length);
    if (accepted.length) {
      const items = accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
      setPhotos((current) => [...current, ...items]);
    }
    if (tooMany) toast({ variant: "warning", title: C.steps.where.tooManyPhotos });
    if (tooBig) toast({ variant: "warning", title: C.steps.where.tooBigPhoto });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  // ------------------------------------------------------------------ envío
  function buildQuestionsPayload(): JobQuestion[] {
    return questions.map((question) =>
      question.type === "multiple_choice"
        ? {
            id: question.id,
            type: question.type,
            label: question.label.trim(),
            options: question.options.map((option) => option.trim()),
          }
        : { id: question.id, type: question.type, label: question.label.trim() },
    );
  }

  async function handleSubmit() {
    // Revalidamos TODO: se puede volver atrás y vaciar un campo ya aprobado.
    for (let current = 0; current < TOTAL_STEPS; current += 1) {
      const problem = validateStep(current);
      if (problem) {
        setStep(current);
        setError(problem);
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      let listingId = draftId;
      if (!listingId) {
        const result = await createJobDraft({
          title: title.trim(),
          description: description.trim(),
          salaryAmount,
          salaryMax: salaryMaxValid ? salaryMaxAmount : null,
          payPeriod,
          employmentType,
          workMode,
          // A distancia no se manda zona: el servidor la guarda como NULL y el
          // aviso se describe por su modalidad, que es un dato real.
          areaLabel: needsArea ? areaLabel.trim() : null,
          questions: buildQuestionsPayload(),
          // Una changa no tiene días recurrentes (por diseño: si se repite
          // cada semana, el tipo correcto es "Medio tiempo", no "Ocasional").
          // El campo puede traer datos viejos de haber tocado el tipo antes de
          // elegir el definitivo, así que se descartan acá y no sólo se ocultan.
          days: employmentType === "one_off" ? [] : days,
          schedule: schedule.trim() || null,
          experience: experience || null,
          languages,
          startsOn: startsOn || null,
          applyBy: applyBy || null,
          businessListingId: businessListingId || null,
        });
        if (!result.ok) {
          if (result.needsAuth) {
            router.push("/entrar?next=/empleos/publicar");
            return;
          }
          setError(result.error);
          return;
        }
        listingId = result.listingId;
        setDraftId(result.listingId);
      }

      const supabase = createClient();

      // getUser() revalida y refresca el token del browser client ANTES de
      // subir (con el token vencido la subida se rechazaba en silencio), y el
      // tenant sale del JWT —lo que la RLS realmente compara— no del prop.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        router.push("/entrar?next=/empleos/publicar");
        return;
      }
      const tid = String(user.app_metadata?.tenant_id ?? tenantId);

      const photoPaths: string[] = [];
      for (const item of photos) {
        const { blob, ext } = await preparePhoto(item.file);
        // Tope duro de lo que se sube: la recompresión deja las fotos muy por
        // debajo, así que acá solo cae un caso patológico (imagen enorme que
        // el canvas no pudo procesar y se subiría cruda).
        if (blob.size > UPLOAD_MAX_BYTES) {
          setError(C.steps.where.tooBigPhoto);
          return;
        }
        const path = `${tid}/${listingId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, blob, {
            contentType: blob.type || item.file.type || "image/webp",
            upsert: false,
          });
        if (uploadError) {
          // Sin este log el fallo real (RLS, token vencido, límite del bucket)
          // queda invisible: solo se vería el copy genérico.
          console.warn("[empleos] subida de foto falló", { message: uploadError.message });
          setError(C.errors.uploadFailed);
          return;
        }
        photoPaths.push(path);
      }

      const finalized = await finalizeJob({ listingId, photoPaths });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setDone(finalized.status);
      if (finalized.status === "published") celebrate();
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    photos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setTitle("");
    setDescription("");
    setSalary("");
    setSalaryMax("");
    setPayPeriod("hour");
    setEmploymentType("full_time");
    setWorkMode("presencial");
    setQuestions([]);
    setQuestionErrors({});
    setAreaLabel("");
    setPhotos([]);
    setDays([]);
    setSchedule("");
    setExperience("");
    setLanguages([]);
    setStartsOn("");
    setApplyBy("");
    setBusinessListingId("");
    setDraftId(null);
    setDone(null);
    setError(null);
    setStep(0);
  }

  // -------------------------------------------------------------------------
  // Confirmación
  // -------------------------------------------------------------------------
  if (done) {
    const published = done === "published";
    return (
      <>
        {published && <Celebration active={celebrating} message={C.successPublishedTitle} />}
        <BezelCard
          variant={published ? "success" : "default"}
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
        >
          <CheckCircle
            size={56}
            weight="fill"
            aria-hidden="true"
            className={published ? "text-success" : "text-brand"}
          />
          <h2 className="font-display text-xl font-bold text-foreground">
            {published ? C.successPublishedTitle : C.successReviewTitle}
          </h2>
          <p className="max-w-[40ch] text-sm text-foreground-secondary">
            {published ? C.successPublishedBody : C.successReviewBody}
          </p>
          <div className="mt-3 flex w-full flex-col gap-2">
            <Link
              href="/empleos"
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
            >
              {C.goToJobs}
            </Link>
            <Button variant="ghost" className="w-full" onClick={resetForm}>
              {C.publishAnother}
            </Button>
          </div>
        </BezelCard>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <ProgressDots total={TOTAL_STEPS} current={step + 1} />

      {/* key={step}: cada paso entra con su propio fade + subida corta. */}
      <Reveal key={step} y={12} className="flex flex-col gap-5">
        {step === 0 && (
          <>
            <StepHeader
              step={1}
              title={C.steps.role.title}
              intro={C.steps.role.intro}
              icon={<Briefcase weight="fill" />}
            />
            <Field
              htmlFor="job-title"
              label={C.steps.role.titleLabel}
              help={C.steps.role.titleHelp}
            >
              <Input
                id="job-title"
                value={title}
                maxLength={120}
                placeholder={C.steps.role.titlePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field
              htmlFor="job-description"
              label={C.steps.role.descriptionLabel}
              help={C.steps.role.descriptionHelp}
            >
              <Textarea
                id="job-description"
                rows={6}
                value={description}
                maxLength={4000}
                placeholder={C.steps.role.descriptionPlaceholder}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <StepHeader
              step={2}
              title={C.steps.pay.title}
              intro={C.steps.pay.intro}
              icon={<Money weight="fill" />}
            />

            {/* RANGO. "Desde" y "Hasta" en la misma fila para que se lea de
                corrido como lo que es; el período abajo, ocupando el ancho, para
                que no queden tres controles apretados en una fila de teléfono. */}
            <div className="grid grid-cols-2 gap-3">
              <Field
                htmlFor="job-salary"
                label={C.steps.pay.amountLabel}
                help={C.steps.pay.amountHelp}
              >
                <Input
                  id="job-salary"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={MAX_SALARY}
                  value={salary}
                  placeholder={C.steps.pay.amountPlaceholder}
                  onChange={(event) => setSalary(event.target.value)}
                  className="numeric"
                />
              </Field>
              <Field
                htmlFor="job-salary-max"
                label={C.steps.pay.amountMaxLabel}
                help={C.steps.pay.amountMaxHelp}
                optional
              >
                <Input
                  id="job-salary-max"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={MAX_SALARY}
                  value={salaryMax}
                  placeholder={C.steps.pay.amountMaxPlaceholder}
                  onChange={(event) => setSalaryMax(event.target.value)}
                  className="numeric"
                />
              </Field>
            </div>

            <Field
              htmlFor="job-period"
              label={C.steps.pay.periodLabel}
              help={C.steps.pay.periodHelp}
            >
              <Select
                id="job-period"
                value={payPeriod}
                onChange={(event) => setPayPeriod(event.target.value as JobPayPeriod)}
              >
                {JOB_PAY_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {C.payPeriodLabel[period]}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Vista previa con el MISMO formateador que la card del listado. */}
            {salaryPreview && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3"
                style={{ backgroundColor: ACCENT_TINT }}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-secondary">
                  {C.steps.pay.previewLabel}
                </span>
                <span className="numeric font-display text-lg font-bold text-foreground">
                  {salaryMaxPreview ? `${salaryPreview} – ${salaryMaxPreview}` : salaryPreview}
                </span>
              </div>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-foreground">
                {C.steps.pay.typeLegend}
              </legend>
              {/* grid-cols-3 + ícono arriba: mismo patrón que MODALIDAD, un poco
                  más abajo en este paso. "Tiempo completo" ya no entraba cómodo
                  en una fila horizontal de tres columnas — apilar ícono y texto
                  es lo que lo resuelve para las tres, no sólo para la nueva. */}
              <div role="radiogroup" aria-label={C.steps.pay.typeLegend} className="grid grid-cols-3 gap-2">
                {EMPLOYMENT_TYPES.map((type) => {
                  const selected = employmentType === type;
                  // "Ocasional" no es una jornada con reloj: un calendario con
                  // check comunica mejor "un día puntual" que las manecillas.
                  const TypeIcon = type === "one_off" ? CalendarCheck : Clock;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setEmploymentType(type)}
                      className={cn(
                        TAP_CARD,
                        "h-full flex-col items-center gap-1 px-2 py-3 text-center",
                        selected
                          ? "text-foreground"
                          : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                      )}
                      style={
                        selected
                          ? { borderColor: ACCENT_EDGE, backgroundColor: ACCENT_TINT }
                          : undefined
                      }
                    >
                      <TypeIcon
                        size={18}
                        weight={selected ? "fill" : "regular"}
                        aria-hidden="true"
                        style={selected ? { color: ACCENT } : undefined}
                      />
                      <span className="text-sm font-semibold leading-snug">
                        {EMPLOYMENT_TYPE_LABEL[type]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-foreground-muted">{C.steps.pay.typeHelp}</p>
            </fieldset>

            {/* MODALIDAD → columna listings.work_mode (0087), que ya existía con
                su CHECK y su índice y hasta hoy sólo usaba Creadores. Se reusa en
                vez de inventar un attrs.work_mode paralelo: el mismo hecho en dos
                lugares se termina contradiciendo. Elegir "a distancia" hace que
                el paso 4 deje de pedir zona (requiresArea). */}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-foreground">
                {C.steps.pay.modeLegend}
              </legend>
              <div
                role="radiogroup"
                aria-label={C.steps.pay.modeLegend}
                className="grid grid-cols-3 gap-2"
              >
                {WORK_MODES.map((mode) => {
                  const selected = workMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setWorkMode(mode)}
                      className={cn(
                        TAP_CARD,
                        "h-full flex-col items-center gap-0.5 px-2 py-3 text-center",
                        selected
                          ? "text-foreground"
                          : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                      )}
                      style={
                        selected
                          ? { borderColor: ACCENT_EDGE, backgroundColor: ACCENT_TINT }
                          : undefined
                      }
                    >
                      <span className="text-sm font-semibold">{WORK_MODE_LABEL[mode]}</span>
                      <span className="text-[11px] font-medium leading-snug text-foreground-muted">
                        {WORK_MODE_HELP[mode]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-foreground-muted">{C.steps.pay.modeHelp}</p>
            </fieldset>

            {/* LA FICHA DEL PUESTO, PLEGADA. Son seis datos que hoy se preguntan
                por chat: útiles, no obligatorios. Desplegados convertirían este
                paso en una planilla; acá ocupan una fila y se abren si sirven. */}
            <OptionalSection
              title={C.steps.pay.moreTitle}
              hint={C.steps.pay.moreHint}
              icon={<Clock weight="fill" />}
            >
              {/* Días de semana RECURRENTES no aplican a una changa: si el
                  trabajo se repite cada sábado, es "Medio tiempo", no
                  "Ocasional" — esa distinción vive en qué tipo se eligió
                  arriba, no en un campo aparte que habría que repetir. */}
              {employmentType !== "one_off" && (
                <ToggleChips
                  legend={C.steps.pay.daysLabel}
                  help={C.steps.pay.daysHelp}
                  square
                  // La etiqueta visible es una letra; el nombre accesible es el día
                  // completo, porque "X" no se puede escuchar y entender.
                  options={WORK_DAYS.map((day) => ({
                    value: day.value,
                    label: day.short,
                    ariaLabel: day.label,
                  }))}
                  selected={days}
                  onToggle={(value) => setDays((current) => toggleInList(current, value))}
                />
              )}

              <Field htmlFor="job-schedule" label={C.steps.pay.scheduleLabel} optional>
                <Input
                  id="job-schedule"
                  value={schedule}
                  maxLength={MAX_SCHEDULE_LENGTH}
                  placeholder={C.steps.pay.schedulePlaceholder}
                  onChange={(event) => setSchedule(event.target.value)}
                />
              </Field>

              <Field htmlFor="job-experience" label={C.steps.pay.experienceLabel} optional>
                <Select
                  id="job-experience"
                  value={experience}
                  onChange={(event) => setExperience(event.target.value as JobExperience | "")}
                >
                  <option value="">{C.steps.pay.experiencePlaceholder}</option>
                  {JOB_EXPERIENCE_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <ToggleChips
                legend={C.steps.pay.languagesLabel}
                help={C.steps.pay.languagesHelp}
                options={JOB_LANGUAGES}
                selected={languages}
                onToggle={(value) => setLanguages((current) => toggleInList(current, value))}
              />

              <div className="grid grid-cols-2 gap-3">
                <Field
                  htmlFor="job-starts-on"
                  // Para una changa "empieza" suena a algo que sigue después:
                  // acá la pregunta real es qué día es el trabajo.
                  label={
                    employmentType === "one_off"
                      ? C.steps.pay.startsOnLabelOneOff
                      : C.steps.pay.startsOnLabel
                  }
                  optional
                >
                  <Input
                    id="job-starts-on"
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                    className="numeric"
                  />
                </Field>
                <Field htmlFor="job-apply-by" label={C.steps.pay.applyByLabel} optional>
                  <Input
                    id="job-apply-by"
                    type="date"
                    value={applyBy}
                    // Acota el calendario nativo a lo que tiene sentido. Es
                    // ayuda, no defensa: la regla la aplican validateStep y el
                    // superRefine del esquema.
                    max={startsOn || undefined}
                    onChange={(event) => setApplyBy(event.target.value)}
                    className="numeric"
                  />
                </Field>
              </div>
            </OptionalSection>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeader
              step={3}
              title={Q.title}
              intro={Q.intro}
              icon={<ListChecks weight="fill" />}
            />

            {questions.length > 0 && (
              <ol className="flex flex-col gap-3">
                {questions.map((question, index) => {
                  const number = index + 1;
                  const isChoice = question.type === "multiple_choice";
                  const questionError = questionErrors[question.id];
                  return (
                    <Reveal as="li" key={question.id} y={10}>
                      <BezelCard coreClassName="flex flex-col gap-3 p-4">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="numeric flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-foreground"
                            style={{ backgroundColor: ACCENT_TINT }}
                          >
                            {number}
                          </span>
                          <span className="mr-auto text-sm font-semibold text-foreground">
                            {Q.questionTitle(number)}
                          </span>
                          <button
                            type="button"
                            aria-label={`${Q.removeQuestion}: ${Q.questionTitle(number)}`}
                            onClick={() => removeQuestion(question.id)}
                            className={ICON_BUTTON}
                          >
                            <Trash size={18} aria-hidden="true" />
                          </button>
                        </div>

                        <Input
                          id={`job-q-${question.id}`}
                          aria-label={Q.questionTitle(number)}
                          value={question.label}
                          maxLength={160}
                          placeholder={
                            isChoice ? Q.labelPlaceholderChoice : Q.labelPlaceholderYesNo
                          }
                          aria-invalid={questionError ? true : undefined}
                          onChange={(event) =>
                            updateQuestion(question.id, { label: event.target.value })
                          }
                        />

                        {/* El tipo se ve Y se cambia acá mismo, sin perder lo escrito:
                            el estado seleccionado ES la etiqueta del tipo. */}
                        <div
                          role="radiogroup"
                          aria-label={`${Q.questionTitle(number)} — tipo de respuesta`}
                          className="grid grid-cols-2 gap-2"
                        >
                          {(["yes_no", "multiple_choice"] as const).map((type) => {
                            const selected = question.type === type;
                            const TypeIcon = type === "yes_no" ? Question : ListChecks;
                            return (
                              <button
                                key={type}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => changeQuestionType(question.id, type)}
                                className={cn(
                                  TAP_CARD,
                                  "px-2 text-xs",
                                  selected
                                    ? "text-foreground"
                                    : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
                                )}
                                style={
                                  selected
                                    ? { borderColor: ACCENT_EDGE, backgroundColor: ACCENT_TINT }
                                    : undefined
                                }
                              >
                                <TypeIcon
                                  size={15}
                                  weight="bold"
                                  aria-hidden="true"
                                  className="shrink-0"
                                  style={selected ? { color: ACCENT } : undefined}
                                />
                                {type === "yes_no" ? Q.typeYesNo : Q.typeChoice}
                              </button>
                            );
                          })}
                        </div>

                        {isChoice ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                              {Q.optionsLabel}
                            </p>
                            {question.options.map((option, optionIndex) => (
                              <div key={optionIndex} className="flex items-center gap-2">
                                <Input
                                  aria-label={Q.optionAriaLabel(number, optionIndex + 1)}
                                  value={option}
                                  maxLength={80}
                                  placeholder={Q.optionPlaceholder(optionIndex + 1)}
                                  onChange={(event) =>
                                    updateOption(question.id, optionIndex, event.target.value)
                                  }
                                />
                                {question.options.length > JOB_QUESTION_MIN_OPTIONS && (
                                  <button
                                    type="button"
                                    aria-label={`${Q.removeOption} ${optionIndex + 1}`}
                                    onClick={() => removeOption(question.id, optionIndex)}
                                    className={ICON_BUTTON}
                                  >
                                    <X size={16} aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            ))}
                            {question.options.length < JOB_QUESTION_MAX_OPTIONS && (
                              <button
                                type="button"
                                onClick={() => addOption(question.id)}
                                className={cn(
                                  TAP_CARD,
                                  "w-full border-dashed border-border text-foreground-secondary hover:border-border-strong",
                                )}
                              >
                                <Plus size={16} aria-hidden="true" />
                                {Q.addOption}
                              </button>
                            )}
                          </div>
                        ) : (
                          // Espejo de lo que va a ver quien se postule.
                          <p className="flex items-center gap-2 text-xs text-foreground-muted">
                            {Q.answerPreview}
                            <span aria-hidden="true" className="flex gap-1.5">
                              <span className="rounded-full border border-border-subtle bg-surface-subtle px-2.5 py-0.5 font-semibold text-foreground-secondary">
                                {Q.yes}
                              </span>
                              <span className="rounded-full border border-border-subtle bg-surface-subtle px-2.5 py-0.5 font-semibold text-foreground-secondary">
                                {Q.no}
                              </span>
                            </span>
                          </p>
                        )}

                        {questionError && (
                          <p role="alert" className="text-sm font-medium text-danger">
                            {questionError}
                          </p>
                        )}
                      </BezelCard>
                    </Reveal>
                  );
                })}
              </ol>
            )}

            {questions.length === 0 && (
              <BezelCard coreClassName="flex flex-col items-center gap-2 px-5 py-7 text-center">
                <Question size={32} weight="duotone" aria-hidden="true" style={{ color: ACCENT }} />
                <p className="font-display text-base font-bold text-foreground">{Q.emptyTitle}</p>
                <p className="max-w-[38ch] text-sm text-foreground-secondary">{Q.emptyBody}</p>
                <div className="mt-2 flex w-full flex-col items-center gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                    <Sparkle size={13} weight="fill" aria-hidden="true" />
                    {Q.suggestionsTitle}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {Q.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => addQuestion("yes_no", suggestion)}
                        className={cn(TAP_CARD, "border-dashed border-border px-3 text-xs font-medium text-foreground-secondary hover:border-border-strong hover:text-foreground")}
                      >
                        <Plus size={13} aria-hidden="true" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </BezelCard>
            )}

            {questions.length < MAX_JOB_QUESTIONS ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{Q.addTitle}</p>
                  <span className="numeric text-xs text-foreground-muted">
                    {Q.counter(questions.length, MAX_JOB_QUESTIONS)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => addQuestion("yes_no")}
                    className={cn(TAP_CARD, "flex-col gap-0.5 border-dashed border-border py-3 text-foreground hover:border-border-strong")}
                  >
                    <span className="flex items-center gap-1.5">
                      <Question size={16} weight="bold" aria-hidden="true" style={{ color: ACCENT }} />
                      {Q.addYesNo}
                    </span>
                    <span className="text-[11px] font-medium text-foreground-muted">
                      {Q.addYesNoHint}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("multiple_choice")}
                    className={cn(TAP_CARD, "flex-col gap-0.5 border-dashed border-border py-3 text-foreground hover:border-border-strong")}
                  >
                    <span className="flex items-center gap-1.5">
                      <ListChecks size={16} weight="bold" aria-hidden="true" style={{ color: ACCENT }} />
                      {Q.addChoice}
                    </span>
                    <span className="text-[11px] font-medium text-foreground-muted">
                      {Q.addChoiceHint}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                {Q.maxReached}
              </p>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <StepHeader
              step={4}
              title={C.steps.where.title}
              intro={C.steps.where.intro}
              icon={<MapPin weight="fill" />}
            />

            {/* Con modalidad "a distancia" la zona no se pide ni se inventa. Se
                explica por qué en vez de dejar un hueco: un campo que
                desaparece sin decir nada se lee como un error de la app. */}
            {needsArea ? (
              <Field
                htmlFor="job-area"
                label={C.steps.where.areaLabel}
                help={C.steps.where.areaHelp}
              >
                <Input
                  id="job-area"
                  value={areaLabel}
                  maxLength={80}
                  placeholder={C.steps.where.areaPlaceholder}
                  onChange={(event) => setAreaLabel(event.target.value)}
                />
              </Field>
            ) : (
              <div
                className="flex items-start gap-2.5 rounded-md px-4 py-3"
                style={{ backgroundColor: ACCENT_TINT }}
              >
                <MapPin
                  size={18}
                  weight="fill"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                  style={{ color: ACCENT }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {C.steps.where.areaRemoteTitle}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                    {C.steps.where.areaRemoteBody}
                  </p>
                </div>
              </div>
            )}

            {/* NEGOCIO VINCULADO → columna listings.business_listing_id (0107).
                El desplegable sólo aparece si la persona TIENE fichas propias
                publicadas: sin negocios sería una pregunta con una sola
                respuesta posible. La pertenencia la verifica el trigger de la
                base, no esta lista. */}
            {businesses.length > 0 && (
              <Field
                htmlFor="job-business"
                label={C.steps.where.businessLabel}
                help={C.steps.where.businessHelp}
                optional
              >
                <Select
                  id="job-business"
                  value={businessListingId}
                  onChange={(event) => setBusinessListingId(event.target.value)}
                >
                  <option value="">{C.steps.where.businessPersonal}</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {C.steps.where.photosTitle}
                </h3>
                <p className="mt-0.5 text-sm text-foreground-secondary">
                  {C.steps.where.photosHelp}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {photos.map((item, index) => (
                  <div key={item.previewUrl} className="relative aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL) */}
                    <img
                      src={item.previewUrl}
                      alt={C.steps.where.photoAlt(index + 1)}
                      className="size-full rounded-md object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`${C.steps.where.removePhoto} ${index + 1}`}
                      onClick={() => removePhoto(index)}
                      className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-media-scrim text-on-media focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-1 rounded-md",
                      "border border-dashed border-border text-foreground-muted",
                      "transition-colors duration-(--duration-fast) hover:border-brand hover:text-brand-ink",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    )}
                  >
                    <ImageSquare size={22} aria-hidden="true" />
                    <span className="text-[11px] font-semibold">{C.steps.where.addPhoto}</span>
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                aria-label={C.steps.where.addPhoto}
                onChange={(event) => addPhotos(event.target.files)}
              />

              {photos.length > 0 && (
                <p className="text-xs text-foreground-muted">{C.steps.where.reviewNote}</p>
              )}
            </div>
          </>
        )}
      </Reveal>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            {C.nav.back}
          </Button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button variant="primary" className="ml-auto min-w-32" onClick={goNext}>
            {C.nav.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ml-auto min-w-40"
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? C.nav.submitting : C.nav.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

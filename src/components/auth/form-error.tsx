import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

/** Aviso de error de formulario — cálido, nunca un stack técnico. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger"
    >
      <WarningCircle
        size={18}
        weight="fill"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />
      <p>{children}</p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Trash } from "@phosphor-icons/react/dist/ssr";
import { deleteAccountAction } from "@/app/(app)/perfil/actions";
import { Button, Dialog, useToast } from "@/components/ui";

const COPY = {
  trigger: "Eliminar mi cuenta",
  title: "¿Eliminar tu cuenta?",
  description:
    "Se borra todo: tu perfil, tus publicaciones y tus mensajes. No lo podemos deshacer. Si algún día volvés, empezás de cero — y acá siempre vas a ser bienvenido.",
  confirm: "Sí, eliminar todo",
  cancel: "Mejor no",
  error:
    "No pudimos eliminar tu cuenta — probá de nuevo en un momento.",
} as const;

/** Acción de alto riesgo: Dialog alertdialog + doble confirmación (§1.3.4). */
export function DeleteAccount() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      // Si sale bien, la action redirige y esto nunca vuelve.
      const result = await deleteAccountAction();
      if (result && !result.ok) {
        setOpen(false);
        toast({ title: COPY.error, variant: "danger" });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-danger underline-offset-4 transition-colors duration-(--duration-fast) hover:underline"
      >
        <Trash size={18} aria-hidden="true" />
        {COPY.trigger}
      </button>

      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={COPY.title}
        description={COPY.description}
        highRisk
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {COPY.cancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={onConfirm}>
              {COPY.confirm}
            </Button>
          </>
        }
      />
    </>
  );
}

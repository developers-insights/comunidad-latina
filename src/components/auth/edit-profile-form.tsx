"use client";

import { useState, useTransition } from "react";
import {
  updateProfileAction,
  type UpdateProfileInput,
} from "@/app/(app)/perfil/actions";
import { FormError } from "@/components/auth/form-error";
import { ZoneInput } from "@/components/onboarding/zone-input";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";

const COPY = {
  displayName: "Tu nombre para mostrar",
  bio: "Sobre vos",
  bioHelp: "Contale a la comunidad quién sos. Sin datos sensibles.",
  bioPlaceholder: "Ej: Dominicana, 5 años en Queens. Amo cocinar.",
  area: "Tu barrio o zona",
  areaHelp: "Solo la zona — nunca tu dirección exacta.",
  submit: "Guardar cambios",
  saved: "Listo, tu perfil quedó actualizado.",
} as const;

export function EditProfileForm({
  initial,
}: {
  initial: UpdateProfileInput;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [area, setArea] = useState(initial.area);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await updateProfileAction({ displayName, bio, area });
      if (result.ok) {
        setFieldErrors({});
        toast({ title: COPY.saved, variant: "success" });
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError>{formError}</FormError>

      <Field
        htmlFor="edit-name"
        label={COPY.displayName}
        error={fieldErrors.displayName}
      >
        <Input
          id="edit-name"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={fieldErrors.displayName ? true : undefined}
          aria-describedby={fieldErrors.displayName ? "edit-name-error" : undefined}
        />
      </Field>

      <Field
        htmlFor="edit-bio"
        label={COPY.bio}
        help={COPY.bioHelp}
        error={fieldErrors.bio}
        optional
      >
        <Textarea
          id="edit-bio"
          value={bio}
          placeholder={COPY.bioPlaceholder}
          maxLength={500}
          onChange={(e) => setBio(e.target.value)}
          aria-invalid={fieldErrors.bio ? true : undefined}
          aria-describedby={fieldErrors.bio ? "edit-bio-error" : undefined}
        />
      </Field>

      <Field
        htmlFor="edit-area"
        label={COPY.area}
        help={COPY.areaHelp}
        error={fieldErrors.area}
        optional
      >
        <ZoneInput
          id="edit-area"
          value={area}
          onChange={setArea}
          aria-invalid={fieldErrors.area ? true : undefined}
          aria-describedby={fieldErrors.area ? "edit-area-error" : undefined}
        />
      </Field>

      <Button type="submit" loading={pending} className="self-start">
        {COPY.submit}
      </Button>
    </form>
  );
}

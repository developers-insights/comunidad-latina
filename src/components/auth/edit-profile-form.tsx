"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Eye, EyeSlash, LockKey } from "@phosphor-icons/react/dist/ssr";
import {
  updateProfileAction,
  type UpdateProfileInput,
} from "@/app/(app)/perfil/actions";
import { COUNTRY_OPTIONS } from "@/components/auth/countries";
import { FormError } from "@/components/auth/form-error";
import { UsernameInput } from "@/components/auth/username-input";
import { CoverUploadField } from "@/components/auth/cover-upload-field";
import { AvatarUploadField } from "@/components/auth/avatar-upload-field";
import { LanguagePicker } from "@/components/auth/language-picker";
import { RESIDENCE_COUNTRIES } from "@/lib/profile/catalogs";
import { ZoneInput } from "@/components/onboarding/zone-input";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";

/**
 * Editar el perfil propio.
 *
 * ── LA PANTALLA ESTÁ PARTIDA EN DOS, Y NO ES DECORACIÓN ──────────────────────
 * Arriba, «Tu cara en la comunidad»: lo que cualquiera ve — nombre, handle,
 * portada, presentación, zona, país de origen. Abajo, «Solo para vos»: apellido,
 * fecha de nacimiento, dónde vivís, idiomas.
 *
 * El corte es exactamente el de las tablas: lo de arriba vive en `profiles`
 * (pública por diseño) y lo de abajo en `profiles_private` (solo-dueño por RLS
 * desde 0003). Que la pantalla lo muestre partido es lo que hace que la promesa
 * sea creíble: la persona no tiene que confiar en una etiqueta, ve dos bloques
 * distintos con dos reglas distintas escritas encima de cada uno.
 *
 * Y la segunda mitad arranca PLEGADA. Es información que no hace falta el primer
 * día; abierta de entrada convertiría una pantalla de seis campos en una de
 * once, que es exactamente lo que el onboarding evita.
 */

const COPY = {
  publicHeading: "Tu cara en la comunidad",
  publicNote: "Esto es lo que ve cualquiera que entre a tu perfil.",
  privateHeading: "Solo para vos",
  privateNote:
    "Estos datos quedan guardados en privado. Vos decidís, uno por uno, quién puede verlos.",
  privateToggleOpen: "Completar mis datos privados",
  privateToggleClose: "Ocultar mis datos privados",
  privacyLink: "Elegir quién ve cada cosa",

  displayName: "Nombre",
  lastName: "Apellido",
  username: "Nombre de usuario",
  usernameHelp: "Así te encuentran y te mencionan.",
  bio: "Sobre vos",
  bioHelp: "Contale a la comunidad quién sos. Sin datos sensibles.",
  bioPlaceholder: "Ej: Dominicana, 5 años en Queens. Amo cocinar.",
  area: "Tu barrio o zona",
  areaHelp: "Solo la zona — nunca tu dirección exacta.",
  // País de origen (pedido cliente: "agregar al perfil de dónde es la
  // persona"). Va como el resto de los campos opcionales del form: se puede
  // dejar sin decir.
  country: "País de origen",
  countryHelp: "Así la comunidad sabe de dónde sos.",
  countryEmptyOption: "Preferís no decirlo",
  countryResidence: "País donde vivís",
  countryResidenceEmpty: "Preferís no decirlo",
  city: "Ciudad",
  cityPlaceholder: "Ej: Queens",
  cityHelp: "La ciudad, nunca la calle ni el número.",
  birthdate: "Fecha de nacimiento",
  birthdateHelp:
    "Nunca se muestra completa: como mucho, la comunidad ve tu edad en años. Hace falta para publicar como creador.",

  submit: "Guardar cambios",
  saved: "Listo, tu perfil quedó actualizado.",
} as const;

/**
 * Todo lo que la pantalla necesita saber del perfil. Se arma en el servidor,
 * donde `profile_card()` ya devolvió los campos privados al DUEÑO (que siempre
 * se ve entero a sí mismo, por `app.privacy_allows`).
 */
export interface EditProfileInitial {
  displayName: string;
  lastName: string;
  username: string;
  bio: string;
  area: string;
  country: string;
  countryResidence: string;
  city: string;
  /** `YYYY-MM-DD` o "". Sólo el dueño la recibe. */
  birthdate: string;
  languages: string[];
  coverUrl: string | null;
  avatarUrl: string | null;
}

export function EditProfileForm({ initial }: { initial: EditProfileInitial }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [displayName, setDisplayName] = useState(initial.displayName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [username, setUsername] = useState(initial.username);
  const [bio, setBio] = useState(initial.bio);
  const [area, setArea] = useState(initial.area);
  const [country, setCountry] = useState(initial.country);
  const [countryResidence, setCountryResidence] = useState(initial.countryResidence);
  const [city, setCity] = useState(initial.city);
  const [birthdate, setBirthdate] = useState(initial.birthdate);
  const [languages, setLanguages] = useState<string[]>(initial.languages);
  // `undefined` = la portada no se tocó. "" = se quitó. Ruta = se subió una.
  const [coverPath, setCoverPath] = useState<string | undefined>(undefined);
  // Mismo contrato que `coverPath`, para la foto de perfil.
  const [avatarPath, setAvatarPath] = useState<string | undefined>(undefined);

  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * El bloque privado arranca abierto si YA hay algo cargado. A quien completó
   * su apellido y su ciudad, plegárselos le esconde sus propios datos y le hace
   * pensar que se perdieron.
   */
  const [showPrivate, setShowPrivate] = useState(
    Boolean(
      initial.lastName || initial.city || initial.birthdate || initial.languages.length,
    ),
  );

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const input: UpdateProfileInput = {
        displayName,
        lastName,
        username,
        bio,
        area,
        country,
        countryResidence,
        city,
        birthdate,
        languages,
        ...(coverPath !== undefined ? { coverPath } : {}),
        ...(avatarPath !== undefined ? { avatarPath } : {}),
      };
      const result = await updateProfileAction(input);
      if (result.ok) {
        setFieldErrors({});
        setCoverPath(undefined);
        setAvatarPath(undefined);
        toast({ title: COPY.saved, variant: "success" });
        return;
      }
      const errors = result.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(result.formError ?? null);
      // Un error en un campo plegado sería invisible: si lo hay, se despliega.
      if (PRIVATE_FIELDS.some((field) => errors[field])) setShowPrivate(true);
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormError>{formError}</FormError>

      {/* ── Público ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionNote icon={<Eye size={16} aria-hidden="true" />} tone="public">
          <strong className="font-semibold text-foreground">{COPY.publicHeading}</strong>{" "}
          {COPY.publicNote}
        </SectionNote>

        <CoverUploadField
          value={coverPath}
          onChange={setCoverPath}
          currentUrl={initial.coverUrl}
          disabled={pending}
        />

        <AvatarUploadField
          value={avatarPath}
          onChange={setAvatarPath}
          currentUrl={initial.avatarUrl}
          displayName={displayName}
          disabled={pending}
        />

        <Field htmlFor="edit-name" label={COPY.displayName} error={fieldErrors.displayName}>
          <Input
            id="edit-name"
            type="text"
            autoComplete="given-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? "edit-name-error" : undefined}
          />
        </Field>

        <Field
          htmlFor="edit-username"
          label={COPY.username}
          help={COPY.usernameHelp}
          error={fieldErrors.username}
        >
          <UsernameInput
            id="edit-username"
            value={username}
            onChange={(next) => {
              setUsername(next);
              if (fieldErrors.username) {
                setFieldErrors((prev) => {
                  const rest = { ...prev };
                  delete rest.username;
                  return rest;
                });
              }
            }}
            invalid={Boolean(fieldErrors.username)}
            describedBy={
              fieldErrors.username ? "edit-username-error" : "edit-username-help"
            }
            disabled={pending}
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

        <Field
          htmlFor="edit-country"
          label={COPY.country}
          help={COPY.countryHelp}
          error={fieldErrors.country}
          optional
        >
          <Select
            id="edit-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            aria-invalid={fieldErrors.country ? true : undefined}
            aria-describedby={fieldErrors.country ? "edit-country-error" : undefined}
          >
            <option value="">{COPY.countryEmptyOption}</option>
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      {/* ── Privado ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 border-t border-border-subtle pt-6">
        <SectionNote icon={<EyeSlash size={16} aria-hidden="true" />} tone="private">
          <strong className="font-semibold text-foreground">{COPY.privateHeading}</strong>{" "}
          {COPY.privateNote}
        </SectionNote>

        {!showPrivate ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setShowPrivate(true)}
          >
            {COPY.privateToggleOpen}
          </Button>
        ) : (
          <>
            <Field htmlFor="edit-lastname" label={COPY.lastName} error={fieldErrors.lastName} optional>
              <Input
                id="edit-lastname"
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                aria-invalid={fieldErrors.lastName ? true : undefined}
                aria-describedby={fieldErrors.lastName ? "edit-lastname-error" : undefined}
              />
            </Field>

            <Field
              htmlFor="edit-birthdate"
              label={COPY.birthdate}
              help={COPY.birthdateHelp}
              error={fieldErrors.birthdate}
              optional
            >
              <Input
                id="edit-birthdate"
                type="date"
                autoComplete="bday"
                // El teclado nativo de fechas evita el 90% de los formatos
                // raros; el resto lo ataja el servidor, que además chequea la
                // edad mínima (el CHECK de la base no puede: no es inmutable).
                max={new Date().toISOString().slice(0, 10)}
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
                aria-invalid={fieldErrors.birthdate ? true : undefined}
                aria-describedby={
                  fieldErrors.birthdate ? "edit-birthdate-error" : "edit-birthdate-help"
                }
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="edit-residence"
                label={COPY.countryResidence}
                error={fieldErrors.countryResidence}
                optional
              >
                <Select
                  id="edit-residence"
                  value={countryResidence}
                  onChange={(e) => setCountryResidence(e.target.value)}
                  aria-invalid={fieldErrors.countryResidence ? true : undefined}
                  aria-describedby={
                    fieldErrors.countryResidence ? "edit-residence-error" : undefined
                  }
                >
                  <option value="">{COPY.countryResidenceEmpty}</option>
                  {RESIDENCE_COUNTRIES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                htmlFor="edit-city"
                label={COPY.city}
                help={COPY.cityHelp}
                error={fieldErrors.city}
                optional
              >
                <Input
                  id="edit-city"
                  type="text"
                  autoComplete="address-level2"
                  placeholder={COPY.cityPlaceholder}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  aria-invalid={fieldErrors.city ? true : undefined}
                  aria-describedby={fieldErrors.city ? "edit-city-error" : "edit-city-help"}
                />
              </Field>
            </div>

            <LanguagePicker
              id="edit-languages"
              value={languages}
              onChange={setLanguages}
              disabled={pending}
            />

            <Link
              href="/ajustes/privacidad#perfil"
              className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-brand-ink underline decoration-brand-subtle underline-offset-4 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              {/* `LockKey` y no `ShieldCheck`: el escudo es la insignia de
                  identidad verificada en toda la app, y este enlace va a los
                  controles de privacidad. Un candado dice lo que el enlace
                  hace sin pedirle prestado el significado a otra marca. */}
              <LockKey size={16} aria-hidden="true" />
              {COPY.privacyLink}
            </Link>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setShowPrivate(false)}
            >
              {COPY.privateToggleClose}
            </Button>
          </>
        )}
      </section>

      <Button type="submit" loading={pending} className="self-start">
        {COPY.submit}
      </Button>
    </form>
  );
}

/** Los campos que viven en el bloque plegable. */
const PRIVATE_FIELDS = [
  "lastName",
  "birthdate",
  "countryResidence",
  "city",
  "languages",
] as const;

/**
 * La línea que explica la regla de cada bloque. El ícono acompaña al texto y no
 * lo reemplaza: un ojo tachado no significa "privado" para nadie que lo vea por
 * primera vez.
 */
function SectionNote({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "public" | "private";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "public"
          ? "flex items-start gap-2 rounded-lg bg-surface-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground-secondary"
          : "flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2.5 text-sm leading-relaxed text-foreground-secondary"
      }
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
        {icon}
      </span>
      <span>{children}</span>
    </p>
  );
}

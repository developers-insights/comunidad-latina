export const PASSWORD_MIN_LENGTH = 8;
// bcrypt trunca en 72 bytes: más largo se aceptaría pero no se compararía entero.
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRuleId = "length" | "uppercase" | "number";

export type PasswordRule = {
  id: PasswordRuleId;
  label: string;
  test: (password: string) => boolean;
};

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "Una letra mayúscula",
    test: (p) => /\p{Lu}/u.test(p),
  },
  {
    id: "number",
    label: "Un número",
    test: (p) => /\d/.test(p),
  },
];

export const PASSWORD_COPY = {
  short: `La contraseña necesita al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  long: "La contraseña es demasiado larga.",
  uppercase: "Sumale al menos una letra mayúscula.",
  number: "Sumale al menos un número.",
  mismatch: "Las contraseñas no coinciden.",
  confirmRequired: "Repetí la contraseña para confirmarla.",
} as const;

export function passwordRuleResults(password: string): Record<PasswordRuleId, boolean> {
  return {
    length: PASSWORD_RULES[0].test(password),
    uppercase: PASSWORD_RULES[1].test(password),
    number: PASSWORD_RULES[2].test(password),
  };
}

export function passwordProblem(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) return PASSWORD_COPY.long;
  const r = passwordRuleResults(password);
  if (!r.length) return PASSWORD_COPY.short;
  if (!r.uppercase) return PASSWORD_COPY.uppercase;
  if (!r.number) return PASSWORD_COPY.number;
  return null;
}

export function isPasswordValid(password: string): boolean {
  return passwordProblem(password) === null;
}

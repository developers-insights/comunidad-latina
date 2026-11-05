import type { ReactNode } from "react";
import { exigirPerfil } from "@/lib/auth/exigir-sesion";

/** Guarda de sesión y de perfil antes del `loading.tsx`: ver `lib/auth/exigir-sesion.ts`. */
export default async function VerificarLayout({ children }: { children: ReactNode }) {
  await exigirPerfil("/perfil/verificar");
  return children;
}

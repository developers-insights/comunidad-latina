import type { ReactNode } from "react";
import { SoloEnLaWeb } from "@/components/canal/canal-app";
import { exigirSesion } from "@/lib/auth/exigir-sesion";

export default async function ImpulsarCrearLayout({ children }: { children: ReactNode }) {
  await exigirSesion("/impulsar/crear");

  return <SoloEnLaWeb>{children}</SoloEnLaWeb>;
}

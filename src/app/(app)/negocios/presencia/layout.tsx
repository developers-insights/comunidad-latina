import type { ReactNode } from "react";
import { SoloEnLaWeb } from "@/components/canal/canal-app";

export default function PresenciaLayout({ children }: { children: ReactNode }) {
  return <SoloEnLaWeb>{children}</SoloEnLaWeb>;
}

import type { ReactNode } from "react";
import { requireStaff } from "../../guard";

export default async function RecursosLayout({ children }: { children: ReactNode }) {
  await requireStaff("domain_admin");
  return children;
}

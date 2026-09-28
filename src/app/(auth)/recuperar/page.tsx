import { AuthCard } from "@/components/auth/auth-card";
import { RecuperarClient } from "./recuperar-client";

export const metadata = { title: "Recuperar contraseña" };

export default function RecuperarPage() {
  return (
    <AuthCard>
      <RecuperarClient />
    </AuthCard>
  );
}

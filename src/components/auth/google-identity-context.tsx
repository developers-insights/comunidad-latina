"use client";

import { createContext, useContext, type ReactNode } from "react";

const GoogleClientIdContext = createContext<string | null>(null);

// Contexto y no prop: entre la página (server) y el botón están `LoginForm` y
// `RegisterForm`, que no tienen por qué saber de Google.
export function GoogleClientIdProvider({
  clientId,
  children,
}: {
  clientId: string | null;
  children: ReactNode;
}) {
  return <GoogleClientIdContext.Provider value={clientId}>{children}</GoogleClientIdContext.Provider>;
}

export function useGoogleClientId(): string | null {
  return useContext(GoogleClientIdContext);
}

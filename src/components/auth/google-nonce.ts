/**
 * Supabase compara el `nonce` del ID token contra el SHA-256 (hex) del que le
 * pasamos en `signInWithIdToken`: a Google va el hash, a Supabase el crudo.
 */

export function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function supportsGoogleIdentity(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function" &&
    typeof crypto.subtle?.digest === "function"
  );
}

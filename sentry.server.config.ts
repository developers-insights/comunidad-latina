/**
 * Sentry — runtime Node.js del server. Se importa SOLO desde
 * src/instrumentation.ts y SOLO si hay NEXT_PUBLIC_SENTRY_DSN (guard en
 * register()). Scrub de PII compartido en sentry.scrub.ts.
 */
import * as Sentry from "@sentry/nextjs";
import { SENTRY_SHARED_OPTIONS } from "./sentry.scrub";

Sentry.init({
  ...SENTRY_SHARED_OPTIONS,
});

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  ensureCreatorConnectedAccount,
  retryPendingPayoutsFor,
  syncConnectedAccount,
  type AdminClient,
} from "./escrow";

export function payoutReturnUrls(siteUrl: string): { refresh_url: string; return_url: string } {
  return {
    refresh_url: `${siteUrl}/creadores/cobros/reintentar`,
    return_url: `${siteUrl}/creadores/cobros/vuelta`,
  };
}

export async function isCreatorOfTenant(
  admin: AdminClient,
  profileId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("creator_profiles")
    .select("profile_id")
    .eq("profile_id", profileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`select creator_profiles: ${error.code}`);
  return Boolean(data);
}

export async function onboardingLink(input: {
  admin: AdminClient;
  stripe: Stripe;
  tenantId: string;
  profileId: string;
  email: string | null;
  siteUrl: string;
}): Promise<string> {
  const accountId = await ensureCreatorConnectedAccount(input);
  const link = await input.stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    ...payoutReturnUrls(input.siteUrl),
  });
  return link.url;
}

export async function syncAfterReturn(input: {
  admin: AdminClient;
  stripe: Stripe;
  profileId: string;
}): Promise<"none" | "synced"> {
  const { data, error } = await (input.admin as unknown as SupabaseClient)
    .from("connected_accounts")
    .select("stripe_account_id")
    .eq("owner_type", "creator")
    .eq("owner_ref", input.profileId)
    .maybeSingle();
  if (error) throw new Error(`select connected_accounts: ${error.code}`);
  const accountId = (data as { stripe_account_id: string | null } | null)?.stripe_account_id;
  if (!accountId) return "none";
  const account = await input.stripe.accounts.retrieve(accountId);
  await syncConnectedAccount(input.admin, account);
  await retryPendingPayoutsFor({ admin: input.admin, stripe: input.stripe, creatorId: input.profileId });
  return "synced";
}

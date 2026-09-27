"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findTransition, type ContractAction } from "@/components/creators/contract-machine";
import { isStripeConfigured, isPagosDemoPermitido } from "@/lib/config/services";
import {
  ACCESS_COPY,
  buildContractSnapshot,
  loadContractForParty,
  type PartyContract,
} from "@/lib/creators/contract-access";
import {
  PROPOSAL_MESSAGE_MAX,
  normalizeRevisions,
  normalizeUsageRights,
  validateSignatureInput,
} from "@/lib/creators/contract-terms";
import {
  approveDelivery as approveDeliveryCore,
  loadEscrowContract,
  notifyContractParty,
  openGigCheckout,
  recordContractEvent,
  refundCanceledContract,
  type AdminClient,
  type PayoutResult,
} from "@/lib/creators/escrow";
import {
  DELIVERY_BUCKET,
  MAX_FILES_PER_DELIVERY,
  deliveryFolder,
  deliveryObjectPath,
  isAllowedDeliveryFile,
} from "@/lib/creators/delivery-files";
import { reviewDeadlineFrom, revisionsLeft } from "@/lib/creators/review-window";
import { blockContactInfoIn } from "@/lib/moderation/contact-block";
import { clientIpFromHeaders, HOUR_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

type Fail = { ok: false; error: string; needsAuth?: boolean; stale?: boolean; contactBlocked?: boolean };

const COPY = {
  generic: "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
  stale: "La colaboración cambió mientras la mirabas. Actualizamos la pantalla.",
  tooFast: "Vas muy rápido. Esperá un momento y probá de nuevo.",
  noteShort: "Contanos un poco más (al menos 10 caracteres).",
  signName: "Escribí tu nombre y apellido tal como figuran en tu documento.",
  signDraw: "Dibujá tu firma en el recuadro.",
  signConsent: "Para firmar tenés que aceptar el contrato y la firma electrónica.",
  signStale: "El contrato cambió desde que lo abriste. Revisá la versión nueva antes de firmar.",
  noRevisions: "Ya usaste todas las revisiones incluidas en el contrato. Podés aprobar o abrir una disputa.",
  noFiles: "Subí al menos un archivo para entregar.",
  badFiles: "Alguno de los archivos no es válido. Probá subirlos de nuevo.",
  tooManyFiles: `Podés entregar hasta ${MAX_FILES_PER_DELIVERY} archivos por vez.`,
  fileType: "Ese tipo de archivo no se puede entregar. Usá video, foto, audio, PDF o ZIP de hasta 200 MB.",
  maxMilestones: "Ya tenés 10 hitos. Marcá los que terminaste en vez de sumar más.",
  paymentProcessing: "Tu pago ya se está confirmando. En unos segundos se actualiza la colaboración.",
  terms: "Revisá las condiciones: revisiones de 0 a 5 y derechos de uso de 3 a 120 caracteres.",
} as const;

function adminClient(): AdminClient {
  return createAdminClient();
}

function db(admin: AdminClient): SupabaseClient {
  return admin as unknown as SupabaseClient;
}

function fail(error: string, extra: Omit<Fail, "ok" | "error"> = {}): Fail {
  return { ok: false, error, ...extra };
}

async function access(contractId: string) {
  if (!z.uuid().safeParse(contractId).success) return { ok: false as const, error: ACCESS_COPY.notAllowed };
  return loadContractForParty(contractId);
}

function ruleFor(role: "client" | "creator", contract: PartyContract, action: ContractAction) {
  return findTransition(role, contract.status, action);
}

async function moveStatus(
  admin: AdminClient,
  contract: PartyContract,
  from: string,
  patch: Record<string, unknown>,
): Promise<"ok" | "stale" | "error"> {
  const { data, error } = await db(admin)
    .from("gig_contracts")
    .update(patch)
    .eq("id", contract.id)
    .eq("tenant_id", contract.tenant_id)
    .eq("status", from)
    .select("id");
  if (error) {
    console.error("[creadores] transición falló", { contractId: contract.id, from, code: error.code });
    return "error";
  }
  return (data ?? []).length === 0 ? "stale" : "ok";
}

function counterpartOf(role: "client" | "creator", contract: PartyContract): string {
  return role === "client" ? contract.creator_id : contract.client_id;
}

const noteSchema = z.string().trim().min(10).max(2000);

// ---------------------------------------------------------------------------
// Propuesta
// ---------------------------------------------------------------------------

export type SimpleResult = { ok: true } | Fail;

export async function acceptProposal(contractId: string): Promise<SimpleResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "accept");
  if (!rule) return fail(ACCESS_COPY.notAllowed);
  if (!limit(`gig-accept:${a.user.id}`, 30, HOUR_MS).ok) return fail(COPY.tooFast);

  const admin = adminClient();
  let snapshot;
  try {
    snapshot = await buildContractSnapshot(admin, a.contract, a.tenant.name);
  } catch (error) {
    console.error("[creadores] no se pudo generar el contrato", {
      contractId,
      message: error instanceof Error ? error.message : error,
    });
    return fail(COPY.generic);
  }

  const moved = await moveStatus(admin, a.contract, "proposed", {
    status: "accepted",
    accepted_at: new Date().toISOString(),
    contract_text: snapshot.text,
    terms_hash: snapshot.hash,
    template_version: snapshot.templateVersion,
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "accepted",
    meta: { terms_version: a.contract.terms_version, terms_hash: snapshot.hash },
  });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: a.contract.client_id,
    contractId,
    title: "Aceptaron tu propuesta: falta firmar",
    body: `Se generó el contrato de "${a.contract.title}". Revisalo y firmalo para habilitar el pago.`,
  });
  return { ok: true };
}

export async function rejectProposal(contractId: string): Promise<SimpleResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "reject");
  if (!rule) return fail(ACCESS_COPY.notAllowed);

  const admin = adminClient();
  const moved = await moveStatus(admin, a.contract, "proposed", {
    status: "rejected",
    rejected_at: new Date().toISOString(),
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, { tenantId: a.contract.tenant_id, contractId, actorId: a.user.id, kind: "rejected" });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: a.contract.client_id,
    contractId,
    title: "Rechazaron tu propuesta",
    body: `La propuesta "${a.contract.title}" no siguió adelante. Podés proponerle a otro creador.`,
  });
  return { ok: true };
}

export async function requestTermsChanges(contractId: string, rawNote: string): Promise<SimpleResult> {
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return fail(COPY.noteShort);
  const contact = blockContactInfoIn([note.data]);
  if (!contact.ok) return fail(contact.message, { contactBlocked: true });

  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "request_terms_changes");
  if (!rule) return fail(ACCESS_COPY.notAllowed);
  if (!limit(`gig-terms-changes:${a.user.id}`, 20, HOUR_MS).ok) return fail(COPY.tooFast);

  const admin = adminClient();
  if (rule.from === "accepted") {
    const moved = await moveStatus(admin, a.contract, "accepted", {
      status: "proposed",
      accepted_at: null,
      terms_version: a.contract.terms_version + 1,
      contract_text: null,
      terms_hash: null,
    });
    if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });
  }

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "terms_changes_requested",
    note: note.data,
  });
  const other = counterpartOf(a.role, a.contract);
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: other,
    contractId,
    title: "Te piden cambios en la propuesta",
    body: note.data.slice(0, 140),
  });
  return { ok: true };
}

const editSchema = z.object({
  title: z.string().trim().min(6).max(120),
  scope: z.string().trim().min(10).max(2000),
  deliveryDays: z.number().int().min(1).max(365),
  amountCents: z.number().int().positive().max(100_000_000),
  revisionsIncluded: z.number().int(),
  usageRights: z.string(),
  proposalMessage: z.string().trim().max(PROPOSAL_MESSAGE_MAX).nullish(),
});

export async function editProposal(
  contractId: string,
  rawInput: z.input<typeof editSchema>,
): Promise<SimpleResult> {
  const parsed = editSchema.safeParse(rawInput);
  if (!parsed.success) return fail(COPY.terms);
  const input = parsed.data;
  const revisions = normalizeRevisions(input.revisionsIncluded);
  const usage = normalizeUsageRights(input.usageRights);
  if (revisions === null || usage === null) return fail(COPY.terms);
  const contact = blockContactInfoIn([input.title, input.scope, usage, input.proposalMessage ?? ""]);
  if (!contact.ok) return fail(contact.message, { contactBlocked: true });

  const a = await access(contractId);
  if (!a.ok) return a;
  if (a.role !== "client" || a.contract.status !== "proposed") return fail(ACCESS_COPY.notAllowed);

  const admin = adminClient();
  const moved = await moveStatus(admin, a.contract, "proposed", {
    title: input.title,
    scope: input.scope,
    delivery_days: input.deliveryDays,
    amount_cents: input.amountCents,
    revisions_included: revisions,
    usage_rights: usage,
    proposal_message: input.proposalMessage?.trim() || null,
    terms_version: a.contract.terms_version + 1,
    contract_text: null,
    terms_hash: null,
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "terms_edited",
    meta: { terms_version: a.contract.terms_version + 1 },
  });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: a.contract.creator_id,
    contractId,
    title: "Actualizaron la propuesta",
    body: `Revisá las condiciones nuevas de "${input.title}".`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

export type SignResult = { ok: true; bothSigned: boolean } | Fail;

export async function signContract(
  contractId: string,
  input: { legalName: string; signaturePng: string; accepted: boolean; termsHash: string },
): Promise<SignResult> {
  const valid = validateSignatureInput(input);
  if (!valid.ok) {
    return fail(valid.reason === "name" ? COPY.signName : valid.reason === "signature" ? COPY.signDraw : COPY.signConsent);
  }
  if (!/^[0-9a-f]{64}$/.test(input.termsHash)) return fail(COPY.signStale, { stale: true });

  const a = await access(contractId);
  if (!a.ok) return a;
  if (a.contract.status !== "accepted") return fail(ACCESS_COPY.notAllowed, { stale: true });
  if (!limit(`gig-sign:${a.user.id}`, 10, HOUR_MS).ok) return fail(COPY.tooFast);

  const requestHeaders = await headers();
  const admin = adminClient();
  const { data, error } = await db(admin).rpc("firmar_contrato_de_colaboracion", {
    p_contract_id: contractId,
    p_signer_id: a.user.id,
    p_legal_name: valid.legalName,
    p_signature_png: input.signaturePng,
    p_terms_hash: input.termsHash,
    p_ip: clientIpFromHeaders(requestHeaders),
    p_user_agent: requestHeaders.get("user-agent") ?? null,
  });
  if (error) {
    console.error("[creadores] la firma falló", { contractId, code: error.code });
    return fail(COPY.generic);
  }
  const outcome = data as { ok: boolean; reason?: string; both?: boolean; already?: boolean } | null;
  if (!outcome?.ok) {
    if (outcome?.reason === "stale_terms") return fail(COPY.signStale, { stale: true });
    return fail(ACCESS_COPY.notAllowed, { stale: true });
  }

  const other = counterpartOf(a.role, a.contract);
  if (outcome.both && !outcome.already) {
    for (const profileId of [a.contract.client_id, a.contract.creator_id]) {
      await notifyContractParty(admin, {
        tenantId: a.contract.tenant_id,
        profileId,
        contractId,
        title: "Contrato firmado por las dos partes",
        body:
          profileId === a.contract.client_id
            ? "Ya podés confirmar el pago protegido para que el trabajo arranque."
            : "Cuando el negocio confirme el pago, te avisamos para que arranques.",
      });
    }
  } else if (!outcome.both && !outcome.already) {
    await notifyContractParty(admin, {
      tenantId: a.contract.tenant_id,
      profileId: other,
      contractId,
      title: "Falta tu firma",
      body: `La otra parte ya firmó el contrato de "${a.contract.title}".`,
    });
  }
  return { ok: true, bothSigned: Boolean(outcome.both) };
}

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

export type StartPaymentResult = { ok: true; url: string | null; demo: boolean } | Fail;

export async function startPayment(contractId: string): Promise<StartPaymentResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  if (!ruleFor(a.role, a.contract, "fund")) return fail(ACCESS_COPY.notAllowed, { stale: true });
  if (!limit(`gig-pay:${a.user.id}`, 20, HOUR_MS).ok) return fail(COPY.tooFast);

  const admin = adminClient();

  if (!isStripeConfigured) {
    if (!isPagosDemoPermitido) {
      console.error("[creadores:pago] Stripe sin configurar fuera de desarrollo local: no se permite el pago de demostración.");
      return fail(COPY.generic);
    }
    const moved = await moveStatus(admin, a.contract, "signed", {
      status: "funded",
      funded_at: new Date().toISOString(),
      payment_mode: "demo",
    });
    if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });
    await recordContractEvent(admin, {
      tenantId: a.contract.tenant_id,
      contractId,
      actorId: a.user.id,
      kind: "funded",
      meta: { demo: true },
    });
    return { ok: true, url: null, demo: true };
  }

  const escrow = await loadEscrowContract(admin, contractId);
  if (!escrow) return fail(ACCESS_COPY.notAllowed);
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const opened = await openGigCheckout({
      admin,
      stripe: getStripe(),
      contract: escrow,
      clientEmail: a.user.email ?? null,
      siteUrl,
    });
    if (!opened.ok) {
      if (opened.reason === "processing") return fail(COPY.paymentProcessing, { stale: true });
      if (opened.reason === "status") return fail(ACCESS_COPY.notAllowed, { stale: true });
      return fail(COPY.generic);
    }
    return { ok: true, url: opened.url, demo: false };
  } catch (error) {
    console.error("[creadores:pago] no se pudo abrir el pago", {
      contractId,
      message: error instanceof Error ? error.message : error,
    });
    return fail(COPY.generic);
  }
}

// ---------------------------------------------------------------------------
// Cancelación
// ---------------------------------------------------------------------------

const CANCELAR_CON_AVANCE =
  "El creador ya empezó a trabajar, así que no se puede cancelar. Si hay un problema con el trabajo, abrí una disputa y lo revisamos.";

export type CancelResult = { ok: true; refundPending: boolean } | Fail;

export async function cancelContract(contractId: string): Promise<CancelResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "cancel");
  if (!rule) return fail(ACCESS_COPY.notAllowed, { stale: true });

  const admin = adminClient();

  // Con el pago ya hecho, el negocio no puede cancelar y llevarse el 100% si el
  // creador ya avanzó: a partir de ahí el camino es la disputa, que congela la plata.
  if (a.role === "client" && rule.from === "funded") {
    const [hitos, entregas] = await Promise.all([
      db(admin)
        .from("gig_contract_milestones")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", contractId)
        .not("done_at", "is", null),
      db(admin)
        .from("job_deliverables")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", contractId),
    ]);
    if (hitos.error || entregas.error) return fail(COPY.generic);
    if ((hitos.count ?? 0) > 0 || (entregas.count ?? 0) > 0) return fail(CANCELAR_CON_AVANCE);
  }

  const moved = await moveStatus(admin, a.contract, rule.from, {
    status: "canceled",
    canceled_at: new Date().toISOString(),
    review_deadline_at: null,
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, { tenantId: a.contract.tenant_id, contractId, actorId: a.user.id, kind: "canceled" });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: counterpartOf(a.role, a.contract),
    contractId,
    title: "Se canceló una colaboración",
    body: `"${a.contract.title}" se canceló.`,
  });

  let refundPending = false;
  if (rule.from === "signed" && a.contract.stripe_checkout_session_id && isStripeConfigured) {
    try {
      await getStripe().checkout.sessions.expire(a.contract.stripe_checkout_session_id);
    } catch (error) {
      console.warn(
        `[creadores:pago] no se pudo expirar la session ${a.contract.stripe_checkout_session_id} al cancelar (${error instanceof Error ? error.message : error}). Si se paga igual, el webhook la reembolsa.`,
      );
    }
  }
  if (rule.from === "funded" && a.contract.stripe_payment_intent_id) {
    if (!isStripeConfigured) {
      refundPending = true;
    } else {
      const escrow = await loadEscrowContract(admin, contractId);
      const refund = escrow ? await refundCanceledContract(admin, getStripe(), escrow) : { ok: false };
      refundPending = !refund.ok;
    }
  }
  return { ok: true, refundPending };
}

// ---------------------------------------------------------------------------
// Hitos
// ---------------------------------------------------------------------------

const WORKING: ReadonlySet<string> = new Set(["funded", "changes_requested"]);

export async function addMilestone(contractId: string, rawTitle: string): Promise<SimpleResult> {
  const title = z.string().trim().min(2).max(80).safeParse(rawTitle);
  if (!title.success) return fail("El hito necesita entre 2 y 80 caracteres.");
  const a = await access(contractId);
  if (!a.ok) return a;
  if (a.role !== "creator" || !WORKING.has(a.contract.status)) return fail(ACCESS_COPY.notAllowed);

  const admin = adminClient();
  const { data: existing, error: readError } = await db(admin)
    .from("gig_contract_milestones")
    .select("position")
    .eq("contract_id", contractId)
    .order("position", { ascending: false })
    .limit(1);
  if (readError) return fail(COPY.generic);
  const last = ((existing ?? []) as { position: number }[])[0]?.position ?? -1;
  if (last >= 9) return fail(COPY.maxMilestones);

  const { error } = await db(admin).from("gig_contract_milestones").insert({
    tenant_id: a.contract.tenant_id,
    contract_id: contractId,
    title: title.data,
    position: last + 1,
  });
  if (error) {
    console.error("[creadores] no se pudo sumar el hito", { contractId, code: error.code });
    return fail(error.code === "23505" ? COPY.stale : COPY.generic, { stale: error.code === "23505" });
  }
  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "milestone_added",
    note: title.data,
  });
  return { ok: true };
}

export async function setMilestoneDone(
  contractId: string,
  milestoneId: string,
  done: boolean,
): Promise<SimpleResult> {
  if (!z.uuid().safeParse(milestoneId).success) return fail(ACCESS_COPY.notAllowed);
  const a = await access(contractId);
  if (!a.ok) return a;
  if (a.role !== "creator" || !WORKING.has(a.contract.status)) return fail(ACCESS_COPY.notAllowed);

  const admin = adminClient();
  const { data, error } = await db(admin)
    .from("gig_contract_milestones")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", milestoneId)
    .eq("contract_id", contractId)
    .eq("tenant_id", a.contract.tenant_id)
    .select("title");
  if (error) return fail(COPY.generic);
  const row = ((data ?? []) as { title: string }[])[0];
  if (!row) return fail(ACCESS_COPY.notAllowed);

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: done ? "milestone_done" : "milestone_undone",
    note: row.title,
  });
  if (done) {
    await notifyContractParty(admin, {
      tenantId: a.contract.tenant_id,
      profileId: a.contract.client_id,
      contractId,
      title: "Avanzó tu colaboración",
      body: `El creador completó: ${row.title}.`,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Entrega con archivos
// ---------------------------------------------------------------------------

const fileSchema = z.object({ name: z.string().min(1).max(200), size: z.number().int().positive(), type: z.string().max(120) });

export type PrepareUploadResult =
  | { ok: true; version: number; uploads: { path: string; token: string; name: string }[] }
  | Fail;

async function nextDeliveryVersion(admin: AdminClient, contractId: string): Promise<number | null> {
  const { data, error } = await db(admin)
    .from("job_deliverables")
    .select("version")
    .eq("contract_id", contractId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) return null;
  return (((data ?? []) as { version: number }[])[0]?.version ?? 0) + 1;
}

export async function prepareDeliveryUpload(
  contractId: string,
  rawFiles: z.input<typeof fileSchema>[],
): Promise<PrepareUploadResult> {
  const files = z.array(fileSchema).min(1).safeParse(rawFiles);
  if (!files.success) return fail(COPY.noFiles);
  if (files.data.length > MAX_FILES_PER_DELIVERY) return fail(COPY.tooManyFiles);
  if (!files.data.every((f) => isAllowedDeliveryFile(f))) return fail(COPY.fileType);

  const a = await access(contractId);
  if (!a.ok) return a;
  if (!ruleFor(a.role, a.contract, "deliver")) return fail(ACCESS_COPY.notAllowed, { stale: true });
  if (!limit(`gig-upload:${a.user.id}`, 60, HOUR_MS).ok) return fail(COPY.tooFast);

  const admin = adminClient();
  const version = await nextDeliveryVersion(admin, contractId);
  if (version === null) return fail(COPY.generic);

  const uploads: { path: string; token: string; name: string }[] = [];
  for (const file of files.data) {
    const path = deliveryObjectPath(a.contract.tenant_id, contractId, version, randomUUID(), file.name);
    const { data, error } = await admin.storage.from(DELIVERY_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[creadores:entrega] no se pudo preparar la subida", { contractId, message: error?.message });
      return fail(COPY.generic);
    }
    uploads.push({ path: data.path, token: data.token, name: file.name });
  }
  return { ok: true, version, uploads };
}

export async function submitDelivery(
  contractId: string,
  input: { version: number; paths: string[]; note: string },
): Promise<SimpleResult> {
  const note = z.string().trim().max(2000).safeParse(input.note ?? "");
  if (!note.success) return fail(COPY.generic);
  if (!Number.isInteger(input.version) || input.version < 1) return fail(COPY.badFiles);
  const paths = Array.from(new Set(input.paths));
  if (paths.length === 0) return fail(COPY.noFiles);
  if (paths.length > MAX_FILES_PER_DELIVERY) return fail(COPY.tooManyFiles);
  const contact = blockContactInfoIn([note.data]);
  if (!contact.ok) return fail(contact.message, { contactBlocked: true });

  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "deliver");
  if (!rule) return fail(ACCESS_COPY.notAllowed, { stale: true });

  const folder = deliveryFolder(a.contract.tenant_id, contractId, input.version);
  if (!paths.every((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes("/"))) {
    return fail(COPY.badFiles);
  }

  const admin = adminClient();
  const { data: listed, error: listError } = await admin.storage.from(DELIVERY_BUCKET).list(folder, { limit: 100 });
  if (listError) {
    console.error("[creadores:entrega] no se pudo verificar la subida", { contractId, message: listError.message });
    return fail(COPY.generic);
  }
  const present = new Set((listed ?? []).map((o) => `${folder}/${o.name}`));
  if (!paths.every((p) => present.has(p))) return fail(COPY.badFiles);

  const { error: insertError } = await db(admin).from("job_deliverables").insert({
    tenant_id: a.contract.tenant_id,
    contract_id: contractId,
    submitted_by: a.user.id,
    kind: "file",
    files: paths,
    note: note.data || null,
    version: input.version,
    is_final: false,
  });
  if (insertError) {
    console.error("[creadores:entrega] no se pudo registrar la entrega", { contractId, code: insertError.code });
    return fail(insertError.code === "23505" ? COPY.stale : COPY.generic, { stale: insertError.code === "23505" });
  }

  const now = new Date();
  const moved = await moveStatus(admin, a.contract, rule.from, {
    status: "delivered",
    delivered_at: now.toISOString(),
    review_deadline_at: reviewDeadlineFrom(now).toISOString(),
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "delivered",
    note: note.data || null,
    meta: { version: input.version, files: paths.length },
  });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: a.contract.client_id,
    contractId,
    title: "Te entregaron el trabajo",
    body: "Tenés 72 horas para revisarlo. Si no respondés, el pago se libera automáticamente.",
  });
  return { ok: true };
}

export type FileUrlResult = { ok: true; url: string } | Fail;

export async function deliveryFileUrl(contractId: string, path: string): Promise<FileUrlResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  if (!path.startsWith(`${a.contract.tenant_id}/${contractId}/`)) return fail(ACCESS_COPY.notAllowed);

  const admin = adminClient();
  const { data: rows, error } = await db(admin)
    .from("job_deliverables")
    .select("files")
    .eq("contract_id", contractId)
    .eq("tenant_id", a.contract.tenant_id);
  if (error) return fail(COPY.generic);
  const known = ((rows ?? []) as { files: string[] }[]).some((r) => r.files.includes(path));
  if (!known) return fail(ACCESS_COPY.notAllowed);

  const { data, error: signError } = await admin.storage.from(DELIVERY_BUCKET).createSignedUrl(path, 600);
  if (signError || !data) return fail(COPY.generic);
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Revisión de la entrega
// ---------------------------------------------------------------------------

export async function requestRevision(contractId: string, rawNote: string): Promise<SimpleResult> {
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return fail(COPY.noteShort);
  const contact = blockContactInfoIn([note.data]);
  if (!contact.ok) return fail(contact.message, { contactBlocked: true });

  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "request_revision");
  if (!rule) return fail(ACCESS_COPY.notAllowed, { stale: true });

  const admin = adminClient();
  const { count, error: countError } = await db(admin)
    .from("job_revisions")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);
  if (countError) return fail(COPY.generic);
  if (revisionsLeft(a.contract.revisions_included, count ?? 0) <= 0) return fail(COPY.noRevisions);

  const moved = await moveStatus(admin, a.contract, "delivered", {
    status: "changes_requested",
    changes_requested_at: new Date().toISOString(),
    review_deadline_at: null,
  });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  const { error: insertError } = await db(admin).from("job_revisions").insert({
    tenant_id: a.contract.tenant_id,
    contract_id: contractId,
    requested_by: a.user.id,
    note: note.data,
  });
  if (insertError) {
    console.error(
      `[creadores] ALERTA la revisión del contrato ${contractId} se pidió pero no se registró (code=${insertError.code}): el cupo de revisiones queda contando una menos.`,
    );
  }
  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "revision_requested",
    note: note.data,
  });
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: a.contract.creator_id,
    contractId,
    title: "Te pidieron una revisión",
    body: note.data.slice(0, 140),
  });
  return { ok: true };
}

export type ApproveResult = { ok: true; payout: PayoutResult["kind"] } | Fail;

export async function approveDelivery(contractId: string): Promise<ApproveResult> {
  const a = await access(contractId);
  if (!a.ok) return a;
  if (!ruleFor(a.role, a.contract, "approve")) return fail(ACCESS_COPY.notAllowed, { stale: true });

  const admin = adminClient();
  const escrow = await loadEscrowContract(admin, contractId);
  if (!escrow) return fail(ACCESS_COPY.notAllowed);
  try {
    const result = await approveDeliveryCore({
      admin,
      stripe: isStripeConfigured ? getStripe() : null,
      contract: escrow,
      via: "client",
      actorId: a.user.id,
    });
    if (!result.ok) return fail(COPY.stale, { stale: true });
    return { ok: true, payout: result.payout.kind };
  } catch (error) {
    console.error("[creadores] la aprobación falló", {
      contractId,
      message: error instanceof Error ? error.message : error,
    });
    return fail(COPY.generic);
  }
}

export async function openDispute(contractId: string, rawNote: string): Promise<SimpleResult> {
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return fail(COPY.noteShort);

  const a = await access(contractId);
  if (!a.ok) return a;
  const rule = ruleFor(a.role, a.contract, "dispute");
  if (!rule) return fail(ACCESS_COPY.notAllowed, { stale: true });

  const admin = adminClient();
  const moved = await moveStatus(admin, a.contract, rule.from, { status: "disputed", review_deadline_at: null });
  if (moved !== "ok") return fail(moved === "stale" ? COPY.stale : COPY.generic, { stale: moved === "stale" });

  await recordContractEvent(admin, {
    tenantId: a.contract.tenant_id,
    contractId,
    actorId: a.user.id,
    kind: "disputed",
    note: note.data,
  });
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: a.contract.tenant_id,
    actor_id: a.user.id,
    action: "gig_contract_disputed",
    subject_kind: "gig_contract",
    subject_id: contractId,
    meta: { code: a.contract.code, amount_cents: a.contract.amount_cents },
  });
  if (auditError) {
    console.error(`[creadores] la disputa de ${contractId} quedó abierta pero no llegó a auditoría — code=${auditError.code}.`);
  }
  await notifyContractParty(admin, {
    tenantId: a.contract.tenant_id,
    profileId: counterpartOf(a.role, a.contract),
    contractId,
    title: "Se abrió una disputa",
    body: "El pago queda retenido mientras el equipo de la comunidad revisa la colaboración.",
  });
  return { ok: true };
}

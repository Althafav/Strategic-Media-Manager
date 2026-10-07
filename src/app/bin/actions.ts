"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { emptyBin } from "@/lib/bin";
import { purgeRequest, restoreRequest } from "@/lib/requests";
import { purgeShare, restoreShare } from "@/lib/shares";

type Result = { error?: string };
const GONE = "Not in the bin any more. Someone may have restored or deleted it already.";

/** Runs an admin-only bin change, then refreshes the bin and the page the item lives on. */
async function binAction(run: () => Promise<boolean>, failure: string, alsoRevalidate?: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  try {
    if (!(await run())) return { error: GONE };
  } catch (e) {
    return { error: (e as Error).message || failure };
  }
  revalidatePath("/bin");
  if (alsoRevalidate) revalidatePath(alsoRevalidate, "layout");
  return {};
}

export async function restoreShareAction(id: string): Promise<Result> {
  return binAction(() => restoreShare(String(id)), "Could not restore the link.", "/shares");
}

export async function purgeShareAction(id: string): Promise<Result> {
  return binAction(() => purgeShare(String(id)), "Could not delete the link.");
}

export async function restoreRequestAction(id: string): Promise<Result> {
  return binAction(() => restoreRequest(String(id)), "Could not restore the request.", "/requests");
}

export async function purgeRequestAction(id: string): Promise<Result> {
  return binAction(() => purgeRequest(String(id)), "Could not delete the request.");
}

export async function emptyBinAction(): Promise<Result> {
  return binAction(async () => (await emptyBin(), true), "Could not empty the bin.");
}

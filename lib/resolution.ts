import type { Resolution } from "./conflicts";

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  replace: "replace the earlier decision",
  keep_both: "keep both decisions",
  needs_clarification: "mark it as needing clarification",
};

/**
 * Reads a spoken choice about a conflict. Deterministic on purpose (no model call), and it refuses
 * anything that sounds like an edit to a task so "replace Priya with Gowtham" is not a conflict choice.
 */
export function parseResolution(utterance: string): Resolution | null {
  const u = utterance.toLowerCase();
  if (/\b(task|tasks|owner|deadline|due|item|items|assign|assigned)\b/.test(u)) return null;
  if (/keep (them )?both|both (stay|are valid|apply)/.test(u)) return "keep_both";
  if (/needs? (some )?clarification|clarif|hold off|not sure yet|come back to (it|this)|review (it )?later/.test(u)) {
    return "needs_clarification";
  }
  if (/\b(replace|supersede|override)\b/.test(u) && /\b(earlier|previous|prior|old|decision|it|that)\b/.test(u)) return "replace";
  return null;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

/** "accept item 3 anyway" -> {items:[3]}; "accept them anyway" -> {items:"all"}. Null when not an acceptance. */
export function parseEvidenceAcceptance(utterance: string): { items: number[] | "all" } | null {
  const u = utterance.toLowerCase();
  if (!/\baccept\b/.test(u) || !/(anyway|without (the )?evidence|unverified|no evidence)/.test(u)) return null;
  const nums = [...u.matchAll(/\b(?:item|task)s?\s*(\d+)/g)].map((m) => Number(m[1]));
  for (const [word, n] of Object.entries(ORDINALS)) if (new RegExp(`\\b${word}\\b`).test(u)) nums.push(n);
  return { items: nums.length ? [...new Set(nums)] : "all" };
}

/** "proceed anyway" / "go ahead anyway": the user chooses to continue while a decision is under review. */
export function parseProceedAnyway(utterance: string): boolean {
  const u = utterance.toLowerCase();
  return /\b(proceed|go ahead|continue|create (them|the tasks|those))\b.*\banyway\b/.test(u) || /\banyway\b.*\b(proceed|go ahead|continue)\b/.test(u);
}

const PLAIN_APPROVALS = new Set([
  "confirm", "confirmed", "yes", "yep", "yeah", "ok", "okay", "yes confirm", "yes please", "confirm it",
  "looks good", "yes looks good", "looks good confirm", "looks good to me", "go ahead", "yes go ahead",
  "create them", "create the tasks", "create those", "do it", "thats right", "yes thats right",
]);

/** An unmistakable, exact approval. Handled without a model call, so approving costs no quota. */
export function isPlainApproval(utterance: string): boolean {
  return PLAIN_APPROVALS.has(utterance.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim());
}

/** "the second conflict" -> 1. Null when no ordinal is spoken (the choice then applies to all open conflicts). */
export function parseConflictIndex(utterance: string): number | null {
  const u = utterance.toLowerCase();
  if (/\b(first|1st)\b/.test(u)) return 0;
  if (/\b(second|2nd)\b/.test(u)) return 1;
  if (/\b(third|3rd)\b/.test(u)) return 2;
  return null;
}

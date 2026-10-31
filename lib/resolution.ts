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

/** "the second conflict" -> 1. Null when no ordinal is spoken (the choice then applies to all open conflicts). */
export function parseConflictIndex(utterance: string): number | null {
  const u = utterance.toLowerCase();
  if (/\b(first|1st)\b/.test(u)) return 0;
  if (/\b(second|2nd)\b/.test(u)) return 1;
  if (/\b(third|3rd)\b/.test(u)) return 2;
  return null;
}

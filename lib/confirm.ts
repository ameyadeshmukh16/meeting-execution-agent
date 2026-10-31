import { z } from "zod";
import { completeJson } from "./llm";

// New fields are optional/lenient on purpose: a weak model reply should degrade (no evidence shown)
// rather than fail validation, and older saved records without them must keep working.
export const EvidenceSchema = z.object({
  quote: z.string(),
  speaker: z.string().optional().catch(undefined),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const Ownership = z.enum(["accepted", "assigned", "unclear"]);

export const ActionItemSchema = z.object({
  task: z.string(),
  owner: z.string().nullish().transform((v) => v ?? null),
  deadline: z.string().nullish().transform((v) => v ?? null), // ISO date YYYY-MM-DD or null
  deadlineText: z.string().nullable().optional(),
  ownership: Ownership.optional().catch(undefined),
  evidence: EvidenceSchema.optional().catch(undefined),
  /** Set by the server: true only when the quote is found verbatim in the transcript. */
  evidenceVerified: z.boolean().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

/** An item needs a human to settle who owns it before anything is created. */
export const needsOwner = (a: Pick<ActionItem, "owner" | "ownership">) => !a.owner || a.ownership === "unclear";

const ReplySchema = z.object({
  intent: z.enum(["confirm", "edit", "cancel"]),
  actionItems: z.array(ActionItemSchema),
  reply: z.string(),
});
export type ConfirmResult = z.infer<typeof ReplySchema>;

const SYSTEM = `You handle a spoken confirmation step. The user has just heard a read-back of numbered action items extracted from a meeting and now speaks a response (dictated, so expect filler words and minor transcription errors).
Reply with ONLY a JSON object: {"intent":"confirm"|"edit"|"cancel","actionItems":[...],"reply":string}

- intent "confirm": the user approves as-is ("yes", "looks good", "create them"). Return actionItems unchanged.
- intent "edit": the user changes something. Apply ONLY the requested change(s) and return the FULL updated list. Items are referred to by position ("the second deadline", "item 3", "Priya's task"). Supported edits: change deadline, owner or task text; remove an item; add an item. Resolve relative dates ("Friday") to an ISO date after the meeting date, as the nearest upcoming day after the meeting date. Update deadlineText to match the new phrase.
- When the user states or confirms who owns an item (e.g. "Priya owns the cache one", "assign the third to Gowtham"), set that item's owner and set its "ownership" to "assigned".
- intent "cancel": the user wants to discard everything. Return actionItems unchanged.
- Each action item keeps ALL its existing fields (task, owner, deadline, deadlineText, ownership, evidence). Change only what the user asked to change.
- reply is one short spoken sentence confirming what you did and asking for final confirmation when intent is "edit" (e.g. "Done, task 2 is now due Friday, October 30. Anything else?"). For "confirm" say you are creating the tasks. For "cancel" say nothing was created.`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Models sometimes drop fields they were told to keep; restore evidence from the item they edited. */
function carryOver(next: ActionItem[], prev: ActionItem[]): ActionItem[] {
  return next.map((item) => {
    const old = prev.find((p) => norm(p.task) === norm(item.task));
    if (!old) return item;
    const ownerChanged = !!item.owner && item.owner !== old.owner;
    return {
      ...item,
      evidence: item.evidence ?? old.evidence,
      evidenceVerified: old.evidenceVerified,
      ownership: ownerChanged ? "assigned" : (item.ownership ?? old.ownership),
    };
  });
}

export async function interpretResponse(
  utterance: string,
  actionItems: ActionItem[],
  meetingDate: string,
): Promise<ConfirmResult> {
  const numbered = actionItems.map((a, i) => ({ position: i + 1, ...a }));
  const r = await completeJson(
    SYSTEM,
    `Meeting date: ${meetingDate}\n\nCurrent action items:\n${JSON.stringify(numbered, null, 1)}\n\nUser said: "${utterance}"`,
    ReplySchema,
  );
  return { ...r, actionItems: carryOver(r.actionItems, actionItems) };
}

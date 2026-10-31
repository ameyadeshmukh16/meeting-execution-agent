import { z } from "zod";
import { completeJson } from "./llm";

export const ActionItemSchema = z.object({
  task: z.string(),
  owner: z.string(),
  deadline: z.string().nullable(), // ISO date YYYY-MM-DD or null
  deadlineText: z.string().nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

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
- intent "cancel": the user wants to discard everything. Return actionItems unchanged.
- Each action item keeps the shape {"task":string,"owner":string,"deadline":"YYYY-MM-DD"|null,"deadlineText":string|null}.
- reply is one short spoken sentence confirming what you did and asking for final confirmation when intent is "edit" (e.g. "Done, task 2 is now due Friday, October 30. Anything else?"). For "confirm" say you are creating the tasks. For "cancel" say nothing was created.`;

export async function interpretResponse(
  utterance: string,
  actionItems: ActionItem[],
  meetingDate: string,
): Promise<ConfirmResult> {
  const numbered = actionItems.map((a, i) => ({ position: i + 1, ...a }));
  return completeJson(
    SYSTEM,
    `Meeting date: ${meetingDate}\n\nCurrent action items:\n${JSON.stringify(numbered, null, 1)}\n\nUser said: "${utterance}"`,
    ReplySchema,
  );
}

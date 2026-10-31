import { z } from "zod";
import { ActionItemSchema, EvidenceSchema, type ActionItem, type Evidence } from "./confirm";
import { completeJson } from "./llm";

const DecisionSchema = z.object({
  text: z.string(),
  madeBy: z.string().optional().catch(undefined),
  topic: z.string().optional().catch(undefined),
  evidence: EvidenceSchema.optional().catch(undefined),
});
export type Decision = z.infer<typeof DecisionSchema> & { evidenceVerified?: boolean };

export const ExtractionSchema = z.object({
  decisions: z.array(DecisionSchema),
  actionItems: z.array(ActionItemSchema),
});
export type Extraction = { decisions: Decision[]; actionItems: ActionItem[] };

const SYSTEM = `You extract structured data from engineering standup / sprint planning transcripts.
Lines are speaker-tagged ("Name: text"). Reply with ONLY a JSON object:
{"decisions":[{"text":string,"topic":string,"madeBy":string,"evidence":{"quote":string,"speaker":string}}],
 "actionItems":[{"task":string,"owner":string|null,"ownership":"accepted"|"assigned"|"unclear","deadline":"YYYY-MM-DD"|null,"deadlineText":string|null,"evidence":{"quote":string,"speaker":string}}]}

Rules:
- A decision is a choice the team commits to (technology, process, policy). Not tasks. Questions, "maybe" talk and "let's not decide now" are NOT decisions.
- topic is a 2-4 word noun phrase naming what the decision is about (e.g. "billing database").
- SELF-CORRECTIONS: when a speaker revises themselves ("use X... actually no, Y instead"), only the FINAL choice (Y) counts. Never output X.
- EVIDENCE: quote must be copied WORD FOR WORD from the transcript, the one sentence that best supports the item, without the "Name:" prefix. speaker is who said it. Never paraphrase or invent a quote.
- OWNERSHIP, never guess an owner. Use the speaker's first name as written.
  * "accepted": the person explicitly took the task ("I'll take it", "Sure, Thursday", "I'll write it by Monday").
  * "assigned": someone was directly given the task and did not object.
  * "unclear": the person only offered to investigate or hedged ("I can look into it", "maybe", "no promises"). Set owner to that person.
  * If nobody took the task or was given it ("we really need to X at some point"), set owner to null and ownership to "unclear".
- Resolve relative deadlines ("Wednesday", "next Monday", "by Friday") to an ISO date using the meeting date provided. "Wednesday" means the next upcoming Wednesday after the meeting date. "next Monday" is the first Monday after the meeting date.
- If the deadline is vague ("soon", "sometime this month"), deadline is null. Keep deadlineText as the phrase spoken.
- Write each task as a short imperative title under 8 words (e.g. "Set up Mongo for billing", "Write invoice migration plan"). No owner name, no deadline, no filler.
- Do not invent items. Output decisions as complete standalone sentences.`;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** No-LLM grounding check: a quote counts as evidence only if it appears in the transcript. */
function verify(transcript: string, evidence: Evidence | undefined): boolean {
  if (!evidence?.quote) return false;
  const q = normalize(evidence.quote);
  return q.length >= 8 && normalize(transcript).includes(q);
}

export async function extract(transcript: string, meetingDate: string): Promise<Extraction> {
  const weekday = new Date(`${meetingDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const raw = await completeJson(
    SYSTEM,
    `Meeting date: ${meetingDate} (${weekday})\n\nTranscript:\n${transcript}`,
    ExtractionSchema,
  );
  return {
    decisions: raw.decisions.map((d) => ({ ...d, evidenceVerified: verify(transcript, d.evidence) })),
    actionItems: raw.actionItems.map((a) => ({ ...a, evidenceVerified: verify(transcript, a.evidence) })),
  };
}

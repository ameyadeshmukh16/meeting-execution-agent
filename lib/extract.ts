import { z } from "zod";
import { completeJson } from "./llm";

export const ExtractionSchema = z.object({
  decisions: z.array(z.object({ text: z.string(), madeBy: z.string().optional() })),
  actionItems: z.array(
    z.object({
      task: z.string(),
      owner: z.string(),
      deadline: z.string().nullable(), // ISO date YYYY-MM-DD or null
      deadlineText: z.string().nullable().optional(), // what was actually said
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You extract structured data from engineering standup / sprint planning transcripts.
Lines are speaker-tagged ("Name: text"). Reply with ONLY a JSON object:
{"decisions":[{"text":string,"madeBy":string}],"actionItems":[{"task":string,"owner":string,"deadline":"YYYY-MM-DD"|null,"deadlineText":string|null}]}

Rules:
- A decision is a choice the team commits to (technology, process, policy). Not tasks, not discussion.
- SELF-CORRECTIONS: when a speaker revises themselves ("use X... actually no, Y instead"), only the FINAL choice (Y) counts. Never output X.
- An action item has an owner (the person who agreed to do it, or was assigned and did not object) and a task. Use the speaker's first name as written.
- Resolve relative deadlines ("Wednesday", "next Monday", "by Friday") to an ISO date using the meeting date provided. "Wednesday" means the next upcoming Wednesday after the meeting date. "next Monday" is the first Monday after the meeting date.
- Write each task as a short imperative title under 8 words (e.g. "Set up Mongo for billing", "Write invoice migration plan"). No owner name, no deadline, no filler.
- Keep deadlineText as the phrase spoken. If no deadline was given, deadline is null.
- Do not invent items. Output decisions as complete standalone sentences.`;

export async function extract(transcript: string, meetingDate: string): Promise<Extraction> {
  const weekday = new Date(`${meetingDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return completeJson(
    SYSTEM,
    `Meeting date: ${meetingDate} (${weekday})\n\nTranscript:\n${transcript}`,
    ExtractionSchema,
  );
}

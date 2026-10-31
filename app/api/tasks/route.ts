import { randomUUID } from "node:crypto";
import { ActionItemSchema } from "@/lib/confirm";
import { recordDecisions, resetLearnedDecisions } from "@/lib/conflicts";
import { loadItems, saveItems, type StoredItem } from "@/lib/store";
import { createCard, trelloConfigured } from "@/lib/trello";
import { z } from "zod";

const BodySchema = z.object({
  meeting: z.string(),
  meetingDate: z.string(),
  actionItems: z.array(ActionItemSchema),
  decisions: z.array(z.object({ text: z.string(), supersedes: z.string().optional() })).default([]),
});

export async function GET() {
  return Response.json({ items: await loadItems() });
}

/** Called only after the user has confirmed: persists items and creates Trello cards. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { meeting, meetingDate, actionItems, decisions } = parsed.data;

  const created: StoredItem[] = [];
  const errors: string[] = [];
  for (const item of actionItems) {
    const stored: StoredItem = { ...item, id: randomUUID(), meeting, meetingDate };
    if (trelloConfigured()) {
      try {
        stored.trelloUrl = (await createCard(item, meeting)).url;
      } catch (e) {
        errors.push(`${item.task}: ${String(e)}`);
      }
    }
    created.push(stored);
  }
  await saveItems([...(await loadItems()), ...created]);
  await recordDecisions(meeting, meetingDate, decisions);
  return Response.json({ items: created, trello: trelloConfigured(), errors });
}

/** Demo reset: forget confirmed tasks and learned decisions. Does not touch Trello. */
export async function DELETE() {
  await saveItems([]);
  await resetLearnedDecisions();
  return Response.json({ ok: true });
}

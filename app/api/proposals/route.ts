import { z } from "zod";
import { ActionItemSchema } from "@/lib/confirm";
import { createProposal } from "@/lib/proposals";

const BodySchema = z.object({
  meeting: z.string(),
  meetingDate: z.string(),
  actionItems: z.array(ActionItemSchema),
  decisions: z.array(z.object({ text: z.string(), supersedes: z.string().optional() })).default([]),
});

/** Registers what the user is about to review. Nothing is executed until it is approved. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { meeting, meetingDate, actionItems, decisions } = parsed.data;
  const p = await createProposal({ meeting, meetingDate, items: actionItems, decisions });
  return Response.json({ approvalId: p.approvalId });
}

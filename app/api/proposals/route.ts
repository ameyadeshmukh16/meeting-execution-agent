import { z } from "zod";
import { ActionItemSchema, EvidenceSchema } from "@/lib/confirm";
import { createProposal, getProposal, updateProposal, withLock } from "@/lib/proposals";

const BodySchema = z.object({
  meeting: z.string(),
  meetingDate: z.string(),
  actionItems: z.array(ActionItemSchema),
  decisions: z
    .array(z.object({ text: z.string(), topic: z.string().optional(), evidence: EvidenceSchema.optional() }))
    .default([]),
  conflicts: z.array(z.object({ newDecision: z.string(), conflictsWithId: z.string() })).default([]),
});

/** Registers what the user is about to review. Nothing is executed until it is approved. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { meeting, meetingDate, actionItems, decisions, conflicts } = parsed.data;
  const p = await createProposal({ meeting, meetingDate, items: actionItems, decisions, conflicts });
  return Response.json({ approvalId: p.approvalId });
}

const ResolveSchema = z.object({
  approvalId: z.string(),
  index: z.number().int().min(0),
  resolution: z.enum(["replace", "keep_both", "needs_clarification"]),
});

/** Records the user's explicit choice for one conflict. Changing a choice revokes any earlier approval. */
export async function PATCH(req: Request) {
  const parsed = ResolveSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { approvalId, index, resolution } = parsed.data;
  return withLock(approvalId, async () => {
    const p = await getProposal(approvalId);
    if (!p) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
    if (p.status === "executed") return Response.json({ error: "Already executed" }, { status: 409 });
    if (index >= p.conflicts.length) return Response.json({ error: "No such conflict" }, { status: 400 });
    const next = await updateProposal(approvalId, {
      resolutions: { ...p.resolutions, [String(index)]: resolution },
      status: "pending",
      approvedAt: undefined,
      approvalUtterance: undefined,
    });
    return Response.json({ resolutions: next?.resolutions ?? {} });
  });
}

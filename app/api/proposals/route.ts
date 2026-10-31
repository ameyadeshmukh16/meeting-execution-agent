import { z } from "zod";
import { ActionItemSchema, EvidenceSchema } from "@/lib/confirm";
import { isEvidenceAccepted } from "@/lib/gate";
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

// The same three human decisions that can be spoken, available as buttons.
const PatchSchema = z.union([
  z.object({ approvalId: z.string(), index: z.number().int().min(0), resolution: z.enum(["replace", "keep_both", "needs_clarification"]) }),
  z.object({ approvalId: z.string(), acceptEvidence: z.number().int().min(0) }),
  z.object({ approvalId: z.string(), acknowledgeReview: z.literal(true) }),
]);

/** Records an explicit human decision. Any change revokes an earlier approval. */
export async function PATCH(req: Request) {
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const body = parsed.data;
  return withLock(body.approvalId, async () => {
    const p = await getProposal(body.approvalId);
    if (!p) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
    if (p.status === "executed") return Response.json({ error: "Already executed" }, { status: 409 });
    const revoke = { status: "pending" as const, approvedAt: undefined, approvalUtterance: undefined };

    let patch: Parameters<typeof updateProposal>[1];
    if ("resolution" in body) {
      if (body.index >= p.conflicts.length) return Response.json({ error: "No such conflict" }, { status: 400 });
      // A changed choice means any earlier "proceed anyway" no longer applies.
      patch = { resolutions: { ...p.resolutions, [String(body.index)]: body.resolution }, acknowledgedReview: undefined, ...revoke };
    } else if ("acceptEvidence" in body) {
      const item = p.items[body.acceptEvidence];
      if (!item) return Response.json({ error: "No such item" }, { status: 400 });
      if (item.evidenceVerified || isEvidenceAccepted(p, item)) return Response.json({ error: "Nothing to accept" }, { status: 400 });
      patch = { evidenceAccepted: [...(p.evidenceAccepted ?? []), { task: item.task, at: new Date().toISOString() }], ...revoke };
    } else {
      if (!Object.values(p.resolutions).includes("needs_clarification")) return Response.json({ error: "No decision is under review" }, { status: 400 });
      patch = { acknowledgedReview: { at: new Date().toISOString() }, ...revoke };
    }
    const next = (await updateProposal(body.approvalId, patch))!;
    return Response.json({
      resolutions: next.resolutions,
      evidenceAccepted: next.evidenceAccepted ?? [],
      acknowledgedReview: !!next.acknowledgedReview,
    });
  });
}

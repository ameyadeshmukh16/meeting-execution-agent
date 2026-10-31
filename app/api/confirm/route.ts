import { interpretResponse } from "@/lib/confirm";
import { approvalBlockers, blockerReply, isEvidenceAccepted } from "@/lib/gate";
import { getProposal, updateProposal, withLock, type Proposal } from "@/lib/proposals";
import {
  isPlainApproval,
  parseConflictIndex,
  parseEvidenceAcceptance,
  parseProceedAnyway,
  parseResolution,
  RESOLUTION_LABEL,
} from "@/lib/resolution";

/** Any change to what is being reviewed revokes an earlier approval. */
const REVOKE = { status: "pending" as const, approvedAt: undefined, approvalUtterance: undefined };

const snapshot = (p: Proposal) => ({
  actionItems: p.items,
  resolutions: p.resolutions,
  evidenceAccepted: p.evidenceAccepted ?? [],
  acknowledgedReview: !!p.acknowledgedReview,
});

const list = (n: number[]) => (n.length === 1 ? `item ${n[0]}` : `items ${n.join(" and ")}`);

/** Interprets the user's spoken response against the stored proposal. Approval is decided here, server-side. */
export async function POST(req: Request) {
  const { approvalId, utterance } = await req.json();
  if (!approvalId || !utterance) {
    return Response.json({ error: "approvalId and utterance are required" }, { status: 400 });
  }
  try {
    return await withLock(approvalId, async () => {
      let p = await getProposal(approvalId);
      if (!p) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
      if (p.status === "executed") return Response.json({ error: "Already executed" }, { status: 409 });

      // 1. Explicitly accepting a task whose transcript evidence is missing or unverified. Recorded, never silent.
      const acceptance = parseEvidenceAcceptance(utterance);
      if (acceptance) {
        const open = p.items.flatMap((a, i) => (a.evidenceVerified || isEvidenceAccepted(p!, a) ? [] : [i]));
        const targets = acceptance.items === "all" ? open : acceptance.items.map((n) => n - 1).filter((i) => i >= 0 && i < p!.items.length && open.includes(i));
        if (!targets.length) {
          return Response.json({ intent: "resolved", reply: "There is nothing to accept: every item already has verified evidence or was accepted.", ...snapshot(p) });
        }
        const at = new Date().toISOString();
        p = (await updateProposal(approvalId, {
          evidenceAccepted: [...(p.evidenceAccepted ?? []), ...targets.map((i) => ({ task: p!.items[i].task, at }))],
          ...REVOKE,
        }))!;
        const reply = `Okay, I'll accept ${list(targets.map((i) => i + 1))} without verified evidence, and record that. Say confirm when you're ready.`;
        return Response.json({ intent: "resolved", reply, ...snapshot(p) });
      }

      // 2. Choosing to continue while a decision is left under review.
      if (parseProceedAnyway(utterance) && Object.values(p.resolutions).includes("needs_clarification")) {
        p = (await updateProposal(approvalId, { acknowledgedReview: { at: new Date().toISOString(), utterance }, ...REVOKE }))!;
        return Response.json({ intent: "resolved", reply: "Okay, I'll proceed while that decision stays under review, and note it. Say confirm to create the tasks.", ...snapshot(p) });
      }

      // 3. A spoken choice about a conflict ("replace the earlier decision", "keep both") needs no model call.
      const choice = p.conflicts.length ? parseResolution(utterance) : null;
      if (choice) {
        const only = parseConflictIndex(utterance);
        const open = p.conflicts.flatMap((_, i) => (p!.resolutions[String(i)] ? [] : [i]));
        const targets = only !== null && only < p.conflicts.length ? [only] : open.length ? open : p.conflicts.map((_, i) => i);
        const resolutions = { ...p.resolutions, ...Object.fromEntries(targets.map((i) => [String(i), choice])) };
        // A changed choice means any earlier "proceed anyway" no longer applies.
        p = (await updateProposal(approvalId, { resolutions, acknowledgedReview: undefined, ...REVOKE }))!;
        const left = p.conflicts.length - Object.keys(resolutions).length;
        const reply = `Okay, I'll ${RESOLUTION_LABEL[choice]}. ${left > 0 ? "Please choose for the remaining conflict." : "Say confirm to create the tasks."}`;
        return Response.json({ intent: "resolved", reply, ...snapshot(p) });
      }

      // 4. Exact plain approvals are decided without a model; everything else is interpreted by the model.
      let intent: "confirm" | "edit" | "cancel";
      let reply: string;
      if (isPlainApproval(utterance)) {
        intent = "confirm";
        reply = "Okay, creating the tasks now.";
      } else {
        const r = await interpretResponse(utterance, p.items, p.meetingDate);
        intent = r.intent;
        reply = r.reply;
        if (r.intent === "edit") {
          p = (await updateProposal(approvalId, { items: r.actionItems, ...REVOKE }))!;
        }
      }

      if (intent === "confirm") {
        // Never turn an uncertain interpretation into a commitment, a replaced decision, or an ungrounded task.
        const blockers = approvalBlockers(p);
        if (blockers.any) return Response.json({ intent: "blocked", reply: blockerReply(blockers), ...snapshot(p) });
        p = (await updateProposal(approvalId, { status: "approved", approvedAt: new Date().toISOString(), approvalUtterance: utterance }))!;
      }
      // The stored items win over whatever list the model echoed back.
      return Response.json({ intent, reply, ...snapshot(p) });
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

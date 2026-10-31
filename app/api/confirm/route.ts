import { interpretResponse, needsOwner } from "@/lib/confirm";
import { getProposal, updateProposal, withLock } from "@/lib/proposals";

/** Interprets the user's spoken response against the stored proposal. Approval is decided here, server-side. */
export async function POST(req: Request) {
  const { approvalId, utterance } = await req.json();
  if (!approvalId || !utterance) {
    return Response.json({ error: "approvalId and utterance are required" }, { status: 400 });
  }
  try {
    return await withLock(approvalId, async () => {
      const proposal = await getProposal(approvalId);
      if (!proposal) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
      if (proposal.status === "executed") return Response.json({ error: "Already executed" }, { status: 409 });

      const r = await interpretResponse(utterance, proposal.items, proposal.meetingDate);
      let items = proposal.items;
      if (r.intent === "edit") {
        // Any edit revokes an earlier approval: what gets executed must be what was last reviewed.
        items = r.actionItems;
        await updateProposal(approvalId, { items, status: "pending", approvedAt: undefined, approvalUtterance: undefined });
      } else if (r.intent === "confirm") {
        // Never turn an uncertain interpretation into a commitment: someone must settle each owner first.
        const open = items.flatMap((a, i) => (needsOwner(a) ? [i + 1] : []));
        if (open.length > 0) {
          const list = open.length === 1 ? `Item ${open[0]} doesn't` : `Items ${open.join(" and ")} don't`;
          const reply = `${list} have a confirmed owner yet. Tell me who owns ${open.length === 1 ? "it" : "them"}, or say remove ${open.length === 1 ? "that item" : "those items"}.`;
          return Response.json({ intent: "blocked", reply, actionItems: items });
        }
        await updateProposal(approvalId, { status: "approved", approvedAt: new Date().toISOString(), approvalUtterance: utterance });
      }
      // On confirm/cancel the stored items win over whatever list the model echoed back.
      return Response.json({ intent: r.intent, reply: r.reply, actionItems: items });
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

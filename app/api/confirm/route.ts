import { interpretResponse, needsOwner } from "@/lib/confirm";
import { getProposal, updateProposal, withLock } from "@/lib/proposals";
import { parseConflictIndex, parseResolution, RESOLUTION_LABEL } from "@/lib/resolution";

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

      // A spoken choice about a conflict ("replace the earlier decision", "keep both") needs no model call.
      const choice = proposal.conflicts.length ? parseResolution(utterance) : null;
      if (choice) {
        const only = parseConflictIndex(utterance);
        const open = proposal.conflicts.flatMap((_, i) => (proposal.resolutions[String(i)] ? [] : [i]));
        const targets = only !== null && only < proposal.conflicts.length ? [only] : open.length ? open : proposal.conflicts.map((_, i) => i);
        const resolutions = { ...proposal.resolutions, ...Object.fromEntries(targets.map((i) => [String(i), choice])) };
        await updateProposal(approvalId, { resolutions, status: "pending", approvedAt: undefined, approvalUtterance: undefined });
        const left = proposal.conflicts.length - Object.keys(resolutions).length;
        const reply = `Okay, I'll ${RESOLUTION_LABEL[choice]}. ${left > 0 ? "Please choose for the remaining conflict." : "Say confirm to create the tasks."}`;
        return Response.json({ intent: "resolved", reply, actionItems: proposal.items, resolutions });
      }

      const r = await interpretResponse(utterance, proposal.items, proposal.meetingDate);
      let items = proposal.items;
      if (r.intent === "edit") {
        // Any edit revokes an earlier approval: what gets executed must be what was last reviewed.
        items = r.actionItems;
        await updateProposal(approvalId, { items, status: "pending", approvedAt: undefined, approvalUtterance: undefined });
      } else if (r.intent === "confirm") {
        // Never turn an uncertain interpretation into a commitment or a replaced decision.
        const unresolved = proposal.conflicts.flatMap((_, i) => (proposal.resolutions[String(i)] ? [] : [i + 1]));
        const noOwner = items.flatMap((a, i) => (needsOwner(a) ? [i + 1] : []));
        if (unresolved.length || noOwner.length) {
          const parts: string[] = [];
          if (unresolved.length) {
            parts.push(
              `Before I can create tasks, choose what to do about ${unresolved.length === 1 ? "the conflict" : "the conflicts"}: replace the earlier decision, keep both, or needs clarification.`,
            );
          }
          if (noOwner.length) {
            const list = noOwner.length === 1 ? `Item ${noOwner[0]} doesn't` : `Items ${noOwner.join(" and ")} don't`;
            parts.push(`${list} have a confirmed owner yet. Tell me who owns ${noOwner.length === 1 ? "it" : "them"}, or say remove ${noOwner.length === 1 ? "that item" : "those items"}.`);
          }
          return Response.json({ intent: "blocked", reply: parts.join(" "), actionItems: items, resolutions: proposal.resolutions });
        }
        await updateProposal(approvalId, { status: "approved", approvedAt: new Date().toISOString(), approvalUtterance: utterance });
      }
      // On confirm/cancel the stored items win over whatever list the model echoed back.
      return Response.json({ intent: r.intent, reply: r.reply, actionItems: items, resolutions: proposal.resolutions });
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

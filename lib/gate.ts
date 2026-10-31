import { needsOwner, type ActionItem } from "./confirm";
import type { Proposal } from "./proposals";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Acceptance is keyed by task text, so editing a task's wording asks for acceptance again. */
export const isEvidenceAccepted = (p: Pick<Proposal, "evidenceAccepted">, item: ActionItem) =>
  (p.evidenceAccepted ?? []).some((a) => norm(a.task) === norm(item.task));

/** Everything that must be settled by a human before a proposal can be approved. Numbers are 1-based. */
export function approvalBlockers(p: Proposal) {
  const unresolved = p.conflicts.flatMap((_, i) => (p.resolutions[String(i)] ? [] : [i + 1]));
  const review = Object.values(p.resolutions).includes("needs_clarification") && !p.acknowledgedReview;
  const noOwner = p.items.flatMap((a, i) => (needsOwner(a) ? [i + 1] : []));
  const evidence = p.items.flatMap((a, i) => (a.evidenceVerified || isEvidenceAccepted(p, a) ? [] : [i + 1]));
  return { unresolved, review, noOwner, evidence, any: unresolved.length > 0 || review || noOwner.length > 0 || evidence.length > 0 };
}

const items = (n: number[]) => (n.length === 1 ? `Item ${n[0]}` : `Items ${n.join(" and ")}`);

/** One spoken explanation covering every open blocker. */
export function blockerReply(b: ReturnType<typeof approvalBlockers>): string {
  const parts: string[] = [];
  if (b.unresolved.length) {
    parts.push(
      `Before I can create tasks, choose what to do about ${b.unresolved.length === 1 ? "the conflict" : "the conflicts"}: replace the earlier decision, keep both, or needs clarification.`,
    );
  }
  if (b.review) {
    parts.push("A decision is left under review. Say proceed anyway to create the tasks while it stays unresolved, or change your choice.");
  }
  if (b.noOwner.length) {
    parts.push(
      `${items(b.noOwner)} ${b.noOwner.length === 1 ? "doesn't" : "don't"} have a confirmed owner yet. Tell me who owns ${b.noOwner.length === 1 ? "it" : "them"}, or say remove ${b.noOwner.length === 1 ? "that item" : "those items"}.`,
    );
  }
  if (b.evidence.length) {
    parts.push(
      `${items(b.evidence)} ${b.evidence.length === 1 ? "has" : "have"} no verified transcript evidence. Say accept ${b.evidence.length === 1 ? `item ${b.evidence[0]}` : "them"} anyway, or remove ${b.evidence.length === 1 ? "it" : "them"}.`,
    );
  }
  return parts.join(" ");
}

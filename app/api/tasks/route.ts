import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clearProposals, getProposal, updateProposal, withLock } from "@/lib/proposals";
import { recordDecisions, resetLearnedDecisions } from "@/lib/conflicts";
import { loadItems, saveItems, type StoredItem } from "@/lib/store";
import { archiveCard, createCard, hasRef, listCards, trelloConfigured } from "@/lib/trello";

const BodySchema = z.object({ approvalId: z.string() });

/** Tasks that exist (failed attempts are not tasks). Older records have no status and were all created. */
export async function GET() {
  return Response.json({ items: (await loadItems()).filter((i) => i.status !== "failed") });
}

/**
 * Executes an approved proposal. Idempotent per item (`approvalId:index`): items already created are
 * never created again, so a double-click or a Retry only creates what is missing.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "approvalId is required" }, { status: 400 });
  const { approvalId } = parsed.data;

  return withLock(approvalId, async () => {
    const proposal = await getProposal(approvalId);
    if (!proposal) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
    if (proposal.status === "pending") return Response.json({ error: "Not approved yet" }, { status: 403 });
    // Defence in depth: approval should already require this, but never execute with an open conflict.
    if (proposal.conflicts.some((_, i) => !proposal.resolutions[String(i)])) {
      return Response.json({ error: "Unresolved conflicts" }, { status: 403 });
    }

    const all = await loadItems();
    const previous = new Map(all.filter((i) => i.key?.startsWith(`${approvalId}:`)).map((i) => [i.key!, i]));
    const { meeting, meetingDate } = proposal;

    let boardCards: Awaited<ReturnType<typeof listCards>> | null = null;
    let createdNow = 0;
    const results: StoredItem[] = [];

    for (const [i, item] of proposal.items.entries()) {
      const key = `${approvalId}:${i}`;
      const prev = previous.get(key);
      if (prev && prev.status !== "failed") {
        results.push(prev);
        continue;
      }
      const stored: StoredItem = { ...item, id: prev?.id ?? randomUUID(), key, meeting, meetingDate, status: "created" };
      if (trelloConfigured()) {
        try {
          // A previous attempt may have created the card but lost the response: look before creating.
          let existing: { shortUrl: string } | undefined;
          if (prev) {
            boardCards ??= await listCards().catch(() => []);
            existing = boardCards.find((c) => hasRef(c, key));
          }
          stored.trelloUrl = existing ? existing.shortUrl : (await createCard(item, meeting, key)).url;
          if (!existing) createdNow++;
        } catch (e) {
          stored.status = "failed";
          stored.error = String(e).slice(0, 300);
        }
      }
      results.push(stored);
    }

    const keys = new Set(results.map((r) => r.key));
    await saveItems([...all.filter((i) => !i.key || !keys.has(i.key)), ...results]);
    // Only an explicit "replace" retires an earlier decision; the other choices keep it in force.
    await recordDecisions(
      meeting,
      meetingDate,
      proposal.decisions.map((d) => {
        const ci = proposal.conflicts.findIndex((c) => c.newDecision === d.text);
        return {
          ...d,
          conflictsWithId: ci >= 0 ? proposal.conflicts[ci].conflictsWithId : undefined,
          resolution: ci >= 0 ? proposal.resolutions[String(ci)] : undefined,
        };
      }),
    );

    const failed = results.filter((r) => r.status === "failed").length;
    if (failed === 0) await updateProposal(approvalId, { status: "executed" });

    return Response.json({
      items: results,
      trello: trelloConfigured(),
      total: results.length,
      created: results.length - failed,
      failed,
      newlyCreated: createdNow,
    });
  });
}

/**
 * Demo reset: forget confirmed tasks, proposals and learned decisions.
 * With ?archive=1 it also archives the Trello cards this app created (only those it has a link for).
 */
export async function DELETE(req: Request) {
  const archive = new URL(req.url).searchParams.get("archive") === "1" && trelloConfigured();
  let archived = 0;
  let archiveFailed = 0;
  if (archive) {
    for (const item of await loadItems()) {
      if (!item.trelloUrl) continue;
      try {
        await archiveCard(item.trelloUrl);
        archived++;
      } catch {
        archiveFailed++;
      }
    }
  }
  await saveItems([]);
  await clearProposals();
  await resetLearnedDecisions();
  return Response.json({ ok: true, archived, archiveFailed });
}

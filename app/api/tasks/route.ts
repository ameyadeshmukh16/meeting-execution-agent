import { randomUUID } from "node:crypto";
import { z } from "zod";
import { approvalBlockers } from "@/lib/gate";
import { clearProposals, getProposal, updateProposal, withLock } from "@/lib/proposals";
import { recordDecisions, resetLearnedDecisions } from "@/lib/conflicts";
import { loadItems, saveItems, type StoredItem } from "@/lib/store";
import { archiveCard, createCard, hasRef, listCards, trelloConfigured } from "@/lib/trello";

const BodySchema = z.object({ approvalId: z.string() });

/** Tasks that exist. Failed and still-pending attempts are not tasks. Older records have no status and were all created. */
export async function GET() {
  return Response.json({ items: (await loadItems()).filter((i) => i.status === undefined || i.status === "created") });
}

/** Insert or replace one record by its idempotency key, persisting immediately. */
async function upsert(record: StoredItem) {
  const all = await loadItems();
  await saveItems([...all.filter((i) => i.key !== record.key), record]);
}

/**
 * Executes an approved proposal. Idempotent per item (`approvalId:index`): items already created are
 * never created again, so a double-click or a Retry only creates what is missing.
 *
 * Failure handling: an intent record is saved as "pending" BEFORE the Trello call. If an earlier attempt
 * left a pending or failed record, its outcome is uncertain (the card may exist), so we look for the
 * card's reference marker first, and if that lookup fails we create nothing.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "approvalId is required" }, { status: 400 });
  const { approvalId } = parsed.data;

  return withLock(approvalId, async () => {
    const proposal = await getProposal(approvalId);
    if (!proposal) return Response.json({ error: "Unknown approvalId" }, { status: 404 });
    if (proposal.status === "pending") return Response.json({ error: "Not approved yet" }, { status: 403 });
    // Defence in depth: approval already requires this, but never execute with anything unresolved.
    if (approvalBlockers(proposal).any) return Response.json({ error: "Approval requirements are not met" }, { status: 403 });

    const previous = new Map((await loadItems()).filter((i) => i.key?.startsWith(`${approvalId}:`)).map((i) => [i.key!, i]));
    const { meeting, meetingDate } = proposal;

    let boardCards: Awaited<ReturnType<typeof listCards>> | null = null;
    let createdNow = 0;
    const results: StoredItem[] = [];

    for (const [i, item] of proposal.items.entries()) {
      const key = `${approvalId}:${i}`;
      const prev = previous.get(key);
      if (prev && prev.status !== "failed" && prev.status !== "pending") {
        results.push(prev);
        continue;
      }
      const record: StoredItem = { ...item, id: prev?.id ?? randomUUID(), key, meeting, meetingDate, status: "created" };

      if (trelloConfigured()) {
        try {
          // Save the intent first, so a crash after Trello creates the card still leaves a record to reconcile.
          await upsert({ ...record, status: "pending" });
          let existing: { shortUrl: string } | undefined;
          if (prev) {
            // A previous attempt's outcome is uncertain. If we cannot check, we must not create.
            try {
              boardCards ??= await listCards();
            } catch {
              throw new Error("Could not check Trello for an earlier attempt, so nothing was created. Retry in a moment.");
            }
            existing = boardCards.find((c) => hasRef(c, key));
          }
          record.trelloUrl = existing ? existing.shortUrl : (await createCard(item, meeting, key)).url;
          if (!existing) createdNow++;
        } catch (e) {
          record.status = "failed";
          record.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        }
      }
      await upsert(record);
      results.push(record);
    }

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

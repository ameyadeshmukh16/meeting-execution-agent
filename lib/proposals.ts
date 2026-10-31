import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActionItem, Evidence } from "./confirm";
import type { Resolution } from "./conflicts";

/**
 * A proposal is what the server will execute once approved. The client never sends the items to
 * execute, only the approvalId, so what was reviewed is exactly what gets created.
 * There is no auth, so this guards against bugs, replays and duplicates, not malicious users.
 */
export type Proposal = {
  approvalId: string;
  meeting: string;
  meetingDate: string;
  items: ActionItem[];
  decisions: { text: string; topic?: string; evidence?: Evidence }[];
  /** Conflicts the user has to settle before approval. `resolutions` is keyed by the conflict's index. */
  conflicts: { newDecision: string; conflictsWithId: string }[];
  resolutions: Record<string, Resolution>;
  status: "pending" | "approved" | "executed";
  createdAt: string;
  approvedAt?: string;
  approvalUtterance?: string;
};

const FILE = path.join(process.cwd(), "data", "proposals.json");

async function load(): Promise<Proposal[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

async function save(all: Proposal[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

export async function createProposal(
  data: Pick<Proposal, "meeting" | "meetingDate" | "items" | "decisions" | "conflicts">,
): Promise<Proposal> {
  const proposal: Proposal = { ...data, resolutions: {}, approvalId: randomUUID(), status: "pending", createdAt: new Date().toISOString() };
  await save([...(await load()), proposal]);
  return proposal;
}

export async function getProposal(approvalId: string): Promise<Proposal | undefined> {
  return (await load()).find((p) => p.approvalId === approvalId);
}

export async function updateProposal(approvalId: string, patch: Partial<Proposal>): Promise<Proposal | undefined> {
  const all = await load();
  const i = all.findIndex((p) => p.approvalId === approvalId);
  if (i === -1) return undefined;
  all[i] = { ...all[i], ...patch };
  await save(all);
  return all[i];
}

export async function clearProposals() {
  await rm(FILE, { force: true });
}

// Serialize work per approvalId so a double-click cannot run two executions at once.
// Kept on globalThis so dev-mode module reloads don't drop the queue.
const g = globalThis as unknown as { __locks?: Map<string, Promise<unknown>> };
const locks = (g.__locks ??= new Map());

export async function withLock<T>(approvalId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(approvalId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(approvalId, run);
  try {
    return await run;
  } finally {
    if (locks.get(approvalId) === run) locks.delete(approvalId);
  }
}

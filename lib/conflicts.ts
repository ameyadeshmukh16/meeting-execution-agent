import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { completeJson } from "./llm";

export type PastDecision = {
  id: string;
  meeting: string;
  date: string;
  decision: string;
  rationale: string;
  /** Id of an earlier decision this one replaced (set when a conflict was confirmed anyway). */
  supersedes?: string;
};

const SEED_FILE = path.join(process.cwd(), "data", "decisions.json");
const LEARNED_FILE = path.join(process.cwd(), "data", "learned-decisions.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Seed decisions plus any learned from confirmed meetings, minus ones a later decision replaced. */
export async function loadPastDecisions(): Promise<PastDecision[]> {
  const all = [...(await readJson<PastDecision[]>(SEED_FILE, [])), ...(await readJson<PastDecision[]>(LEARNED_FILE, []))];
  const replaced = new Set(all.flatMap((d) => (d.supersedes ? [d.supersedes] : [])));
  return all.filter((d) => !replaced.has(d.id));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Persist decisions from a confirmed meeting. Skips ones already stored for the same meeting. */
export async function recordDecisions(
  meeting: string,
  date: string,
  decisions: { text: string; supersedes?: string }[],
) {
  // The seed already represents some meetings (e.g. the demo's Meeting 1); don't store them twice.
  const seed = await readJson<PastDecision[]>(SEED_FILE, []);
  if (seed.some((d) => d.meeting === meeting)) return;

  const learned = await readJson<PastDecision[]>(LEARNED_FILE, []);
  const seen = new Set(learned.filter((d) => d.meeting === meeting).map((d) => norm(d.decision)));
  let n = learned.length + 1;
  for (const d of decisions) {
    if (seen.has(norm(d.text))) continue;
    learned.push({
      id: `L${n++}`,
      meeting,
      date,
      decision: d.text,
      rationale: `Decided in ${meeting}.`,
      ...(d.supersedes ? { supersedes: d.supersedes } : {}),
    });
  }
  await mkdir(path.dirname(LEARNED_FILE), { recursive: true });
  await writeFile(LEARNED_FILE, JSON.stringify(learned, null, 2));
}

export async function resetLearnedDecisions() {
  await rm(LEARNED_FILE, { force: true });
}

const ModelSchema = z.object({
  conflicts: z.array(
    z.object({
      newDecision: z.string(),
      conflictsWithId: z.string(),
      reasoning: z.string(),
    }),
  ),
});

export type Conflict = {
  newDecision: string;
  conflictsWith: PastDecision;
  reasoning: string;
};

const SYSTEM = `You check new team decisions against a store of past decisions and report genuine contradictions.
Reply with ONLY a JSON object: {"conflicts":[{"newDecision":string,"conflictsWithId":string,"reasoning":string}]}

Rules:
- Report a conflict only when following the new decision would mean breaking or reversing a past decision. Decisions on different topics are NOT conflicts, even if they share words.
- newDecision must be copied verbatim from the provided new decisions. conflictsWithId must be an id from the past decisions.
- reasoning is 1-2 sentences, plain language, naming the specific clash and why it matters (use the past decision's rationale where relevant). Do not mention ids in the reasoning.
- The past decisions listed are the ones currently in force; earlier ones that were replaced are already removed. Check the new decisions against these only.
- If nothing conflicts, return {"conflicts":[]}.`;

/** `pastOverride` lets the evaluation harness supply a controlled memory instead of the stored one. */
export async function detectConflicts(newDecisions: string[], pastOverride?: PastDecision[]): Promise<Conflict[]> {
  if (newDecisions.length === 0) return [];
  const past = pastOverride ?? (await loadPastDecisions());
  const byId = new Map(past.map((d) => [d.id, d]));

  const result = await completeJson(
    SYSTEM,
    `Past decisions:\n${JSON.stringify(past, null, 1)}\n\nNew decisions:\n${JSON.stringify(newDecisions)}`,
    ModelSchema,
  );

  // Never trust model-supplied metadata: resolve the id and drop hallucinated references.
  return result.conflicts.flatMap((c) => {
    const target = byId.get(c.conflictsWithId);
    if (!target || !newDecisions.includes(c.newDecision)) return [];
    return [{ newDecision: c.newDecision, conflictsWith: target, reasoning: c.reasoning }];
  });
}

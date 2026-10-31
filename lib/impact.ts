import { z } from "zod";
import { completeJson } from "./llm";
import { loadItems } from "./store";

/** A task that already exists (created from an earlier confirmed meeting). */
export type ExistingTask = { id: string; task: string; owner: string | null; deadline: string | null; meeting?: string };

const ModelSchema = z.object({
  impact: z.array(
    z.object({
      decision: z.string(),
      affectedTaskIds: z.array(z.string()).catch([]),
      affectedSystems: z.array(z.string()).catch([]),
      potentialConsequences: z.array(z.string()).catch([]),
    }),
  ),
});

export type Impact = {
  decision: string;
  affectedTaskIds: string[];
  affectedSystems: string[];
  potentialConsequences: string[];
};

const SYSTEM = `You assess what new team decisions may affect among EXISTING tasks. This is separate from checking whether a decision contradicts an earlier decision: a decision can affect a task without contradicting anything.
Reply with ONLY a JSON object: {"impact":[{"decision":string,"affectedTaskIds":[string],"affectedSystems":[string],"potentialConsequences":[string]}]}

Rules:
- decision must be copied verbatim from the provided new decisions.
- affectedTaskIds may contain ONLY ids from the provided existing tasks. Include a task only if adopting the decision would clearly require changing, cancelling or re-examining it. List at most 4, most directly affected first. Do not stretch: unrelated tasks must not be listed.
- A task that CARRIES OUT the new decision itself (e.g. "Set up Mongo" for the decision "Use Mongo") is not affected by it. Tasks that built on the opposite or earlier choice are.
- affectedSystems: short names of systems or components the decision touches (max 3).
- potentialConsequences: up to 3 short sentences about what could need to change. They are possibilities, not facts; write them as "may" statements.
- If a decision clearly affects nothing in the existing tasks, return empty lists for it.`;

/** Tasks that exist and are not known to have failed. We do not sync done-status from Trello. */
export async function loadExistingTasks(): Promise<ExistingTask[]> {
  return (await loadItems())
    .filter((i) => i.status !== "failed")
    .map((i) => ({ id: i.id, task: i.task, owner: i.owner, deadline: i.deadline, meeting: i.meeting }));
}

export async function assessImpact(newDecisions: string[], tasksOverride?: ExistingTask[]): Promise<Impact[]> {
  const tasks = tasksOverride ?? (await loadExistingTasks());
  // No existing tasks means nothing to affect: skip the model call.
  if (newDecisions.length === 0 || tasks.length === 0) return [];
  const taskIds = new Set(tasks.map((t) => t.id));

  const result = await completeJson(
    SYSTEM,
    `Existing tasks:\n${JSON.stringify(tasks, null, 1)}\n\nNew decisions:\n${JSON.stringify(newDecisions)}`,
    ModelSchema,
  );

  // Never trust model-supplied ids or decision text: keep only references that exist.
  return result.impact
    .filter((i) => newDecisions.includes(i.decision))
    .map((i) => ({
      decision: i.decision,
      affectedTaskIds: [...new Set(i.affectedTaskIds.filter((id) => taskIds.has(id)))].slice(0, 4),
      affectedSystems: i.affectedSystems.slice(0, 3),
      potentialConsequences: i.potentialConsequences.slice(0, 3),
    }))
    .filter((i) => i.affectedTaskIds.length > 0 || i.potentialConsequences.length > 0);
}

import { assessImpact, loadExistingTasks, type ExistingTask } from "@/lib/impact";

export async function POST(req: Request) {
  const { decisions, tasks } = await req.json();
  if (!Array.isArray(decisions) || !decisions.every((d) => typeof d === "string")) {
    return Response.json({ error: "decisions must be an array of strings" }, { status: 400 });
  }
  try {
    // `tasks` overrides the stored tasks; used by the evaluation harness only.
    const override: ExistingTask[] | undefined = Array.isArray(tasks) ? tasks : undefined;
    const impact = await assessImpact(decisions, override);
    // Resolve ids to task details so the UI doesn't need a second lookup.
    const known = override ?? (await loadExistingTasks());
    const byId = new Map(known.map((t) => [t.id, t]));
    return Response.json({
      impact: impact.map((i) => ({ ...i, affectedTasks: i.affectedTaskIds.map((id) => byId.get(id)!) })),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

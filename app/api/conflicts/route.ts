import { detectConflicts, type PastDecision } from "@/lib/conflicts";

export async function POST(req: Request) {
  const { decisions, pastDecisions } = await req.json();
  if (!Array.isArray(decisions) || !decisions.every((d) => typeof d === "string")) {
    return Response.json({ error: "decisions must be an array of strings" }, { status: 400 });
  }
  // Optional memory override, used by the evaluation harness (scripts/eval.mjs).
  const override: PastDecision[] | undefined = Array.isArray(pastDecisions)
    ? pastDecisions.map((d) => ({ meeting: "n/a", date: "n/a", rationale: "", ...d }))
    : undefined;
  try {
    return Response.json({ conflicts: await detectConflicts(decisions, override) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

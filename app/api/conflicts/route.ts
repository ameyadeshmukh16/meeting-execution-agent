import { detectConflicts } from "@/lib/conflicts";

export async function POST(req: Request) {
  const { decisions } = await req.json();
  if (!Array.isArray(decisions) || !decisions.every((d) => typeof d === "string")) {
    return Response.json({ error: "decisions must be an array of strings" }, { status: 400 });
  }
  try {
    return Response.json({ conflicts: await detectConflicts(decisions) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

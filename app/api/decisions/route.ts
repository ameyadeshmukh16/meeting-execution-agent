import { connection } from "next/server";
import { loadDecisionHistory } from "@/lib/conflicts";

/** Read-only view of the decision registry. Never mutates anything. */
export async function GET() {
  await connection(); // read the files per request, not at build time
  return Response.json(await loadDecisionHistory());
}

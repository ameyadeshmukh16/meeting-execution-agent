import { connection } from "next/server";
import { llmIdentity } from "@/lib/llm";

/** Runtime settings the evaluation harness needs to verify before it measures anything. */
export async function GET() {
  // Read env per request, not at build time: otherwise a production build freezes the cache mode.
  await connection();
  const { provider, model, cacheFile } = llmIdentity();
  return Response.json({ provider, model, cache: process.env.LLM_CACHE ?? "fallback", cacheFile });
}

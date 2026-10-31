import { connection } from "next/server";

/** Runtime settings the evaluation harness needs to verify before it measures anything. */
export async function GET() {
  // Read env per request, not at build time: otherwise a production build freezes the cache mode.
  await connection();
  const provider = process.env.LLM_PROVIDER ?? "openrouter";
  return Response.json({
    provider,
    model: provider === "anthropic" ? process.env.ANTHROPIC_MODEL : process.env.OPENROUTER_MODEL,
    cache: process.env.LLM_CACHE ?? "fallback",
  });
}

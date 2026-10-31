import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const provider = () => process.env.LLM_PROVIDER ?? "openrouter";

async function callOpenRouter(system: string, user: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-super-vl:free",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error(`OpenRouter returned no content: ${JSON.stringify(json)}`);
  return content;
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

/** Pull the first JSON object out of a reply that may have prose or code fences around it. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in LLM reply");
  return JSON.parse(text.slice(start, end + 1));
}

// Replay cache for demo safety: every validated reply is stored by prompt hash. On an LLM failure
// (rate limit, outage) a rehearsed step replays its saved reply. LLM_CACHE=prefer serves from the
// cache first (fast, deterministic); LLM_CACHE=off disables it.
const CACHE_FILE = path.join(process.cwd(), "data", "llm-cache.json");

async function readCache(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeCache(key: string, value: unknown) {
  const cache = await readCache();
  cache[key] = value;
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1));
}

/** Call the configured LLM and validate its JSON reply against `schema`, retrying once on failure. */
export async function completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const mode = process.env.LLM_CACHE ?? "fallback";
  const key = createHash("sha256").update(system).update("\0").update(user).digest("hex");

  if (mode === "prefer") {
    const hit = (await readCache())[key];
    if (hit !== undefined) return schema.parse(hit);
  }

  const call = provider() === "anthropic" ? callAnthropic : callOpenRouter;
  let lastError: unknown;
  let prompt = user;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = schema.parse(extractJson(await call(system, prompt)));
      if (mode !== "off") await writeCache(key, parsed);
      return parsed;
    } catch (e) {
      lastError = e;
      prompt = `${user}\n\nYour previous reply was invalid (${String(e).slice(0, 300)}). Reply with ONLY a valid JSON object matching the requested shape.`;
    }
  }

  if (mode !== "off") {
    const hit = (await readCache())[key];
    if (hit !== undefined) {
      console.warn("LLM failed; replaying cached reply:", String(lastError).slice(0, 200));
      return schema.parse(hit);
    }
  }
  throw new Error(`LLM call failed: ${String(lastError)}`);
}

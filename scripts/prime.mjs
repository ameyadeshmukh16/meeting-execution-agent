// Plays the demo script through the live API so each model reply is saved in the replay cache.
//
//   npm run dev            (cache mode must NOT be "off"; the default "fallback" records replies)
//   npm run prime
//
// It creates real Trello cards while running and archives them again at the end, then resets
// the app's memory so you start the rehearsal clean. Uses ~13 model calls (free tier: 50/day).
// The utterances below are the ones in the README demo script; saying them differently in the
// UI means that step goes to the live model.
const BASE = process.env.PRIME_BASE ?? "http://localhost:3000";

const MEETINGS = [
  { name: "meeting1", title: "Sprint Planning 12", date: "2026-10-06", say: ["confirm"] },
  { name: "meeting2", title: "Sprint Planning 14", date: "2026-10-27", say: ["change the second deadline to Friday", "replace the earlier decision", "confirm"] },
  { name: "meeting3", title: "Standup 2026-11-03", date: "2026-11-03", say: ["Priya owns the cache invalidation task, make it due Friday", "replace the earlier decision", "confirm"] },
];

async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const health = await call("GET", "/api/health");
if (health.cache === "off") {
  console.error("Server has LLM_CACHE=off, so nothing would be saved. Restart without it.");
  process.exit(1);
}
console.log(`Priming with ${health.provider} / ${health.model} (cache: ${health.cache})`);

await call("DELETE", "/api/tasks?archive=1");

for (const m of MEETINGS) {
  console.log(`\n== ${m.title}`);
  const { transcript } = await call("GET", `/api/demo?name=${m.name}`);
  const ex = await call("POST", "/api/extract", { transcript, meetingDate: m.date });
  const texts = ex.decisions.map((d) => d.text);
  const [{ conflicts }, { impact }] = await Promise.all([
    call("POST", "/api/conflicts", { decisions: texts }),
    call("POST", "/api/impact", { decisions: texts }),
  ]);
  console.log(` ${ex.decisions.length} decisions, ${ex.actionItems.length} tasks, ${conflicts.length} conflicts, ${impact.length} impact entries`);

  const { approvalId } = await call("POST", "/api/proposals", {
    meeting: m.title,
    meetingDate: m.date,
    actionItems: ex.actionItems,
    decisions: ex.decisions.map((d) => ({ text: d.text, topic: d.topic, evidence: d.evidence })),
    conflicts: conflicts.map((c) => ({ newDecision: c.newDecision, conflictsWithId: c.conflictsWith.id })),
  });

  let last;
  for (const utterance of m.say) {
    last = await call("POST", "/api/confirm", { approvalId, utterance });
    console.log(` "${utterance}" -> ${last.intent}`);
  }
  if (last.intent !== "confirm") throw new Error(`${m.title}: expected to end approved, got ${last.intent}: ${last.reply}`);
  const done = await call("POST", "/api/tasks", { approvalId });
  console.log(` created ${done.created}/${done.total}${done.failed ? `, ${done.failed} FAILED` : ""}`);
}

if (process.env.PRIME_KEEP === "1") {
  console.log("\nDone. PRIME_KEEP=1: left the demo state and Trello cards in place (use Reset demo memory to clear).");
} else {
  const cleaned = await call("DELETE", "/api/tasks?archive=1");
  console.log(`\nDone. Archived ${cleaned.archived} Trello card(s) and reset memory; replay cache is primed.`);
}

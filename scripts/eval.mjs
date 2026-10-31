// Evaluation harness for a small, controlled benchmark (eval/scenarios.json).
//
//   LLM_CACHE=off npm run dev      (in one terminal: measured runs must not replay cached replies)
//   npm run eval -- --out eval/results-baseline.md
//
// Each scenario is a single run against the live app, so results vary a little between runs on
// free models. Held-out scenarios are never used when tuning prompts.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.EVAL_BASE ?? "http://localhost:3000";
const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const allowCache = args.includes("--allow-cache");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (res.ok || res.status === 404 || attempt === 1) return { status: res.status, json };
    await sleep(5000); // one harness-level retry for transient provider errors
  }
}

const NO_OWNER = /^(unassigned|unknown|none|n\/a|tbd|team|everyone|nobody|someone|anyone)?$/i;
const noOwner = (item) => item.owner == null || NO_OWNER.test(String(item.owner).trim());
// `ownership` only exists once evidence-backed extraction is in; before that only an empty owner counts.
const notAccepted = (item) => noOwner(item) || item.ownership === "unclear";

function checkExtract(s, out) {
  const fails = [];
  const tally = { owner: [0, 0], deadline: [0, 0] };
  const decisions = (out.decisions ?? []).map((d) => d.text);
  const items = out.actionItems ?? [];
  const e = s.expect;

  for (const re of e.decisionsMatch ?? []) {
    if (!decisions.some((d) => new RegExp(re, "i").test(d))) fails.push(`no decision matching /${re}/`);
  }
  for (const re of e.decisionsAbsent ?? []) {
    const hit = decisions.find((d) => new RegExp(re, "i").test(d));
    if (hit) fails.push(`unexpected decision: "${hit}"`);
  }
  for (const want of e.items ?? []) {
    const item = items.find((i) => new RegExp(want.task, "i").test(i.task));
    if (!item) {
      fails.push(`no task matching /${want.task}/`);
      if (want.owner) tally.owner[1]++;
      if ("deadline" in want) tally.deadline[1]++;
      continue;
    }
    if (want.owner) {
      tally.owner[1]++;
      if (String(item.owner).toLowerCase() === want.owner.toLowerCase()) tally.owner[0]++;
      else fails.push(`owner ${item.owner} (wanted ${want.owner})`);
    }
    if ("deadline" in want) {
      tally.deadline[1]++;
      if ((item.deadline ?? null) === want.deadline) tally.deadline[0]++;
      else fails.push(`deadline ${item.deadline} (wanted ${want.deadline})`);
    }
  }
  if (e.noAcceptedOwner) {
    const matched = items.filter((i) => new RegExp(e.noAcceptedOwner, "i").test(i.task));
    tally.owner[1]++;
    const bad = matched.find((i) => !notAccepted(i));
    if (bad) fails.push(`gave "${bad.task}" to ${bad.owner} as if accepted`);
    else tally.owner[0]++;
  }
  return { fails, tally };
}

async function run(s) {
  if (s.kind === "extract") {
    const r = await api("POST", "/api/extract", { transcript: s.transcript, meetingDate: s.meetingDate });
    if (r.status !== 200) return { error: r.json.error ?? `HTTP ${r.status}` };
    return checkExtract(s, r.json);
  }
  if (s.kind === "conflict") {
    const r = await api("POST", "/api/conflicts", { decisions: s.newDecisions, pastDecisions: s.pastDecisions });
    if (r.status !== 200) return { error: r.json.error ?? `HTTP ${r.status}` };
    const got = new Set(r.json.conflicts.map((c) => c.conflictsWith.id));
    const want = new Set(s.expect.conflictIds);
    const tp = [...got].filter((x) => want.has(x)).length;
    const fp = [...got].filter((x) => !want.has(x)).length;
    const fn = [...want].filter((x) => !got.has(x)).length;
    const fails = [];
    if (fp) fails.push(`false positive: ${[...got].filter((x) => !want.has(x)).join(",")}`);
    if (fn) fails.push(`missed: ${[...want].filter((x) => !got.has(x)).join(",")}`);
    return { fails, conf: { tp, fp, fn } };
  }
  if (s.kind === "impact") {
    const r = await api("POST", "/api/impact", { decisions: s.newDecisions, tasks: s.tasks });
    if (r.status === 404) return { skipped: "impact assessment not implemented yet" };
    if (r.status !== 200) return { error: r.json.error ?? `HTTP ${r.status}` };
    const got = new Set((r.json.impact ?? []).flatMap((i) => i.affectedTaskIds ?? []));
    const fails = [];
    for (const id of s.expect.affected) if (!got.has(id)) fails.push(`missed affected ${id}`);
    for (const id of s.expect.notAffected) if (got.has(id)) fails.push(`wrongly affected ${id}`);
    for (const id of got) if (!s.tasks.some((t) => t.id === id)) fails.push(`invented task id ${id}`);
    return { fails };
  }
  return { error: `unknown kind ${s.kind}` };
}

const health = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`Cannot reach ${BASE}. Start the app with: LLM_CACHE=off npm run dev`);
  process.exit(1);
}
if (health.cache !== "off" && !allowCache) {
  console.error(`Server has LLM_CACHE=${health.cache}. Measured runs must be cache-off: restart with LLM_CACHE=off npm run dev`);
  process.exit(1);
}

const scenarios = JSON.parse(fs.readFileSync(new URL("../eval/scenarios.json", import.meta.url), "utf8"));
const rows = [];
const total = { owner: [0, 0], deadline: [0, 0], tp: 0, fp: 0, fn: 0 };

for (const s of scenarios) {
  process.stdout.write(`${s.id} ${s.title} ... `);
  const r = await run(s);
  const status = r.error ? "ERROR" : r.skipped ? "SKIP" : r.fails.length ? "FAIL" : "PASS";
  console.log(status, r.error ?? r.skipped ?? r.fails.join("; "));
  rows.push({ s, status, detail: r.error ?? r.skipped ?? r.fails.join("; ") });
  if (r.tally) for (const k of ["owner", "deadline"]) { total[k][0] += r.tally[k][0]; total[k][1] += r.tally[k][1]; }
  if (r.conf) { total.tp += r.conf.tp; total.fp += r.conf.fp; total.fn += r.conf.fn; }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : "n/a");
const count = (pred) => {
  const sel = rows.filter(pred);
  return `${sel.filter((r) => r.status === "PASS").length}/${sel.filter((r) => r.status !== "SKIP").length}`;
};
const precision = total.tp + total.fp ? pct(total.tp, total.tp + total.fp) : "n/a (no conflicts flagged)";
const recall = pct(total.tp, total.tp + total.fn);

const md = [
  `# Evaluation results`,
  ``,
  `- Date: ${new Date().toISOString()}`,
  `- Model: ${health.provider} / ${health.model}`,
  `- LLM cache: ${health.cache}`,
  `- **Small controlled benchmark (${scenarios.length} scenarios, single run).** Free models are non-deterministic, so treat differences of one scenario as noise. Not a statistically validated accuracy figure.`,
  ``,
  `| Scenario | Set | Result | Detail |`,
  `|---|---|---|---|`,
  ...rows.map((r) => `| ${r.s.id} ${r.s.title} | ${r.s.heldout ? "held-out" : "tuned"} | ${r.status} | ${r.detail || ""} |`),
  ``,
  `| Metric | Value |`,
  `|---|---|`,
  `| Scenarios passed, tuned set | ${count((r) => !r.s.heldout)} |`,
  `| Scenarios passed, held-out set | ${count((r) => r.s.heldout)} |`,
  `| Conflict precision | ${precision} |`,
  `| Conflict recall | ${recall} |`,
  `| False positives (conflicts) | ${total.fp} |`,
  `| Owner attribution accuracy | ${pct(...total.owner)} |`,
  `| Deadline accuracy | ${pct(...total.deadline)} |`,
  `| Skipped (not implemented yet) | ${rows.filter((r) => r.status === "SKIP").length} |`,
  ``,
].join("\n");

console.log("\n" + md);
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`\nSaved ${outPath}`);
}

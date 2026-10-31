// Offline tests for the trust guarantees: evidence gate, approval policy, Trello failure handling,
// decision memory rules and cache identity. Zero model requests:
//   - the app runs with NO LLM key (any model call would fail the test that triggered it)
//   - Trello is a mock HTTP server that this file can make fail on demand
//   - all data goes to a throwaway DATA_DIR, never ./data
//
//   npm run test
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { verifyEvidence } from "../lib/evidence.ts";
import { stripInternalIds } from "../lib/redact.ts";
import { isPlainApproval, parseEvidenceAcceptance, parseProceedAnyway, parseResolution } from "../lib/resolution.ts";

const APP_PORT = 3100;
const MOCK_PORT = 4010;
const APP = `http://localhost:${APP_PORT}`;
const REPO = path.resolve(import.meta.dirname, "..");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mea-test-"));
fs.copyFileSync(path.join(REPO, "data", "decisions.json"), path.join(DATA, "decisions.json"));

// ---- mock Trello ---------------------------------------------------------------------------------
const mock = { cards: [], createCalls: 0, createMode: "ok", listMode: "ok", statusAtCreate: undefined };
const resetMock = () => Object.assign(mock, { cards: [], createCalls: 0, createMode: "ok", listMode: "ok", statusAtCreate: undefined });
let mockServer;
let appProc;

function startMock() {
  mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "POST" && req.url.startsWith("/1/cards")) {
        mock.createCalls++;
        if (mock.createMode === "error") return send(500, { error: "mock create failure" });
        const form = new URLSearchParams(body);
        // What did the app have on disk for this item at the instant the create call arrived?
        const ref = /\[ref:([^\]]+)\]/.exec(form.get("desc") ?? "")?.[1];
        try {
          const saved = JSON.parse(fs.readFileSync(path.join(DATA, "items.json"), "utf8"));
          mock.statusAtCreate = saved.find((i) => i.key === ref)?.status ?? "no-record";
        } catch {
          mock.statusAtCreate = "no-file";
        }
        const id = `c${mock.cards.length + 1}`;
        const card = { id, desc: form.get("desc") ?? "", name: form.get("name"), shortUrl: `https://trello.test/c/${id}` };
        mock.cards.push(card);
        return send(200, card);
      }
      if (req.method === "GET" && req.url.includes("/cards")) {
        if (mock.listMode === "error") return send(500, { error: "mock list failure" });
        return send(200, mock.cards.map(({ desc, shortUrl }) => ({ desc, shortUrl })));
      }
      if (req.method === "PUT") return send(200, {});
      send(404, {});
    });
  });
  return new Promise((r) => mockServer.listen(MOCK_PORT, r));
}

// ---- app under test ------------------------------------------------------------------------------
before(async () => {
  await startMock();
  const build = spawnSync("npx", ["next", "build"], { cwd: REPO, shell: true, encoding: "utf8" });
  assert.equal(build.status, 0, `next build failed:\n${build.stdout}\n${build.stderr}`);
  appProc = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    cwd: REPO,
    shell: true,
    stdio: "ignore",
    env: {
      ...process.env,
      DATA_DIR: DATA,
      LLM_CACHE: "off",
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "", // no key: any model call fails loudly
      OPENROUTER_MODEL: "nvidia/nemotron-3.5-super-vl:free",
      ANTHROPIC_API_KEY: "",
      TRELLO_KEY: "k",
      TRELLO_TOKEN: "t",
      TRELLO_LIST_ID: "l",
      TRELLO_BASE_URL: `http://localhost:${MOCK_PORT}`,
    },
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("app did not start");
});

after(() => {
  if (appProc?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(appProc.pid), "/T", "/F"]);
    else appProc.kill();
  }
  mockServer?.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

// ---- helpers -------------------------------------------------------------------------------------
async function api(method, url, body) {
  const res = await fetch(APP + url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
let counter = 0;
const good = (task, owner = "Gowtham") => ({
  task, owner, ownership: "accepted", deadline: null,
  evidence: { quote: "I will do it by Friday", speaker: owner }, evidenceVerified: true,
});
async function proposal(items, { decisions = [], conflicts = [], meeting, meetingDate = "2026-12-01" } = {}) {
  const r = await api("POST", "/api/proposals", {
    meeting: meeting ?? `T-${++counter}`, meetingDate, actionItems: items, decisions, conflicts,
  });
  assert.equal(r.status, 200);
  return r.body.approvalId;
}
const say = (approvalId, utterance) => api("POST", "/api/confirm", { approvalId, utterance });
const run = (approvalId) => api("POST", "/api/tasks", { approvalId });
const decisionsView = async () => (await api("GET", "/api/decisions")).body.decisions;

// ---- pure unit tests -----------------------------------------------------------------------------
test("verifyEvidence: valid, missing, fabricated, wrong speaker, short, normalised", () => {
  const t = "Ameya: Gowtham, can you ship the auth fix by Wednesday?\nGowtham: Yes, Wednesday works.";
  assert.deepEqual(verifyEvidence(t, { quote: "Yes, Wednesday works.", speaker: "Gowtham" }), { ok: true });
  assert.deepEqual(verifyEvidence(t, { quote: "yes wednesday WORKS", speaker: "gowtham" }), { ok: true });
  assert.deepEqual(verifyEvidence(t, { quote: "Yes, Wednesday works." }), { ok: true }); // no speaker claimed
  assert.deepEqual(verifyEvidence(t, undefined), { ok: false, issue: "missing" });
  assert.deepEqual(verifyEvidence(t, { quote: "   " }), { ok: false, issue: "missing" });
  assert.deepEqual(verifyEvidence(t, { quote: "I will ship it tomorrow morning", speaker: "Gowtham" }), { ok: false, issue: "not_found" });
  assert.deepEqual(verifyEvidence(t, { quote: "Yes, Wednesday works.", speaker: "Ameya" }), { ok: false, issue: "wrong_speaker" });
  assert.deepEqual(verifyEvidence(t, { quote: "yes", speaker: "Gowtham" }), { ok: false, issue: "not_found" });
});

test("internal decision ids are replaced with plain language, and nothing else is touched", () => {
  const ids = ["d1", "d2", "L3"];
  // The exact sentence the model produced for Meeting 2.
  assert.equal(
    stripInternalIds("d1 requires Postgres as the primary database for all new services to avoid operating multiple systems.", ids),
    "The earlier decision requires Postgres as the primary database for all new services to avoid operating multiple systems.",
  );
  assert.equal(stripInternalIds("This breaks decision d1 and also d2.", ids), "This breaks the earlier decision and also the earlier decision.");
  assert.equal(stripInternalIds("It conflicts with the earlier decision L3.", ids), "It conflicts with the earlier decision.");
  assert.equal(stripInternalIds("See D1 first. D2 follows.", ids), "See the earlier decision first. The earlier decision follows.");
  // Only exact known ids, as whole words.
  assert.equal(stripInternalIds("Ship before the Q1 release; d10 and d1x are different things.", ids), "Ship before the Q1 release; d10 and d1x are different things.");
  assert.equal(stripInternalIds("Nothing to change here.", ids), "Nothing to change here.");
  assert.equal(stripInternalIds("d1 stays as written", []), "d1 stays as written");
  assert.equal(stripInternalIds("", ids), "");
});

test("spoken command parsing is strict about what it accepts", () => {
  assert.deepEqual(parseEvidenceAcceptance("accept item 3 anyway"), { items: [3] });
  assert.deepEqual(parseEvidenceAcceptance("accept the second one anyway"), { items: [2] });
  assert.deepEqual(parseEvidenceAcceptance("accept them anyway"), { items: "all" });
  assert.equal(parseEvidenceAcceptance("change item 3 to Friday"), null);
  assert.equal(parseEvidenceAcceptance("accept"), null);
  assert.equal(parseProceedAnyway("proceed anyway"), true);
  assert.equal(parseProceedAnyway("go ahead anyway please"), true);
  assert.equal(parseProceedAnyway("proceed"), false);
  assert.equal(isPlainApproval("Yes, confirm."), true);
  assert.equal(isPlainApproval("looks good!"), true);
  assert.equal(isPlainApproval("confirm but change the deadline"), false);
  assert.equal(parseResolution("replace Priya with Gowtham on the second task"), null);
  assert.equal(parseResolution("replace the earlier decision"), "replace");
  assert.equal(parseResolution("keep both"), "keep_both");
});

test("cache is per provider and model, and health says which", async () => {
  const h = (await api("GET", "/api/health")).body;
  assert.equal(h.cacheFile, "llm-cache.openrouter-nvidia-nemotron-3.5-super-vl-free.json");
  assert.ok(fs.existsSync(path.join(REPO, "data", h.cacheFile)), "the primed cache must exist under the identity-specific name");
});

// ---- evidence gate -------------------------------------------------------------------------------
for (const [label, extra] of [
  ["fabricated quote", { evidence: { quote: "this never happened", speaker: "Priya" }, evidenceVerified: false, evidenceIssue: "not_found" }],
  ["missing evidence", { evidence: undefined, evidenceVerified: undefined }],
  ["wrong speaker", { evidenceVerified: false, evidenceIssue: "wrong_speaker" }],
]) {
  test(`evidence gate: ${label} blocks approval until explicitly accepted, and acceptance is recorded`, async () => {
    const id = await proposal([{ ...good("Ungrounded task", "Priya"), ...extra }]);
    let r = await say(id, "confirm");
    assert.equal(r.body.intent, "blocked");
    assert.match(r.body.reply, /no verified transcript evidence/);
    assert.equal((await run(id)).status, 403, "execution must refuse an unapproved proposal");

    r = await say(id, "accept item 1 anyway");
    assert.equal(r.body.intent, "resolved");
    assert.equal(r.body.evidenceAccepted.length, 1);
    assert.equal(r.body.evidenceAccepted[0].task, "Ungrounded task");
    assert.ok(r.body.evidenceAccepted[0].at, "acceptance carries a timestamp");

    r = await say(id, "confirm");
    assert.equal(r.body.intent, "confirm");
    const done = await run(id);
    assert.equal(done.status, 200);
    assert.equal(done.body.created, 1);
  });
}

test("evidence gate: verified evidence needs no acceptance", async () => {
  const id = await proposal([good("Grounded task")]);
  assert.equal((await say(id, "confirm")).body.intent, "confirm");
});

test("evidence gate: the button endpoint does the same as the voice command, and cannot be used on verified items", async () => {
  const id = await proposal([good("Fine task"), { ...good("Shaky task"), evidenceVerified: false, evidenceIssue: "not_found" }]);
  assert.equal((await api("PATCH", "/api/proposals", { approvalId: id, acceptEvidence: 0 })).status, 400);
  const r = await api("PATCH", "/api/proposals", { approvalId: id, acceptEvidence: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.evidenceAccepted.length, 1);
  assert.equal((await say(id, "confirm")).body.intent, "confirm");
});

// ---- ownership and conflict gates ----------------------------------------------------------------
test("ownership gate: no owner or unconfirmed owner blocks approval", async () => {
  const id = await proposal([good("Owned"), { ...good("Nobody's"), owner: null, ownership: "unclear" }]);
  const r = await say(id, "confirm");
  assert.equal(r.body.intent, "blocked");
  assert.match(r.body.reply, /confirmed owner/);
});

test("conflict gate: approval needs an explicit choice, and only 'replace' retires the earlier decision", async () => {
  const meeting = `T-conflict-${++counter}`;
  const id = await proposal([good("Some task")], {
    meeting,
    decisions: [{ text: "Use Mongo for everything" }, { text: "Use Memcached for caching" }],
    conflicts: [
      { newDecision: "Use Mongo for everything", conflictsWithId: "d1" },
      { newDecision: "Use Memcached for caching", conflictsWithId: "d2" },
    ],
  });
  let r = await say(id, "confirm");
  assert.equal(r.body.intent, "blocked");
  assert.match(r.body.reply, /conflict/);
  assert.equal((await run(id)).status, 403);

  await api("PATCH", "/api/proposals", { approvalId: id, index: 0, resolution: "replace" });
  await api("PATCH", "/api/proposals", { approvalId: id, index: 1, resolution: "keep_both" });
  assert.equal((await say(id, "confirm")).body.intent, "confirm");
  assert.equal((await run(id)).status, 200);

  const view = Object.fromEntries((await decisionsView()).map((d) => [d.id, d]));
  assert.equal(view.d1.state, "replaced", "replace retires the earlier decision");
  assert.equal(view.d2.state, "active", "keep both leaves the earlier decision in force");
});

test("needs_clarification: blocks until 'proceed anyway', which is recorded, and a changed choice clears it", async () => {
  const id = await proposal([good("Independent task")], {
    decisions: [{ text: "Move auth to sessions" }],
    conflicts: [{ newDecision: "Move auth to sessions", conflictsWithId: "d5" }],
  });
  await api("PATCH", "/api/proposals", { approvalId: id, index: 0, resolution: "needs_clarification" });
  let r = await say(id, "confirm");
  assert.equal(r.body.intent, "blocked");
  assert.match(r.body.reply, /under review/);

  r = await say(id, "proceed anyway");
  assert.equal(r.body.intent, "resolved");
  assert.equal(r.body.acknowledgedReview, true);

  // Changing the choice invalidates the acknowledgement.
  const changed = await api("PATCH", "/api/proposals", { approvalId: id, index: 0, resolution: "keep_both" });
  assert.equal(changed.body.acknowledgedReview, false);
  await api("PATCH", "/api/proposals", { approvalId: id, index: 0, resolution: "needs_clarification" });
  assert.equal((await say(id, "confirm")).body.intent, "blocked", "must acknowledge again");
  await say(id, "proceed anyway");
  assert.equal((await say(id, "confirm")).body.intent, "confirm");
  assert.equal((await run(id)).status, 200);

  const view = Object.fromEntries((await decisionsView()).map((d) => [d.id, d]));
  assert.equal(view.d5.state, "active", "the earlier decision stays in force");
  const parked = Object.values(view).find((d) => d.decision === "Move auth to sessions");
  assert.equal(parked.state, "under_review", "the new decision is parked, not enforced");
});

// ---- Trello failure handling ---------------------------------------------------------------------
test("trello: a failed create is reported as failed, never as success, and is not a task", async () => {
  resetMock();
  mock.createMode = "error";
  const id = await proposal([good("Will fail")]);
  await say(id, "confirm");
  const r = await run(id);
  assert.equal(r.body.failed, 1);
  assert.equal(r.body.created, 0);
  assert.equal(r.body.items[0].status, "failed");
  const tasks = (await api("GET", "/api/tasks")).body.items;
  assert.ok(!tasks.some((t) => t.task === "Will fail"), "failed items are not listed as tasks");
});

test("trello: retry creates only what is missing; further retries create nothing", async () => {
  resetMock();
  const id = await proposal([good("Retry A"), good("Retry B"), good("Retry C")]);
  await say(id, "confirm");
  mock.createMode = "error";
  assert.equal((await run(id)).body.failed, 3);
  mock.createMode = "ok";
  const r2 = await run(id);
  assert.equal(r2.body.failed, 0);
  assert.equal(mock.cards.length, 3);
  const r3 = await run(id);
  assert.equal(r3.body.newlyCreated, 0);
  assert.equal(mock.cards.length, 3, "no duplicates after a further retry");
});

test("trello: if the lookup for an earlier attempt fails, nothing is created blindly", async () => {
  resetMock();
  mock.createMode = "error";
  const id = await proposal([good("Uncertain")]);
  await say(id, "confirm");
  await run(id); // first attempt fails; outcome is now "uncertain"
  const callsAfterFirst = mock.createCalls;

  mock.createMode = "ok";
  mock.listMode = "error";
  const r = await run(id);
  assert.equal(r.body.failed, 1);
  assert.match(r.body.items[0].error, /Could not check Trello/);
  assert.equal(mock.createCalls, callsAfterFirst, "no create call may be made while the lookup is failing");
  assert.equal(mock.cards.length, 0);

  mock.listMode = "ok";
  assert.equal((await run(id)).body.newlyCreated, 1, "once the lookup works, the retry proceeds");
  assert.equal(mock.cards.length, 1);
});

test("trello: a crash after the card was created (local record still 'pending') adopts the card instead of duplicating", async () => {
  resetMock();
  const id = await proposal([good("Crashed mid-create")]);
  await say(id, "confirm");
  // Simulate: Trello created the card, then the app died before saving the result.
  mock.cards.push({ id: "x1", desc: `Owner: Gowtham\n[ref:${id}:0]`, shortUrl: "https://trello.test/c/x1" });
  fs.writeFileSync(
    path.join(DATA, "items.json"),
    JSON.stringify([{ task: "Crashed mid-create", owner: "Gowtham", deadline: null, id: "i1", key: `${id}:0`, meeting: "m", meetingDate: "2026-12-01", status: "pending" }]),
  );
  const before = mock.createCalls;
  const r = await run(id);
  assert.equal(r.body.created, 1);
  assert.equal(r.body.newlyCreated, 0);
  assert.equal(mock.createCalls, before, "no second card created");
  assert.equal(r.body.items[0].trelloUrl, "https://trello.test/c/x1");
});

test("trello: an intent record is already on disk as 'pending' when the create call arrives", async () => {
  resetMock();
  const id = await proposal([good("Intent first")]);
  await say(id, "confirm");
  await run(id);
  assert.equal(mock.statusAtCreate, "pending", "the record must exist before the external side effect");
  const rec = JSON.parse(fs.readFileSync(path.join(DATA, "items.json"), "utf8")).find((i) => i.key === `${id}:0`);
  assert.equal(rec.status, "created", "and it is finalised afterwards");
});

test("trello: double submission creates exactly one card per item", async () => {
  resetMock();
  const id = await proposal([good("Dbl 1"), good("Dbl 2"), good("Dbl 3")]);
  await say(id, "confirm");
  await Promise.all([run(id), run(id)]);
  assert.equal(mock.cards.length, 3);
});

// ---- decision memory -----------------------------------------------------------------------------
test("meeting identity: a reused title on a different date is still recorded; the seeded meeting+date is skipped", async () => {
  const a = await proposal([good("x")], { meeting: "Sprint Planning 12", meetingDate: "2026-12-05", decisions: [{ text: "Brand new decision about caching" }] });
  await say(a, "confirm");
  await run(a);
  const b = await proposal([good("y")], { meeting: "Sprint Planning 12", meetingDate: "2026-10-06", decisions: [{ text: "Duplicate of a seeded meeting" }] });
  await say(b, "confirm");
  await run(b);
  const texts = (await decisionsView()).map((d) => d.decision);
  assert.ok(texts.includes("Brand new decision about caching"));
  assert.ok(!texts.includes("Duplicate of a seeded meeting"));
});

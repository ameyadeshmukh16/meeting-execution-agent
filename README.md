# Meeting → Execution Agent

Turns an engineering standup / sprint-planning transcript into confirmed, conflict-checked Trello tasks.

**It remembers decisions, shows the transcript evidence, says what a change may affect, and will not execute without an approval that passes its checks.**

## What it does

1. **Extracts** decisions and action items from a speaker-tagged transcript. Self-corrections ("X... actually no, Y") resolve to Y.
2. **Grounds every item in evidence.** Each decision and task carries the transcript quote it came from. A deterministic check (no model) verifies the quote appears in the transcript **and** was said by the claimed speaker. A task whose evidence is missing or unverified cannot be approved until you explicitly accept it ("accept item 2 anyway" or the button); the acceptance is recorded with a timestamp. Substring matching proves the words exist in the transcript, not that they support the claim.
3. **Never guesses an owner.** Tentative offers ("I can look into it, no promises") are flagged as unconfirmed, and nothing is approved until each item has a confirmed owner.
4. **Detects conflicts** against remembered decisions, with the earlier meeting cited and the reasoning shown. Decisions about different systems or projects are not flagged just because they share a technology.
5. **Assesses impact separately**: which already-created tasks a decision may affect. A model may suggest task ids, but the server drops any id that is not a real stored task. Wording is always "may".
6. **Requires an explicit choice per conflict**: *Replace earlier decision*, *Keep both*, or *Needs clarification*, by button or by voice. Only Replace retires the earlier decision. If a decision is left under review, you must explicitly say "proceed anyway" to create tasks; that is recorded, and the app does **not** claim to know which tasks depend on the disputed decision.
7. **Confirms by voice**: the app reads the summary back; dictate a correction ("change the second deadline to Friday") or say "confirm".
8. **Creates Trello cards only after approval.** The server holds the proposal and executes from it; the client only sends an id. See *Failure handling* below.
9. **Decisions** page (timeline: active / replaced / under review, with evidence and "what changed in the last meeting"), **Digest** (per person, can be read aloud), **Deadlines** (UI-only "would notify" reminders).

### Failure handling for Trello

An intent record is saved as `pending` before the Trello call. After any earlier attempt that failed or was left pending, the card may or may not exist, so the app first looks for the card's reference marker; **if that lookup fails, it creates nothing** and reports the item as failed with a Retry button. Double-clicks and retries do not duplicate cards in the cases covered by the tests below. This is not an exactly-once guarantee under all failure conditions.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

| Variable | Notes |
|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Default LLM. `nvidia/nemotron-3.5-super-vl:free` was used for the demo. **Free OpenRouter keys allow 50 requests/day**, which a few rehearsals can exhaust; see the replay cache below. |
| `LLM_PROVIDER` | `openrouter` (default), `anthropic`, or `ollama`. An unknown value is an error, not a silent fall-back. |
| `ANTHROPIC_API_KEY` | Optional provider. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Optional local provider (default `http://localhost:11434`, `qwen3:8b`). No key, no quota; quality and speed depend on your hardware. |
| `LLM_CACHE` | `fallback` (default: save every reply; replay one only if the model fails), `prefer` (cache first: instant and uses no quota), `off` (required for evaluation). |
| `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_ID` | Without these, confirmed tasks are saved locally and no cards are created. |

Trello: create a board with a "To Do" list, create a key at https://trello.com/power-ups/admin, authorize a token, and get the list ID from `https://api.trello.com/1/boards/<shortcode>/lists?key=...&token=...`.

## Demo script

Transcripts are in `data/demo/`; seed decisions in `data/decisions.json`. Run the demo with `LLM_CACHE=prefer` after `npm run prime` so it is instant and works even if the model is rate-limited. Anything said differently from the lines below goes to the live model (plain approvals like "confirm" never do).

1. **Reset demo memory** (tick "also archive Trello cards created by this app").
2. **Meeting 1** (baseline: Postgres). Analyze, say `confirm`. No conflict.
3. **Meeting 2**. Redis → Memcached self-correction; "Switch to Mongo" conflicts with Postgres (Sprint Planning 12); the Postgres schema task is shown as potentially affected. Say `change the second deadline to Friday`, then `replace the earlier decision`, then `confirm`.
4. **Meeting 3**. "Move billing back to Postgres" conflicts with the Mongo decision from Sprint Planning 14, and shows the Mongo setup and migration tasks as potentially affected. Priya's "I can look into it" is flagged: `confirm` is blocked. Say `Priya owns the cache invalidation task, make it due Friday`, then `replace the earlier decision`, then `confirm`.
5. Open **Decisions**, **Digest** and **Deadlines**.

## Replay cache

Every validated model reply is saved to `data/llm-cache.<provider>-<model>.json` (one file per provider and model, so switching model never replays another model's answer). The committed file belongs to the OpenRouter / Nemotron demo model. `npm run prime` plays the whole demo script above through the app (about 13 model calls the first time; creates then archives real Trello cards; `PRIME_KEEP=1` leaves the state in place). Afterwards the full three-meeting demo replays in about 13 seconds with zero model requests.

## Tests and evaluation

**`npm run test`**: 18 offline tests, zero model requests. It builds the app, runs it on a spare port with **no LLM key**, a throwaway data folder and a mock Trello server it can make fail on demand. It covers the evidence gate (fabricated, missing, wrong speaker), the ownership and conflict gates, the "proceed anyway" rule, Trello failure handling (failed create, failed lookup, crash after create, double submission, retry) and meeting identity. The tests were checked by reintroducing the reviewed bugs; the matching tests fail.

**`npm run eval`** (needs `LLM_CACHE=off npm run dev`; refuses to run with the cache on): 15 hand-written scenarios (4 held-out) against a live model.

- Baseline before the trust work: `eval/results-baseline.md` (12 of 13 runnable scenarios passed).
- After: `eval/results-after.md` (15 of 15 passed) on OpenRouter / Nemotron.
- Independent provider: `eval/results-ollama.md` (local `qwen3:8b`, 11 of 15). It misses the relative-date scenarios and has one false-positive conflict; the prompts were tuned on the Nemotron model, so this shows model dependence, not a fair model ranking.

**This is a small controlled benchmark, not a measure of real-world accuracy.** One run per scenario on a free model; the conflict scenarios already passed at baseline, so that run shows no regression there, not an improvement; the one fixed failure (E6) was fixed by a rule written knowing it was failing. Read the notes at the bottom of `eval/results-after.md`.

## Not implemented

Automatic speaker diarization (speaker tags are typed in the transcript), audio transcription, real email/SMS reminders, scheduled weekly digests, user authentication or verified approver identity, multi-user concurrency, a true dependency graph between decisions and tasks, and syncing task done-status back from Trello (impact treats tasks as "created, not tracked as done"). Storage is flat JSON files, fine for one user on one machine. **The approval check guards against bugs, replays and duplicates; it does not identify who approved, and it is not an access-control boundary.**

Known gap: if one new decision conflicts with two earlier ones, only the first is retired by "Replace".

## Claims to avoid in a pitch

"100% accurate", "verified approver" or any identity claim, "exactly-once execution", "dependency graph", "automatic speaker identification", "scheduled digests/reminders".

## Layout

- `lib/llm.ts`: providers (OpenRouter, Anthropic, Ollama), zod validation, per-model replay cache. `lib/paths.ts`: data directory (`DATA_DIR`).
- `lib/extract.ts`, `lib/conflicts.ts`, `lib/impact.ts`, `lib/confirm.ts`: prompts, validation, decision memory. `lib/evidence.ts`: deterministic quote and speaker check. `lib/resolution.ts`: deterministic parsing of spoken choices. `lib/gate.ts`: everything that must be settled before approval.
- `lib/proposals.ts`: server-held proposals and per-approval locking. `lib/trello.ts`, `lib/store.ts`: Trello cards and flat-JSON task storage.
- `app/api/*`: `extract`, `conflicts`, `impact`, `proposals`, `confirm`, `tasks`, `decisions`, `demo`, `health`.
- `app/page.tsx`, `app/decisions`, `app/digest`, `app/deadlines`: UI. `scripts/test.mjs`, `scripts/eval.mjs`, `scripts/prime.mjs`, `eval/`.

Runtime state (`data/items.json`, `data/proposals.json`, `data/learned-decisions.json`) is gitignored.

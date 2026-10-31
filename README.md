# Meeting → Execution Agent

Turns an engineering standup / sprint-planning transcript into confirmed, conflict-checked Trello tasks.

**It remembers decisions, shows the transcript evidence, says what a change may affect, and will not execute without a valid approval.**

## What it does

1. **Extracts** decisions and action items from a speaker-tagged transcript. Self-corrections ("X... actually no, Y") resolve to Y. Every item carries the transcript quote it came from; a non-LLM check marks any quote that is not found verbatim.
2. **Never guesses an owner.** Tentative offers ("I can look into it, no promises") are flagged as unconfirmed, and nothing is approved until each item has a confirmed owner.
3. **Detects conflicts** against remembered decisions, with the earlier meeting cited and the reasoning shown. Decisions about different systems or projects are not flagged just because they share a technology.
4. **Assesses impact separately**: which already-created tasks a decision may affect. A model may suggest task ids, but the server drops any id that is not a real stored task. Wording is always "may".
5. **Requires an explicit choice per conflict**: *Replace earlier decision*, *Keep both*, or *Needs clarification*. Only Replace retires the earlier decision. By button or by voice.
6. **Confirms by voice**: the app reads the summary back; dictate a correction ("change the second deadline to Friday") or say "confirm".
7. **Creates Trello cards only after valid approval.** The server holds the proposal and executes from it; the client only sends an id. Double-clicks and retries never duplicate cards, and failures are shown honestly with a Retry button.
8. **Digest** (per person, can be read aloud), **Deadlines** (UI-only "would notify" reminders).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

| Variable | Notes |
|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Default LLM. `nvidia/nemotron-3.5-super-vl:free` was used for everything here. **Free OpenRouter keys allow 50 requests/day**, which a few rehearsals can exhaust; see the replay cache below. |
| `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Optional fallback provider. |
| `LLM_CACHE` | `fallback` (default: save every reply; replay one only if the model fails), `prefer` (cache first: instant and uses no quota), `off` (required for evaluation). |
| `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_ID` | Without these, confirmed tasks are saved locally and no cards are created. |

Trello: create a board with a "To Do" list, create a key at https://trello.com/power-ups/admin, authorize a token, and get the list ID from `https://api.trello.com/1/boards/<shortcode>/lists?key=...&token=...`.

## Demo script

Transcripts are in `data/demo/`; seed decisions in `data/decisions.json`. Run the demo with `LLM_CACHE=prefer` after `npm run prime` so it is instant and works even if the model is rate-limited. Anything said differently from the lines below goes to the live model.

1. **Reset demo memory** (tick "also archive Trello cards created by this app").
2. **Meeting 1** (baseline: Postgres). Analyze, say `confirm`. No conflict.
3. **Meeting 2**. Redis → Memcached self-correction; "Switch to Mongo" conflicts with Postgres (Sprint Planning 12); the Postgres schema task is shown as potentially affected. Say `change the second deadline to Friday`, then `replace the earlier decision`, then `confirm`.
4. **Meeting 3**. "Move billing back to Postgres" conflicts with the Mongo decision from Sprint Planning 14, and shows the Mongo setup and migration tasks as potentially affected. Priya's "I can look into it" is flagged: `confirm` is blocked. Say `Priya owns the cache invalidation task, make it due Friday`, then `replace the earlier decision`, then `confirm`.
5. Open **Digest** and **Deadlines**.

## Replay cache and the free-tier limit

Every validated model reply is saved to `data/llm-cache.json` (committed) keyed by the exact prompt. `npm run prime` plays the whole demo script above through the app (about 13 model calls, creates then archives real Trello cards) so each step is saved. Afterwards, the full three-meeting demo replays in about 13 seconds with zero model requests.

## Evaluation

`LLM_CACHE=off npm run dev`, then `npm run eval -- --out eval/results.md`. It refuses to run with the cache on. 15 hand-written scenarios (4 held-out) covering self-correction, relative dates, unassigned and tentative ownership, ambiguous deadlines, direct reversals, same-technology-different-system, compatible decisions, and grounded impact.

- Baseline before the changes: `eval/results-baseline.md` (12 of 13 runnable scenarios passed).
- After: `eval/results-after.md` (15 of 15 passed).

**This is a small controlled benchmark, not a measure of real-world accuracy.** One run per scenario on a free model; the conflict scenarios already passed at baseline, so the run shows no regression there, not an improvement; the one fixed failure (E6) was fixed by a rule written knowing it was failing. Read the notes at the bottom of `eval/results-after.md`.

## Not implemented

Automatic speaker diarization (speaker tags are typed in the transcript), real email/SMS reminders, scheduled weekly digests, user authentication or verified approver identity, multi-user concurrency, and syncing task done-status back from Trello (impact treats tasks as "created, not tracked as done"). The approval check guards against bugs, replays and duplicates; it is not an access-control boundary.

## Layout

- `lib/llm.ts`: provider abstraction, zod validation, replay cache.
- `lib/extract.ts`, `lib/conflicts.ts`, `lib/impact.ts`, `lib/confirm.ts`: the prompts and validation. `lib/resolution.ts`: deterministic parsing of spoken conflict choices.
- `lib/proposals.ts`: server-held proposals and per-approval locking. `lib/trello.ts`, `lib/store.ts`: Trello cards and flat-JSON task storage.
- `app/api/*`: `extract`, `conflicts`, `impact`, `proposals`, `confirm`, `tasks`, `demo`, `health`.
- `app/page.tsx`, `app/digest`, `app/deadlines`: UI. `scripts/eval.mjs`, `scripts/prime.mjs`, `eval/`.

Runtime state (`data/items.json`, `data/proposals.json`, `data/learned-decisions.json`) is gitignored.

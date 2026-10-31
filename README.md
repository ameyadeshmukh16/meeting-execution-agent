# Meeting → Execution Agent

Turns an engineering standup / sprint-planning transcript into confirmed, conflict-checked Trello tasks.

1. **Extract** decisions, action items, owners and deadlines (self-corrections like "X... actually no, Y" resolve to Y).
2. **Detect conflicts** against past decisions, with visible reasoning and a reference to the earlier meeting.
3. **Confirm by voice**: the app reads the summary back; dictate a correction ("change the second deadline to Friday") or say "confirm".
4. **Create Trello cards** only after confirmation.
5. **Digest** (per person) and **Deadlines** (UI-only "would notify" reminders) views.

Confirmed decisions are remembered, so later meetings can conflict with them. Confirming a conflicting decision replaces the earlier one.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

| Variable | Notes |
|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Default LLM. A free model works; `nvidia/nemotron-3.5-super-vl:free` was tested. Free models can be rate-limited or withdrawn. |
| `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Optional fallback provider. |
| `LLM_CACHE` | `fallback` (default: replay a saved reply only if the LLM fails), `prefer` (cache first, for demos), `off`. |
| `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_ID` | Without these, confirmed tasks are saved locally and no cards are created. |

Trello: create a board with a "To Do" list, create a key at https://trello.com/power-ups/admin, authorize a token, and get the list ID from `https://api.trello.com/1/boards/<shortcode>/lists?key=...&token=...`.

## Demo script

Demo transcripts are in `data/demo/`. Seed decisions are in `data/decisions.json`.

1. **Reset demo memory** (button on the Meeting page; Trello cards are not touched).
2. Load **Meeting 1** (baseline: Postgres) and analyze. No conflict.
3. Load **Meeting 2**: "switch to Mongo" conflicts with Postgres (Sprint Planning 12). Also contains a self-correction (Redis → Memcached). Dictate a correction, then confirm.
4. Load **Meeting 3**: "move billing back to Postgres" conflicts with the Mongo decision from Sprint Planning 14.
5. Open **Digest** and **Deadlines**.

## Layout

- `lib/llm.ts`: provider abstraction, zod validation, replay cache (`data/llm-cache.json`).
- `lib/extract.ts`, `lib/conflicts.ts`, `lib/confirm.ts`: the three prompts.
- `lib/trello.ts`, `lib/store.ts`: Trello cards and flat-JSON task storage.
- `app/api/*`: `extract`, `conflicts`, `confirm`, `tasks`, `demo`.
- `app/page.tsx`, `app/digest`, `app/deadlines`: UI.

Runtime state (`data/items.json`, `data/learned-decisions.json`) is gitignored.

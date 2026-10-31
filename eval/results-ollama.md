# Evaluation results

- Date: 2026-10-31T13:14:11.008Z
- Model: ollama / qwen3:8b
- LLM cache: off
- **Small controlled benchmark (15 scenarios, single run).** Free models are non-deterministic, so treat differences of one scenario as noise. Not a statistically validated accuracy figure.

| Scenario | Set | Result | Detail |
|---|---|---|---|
| E1 Self-correction keeps only the final choice | tuned | PASS |  |
| E2 Relative dates resolve against the meeting date (Tuesday 2026-10-27) | tuned | FAIL | no task matching /auth/; no task matching /report/ |
| E3 Explicit acceptance gets an owner | tuned | FAIL | deadline 2026-11-03 (wanted 2026-10-29) |
| E4 Unassigned work does not get an invented owner | tuned | PASS |  |
| E5 Ambiguous deadline stays unresolved | tuned | PASS |  |
| E6 Investigation-only is not acceptance of ownership | held-out | PASS |  |
| E7 Open discussion is not a decision | held-out | PASS |  |
| C1 Direct reversal is a conflict | tuned | PASS |  |
| C2 Same technology on a different system is not a conflict | tuned | FAIL | false positive: d1 |
| C3 Same technology question on a different project is not a conflict | held-out | PASS |  |
| C4 Compatible decision is not a conflict | tuned | PASS |  |
| C5 A reversal conflicts with the CURRENT decision (replaced one already removed) | tuned | PASS |  |
| C6 Mixed batch: only the contradicting decision is flagged | held-out | PASS |  |
| I1 Decision affects an existing task that mentions the old technology | tuned | FAIL | missed affected t1 |
| I2 Impact is grounded: only genuinely related tasks, none invented | tuned | PASS |  |

| Metric | Value |
|---|---|
| Scenarios passed, tuned set | 7/11 |
| Scenarios passed, held-out set | 4/4 |
| Conflict precision | 75% (3/4) |
| Conflict recall | 100% (3/3) |
| False positives (conflicts) | 1 |
| Owner attribution accuracy | 67% (4/6) |
| Deadline accuracy | 25% (1/4) |
| Skipped (not implemented yet) | 0 |

## How to read this

- A separate provider, run with the same 15 scenarios and the cache off: local `qwen3:8b` via Ollama, no key, no quota. Compare with `results-after.md` (OpenRouter / Nemotron, 15 of 15).
- **The prompts were written and adjusted against the Nemotron model, not this one.** So this is not a fair "which model is better" test; it shows how much the results depend on the model, which is the point of running them separately.
- Where it fell short: both relative-date scenarios (E2 and E3: "Wednesday" and "next Monday" resolved wrongly or the tasks were missed), one false-positive conflict (C2: the same technology on a different system), and one missed impact (I1). Deadline accuracy was 1 of 4.
- It did pass all four held-out scenarios, but that is four cases on one run and means little on its own.
- Single run per scenario, 15 hand-written scenarios. Not a statistically validated accuracy figure.
- Conclusion: usable as a free, unlimited model for development and repeat runs; **not** a substitute for the primed demo model. The demo stays on OpenRouter / Nemotron with its replay cache.

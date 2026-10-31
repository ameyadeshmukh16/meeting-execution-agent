# Evaluation results

- Date: 2026-10-31T11:19:45.591Z
- Model: openrouter / nvidia/nemotron-3.5-super-vl:free
- LLM cache: off
- **Small controlled benchmark (15 scenarios, single run).** Free models are non-deterministic, so treat differences of one scenario as noise. Not a statistically validated accuracy figure.

| Scenario | Set | Result | Detail |
|---|---|---|---|
| E1 Self-correction keeps only the final choice | tuned | PASS |  |
| E2 Relative dates resolve against the meeting date (Tuesday 2026-10-27) | tuned | PASS |  |
| E3 Explicit acceptance gets an owner | tuned | PASS |  |
| E4 Unassigned work does not get an invented owner | tuned | PASS |  |
| E5 Ambiguous deadline stays unresolved | tuned | PASS |  |
| E6 Investigation-only is not acceptance of ownership | held-out | FAIL | gave "Investigate nightly job slowness" to Gowtham as if accepted |
| E7 Open discussion is not a decision | held-out | PASS |  |
| C1 Direct reversal is a conflict | tuned | PASS |  |
| C2 Same technology on a different system is not a conflict | tuned | PASS |  |
| C3 Same technology question on a different project is not a conflict | held-out | PASS |  |
| C4 Compatible decision is not a conflict | tuned | PASS |  |
| C5 A reversal conflicts with the CURRENT decision (replaced one already removed) | tuned | PASS |  |
| C6 Mixed batch: only the contradicting decision is flagged | held-out | PASS |  |
| I1 Decision affects an existing task that mentions the old technology | tuned | SKIP | impact assessment not implemented yet |
| I2 Impact is grounded: only genuinely related tasks, none invented | tuned | SKIP | impact assessment not implemented yet |

| Metric | Value |
|---|---|
| Scenarios passed, tuned set | 9/9 |
| Scenarios passed, held-out set | 3/4 |
| Conflict precision | 100% (3/3) |
| Conflict recall | 100% (3/3) |
| False positives (conflicts) | 0 |
| Owner attribution accuracy | 83% (5/6) |
| Deadline accuracy | 100% (4/4) |
| Skipped (not implemented yet) | 2 |

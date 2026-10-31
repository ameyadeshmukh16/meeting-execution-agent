# Evaluation results

- Date: 2026-10-31T12:12:03.287Z
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
| E6 Investigation-only is not acceptance of ownership | held-out | PASS |  |
| E7 Open discussion is not a decision | held-out | PASS |  |
| C1 Direct reversal is a conflict | tuned | PASS |  |
| C2 Same technology on a different system is not a conflict | tuned | PASS |  |
| C3 Same technology question on a different project is not a conflict | held-out | PASS |  |
| C4 Compatible decision is not a conflict | tuned | PASS |  |
| C5 A reversal conflicts with the CURRENT decision (replaced one already removed) | tuned | PASS |  |
| C6 Mixed batch: only the contradicting decision is flagged | held-out | PASS |  |
| I1 Decision affects an existing task that mentions the old technology | tuned | PASS |  |
| I2 Impact is grounded: only genuinely related tasks, none invented | tuned | PASS |  |

| Metric | Value |
|---|---|
| Scenarios passed, tuned set | 11/11 |
| Scenarios passed, held-out set | 4/4 |
| Conflict precision | 100% (3/3) |
| Conflict recall | 100% (3/3) |
| False positives (conflicts) | 0 |
| Owner attribution accuracy | 100% (6/6) |
| Deadline accuracy | 100% (4/4) |
| Skipped (not implemented yet) | 0 |

## How to read this

- Compare with `results-baseline.md`: same 15 scenarios, same model, cache off. Baseline was 12 of 13 runnable scenarios (E6 failed; the two impact scenarios did not exist yet). Now all 15 pass.
- The only baseline failure was E6 (investigation-only is not ownership). The rule that fixes it was written *knowing* E6 was failing, so E6 is not a clean held-out result. C3, C6 and E7 were not used to write or adjust any prompt rule.
- The conflict scenarios passed at baseline too, so this run does not show that conflict detection improved; it shows it did not regress. Three flagged conflicts is far too few to claim a precision figure.
- The impact prompt was tightened once, after a live call over-flagged tasks that carry out a decision. I1 and I2 (tuned set) were not what drove that change.
- Single run per scenario on a free model, 15 hand-written scenarios. Not a statistically validated accuracy figure.

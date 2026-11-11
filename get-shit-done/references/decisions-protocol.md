# Decisions protocol

One ledger for everything the CEO decided and everything assumed on their behalf: `.planning/DECISIONS.jsonl`, written only through `node "$HOME/.claude/get-shit-done/bin/decisions.js"` (below: `decisions`). Append-only; the last line per id wins. `.planning/DECISIONS.md` is its rendering (`decisions render`), never edited by hand. Commit both with the artifact that caused the change.

## Records

| id | kind | meaning | binding |
|---|---|---|---|
| `D-NN` | decision | the CEO answered | yes, while `active` |
| `A-NN` | assumption | nobody answered; a default was chosen and the question is queued | yes, while `open` or `confirmed` |
| `R-NN` | rework | an answer arrived after a consuming phase was built on a different default | ticket |

Every `A-` carries `default`, `reversibility` (`cheap` = one plan or less to change, `costly` = rework inside shipped phases, `irreversible` = data loss, money, a public contract, a legal/compliance position) and `phases` (the phases that consume it). `source` is where it arose: `prd:stage1|2|3`, `prd:approval`, `milestone-review`, `discuss-phase`, `escalation-timeout`, `ceo-answer`. A record with no phase yet (PRD time) is mapped at milestone review: `decisions map <id> --phases 12,13` or `--global`.

## Writing

- CEO answered: `decisions add --kind decision --source <s> --prd <slug> --question "<q>" --answer "<a>" [--phases N,M | --global]`
- Not answered (deferred, vague, unattended, timed out): `decisions add --kind assumption --source <s> --question "<q>" --default "<d>" --options "a,b" --reversibility cheap|costly|irreversible [--phases N,M]`
- One question per record, phrased so the answer is a choice, with the default you would defend. Record product choices only (behaviour, limits, copy, scope, policy); implementation choices stay in Claude's Discretion.

## Reading (planner, plan-checker, discuss, roadmapper)

- `decisions list --phase N` prints what binds phase N. Do not ask the CEO anything it answers.
- A plan cites the id beside the task that implements it (`(D-03)`, `(A-02, assumed)`). A task built on an `A-` keeps the default behind one seam (one function, config key or flag) and says where.
- `decisions check-plan --phase N <PLAN.md...>` fails when an id naming phase N is cited by no plan, a cited id does not exist, or a cited id was superseded. A plan that contradicts a binding record is a blocker even when it cites it.

## Never block

Unattended (`GSD_AUTONOMOUS=1`, or no reply within the step's own timeout) a workflow does not wait: it takes the default, writes the `A-`, and continues. The one exception is not a wait either: a phase with an open `irreversible` assumption is parked (`decisions gate --phase N` exits 2), the run goes on with the phases that do not depend on it, and the parked phase is reported at the end.

Queue delivery: `decisions digest --mark` prints the open questions not yet sent; the main orchestrator prints that text to the chat; CEO changes come back as chat messages. Never use `ask_blocking_question` for queue items: a timed-out question is deleted by the daemon and a late reply is lost.

## Answers

The CEO answers any time, in any session: `/gsd:decide A-NN <answer>` (or `A-NN ok`). `decisions answer` computes the outcome from the phase directories; nobody judges it:

| outcome | when | action |
|---|---|---|
| `confirmed` | answer equals the default | none |
| `applied` | differs, no consumer planned yet | none: planners read the new `D-` |
| `replan` | differs, a consumer has plans but no VERIFICATION | re-run plan-check for those phases; `check-plan` now fails on the stale id until the plans cite the new `D-` |
| `rework` | differs, a consumer is verified | open `R-NN`; insert a decimal phase after the last built consumer (`/gsd:insert-phase`) whose goal is the delta between default and answer; `decisions close R-NN --status done` when it verifies |
| `accepted-as-built` | CEO passed `--accept-as-built` | `R-NN` is `accepted`: shipped phases stay, the `D-` binds later phases only |

Rework is the default for a late differing answer. Accepting as built is the CEO's call, never an agent's.

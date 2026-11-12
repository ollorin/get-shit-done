# Decisions protocol

One ledger for everything the owner (title: `owner_title` in the init output) decided and everything assumed on their behalf: `.planning/DECISIONS.jsonl`, written only through `node "$HOME/.claude/get-shit-done/bin/decisions.js"` (below: `decisions`). Append-only; the last line per id wins. `.planning/DECISIONS.md` is its rendering (`decisions render`), never edited by hand. Commit both with the artifact that caused the change.

## Records

| id | kind | meaning | binding |
|---|---|---|---|
| `D-NN` | decision | the owner answered | yes, while `active` |
| `A-NN` | assumption | nobody answered; a default was chosen and the question is queued | yes, while `open` or `confirmed` |
| `R-NN` | rework | an answer arrived after a consuming phase was built on a different default | ticket |

Every `A-` carries `default`, `reversibility` (`cheap` = one plan or less to change, `costly` = rework inside shipped phases, `irreversible` = data loss, a risk-domain effect, a public contract, a legal/compliance position) and `phases` (the phases that consume it). `source` is where it arose: `prd:stage1|2|3`, `prd:approval`, `milestone-review`, `discuss-phase`, `escalation-timeout`, `owner-answer`. A record with no phase yet (PRD time) is mapped at milestone review: `decisions map <id> --phases 12,13` or `--global`.

## Writing

- owner answered: `decisions add --kind decision --source <s> --prd <slug> --question "<q>" --answer "<a>" [--phases N,M | --global]`
- Not answered (deferred, vague, unattended, timed out): `decisions add --kind assumption --source <s> --question "<q>" --default "<d>" --options "a,b" --reversibility cheap|costly|irreversible [--phases N,M]`
- One question per record, phrased so the answer is a choice, with the default you would defend. Record product choices only (behaviour, limits, copy, scope, policy); implementation choices stay in Claude's Discretion.

## Reading (planner, plan-checker, discuss, roadmapper)

- `decisions list --phase N` prints what binds phase N. Do not ask the owner anything it answers.
- A plan cites the id beside the task that implements it (`(D-03)`, `(A-02, assumed)`). A task built on an `A-` keeps the default behind one seam (one function, config key or flag) and says where.
- `decisions check-plan --phase N <PLAN.md...>` fails when an id naming phase N is cited by no plan, a cited id does not exist, or a cited id was superseded. A plan that contradicts a binding record is a blocker even when it cites it.

## Never block

Questions on a risk-domain path or in `ruling_topics` (always auth and security) are not parked for the owner: they go to an Opus-tier ruling dispatch (project CLAUDE.md) and the ruling is recorded as a `D-` decision. Only strategic or business/legal calls are queued and shown in chat, with work continuing on the default.

A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains. When `risk_domains_source` is `builtin` (`project.risk_domains` in config.json is empty or absent), every path that mutates state is a risk-domain path. Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).

This ruling route applies to every writer of the ledger, not only the phase coordinator: `prd.md`, `new-milestone.md` (roadmapper `new` rows) and any other workflow must send a row about a risk-domain path or a ruling topic to the ruling dispatch (`model: "fable"` while the Fable allowance lasts, else `"opus"`, say so) BEFORE logging it, and log the result as `decisions add --kind decision --source opus-ruling`. If no ruling can be obtained, log it `costly`, never as an open `irreversible` row. An `irreversible` row is mapped only to the phases that consume it (never `--global` unless every phase does), so `gate` holds only those phases and the others continue; whenever `gate` exits 2 the orchestrator prints the open question in chat. Nothing waits on a reply.

Unattended (`GSD_AUTONOMOUS=1`, or no reply within the step's own timeout) a workflow does not wait: it takes the default, writes the `A-`, and continues. The one exception is not a wait either: a phase with an open `irreversible` assumption is parked (`decisions gate --phase N` exits 2; exit 3 means a corrupt ledger and is treated as a park, never as a pass; `decisions repair` fixes duplicate ids and conflict markers), the run goes on with the phases that do not depend on it, and the parked phase is reported at the end.

Queue delivery: `decisions digest` prints the open questions not yet sent; the main orchestrator prints that text to the chat and only then runs `digest --mark-only`; owner changes come back as chat messages. Never use `ask_blocking_question` for queue items: a timed-out question is deleted by the daemon and a late reply is lost.

## Answers

The owner answers any time, in any session: `/gsd:decide A-NN <answer>` (or `A-NN ok`). `decisions answer` computes the outcome from the phase directories; nobody judges it:

| outcome | when | action |
|---|---|---|
| `confirmed` | answer equals the default | none |
| `applied` | differs, no consumer planned yet | none: planners read the new `D-` |
| `replan` | differs, a consumer has plans but no VERIFICATION | re-run plan-check for those phases; `check-plan` now fails on the stale id until the plans cite the new `D-` |
| `rework` | differs, a consumer is verified | open `R-NN`; insert a decimal phase after the last built consumer (`/gsd:insert-phase`) whose goal is the delta between default and answer; `decisions close R-NN --status done` when it verifies |
| `accepted-as-built` | owner passed `--accept-as-built` | `R-NN` is `accepted`: shipped phases stay, the `D-` binds later phases only |

Rework is the default for a late differing answer. Accepting as built is the owner's call, never an agent's.

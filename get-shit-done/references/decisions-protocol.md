# Decisions protocol

One ledger for everything the owner (title: `owner_title` in the init output) decided and everything assumed on their behalf: `.planning/DECISIONS.jsonl`, written only through `node "$HOME/.claude/get-shit-done/bin/decisions.js"` (below: `decisions`; a separate script, never a `gsd-tools` command). Append-only; the last line per id wins. `.planning/DECISIONS.md` is its rendering (`decisions render`), never edited by hand. Commit both with the artifact that caused the change.

## Records

| id | kind | meaning | binding |
|---|---|---|---|
| `D-NN` | decision | the owner answered | yes, while `active` |
| `A-NN` | assumption | nobody answered; a default was chosen and the question is queued | yes, while `open` or `confirmed` |
| `R-NN` | rework | an answer arrived after a consuming phase was built on a different default | ticket |

Every `A-` carries `default`, `reversibility` (`cheap` = one plan or less to change, `costly` = rework inside shipped phases, `irreversible` = data loss, a risk-domain effect, a public contract, a legal/compliance position) and `phases` (the phases that consume it). `source` is where it arose: `prd:stage1|2|3`, `prd:approval`, `milestone-review`, `discuss-phase`, `escalation-timeout`, `owner-answer`. A record with no phase yet (PRD time) is mapped at milestone review: `decisions map <id> --phases 12,13 --milestone <v>` or `--global`. `milestone` is optional: `decisions validate --mapped --milestone <v>` checks only records tagged `<v>` (`add`/`map --milestone <v>`), so PRD-time records of other milestones do not fail the current one. A spike or validation phase that exists to test an assumption maps it with `--phases N,M --validates N`: `gate --phase N` does not park N for that record (every other phase in `phases` still parks); `validates` must be a subset of `phases`.

## Writing

- owner answered: `decisions add --kind decision --source <s> --prd <slug> --question "<q>" --answer "<a>" [--phases N,M | --global]`
- Not answered (deferred, vague, unattended, timed out): `decisions add --kind assumption --source <s> --question "<q>" --default "<d>" --options "a,b" --reversibility cheap|costly|irreversible [--phases N,M]`
- One question per record, phrased so the answer is a choice, with the default you would defend. Record product choices only (behaviour, limits, copy, scope, policy); implementation choices stay in Claude's Discretion.

## Reading (planner, plan-checker, discuss, roadmapper)

- `decisions list --phase N` prints what binds phase N. Do not ask the owner anything it answers.
- Cite a record by id everywhere (`D-03`, `A-02`), never as `DECISIONS.md:<line>`: the file is a render and its lines move on every `add`. To quote a record, quote its text.
- A plan cites the id beside the task that implements it (`(D-03)`, `(A-02, assumed)`). A task built on an `A-` keeps the default behind one seam (one function, config key or flag) and says where.
- `decisions check-plan --phase N <PLAN.md...>` fails when an id naming phase N is cited by no plan, a cited id does not exist, or a cited id was superseded. A plan that contradicts a binding record is a blocker even when it cites it.

## Never block

A question gets a ruling only when it is on the trigger row of `references/rigour.md`: irreversible, legally or financially material, or a design choice on a risk-domain path or in `ruling_topics` (always auth and security). Such a question is not parked for the owner: it goes to one ruling dispatch on `{ruling_model}` (the configured top model, `references/models.md`), all open questions of the step in the same dispatch, and the ruling is recorded as a `D-` decision. Everything else, risk domain or not, takes the default and one `A-` row, with no dispatch (rule 5 there). Only strategic or business/legal calls are queued and shown in chat, with work continuing on the default.

A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains. When `risk_domains_source` is `builtin` (`project.risk_domains` in config.json is empty or absent), every path that mutates state is a risk-domain path. Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).

This route binds every writer of the ledger (`prd.md`, `new-milestone.md`, any workflow): a row that meets the trigger goes to the ruling dispatch (one retry on `{ruling_model_fallback}`, say so) BEFORE it is logged, and the result is logged as `decisions add --kind decision --source opus-ruling` (a stored source name, not a model). If no ruling can be obtained, log it `costly`, never as an open `irreversible` row. An `irreversible` row is mapped only to the phases that consume it (never `--global` unless every phase does), so `gate` holds only those phases and the others continue; whenever `gate` exits 2 the orchestrator prints the open question in chat. Nothing waits on a reply.

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

## Roadmap decision points

Used by `new-project` and `new-milestone`, after the roadmapper returns and before the roadmap approval prompt. The roadmapper's `## Decision Points` table holds, per phase, the questions `/gsd:discuss-phase` would otherwise ask later, and maps existing records to phases.

1. Apply every `map` row: `decisions map <id> --phases <N,M> --milestone <v>` (or `--global`; add `--validates <N>` when phase N exists to test the record).
2. Rows that meet the ruling trigger (see "Never block") are not asked and not queued: one ruling dispatch for all of them, logged as `D-` rows (`--source opus-ruling`) before anything else. Ask the remaining new rows now, grouped by phase, irreversible and costly first, at most 4 per AskUserQuestion call and 12 in total. Answered: `decisions add --kind decision --source milestone-review --phases <N>`. Not asked or not answered: `decisions add --kind assumption --source milestone-review --default "<roadmapper default>" --reversibility <r> --phases <N>`.
3. Unattended (`GSD_AUTONOMOUS=1`): ask nothing; every new row becomes an `A-`; skip the approval prompt and treat the roadmap as approved.
4. `decisions validate --mapped --milestone <v>` must pass (every record names its consuming phases). If it fails with `no consuming phase` and `GSD_AUTONOMOUS=1`: run `decisions map <id> --global` for each id it names that is not `irreversible` (an `irreversible` id is mapped to the phases its roadmapper row names, else to the last roadmap phase, never global), log `unmapped_made_global` with the ids, and re-validate; interactively, ask which phases consume it. Then `decisions render`. Print `decisions digest` output to the chat, then run `decisions digest --mark-only`.
5. An answer that changes phase scope or order: re-spawn the roadmapper with it as revision context before asking for approval.

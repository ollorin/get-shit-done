# M-PILOT-TRANSCRIPT: interview dry run (task 7.3)

Run of `workflows/new-project.md` steps 1, 4.5 and 5.6 in auto mode, executed by the plan executor (Sonnet 5.5) acting as the workflow. Worktree `gsd-tools.js` and `decisions.js`, never the installed ones. Project: tmp git repo `.tmp/pilot-interview/`, `GSD_HOME=.tmp/pilot-interview-home`. No research, requirements or roadmap step ran. Idea document: 15 lines, a non-web command-line log summariser ("logtally") with a Python test command.

## Questions, and where each answer came from

| Step | Question | Source |
|---|---|---|
| 1 | project exists? git present? | detection (`init new-project`: `project_exists` false, `has_git` true) |
| 4.5 | owner title | idea document ("Maintainer") |
| 4.5 | risk domains | not stated: assumption A-01, `[]`, costly |
| 4.5 | compliance, config dimensions, autonomy policy | idea document ("none", "not applicable", flags are autonomous) |
| 4.5 | ruling topics | not stated: assumption A-02, `[]`, cheap |
| 5.6.1 | preset | default `base` (`available_presets`: base, igaming) |
| 5.6.1 | backend capability | idea document does not rule it out: `{}` (on), no record |
| 5.6.1 | web UI capability | idea document: no web interface: `false`, assumption A-03, costly |
| 5.6.2 | test_all | idea document (`python3 -m pytest tests/`) |
| 5.6.2 | test_file | derived from test_all: assumption A-04, cheap |
| 5.6.2 | typecheck, lint | idea document ("no type checker or linter"): literal `true`, no record |
| 5.6.2 | locked commands, flake patterns, dependency scan | none stated, no lockfile: `[]`, key omitted, step skipped |
| 5.6.2a | style rule set | detection from the document (Python): `python`, roots `["src"]`; no question whether the gate runs |
| 5.6.3-4 | paths, services | none (command-line tool): keys omitted |
| 5.6.5 | UI QA driver | none: no `ui_qa` key, assumption A-05, costly |
| 5.6.6 | never-touch deploy targets | idea document ("No deployments exist"): `[]` |

## Values written

- `stack.capabilities`: `{ "backend": {}, "web_ui": false }`.
- `stack.style`: `{ "rule_set": "python", "roots": ["src"] }`. Style section of `STACK-PROFILE.md`: the four `idioms` of `rule-sets/python.json` (errors as result values, tuples and frozen dataclasses, dispatch table or `match`, pure domain functions).
- Never-touch: `stack.deploy.never_touch: []`; the deny rows `init` rendered: 5 inert rows `Bash(gsd-unused-deploy-entry-N:*)` (N = 1..5) among 47 deny rows.
- Default gates the wiring wrote, 8 (no `assertion-quality`, web UI is off): hook-canaries, hook-patch-trailer, guard-canaries, guard-registry, style, flake-patterns, dependency-scan, adr.
- Wiring defaults: `port_base` 55000, `container_suffix` `pilot-interview`, branch `main`, `search` `git grep -n`, `pre_pr_gate` `scripts/pre-pr-gate.sh`.

## Commands run (exit code)

| Command | Exit |
|---|---|
| `init new-project` (before anything: `context_gate.ok` false, 7 keys missing) | 0 |
| `decisions.js add` x5 (A-01 to A-05) | 0 |
| `profile check` (`ok`, no missing, no invalid) | 0 |
| `project init --root <p> --preset base` (82 files, all `create`, no conflict, `refused` null) | 0 |
| `project diff --root <p> --preset base` (0 rows other than `unchanged`) | 0 |
| `init plan-phase 1` (no `--legacy`, `GSD_LEGACY` unset; `legacy` false) | 0 |
| `init execute-phase 1` | 0 |
| `init new-project` again (`context_gate.ok` true) | 0 |
| `node scripts/style-gate.mjs`, first run: `roots entry is not a directory: src` | 1 |
| same, after `mkdir src` with an empty `.gitkeep` and a commit | 0 |

## Files written

Tracked after `init`, excluding `src/`: 173 files, of which 82 are base copies under `.planning/.gsd-preset-base/`; the other 91 are 87 deployed files plus `config.json`, `PRODUCT-BRIEF.md`, `STACK-PROFILE.md`, `ROADMAP.md` (11,472 lines without the base copies).
- Present (backend on): `.claude/rules/handler-correctness.md`, `.claude/rules/data-integrity.md`, `.claude/skills/vibe-security/SKILL.md`.
- Absent (web UI off): `.claude/rules/e2e-assertions.md`, `.claude/rules/frontend-testability.md`, `.claude/rules/qa-exemptions.md`, `scripts/validation/check-assertion-quality.mjs`.

## Assumption records

| Id | Subject | Reversibility |
|---|---|---|
| A-01 | risk domains empty, so every state-mutating path is a risk-domain path | costly |
| A-02 | ruling topics empty | cheap |
| A-03 | web UI capability off | costly (the workflow names no value, see finding 2) |
| A-04 | `test_file` derived from `test_all` | cheap |
| A-05 | no UI QA driver | costly |

## Final state, checked by commands

- `profile check`: exit 0.
- `init plan-phase 1`: exit 0 without `--legacy`; `context_gate` ok; `risk_domains` = `auth`, `security`, source `builtin` (the brief lists none).
- `project diff --root <p> --preset base`: exit 0.
- `decisions.js list`: A-01 (costly), A-02 (cheap), A-03 (costly), A-04 (cheap), A-05 (costly), all `assumed`. The plan expects the `risk_domains` and `never_touch` records as `costly`: `risk_domains` is A-01 (costly); `never_touch` has no record because the document states it (finding 4).
- `node scripts/style-gate.mjs`: exit 0 (`scanned 0 files under src - nothing was checked`).

Wall time, first command to last check: about 60 s, of which the commands took under 1.5 s in total.

## Findings against the workflow text

1. Fixed (`new-project.md` 2a): a style root that does not exist yet makes the gate exit 1 on the first run. The text now says to create each new root with an empty `.gitkeep`.
2. Fixed (5.6 auto mode): "record each off as an assumption, as in 4.5" gave no reversibility; it now says `--reversibility costly`.
3. Fixed (5.6 auto mode): "no type checker or linter" in the document was ambiguous between an assumption and a stop ("nothing detected, stop"). It now says the literal `true`, no assumption.
4. Open, for the plan: the task text expects a `costly` record for `never_touch`; the workflow records one only when the document is silent. The document here stated "no deployments", so none exists. Not changed.
5. Open: the brief template has no row for "no risk domain stated"; the run wrote an assumption row by hand, citing the A- id. A- ids are `A-01` style, two digits.
6. Open: with no `risk_domains` the context is `builtin` (strict), correct but easy to misread as "none"; `init` prints `all_state_mutating: true`.
7. Open: the style gate exits 0 with nothing scanned, so a new project is green before any code exists (intended by 9.2, noted).

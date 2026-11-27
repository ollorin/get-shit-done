# igaming preset (snapshot)

- Source repo: igaming-platform
- Pinned SHA: befec478db4b5e48b22cb0b83ec002bea855c49b
- Branch at pin: feature/codebase-review-hardening (HEAD of the checkout at the refresh)
- Snapshot date: 2026-11-27 (first snapshot 2026-11-11 at 95a02959; refreshed 2026-11-14 at 77555e48 and here)
- Tracked files only, taken with `git archive` (never the working tree).

## Layout

| src (preset) | dest (project) | files |
|---|---|---|
| `CLAUDE.md` | `CLAUDE.md` | 1 |
| `rules/` | `.claude/rules/` | 12 |
| `hooks/` | `.claude/hooks/` | 19 |
| `skills/` | `.claude/skills/` | 15 |
| `canaries/` | `scripts/validation/hook-canaries/` | 2 |

All 49 entries are `kind: whole`, `render: false`. `settings.snapshot.json` is the pinned settings file minus the dropped `MODEL_PROFILE` allow rule (see Overrides) and is not in `files`.

## Overrides (models.top design)

`golden.sha256` holds the pinned igaming bytes; `overrides.sha256` holds the deployed bytes of the two files this preset changes on purpose, `CLAUDE.md` and the settings file (`G7`, `G8` in `preset-igaming.test.js` enforce it). Everything else is byte-equal to the pin.

- `CLAUDE.md` "Subagent Usage": one `models.top` alias (`fable` or `opus`) plus `models.top_fallback` replaces the Fable-allowance wording and the "inherit the spawner's tier" sentence; `gsd-test-writer` leaves the haiku line and `gsd-planner` the sonnet line; the top-model line reads `every plan`; the review section is the one final top-model pass merged with verification, `{N}-REVIEW.md` (`passes`, `open_critical_high`, `ruled_by`), risk phases pass 1, one fix, a fresh pass 2, one fix, one sonnet re-check, one ruling (`get-shit-done/references/rigour.md` rules 11, 12). Removed: sonnet implementation-review rounds, the batched diff review, the adversary-view section.
- Settings: the `Bash(*MODEL_PROFILE=*)` allow rule is dropped (the model profile concept is gone), so `permissions.allow` has 289 entries.

## Config and ROADMAP guidance for an igaming checkout

The preset does not write `.planning/config.json`; the project owns it. Set `models.top` (`fable` or `opus`) and `models.top_fallback`; delete `model_profile` and every `workflow.budget.*.dispatches` key (ignored by the current tools). Every unfinished high-stakes phase in the ROADMAP needs a `**Risk domains:**` line whose tokens come from `project.risk_domains` in `project.block.json` (money, payment, ledger, settlement, auth, rng, kyc), or `none`; `owner-gate request --kind roadmap` fails without it.

## Settings

`settings.snapshot.json` is the pinned file with that one allow rule dropped and is never deployed. `settings.fragment.json` is its `permissions` (allow/deny/ask) and `hooks`. The keys `env`, `enableAllProjectMcpServers`, `enabledPlugins`, `sandbox` are not deployed by the current engine. Deployed settings are set-equal to the snapshot, not byte-equal.
Phase H must carry these four keys (env, enableAllProjectMcpServers, enabledPlugins, sandbox): the engine does not deploy them.

## Scan

- `scanDir` over the 54 preset files: 0 hits. `rules/edge-functions.md` is byte-equal to the pin (the former `assigned_secret` false positive on `env(...)` is fixed in B-FIX2).

## Not changed in this snapshot

- Absolute user paths are kept verbatim (10 in the settings file, 1 in `CLAUDE.md`, 122 in `canaries/canaries.jsonl`) until Phase F turns them into `{{project.root}}`.
- The Charlotte MCP allow rules stay in the fragment until the pack exists (Phase F).
- Canaries are data until Phase F1: the runner needs `jq`, `perl`, macOS `date -v` and hooks under `~/.claude`.

## Do not use for a new project

The fragment contains mutating allow rules scoped to the igaming checkout (for example `rm -rf` under its `.tmp/`). Do not run `project init --preset igaming` in another repo. The reviewed base subset is Phase F4.

## Adopting an existing checkout

`project adopt-diff --preset igaming` previews, `project adopt --preset igaming` writes the manifest, the `.planning/.gsd-preset-base` mirror, the missing default keys in `.planning/config.json` (only default gates whose script the preset ships or the project has) and the registry entry in `projects.json`; it commits nothing and prints every path it wrote. No preset file is written or changed: byte-equal files are recorded, edited files are LOCAL (kept, the preset copy becomes the merge base), absent files are left for `project sync`. Left out of this snapshot on purpose: `.claude/rules/shared-stack.md` (new in the source after the earlier pin, cites source-repo commits and paths; adopt reports nothing for it, it is not a preset file). `CLAUDE.md` stays LOCAL in the source until the models.top wording is applied there.

## Re-verify against the source

```
git -C <igaming-checkout> archive befec478db4b5e48b22cb0b83ec002bea855c49b CLAUDE.md .claude scripts/validation/hook-canaries | tar -x -C <empty-dir>
shasum -a 256 -c golden.sha256   (run inside <empty-dir>; expect every line OK)
```

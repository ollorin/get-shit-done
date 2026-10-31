# GSD v2 KPI table  window [2026-09-27 15:58Z, 2026-10-31 15:58Z)  transcripts 4326  spawns 3983  est $6794

## Per role x model
| role | model | spawns | active h | est $ | $/spawn | first-turn tok (med) |
|---|---|---|---|---|---|---|
| gsd-executor | sonnet | 593 | 299.6 | 1941 | 3.27 | 36864 |
| gsd-phase-coordinator | sonnet | 88 | 495.4 | 1085 | 12.33 | 33306 |
| general-purpose | opus | 433 | 52.1 | 945 | 2.18 | 34001 |
| general-purpose | sonnet | 686 | 51.2 | 624 | 0.91 | 34135 |
| gsd-planner | opus | 105 | 19.7 | 411 | 3.92 | 29721 |
| gsd-executor | haiku | 509 | 99.4 | 342 | 0.67 | 37300 |
| gsd-verifier | opus | 84 | 8.9 | 221 | 2.63 | 32110 |
| gsd-plan-checker | opus | 70 | 6.8 | 189 | 2.70 | 37428 |
| general-purpose | haiku | 1026 | 95.8 | 184 | 0.18 | 33925 |
| MAIN-session | sonnet | 5 | 328.4 | 151 | 30.26 | 62740 |
| charlotte-runner-session | haiku | 334 | 37.0 | 125 | 0.37 | 43191 |
| MAIN-session | opus | 4 | 128.1 | 122 | 30.56 | 83940 |
| gsd-executor | opus | 29 | 6.2 | 84 | 2.90 | 35786 |
| gsd-debugger | sonnet | 44 | 12.4 | 57 | 1.30 | 28831 |
| gsd-phase-researcher | opus | 4 | 1.0 | 40 | 9.91 | 29622 |
| fork | opus | 16 | 1.7 | 38 | 2.34 | 122769 |
| gsd-test-writer | sonnet | 20 | 3.7 | 28 | 1.41 | 19975 |
| gsd-debugger | opus | 7 | 3.7 | 26 | 3.70 | 27636 |
| gsd-phase-researcher | sonnet | 10 | 1.6 | 25 | 2.46 | 31853 |
| fork | sonnet | 6 | 21.7 | 23 | 3.90 | 22672 |
| gsd-plan-checker | sonnet | 32 | 2.1 | 23 | 0.72 | 37674 |
| gsd-phase-coordinator | opus | 3 | 5.9 | 23 | 7.61 | 30873 |
| gsd-charlotte-qa | sonnet | 23 | 7.7 | 17 | 0.74 | 36679 |
| gsd-plan-attacker | opus | 18 | 0.9 | 13 | 0.71 | 23430 |
| gsd-planner | sonnet | 14 | 0.8 | 9 | 0.64 | 30558 |
| gsd-plan-judge | opus | 20 | 0.5 | 9 | 0.44 | 24833 |
| gsd-docs-updater | sonnet | 11 | 0.6 | 9 | 0.80 | 28746 |
| gsd-docs-updater | haiku | 70 | 1.7 | 7 | 0.10 | 28549 |
| gsd-test-writer | opus | 1 | 0.8 | 6 | 6.40 | 23266 |
| Explore | sonnet | 13 | 0.5 | 5 | 0.37 | 17241 |
| gsd-test-writer | haiku | 9 | 0.6 | 2 | 0.25 | 25764 |
| gsd-verifier | sonnet | 4 | 0.4 | 2 | 0.54 | 31739 |
| gsd-plan-defender | sonnet | 17 | 0.1 | 2 | 0.11 | 23469 |
| gsd-charlotte-qa | haiku | 5 | 1.3 | 1 | 0.14 | 37758 |
| Explore | haiku | 6 | 0.1 | 0 | 0.02 | 15349 |

## KPIs
| area | KPI | value |
|---|---|---|
| tokens | fresh / cache-write / cache-read / output (M) | 74 / 1019 / 22042 / 106 |
| coordinator | spawns / active h | 91 / 501 |
| coordinator | cache-write M / cache-read M / ratio | 338 / 734 / 0.460 |
| coordinator | poll calls / poll h / share of active | 3885 / 454 / 90.6% |
| coordinator | cache-miss turns (idle>=300s) / tokens rewritten M / premium $ | 2110 / 341 / 806 |
| executor | spawns / active h | 1131 / 405 |
| executor | wait-poll h / share of active / calls | 109 / 27.0% / 3253 |
| executor | unit+integration test h / share; mutation-cmd h | 90 / 22.3%; 5.8 |
| review | plans reviewed | 157 |
| review | Sonnet reviews / Opus reviews (non-Sonnet incl. Haiku) / rulings / fix agents per plan | 2.32 / 0.20 (0.87) / 1.25 / 0.52 |
| review | Sonnet zero-finding share; review+ruling share of est $ | 21.5%; 25.8% |
| mutation | mutation-described spawns / active h / est $ | 131 / 23 / 78 |
| mutation | mutation Bash calls / tool-wait h | 4806 / 7.4 |
| git | non-merge commits / changed lines | 4451 / 1956197 |
| git | .planning share of changed lines; src+migrations share | 51.2%; 17.5% |
| git | planning/docs-only commit share | 45.9% |
| reliability | transcripts ended on API error (top roles) | 113  [('general-purpose', 41), ('gsd-executor', 35), ('gsd-phase-coordinator', 15), ('gsd-plan-checker', 8), ('gsd-test-writer', 4)] |
| reliability | resume-style spawns / est $; coordinator resumes / share | 223 / 929; 38 / 41.8% |
| reliability | compactions / transcripts with one; executors with compaction / rate | 475 / 363; 244 / 21.6% |
| reliability | API error events by kind (capped 60/file) | {'network': 6, 'weekly_limit': 115, 'model_unavailable': 84, 'session_limit': 39, 'malformed_200': 62, "other:[{'type': 'text', 'text': 'api error: upstream idl": 1, 'other:[{\'text\': "api error: opus 5.5\'s safeguards flagge': 1} |
| charlotte | runner runs / median wall min | 334 / 6.6 |
| charlotte | screenshot calls / p50 s / p90 s / mean s | 522 / 180.0 / 180.0 / 173.3 |
| charlotte | screenshot timeouts / ok calls (p50 s) / share of runner wall lost (aggregate; per-run median) | 498 / 24 (0.1) / 67.7% (67.1%) |

## Startup first-turn tokens (median / p90, spawns with first turn >10k tok)
| role | model | n | median | p90 |
|---|---|---|---|---|
| general-purpose | haiku | 993 | 33925 | 48242 |
| general-purpose | sonnet | 634 | 34135 | 47482 |
| gsd-executor | sonnet | 346 | 36864 | 38408 |
| gsd-executor | haiku | 507 | 37300 | 38670 |
| general-purpose | opus | 426 | 34001 | 55932 |
| charlotte-runner-session | haiku | 334 | 43191 | 45444 |
| gsd-planner | opus | 104 | 29721 | 31655 |
| gsd-phase-coordinator | sonnet | 56 | 33306 | 35126 |
| gsd-verifier | opus | 82 | 32110 | 33154 |
| gsd-plan-checker | opus | 63 | 37428 | 39203 |
| gsd-docs-updater | haiku | 70 | 28549 | 29293 |
| gsd-debugger | sonnet | 23 | 28831 | 29679 |
| gsd-plan-checker | sonnet | 22 | 37674 | 38285 |
| gsd-executor | opus | 25 | 35786 | 37694 |
| gsd-charlotte-qa | sonnet | 22 | 36679 | 36860 |
| gsd-test-writer | sonnet | 8 | 19975 | 24882 |

## Self-test vs 01-SESSION-ANALYSIS.md
| metric | 01 value | v2 value | dev | within 1% |
|---|---|---|---|---|
| transcripts | 4324 | 4326 | +0.05% | yes |
| tokens fresh M | 74 | 74.1 | +0.13% | yes |
| tokens cache-write M | 1018 | 1018.8 | +0.08% | yes |
| tokens cache-read M | 22015 | 22042.4 | +0.12% | yes |
| tokens output M | 106 | 105.9 | -0.10% | yes |
| est $ total (tier sum 4003+2126+660) | 6789 | 6794.0 | +0.07% | yes |
| executor sonnet spawns | 593 | 593 | +0.00% | yes |
| executor sonnet est $ | 1941 | 1940.9 | -0.01% | yes |
| executor sonnet active h | 300 | 299.6 | -0.13% | yes |
| coordinator sonnet est $ | 1085 | 1085.1 | +0.01% | yes |
| coordinator sonnet active h | 495 | 495.4 | +0.08% | yes |
| coordinator active h (all models) | 501 | 501.3 | +0.05% | yes |
| coordinator poll calls | 3883 | 3885 | +0.05% | yes |
| coordinator poll h | 454 | 453.9 | -0.02% | yes |
| coordinator poll share of active | 0.906 | 0.906 | -0.05% | yes |
| coordinator cache-write M (01: 333 = sonnet coordinators) | 333 | 333.0 | +0.01% | yes |
| executor active h | 405 | 405.2 | +0.05% | yes |
| executor wait h | 109 | 109.4 | +0.37% | yes |
| executor wait share | 0.27 | 0.270 | +0.01% | yes |
| Sonnet reviews / reviewed plan | 2.31 | 2.318 | +0.37% | yes |
| "Opus" reviews / reviewed plan (01 counts every non-Sonnet reviewer, Haiku included) | 0.86 | 0.866 | +0.73% | yes |
| rulings / reviewed plan | 1.25 | 1.255 | +0.38% | yes |
| fix agents / reviewed plan | 0.52 | 0.516 | -0.78% | yes |
| Sonnet zero-finding share | 0.216 | 0.215 | -0.35% | yes |
| non-merge commits | 4452 | 4451 | -0.02% | yes |
| git changed lines | 1960000 | 1956197 | -0.19% | yes |
| .planning share of changed lines | 0.512 | 0.512 | -0.00% | yes |
| src+migrations share (11.6+5.9) | 0.175 | 0.175 | +0.09% | yes |
| transcripts ended on API error [01 per-role list sums to 113, headline says 128] | 128 | 113 | -11.72% | NO |
| resume-style spawns | 223 | 223 | +0.00% | yes |
| resume-style spawns est $ | 928 | 929.4 | +0.15% | yes |
| coordinator resume-style spawns | 38 | 38 | +0.00% | yes |
| compactions | 475 | 475 | +0.00% | yes |
| transcripts with compaction | 363 | 363 | +0.00% | yes |
| executors with compaction | 244 | 244 | +0.00% | yes |
| charlotte runner runs | 334 | 334 | +0.00% | yes |
| charlotte screenshot calls | 522 | 522 | +0.00% | yes |
| charlotte screenshot timeouts | 498 | 498 | +0.00% | yes |
| charlotte screenshot mean s | 173.3 | 173.3 | -0.00% | yes |
| charlotte screenshot p90 s | 180.0 | 180.0 | +0.02% | yes |
| charlotte timeouts share of runner wall (25.1h/37h) | 0.68 | 0.677 | -0.43% | yes |
| charlotte runner median wall min | 6.6 | 6.628 | +0.42% | yes |
| sonnet-coordinator cache-miss turns (>=300s idle) | 2026 | 2026 | +0.00% | yes |
| sonnet-coordinator miss tokens rewritten M | 325 | 325.4 | +0.11% | yes |
| sonnet-coordinator cache-miss premium $ (01: 767) | 767 | 767.0 | +0.01% | yes |

within 1%: 44 of 45

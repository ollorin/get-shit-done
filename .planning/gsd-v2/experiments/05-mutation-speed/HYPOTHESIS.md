# Experiment 05 - mutation wall-time (hypothesis)

CEO: "my main problem is how long mutations take". 05-M8 estimated mutation at 3.1% of hours / 1.2% of $ from keywords.

H1. Keyword classification undercounts: mutant test runs, db resets and waits sit inside executor spawns that never say "mutation". True share is >10% of agent hours.
H2. Per-mutant cost is dominated by LLM turns and stack overhead (reset, bucket runs, polling), not by the test run itself.
H3. A scripted mutate-run-restore loop (no LLM per mutant) cuts unit-level mutant cost by >10x.
H4. Re-proof plans (400-46/47/50/51) exist because `.tmp` evidence was purged, so they are avoidable rework.

Falsifiers: H1 false if mid-variant share <8% of leaf hours. H2 false if test/reset/bucket calls >60% of attributed time. H3 false if scripted <3x faster. H4 false if the re-proof SUMMARYs cite new defects found.

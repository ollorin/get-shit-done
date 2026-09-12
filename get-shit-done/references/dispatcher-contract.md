# Dispatcher Contract

Shared failure-path contract for thin GSD commands (a thin command is a `<process>` block that
delegates to a fat `@`-referenced workflow file rather than inlining logic).

## The contract

1. **Execute the `@`-referenced workflow end-to-end.** Preserve every gate the workflow defines
   (validation, checkpoints, verification, state updates, commits, routing). The command's own
   summary is orientation only — the workflow is the source of truth.

2. **On load failure, STOP — do NOT improvise.** If the referenced workflow file is missing, empty,
   or fails to resolve (e.g. an install-skew mismatch between the installed copy and its source),
   do NOT reconstruct the workflow from the command's short summary. Improvising *looks* like GSD
   ran while silently skipping its gates — the worst failure mode. Instead: tell the user the
   workflow file could not be loaded and to re-run the GSD installer (`node <source>/bin/install.js`),
   then stop.

3. **On an unrecoverable workflow error, STOP and report state.** If the workflow itself hits an
   error it cannot recover from, do not guess a completion. Report exactly what failed and what
   state was already written to disk (files created/modified, commits made, `.planning/` markers)
   so the user can resume or roll back deterministically.

Never claim success you cannot verify. A partial run is a partial run — say so.

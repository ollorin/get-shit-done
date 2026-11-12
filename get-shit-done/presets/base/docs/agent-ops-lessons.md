# Agent-operations lessons

Each lesson is two sentences or less, followed by its incident. A rule that the base CLAUDE.md already states is kept here as the incident behind it. Each entry ends with an incident pointer in brackets; replace `<project incident id>` with the project's own incident reference, or delete the pointer where the lesson stands alone. Model-allowance rules are not carried.

## Orchestration and dispatch

- Run one coordinator per phase, spawned in sequence. Do not reach into its child agents to relay or unblock them; send the message to the coordinator. Incident: a relay to nested agents duplicated work and burned a large share of a session limit within one run. [incident: <project incident id>]
- Never message a coordinator after it hands back; it resumes and runs beside its replacement. Stop it, then brief a fresh agent with everything it needs. Incident: two executors wrote the same directory at once after a message woke a handed-back coordinator. [incident: <project incident id>]
- Stop the owning agent before killing its wait shell, because the shell's exit re-invokes the agent. Incident: a stale executor woke, resumed an old handoff and ran stack mutations without the lock while a verifier ran. [incident: <project incident id>]
- Trust only on-disk artifacts (gate timestamp, verification status, checkpoint file), never an agent's own report of completion, and never two executors in one phase. Incidents: a red gate was rationalised as transient, and two parallel executors overwrote the phase checkpoint file. [incident: <project incident id>]
- A session limit kills every agent, and no in-session loop survives it; only an OS process outside the session does. Recovery is a fresh coordinator scoped to on-disk state, not a resume of the dead agent IDs. Incident: the documented wait-and-resume loop was prose only and died with its orchestrator. [incident: <project incident id>]
- Put every mandatory stage into the coordinator's brief and turn each gate into a programmatic check, not prose. Incident: under context pressure, coordinators skipped the later QA stages and returned "complete". [incident: <project incident id>]
- Haiku implements, a fresh Sonnet agent runs each review loop, and Opus runs only at mandatory points, each once. Incident: several phases spent four or more Opus reviews against a weekly quota, mostly re-finding what a cheap pass catches. [incident: <project incident id>]
- Planners never write scripts. A needed check becomes an executor task that creates a real test. Incident: a planner had authored thirteen one-off verification scripts inside phase directories. [incident: <project incident id>]
- Before handing work to another phase, read that phase's roadmap row and confirm it is in the milestone and not deferred. Incident: a fix was handed to a deferred phase, so it had no owner. [incident: <project incident id>]

## Decisions and escalation

- Decide fixes and folds yourself (an advisor ruling in high-stakes domains), report them as done, and never ask whether to fix a finding. Ask the owner only for steps the permission system blocks, irreversible or outward-facing steps, and business or legal policy. Incident: the owner answered such questions by telling the agent to decide them itself. [incident: <project incident id>]
- During autonomous runs, gather facts with a cheap read-only agent, put the decision to an advisor, and act on the verdict. Escalate only strategic or irreversible calls. Incident: a toolchain upgrade was decided this way with a measured peer-dependency check. [incident: <project incident id>]
- The owner sets vision and reviews results; agents build. Write requirements as what the agent system must do, not as a developer's wants. Standing role; no incident. [incident: <project incident id>]
- Codify a rule without who-and-when stamps; keep an incident reference only where it explains why the rule exists. Incident: the owner called provenance tags unnecessary context. [incident: <project incident id>]

## Commands, permissions and shared resources

- Do not run a stack stop or start, a container-runtime command or a history rewrite from any agent. Route a genuine need to the main agent with the exact command, and never retry a denied command through a script. Incident: two prompts for such commands arrived unapproved, and the owner asked who requested them. [incident: <project incident id>]
- Before a command that can raise an OS dialog (keychain, image pull), explain it and ask; check the local image tags first. Incident: a stack start hung about fifteen minutes on a keychain prompt during an unattended run. [incident: <project incident id>]
- Run tests only through the project's documented task shapes: no inline environment variables, pipes or chained commands. A prompt that appears is reported verbatim, not reshaped. Incident: the owner hand-approved live test runs because the allow list matches command shapes. [incident: <project incident id>]
- Read the settings file before asking for a permission rule. A classifier denial concerns command shape, not a missing rule. Incident: the same allow rules were requested repeatedly though they already existed. [incident: <project incident id>]
- Inside a plan, run only the affected test files, once. Run one full pre-PR gate per phase, on the final tree. Incident: one phase ran the full gate five times and starved a parallel phase of the shared stack for about an hour. [incident: <project incident id>]

## Cost and reporting

- Use model aliases, never pinned identifiers, and keep each Haiku task under 100k prompt tokens, where the cost rises about fivefold. Measured peaks, not intent, decide the plan sizes. Incident: most executor spawns still exceeded the threshold in a measured period. [incident: <project incident id>]
- Status updates are one to three sentences, with one report per phase boundary or blocker. Never arm a per-commit watch. Incident: a third correction in one session for status noise. [incident: <project incident id>]

## Completion and quality gates

- Before a pull request, run the migration reset, every integration test, the end-to-end regression and the full check suite twice. Phase-level runs test in isolation and miss cross-migration breakage. Incident: three migration bugs and 52 failing integration tests reached a pull request. [incident: <project incident id>]
- Run the integration tests after every phase, not only when migrations changed; UI phases need live UI-QA runs, not code inspection. Keep plans at most 400 lines, and add a new value to every layer in the same commit. Incident: a milestone postmortem whose defects surfaced only at the end. [incident: <project incident id>]
- A feature with a public surface ships with its documentation lines in the same commit, checked before a pull request. Incident: ten operator endpoints shipped with no documentation. [incident: <project incident id>]

## Review-mining and A/B findings

- [finding: review-mining] Of 927 mined review findings, 498 (54%) are bookkeeping: stale cites and gates not run on the final tree. Those need scripts, not prose. Regex recount: 100 hollow-test lines in 75 files, 57 stale-cite lines in 46 files.
- [finding: F1] Rework after the first summary is as large as the first attempt, and about half of it is paperwork. Proposed: generate the summary's facts from git and logs with a script.
- [finding: F2] Late review rounds find paperwork, not code. Proposed: after round three, only code and test findings open a round; documentation findings go to one final pass.
- [finding: F3] A cite and SHA existence gate does not reproduce what reviews find. Rejected by the data; kept as a recorded test.
- [finding: F4] Executors stop on precondition tasks outside their scope. Proposed: the brief names which predecessors are merged; precondition tasks run once in the coordinator.
- [finding: A/B verdicts] Rule: A/B every instruction cut before shipping it. An executor trim changed strict acceptance from 12 of 21 to 2 of 21, so it was rejected. Text slimming is about 0.75% of spend.

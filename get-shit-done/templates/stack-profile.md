# Stack Profile Template

Template for `.planning/STACK-PROFILE.md`: the technology facts of this project only. Domain facts go to PRODUCT-BRIEF.md.

<template>

```markdown
# Stack Profile

## Commands

The block below will be rendered from `.planning/config.json` `stack.commands` by the deploy engine (later phase, not built yet). Until then, keep this table in step with the config by hand.

<!-- gsd:begin commands -->
| Key | Command |
|-----|---------|
| test_file | [stack.commands.test_file, or `not configured yet` when none/null] |
| test_all | [stack.commands.test_all, or `not configured yet`] |
| typecheck | [stack.commands.typecheck, or `not configured yet`] |
| lint | [stack.commands.lint, or `not configured yet`] |
| format | [stack.commands.format] |
| frontend_test | [stack.commands.frontend_test] |
| build | [stack.commands.build] |
| pre_pr_gate | [stack.commands.pre_pr_gate] |
| search | [stack.commands.search] |
<!-- gsd:end commands -->

## Test Command Shapes

[The only shapes agents may run, verbatim, from `stack.test_command_shapes`.]

## Paths

[Backend, migrations, API handlers, e2e scenarios, frontends. From `stack.paths`.]

## Gates

[Gate id and command, one per line, from `stack.gates`. Run every gate. A missing runtime is a gap, never a skip.]

## Services

| Name | URL | Health (URL or path) | Health command (shell) | Launch | Ready |
|------|-----|----------------------|------------------------|--------|-------|
| [name] | [url] | [health] | [health_cmd] | [launch] | [ready] |

[No default port is ever assumed. Every value comes from `stack.services`.]

## Capabilities

[UI QA driver and agent, or "none". State-reset commands that must not run during a QA session.]

## Isolation

[Port base, container suffix, lock dir, machine locks. From `stack.isolation`.]

## Style

Rule set and roots: from `stack.style` (the gate enforces the rules; this section names the idioms).

- Errors: [errors returned as values: the library or construct used]
- Immutability: [how state stays unmodified: the construct used]
- Routing: [how requests or events are dispatched: the construct used]
- Purity: [which modules are pure, and where side effects sit]

## Conventions

[Prose: language and runtime versions, error-handling and module rules, anything not machine-read.]
```

</template>

<guidelines>
- Target 150 lines or fewer. Every value that code or hooks consume lives in `config.json`; this file explains it.
- Check the profile with `node get-shit-done/bin/gsd-tools.js profile check`.
- Never write a command here that is absent from `stack.commands` or `stack.test_command_shapes`.
</guidelines>

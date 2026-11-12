---
name: gsd:open-pr
description: Open a pull request — enforces the pre-PR gate before allowing PR creation
argument-hint: "[--dry-run] [--title <title>] [--body <body>]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

<objective>
Open a pull request after verifying the pre-PR gate has passed.

This command is a compliance gate — it BLOCKS PR creation when the gate pass marker
is absent or stale. This enforces the rule: Green twice = ready. Anything else = not ready.

The pass marker is written by `stack.commands.pre_pr_gate` and is valid for 30 minutes.
</objective>

<process>

<step name="pre_pr_gate" priority="first">
## Pre-PR Gate — BLOCKING

This step MUST run before any PR creation attempt. It cannot be skipped.

```bash
PASS_MARKER="<pass marker written by stack.commands.pre_pr_gate>"
PASS_MAX_AGE_SECONDS=1800  # 30 minutes
# If stack.commands.pre_pr_gate names no script file, the gate is the stack-detected checks of config/pre-pr-checks.json; the marker rule still applies.

if [ ! -f "$PASS_MARKER" ]; then
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  BLOCKED: Pre-PR gate has not been run                    ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "The gate pass marker is absent."
  echo ""
  echo "Run the pre-PR gate before opening a PR:"
  echo ""
  echo "   stack.commands.pre_pr_gate    # Auto-detect affected"
  echo "   stack.commands.pre_pr_gate --all    # Force all checks"
  echo ""
  echo "The script must pass TWICE before you can open a PR."
  echo ""
  exit 1
fi

# Check age of marker
MARKER_AGE_SECONDS=$(( $(date +%s) - $(stat -f %m "$PASS_MARKER" 2>/dev/null || stat -c %Y "$PREFLIGHT_MARKER" 2>/dev/null || echo 0) ))
if [ "$MARKER_AGE_SECONDS" -gt "$PASS_MAX_AGE_SECONDS" ]; then
  MARKER_AGE_MINUTES=$(( MARKER_AGE_SECONDS / 60 ))
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  BLOCKED: Pass marker is stale (${MARKER_AGE_MINUTES}m old)                  ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "The gate pass marker is older than 30 minutes."
  echo "Re-run the pre-PR gate to ensure changes since then are covered:"
  echo ""
  echo "   stack.commands.pre_pr_gate"
  echo ""
  exit 1
fi

echo "✓ Preflight gate passed (marker is $(( MARKER_AGE_SECONDS / 60 ))m old)"
```

If `--dry-run` is in the arguments: stop here after gate check and print "Dry-run complete — gate status above".
</step>

<step name="gather_pr_info">
## Gather PR Information

```bash
# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
MAIN_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")

# Get commit summary since diverging from main
COMMITS=$(git log --oneline ${MAIN_BRANCH}..HEAD 2>/dev/null | head -20)
CHANGED_FILES=$(git diff --name-only ${MAIN_BRANCH}..HEAD 2>/dev/null | head -30)
```

If `$ARGUMENTS` contains `--title`, extract the title value.
Otherwise derive from branch name: replace `-` with spaces, capitalize words.
</step>

<step name="create_pr">
## Create Pull Request

```bash
# Assemble the body with printf (NOT a heredoc): a quoted-delimiter heredoc
# ships the literal string "$PR_BODY", and an unquoted one would re-interpret
# any `$` or backtick inside the git-derived commit text. printf '%s' expands
# each variable exactly once and never re-parses its contents.
PR_FULL_BODY=$(printf '%s\n\n%s\n\n%s\n%s\n\n%s\n%s\n' \
  "## Summary" \
  "$PR_BODY" \
  "## Commits" "$COMMITS" \
  "## Changed files" "$CHANGED_FILES")
PR_FULL_BODY=$(printf '%s\n\n%s\n- [x] the pre-PR gate (`stack.commands.pre_pr_gate`) passed twice\n- [x] gate pass marker present and fresh\n\n%s\n- [ ] Reviewer: pull branch, run `stack.commands.pre_pr_gate --skip-twice` and verify green\n' \
  "$PR_FULL_BODY" "## Preflight" "## Test plan")

gh pr create --title "$PR_TITLE" --body "$PR_FULL_BODY"
```

Print the created PR URL. Verify the created PR body contains the actual summary text, not a literal `$PR_BODY` — if it shows the literal variable name, the body assembly regressed.
</step>

</process>

<dry_run_mode>
When `--dry-run` is present in `$ARGUMENTS`:
1. Run the pre-PR gate check (step 1)
2. Print gate result (PASSED or BLOCKED with reason)
3. DO NOT create a PR
4. Exit with code 0 if gate passed, code 1 if blocked

This mode is used for testing the gate without creating an actual PR.
</dry_run_mode>

---
name: gsd:open-pr
description: Open a pull request — enforces preflight gate before allowing PR creation
argument-hint: "[--dry-run] [--title <title>] [--body <body>]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

<objective>
Open a pull request after verifying the preflight gate has passed.

This command is a compliance gate — it BLOCKS PR creation when the `.preflight-passed`
marker is absent or stale. This enforces the rule: Green twice = ready. Anything else = not ready.

The preflight marker is written by `scripts/preflight.sh` and is valid for 30 minutes.
</objective>

<process>

<step name="preflight_gate" priority="first">
## Preflight Gate — BLOCKING

This step MUST run before any PR creation attempt. It cannot be skipped.

```bash
PREFLIGHT_MARKER=".preflight-passed"
PREFLIGHT_MAX_AGE_SECONDS=1800  # 30 minutes

if [ ! -f "$PREFLIGHT_MARKER" ]; then
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  BLOCKED: Preflight check has not been run                ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "The .preflight-passed marker is absent."
  echo ""
  echo "Run the preflight check before opening a PR:"
  echo ""
  echo "   scripts/preflight.sh          # Auto-detect affected"
  echo "   scripts/preflight.sh --all    # Force all checks"
  echo ""
  echo "The script must pass TWICE before you can open a PR."
  echo ""
  exit 1
fi

# Check age of marker
MARKER_AGE_SECONDS=$(( $(date +%s) - $(stat -f %m "$PREFLIGHT_MARKER" 2>/dev/null || stat -c %Y "$PREFLIGHT_MARKER" 2>/dev/null || echo 0) ))
if [ "$MARKER_AGE_SECONDS" -gt "$PREFLIGHT_MAX_AGE_SECONDS" ]; then
  MARKER_AGE_MINUTES=$(( MARKER_AGE_SECONDS / 60 ))
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  BLOCKED: Preflight marker is stale (${MARKER_AGE_MINUTES}m old)             ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "The .preflight-passed marker is older than 30 minutes."
  echo "Re-run the preflight check to ensure changes since then are covered:"
  echo ""
  echo "   scripts/preflight.sh"
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
gh pr create \
  --title "$PR_TITLE" \
  --body "$(cat <<'PREOF'
## Summary

$PR_BODY

## Preflight
- [x] `scripts/preflight.sh` passed twice
- [x] `.preflight-passed` marker present and fresh

## Test plan
- [ ] Reviewer: pull branch, run `scripts/preflight.sh --skip-twice` and verify green

PREOF
)"
```

Print the created PR URL.
</step>

</process>

<dry_run_mode>
When `--dry-run` is present in `$ARGUMENTS`:
1. Run the preflight gate check (step 1)
2. Print gate result (PASSED or BLOCKED with reason)
3. DO NOT create a PR
4. Exit with code 0 if gate passed, code 1 if blocked

This mode is used for testing the gate without creating an actual PR.
</dry_run_mode>

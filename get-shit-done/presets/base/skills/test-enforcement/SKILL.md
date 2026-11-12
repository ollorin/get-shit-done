---
name: test-enforcement
description: Use BEFORE creating commits or PRs - automatically scan codebase for .skip()/.todo() test patterns and report skipped tests to ensure full test coverage
disable-model-invocation: false
allowed-tools: Bash(git grep *), Bash(grep *), Bash(rg *), Grep, Read, Glob
---

# Test Enforcement Skill

## When to Use

Invoke this skill when:
- Before committing code changes
- During code review
- Auditing test coverage
- Validating CI readiness

**Trigger keywords:** test audit, skip check, test validation, before commit, code review

## What to Check For

### JavaScript and TypeScript test patterns

| Pattern | Framework | Description |
|---------|-----------|-------------|
| `.skip(` | test call | Skipped test case |
| `.todo(` | test call | Unimplemented test |
| `it.skip(` | BDD runner | Skipped BDD test |
| `describe.skip(` | BDD runner | Skipped test suite |
| `test.skip(` | BDD runner | Skipped test |
| `xit(` | Jasmine | Skipped test |
| `xdescribe(` | Jasmine | Skipped suite |

### Python Test Patterns (if present)

| Pattern | Framework | Description |
|---------|-----------|-------------|
| `@pytest.mark.skip` | pytest | Skipped test |
| `@unittest.skip` | unittest | Skipped test |

## Detection Commands

The scope is the test paths of the profile: `stack.paths.backend` and `stack.paths.frontends` (the paths are the owner's; `<test path>` below stands for them). The test-file globs are `stack.flake_patterns.test_globs`.

### Find skipped tests

```bash
# Find .skip() and .todo() in test files
git grep -n "\.skip(" -- "<test path>"
git grep -n "\.todo(" -- "<test path>"

# Find all skip patterns in test files
git grep -n -E "\.skip\(|\.todo\(|it\.skip|describe\.skip|test\.skip" -- "<test path>"

# Find in all test files, by the test-file globs
git grep -n -E "\.skip\(|\.todo\(" -- "*test*" "*spec*"
```

### Check entire codebase

```bash
# Comprehensive skip pattern search
git grep -n -E "(\.skip\(|\.todo\(|it\.skip|describe\.skip|test\.skip|xit\(|xdescribe\()" -- "<test path>"
```

## Allowed Exceptions

Skips are allowed ONLY with proper documentation (the policy of the project's rules):

### 1. Issue Link

```typescript
// TODO(#123): Fix flaky test - authentication timeout in CI
test.skip("player login with slow network", async () => {
  // ...
});
```

### 2. Expiration Date (max 30 days)

```typescript
// SKIP until 2026-03-15: Waiting for API v2 release
test.skip("new gateway integration", async () => {
  // ...
});
```

## Enforcement Action

When violations are found:

1. **List all violations** with file path and line number
2. **For each violation, require one of:**
   - Remove the skip and implement the test
   - Add issue link explaining why skipped
   - Add expiration date (max 30 days from today)

## Report Format

Generate a report in this format:

```
TEST ENFORCEMENT REPORT
=======================
Scan Date: YYYY-MM-DD
Scope: <test path>

Violations: N

1. src/__tests__/auth.test.ts:45
   Pattern: .skip()
   Context: test.skip("login validation", ...)
   Action Required: Remove skip OR add issue link (TODO(#XXX))

2. src/session_test.ts:23
   Pattern: .todo()
   Context: test.todo("session refresh")
   Action Required: Implement test OR add expiration date

Allowed Exceptions Found: M

1. src/__tests__/gateway.test.ts:89
   Pattern: .skip()
   Justification: TODO(#456): Waiting for vendor sandbox fix
   Status: VALID (has issue link)

Summary:
- Total skips: N + M
- Violations: N (require action)
- Valid exceptions: M (properly documented)
```

## Integration

### Pre-commit Check

Add to pre-commit validation:

```bash
# In .git/hooks/pre-commit or CI pipeline
VIOLATIONS=$(git grep -c -E "\.skip\(|\.todo\(" -- "<test path>" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "$VIOLATIONS" -gt "0" ]; then
  echo "WARNING: Found $VIOLATIONS files with skipped tests. Run test-enforcement skill to review."
fi
```

### CI Pipeline

```yaml
# In CI workflow
- name: Check for skipped tests
  run: |
    if git grep -n -E "\.skip\(|\.todo\(" -- "<test path>" | grep -v "TODO(#"; then
      echo "ERROR: Found skipped tests without issue links"
      exit 1
    fi
```

## Policy Summary

Per the owner's locked decisions:

| Rule | Policy |
|------|--------|
| Default | Strict (no .skip/.ignore allowed) |
| Exception | Issue link OR expiration date required |
| Expiration max | 30 days |
| Enforcement | Block commit if undocumented skip found |

## Related Resources

- [Testing Rules](.claude/rules/testing.md) - CI environment and test types
- [Guard authoring](.claude/rules/guard-authoring.md) - how new checks are wired

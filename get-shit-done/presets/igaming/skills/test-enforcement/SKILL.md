---
name: test-enforcement
description: Use BEFORE creating commits or PRs - automatically scan codebase for .skip()/.todo() test patterns and report skipped tests to ensure full test coverage
disable-model-invocation: false
allowed-tools: Bash(grep *), Bash(rg *), Grep, Read, Glob
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

### Deno/TypeScript Test Patterns

| Pattern | Framework | Description |
|---------|-----------|-------------|
| `.skip(` | Deno.test | Skipped test case |
| `.todo(` | Deno.test | Unimplemented test |
| `it.skip(` | BDD/Vitest | Skipped BDD test |
| `describe.skip(` | BDD/Vitest | Skipped test suite |
| `test.skip(` | Vitest/Jest | Skipped test |
| `xit(` | Jasmine | Skipped test |
| `xdescribe(` | Jasmine | Skipped suite |

### Python Test Patterns (if present)

| Pattern | Framework | Description |
|---------|-----------|-------------|
| `@pytest.mark.skip` | pytest | Skipped test |
| `@unittest.skip` | unittest | Skipped test |

## Detection Commands

### Find skipped tests in Deno/TypeScript

```bash
# Find .skip() and .todo() in test files
grep -r "\.skip(" apps/api/functions/ --include="*.ts"
grep -r "\.todo(" apps/api/functions/ --include="*.ts"

# Find all skip patterns in test files
rg "\.skip\(|\.todo\(|it\.skip|describe\.skip|test\.skip" --type ts apps/api/

# Find in all test files
rg "\.skip\(|\.todo\(" --glob "*test*.ts" --glob "*spec*.ts"
```

### Check entire codebase

```bash
# Comprehensive skip pattern search
rg "(\.skip\(|\.todo\(|it\.skip|describe\.skip|test\.skip|xit\(|xdescribe\()" \
   --type ts \
   apps/api/
```

## Allowed Exceptions

Per CONTEXT.md, skips are allowed ONLY with proper documentation:

### 1. GitHub Issue Link

```typescript
// TODO(#123): Fix flaky test - authentication timeout in CI
Deno.test.skip("player login with slow network", async () => {
  // ...
});
```

### 2. Expiration Date (max 30 days)

```typescript
// SKIP until 2026-03-15: Waiting for API v2 release
Deno.test.skip("new payment gateway integration", async () => {
  // ...
});
```

## Enforcement Action

When violations are found:

1. **List all violations** with file path and line number
2. **For each violation, require one of:**
   - Remove the skip and implement the test
   - Add GitHub issue link explaining why skipped
   - Add expiration date (max 30 days from today)

## Report Format

Generate a report in this format:

```
TEST ENFORCEMENT REPORT
=======================
Scan Date: YYYY-MM-DD
Scope: apps/api/functions/

Violations: N

1. apps/api/functions/__tests__/auth.test.ts:45
   Pattern: .skip()
   Context: Deno.test.skip("login validation", ...)
   Action Required: Remove skip OR add issue link (TODO(#XXX))

2. apps/api/functions/session_test.ts:23
   Pattern: .todo()
   Context: Deno.test.todo("session refresh")
   Action Required: Implement test OR add expiration date

Allowed Exceptions Found: M

1. apps/api/functions/__tests__/payment.test.ts:89
   Pattern: .skip()
   Justification: TODO(#456): Waiting for Stripe sandbox fix
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
VIOLATIONS=$(rg "\.skip\(|\.todo\(" --type ts apps/api/ -c 2>/dev/null || echo "0")
if [ "$VIOLATIONS" -gt "0" ]; then
  echo "WARNING: Found $VIOLATIONS skipped tests. Run test-enforcement skill to review."
fi
```

### CI Pipeline

```yaml
# In GitHub Actions workflow
- name: Check for skipped tests
  run: |
    if rg "\.skip\(|\.todo\(" --type ts apps/api/ | grep -v "TODO(#"; then
      echo "ERROR: Found skipped tests without issue links"
      exit 1
    fi
```

## Policy Summary

Per CONTEXT.md locked decisions:

| Rule | Policy |
|------|--------|
| Default | Strict (no .skip/.ignore allowed) |
| Exception | Issue link OR expiration date required |
| Expiration max | 30 days |
| Enforcement | Block commit if undocumented skip found |

## Related Resources

- [Testing Rules](/.claude/rules/testing.md) - CI environment and test types
- [testing.md](/docs/testing.md) - Full testing documentation
- [CONTEXT.md](/.planning/milestones/v0.1.1/phases/28-folder-context-and-skills/28-CONTEXT.md) - Policy decisions

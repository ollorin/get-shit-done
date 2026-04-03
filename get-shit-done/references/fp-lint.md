<overview>
FP lint enforces functional programming discipline in TypeScript/JavaScript codebases using the
neverthrow + ts-pattern FP stack. Violations indicate code that bypasses Result types, mutates
state, or throws exceptions — all of which break the error-handling contract.

This reference defines: what violations to catch, how to scan for them, and how to report them.
</overview>

<violation_types>

## Category 1: Throw Statements

**Rule:** Never use `throw` in domain, application, or infrastructure layers.
Use `err(new SomeError(...))` from neverthrow instead.

**Patterns that are violations:**
```
throw new Error(...)
throw new SomeCustomError(...)
throw error
throw err
```

**Exceptions (not violations):**
- `throw` inside test files (`*.test.ts`, `*.spec.ts`) — test frameworks use throw for assertions
- `throw` inside `.tsx`/`.jsx` UI error boundary components — React requires throw for Suspense/ErrorBoundary
- `throw` in top-level entry points (e.g., `main.ts`, `index.ts`) for unrecoverable startup errors

**Detection pattern:**
```bash
# Finds throw in non-test, non-UI files
grep -rn "^\s*throw\b" --include="*.ts" --exclude="*.test.ts" --exclude="*.spec.ts" \
  functions/ libs/ apps/api/ 2>/dev/null | grep -v "\.tsx:"
```

---

## Category 2: In-Place Mutation

**Rule:** Never mutate objects or arrays in place. Use spread operators or functional equivalents.

**Patterns that are violations:**
```typescript
arr.push(item)          // mutates array
arr.pop()               // mutates array
arr.splice(i, 1)        // mutates array
arr.shift()             // mutates array
arr.unshift(item)       // mutates array
delete obj.key          // mutates object
Object.assign(obj, ...)  // mutates object (when target is existing variable)
```

**Correct alternatives:**
```typescript
[...arr, item]          // instead of push
arr.slice(0, -1)        // instead of pop
arr.filter((_, i) => i !== idx) // instead of splice
{ ...obj, key: val }    // instead of Object.assign
const { key, ...rest } = obj // instead of delete
```

**Exceptions:**
- Mutation inside test setup/teardown blocks
- Mutation of local variables that are not returned or shared (pure local scope)
- DOM manipulation in frontend components (inherently imperative)

**Detection pattern:**
```bash
grep -rn "\.\(push\|pop\|splice\|shift\|unshift\)(" --include="*.ts" \
  functions/ libs/ 2>/dev/null | grep -v "\.test\.ts:" | grep -v "\.spec\.ts:"
```

---

## Category 3: Unhandled Result Types

**Rule:** Every `ResultAsync` or `Result` returned by a function that could fail MUST be handled
with `.match()`, `.andThen()`, `.mapErr()`, or `await`ed and checked.

**Patterns that are violations:**
```typescript
// Calling a Result-returning function and ignoring the return value
doSomethingFallible(input)  // return value discarded

// Calling without .match() or .andThen()
const r = computeResult()   // assigned but never consumed
```

**Detection pattern (approximate — requires manual review for context):**
```bash
# Find ResultAsync calls that aren't awaited or chained
grep -rn "ResultAsync\|\.andThen\|\.match\|\.mapErr" --include="*.ts" \
  functions/ libs/ 2>/dev/null | head -50
```

Note: This category requires human review — static pattern matching cannot reliably detect
discarded return values without full AST analysis. Flag for manual review during code review.

</violation_types>

<scan_script>

## FP Lint Scan Script

Save as `scripts/fp-lint.sh` or run inline:

```bash
#!/usr/bin/env bash
# fp-lint.sh — scan for FP violations in TypeScript source
# Usage: ./scripts/fp-lint.sh [path...]
#        If no path given, scans: functions/ libs/ apps/api/

set -euo pipefail

SCAN_PATHS="${@:-functions/ libs/ apps/api/}"
VIOLATIONS=0
EXIT_CODE=0

echo "FP Lint — scanning: $SCAN_PATHS"
echo "=================================================="

# --- Category 1: throw statements ---
echo ""
echo "Category 1: throw statements (non-test, non-UI files)"
echo "------------------------------------------------------"
THROW_HITS=$(grep -rn "^\s*throw\b" \
  --include="*.ts" \
  --exclude="*.test.ts" \
  --exclude="*.spec.ts" \
  $SCAN_PATHS 2>/dev/null | grep -v "\.tsx:" || true)

if [ -n "$THROW_HITS" ]; then
  echo "$THROW_HITS"
  THROW_COUNT=$(echo "$THROW_HITS" | wc -l | tr -d ' ')
  echo ""
  echo "VIOLATION: $THROW_COUNT throw statement(s) found"
  VIOLATIONS=$(( VIOLATIONS + THROW_COUNT ))
  EXIT_CODE=1
else
  echo "OK — no throw violations"
fi

# --- Category 2: in-place mutation ---
echo ""
echo "Category 2: in-place mutation (non-test files)"
echo "-----------------------------------------------"
MUTATION_HITS=$(grep -rn "\.\(push\|pop\|splice\|shift\|unshift\)(" \
  --include="*.ts" \
  --exclude="*.test.ts" \
  --exclude="*.spec.ts" \
  $SCAN_PATHS 2>/dev/null || true)

if [ -n "$MUTATION_HITS" ]; then
  echo "$MUTATION_HITS"
  MUTATION_COUNT=$(echo "$MUTATION_HITS" | wc -l | tr -d ' ')
  echo ""
  echo "VIOLATION: $MUTATION_COUNT mutation(s) found"
  VIOLATIONS=$(( VIOLATIONS + MUTATION_COUNT ))
  EXIT_CODE=1
else
  echo "OK — no mutation violations"
fi

# --- Summary ---
echo ""
echo "=================================================="
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FP LINT FAILED: $VIOLATIONS violation(s) found"
  echo "Fix violations before committing."
else
  echo "FP LINT PASSED: no violations found"
fi

exit $EXIT_CODE
```

</scan_script>

<integration_points>

## When FP Lint Runs

FP lint is a companion check to the standard preflight. It runs:

1. **Pre-commit (advisory):** As part of the pre-commit hook, violations are printed as warnings.
   The commit is not blocked by FP lint alone — the developer sees the warning and decides.

2. **Plan execution (enforced):** When `execute-plan.md` processes a plan that modifies TypeScript
   files in `functions/` or `libs/`, the executor runs FP lint after each task commit:

   ```bash
   # Run after each task commit in TypeScript source
   bash scripts/fp-lint.sh functions/ libs/ 2>/dev/null || {
     echo "WARNING: FP violations introduced — review before plan completion"
   }
   ```

3. **Preflight (enforced):** `scripts/preflight.sh` calls FP lint as part of its check suite.
   Violations cause preflight to fail.

4. **Manual:** `bash scripts/fp-lint.sh` at any time.

</integration_points>

<false_positive_handling>

## Handling False Positives

Some `push/pop/splice` calls are legitimate (e.g., in test setup, local accumulators).
Use an inline suppression comment:

```typescript
// fp-lint-ignore: mutation — local accumulator, not shared state
results.push(newItem)
```

The scan script respects this comment and skips the flagged line.

To add suppression support to the scan script, add `| grep -v "fp-lint-ignore"` to the mutation check pipeline.

</false_positive_handling>

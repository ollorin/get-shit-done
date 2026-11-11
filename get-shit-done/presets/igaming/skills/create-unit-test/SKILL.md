---
name: create-unit-test
description: Use when implementing domain entities, use cases, or business logic - automatically create unit tests BEFORE writing implementation code (TDD approach)
disable-model-invocation: false
allowed-tools: Read, Write, Bash(deno *), Bash(npx nx test *), Glob, Grep
---

# Unit Test Scaffolding Skill

## When to Use

Trigger on tasks involving:
- Creating a unit test
- Testing business logic
- Testing use cases
- Testing domain entities
- Testing pure functions
- Testing application layer code

## File Created

Unit tests are placed alongside the file being tested:

| Pattern | Example |
|---------|---------|
| `{module}.ts` | `apps/api/libs/domain/src/entities/Player.ts` |
| `{module}_test.ts` | `apps/api/libs/domain/src/entities/Player_test.ts` |

Or with `.test.ts` suffix:

| Pattern | Example |
|---------|---------|
| `{module}.ts` | `apps/api/libs/application/src/use-cases/CreatePlayer.ts` |
| `{module}.test.ts` | `apps/api/libs/application/src/use-cases/CreatePlayer.test.ts` |

## Test Structure

Per project convention, all unit tests MUST include:

| Category | Purpose | Example |
|----------|---------|---------|
| **Positive cases** | Valid inputs produce expected output | Valid email passes validation |
| **Negative cases** | Invalid inputs throw errors | Invalid email throws ValidationError |
| **Edge cases** | Boundary conditions handled | Empty string, max length, null |

## Required Patterns

### 1. Use Deno Testing Framework

Import from `@std/assert` and `@std/testing/bdd`:

```typescript
import { assertEquals, assertThrows, assertExists } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
```

### 2. BDD-Style Test Structure

Use `describe` and `it` blocks for organization:

```typescript
describe("PlayerEntity", () => {
  describe("positive cases", () => {
    it("should create player with valid data", () => {
      // Arrange, Act, Assert
    });
  });

  describe("negative cases", () => {
    it("should throw on invalid email", () => {
      assertThrows(() => { /* code */ }, ValidationError, "expected message");
    });
  });

  describe("edge cases", () => {
    it("should handle empty name", () => {
      // Test boundary condition
    });
  });
});
```

### 3. Arrange-Act-Assert Pattern

Structure each test with clear phases:

```typescript
it("should update player status", () => {
  // Arrange - Set up test data
  const player = createTestPlayer({ status: "ACTIVE" });

  // Act - Execute the code under test
  player.deactivate();

  // Assert - Verify the expected outcome
  assertEquals(player.status, "INACTIVE");
});
```

### 4. Mock External Dependencies

For application layer tests, mock infrastructure:

```typescript
import { spy, stub, returnsNext } from "@std/testing/mock";

// Stub a repository
const mockRepository = {
  findById: stub(returnsNext([mockPlayer])),
  save: spy(),
};

// Inject mock into use case
const useCase = new CreatePlayerUseCase(mockRepository);
```

### 5. Test Data Builders

Create reusable test data builders:

```typescript
function createTestPlayer(overrides: Partial<PlayerData> = {}): Player {
  return new Player({
    id: "test-id",
    email: "test@example.com",
    name: "Test Player",
    status: "ACTIVE",
    ...overrides,
  });
}
```

### FP Result Assertions (v0.1.2+)

For testing FP code, use Result assertion utilities:

The assertion helpers live in `apps/api/libs/test-utils/fp-assertions.ts` and are
NOT exported from `@igaming/infrastructure` — import them by relative path, exactly
as real tests do (see `apps/api/libs/infrastructure/src/lib/response/fp-utilities.test.ts`):

```typescript
// Relative path from the test file to apps/api/libs/test-utils/fp-assertions.ts
// e.g. from libs/infrastructure/src/lib/response/*.test.ts:
import {
  expectOk,
  expectErr,
  expectOkAsync,
  expectErrAsync,
} from "../../../../test-utils/fp-assertions.ts";

describe("FP function", () => {
  describe("positive cases", () => {
    it("should return Ok with valid input", async () => {
      const result = await functionUnderTest(validInput);

      expectOk(result);
      expect(result.value).toEqual(expectedValue);
    });
  });

  describe("negative cases", () => {
    it("should return Err for invalid input", async () => {
      const result = await functionUnderTest(invalidInput);

      expectErr(result, "ValidationError");
      expect(result.error.code).toBe("VAL_001");
    });
  });

  describe("error paths", () => {
    it("should return specific error type", async () => {
      const result = await functionUnderTest(edgeCaseInput);

      expectErr(result);
      expect(result.error._tag).toBe("DatabaseError");
      expect(result.error.statusCode).toBe(500);
    });
  });
});
```

**Key Patterns:**
- Use `expectOk(result)` instead of `expect(result.isOk()).toBe(true)`
- Use `expectErr(result, "ErrorTag")` for typed error assertions
- Access `result.value` after `expectOk()` - TypeScript narrowing works
- Access `result.error` after `expectErr()` - TypeScript narrowing works

See [FP Testing Guide](/docs/testing/fp-testing-guide.md) for complete patterns.

## Test Categories

### Positive Cases (Happy Path)

Test that valid inputs produce expected outputs:

- Valid entity creation
- Successful state transitions
- Correct calculations
- Expected return values

### Negative Cases (Error Handling)

Test that invalid inputs produce correct errors:

- Validation failures throw specific errors (or return Err for FP code)
- Invalid state transitions are rejected
- Required fields are enforced
- Constraint violations are caught

### Error Path Testing (FP)

For Result-returning functions, test each error type:

- Test each error factory produces correct `_tag` and `code`
- Verify `statusCode` maps to expected HTTP status
- Check error `context` contains useful debugging info
- Test ResultAsync error mapping with `.mapErr()`

### Edge Cases (Boundary Conditions)

Test boundary and unusual conditions:

- Empty strings and collections
- Maximum/minimum values
- Null and undefined handling
- Unicode and special characters
- Date boundaries (leap years, timezone edge cases)

## Post-Scaffold Validation

Run these checks after scaffolding. All commands run from `apps/api` (the Deno
workspace root — there is no per-lib deno task and no `domain` Nx project):

```bash
cd apps/api

# Type check
deno check libs/domain/src/entities/{module}_test.ts

# Run all unit tests (skips integration tests)
deno task test:ci

# Run just the new test file
deno test --no-check --env-file=.env.test --allow-all libs/domain/src/entities/{module}_test.ts
```

## $ARGUMENTS

| Argument | Description | Example |
|----------|-------------|---------|
| `module` | Module/file to test | `Player`, `CreatePlayerUseCase` |
| `path` | Full path to file | `apps/api/libs/domain/src/entities/Player.ts` |
| `scenarios` | Key test scenarios | `creation, validation, state changes` |

## Example Usage

Create unit tests for Player entity:

```
Scaffold unit test:
- module: Player
- path: apps/api/libs/domain/src/entities/Player.ts
- scenarios: create, validate email, change status
```

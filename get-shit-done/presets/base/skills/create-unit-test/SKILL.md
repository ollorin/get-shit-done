---
name: create-unit-test
description: Use when implementing domain entities, use cases, or business logic - automatically create unit tests BEFORE writing implementation code (TDD approach)
disable-model-invocation: false
allowed-tools: Read, Write, Bash, Glob, Grep
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
| `{module}.ts` | `src/entities/Player.ts` |
| `{module}_test.ts` | `src/entities/Player_test.ts` |

Or with `.test.ts` suffix:

| Pattern | Example |
|---------|---------|
| `{module}.ts` | `src/use-cases/CreatePlayer.ts` |
| `{module}.test.ts` | `src/use-cases/CreatePlayer.test.ts` |

The test directory and the file pattern are the profile's (`stack.paths` and `stack.flake_patterns.test_globs`); the examples above use `src/`.

## Test Structure

Per project convention, all unit tests MUST include:

| Category | Purpose | Example |
|----------|---------|---------|
| **Positive cases** | Valid inputs produce expected output | Valid email passes validation |
| **Negative cases** | Invalid inputs throw errors | Invalid email throws ValidationError |
| **Edge cases** | Boundary conditions handled | Empty string, max length, null |

## Required Patterns

### 1. Use the project's testing framework

Import the assertion and test helpers of the framework the profile's test command runs. The examples below use the Node test runner and its strict assertions, which need no install:

```typescript
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
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
      assert.throws(() => { /* code */ }, ValidationError, "expected message");
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
  assert.equal(player.status, "INACTIVE");
});
```

### 4. Mock External Dependencies

For application layer tests, mock infrastructure:

```typescript
// Stub a repository
const mockRepository = {
  findById: mock.fn(async () => mockPlayer),
  save: mock.fn(),
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

### Result assertions (when the code returns Result values)

For functions that return a success or failure value rather than throwing, assert both arms explicitly with the project's result helpers (named by the project; the examples here call them `expectOk` and `expectErr`). Never assert a boolean such as `result.isOk() === true`: the helper narrows the type, so the next line can read the value.

```typescript
describe("FP function", () => {
  describe("positive cases", () => {
    it("should return Ok with valid input", async () => {
      const result = await functionUnderTest(validInput);

      expectOk(result);
      assert.deepEqual(result.value, expectedValue);
    });
  });

  describe("negative cases", () => {
    it("should return Err for invalid input", async () => {
      const result = await functionUnderTest(invalidInput);

      expectErr(result, "ValidationError");
      assert.equal(result.error.code, "VAL_001");
    });
  });

  describe("error paths", () => {
    it("should return specific error type", async () => {
      const result = await functionUnderTest(edgeCaseInput);

      expectErr(result);
      assert.equal(result.error._tag, "DatabaseError");
      assert.equal(result.error.statusCode, 500);
    });
  });
});
```

**Key Patterns:**
- Use `expectOk(result)` instead of a boolean check on the success arm
- Use `expectErr(result, "ErrorTag")` for typed error assertions
- Access `result.value` after `expectOk()` and `result.error` after `expectErr()`: the narrowing relies on the helper

## Test Categories

### Positive Cases (Happy Path)

Test that valid inputs produce expected outputs:

- Valid entity creation
- Successful state transitions
- Correct calculations
- Expected return values

### Negative Cases (Error Handling)

Test that invalid inputs produce correct errors:

- Validation failures throw specific errors (or return an error value for Result code)
- Invalid state transitions are rejected
- Required fields are enforced
- Constraint violations are caught

### Error Path Testing (Result code)

For Result-returning functions, test each error type:

- Test each error factory produces correct tag and code
- Verify `statusCode` maps to expected HTTP status
- Check error `context` contains useful debugging info
- Test async error mapping where the code maps errors

### Edge Cases (Boundary Conditions)

Test boundary and unusual conditions:

- Empty strings and collections
- Maximum/minimum values
- Null and undefined handling
- Unicode and special characters
- Date boundaries (leap years, timezone edge cases)

## Scaffold outline

Start from `test-outline.md` in this skill directory: one file, the three categories, one builder, and the TODO markers the owner fills in. It is an outline, not a runnable file, because the framework and the test directory are the profile's.

## Post-Scaffold Validation

Run these checks after scaffolding, from the project root, using the profile's commands:

```bash
# Type check the new test file (stack.commands.typecheck)
<stack.commands.typecheck>

# Run all unit tests, skipping integration tests (stack.commands.test_all)
<stack.commands.test_all>

# Run just the new test file (stack.commands.test_file, with the file path)
<stack.commands.test_file> src/entities/{module}.test.ts
```

## $ARGUMENTS

| Argument | Description | Example |
|----------|-------------|---------|
| `module` | Module/file to test | `Player`, `CreatePlayerUseCase` |
| `path` | Full path to file | `src/entities/Player.ts` |
| `scenarios` | Key test scenarios | `creation, validation, state changes` |

## Example Usage

Create unit tests for Player entity:

```
Scaffold unit test:
- module: Player
- path: src/entities/Player.ts
- scenarios: create, validate email, change status
```

# Unit test outline

Use this outline when `create-unit-test` scaffolds a test file. Replace the placeholders in braces, then fill each TODO with the real call. Keep one file per module, and place it where the profile's test directory says.

```typescript
/**
 * Unit tests for {module-name}
 *
 * Run all unit tests: {stack.commands.test_all}
 * Run this file only: {stack.commands.test_file} {path}
 */

// Import the assertion and test helpers of the project's framework.
// Import the module under test by its relative path.

// ---------------------------------------------------------------------------
// TEST DATA BUILDER
// ---------------------------------------------------------------------------

// Build test data with optional overrides. Customize the builder for the module.
function createTestData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-id-123",
    name: "Test Name",
    status: "ACTIVE",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UNIT TESTS
// ---------------------------------------------------------------------------

describe("{module-name}", () => {
  describe("positive cases", () => {
    it("should handle valid input correctly", () => {
      // Arrange: build the input. Act: call the function. Assert: check the output.
    });
    // TODO: one case per valid behaviour (create, calculate, transition)
  });

  describe("negative cases", () => {
    it("should throw on invalid input", () => {
      // Arrange: an invalid input. Act and assert: the expected error and message.
    });
    // TODO: one case per rejected input (invalid format, missing field, forbidden operation)
  });

  describe("edge cases", () => {
    it("should handle empty input", () => {
      // Arrange: empty string or collection. Assert: the defined default or refusal.
    });
    // TODO: boundaries (min, max), null and optional fields, unicode, date edges
  });

  describe("state transitions", () => {
    it("should allow a valid state transition", () => {
      // Act with an immutable update. Assert the new state and that the old one is unchanged.
    });
    // TODO: rejected transitions and state invariants
  });
});
```

Checks after the file is written: the type check (`{stack.commands.typecheck}`), the single-file run (`{stack.commands.test_file} {path}`), then the full unit run (`{stack.commands.test_all}`).

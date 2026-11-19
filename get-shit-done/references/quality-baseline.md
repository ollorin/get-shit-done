# Quality baseline

What every new project gets from its own linter and a project gate, so size and unused code cannot grow unnoticed. Set up at init by `workflows/new-project.md` step 2/2a, using the recipe for `stack.style.rule_set`.

## Rules (language-neutral)

1. **Size and complexity:** cyclomatic complexity 15, nesting depth 4, parameters 5, function length 80 lines (blank lines and comments not counted). Test files may allow longer functions (about 400) because `describe` blocks are long by nature; measure before choosing.
2. **Type-aware checks** where the language has them: unawaited promises, promises passed where a plain value is expected, non-exhaustive switch, await of a non-promise.
3. **Every suppression carries a reason**, and an unused suppression is an error.
4. **Unused code check** (files, exports, dependencies) runs as the project gate `unused-code`: set `stack.commands.unused_code`; `project init` and `project sync` then append the gate. Without the key there is no gate.
5. **Existing violations are frozen** with the linter's bulk-suppression mechanism (a per-file, per-rule count), never blanket disables; new code cannot add violations, and fixing one shrinks the file.
6. **Residue check:** `stack.commands.residue_check` prints how many rows or files tests left behind (0 is clean) for the test steward. Omit it when tests touch no database and write no files.

## js-ts

Packages: `eslint`, `typescript-eslint`, `@eslint-community/eslint-plugin-eslint-comments`, `knip` (verified against eslint 10.15, typescript-eslint 8.72, eslint-comments 4.8, knip 6.45).

```js
// eslint.config.mjs
import tseslint from "typescript-eslint";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
export default [
  ...tseslint.configs.recommended,
  {
    plugins: { "eslint-comments": eslintComments },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      complexity: ["error", 15], "max-depth": ["error", 4], "max-params": ["error", 5],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", minimumDescriptionLength: 10 }],
      "eslint-comments/require-description": "error",
    },
  },
  { files: ["tests/**/*.ts"], rules: { "max-lines-per-function": ["error", { max: 400, skipBlankLines: true, skipComments: true }] } },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error", "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error", "@typescript-eslint/await-thenable": "error",
    },
  },
];
```

`knip.jsonc`: `{ "entry": ["tests/**/*.test.ts"], "project": ["src/**/*.{ts,tsx}", "tests/**/*.ts"], "ignore": [], "ignoreDependencies": [] }`. Scope `project` to product code, not GSD tooling; every entry in `ignore`/`ignoreDependencies` gets a one-line reason beside it. Set `stack.commands.unused_code` to `npx knip`. Typed linting is slower (about 2 s to 8 s on a small project); the dependency check needs `node_modules` installed.

Freeze: `npx eslint --suppress-all <paths>` (all rules) or `--suppress-rule <rule> <paths>` writes `eslint-suppressions.json`; after fixing, `npx eslint --prune-suppressions <paths>`.

## python

Unverified here (ruff and vulture are not installed on this machine; check each name against the ruff docs before relying on it).

```toml
# pyproject.toml
[tool.ruff.lint]
select = ["C901", "PLR0912", "PLR0913", "PLR0915", "PGH004", "RUF100", "F401", "F841"]
[tool.ruff.lint.mccabe]
max-complexity = 15
[tool.ruff.lint.pylint]
max-args = 5
max-branches = 12
max-statements = 50
```

Ruff has no function-length-in-lines rule: `PLR0915` (statements) stands in for it; nesting depth is `PLR1702` (preview, needs `preview = true`). `PGH004` requires codes on `# noqa`, `RUF100` makes an unused `noqa` an error; no ruff rule requires a reason text, so write `# noqa: CODE -- reason` and have the style or review step reject a bare one. Type-aware async checks come from the type checker (pyright or mypy), not ruff. Unused code: `vulture src --min-confidence 80` as `stack.commands.unused_code` (exit 3 on findings), with a whitelist file for false positives, each with a reason. Freeze: `ruff check --add-noqa <paths>` marks every current violation; review that the added comments are the only diff.

## generic

No rule set for the language: apply rules 1 to 6 with that language's linter if one exists; otherwise record an assumption (rule, why none is available, what would replace it) in the project context and revisit when code appears.

## Adopting the baseline in an existing project

Freeze first, fix later: enable the rules, run the bulk-suppress command for the whole source tree so the linter is green and no new violation can enter, commit that alone, then fix per area (one directory per plan) and shrink the suppression file with the prune command after each. Set `stack.commands.unused_code` and run `project sync`: the `unused-code` gate is appended, no other gate or config value is rewritten. Fix or scope knip findings before enabling the gate, since it fails on any finding.

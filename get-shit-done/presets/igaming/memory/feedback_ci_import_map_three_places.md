---
name: CI import map must be updated in THREE places
description: Adding @igaming/* workspace imports requires updating import_map.json AND both CI workflow files — CI overwrites the repo import map with a hardcoded version
type: feedback
---

When adding a new `@igaming/*` bare specifier (e.g., `@igaming/rng`), you MUST update THREE files:
1. `apps/api/functions/import_map.json` (local dev)
2. `.github/workflows/pr-validation.yml` (~line 307, hardcoded import map)
3. `.github/workflows/deploy-staging.yml` (~line 249, hardcoded import map)

**Why:** CI workflows create their own `import_map.json` inside `supabase/functions/` that OVERWRITES the repo file. The hardcoded map only had `domain`, `application`, `infrastructure`. Missing `@igaming/rng` caused BOOT_ERROR on ALL edge functions in CI while passing locally.

**How to apply:** Any time you add a new workspace lib or new import map entry, grep both CI workflow files for the existing `@igaming/` entries and add the new one alongside them.

**v0.1.12 incident:** Spent 5+ failed CI pushes debugging this. The error message ("@igaming/rng not in import map") was accurate — the CI import map literally didn't have the entry. Local testing always passed because it used the real import_map.json.

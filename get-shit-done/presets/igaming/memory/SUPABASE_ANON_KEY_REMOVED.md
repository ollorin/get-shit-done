# SUPABASE_ANON_KEY Removed (Feb 11, 2026)

## Context
Removed `SUPABASE_ANON_KEY` from the entire codebase as we no longer use it for authentication or API calls.

## What Changed

### Authentication Pattern
- **Before**: Used `SUPABASE_ANON_KEY` for Supabase client initialization
- **After**: Use `SUPABASE_SERVICE_ROLE_KEY` for elevated operations (operator-web, backend) OR no key for public operations (player-web proxies)

### Affected Components

#### operator-web (Next.js app)
- **Supabase Clients**: Now use `SUPABASE_SERVICE_ROLE_KEY` instead of `ANON_KEY`
  - Server-side clients only; a service-role key must never reach a browser client (see the private tracker for status)
- **Reason**: Operator dashboard needs elevated privileges to manage players and bypass RLS

#### player-web (Next.js app)
- **API Routes**: Removed Authorization/apikey headers when calling Edge Functions
  - `src/app/api/games/search/route.ts`
  - `src/app/api/games/catalog/route.ts`
- **Custom Auth Client**: Already wasn't using anon key - uses session tokens
- **Reason**: Public endpoints don't need anon key, authenticated endpoints use session tokens

#### API (Edge Functions)
- **Supabase Client**: Removed `getSupabaseAuthClient()` function that used anon key
- **Reason**: Backend uses service role key for system operations

### Configuration Files Updated
- `.env.example` (root and all apps)
- `next.config.js` (player-web, operator-web) - removed from env config
- `.github/workflows/deploy-staging.yml` - removed from CI
- `.github/workflows/deploy-production.yml` - removed from CI
- `scripts/validate-env-vars.sh` - removed from validation

### Documentation Updated
- `memory_bank/vercel-staging-production-setup.md`
- All references to SUPABASE_ANON_KEY replaced with SUPABASE_SERVICE_ROLE_KEY where appropriate

## Important Notes

### Vercel Environment Variables
**For player-web**: Only needs `SUPABASE_URL` (no keys)
**For operator-web**: Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

### Security
- Service role key should ONLY be used in operator-web and backend
- Never expose service role key to player-facing applications
- Player auth uses custom session tokens, not Supabase keys

## Testing Impact
- Integration tests: No longer pass `SUPABASE_ANON_KEY` env var
- Test utilities: Updated `EdgeFunctionTestClient` to not require anon key
- All tests should continue passing with only `SUPABASE_SERVICE_ROLE_KEY`

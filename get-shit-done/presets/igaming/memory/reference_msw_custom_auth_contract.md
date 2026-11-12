---
name: msw-mock-handler-contract-custom-auth-api
description: "Custom auth Edge Functions return a flat camelCase response shape, NOT Supabase's native {session:{access_token}} nesting — MSW mocks must match the flat shape"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

## CRITICAL: never use Supabase native auth format in MSW handlers

The custom auth Edge Functions use a **flat response format** — NOT Supabase's native
`{ session: { access_token } }` shape.

**CORRECT format** (what Edge Functions return, what CustomAuthClient expects):
```json
{
  "success": true,
  "data": {
    "sessionToken": "...",
    "refreshToken": "...",
    "expiresAt": "2026-...",
    "playerId": "...",
    "playerAccountId": "...",
    "username": "...",
    "accountType": "...",
    "status": "...",
    "requires2FA": false
  }
}
```

**WRONG format** (Supabase native auth — never use in MSW mocks):
```json
{ "session": { "access_token": "...", "refresh_token": "..." } }
```

**For 2FA required**, return:
```json
{ "success": true, "data": { "requires2FA": true, "pendingSessionToken": "...", "twoFactorMethods": ["totp", "sms"] } }
```

**For token refresh**, return flat `{ sessionToken, refreshToken, expiresAt }` (not nested session).

**Profile handler `validTokens`** must include every token that can be issued:
- `'mock-session-token-jwt-string'` (login/register mock token)
- `'valid-session-token'` (used in test setup via `CustomAuthClient.saveTokens`)
- `'new-session-token'` (issued by refresh handler)

**Why this happened:** MSW handlers were written early copying Supabase native auth format. The
custom auth design (flat camelCase fields) was documented in Phase 37 and implemented consistently
in all 9 Edge Functions, but mocks were never updated. FP refactoring did NOT change the API shape
— it was always flat.

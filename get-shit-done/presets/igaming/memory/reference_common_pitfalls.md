---
name: common-backend-pitfalls-rpc-param-mismatches-schema-access-pattern
description: "RPC call keyword args must match DB function signature exactly; use public views (INSTEAD OF triggers), never .schema() for non-public schemas — PostgREST blocks it"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

## RPC function parameter mismatches

Always verify parameter names match the DB function signature exactly:
```typescript
// DB: verify_password(p_password TEXT, p_password_hash TEXT)
await supabase.rpc('verify_password', {
  p_password: password,      // must match
  p_password_hash: hash      // must match
})
```

## Schema access pattern

Always use public views with INSTEAD OF triggers:
```typescript
// CORRECT
await supabase.from('player_accounts').select()

// WRONG (PostgREST blocks non-public schemas)
await supabase.schema('player').from('player_accounts').select()
```

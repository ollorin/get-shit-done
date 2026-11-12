# Defect classes

Method: gates without an observed escape are speculation. A gate is added only after a defect escaped the existing gates, and the escape is recorded in the table below with its origin and the gate that missed it.

Each row is one general class. The project fills the three empty columns from its own review findings, one instance per row. Use the class name as written; add a class only when no row fits.

| Defect class | Origin (commit, phase) | Escaped gate | Evidence (file:line; rule or gate cite) |
|---|---|---|---|
| Swallowed errors on write paths: a failure of an audit, risk or value-moving write is dropped by a fire-and-forget call or an empty handler | | | |
| Failure-throwing code outside the adapter edge: throw or try/catch in domain or application code | | | |
| Fail-open gates: a compliance or value check allows the action when its own lookup fails | | | |
| Client-only authorization: a privileged operation trusts a check made only in the client or only at a route | | | |
| Missing access policy: an exposed table with access disabled, or a privileged function without a justified call policy and a fixed search path | | | |
| Session tokens in client-readable storage | | | |
| Oversized files that mix concerns, with no size gate | | | |
| Dispatch chains where a named routing rule already exists | | | |
| Non-atomic multi-write mutations: compensating steps in place of one transaction | | | |
| Coverage that hides zero-covered modules, and test files never type-checked | | | |

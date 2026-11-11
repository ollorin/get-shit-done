# Product Brief Template

Template for `.planning/PRODUCT-BRIEF.md`: the domain facts of this project. Technology goes to STACK-PROFILE.md; living requirements stay in PROJECT.md.

<template>

```markdown
# Product Brief

## Identity

- Name: [project display name]
- One-liner: [one sentence: what the product does and for whom]
- Owner title: [how rulings address the owner; the machine value lives in `config.json` `project.owner_title`]
- Slug: [the machine value lives in `config.json` `project.slug`; do not keep a second copy here]

## Domain Glossary

[Term: one-line definition. Stable domain words only, as used in code, tests and rulings.]
[A term with two meanings gets one line per meaning.]

## Users and Roles

[Role: what it may do, and what it may never do. One line per role.]
[Anonymous and authenticated callers are listed separately when their reads differ.]

## Risk Domains

| Domain | What counts as this path | Required test tier | Ruling required |
|--------|--------------------------|--------------------|-----------------|
| [id] | [paths, flows or data that fall under this domain] | [tier from the test policy] | [yes or no] |

[Intended: ids in this table equal `config.json` `project.risk_domains`, and the ruling column names ids from `project.ruling_topics`. `profile check` does not compare them yet; keep them in step by hand.]

## Compliance and Regulation

[Each regime that applies to this product, one line, with the rule it imposes.]

## Config Dimensions

[Values that must never be hard-coded (markets, currencies, modes), each with the config key that holds it.]

## Owner Policies

- Decided autonomously: [class of decision and its limit]
- Escalated to the owner: [class of decision]
- Launch strategy: [current scope decision]

## Out of Scope

[Explicit exclusions, one line each, so agents do not build them.]
```

</template>

<guidelines>
- Target 120 lines or fewer. Stable facts only.
- A risk domain is a path where a defect is unacceptable and needs the highest test tier.
- Every machine-read value lives in `config.json`; this file explains it and never becomes a second source.
- Owner policies here are the basis for autonomous decisions; change them only with the owner.
</guidelines>

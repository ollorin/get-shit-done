---
name: create-documentation
description: Use AFTER completing API endpoints or major features - automatically create structured documentation with YAML frontmatter, usage examples, and proper formatting
disable-model-invocation: false
allowed-tools: Read, Write, Glob, Grep
---

# Create Documentation Skill

## When to Use

Invoke this skill when:
- Writing API endpoint documentation
- Creating developer guides or tutorials
- Documenting architecture decisions
- Adding technical documentation to the project

**Trigger keywords:** documentation, docs, guide, API reference, how-to, tutorial

## Template Selection

Select template based on documentation type:

| Doc Type | Template | Location |
|----------|----------|----------|
| API endpoint | api.md | `.claude/skills/create-documentation/templates/api.md` |
| Developer guide | guide.md | `.claude/skills/create-documentation/templates/guide.md` |
| Architecture decision | architecture-doc.md | `docs/templates/architecture-doc.md` |
| Operational runbook | runbook.md | `docs/templates/runbook.md` |
| Database migration | migration.sql | `docs/templates/migration.sql` |

## Required Frontmatter

All documentation MUST include valid YAML frontmatter:

```yaml
---
title: "{Title}"
summary: "{One-line description for AI context}"
domain: "{api|frontend-player|frontend-operator|development|migrations|testing|deployment|project}"
updated: "{YYYY-MM-DD}"
tags: ["{tag1}", "{tag2}"]
---
```

**Optional fields:**
- `audience`: Target readers (e.g., `[backend-developers, integrators]`)
- `prerequisites`: Required reading (e.g., `[docs/DEVELOPMENT.md]`)
- `related`: Related documentation links
- `status`: `draft`, `published`, or `deprecated`

## Document Structure

### For large docs (>200 lines)

Include AI Summary block after frontmatter:

```markdown
> **AI Summary**: 2-3 sentences describing document contents, key technologies,
> and primary use cases. Include skill level if a guide.

> **Key Concepts**: term1, term2, term3

> **Related Docs**:
> - [Related Doc](path/to/doc.md) - Brief description
```

### Standard sections

1. **Clear heading hierarchy:** H1 (title) -> H2 (major sections) -> H3 (subsections)
2. **Code examples:** Fenced blocks with language identifiers
3. **Tables:** For structured data (parameters, status codes, options)
4. **Links:** Use absolute paths from repo root (`/docs/api/README.md`)

## Post-Scaffold Validation

After creating documentation, verify:

1. **Frontmatter is valid YAML:**
   - No syntax errors
   - Required fields present: `title`, `summary`, `domain`, `updated`, `tags`

2. **Links are valid:**
   - Internal links point to existing files
   - No broken anchor references

3. **Structure follows template:**
   - All required sections present
   - Placeholder text replaced with actual content

## Usage

```
$ARGUMENTS: doc_type, title, domain

Example:
- doc_type: "api" | "guide" | "architecture"
- title: "Player Authentication API"
- domain: "api"
```

## Related Resources

- [Documentation Templates](/docs/templates/README.md) - Full template catalog
- [API Documentation](/docs/api/README.md) - Example API docs
- [Deployment Guides](/docs/deployment/README.md) - Example runbooks

---
title: "[Guide Title]"
summary: "[One-line description of what this guide teaches]"
domain: "[a domain of the product brief]"
tags: [guide, tutorial, feature-name]
audience: [backend-developers, frontend-developers]
prerequisites: []
related: []
updated: YYYY-MM-DD
status: draft
---

# [Guide Title]

> **AI Summary**: [2-3 sentences describing what this guide teaches, what you'll
> accomplish, key technologies, and expected time. Include skill level.]

> **Key Concepts**: [concept1, concept2, concept3]

> **Related Docs**:
> - [Related Guide](/docs/path/to/doc.md) - Why it's related

---

## Overview

### What This Guide Covers

[Describe what the reader will learn.]

**You will learn:**
- [Learning outcome 1]
- [Learning outcome 2]
- [Learning outcome 3]

**Time Required:** ~X minutes

**Skill Level:** [Beginner | Intermediate | Advanced]

---

## Prerequisites

### Required Knowledge

- [ ] [Knowledge 1 - e.g., "Basic TypeScript familiarity"]
- [ ] [Knowledge 2 - e.g., "Understanding of REST APIs"]

### Required Setup

- [ ] **Development Environment:**
  ```bash
  node --version  # Should be v18+
  ```

- [ ] **Project Setup:**
  ```bash
  git clone https://github.com/your-org/repo.git
  cd repo && <install command>
  ```

### Recommended Reading

- [Prerequisite doc](/docs/path.md) - Brief description

---

## What You'll Build

### Overview

[Describe the end result.]

**Features:**
- [Feature 1]
- [Feature 2]
- [Feature 3]

**Code Structure:**
```
project/
  src/
    feature/
      component.ts    # [Description]
      service.ts      # [Description]
  tests/
    feature.test.ts
```

---

## Step-by-Step Instructions

### Step 1: [Step Title]

**Goal:** [What this step accomplishes]

**Duration:** ~X minutes

#### Instructions

1. **[Sub-step 1]:**

   [Detailed explanation]

   ```typescript
   // Code example
   export function example() {
     // Implementation
   }
   ```

2. **[Sub-step 2]:**

   [Detailed explanation]

   ```bash
   <stack.commands.build>
   ```

#### Verify Step 1

```bash
<stack.commands.test_file> feature.test.ts
```

**Expected output:**
```
PASS feature.test.ts
```

**Success Criteria:**
- [Criterion 1]
- [Criterion 2]

**Common Issues:**
- [Issue 1] -> [Solution]

---

### Step 2: [Step Title]

**Goal:** [What this step accomplishes]

**Duration:** ~X minutes

#### Instructions

1. **[Sub-step 1]:**

   [Detailed explanation]

   ```typescript
   // Code example
   ```

#### Verify Step 2

```bash
# Verification command
```

**Success Criteria:**
- [Criterion 1]

---

## Testing Your Implementation

### Unit Tests

```typescript
// import { describe, it, expect } from '<the project test framework>';
import { yourFunction } from '../src/feature';

describe('Feature', () => {
  it('should work correctly', () => {
    const result = yourFunction();
    expect(result).toBe(expected);
  });
});
```

```bash
<stack.commands.test_all>
```

### Integration Testing

```bash
<dev server command>
curl -X POST http://localhost:<port>/api/feature \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

---

## Troubleshooting

### Issue 1: [Error Message]

**Symptoms:**
- [Symptom 1]

**Cause:** [Explanation]

**Solution:**
```bash
# Fix command
```

### Issue 2: [Error Message]

**Symptoms:**
- [Symptom 1]

**Cause:** [Explanation]

**Solution:**
```bash
# Fix command
```

---

## Next Steps

### Recommended Follow-Up

1. **[Related Guide]** - [Path]
   - Why: [How it builds on this]

2. **[Related Guide]** - [Path]
   - Why: [How it builds on this]

### Best Practices

1. **[Best Practice 1]:**
   - Why it matters
   - How to implement

---

## Quick Reference

### Commands Summary

```bash
# Setup
<install command>

# Development
<dev server command>

# Testing
<stack.commands.test_all>

# Build
<stack.commands.build>
```

### Key Files

| File | Purpose |
|------|---------|
| `src/feature/component.ts` | [Description] |
| `tests/feature.test.ts` | [Description] |

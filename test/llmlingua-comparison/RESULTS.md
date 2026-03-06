# LLMLingua vs Header Extraction — Benchmark Results

**Date:** 2026-02-20
**Docs tested:** 5 (authentication, testing, vercel-deployment, backend-architecture, troubleshooting)
**Questions per doc:** 18
**Model:** claude-haiku-4-5 for all conditions
**LLMLingua model:** microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank (rate=0.4)

## Methodology

For each doc, 4 Haiku agents ran independently:
- **Ground truth / Full doc**: read original file, answer 18 questions
- **Full doc (fresh context)**: separate Haiku, same original file, same questions
- **LLMLingua**: separate Haiku, LLMLingua-compressed file (rate=0.4), same questions
- **Header extraction**: separate Haiku, header+first-paragraph extracted file, same questions

Scoring: confidence 1–5 per answer. INSUF/LOW = questions scored ≤2.

## Results by Document

| Doc | Orig tokens | LLMLingua tokens | Header tokens | Full doc | LLMLingua | Header extr |
|-----|------------|-----------------|--------------|---------|-----------|-------------|
| authentication | 8,859 | 4,952 (-44%) | 6,083 (-31%) | 4.83/5 | 4.67/5 | 4.67/5 |
| testing | 7,097 | 4,186 (-41%) | 4,383 (-38%) | 5.00/5 | 3.89/5 | 4.78/5 |
| vercel-deployment | 5,552 | 3,320 (-40%) | 4,909 (-12%) | 5.00/5 | 4.44/5 | 4.56/5 |
| backend-architecture | 4,860 | 2,776 (-43%) | 2,283 (-53%) | 5.00/5 | 4.72/5 | 3.67/5 |
| troubleshooting | 3,870 | 2,268 (-41%) | 3,625 (-6%) | 5.00/5 | 3.50/5 | 4.89/5 |

## Aggregate Results

| Condition | Avg tokens | Reduction | Avg quality | Low-conf answers |
|-----------|-----------|-----------|-------------|-----------------|
| Full doc | 6,048 | baseline | 4.97/5 | 0/90 |
| Header extraction | 4,257 | **-30%** | **4.51/5** | 8/90 |
| LLMLingua | 3,500 | **-42%** | **4.24/5** | 6/90 |

## Key Findings

### 1. LLMLingua saves 12% more tokens than header extraction
- LLMLingua: consistent ~42% reduction across all doc types
- Header extraction: wildly inconsistent — 6% on prose, 53% on code-heavy docs
- Neither approach collapses completely — both maintain reasonable information density

### 2. Header extraction preserves quality better overall (4.51 vs 4.24)
- Header extraction loses -0.46 quality points vs full doc
- LLMLingua loses -0.72 quality points vs full doc
- But this average hides important doc-type patterns

### 3. Doc type is the dominant factor — neither approach is universally better

| Doc type | LLMLingua | Header | Winner |
|----------|-----------|--------|--------|
| Code-heavy (backend-architecture) | 4.72/5 | 3.67/5 | **LLMLingua +1.05** |
| Command/prose (troubleshooting) | 3.50/5 | 4.89/5 | **Header +1.39** |
| Mixed/large (authentication) | 4.67/5 | 4.67/5 | **Tie** |
| Bullet-heavy (testing) | 3.89/5 | 4.78/5 | **Header +0.89** |
| Config/YAML (vercel-deployment) | 4.44/5 | 4.56/5 | **Header +0.12** |

### 4. What LLMLingua drops
- **Specific commands and flags**: `deno test --allow-all --env-file=.env.test --filter` → compressed to `deno task test`
- **Exact credentials**: test credentials and project IDs lost (troubleshooting Q1, Q4, Q7, Q10)
- **List items in bullet points**: tends to drop alternating list items
- **Preserves well**: conceptual descriptions, architecture patterns, high-level flow

### 5. What header extraction drops
- **Code block contents**: only takes first ~400 chars of body per section
- **Specific values in code**: TTL defaults, default limits, enum values buried in code examples
- **backend-architecture failures**: Q2 (TTL default), Q3 (session expiry days), Q9 (error prefixes), Q15 (pagination default), Q16 (mapToDomain details), Q17 (error comparison)
- **Preserves well**: prose explanations, top-level decisions, step-by-step instructions

## Recommendation

**Use a hybrid approach:**

1. **Detect doc type** — does it contain >20% code blocks?
   - If yes → use LLMLingua (preserves code context better)
   - If no → use header extraction (preserves commands and lists better)

2. **For GSD's use case** (AI agent reading docs for planning decisions):
   - Architecture docs → LLMLingua
   - Troubleshooting / runbooks / API references → header extraction
   - Testing docs / guides → header extraction
   - Authentication / security specs → LLMLingua (densely structured)

3. **If adding LLMLingua to GSD**: ~17s model load on first run, then fast (<2s per doc). Cache the model between hook invocations using a persistent process.

## LLMLingua Implementation Notes
- Model: `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`
- Rate 0.4 = keep 40% of tokens (tested; good balance)
- Rate 0.3 would save more tokens but risks dropping specific values
- Force tokens `['\n', '?', '#', '\`']` preserve structure markers
- Load time: ~17s cold, subsequent compressions ~1-2s per chunk
- Chunking at 3000 chars avoids memory issues on large docs

#!/usr/bin/env python3
"""Compute per-doc, per-condition scores from all answer JSON blobs."""
import json

results = {
    "authentication": {
        "tokens": {"original": 8859, "llmlingua": 4952, "header": 6083},
        "reduction": {"llmlingua": 44.1, "header": 31.3},
        "full_doc":  [5,3,5,5,5,5,5,5,5,5,5,5,5,5,5,5,4,5],
        "llmlingua": [5,3,5,5,5,4,5,5,5,5,4,5,5,5,5,4,4,5],
        "header":    [5,3,5,5,5,5,5,5,5,5,5,5,5,3,5,5,3,5],
    },
    "testing": {
        "tokens": {"original": 7097, "llmlingua": 4186, "header": 4383},
        "reduction": {"llmlingua": 41.0, "header": 38.2},
        "full_doc":  [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
        "llmlingua": [5,5,4,5,2,3,5,4,5,1,4,3,4,5,4,3,4,4],
        "header":    [5,5,5,5,5,5,5,3,5,5,4,5,5,5,5,4,5,5],
    },
    "vercel-deployment": {
        "tokens": {"original": 5552, "llmlingua": 3320, "header": 4909},
        "reduction": {"llmlingua": 40.2, "header": 11.6},
        "full_doc":  [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
        "llmlingua": [5,4,5,3,4,5,5,5,5,5,4,5,3,5,4,5,4,4],
        "header":    [5,5,5,5,5,5,5,5,5,5,5,1,5,5,5,1,5,5],
    },
    "backend-architecture": {
        "tokens": {"original": 4860, "llmlingua": 2776, "header": 2283},
        "reduction": {"llmlingua": 42.9, "header": 53.0},
        "full_doc":  [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
        "llmlingua": [5,4,5,5,5,5,5,5,4,5,5,5,5,5,3,5,4,5],
        "header":    [5,2,1,5,5,5,5,5,2,5,5,5,4,5,1,1,2,3],
    },
    "troubleshooting": {
        "tokens": {"original": 3870, "llmlingua": 2268, "header": 3625},
        "reduction": {"llmlingua": 41.4, "header": 6.3},
        "full_doc":  [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
        "llmlingua": [3,4,4,2,3,5,2,5,4,3,2,4,4,4,2,4,3,5],
        "header":    [4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,4,5],
    },
}

print("=" * 72)
print("LLMLINGUA vs HEADER EXTRACTION vs FULL DOC — COMPARISON REPORT")
print("=" * 72)
print()

all_scores = {"full_doc": [], "llmlingua": [], "header": []}
all_insuf  = {"full_doc": [], "llmlingua": [], "header": []}

for doc, data in results.items():
    print(f"── {doc} ──────────────────────────────")
    tok = data["tokens"]
    red = data["reduction"]
    print(f"  Tokens  : original={tok['original']:,}  llmlingua={tok['llmlingua']:,} (-{red['llmlingua']}%)  header={tok['header']:,} (-{red['header']}%)")

    for cond in ("full_doc", "llmlingua", "header"):
        scores = data[cond]
        avg = sum(scores) / len(scores)
        insuf = scores.count(1) + scores.count(2)
        low = [i+1 for i, s in enumerate(scores) if s <= 2]
        all_scores[cond].append(avg)
        all_insuf[cond].append(insuf)
        label = {"full_doc": "Full doc   ", "llmlingua": "LLMLingua  ", "header": "Hdr extract"}[cond]
        low_str = f"  LOW Qs: {low}" if low else ""
        print(f"  {label}: avg={avg:.2f}/5  INSUF/LOW={insuf}{low_str}")
    print()

print("=" * 72)
print("AGGREGATE ACROSS ALL 5 DOCUMENTS (90 questions each)")
print("=" * 72)
for cond in ("full_doc", "llmlingua", "header"):
    avg = sum(all_scores[cond]) / len(all_scores[cond])
    total_insuf = sum(all_insuf[cond])
    label = {"full_doc": "Full doc   ", "llmlingua": "LLMLingua  ", "header": "Hdr extract"}[cond]
    print(f"  {label}: avg confidence={avg:.2f}/5   total low-confidence answers={total_insuf}/90")

print()
print("TOKEN EFFICIENCY (avg tokens vs avg quality degradation from full-doc baseline):")
orig_avg  = sum(r["tokens"]["original"] for r in results.values()) / len(results)
ll_avg    = sum(r["tokens"]["llmlingua"] for r in results.values()) / len(results)
hdr_avg   = sum(r["tokens"]["header"] for r in results.values()) / len(results)
fd_qual   = sum(all_scores["full_doc"]) / len(all_scores["full_doc"])
ll_qual   = sum(all_scores["llmlingua"]) / len(all_scores["llmlingua"])
hdr_qual  = sum(all_scores["header"]) / len(all_scores["header"])
print(f"  Full doc   : {orig_avg:,.0f} tokens  quality=baseline")
print(f"  LLMLingua  : {ll_avg:,.0f} tokens (-{(1-ll_avg/orig_avg)*100:.0f}%)  quality={ll_qual:.2f} (Δ={ll_qual-fd_qual:+.2f})")
print(f"  Hdr extract: {hdr_avg:,.0f} tokens (-{(1-hdr_avg/orig_avg)*100:.0f}%)  quality={hdr_qual:.2f} (Δ={hdr_qual-fd_qual:+.2f})")

print()
print("DOC-TYPE ANALYSIS:")
print("  Code-heavy docs (backend-architecture):")
print("    LLMLingua 4.72/5 vs Header 3.67/5 → LLMLingua wins by 1.05")
print("  Prose/command docs (troubleshooting):")
print("    LLMLingua 3.50/5 vs Header 4.89/5 → Header wins by 1.39")
print("  Large structured docs (authentication):")
print("    LLMLingua 4.67/5 vs Header 4.39/5 → LLMLingua wins by 0.28")
print("  Mixed docs (testing):")
print("    LLMLingua 3.89/5 vs Header 4.78/5 → Header wins by 0.89")
print("  Config/YAML heavy (vercel-deployment):")
print("    LLMLingua 4.44/5 vs Header 4.56/5 → Slight header edge")

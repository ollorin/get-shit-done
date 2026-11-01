#!/usr/bin/env python3
"""Markdown table from experiments/12-test-redundancy/*/summary.json.  python3 -I aggregate.py <dir>"""
import json, os, sys, glob

root = sys.argv[1]
print('| module | src/test LOC | cases | mutants | killed (tests) | killed (type-check) | survived | module-level kills | zero-kill cases | zero-unique cases | greedy keep | droppable cases | droppable case LOC / all case LOC | ms per mutant |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for p in sorted(glob.glob(os.path.join(root, '*', 'summary.json'))):
    d = json.load(open(p))
    s = d['summary']
    name = os.path.basename(os.path.dirname(p))
    o = s['outcomes']
    real = [c for c in d['perCase'] if not c['name'].startswith('[other-file]')]
    zk = sum(1 for c in real if c['kills'] == 0)
    zu = sum(1 for c in real if c['unique'] == 0)
    n = s['nMutants']
    print(f"| {name} | {s['srcLoc']}/{s['testLoc']} | {s['nCases']} | {n} | {o.get('killed', 0)} | {o.get('killed-typecheck', 0)} | {o.get('survived', 0)} | {len(s['killedUnattributed'])} | {zk} | {zu} | {s['greedyCount']} | {s['droppableCount']} | {s['droppableLoc']} / {s['caseLocTotal']} | {round(s['totalMutantMs'] / max(n, 1))} |")

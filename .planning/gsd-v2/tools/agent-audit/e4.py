from common import *
S=rs('gsd-executor')
code=re.compile(r'\.(ts|tsx|sql|dart|js|py|sh)$')
testrx=re.compile(r'deno (task )?test|deno task|nx test|nx run|run-integration|vitest|npm (run )?test|flutter test|pytest|preflight|test:ci')
chk=re.compile(r'deno check|deno lint|fp-gate|nx (typecheck|lint)')
claim=re.compile(r'(?i)(tests?|suite|buckets?|unit)[^.\n]{0,40}(green|pass)|(green|passed)\b')
res=collections.Counter(); ex=collections.defaultdict(list)
for r in S:
    ev=P[r['path']]
    idx=[i for i,e in enumerate(ev) if e[0]=='tu' and e[1] in('Edit','Write') and code.search(e[2].get('p') or '') and '/.planning/' not in (e[2].get('p') or '') and '/.tmp/' not in (e[2].get('p') or '')]
    if not idx: res['no code edits']+=1; continue
    last=idx[-1]
    after=[e for e in ev[last+1:] if e[0]=='tu' and e[1]=='Bash']
    t=any(testrx.search(e[2]['cmd']) for e in after); c=any(chk.search(e[2]['cmd']) for e in after)
    lt=last_text(ev); cl=bool(claim.search(lt))
    k=('code-edits; test-after' if t else ('code-edits; only check/lint after' if c else 'code-edits; NO test/check after last edit'))
    res[k]+=1
    if not t:
        res[k+(' & claims green/pass' if cl else ' & no claim')]+=1
        if cl and len(ex[k])<5: ex[k].append(bn(r))
    # steps between last edit and end
for k,v in sorted(res.items()): print(f'{k:70s}{v}')
print(dict(ex))

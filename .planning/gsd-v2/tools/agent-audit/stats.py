import re,glob,os,json,sys
rows=[]
for p in sorted(glob.glob(os.path.expanduser('~/get-shit-done/agents/gsd-*.md'))):
    t=open(p).read(); n=os.path.basename(p)[:-3]
    inst=os.path.expanduser('~/.claude/agents/'+n+'.md')
    isz=os.path.getsize(inst) if os.path.exists(inst) else None
    fm=re.match(r'---\n(.*?)\n---\n',t,re.S); fmt=fm.group(1) if fm else ''
    body=t[fm.end():] if fm else t
    def f(k):
        m=re.search(r'^'+k+r':\s*(.*)$',fmt,re.M); return m.group(1).strip() if m else ''
    emph=len(re.findall(r'\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|MANDATORY|REQUIRED|DO NOT|NON-NEGOTIABLE|ABSOLUTE)\b',body))
    caps=len(re.findall(r'\b[A-Z]{4,}\b',body))
    fences=sum(len(m) for m in re.findall(r'```.*?```',body,re.S))
    # sections: xml tags at line start
    secs=[]
    for m in re.finditer(r'^<([a-z_]+)[^>]*>\s*$',body,re.M):
        tag=m.group(1); e=body.find('</'+tag+'>',m.end())
        if e>0: secs.append((tag,e-m.start()))
    hd=[(m.group(0)[:60]) for m in re.finditer(r'^#{1,3} .*$',body,re.M)]
    refs=sorted(set(re.findall(r'(?:~|\$HOME|<home>)/\.claude/get-shit-done/[\w./-]+|get-shit-done/(?:workflows|references|templates)/[\w.-]+',body)))
    digest=[s for s in secs if 'digest' in s[0] or 'hard_rules' in s[0]]
    dg=re.search(r'(?i)hard rules digest',body)
    rows.append(dict(agent=n,bytes=len(t.encode()),inst_bytes=isz,lines=t.count('\n'),model=f('model'),tools=f('tools'),other_fm=[l.split(':')[0] for l in fmt.splitlines() if l and not l.startswith(' ') and l.split(':')[0] not in('name','description','tools','model','color')],emph=emph,caps=caps,fence_bytes=fences,secs=sorted(secs,key=lambda x:-x[1])[:8],refs=refs,digest=digest,digest_text=bool(dg)))
json.dump(rows,open('<project-root>/.tmp/gsd-v2/agent-audit/stats.json','w'),indent=1)
for r in rows:
    print(f"{r['agent']:28} {r['bytes']:6} inst={r['inst_bytes']} L{r['lines']} m={r['model'] or '-'} emph={r['emph']} caps={r['caps']} fence={r['fence_bytes']} fm+={r['other_fm']} digest={r['digest'] or r['digest_text']}")
    print('   tools:',r['tools'][:150])
    print('   secs:',[(a,b) for a,b in r['secs']])
    print('   refs:',r['refs'][:12])

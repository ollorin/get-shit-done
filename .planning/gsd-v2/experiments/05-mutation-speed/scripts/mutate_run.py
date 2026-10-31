#!/usr/bin/env python3
"""Scripted mutate-run-restore, no LLM per mutant. Usage: mutate_run.py <api_dir> <src_rel> <test_rel> <mutants.json> <mode> [workers]
mode: inplace | inplace-filter | copy-par
mutants.json: [{"id":..,"old":..,"new":..,"first_failing":"<test name substring or null>"}]"""
import sys,json,subprocess,time,hashlib,os,shutil,concurrent.futures as cf
api,src,tst,mj,mode=sys.argv[1:6]; W=int(sys.argv[6]) if len(sys.argv)>6 else 4
M=json.load(open(mj)); sp=os.path.join(api,src); tp=os.path.join(api,tst)
orig=open(sp,'rb').read(); h0=hashlib.sha256(orig).hexdigest()
def run(cmd): 
    t=time.time(); p=subprocess.run(cmd,cwd=api,capture_output=True,text=True); return p.returncode,time.time()-t,p.stdout+p.stderr
def mutate(m):
    s=orig.decode()
    assert s.count(m['old'])==1,('old string not unique/absent',m['id'],s.count(m['old']))
    return s.replace(m['old'],m['new'])+'\n// salt '+str(time.time_ns())+'\n'
def kind(rc,out):
    if rc==0: return 'SURVIVED'
    return 'kill-typechk' if 'Type checking failed' in out else 'kill-test'
res=[]; T0=time.time()
if mode.startswith('inplace'):
    for m in M:
        try:
            open(sp,'w').write(mutate(m))
            cmd=['deno','test',tst]+(['--filter',m['first_failing']] if mode=='inplace-filter' and m.get('first_failing') else [])
            rc,dt,out=run(cmd)
        finally:
            open(sp,'wb').write(orig)
        assert hashlib.sha256(open(sp,'rb').read()).hexdigest()==h0,'RESTORE MISMATCH'
        res.append((m['id'],kind(rc,out),dt))
else:
    d=os.path.dirname(sp); tmpd=os.path.join(d,'.mutcopies'); os.makedirs(tmpd,exist_ok=True)
    tsrc=open(tp).read(); base=os.path.basename(sp)
    def job(m):
        mdir=os.path.join(tmpd,m['id']); os.makedirs(mdir,exist_ok=True)
        open(os.path.join(mdir,base),'w').write(mutate(m))
        tt=tsrc.replace('./'+base,'./'+base)  # test imports sibling; copy test next to the mutant
        tf=os.path.join(mdir,os.path.basename(tp)); open(tf,'w').write(tt)
        rc,dt,out=run(['deno','test',os.path.relpath(tf,api)]); return (m['id'],kind(rc,out),dt)
    with cf.ThreadPoolExecutor(W) as ex: res=list(ex.map(job,M))
    shutil.rmtree(tmpd)
wall=time.time()-T0
assert hashlib.sha256(open(sp,'rb').read()).hexdigest()==h0
for r in res: print('%-4s %-9s %5.2fs'%r)
print('MODE %s mutants %d test-kills %d wall %.1fs per-mutant %.2fs'%(mode,len(M),sum(1 for r in res if r[1]=='kill-test'),wall,wall/len(M)))

#!/usr/bin/env python3
"""Prompt-cache TTL break-even per agent role (5 min vs 1 h), simulated from real transcripts.

Reuses lib.py (index load, role(), model(), window, tier) and extract.process (only for transcripts missing/stale in the
index). Adds one per-call pass (timestamps + usage incl. cache_creation.ephemeral_*) that the index does not keep.
Read-only; writes only the --out markdown file.

  python3 scripts/gsd-metrics/cache_ttl.py [--out PATH] [--workers N] [--no-write]
  GSD_SINCE / GSD_UNTIL as in the other tools (default: last 21 days).
"""
import os, sys, json, glob, argparse, statistics, datetime, collections
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, extract

DEFAULT_OUT = os.path.expanduser('~/get-shit-done/.planning/gsd-v2/experiments/03-coordinator-cache-ttl/RESULT-BREAKEVEN.md')
COORD = 'gsd-phase-coordinator'
M5, M1 = 300.0, 3600.0


def ep(ts):
    return datetime.datetime.fromisoformat(ts[:-1] + '+00:00').timestamp()


def call_tier(model_name, fallback):
    t = lib.tier(model_name)
    if t == 'haiku4':
        return 'haiku'
    if t in ('opus', 'sonnet', 'haiku'):
        return t
    if 'fable' in (model_name or '').lower():
        return 'fable'
    return fallback


def read_calls(path):
    """[(ts, model, in, cc_total, cr, cc5, cc1, has_split)] one per assistant message id, first-seen order."""
    seen = set(); out = []
    with open(path, 'r', errors='replace') as f:
        for line in f:
            if '"type":"assistant"' not in line or '"cache_read_input_tokens"' not in line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get('type') != 'assistant' or d.get('isApiErrorMessage') or not d.get('timestamp'):
                continue
            msg = d.get('message') or {}
            mid = msg.get('id'); mdl = msg.get('model') or ''
            if mid in seen or mdl == '<synthetic>':
                continue
            seen.add(mid)
            u = msg.get('usage') or {}
            i = u.get('input_tokens') or 0
            cc = u.get('cache_creation_input_tokens') or 0
            cr = u.get('cache_read_input_tokens') or 0
            sp = u.get('cache_creation')
            if isinstance(sp, dict) and ('ephemeral_5m_input_tokens' in sp or 'ephemeral_1h_input_tokens' in sp):
                c5 = sp.get('ephemeral_5m_input_tokens') or 0
                c1 = sp.get('ephemeral_1h_input_tokens') or 0
                has = True
            else:
                c5 = c1 = 0; has = False
            out.append((ep(d['timestamp']), mdl, i, cc, cr, c5, c1, has))
    return out


def sim_file(calls, fb_tier, price, mult, obs_first=False):
    """Returns dict with $ costs under 5m and 1h, plus the decomposition used for break-even."""
    mr, w5, w1 = mult['read'], mult['w5'], mult['w1']
    res = {'c5': 0.0, 'c1': 0.0, 'c5_of': 0.0, 'prem': 0.0, 'save': 0.0, 'rescued': 0, 'w1tok': 0,
           'g_n': 0, 'g_5m': 0, 'g_1h': 0}
    prev_ctx = None; prev_ts = None
    for (ts, mdl, i, cc, cr, c5, c1, has) in calls:
        ctx = i + cc + cr
        p = price[call_tier(mdl, fb_tier)] / 1e6
        if prev_ctx is None:
            res['c5'] += p * ctx * w5
            res['c1'] += p * ctx * w1
            res['w1tok'] += ctx
            # diagnostic variant: first call's observed cache read (prefix shared with a sibling spawn) kept as a read
            rd = min(cr, ctx)
            res['c5_of'] += p * (rd * mr + (ctx - rd) * w5)
        else:
            gap = max(0.0, ts - prev_ts)
            res['g_n'] += 1
            if gap > M5: res['g_5m'] += 1
            if gap > M1: res['g_1h'] += 1
            rd = min(prev_ctx, ctx); tail = ctx - rd
            # TTL 5m
            hit5 = gap <= M5
            res['c5'] += p * ((rd * mr + tail * w5) if hit5 else ctx * w5)
            res['c5_of'] += p * ((rd * mr + tail * w5) if hit5 else ctx * w5)
            # TTL 1h
            hit1 = gap <= M1
            res['c1'] += p * ((rd * mr + tail * w1) if hit1 else ctx * w1)
            res['w1tok'] += tail if hit1 else ctx
            if hit1 and not hit5:
                res['rescued'] += 1
                res['save'] += p * rd * (w5 - mr)
        prev_ctx = ctx; prev_ts = ts
    return res


def worker(job):
    path, rec_role, fb_tier, price, mult = job
    calls = read_calls(path)
    r = {'path': path, 'role': rec_role, 'n': len(calls)}
    if not calls:
        return r
    s = sim_file(calls, fb_tier, price, mult)
    # premium$ = sum over 1h-sim written tokens x (w1-w5) x price; recompute exactly for the per-tier price
    prem = 0.0; prev_ctx = None; prev_ts = None
    for (ts, mdl, i, cc, cr, c5, c1, has) in calls:
        ctx = i + cc + cr; p = price[call_tier(mdl, fb_tier)] / 1e6
        if prev_ctx is None: wt = ctx
        else:
            gap = max(0.0, ts - prev_ts); rd = min(prev_ctx, ctx)
            wt = (ctx - rd) if gap <= M1 else ctx
        prem += p * wt * (mult['w1'] - mult['w5'])
        prev_ctx = ctx; prev_ts = ts
    s['prem'] = prem
    obs = {'in': 0, 'cr': 0, 'cc5': 0, 'cc1': 0, 'ccu': 0}; act = 0.0
    byday = collections.defaultdict(lambda: [0, 0])
    for (ts, mdl, i, cc, cr, c5, c1, has) in calls:
        p = price[call_tier(mdl, fb_tier)] / 1e6
        obs['in'] += i; obs['cr'] += cr
        if has:
            obs['cc5'] += c5; obs['cc1'] += c1
            act += p * (i + cr * mult['read'] + c5 * mult['w5'] + c1 * mult['w1'] + max(0, cc - c5 - c1) * mult['w5'])
            dk = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            byday[dk][0] += c5; byday[dk][1] += c1
        else:
            obs['ccu'] += cc
            act += p * (i + cr * mult['read'] + cc * mult['w5'])
    r.update(s); r['obs'] = obs; r['act'] = act; r['byday'] = dict(byday)
    r['t_first'] = calls[0][0]
    return r


def load_index():
    recs = {}
    for r in lib.load(since='2000-01-01', until='2100-01-01'):
        recs[r['path']] = r
    return recs


def candidates(since_epoch):
    jobs = []
    for proj in extract.PROJ:
        d = extract.BASE + proj
        for p in glob.glob(d + '/*.jsonl'): jobs.append((p, proj, 'top'))
        for p in glob.glob(d + '/*/subagents/*.jsonl'): jobs.append((p, proj, 'sub'))
    keep = []
    for j in jobs:
        try:
            if os.path.getmtime(j[0]) >= since_epoch: keep.append(j)
        except OSError:
            pass
    return keep


def fmt_m(x): return '%.1f' % (x / 1e6)


def verdict(delta_pct):
    if abs(delta_pct) < 2.0: return 'neutral (<2%)'
    return '1h pays' if delta_pct > 0 else '5m pays'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--no-write', action='store_true')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--days', type=float, default=21.0, help='default window length when GSD_SINCE unset')
    ap.add_argument('--read', type=float, default=0.1)
    ap.add_argument('--base', type=float, default=1.0, help='base input multiplier')
    ap.add_argument('--write5m', type=float, default=1.25)
    ap.add_argument('--write1h', type=float, default=2.0)
    ap.add_argument('--price-opus', type=float, default=5.0)
    ap.add_argument('--price-sonnet', type=float, default=3.0)
    ap.add_argument('--price-haiku', type=float, default=1.0)
    ap.add_argument('--price-fable', type=float, default=5.0)
    ap.add_argument('--prod-since', default='2026-10-31T16:00', help='local time; coordinator production check')
    ap.add_argument('--min-spawns', type=int, default=1)
    a = ap.parse_args()
    price = {'opus': a.price_opus, 'sonnet': a.price_sonnet, 'haiku': a.price_haiku, 'fable': a.price_fable}
    mult = {'base': a.base, 'read': a.read, 'w5': a.write5m, 'w1': a.write1h}
    lo, hi = lib.window()
    if lo is None: lo = datetime.datetime.now().timestamp() - a.days * 86400
    prod_cut = datetime.datetime.strptime(a.prod_since, '%Y-%m-%dT%H:%M').timestamp()

    idx = load_index()
    cand = candidates(min(lo, prod_cut))
    recs = []; stale = []
    for j in cand:
        r = idx.get(j[0])
        if r is None or r.get('size') != os.path.getsize(j[0]) or (j[2] == 'sub' and not r.get('meta') and os.path.exists(j[0][:-6] + '.meta.json')):
            stale.append(j)
        else:
            recs.append(r)
    with Pool(a.workers) as pool:
        for r in pool.imap_unordered(extract.process, stale, chunksize=1):
            if r.get('t0') is not None: recs.append(r)
    sel = [r for r in recs if r.get('t0') is not None and r['t0'] >= min(lo, prod_cut) and (hi is None or r['t0'] < hi)]
    jobs = []; meta = {}
    for r in sel:
        fb = lib.rtier(r)
        fb = fb if fb in price else 'sonnet'
        jobs.append((r['path'], lib.role(r), fb, price, mult))
        meta[r['path']] = (lib.role(r), lib.model(r), r['t0'])
    print('transcripts in scope %d (index-stale reprocessed %d)' % (len(jobs), len(stale)), file=sys.stderr, flush=True)
    results = []
    with Pool(a.workers) as pool:
        for k, res in enumerate(pool.imap_unordered(worker, jobs, chunksize=4)):
            results.append(res)
    results = [r for r in results if r.get('n')]

    # ---- main table (window [lo,hi)) ----
    groups = collections.defaultdict(list)
    for r in results:
        role, mdl, t0 = meta[r['path']]
        if t0 < lo or (hi is not None and t0 >= hi): continue
        if mdl in ('none', '<synthetic>'): continue
        groups[(role, mdl)].append(r)
    rows = []
    tot = collections.defaultdict(float)
    for (role, mdl), rs in groups.items():
        n = len(rs)
        if n < a.min_spawns: continue
        turns = [x['n'] for x in rs]
        gn = sum(x['g_n'] for x in rs); g5 = sum(x['g_5m'] for x in rs); g1 = sum(x['g_1h'] for x in rs)
        c5 = sum(x['c5'] for x in rs); c1 = sum(x['c1'] for x in rs)
        d = c5 - c1; dp = 100 * d / c5 if c5 else 0.0
        wins = sum(1 for x in rs if x['c1'] < x['c5'] * 0.9999)
        resc = sum(x['rescued'] for x in rs); save = sum(x['save'] for x in rs); prem = sum(x['prem'] for x in rs)
        spg = (save / resc) if resc else 0.0
        be = (prem / spg / n) if spg else float('inf')
        obs = {k: sum(x['obs'][k] for x in rs) for k in ('in', 'cr', 'cc5', 'cc1', 'ccu')}
        rows.append(dict(role=role, model=mdl, n=n, turns=sum(turns), med=statistics.median(turns), p90=lib.pct(turns, 90),
                         gn=gn, p5=100 * g5 / gn if gn else 0, p1=100 * g1 / gn if gn else 0, obs=obs,
                         c5=c5, c1=c1, d=d, dp=dp, v=verdict(dp), win=100 * wins / n, resc_pp=resc / n, be_pp=be,
                         save=save, prem=prem))
        for k, v in (('c5', c5), ('c1', c1), ('n', n), ('turns', sum(turns)), ('gn', gn), ('g5', g5), ('g1', g1)): tot[k] += v
    rows.sort(key=lambda r: -r['c5'])

    L = []
    W = L.append
    nowl = datetime.datetime.now().strftime('%Y-%m-%d %H:%M local')
    W('# Prompt-cache TTL break-even per role (5 min vs 1 h)\n')
    W('Generated %s by `scripts/gsd-metrics/cache_ttl.py`. Window: %s .. %s UTC (spawns whose first timestamp falls inside). Transcripts in scope: %d (%d re-parsed because stale in index).\n'
      % (nowl, datetime.datetime.utcfromtimestamp(lo).strftime('%Y-%m-%d %H:%M'), (datetime.datetime.utcfromtimestamp(hi).strftime('%Y-%m-%d %H:%M') if hi else 'now'), len(jobs), len(stale)))
    W('Flags: multipliers base %.2f read %.2f write-5m %.2f write-1h %.2f; base input $/MTok opus %.2f sonnet %.2f haiku %.2f fable %.2f. Costs are input-side only (output identical in both cases), in $ at those prices.\n'
      % (mult['base'], mult['read'], mult['w5'], mult['w1'], price['opus'], price['sonnet'], price['haiku'], price['fable']))
    W('## Per role and model\n')
    W('| role | model | spawns | turns | med/p90 turns | gaps | >5m % | >1h % | obs read M | obs w5m M | obs w1h M | sim 5m $ | sim 1h $ | delta $ | delta % | verdict | spawns 1h wins % | rescued gaps/spawn vs break-even |')
    W('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|')
    for r in rows:
        be = ('%.1f' % r['be_pp']) if r['be_pp'] != float('inf') else 'inf'
        W('| %s | %s | %d | %d | %g/%g | %d | %.1f | %.1f | %s | %s | %s | %.0f | %.0f | %.0f | %.1f | %s | %.0f | %.1f vs %s |' % (
            r['role'], r['model'], r['n'], r['turns'], r['med'], r['p90'], r['gn'], r['p5'], r['p1'],
            fmt_m(r['obs']['cr']), fmt_m(r['obs']['cc5'] + r['obs']['ccu']), fmt_m(r['obs']['cc1']),
            r['c5'], r['c1'], r['d'], r['dp'], r['v'], r['win'], r['resc_pp'], be))
    tdp = 100 * (tot['c5'] - tot['c1']) / tot['c5'] if tot['c5'] else 0
    W('| **TOTAL** | | %d | %d | | %d | %.1f | %.1f | | | | %.0f | %.0f | %.0f | %.1f | %s | | |' % (
        tot['n'], tot['turns'], tot['gn'], 100 * tot['g5'] / max(1, tot['gn']), 100 * tot['g1'] / max(1, tot['gn']),
        tot['c5'], tot['c1'], tot['c5'] - tot['c1'], tdp, verdict(tdp)))
    W('\n">5m %" counts every gap above 5 min (so it includes the >1h gaps). "inf" break-even = the role has no gaps in (5m, 1h] to rescue, so 1h can only add premium. "obs w5m" includes cache writes from logs without the ephemeral split (older transcripts; assumed 5m). "rescued gaps" = gaps in (5m, 1h]: a 5m TTL rewrites the prefix, a 1h TTL reads it. Break-even = 1h write premium per spawn divided by the mean saving per rescued gap; 1h pays when rescued > break-even. delta = sim 5m - sim 1h (positive = 1h cheaper).\n')

    # ---- sanity ----
    W('## Sanity check: simulated 5m vs logged cost\n')
    def sanity(sel_fn, label, key):
        rs = [r for r in results if sel_fn(r)]
        if not rs: W('- %s: no transcripts.' % label); return None
        s = sum(r[key] for r in rs); ac = sum(r['act'] for r in rs)
        per = [abs(r[key] - r['act']) / r['act'] for r in rs if r['act'] > 0]
        err = 100 * (s - ac) / ac
        W('- %s: %d transcripts, simulated $%.0f vs logged $%.0f, error %+.1f%% (median abs per-transcript error %.1f%%).' % (label, len(rs), s, ac, err, 100 * statistics.median(per)))
        return err
    only5 = lambda r: r['obs']['cc1'] == 0 and r['obs']['ccu'] == 0 and r['obs']['cc5'] > 0
    only5u = lambda r: r['obs']['cc1'] == 0 and (r['obs']['cc5'] + r['obs']['ccu']) > 0
    only1 = lambda r: r['obs']['cc5'] == 0 and r['obs']['ccu'] == 0 and r['obs']['cc1'] > 0
    e1 = sanity(only5, '5m-only logged (split present), sim 5m, spec method (first call = full write)', 'c5')
    e1b = sanity(only5, '5m-only logged, diagnostic: first call keeps its observed cache read', 'c5_of')
    sanity(only5u, '5m-only incl. unsplit older logs, sim 5m, spec method', 'c5')
    sanity(lambda r: only5(r) and r['g_5m'] > 0, '5m-only logged, only transcripts with at least one gap > 5 min (where the TTL logic actually bites), spec method', 'c5')
    sanity(lambda r: only5(r) and meta[r['path']][0] == COORD, '5m-only logged, gsd-phase-coordinator only, spec method', 'c5')
    sanity(only1, '1h-only logged, sim 1h (checks the 1h branch)', 'c1')
    ok = e1 is not None and abs(e1) <= 15
    W('\nVerdict on the simulation: %s' % ('within the 15%% bar (%+.1f%%).' % e1 if ok else
      ('UNRELIABLE (%s over 15%%). Likely causes: first calls that hit a cache written by a sibling spawn or earlier session (the simulation assumes a cold first call), cache entries shared across spawns with an identical prefix, TTL refresh by background/parallel calls not in this transcript, and context rewrites the log reports as cache_creation that are not gap-driven.' % ('%+.1f%%' % e1 if e1 is not None else 'n/a'))))
    W('')

    # ---- production check ----
    W('## Production check: gsd-phase-coordinator since %s local\n' % a.prod_since.replace('T', ' '))
    cs = sorted([r for r in results if meta[r['path']][0] == COORD and meta[r['path']][2] >= prod_cut], key=lambda r: meta[r['path']][2])
    only1_n = sum(1 for r in cs if r['obs']['cc1'] > 0 and r['obs']['cc5'] == 0 and r['obs']['ccu'] == 0)
    mix_n = sum(1 for r in cs if r['obs']['cc1'] > 0 and (r['obs']['cc5'] > 0 or r['obs']['ccu'] > 0))
    five_n = sum(1 for r in cs if r['obs']['cc1'] == 0)
    W('Spawns: %d. 1h-only writes: %d. Mixed 5m+1h: %d. 5m-only (no 1h): %d.\n' % (len(cs), only1_n, mix_n, five_n))
    if cs:
        W('| start (local) | model | turns | gaps >5m | gaps >1h | write 5m M | write 1h M | read M | class |')
        W('|---|---|---:|---:|---:|---:|---:|---:|---|')
        for r in cs:
            o = r['obs']; w5 = o['cc5'] + o['ccu']
            cl = '1h-only' if (o['cc1'] > 0 and w5 == 0) else ('mixed' if o['cc1'] > 0 else '5m-only')
            W('| %s | %s | %d | %d | %d | %s | %s | %s | %s |' % (datetime.datetime.fromtimestamp(meta[r['path']][2]).strftime('%m-%d %H:%M'), meta[r['path']][1], r['n'], r['g_5m'], r['g_1h'], fmt_m(w5), fmt_m(o['cc1']), fmt_m(o['cr']), cl))
        W('\nFrontmatter change per HYPOTHESIS.md applies to coordinators spawned after ~2026-10-31 19:40 local; earlier rows are expected to be 5m.\n')

    # ---- main thread ----
    W('## Main-thread sessions: already 1h?\n')
    ms = [r for r in results if meta[r['path']][0] == 'MAIN-session' and meta[r['path']][2] >= lo]
    c5 = sum(r['obs']['cc5'] + r['obs']['ccu'] for r in ms); c1 = sum(r['obs']['cc1'] for r in ms)
    n1 = sum(1 for r in ms if r['obs']['cc1'] > 0 and r['obs']['cc5'] + r['obs']['ccu'] == 0)
    nm = sum(1 for r in ms if r['obs']['cc1'] > 0 and r['obs']['cc5'] + r['obs']['ccu'] > 0)
    n5 = sum(1 for r in ms if r['obs']['cc1'] == 0)
    W('Main sessions in window: %d; 1h-only %d, mixed %d, 5m-only %d. 1h share of cache-write tokens: %.1f%% (%s M of %s M).\n' % (len(ms), n1, nm, n5, 100 * c1 / max(1, c1 + c5), fmt_m(c1), fmt_m(c1 + c5)))
    bd = collections.defaultdict(lambda: [0, 0, 0]); bc = collections.defaultdict(lambda: [0, 0])
    for r in results:
        role = meta[r['path']][0]
        for dk, (x5, x1) in r['byday'].items():
            if role == 'MAIN-session': bd[dk][0] += x5; bd[dk][1] += x1
            elif role == COORD: bc[dk][0] += x5; bc[dk][1] += x1
    days = sorted(set(bd) | set(bc))[-14:]
    W('Per call-day, 1h share of split-logged cache writes (local date):\n')
    W('| day | main w5m M | main w1h M | main 1h % | coord w5m M | coord w1h M | coord 1h % |')
    W('|---|---:|---:|---:|---:|---:|---:|')
    for dk in days:
        m5, m1 = bd[dk][0], bd[dk][1]; k5, k1 = bc[dk][0], bc[dk][1]
        W('| %s | %s | %s | %s | %s | %s | %s |' % (dk, fmt_m(m5), fmt_m(m1), ('%.0f' % (100 * m1 / (m1 + m5))) if m1 + m5 else '-', fmt_m(k5), fmt_m(k1), ('%.0f' % (100 * k1 / (k1 + k5))) if k1 + k5 else '-'))
    W('')

    # ---- method / caveats ----
    W('## Method\n')
    W('- Roles and models come from lib.py (`role()`: agentType from meta.json, MAIN-session for top-level, charlotte-runner-session for the charlotte project; `model()`: dominant model by output tokens). Per-call usage is read from the raw transcripts (one call per assistant message id; `<synthetic>` and API-error messages dropped).')
    W('- Gap = timestamp of an assistant message to the timestamp of the next assistant message in the same transcript (first line of each message). Bucket decides expiry: gap <= TTL is a hit (TTL restarts on every call).')
    W('- Context per call = input + cache_read + cache_creation. Simulation per transcript and TTL: first call writes the whole context; later call within TTL reads min(prev context, context) and writes the remainder; beyond TTL rewrites the whole context, all at that TTL\'s write rate. Priced per call by its own model tier. Output tokens ignored.')
    W('- Identity used for break-even: sim5 - sim1 = saving on rescued gaps (read vs 5m rewrite) - 1h write premium on every token written under 1h.')
    W('')
    W('## Caveats and unmeasured\n')
    W('- Prices and multipliers are the CLI defaults, not verified against current docs. Output tokens excluded.')
    W('- Subscription limits: how cache-write and cache-read tokens count against 5-hour/weekly usage limits is unmeasured; this is a token-priced cost model only.')
    W('- Polling changes unmeasured: if coordinators stop polling (long sleeps/waits), gap distributions change and so does the verdict; this uses the polling behaviour as logged.')
    W('- Cross-transcript cache sharing (identical system/tool prefixes between spawns) is not modelled; every spawn starts cold in the simulation. A 1h TTL would raise cross-spawn hit rates, which this undercounts.')
    W('- Gaps include model generation and tool time (start-to-start), and parallel background subagents do not refresh a parent\'s cache. Main-thread sessions include idle periods while the user is away (> 1 h), which no TTL fixes.')
    W('- The index (`files.jsonl`) can lag; stale or missing transcripts are re-parsed in memory with extract.process, nothing is written to the index.')
    W('')
    text = '\n'.join(L)
    print(text)
    if not a.no_write:
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        with open(a.out, 'w') as f: f.write(text + '\n')
        print('wrote', a.out, file=sys.stderr)


if __name__ == '__main__':
    main()

"""Rebuild runs.jsonl metrics from the saved raw streams (after a measurement fix); grades are re-derived from the same final text."""
import json
import q3_grade as G
import q3_run as R
import q3_spec as S

rows = [json.loads(l) for l in (S.Q3_HOME / "runs.jsonl").read_text().splitlines() if l.strip()]
out = []
for r in rows:
    d = S.Q3_HOME / "runs" / r["run_id"]
    sm = R.summarise_stream((d / "stream.jsonl").read_text())
    r.update({k: v for k, v in sm.items() if k not in ("final_text", "init_tool_names")})
    r["grade"] = G.grade(r["kind"], sm["final_text"])
    out.append(r)
(S.Q3_HOME / "runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out))
print(len(out))

#!/usr/bin/env bash
# Usage: sarif-summary.sh <file.sarif> <tool label>
# Prints a Markdown severity table for the GitHub job summary. Never fails the job.
set -uo pipefail
f="$1"; label="$2"
if [ ! -s "$f" ]; then
  echo "### $label"; echo; echo "_No SARIF produced (scan skipped or failed; see logs)._"; echo; exit 0
fi
python3 - "$f" "$label" <<'PY'
import json, sys, collections
path, label = sys.argv[1], sys.argv[2]
try:
    doc = json.load(open(path))
except Exception as e:
    print(f"### {label}\n\n_Could not parse SARIF: {e}_\n"); sys.exit(0)
counts = collections.Counter(); top = collections.Counter()
for run in doc.get("runs", []):
    rules = {}
    for r in (run.get("tool", {}).get("driver", {}).get("rules") or []):
        rules[r.get("id")] = r
    for res in run.get("results", []) or []:
        rid = res.get("ruleId", "?")
        sev = None
        props = (rules.get(rid) or {}).get("properties", {}) or {}
        ssev = props.get("security-severity")
        if ssev is not None:
            try:
                v = float(ssev)
                sev = "critical" if v >= 9 else "high" if v >= 7 else "medium" if v >= 4 else "low"
            except ValueError:
                pass
        sev = sev or {"error": "high", "warning": "medium", "note": "low"}.get(res.get("level", "warning"), "medium")
        counts[sev] += 1; top[rid] += 1
total = sum(counts.values())
print(f"### {label}: {total} finding(s)\n")
print("| Critical | High | Medium | Low |\n|---|---|---|---|")
print(f"| {counts['critical']} | {counts['high']} | {counts['medium']} | {counts['low']} |\n")
if top:
    print("<details><summary>Top rules</summary>\n")
    for rid, n in top.most_common(10):
        print(f"- `{rid}`: {n}")
    print("\n</details>\n")
PY

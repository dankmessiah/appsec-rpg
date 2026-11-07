#!/usr/bin/env bash
# Posts every scanner result in <dir> to the n8n appsec-ingest webhook, one request per file.
# Usage: forward-findings.sh <dir>
# Env: N8N_INGEST_URL, N8N_INGEST_TOKEN (sent as X-AppSec-Token), optional N8N_CA_FILE,
#      REPO, REF, SHA, RUN_URL (source metadata)
set -euo pipefail
dir="$1"
: "${N8N_INGEST_URL:?}" "${N8N_INGEST_TOKEN:?}"
ca=(); [ -n "${N8N_CA_FILE:-}" ] && ca=(--cacert "$N8N_CA_FILE")
src=$(jq -n --arg repo "${REPO:-}" --arg ref "${REF:-}" --arg sha "${SHA:-}" --arg run "${RUN_URL:-}" \
  '{repo:$repo, ref:$ref, sha:$sha, runUrl:$run}')
sent=0
post() { # post <payload-file>
  curl -fsS "${ca[@]}" -X POST -A appsec-lab-scanner \
    -H 'Content-Type: application/json' -H "X-AppSec-Token: $N8N_INGEST_TOKEN" \
    --data-binary @"$1" "$N8N_INGEST_URL" >/dev/null
  sent=$((sent + 1))
}
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
while IFS= read -r -d '' f; do
  case "$f" in
    *.sarif)
      jq --argjson s "$src" '{source: $s, sarif: .}' "$f" > "$tmp" ;;
    *zap*.json)
      jq --argjson s "$src" '{source: ($s + {tool:"zap"}), zap: .}' "$f" > "$tmp" ;;
    *bola-findings.json)
      jq --argjson s "$src" '{source: ($s + {tool:"bola-check"}), findings: .}' "$f" > "$tmp" ;;
    *) continue ;;
  esac
  echo "forwarding ${f#"$dir"/}"
  post "$tmp"
done < <(find "$dir" -type f \( -name '*.sarif' -o -name '*zap*.json' -o -name 'bola-findings.json' \) -print0)
echo "forwarded $sent file(s) to n8n"

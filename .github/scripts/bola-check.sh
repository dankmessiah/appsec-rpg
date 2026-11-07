#!/usr/bin/env bash
# Broken object-level authorization check (OWASP API1) for appsec-rpg.
# Alice starts a battle; Bob tries to act on it. Anything other than 403/404 is a finding.
# Usage: bola-check.sh <base-url>   (env: SEED_ALICE_PASSWORD, SEED_BOB_PASSWORD)
# Output: bola-findings.json (array, same shape the n8n ingest workflow expects). Exit 0 always (warn-only);
# the job reads the count from the file.
set -euo pipefail
base="$1"; here="$(cd "$(dirname "$0")" && pwd)"
out="${OUT:-bola-findings.json}"; echo '[]' > "$out"
UA=appsec-lab-scanner

eval "$("$here/zap-login.sh" "$base" alice "$SEED_ALICE_PASSWORD")"; A_SID=$SID; A_CSRF=$CSRF
eval "$("$here/zap-login.sh" "$base" bob "$SEED_BOB_PASSWORD")";   B_SID=$SID; B_CSRF=$CSRF

req() { # req <sid> <csrf> <method> <path> [json]  -> prints "<status> <body>"
  curl -sS -A "$UA" -o /tmp/bola.body -w '%{http_code}' -X "$3" \
    -H "Cookie: sid=$1" -H "X-CSRF-Token: $2" -H 'Content-Type: application/json' \
    ${5:+--data "$5"} "$base$4"
}

code=$(req "$A_SID" "$A_CSRF" POST /api/v1/battles '{"mode":"campaign"}')
battle=$(jq -r '.id // .battleId // .battle.id // empty' /tmp/bola.body)
qid=$(jq -r '.question.id // .questionId // empty' /tmp/bola.body)
[ "$code" = 200 ] || [ "$code" = 201 ] || { echo "alice could not start a battle: HTTP $code" >&2; exit 1; }
[ -n "$battle" ] || { echo "no battle id in response" >&2; exit 1; }
echo "alice battle: $battle"

add() { # add <rule> <url> <method> <status>
  jq --arg r "$1" --arg u "$base$2" --arg m "$3" --arg s "$4" \
    '. += [{tool:"bola-check", rule:$r, severity:"high", url:$u, method:$m, param:"id",
            message:("bob (non-owner) got HTTP " + $s + " acting on alice'"'"'s battle"), status:($s|tonumber)}]' \
    "$out" > "$out.tmp" && mv "$out.tmp" "$out"
}

for probe in "answer|{\"questionId\":\"$qid\",\"choice\":0}" "forfeit|{}"; do
  action=${probe%%|*}; payload=${probe#*|}
  path="/api/v1/battles/$battle/$action"
  code=$(req "$B_SID" "$B_CSRF" POST "$path" "$payload")
  echo "bob POST $path -> $code"
  case "$code" in 403|404) ;; *) add "bola-battle-$action" "$path" POST "$code" ;; esac
done

# Clean up: alice forfeits her own battle so staging stays tidy.
req "$A_SID" "$A_CSRF" POST "/api/v1/battles/$battle/forfeit" '{}' >/dev/null || true
n=$(jq length "$out"); echo "BOLA findings: $n"

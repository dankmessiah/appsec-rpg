#!/usr/bin/env bash
# Logs in to appsec-rpg and prints shell exports SID=... and CSRF=... for the given user.
# Usage: eval "$(zap-login.sh <base-url> <username> <password>)"
# Reads Set-Cookie from headers rather than a cookie jar: curl drops Secure cookies set over plain HTTP,
# and LAN staging is HTTP.
set -euo pipefail
base="$1"; user="$2"; pass="$3"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
code=$(curl -sS -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' -A appsec-lab-scanner \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg u "$user" --arg p "$pass" '{username:$u,password:$p}')" \
  "$base/api/v1/auth/login")
[ "$code" = 200 ] || { echo "login as $user failed: HTTP $code" >&2; exit 1; }
sid=$(grep -i '^set-cookie: *sid=' "$tmp/headers" | head -1 | sed -E 's/^[^=]*: *sid=([^;[:space:]]*).*/\1/I')
csrf=$(jq -r '.csrfToken // .csrf_token // .csrf // empty' "$tmp/body")
[ -n "$sid" ] || { echo "no sid cookie for $user" >&2; exit 1; }
[ -n "$csrf" ] || { echo "no CSRF token in login response for $user" >&2; exit 1; }
printf 'export SID=%q CSRF=%q\n' "$sid" "$csrf"

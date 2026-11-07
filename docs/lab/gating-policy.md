# Gating policy: what blocks a merge in `appsec-rpg`

Status: **Draft.** Week 1 runs warn-only. This policy turns on in Week 3, once the app exists and a week of findings has been triaged.

## Principle

Block only on findings that are **new in this PR**, **Critical or High**, and from a **rule with measured precision ≥ 90 %** (or a secret). Everything else becomes a ticket, not a red build. A gate that cries wolf gets bypassed, and a bypassed gate is worse than none.

## What blocks

| Source | Blocks when | Why it's high-confidence |
|---|---|---|
| Gitleaks | Any new secret in the PR's commits (not the full history) | Real secrets are always urgent; FPs are cheap to allowlist |
| Semgrep `db-query-string-concat` (custom) | New finding | Precise pattern; no FPs in fixtures or the app |
| Semgrep `express-sequelize-injection`, `code-string-concat`, `express-open-redirect` | New finding, ERROR severity | 100 % TP in the Juice Shop triage (`triage-log.md`) |
| CodeQL `js/sql-injection`, `js/code-injection`, `js/path-injection` (security-severity ≥ 7) | New alert | Data-flow based; CodeQL's precision on these is high |
| Trivy fs / image | New **Critical** CVE with a fixed version available (`--ignore-unfixed`) and a KEV listing or EPSS ≥ 0.1 | Exploitable *and* actionable; avoids blocking on CVEs nobody can fix |
| `npm test` | Any failure | It's a test |

## What never blocks (ticket only)

- Semgrep MEDIUM-confidence rules, including the custom `battle-route-missing-owner-check` (heuristic, can't see helper functions).
- `express-res-sendfile`, `express-check-directory-listing` (5 of 9 TP in triage; needs a human).
- `run-shell-injection` where the only interpolated value is `github.ref_name` on a branch-restricted `push` trigger (5 of 5 FP in triage).
- Trivy config (IaC) findings: reviewed in the weekly triage.
- ZAP baseline and nightly DAST: tickets via n8n. DAST runs against a moving target and is noisier.
- Anything pre-existing on `main`. Fixed through the SLA process, not by blocking unrelated PRs.

## How "new" is computed

| Tool | Mechanism |
|---|---|
| Semgrep | `semgrep scan --baseline-commit "$BASE_SHA"` reports only findings introduced since the merge base |
| Gitleaks | `gitleaks git --log-opts="$BASE_SHA..$HEAD_SHA"` scans only the PR's commits |
| CodeQL / Trivy | Repository ruleset → *Require code scanning results* (CodeQL: High or higher), which GitHub evaluates against alerts new in the PR. Trivy is gated by the `gate` job on the filtered SARIF. |

## Implementation (Week 3)

1. Add a `gate` job to `security.yml` with `needs: [semgrep, gitleaks, trivy, container, codeql]`. It downloads the SARIF artifacts, applies the allowlist above (rule ids in `.github/gate-rules.txt`), and fails with a table of blocking findings.
2. Add `gate` and `test` as required status checks in the `main` ruleset.
3. Remove `continue-on-error` only from the steps whose output the gate needs; the scanners themselves stay non-failing.
4. Seed a blocking finding on `demo/gate-sqli` (string-concatenated `db.query`) to prove the gate fires; screenshot `3-4-gate-blocked.png`.

## Exceptions

- **False positive:** `// nosemgrep: <rule-id> -- <reason> (APPSEC-123)` inline, or a `.gitleaks.toml` allowlist entry. Both require AppSec review via CODEOWNERS on `semgrep/`, `.gitleaks.toml`.
- **Accepted risk:** an AppSec-approved Jira exception with an expiry (see `raci.md` for who can approve). The PR can then merge with an admin bypass of the ruleset, which is logged.
- **Emergency:** repo admins can bypass the ruleset. Every bypass is reviewed in the weekly triage.

## Review

Re-measure precision monthly from the triage log and Jira resolutions (*Not a vulnerability* = FP). A rule whose precision drops below 90 % over 20+ findings moves back to ticket-only.

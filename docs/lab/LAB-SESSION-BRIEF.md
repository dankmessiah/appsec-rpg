# AppSec Lab Session Brief

Build the interview-prep lab described below against this repo (`dankmessiah/appsec-rpg`) and a second target, OWASP Juice Shop. This repo is a single-file vanilla JS game (`appsec-rpg.html`, `tests.html`) under active development; its design spec is at `docs/superpowers/specs/2026-11-07-appsec-rpg-design.md`. Treat the game as a real product being onboarded to an AppSec program: scanning must run on every PR without slowing the game's development.

## Why two targets

| Target | Gives you |
|---|---|
| `appsec-rpg` (this repo) | SAST, secrets, CodeQL, SHA-pinned actions, PR-level gating on a repo you own and iterate on |
| OWASP Juice Shop (fork) | SCA with real CVEs, authenticated DAST, API scanning, meaningful false-positive triage |

The game has no server, no dependencies and no login, so DAST and SCA against it alone would be thin.

## Deliverables

### Week 1: scanning pipeline
1. In `appsec-rpg`, add `.github/workflows/security.yml` running on `pull_request` and `push` to `main`:
   - Semgrep (`p/owasp-top-ten`, `p/javascript`), SARIF uploaded to the Security tab
   - Gitleaks for secrets
   - CodeQL (JavaScript) for comparison with Semgrep
   - Every action pinned to a full commit SHA, `permissions:` set least-privilege at the workflow level
   - Warn-only to start (never fail the build in week 1)
2. Fork Juice Shop. Add the same SAST/secrets jobs plus Trivy or OSV-Scanner for SCA, and run Juice Shop as a service container with a ZAP baseline scan on PRs and a scheduled ZAP full scan nightly.
3. Enable GitHub push protection and Dependabot on both repos.

### Week 2: SOC handoff
1. Send scanner output (SARIF or JSON) via webhook into Tines (community edition).
2. Enrich each finding: mock owner (from a CODEOWNERS file), app tier, exposure.
3. Dedupe on rule + file + line (SAST) or rule + URL + param (DAST).
4. Route: every finding to a Jira ticket (free tier) with an SLA date by severity; critical findings also to a SIEM event (Wazuh on the homelab, or a Splunk dev license) and a Slack message.
5. Write `docs/lab/runbook-exposed-secret.md` and `docs/lab/raci.md`.
6. Capture screenshots of each stage into `docs/lab/screenshots/`.

### Week 3: tune and measure
1. Hand-triage 30 Semgrep findings from Juice Shop; record precision in `docs/lab/triage-log.md`.
2. Write two custom Semgrep rules relevant to this game (e.g. `innerHTML` assignment from a variable; `localStorage` read without try/catch) and add them to the pipeline.
3. Get authenticated ZAP scanning working against Juice Shop's login (Automation Framework YAML).
4. Move `appsec-rpg` from warn-only to blocking on new Critical/High from high-confidence rules only; document the policy in `docs/lab/gating-policy.md`.
5. Draft the 30/60/90 plan and tool evaluation matrix in `docs/lab/`.

## Constraints
- Never commit real credentials. Use GitHub Actions secrets and Tines credentials.
- Pipeline on `appsec-rpg` must finish in under 5 minutes on PR.
- Do not modify `appsec-rpg.html` or `tests.html` in the lab session except to seed a deliberate, clearly marked test vulnerability on a branch for demonstrating detection; never merge that branch.
- Keep all lab docs under `docs/lab/`.

## Done when
- A PR to `appsec-rpg` shows Semgrep, Gitleaks and CodeQL results in the Security tab within 5 minutes.
- A seeded secret on a branch is blocked by push protection and, if forced through a PR, lands as a Jira ticket plus a SIEM event via Tines.
- A Juice Shop ZAP scan produces findings that reach Jira with owner and SLA.
- The runbook, RACI, triage log, gating policy and 30/60/90 plan exist and are committed.

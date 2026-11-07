# AppSec Lab Session Brief

Build the interview-prep lab described below against this repo (`dankmessiah/appsec-rpg`) and a second target, OWASP Juice Shop. This repo is a Node/Express + PostgreSQL game with accounts, a REST API (`openapi.yaml`), an admin role, and Docker Compose deployment on the homelab; its design spec is at `docs/superpowers/specs/2026-11-07-appsec-rpg-design.md`. Treat the game as a real product being onboarded to an AppSec program: scanning must run on every PR without slowing the game's development.

## Why two targets

| Target | Gives you |
|---|---|
| `appsec-rpg` (this repo) | SAST, secrets, CodeQL, SCA on npm, container and IaC scanning, authenticated DAST and API scanning against the homelab staging instance, BOLA testing with the seeded `alice`/`bob` accounts, PR-level gating on a repo you own and iterate on |
| OWASP Juice Shop (fork) | A large, known-vulnerable baseline for false-positive triage and for comparing scanner precision |

Juice Shop is the calibration target; `appsec-rpg` is the production-like one.

## Deliverables

### Week 1: scanning pipeline
1. In `appsec-rpg`, add `.github/workflows/security.yml` running on `pull_request` and `push` to `main`:
   - Semgrep (`p/owasp-top-ten`, `p/javascript`, `p/nodejs`, `p/docker`), SARIF uploaded to the Security tab
   - Gitleaks for secrets
   - CodeQL (JavaScript) for comparison with Semgrep
   - Trivy: filesystem scan for npm CVEs, image scan of the built Docker image, config scan of `Dockerfile` and `docker-compose.yml`
   - CycloneDX SBOM generated and uploaded as an artifact
   - `npm test` as a required check
   - Every action pinned to a full commit SHA, `permissions:` set least-privilege at the workflow level
   - Warn-only to start (never fail the build in week 1)
2. DAST against `appsec-rpg`: ZAP baseline on every PR against a service container built from the PR (app + postgres, seeded); scheduled nightly ZAP full scan and API scan (from `openapi.yaml`) against the homelab staging instance, authenticated as `alice`, with a second pass as `bob` to check per-user resources.
3. Fork Juice Shop with the same SAST/secrets/SCA jobs and a ZAP baseline scan, as the calibration target.
4. Enable GitHub push protection and Dependabot on both repos.

### Week 2: SOC handoff
1. Send scanner output (SARIF or JSON) via webhook into Tines (community edition).
2. Enrich each finding: mock owner (from a CODEOWNERS file), app tier, exposure.
3. Dedupe on rule + file + line (SAST) or rule + URL + param (DAST).
4. Route: every finding to a Jira ticket (free tier) with an SLA date by severity; critical findings also to a SIEM event (Wazuh on the homelab, or a Splunk dev license) and a Slack message.
5. Write `docs/lab/runbook-exposed-secret.md` and `docs/lab/raci.md`.
6. Capture screenshots of each stage into `docs/lab/screenshots/`.

### Week 3: tune and measure
1. Hand-triage 30 Semgrep findings from Juice Shop; record precision in `docs/lab/triage-log.md`.
2. Write two custom Semgrep rules relevant to this game (e.g. a route handler on `/battles/:id` that doesn't compare `user_id` to the session; a `db.query` call built with string concatenation) and add them to the pipeline.
3. Harden the authenticated ZAP scan against `appsec-rpg` (Automation Framework YAML, session cookie handling, CSRF token header) and confirm the Alice/Bob pass flags a deliberately seeded IDOR on a test branch.
4. Move `appsec-rpg` from warn-only to blocking on new Critical/High from high-confidence rules only; document the policy in `docs/lab/gating-policy.md`.
5. Draft the 30/60/90 plan and tool evaluation matrix in `docs/lab/`.

## Constraints
- Never commit real credentials. Use GitHub Actions secrets and Tines credentials.
- Pipeline on `appsec-rpg` must finish in under 5 minutes on PR.
- Do not modify application code under `server/`, `shared/` or `public/` in the lab session except to seed a deliberate, clearly marked test vulnerability on a branch for demonstrating detection; never merge that branch.
- The homelab staging instance is LAN-only. Scheduled scans against it must run from a self-hosted runner on the homelab, never from GitHub-hosted runners.
- Keep all lab docs under `docs/lab/`.

## Done when
- A PR to `appsec-rpg` shows Semgrep, Gitleaks and CodeQL results in the Security tab within 5 minutes.
- A seeded secret on a branch is blocked by push protection and, if forced through a PR, lands as a Jira ticket plus a SIEM event via Tines.
- A Juice Shop ZAP scan produces findings that reach Jira with owner and SLA.
- The runbook, RACI, triage log, gating policy and 30/60/90 plan exist and are committed.

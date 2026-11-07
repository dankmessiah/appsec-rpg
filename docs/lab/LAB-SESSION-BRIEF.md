# AppSec Lab Session Brief

Build the interview-prep lab described below against this repo (`dankmessiah/appsec-rpg`) and a second target, OWASP Juice Shop. This repo is a Node/Express + PostgreSQL game with accounts, a REST API (`openapi.yaml`), an admin role, and Docker Compose deployment on the homelab; its design spec is at `docs/superpowers/specs/2026-11-07-appsec-rpg-design.md`. Treat the game as a real product being onboarded to an AppSec program: scanning must run on every PR without slowing the game's development.

## Context

- **Why this exists.** Nunzio is interviewing for an Application Security role whose first job is to select and stand up a SAST/DAST program, onboard dev teams, and hand operational alerts to Security Operations. He is a SecOps analyst (SOC, IR, CrowdStrike NG-SIEM, Splunk, Entra/Okta) and a top-1% Tines builder; he has not run an AppSec program before. This lab is his hands-on evidence for the interview. Every artifact should be something he can screenshot and walk an interviewer through in five minutes.
- **The interview story.** "I run AppSec like a detection pipeline: high-signal findings, automated routing to owners, a runbook-backed SOC handoff." The handoff (Week 2) is the differentiator; don't shortchange it. Build the n8n workflows so each stage (ingest, enrich, dedupe, route) is its own clearly named node group, because he will screenshot them.
- **The game is being built in a separate Claude session at the same time.** Its code lands in `server/`, `shared/`, `public/`, `db/`, `tests/`, plus `Dockerfile`, `docker-compose.yml` and `openapi.yaml`. Until it exists, build what you can (see Starting order) and design the rest against the spec.

## Environment facts

- **Homelab:** Proxmox host (reachable via the Proxmox MCP tools in Claude). Wazuh is the SIEM. Firewalla fronts the LAN. 1Password holds secrets; use it for anything local, GitHub Actions secrets for anything in CI.
- **Automation platform:** Nunzio's self-hosted n8n instance, connected as the `n8n-mcp` MCP server. All automation lives there: the finding → enrich → route → Jira/SIEM flow and any internal glue (runner health, nightly scan kick-off). Do not use Tines (its free tier is too limited). Build workflows through the n8n-mcp tools and follow the repo's `n8n-automation` skill if listed. In the interview Nunzio presents the n8n flows as the SOAR layer and explains how the same design maps to Tines, which he already knows well.
- **Ticketing:** Jira free tier. Create a project key `APPSEC`.
- **Chat alerts:** Discord (a personal server with an `#appsec-alerts` channel; use a webhook or the n8n Discord node).
- **Staging target:** the game's Docker Compose stack on a Proxmox LXC or VM, LAN-only, `http://<lan-ip>:3000`. Postgres is not published. Seeded users `alice`, `bob`, `admin` with passwords from `.env`.
- **Self-hosted GitHub runner:** install one on the homelab (its own LXC) for scans against staging. Label it `homelab`.

## Starting order (app code does not exist yet)

Do these first; none depend on application code:
1. Repo hygiene: `.gitignore`, `CODEOWNERS` (map `server/` and `shared/` to `@dankmessiah`, `docs/lab/` to the lab), branch protection on `main` requiring the security workflow and `npm test`.
2. Fork Juice Shop and get its full pipeline (SAST, secrets, SCA, ZAP baseline) green. This is where you learn the tooling and collect real findings.
3. Set up the self-hosted runner on Proxmox and verify a trivial workflow runs on it.
4. Confirm n8n is reachable through `n8n-mcp`; set up Jira and Discord. Build the Week 2 workflows in n8n against Juice Shop output.
5. Write the runbook and RACI.
6. Scaffold `security.yml` for `appsec-rpg` with every job present but path filters so jobs no-op cleanly until the directories exist.

Then, once the game session has merged a runnable app with `Dockerfile` and `docker-compose.yml`:
7. Turn on the full `appsec-rpg` pipeline, deploy staging on the homelab, and complete Weeks 1 and 3 against the game.

## Working rules

- Follow the repo's superpowers flow: brainstorm → written plan → implement. Write the plan to `docs/superpowers/plans/` before building the pipeline.
- Work on branches named `lab/<topic>`; open PRs to `main`; squash-merge. Never commit directly to `main`.
- Do not edit application code (`server/`, `shared/`, `public/`, `db/`, `tests/`), `Dockerfile`, `docker-compose.yml` or `openapi.yaml`. If the pipeline needs an app change (a test endpoint, a health check tweak), open an issue describing it for the game session instead.
- Deliberate vulnerabilities for detection demos go on branches named `demo/<vuln>` and are never merged.
- Commit messages: imperative, one line, body optional.
- Keep every lab doc under `docs/lab/`. Screenshots under `docs/lab/screenshots/` named `<week>-<step>-<what>.png`.
- When a tool has a free tier and a paid tier, use the free tier; stop and ask before anything that costs money.

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
1. Send scanner output (SARIF or JSON) via webhook into an n8n workflow (`appsec-ingest`).
2. Enrich each finding: mock owner (from a CODEOWNERS file), app tier, exposure.
3. Dedupe on rule + file + line (SAST) or rule + URL + param (DAST).
4. Route: every finding to a Jira ticket (free tier) with an SLA date by severity; critical findings also to a Wazuh event (homelab SIEM) and a Discord message. Export the finished n8n workflows as JSON into `docs/lab/n8n/`.
5. Write `docs/lab/runbook-exposed-secret.md` and `docs/lab/raci.md`.
6. Capture screenshots of each stage into `docs/lab/screenshots/`.

### Week 3: tune and measure
1. Hand-triage 30 Semgrep findings from Juice Shop; record precision in `docs/lab/triage-log.md`.
2. Write two custom Semgrep rules relevant to this game (e.g. a route handler on `/battles/:id` that doesn't compare `user_id` to the session; a `db.query` call built with string concatenation) and add them to the pipeline.
3. Harden the authenticated ZAP scan against `appsec-rpg` (Automation Framework YAML, session cookie handling, CSRF token header) and confirm the Alice/Bob pass flags a deliberately seeded IDOR on a test branch.
4. Move `appsec-rpg` from warn-only to blocking on new Critical/High from high-confidence rules only; document the policy in `docs/lab/gating-policy.md`.
5. Draft the 30/60/90 plan and tool evaluation matrix in `docs/lab/`.

## Constraints
- Never commit real credentials. Use GitHub Actions secrets, n8n credentials and 1Password. Scrub credentials from exported n8n workflow JSON before committing.
- Pipeline on `appsec-rpg` must finish in under 5 minutes on PR.
- The homelab staging instance is LAN-only. Scheduled scans against it must run from the `homelab` self-hosted runner, never from GitHub-hosted runners.
- Scanner traffic must be identifiable: dedicated User-Agent `appsec-lab-scanner` so the SIEM can suppress or tag it.

## Done when
- A PR to `appsec-rpg` shows Semgrep, Gitleaks and CodeQL results in the Security tab within 5 minutes.
- A seeded secret on a branch is blocked by push protection and, if forced through a PR, lands as a Jira ticket plus a Wazuh event via n8n.
- A Juice Shop ZAP scan produces findings that reach Jira with owner and SLA.
- The runbook, RACI, triage log, gating policy and 30/60/90 plan exist and are committed.

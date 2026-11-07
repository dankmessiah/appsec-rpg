# Plan: Lab Week 1 scanning pipeline (scaffold)

Date: 2026-11-07 · Source: `docs/lab/LAB-SESSION-BRIEF.md` (Starting order 1 and 6, Week 1 deliverables 1, 2, 4)

## Goal

Every PR to `appsec-rpg` runs SAST, secrets, CodeQL, SCA, IaC, container, SBOM, tests and a ZAP baseline in under 5 minutes, warn-only. Jobs that need application code no-op cleanly until the game session lands it, then switch on with no workflow edits.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Not-yet-existing app | A `detect` job checks for `package.json`, `package-lock.json`, JS files, `Dockerfile`, `docker-compose.yml`, `openapi.yaml`; dependent jobs use `if:` on its outputs. Skipped jobs satisfy required checks. | Brief: "path filters so jobs no-op cleanly until the directories exist". |
| Pinning | Every `uses:` pinned to a full commit SHA with the tag in a comment; scanner container images pinned by digest. Dependabot (`github-actions`, `docker`, `npm`) keeps pins fresh. | Supply-chain hygiene; trivy-action tags were force-pushed in the March 2026 compromise, so tags are not trusted. |
| Permissions | Workflow level `permissions: contents: read`; jobs add only what they need (`security-events: write` for SARIF, `actions: read` for CodeQL). | Least privilege. |
| Warn-only | Scanner steps use `continue-on-error: true` and never set a failing exit code. `npm test` fails normally (it is a test, not a scanner). | Brief: never fail the build in week 1. Gating arrives in Week 3 (`docs/lab/gating-policy.md`). |
| Private repo | SARIF upload to the Security tab runs only when repo variable `CODE_SCANNING_ENABLED` is `true`. SARIF is always kept as an artifact and summarised in the job summary. | Code scanning on private repos is a paid add-on; the brief says ask before spending. |
| Semgrep | Pinned `semgrep/semgrep` image via `docker run`, packs `p/owasp-top-ten p/javascript p/nodejs p/docker` plus local rules in `semgrep/rules/`, `--metrics=off`. | No token or account needed; Alpine image can't host JS actions as a job container. |
| Gitleaks | Pinned `zricethezav/gitleaks` image, full history, SARIF. | gitleaks-action needs a licence for org repos; the CLI is free everywhere. |
| Trivy | `trivy fs` (npm CVEs + secrets off), `trivy config` (Dockerfile, compose), `trivy image` on the PR-built image, `trivy fs --format cyclonedx` for the SBOM. | One tool covers SCA, IaC, container and SBOM, keeps the run short. |
| ZAP baseline (PR) | Build with `docker compose`, generate a throwaway `.env`, seed, run `zaproxy/action-baseline` with `.zap/rules.tsv`, UA `appsec-lab-scanner`, issue writing off. | Brief Week 1 item 2. |
| Nightly DAST | `dast-nightly.yml` on `[self-hosted, homelab]`, gated by repo variable `HOMELAB_RUNNER_READY`. ZAP Automation Framework plan (`.zap/nightly-plan.yaml`): OpenAPI import, spider, active scan, authenticated via `sid` cookie + `X-CSRF-Token` header obtained by a login step. Runs as alice, then bob, then `bola-check.sh` replays alice's battle as bob. | LAN-only staging must never be scanned from GitHub-hosted runners. Without the gate, scheduled jobs would queue for 24 h. |
| Branch | First chunk ships from the session branch; later chunks use `lab/<topic>`. | |

## Tasks

1. Repo hygiene: `.gitignore`, `.github/CODEOWNERS`, `.github/dependabot.yml`.
2. `.github/workflows/security.yml`: `detect`, `semgrep`, `gitleaks`, `codeql`, `trivy` (fs, config, SBOM), `container` (build + trivy image), `test`, `dast-baseline`.
3. `.zap/rules.tsv`, `.zap/nightly-plan.yaml`, `.github/scripts/bola-check.sh`, `.github/workflows/dast-nightly.yml`.
4. Juice Shop calibration workflow template: `docs/lab/juice-shop/security.yml`.
5. Manual steps for Nunzio: `docs/lab/SETUP-CHECKLIST.md`.
6. Verify: `actionlint` clean, Semgrep packs resolve, shell scripts pass `bash -n`; push and confirm the run is green and under 5 minutes.

## Done when

The PR's own run finishes green in under 5 minutes, with app-dependent jobs skipped, and every SARIF file present as an artifact.

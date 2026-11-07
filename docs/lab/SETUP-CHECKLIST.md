# Lab setup: steps that need Nunzio's hands

Everything here needs an account, a setting, or the homelab. Each item says where to click and how to verify it. Tick them off in the PR or here.

## 1. GitHub settings on `appsec-rpg` (5 min)

- [x] Repo is public (done 2026-11-07). Code scanning, secret scanning and push protection are free on public repos.
- [ ] **Push protection + secret scanning**: Settings → Code security → Secret Protection → enable *Secret scanning* and *Push protection*.
- [ ] **Dependabot**: Settings → Code security → enable *Dependency graph*, *Dependabot alerts*, *Dependabot security updates*. Version updates are already configured in `.github/dependabot.yml`.
- [ ] **Code scanning**: nothing to enable. The workflow uploads SARIF automatically on a public repo. Leave *CodeQL default setup* **off** (our workflow runs CodeQL itself; both at once conflict).
- [ ] **Branch protection on `main`** (after the first `security` run, so the check names exist): Settings → Rules → Rulesets → New branch ruleset → target `main`:
  - Require a pull request before merging; allowed merge method: squash.
  - Require status checks: `test`, `semgrep`, `gitleaks`, `trivy`, `codeql`. (Skipped jobs count as passing, so `test` and `codeql` are safe to require before the app exists.)
  - Block force pushes.
- Verify: Security tab shows *Code scanning* with tools Semgrep, Gitleaks, Trivy after the first push to `main`.

## 2. Juice Shop fork (15 min)

- [ ] Fork https://github.com/juice-shop/juice-shop to `dankmessiah/juice-shop` (the cloud session can't create repos outside `appsec-rpg`).
- [ ] In the fork: Actions → disable the upstream workflows you don't need (they are long and use upstream secrets); keep the fork's Actions enabled.
- [ ] Copy `docs/lab/juice-shop/appsec-lab.yml` to `.github/workflows/appsec-lab.yml` and `.github/scripts/sarif-summary.sh` to the same path in the fork. Commit on a branch, open a PR to the fork's default branch.
- [ ] Same settings as section 1 (push protection, Dependabot) on the fork.
- [ ] Add the fork to this Claude project (Project settings → Repositories) so a thread can work on it.
- Verify: the PR run finishes; the Security tab of the fork lists Semgrep, Gitleaks, Trivy and CodeQL findings; artifact `zap-baseline` has a report.

## 3. Self-hosted runner on the homelab (30 min)

- [ ] Create an unprivileged Debian 12 LXC on Proxmox (2 vCPU, 4 GB RAM, 20 GB disk), name `gh-runner`, on the LAN that can reach staging. Enable *nesting* and *keyctl* (Options → Features) so Docker works.
- [ ] In the LXC: install Docker, `curl`, `jq`, `git`; create user `runner` in the `docker` group.
- [ ] GitHub: `appsec-rpg` → Settings → Actions → Runners → New self-hosted runner → Linux x64. Run the shown commands as `runner`, and at `config.sh` add `--labels homelab --name gh-runner-01`. Then `sudo ./svc.sh install runner && sudo ./svc.sh start`.
- [ ] Firewalla: allow `gh-runner` → staging `:3000` and outbound HTTPS to GitHub; nothing inbound.
- [ ] Repo variables (Settings → Secrets and variables → Actions → Variables): `HOMELAB_RUNNER_READY=true`, `STAGING_URL=http://<staging-lan-ip>:3000`.
- [ ] Repo secrets: `SEED_ALICE_PASSWORD`, `SEED_BOB_PASSWORD` (same values as staging `.env`; keep the source of truth in 1Password).
- Verify: Actions → `dast-nightly` → Run workflow. Before staging exists the *Health check* step fails, which proves the job ran on the homelab runner.
- Security note: public repo + self-hosted runner. Only `dast-nightly.yml` (schedule / manual) targets the runner; `security.yml` uses GitHub-hosted runners only. Also set Settings → Actions → General → *Require approval for all outside collaborators* so fork PRs can't reach the homelab.

## 4. Staging (after the game session merges a runnable app)

- [ ] LXC `appsec-rpg-staging` with Docker; `git clone`, create `.env` from `.env.example` (passwords from 1Password), `docker compose up -d`, `npm run seed` inside the app container.
- [ ] Firewalla: port 3000 LAN-only.
- [ ] Wazuh: tag or suppress requests with User-Agent `appsec-lab-scanner` (every scanner in this lab sets it).

## 5. Week 2 accounts (n8n / Jira / Discord / Wazuh)

- [ ] Jira Cloud free: create project key `APPSEC` (Scrum or Kanban). Create an API token at id.atlassian.com → Security → API tokens; store in 1Password, then add it as an n8n *Jira Software Cloud* credential.
- [ ] Discord: in your server, `#appsec-alerts` → Edit channel → Integrations → Webhooks → New webhook. Add the URL as an n8n credential (or Discord node webhook), never in the repo.
- [ ] Wazuh: decide the ingest path for n8n events (Wazuh API `/events` with an API user, or syslog to the manager). Create the API user and add it as an n8n credential.
- [ ] Screenshots under `docs/lab/screenshots/` named `<week>-<step>-<what>.png`.

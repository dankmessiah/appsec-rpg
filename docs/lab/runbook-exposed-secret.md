# Runbook: exposed secret in source control

| | |
|---|---|
| Owner | AppSec (runbook), SecOps (execution of P1 response) |
| Trigger | Gitleaks finding in `security.yml`, GitHub secret-scanning alert, push-protection bypass, or a report from a developer |
| Alert path | Scanner → n8n `appsec-ingest` → Jira `APPSEC` ticket (+ Wazuh event + Discord `#appsec-alerts` if Critical) |
| SLA | Contain within **1 hour** of alert (Critical); rotate within **24 hours** (High) |
| Related | `docs/lab/raci.md`, `docs/lab/gating-policy.md` |

The guiding rule: **a secret that reached a remote is compromised.** Deleting the commit doesn't un-leak it, because forks, clones, CI logs, caches and the GitHub event stream may already hold it. Rotation is the fix. History rewriting is cleanup.

## 1. Triage (SecOps on-call, ≤ 15 min)

1. Open the Jira ticket. n8n has already attached rule, file, line, commit, author, CODEOWNERS owner, repo visibility and tier.
2. Open the finding (Security tab → Secret scanning / Code scanning → Gitleaks) and confirm it's a real credential, not a placeholder, test fixture or revoked example.
   - **False positive:** close the alert as *false positive* / *used in tests*, add an allowlist entry (`.gitleaks.toml` `[allowlist]` with a comment and ticket id) in a PR, and resolve the ticket as *Not a vulnerability*. Done.
3. Classify severity:

   | Severity | Examples | Repo public or secret reached `main`? |
   |---|---|---|
   | Critical | Cloud root/admin keys, production DB passwords, signing keys, `SESSION_SECRET` for prod, GitHub PAT with `repo`/`admin` | Either one makes it Critical |
   | High | Staging/test credentials with network reach, third-party API keys with billing | Private repo, PR branch only |
   | Medium | Seed passwords for local dev, expired tokens (verify expiry!) | – |

4. Set severity on the ticket. Critical: page the owning team lead (from CODEOWNERS / RACI) and open an incident channel.

## 2. Contain (≤ 1 h for Critical)

Do these in order. Rotation comes before any git cleanup.

1. **Revoke or rotate the credential at the issuer.** For `appsec-rpg`:

   | Secret | Where it lives | How to rotate |
   |---|---|---|
   | `SESSION_SECRET` | Staging `.env` (1Password: *appsec-rpg / staging*) | Generate `openssl rand -hex 32`, update 1Password and `.env`, `docker compose up -d app`. All sessions are invalidated, which is expected. |
   | `DATABASE_URL` / Postgres password | Staging `.env` | `ALTER ROLE rpg PASSWORD '...'` inside the postgres container, update `.env`, restart `app`. |
   | `SEED_*_PASSWORD` | `.env`, GitHub Actions secrets | Update the users' `password_hash` (re-run `npm run seed`) and the Actions secrets `SEED_ALICE_PASSWORD` / `SEED_BOB_PASSWORD`. |
   | GitHub PAT / Actions secret | GitHub | Revoke the token (Settings → Developer settings); replace the Actions secret. |
   | n8n / Jira / Discord webhook | n8n credentials | Regenerate at the provider (Discord: delete and recreate the webhook; Jira: revoke the API token); update the n8n credential. |

2. **Look for use.** Query the issuer's audit log for the credential's activity since the commit time:
   - Wazuh: `rule.groups:authentication` and source IPs outside the LAN for the affected service; app logs for logins as the seed users from unknown IPs.
   - GitHub: Settings → Security log / audit log for token use.
   - Cloud provider: CloudTrail / activity log filtered by access key id.
   - Any use not explained by the owner escalates to a **security incident** (IR process, not this runbook).
3. Record in the ticket: rotation time, who rotated, evidence of use (yes/no + query).

## 3. Eradicate (≤ 24 h)

1. Remove the secret from the code in a normal PR and load it from configuration (`.env`, Actions secret, n8n credential) instead.
2. **History rewrite only when** the repo is private and the secret is in history the team will keep cloning. Use `git filter-repo --replace-text`, force-push with the owner's agreement, and ask GitHub Support to purge cached views. On a public repo, skip it: rotation already neutralised the secret, and a rewrite only breaks forks.
3. Close the secret-scanning alert as *revoked*.

## 4. Recover and learn

1. Confirm the service works with the new credential (staging health check: `GET /api/v1/health`).
2. Root cause in one paragraph on the ticket: how did the secret get into code (missing `.env.example` entry, debugging, copy-paste)?
3. Prevention check:
   - Push protection enabled on the repo? (It would have blocked the push. If it was bypassed, the bypass reason is in the alert; follow up with the developer.)
   - Pre-commit hook available? (`gitleaks protect --staged`)
   - Does the `.gitignore` cover the file type?
4. Resolve the Jira ticket. n8n records time-to-contain and time-to-rotate for the monthly metrics.

## Communication

| When | Who | Channel |
|---|---|---|
| Critical confirmed | Owning team lead, AppSec | Page + incident channel |
| Rotation done | Ticket watchers | Jira comment |
| Evidence of use | IR lead, CISO delegate | IR process |
| Monthly | Engineering leads | Metrics: count, MTTC, MTTR, push-protection bypasses |

## Drill (lab)

1. On branch `demo/seeded-secret` (never merged), commit a fake but realistic key, e.g. a GitHub PAT-shaped string.
2. `git push`. Push protection should block it. Screenshot `2-5-push-protection-block.png`.
3. Bypass with reason *"used in tests"* and open a PR. Gitleaks flags it, n8n creates the Jira ticket, the Wazuh event and the Discord message. Screenshots `2-5-jira-ticket.png`, `2-5-wazuh-event.png`, `2-5-discord.png`.
4. Walk this runbook end to end and time it. Close the PR and delete the branch.

# Triage log: Semgrep on OWASP Juice Shop

Week 3, deliverable 1. A hand-triage of 30 Semgrep findings on the calibration target, used to measure precision and decide what to tune before gating `appsec-rpg`.

| | |
|---|---|
| Target | `juice-shop/juice-shop` @ `717f5ef` (v20.3.0), upstream clone (the fork's own run will replace this) |
| Scanner | Semgrep 1.184.0, `--metrics=off` |
| Rulesets | `p/owasp-top-ten`, `p/javascript`, `p/nodejs` (same packs as `appsec-rpg`, minus `p/docker`) |
| Raw output | 43 unique findings (rule + file + line); 30 triaged below |
| Date | 2026-11-07 |

**Verdicts.** **TP** means the issue is real and exploitable or a real weakness in this context. **FP** means the code doesn't have the weakness the rule describes, or it never runs. Severity is my call after triage, not the rule's.

## Results

**Precision: 13 TP / 30 = 43 %.** After the two tuning actions below, it becomes **13 / 19 = 68 %** on the same set, with no true positives lost.

| By area | Triaged | TP | FP | Precision |
|---|---|---|---|---|
| App code (`routes/`, `lib/`, `server.ts`) | 14 | 9 | 5 | 64 % |
| Challenge snippets (`data/static/codefixes/`) | 6 | 0 | 6 | 0 % |
| GitHub Actions workflows | 7 | 2 | 5 | 29 % |
| Terraform | 2 | 1 | 1 | 50 % |
| npm config | 1 | 1 | 0 | 100 % |

| By rule confidence (Semgrep metadata) | Triaged | TP | Precision |
|---|---|---|---|
| HIGH | 17 | 7 | 41 % |
| MEDIUM | 13 | 6 | 46 % |

Rule confidence alone doesn't predict precision on this target. Context does: whether the file runs, and whether the input is actually attacker-controlled. That's why the gating policy uses an allowlist of rules plus path exclusions instead of "block everything HIGH".

## Findings

| # | Rule | Location | Verdict | Sev | Notes |
|---|---|---|---|---|---|
| 1 | `express-sequelize-injection` | `routes/login.ts:34` | TP | Critical | `req.body.email` interpolated into raw SQL. Classic auth-bypass SQLi (`' OR 1=1--`). |
| 2 | `express-sequelize-injection` | `routes/search.ts:23` | TP | Critical | `req.query.q` in a template literal. UNION-based extraction of the Users table. |
| 3 | `code-string-concat` | `routes/userProfile.ts:65` | TP | Critical | `eval()` of a username matching `#{...}`. Server-side code execution. |
| 4 | `express-open-redirect` | `routes/redirect.ts:18` | TP | Medium | The allowlist check uses `url.includes(allowed)`, so `https://evil.example/?x=https://github.com/juice-shop` passes. |
| 5 | `express-res-sendfile` | `routes/fileServer.ts:32` | TP | High | The extension allowlist is bypassed with a poison null byte (`%2500.md`), which serves arbitrary files from `ftp/`. |
| 6 | `express-res-sendfile` | `routes/keyServer.ts:14` | FP | – | Traversal is blocked: `:file` is a single path segment and `/` is rejected. Exposure of the keys is a real issue, but it's finding 13, not this rule. |
| 7 | `express-res-sendfile` | `routes/logfileServer.ts:14` | FP | – | Same guard as 6. |
| 8 | `express-res-sendfile` | `routes/quarantineServer.ts:14` | FP | – | Same guard as 6. |
| 9 | `hardcoded-jwt-secret` | `lib/insecurity.ts:54` | FP | – | Flags `denyAll()`, whose secret is `'' + Math.random()`, which isn't hardcoded. Meanwhile the real hardcoded RSA private key a few lines up is **not** flagged (false negative; Gitleaks catches it). |
| 10 | `express-check-directory-listing` | `server.ts:269` `/infrastructure` | TP | Medium | Browsable Terraform/IaC files. Information disclosure. |
| 11 | `express-check-directory-listing` | `server.ts:290` `/ftp` | TP | Medium | Browsable confidential documents (`acquisitions.md`). |
| 12 | `express-check-directory-listing` | `server.ts:294` `/.well-known` | FP | – | `.well-known` is public by convention (security.txt, etc.). Intended. |
| 13 | `express-check-directory-listing` | `server.ts:298` `/encryptionkeys` | TP | High | Listing and download of key material. |
| 14 | `express-check-directory-listing` | `server.ts:302` `/support/logs` | TP | High | Access logs browsable without auth. |
| 15 | `express-sequelize-injection` | `data/static/codefixes/dbSchemaChallenge_1.ts:5` | FP | – | Snippet shown in the coding-challenge UI. Never imported or executed. |
| 16 | `express-sequelize-injection` | `data/static/codefixes/dbSchemaChallenge_3.ts:11` | FP | – | Same (non-executed snippet). |
| 17 | `express-sequelize-injection` | `data/static/codefixes/unionSqlInjectionChallenge_1.ts:6` | FP | – | Same. |
| 18 | `express-sequelize-injection` | `data/static/codefixes/unionSqlInjectionChallenge_3.ts:10` | FP | – | Same. |
| 19 | `aws-subnet-has-public-ip-address` | `data/static/codefixes/iacLeakedKeyChallenge_1.tf:17` | FP | – | Snippet, not deployed. |
| 20 | `insecure-load-balancer-tls-version` | `data/static/codefixes/iacLeakedKeyChallenge_1.tf:159` | FP | – | Snippet, not deployed. |
| 21 | `aws-subnet-has-public-ip-address` | `terraform/networking.tf:18` | FP | – | It's the *public* subnet for the ALB; `map_public_ip_on_launch` is intended. Would be TP on a private subnet. |
| 22 | `insecure-load-balancer-tls-version` | `terraform/networking.tf:160` | TP | Medium | The port-80 listener *forwards* plain HTTP to the app instead of redirecting to the HTTPS listener. |
| 23 | `run-shell-injection` | `.github/workflows/update-challenges-www.yml:27` | FP | – | Interpolates `github.ref_name`, but the trigger is `push` to `[master, develop]` only, so the value is one of two fixed names. Still poor style. |
| 24 | `run-shell-injection` | `.github/workflows/update-challenges-www.yml:36` | FP | – | Same. |
| 25 | `run-shell-injection` | `.github/workflows/update-challenges-www-legacy.yml:27` | FP | – | Same. |
| 26 | `run-shell-injection` | `.github/workflows/update-challenges-www-legacy.yml:36` | FP | – | Same. |
| 27 | `run-shell-injection` | `.github/workflows/update-challenges-ebook.yml:22` | FP | – | Same. |
| 28 | `gha-curl-pipe-shell` | `.github/workflows/ci.yml:374` | TP | Medium | `curl https://cli-assets.heroku.com/install.sh \| sh` in a job with deploy secrets. Supply-chain risk. |
| 29 | `github-actions-mutable-action-tag` | `.github/workflows/ci.yml:198` | TP | Low | `coverallsapp/github-action@v2` isn't SHA-pinned (cf. the March 2026 trivy-action tag hijack). |
| 30 | `npm-missing-minimum-release-age` | `.npmrc:1` | TP | Low | No minimum release age, so a freshly published malicious version installs immediately. |

Not triaged (13): six more mutable-tag findings in other workflows (same verdict as 29), one more `.npmrc` (same as 30), and six more Terraform findings: four in `codefixes/` (same as 19–20) and two in `infrastructure/terraform/`, a byte-identical copy of `terraform/` (same as 21–22).

## What it missed (spot check)

Precision isn't the whole story. Known Juice Shop vulns these packs did **not** report:

- The hardcoded RSA private key in `lib/insecurity.ts` and the one in `terraform/networking.tf` (Gitleaks and Trivy secret scanning cover these).
- BOLA on basket access (`/rest/basket/:id`). There's no generic rule for "object loaded by id without an owner check", which is exactly why `appsec-rpg` has the custom `battle-route-missing-owner-check` rule.
- Business-logic flaws (negative quantities, coupon forgery). SAST can't see these; they belong to DAST and manual testing.

## Tuning actions

| Action | Effect on this set | Applied to |
|---|---|---|
| Exclude non-executed fixture/snippet paths (`data/static/codefixes/` here; `semgrep/` rule fixtures in `appsec-rpg`) via `.semgrepignore` | −6 FP | Fork's `.semgrepignore`; `appsec-rpg` already ignores `semgrep/` |
| Don't gate on `run-shell-injection` when the only interpolated value is `github.ref_name` on a branch-restricted `push`: route those to backlog, not blocking. Keep blocking for `pull_request_target` / `issue_comment` contexts. | −5 FP from the blocking set | `docs/lab/gating-policy.md` |
| Treat `express-res-sendfile` and `express-check-directory-listing` as warn-only (5 of 9 TP, needs a human) | No change to precision; keeps them out of the gate | `docs/lab/gating-policy.md` |
| Rely on Gitleaks, not Semgrep `hardcoded-*` rules, for secrets | Removes a noisy rule with a known false negative | Pipeline design (already the case) |

## Method

1. `semgrep scan --metrics=off --config p/owasp-top-ten --config p/javascript --config p/nodejs --json .` on a clean clone.
2. Deduplicated on rule + file + line, the same key the n8n dedupe stage uses.
3. For each finding, read the code and traced whether the input is attacker-controlled and whether the code runs in the deployed app. Verdict and severity are recorded above.
4. Re-run in the fork's pipeline when it exists, and update this log if the counts differ.

# Lab setup: steps that need Nunzio's hands

Copy-paste steps for everything the cloud session can't do. Run commands in **PowerShell 7** on xamastation unless a block says it runs on the Proxmox host. No command prints a secret. Secrets are generated locally, stored in 1Password (vault **Homelab**), and passed straight to GitHub.

When you finish a step, tick it and tell the project thread. Claude verifies each one from its side.

## 1. GitHub settings on `appsec-rpg` (done 2026-11-08)

- [x] Repo public. Code scanning, secret scanning and push protection are free on public repos.
- [x] Secret scanning and push protection on.
- [x] Dependabot alerts and security updates on. Version updates are in `.github/dependabot.yml`.
- [x] CodeQL *default setup* left **off** (our workflow runs CodeQL; both at once conflict).
- [x] Fork-PR workflows need approval (`all_external_contributors`).
- [x] Ruleset `main protection` (id 26786549): PR required, squash only, checks `test` `semgrep` `gitleaks` `trivy` `codeql`, no force push or delete, no bypass.
- [x] Variable `N8N_INGEST_URL=https://n8n.home.arpa/webhook/appsec-ingest`.

## 2. Secrets (5 min)

- [ ] **n8n ingest token**: one value shared by n8n and GitHub.

```powershell
$tok = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
op item create --category "API Credential" --vault Homelab --title "AppSec RPG - n8n ingest token" "credential=$tok" | Out-Null
gh secret set N8N_INGEST_TOKEN -R dankmessiah/appsec-rpg --body $tok
Remove-Variable tok
```

- [ ] **Staging seed users** (staging uses the same values in its `.env` later):

```powershell
function New-Pw { [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)) -replace '[+/=]','' }
$a = New-Pw; $b = New-Pw
op item create --category "Secure Note" --vault Homelab --title "AppSec RPG - staging seed users" "alice[password]=$a" "bob[password]=$b" | Out-Null
gh secret set SEED_ALICE_PASSWORD -R dankmessiah/appsec-rpg --body $a
gh secret set SEED_BOB_PASSWORD   -R dankmessiah/appsec-rpg --body $b
Remove-Variable a,b
```

Check: `gh secret list -R dankmessiah/appsec-rpg` lists `N8N_INGEST_TOKEN`, `SEED_ALICE_PASSWORD`, `SEED_BOB_PASSWORD`.

`--body` is used instead of piping because a PowerShell pipe appends a newline, and the token must match n8n byte for byte.

## 3. Juice Shop fork (10 min)

- [ ] **Fork, enable Actions, disable every upstream workflow** (they're long and expect upstream secrets):

```powershell
gh repo fork juice-shop/juice-shop --clone=false
do { Start-Sleep 3; gh repo view dankmessiah/juice-shop *> $null } until ($LASTEXITCODE -eq 0)
gh api -X PUT repos/dankmessiah/juice-shop/actions/permissions -F enabled=true -f allowed_actions=all
gh workflow list -R dankmessiah/juice-shop --all --json id,state --jq '.[] | select(.state=="active") | .id' |
  ForEach-Object { gh workflow disable $_ -R dankmessiah/juice-shop }
gh workflow list -R dankmessiah/juice-shop --all    # all should say disabled_manually
```

- [ ] **Add the lab pipeline on a branch and open a PR in the fork** (sparse clone, `.github` only):

```powershell
$def = gh repo view dankmessiah/juice-shop --json defaultBranchRef --jq .defaultBranchRef.name
cd $env:TEMP
git clone --depth 1 --filter=blob:none --sparse https://github.com/dankmessiah/juice-shop js-lab
cd js-lab
git sparse-checkout set .github
git switch -c lab/appsec-pipeline
New-Item -ItemType Directory -Force .github/scripts | Out-Null
curl.exe -fsSLo .github/workflows/appsec-lab.yml https://raw.githubusercontent.com/dankmessiah/appsec-rpg/main/docs/lab/juice-shop/appsec-lab.yml
curl.exe -fsSLo .github/scripts/sarif-summary.sh https://raw.githubusercontent.com/dankmessiah/appsec-rpg/main/.github/scripts/sarif-summary.sh
git add .github/workflows/appsec-lab.yml
git add --chmod=+x .github/scripts/sarif-summary.sh
git commit -m "Add AppSec lab pipeline workflow and SARIF summary script"
git push -u origin lab/appsec-pipeline
gh pr create -R dankmessiah/juice-shop --base $def --head lab/appsec-pipeline --title "AppSec lab pipeline" --body "AppSec lab workflow from dankmessiah/appsec-rpg. Calibration only."
```

Keep `-R dankmessiah/juice-shop` on `gh pr create`, or gh opens the PR against upstream.

- [ ] **Same security settings on the fork:**

```powershell
'{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' |
  gh api -X PATCH repos/dankmessiah/juice-shop --input -
gh api -X PUT repos/dankmessiah/juice-shop/vulnerability-alerts
gh api -X PUT repos/dankmessiah/juice-shop/automated-security-fixes
```

- [ ] Add `dankmessiah/juice-shop` to the Claude project (Project settings → Repositories) so a thread can triage it.

Verify: the PR's `appsec-lab` run finishes; the fork's Security tab lists Semgrep, Gitleaks, Trivy and CodeQL; artifact `zap-baseline` has a report.

## 4. Homelab runner: LXC 106 `gh-runner` on Nexus (20 min)

Same storage (`local-lvm`) and bridge (`vmbr0`) as the existing LXCs. Check 106 is still free first: `ssh nexus pvesh get /cluster/nextid`.

- [ ] **Create the LXC, install Docker and the runner.** Run `ssh nexus`, then on the Proxmox host:

```bash
pct create 106 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst --hostname gh-runner --cores 2 --memory 4096 --rootfs local-lvm:20 --net0 name=eth0,bridge=vmbr0,ip=dhcp,type=veth --unprivileged 1 --features nesting=1,keyctl=1 --onboot 1
pct start 106 && sleep 10
pct exec 106 -- bash -c 'apt-get update && apt-get install -y curl jq git ca-certificates && install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && useradd -m -s /bin/bash -G docker runner'
pct exec 106 -- su - runner -c 'mkdir -p actions-runner && cd actions-runner && V=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed s/^v//) && curl -fsSLo r.tgz https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-x64-$V.tar.gz && tar xzf r.tgz && rm r.tgz'
pct exec 106 -- /home/runner/actions-runner/bin/installdependencies.sh
pct exec 106 -- docker run --rm hello-world
exit
```

- [ ] **Register the runner** (back in PowerShell; the token is single-use and expires in 1 hour):

```powershell
$t = gh api -X POST repos/dankmessiah/appsec-rpg/actions/runners/registration-token --jq .token
ssh nexus "pct exec 106 -- su - runner -c 'cd actions-runner && ./config.sh --unattended --url https://github.com/dankmessiah/appsec-rpg --token $t --labels homelab --name gh-runner-01'"
Remove-Variable t
ssh nexus "pct exec 106 -- bash -c 'cd /home/runner/actions-runner && ./svc.sh install runner && ./svc.sh start'"
```

- [ ] **Trust the Caddy root CA inside the LXC** (the findings forwarder posts to `https://n8n.home.arpa`). The last line should print an HTTP status, not a TLS error:

```powershell
scp C:\Users\xamar\Documents\n8n-deploy\caddy-root.crt nexus:/tmp/caddy-root.crt
ssh nexus "pct push 106 /tmp/caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt && pct exec 106 -- update-ca-certificates && rm /tmp/caddy-root.crt"
ssh nexus "pct exec 106 -- curl -sS -o /dev/null -w '%{http_code}\n' https://n8n.home.arpa/"
```

- [ ] **Verify, then switch the homelab jobs on:**

```powershell
gh api repos/dankmessiah/appsec-rpg/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
# only once gh-runner-01 is "online" with label "homelab":
gh variable set HOMELAB_RUNNER_READY --body true -R dankmessiah/appsec-rpg
```

- [ ] Firewalla: allow `gh-runner` outbound HTTPS (GitHub) and to `n8n.home.arpa`; nothing inbound. Staging `:3000` is added in section 6.

Security note: public repo + self-hosted runner. Only `dast-nightly.yml` (schedule / manual) and `findings-forward.yml` (`workflow_run`, skips fork runs) target the runner. `security.yml` uses GitHub-hosted runners only, and fork-PR workflows need approval.

## 5. Week 2 accounts and n8n wiring (30 min)

Workflow **AppSec RPG - appsec-ingest** (folder *AppSec RPG*, draft) at `https://n8n.home.arpa`.

- [ ] **Jira**: create project key `APPSEC` (Projects → Create → Kanban). Create an API token at id.atlassian.com → Security → *Create API token*. Save it in 1Password (Homelab) as `AppSec RPG - Jira API token` with your Atlassian email and site URL.
- [ ] **Discord bot**: discord.com/developers/applications → *New Application* "AppSec Alerts" → *Bot* → *Reset Token*. Save it in 1Password as `AppSec RPG - Discord bot token`. Then *OAuth2 → URL Generator*: scope `bot`, permissions *View Channels* + *Send Messages*. Open the URL and add the bot to your server. Create channel `#appsec-alerts`.
- [ ] **Wazuh**: use the existing 1Password item *Nexus\NexPrime\Wazuh API* for now. A dedicated user with only `event:ingest` is the clean version; see `docs/lab/n8n/README.md` → *Wazuh side*.
- [ ] **n8n credentials** (Credentials → *Add credential*). Copy each value from 1Password:

  | Credential type | Name | Values |
  |---|---|---|
  | Header Auth | `AppSec ingest token` | Name `X-AppSec-Token`, Value = *credential* field of `AppSec RPG - n8n ingest token` |
  | Jira SW Cloud API | `Jira APPSEC` | email, API token, domain `https://<site>.atlassian.net` |
  | Discord Bot API | `Discord AppSec bot` | bot token |
  | Basic Auth | `Wazuh API user` | Wazuh API username / password |

- [ ] **Select them in the workflow:**
  - *Receive Scanner Findings*: `AppSec ingest token`. This replaces *ff-api service token*, which n8n attached automatically. Don't share tokens between services.
  - *Create APPSEC Jira Ticket*: `Jira APPSEC`, project **APPSEC**, issue type **Task**.
  - *Alert #appsec-alerts* and *Alert Jira Ticket Failed*: `Discord AppSec bot`, your server, `#appsec-alerts`.
  - *Get Wazuh API Token*: `Wazuh API user`. Check the URL is `https://wazuh.home.arpa:55000`. If you get a TLS error, add Wazuh's CA to n8n's `NODE_EXTRA_CA_CERTS`; don't turn off certificate checks.
- [ ] **Test**: in the workflow, click *Execute workflow* (it listens on the test URL), then:

```powershell
curl.exe -fsSLo $env:TEMP\sample.json https://raw.githubusercontent.com/dankmessiah/appsec-rpg/main/docs/lab/n8n/samples/sample-payload.json
$t = op read "op://Homelab/AppSec RPG - n8n ingest token/credential"
curl.exe -sS -X POST https://n8n.home.arpa/webhook-test/appsec-ingest -H "X-AppSec-Token: $t" -H "Content-Type: application/json" --data-binary "@$env:TEMP\sample.json" --cacert C:\Users\xamar\Documents\n8n-deploy\caddy-root.crt
Remove-Variable t
```

  Expect 3 Jira tickets (2 marked Critical), 2 Discord alerts and 2 Wazuh events. Screenshot each stage into `docs/lab/screenshots/` as `2-1-ingest.png` … `2-4-route.png`, `2-4-jira.png`, `2-4-discord.png`, `2-4-wazuh.png`.
- [ ] **Publish** the workflow (toggle in the top bar). It stays a draft until you do.

## 6. Staging (after the game session merges a runnable app)

- [ ] LXC `appsec-rpg-staging` with Docker; `git clone`, `.env` from `.env.example` with the seed passwords from `AppSec RPG - staging seed users`, `docker compose up -d`, `npm run seed` inside the app container.
- [ ] Firewalla: port 3000 LAN-only; allow `gh-runner` → staging `:3000`.
- [ ] `gh variable set STAGING_URL --body http://<staging-lan-ip>:3000 -R dankmessiah/appsec-rpg`
- [ ] Wazuh: tag or suppress requests with User-Agent `appsec-lab-scanner` (every scanner in this lab sets it).

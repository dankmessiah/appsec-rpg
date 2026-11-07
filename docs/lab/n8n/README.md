# n8n: `appsec-ingest` (SOC handoff)

The SOAR layer for Week 2. Scanner output goes in; owner-routed Jira tickets come out, and Criticals also go to Wazuh and Discord.

| | |
|---|---|
| Workflow | **AppSec RPG - appsec-ingest** (n8n id `DzZy8fLAZaSiPs0N`, folder *AppSec RPG*, tags `appsec-rpg`, `appsec-lab`) |
| State | **Draft, unpublished.** Needs credentials (below) before it can go live |
| Trigger | `POST https://n8n.home.arpa/webhook/appsec-ingest`, Header Auth `X-AppSec-Token` |
| Export | [`appsec-ingest.json`](appsec-ingest.json), credentials scrubbed (each node names the credential *type* it needs) |
| Fed by | `.github/workflows/findings-forward.yml` on the homelab runner, after `security` and `dast-nightly` complete |

## Stages (one node group each, for screenshots)

```
Webhook ─▶ 1 Ingest ─▶ 2 Enrich ─▶ 3 Dedupe ─▶ 4 Route
           Normalize    Owner/tier/   Remove dupes    Jira APPSEC (all, SLA due date)
           SARIF, ZAP,  exposure,     seen in prior     └─ error ─▶ Discord "ticket failed"
           findings[]   SLA, key      executions       Is Critical? ─▶ Discord #appsec-alerts ─▶ Wazuh /events
```

1. **Ingest**: one item per finding from SARIF 2.1.0 (Semgrep, Gitleaks, CodeQL, Trivy), ZAP `traditional-json`, or flat `findings[]` (BOLA check). Gitleaks/secret findings are forced to Critical.
2. **Enrich**: owner from a mock CODEOWNERS per repo (last match wins), app tier (appsec-rpg = 1, juice-shop = 3), exposure, data class, SLA due date from `raci.md` (Critical 7 d, High 30, Medium 90, Low 180), and the dedupe key. Severity is bumped High → Critical for a Tier 1 app when the finding is runtime-confirmed (DAST/secret) and high-confidence.
3. **Dedupe**: key = `repo|rule|file|line` (SAST) or `repo|rule|url-without-query|param` (DAST); remembered across executions (10 000 keys), so a re-run of the same PR doesn't re-ticket.
4. **Route**: every finding becomes a Jira ticket. If Jira fails, Discord gets a warning, so failures aren't silent. Critical findings also get a Discord alert and a Wazuh event (JSON with `appsec_lab: true`, tool, rule, owner, Jira key, runbook link).

Tested in n8n with pinned data (execution 12787): 1 Gitleaks SARIF secret + 1 BOLA finding + 1 medium Semgrep finding → 3 tickets, 2 routed as Critical. External calls (Jira, Discord, Wazuh) were simulated by the pin data, not proven live.

## Setup (Nunzio)

1. **Credentials** in n8n (Credentials → Add):
   - *AppSec ingest token*: Header Auth, name `X-AppSec-Token`, value = a random 32-byte hex (`openssl rand -hex 32`). Put the same value in GitHub secret `N8N_INGEST_TOKEN`. **Then open the webhook node and select it.** On creation, n8n auto-assigned your existing *ff-api service token* credential to this node. Replace it; don't share tokens between services.
   - *Jira APPSEC*: Jira SW Cloud API (email + API token).
   - *Discord AppSec bot*: Discord Bot API. Create the bot at discord.com/developers → New Application → Bot → Reset Token, then invite it to your server with *Send Messages* on `#appsec-alerts`.
   - *Wazuh API user*: Basic Auth, a Wazuh API user with the `event:ingest` permission. If Wazuh's API uses a self-signed cert, add its CA to n8n (`NODE_EXTRA_CA_CERTS`) rather than disabling TLS checks.
2. In the workflow: pick **project APPSEC** and **issue type** in *Create APPSEC Jira Ticket*, and the **server** and **#appsec-alerts** in both Discord nodes. Check the Wazuh URL (`https://wazuh.home.arpa:55000`).
3. Test: *Execute workflow* (test URL), then
   ```bash
   curl -sS -X POST https://n8n.home.arpa/webhook-test/appsec-ingest \
     -H "X-AppSec-Token: $TOKEN" -H 'Content-Type: application/json' \
     --data @docs/lab/n8n/samples/sample-payload.json
   ```
   Expect 2 Critical tickets, 2 Discord alerts and 2 Wazuh events. Screenshot each stage: `2-1-ingest.png` … `2-4-route.png`, `2-4-jira.png`, `2-4-discord.png`, `2-4-wazuh.png`.
4. **Publish** the workflow (it stays a draft until you do).
5. GitHub: variable `N8N_INGEST_URL=https://n8n.home.arpa/webhook/appsec-ingest`, secret `N8N_INGEST_TOKEN`; and on the runner, either trust the Caddy root CA system-wide or set variable `N8N_CA_FILE` to its path.

## Wazuh side

A local rule so the events are searchable and Criticals alert (add to `/var/ossec/etc/rules/local_rules.xml` on the manager):

```xml
<group name="appsec,">
  <rule id="100900" level="3">
    <decoded_as>json</decoded_as>
    <field name="appsec_lab">true</field>
    <description>AppSec finding: $(tool) $(rule) in $(repo)</description>
  </rule>
  <rule id="100901" level="12">
    <if_sid>100900</if_sid>
    <field name="severity">critical</field>
    <description>AppSec CRITICAL: $(kind) $(rule) in $(repo), owner $(owner), $(jira)</description>
  </rule>
</group>
```

Scanner traffic itself is identifiable by User-Agent `appsec-lab-scanner`; tag or suppress it in Wazuh web-log rules so DAST runs don't page anyone.

## Mapping to Tines (interview talking point)

| n8n | Tines equivalent |
|---|---|
| Webhook + Header Auth | Webhook action with secret path / header check |
| Code (normalize, enrich) | Event Transform (message-only / explode / implode) |
| Remove Duplicates (cross-execution) | Deduplicate action with lookback |
| Jira / Discord / HTTP | HTTP Request actions with Credentials + Resources (owner map, SLA table as a Resource) |
| Error output → Discord | Action-level error handling / Monitor failures |

# n8n: `appsec-ingest` (SOC handoff)

The SOAR layer for Week 2. Scanner output goes in; owner-routed Jira tickets come out, and Criticals also go to Wazuh and Discord.

| | |
|---|---|
| Workflow | **AppSec RPG - appsec-ingest** (n8n id `DzZy8fLAZaSiPs0N`, folder *AppSec RPG*, tags `appsec-rpg`, `appsec-lab`) |
| State | **Published and live-tested on 2026-11-08.** The sanitized export still requires instance-specific setup after import |
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
3. **Dedupe**: remove repeated keys within the current input first, keeping the first item and all its fields, then compare against historical keys. Key = `repo|rule|file|line` (SAST) or `repo|rule|url-without-query|param` (DAST); remembered across executions (10 000 keys), so a re-run of the same PR doesn't re-ticket.
4. **Route**: every finding becomes a Jira ticket. If Jira fails, Discord gets a warning, so failures aren't silent. Critical findings also get a Discord alert and a Wazuh event (JSON with `appsec_lab: true`, tool, rule, owner, Jira key, runbook link).

## Verified evidence (2026-11-08)

### Stage and Jira captures

- [Ingest](../screenshots/2-1-ingest.png) and [enrichment](../screenshots/2-2-enrich.png) show the historical configuration canvas, not execution results.
- [Deduplication](../screenshots/2-3-dedupe.png) shows the historical draft canvas with the historical-key node expanded. Its Publish button is not proof of live publication, and the image predates the later same-input deduplication repair.
- [Synthetic Jira ticket APPSEC-4](../screenshots/2-4-jira.png) shows the authorized fake-secret routing result, descriptive owner, native Highest priority and November 15, 2026 due date. Its example commit and run link are fixture data, not a real secret finding.

The routing canvas is omitted because it exposes private infrastructure details. Its configuration routes all findings to Jira and Critical findings onward to Discord and Wazuh; the direct delivery observations below provide the result evidence. The handoff permits written evidence when a capture cannot be cleanly redacted. These four images are unaltered captures and do not prove the current workflow version.

### Follow-up delivery inspection (2026-11-10)

Direct inspection of the existing Discord message history confirmed both synthetic Critical alerts and the seeded-secret APPSEC-7 alert. The earlier two messages retain KAN-4 and KAN-5 from before the project-key rename. Wazuh finding archives independently contain all three corresponding events under rule 100901. These observations supersede the earlier limitation below that the seeded-secret Discord message had not yet been inspected. No new finding, ticket or message was created for this inspection.

This written evidence records the delivery result without publishing Discord server identifiers or private dashboard details. Private configuration screenshots show the ingest, enrichment, deduplication and routing stages; those configuration views are not evidence of successful external delivery. Standalone Discord and Wazuh screenshots are not included.

- A production webhook submission with two synthetic Critical findings created APPSEC-4 (fake secret) and APPSEC-5 (BOLA routing fixture). The user confirmed both Discord alerts; Wazuh rule 100901 recorded two corresponding events. Their event payloads retain the original KAN-4 and KAN-5 keys from before the Jira project-key rename.
- One real ZAP finding from [Juice Shop calibration run 42450911928](https://github.com/dankmessiah/juice-shop/actions/runs/42450911928), plugin 10038 and its first instance only, created APPSEC-6. Verified: Medium priority, native due date 2027-02-06, descriptive owner `@juice-maintainers`, Tier 3, and 90-day SLA. This was a one-time submission, not permanent forwarding of the fork's output.
- The published workflow maps native Jira Priority and Due date in addition to its description. The two earlier Critical tickets were corrected to Highest and 2026-11-15. Mock owners remain descriptive; Jira assignees remain unassigned.
- The [seeded-secret drill PR #9](https://github.com/dankmessiah/appsec-rpg/pull/9) proved the full scanner-to-routing path. Push protection blocked the locally generated, nonfunctional PAT-shaped fixture; the owner authorized one `used_in_tests` bypass. [Security run 42538751150](https://github.com/dankmessiah/appsec-rpg/actions/runs/42538751150) produced exactly one Gitleaks finding and [forwarder run 42538856021](https://github.com/dankmessiah/appsec-rpg/actions/runs/42538856021) succeeded. APPSEC-7 was created with native Highest priority and due date 2026-11-16; Wazuh rule 100901 recorded it at 2026-11-09T00:11:59Z, 83 seconds after the security run started. The workflow reached Wazuh after its Discord step, but the drill message was not independently inspected in Discord. PR #9 was closed unmerged. The due date uses the UTC processing date plus seven days.
- [Forwarder run 42452125521, attempt 2](https://github.com/dankmessiah/appsec-rpg/actions/runs/42452125521/attempts/2) succeeded after token rotation. Its five source SARIF files contained zero results, so this verifies the forwarder job, not additional ticket delivery.

The earlier pinned execution 12787 simulated external calls and is not live-delivery evidence. The ingest token was rotated across the vault, GitHub secret, and n8n credential. Payload redaction requires a paid feature on this instance, so saved execution payloads and progress are disabled for manual, successful, and failed runs. Older executions are not removed by this setting. Use downstream records as delivery evidence; do not restore payload saving merely to capture webhook headers.

TLS hardening verified on 2026-11-08 (local date): the Wazuh API now presents a certificate with a matching endpoint identity, signed by a dedicated local CA. n8n mounts the public CA read-only and loads it through `NODE_EXTRA_CA_CERTS`. A request from inside the running n8n container returned HTTP 401 with `tlsAuthorized: true`, proving certificate and hostname validation without sending credentials or creating events. Both published Wazuh nodes explicitly set `allowUnauthorizedCerts: false`. Certificate and Compose backups were retained; all Wazuh services were active after the authorized restart. This is transport verification, not a second alert-delivery test.

The old webhook execution 13252 was deleted with owner approval after token rotation. The earlier pinned simulation 12787 remains. The stale duplicate vault item ID from the handoff was no longer present when cleanup was attempted; the active ingest-token item was not changed.

## Offline routing regression verification (2026-11-10)

The sanitized export resolves SARIF descriptors within their declared driver or extension component. Conflicting or unresolved explicit references fail with a SARIF descriptor error instead of silently downgrading severity. The current-input Remove Duplicates v2 node now precedes the existing historical node; that historical node and its settings are preserved.

Run `node --test tests/unit/ingest-routing.test.js` or `npm test -- --runTestsByPath tests/unit/ingest-routing.test.js`. The regression cases first reproduced the old failures (1 passed, 15 failed), then passed after repair. They cover extension and driver references, malformed or ambiguous references, severity/confidence/SLA, clean reports, secret tags, ZAP, graph order, and documented current-input/historical dedupe semantics. The native node parameters passed the connected n8n schema validator. Dedupe behavior in these tests is a local model of documented native semantics, not an actual n8n execution.

Offline replay of the verified SQLi drill reports produced CodeQL High/high/30 days and reduced the two same-key Semgrep results to one representative entering historical dedupe. The reports remain outside the repository; test inputs use minimal representative metadata without source snippets.

A separate unpublished regression workflow then executed the actual native dedupe node with harmless synthetic reports. It confirmed three results become two findings with correct severity, SLA, preserved fields and item links. That test contained no credentials or delivery nodes. The owner approved publication of the repaired ingest workflow, which is now active with historical dedupe preserved. APPSEC-33 was corrected to High, high confidence, a 30-day SLA and December 10, 2026 due date. APPSEC-35 was linked as a duplicate of APPSEC-34 and moved to Done; APPSEC-34 remains open. The corrections were verified after reloading Jira, without sending another finding.

## Setup (Nunzio)

1. **Credentials** in n8n (Credentials → Add):
   - *AppSec ingest token*: Header Auth, name `X-AppSec-Token`, value = a random 32-byte hex (`openssl rand -hex 32`). Put the same value in GitHub secret `N8N_INGEST_TOKEN`. **Then open the webhook node and select the dedicated ingest credential.** Do not reuse another service's token.
   - *Jira APPSEC*: Jira SW Cloud API (email + API token).
   - *Discord AppSec bot*: Discord Bot API. Create the bot at discord.com/developers → New Application → Bot → Reset Token, then invite it to your server with *Send Messages* on `#appsec-alerts`.
   - *Wazuh API user*: Basic Auth, a Wazuh API user with the `event:ingest` permission. If Wazuh's API uses a self-signed cert, add its CA to n8n (`NODE_EXTRA_CA_CERTS`) rather than disabling TLS checks.
2. In the workflow: pick **project APPSEC** and **issue type Task** in *Create APPSEC Jira Ticket*, and the **server** and **#appsec-alerts** in both Discord nodes. Replace the four priority-ID placeholders with your Jira instance's IDs for Highest, High, Medium, and Low. The system field `duedate` uses `YYYY-MM-DD`. Check the Wazuh URL (`https://wazuh.home.arpa:55000`).
3. Test: *Execute workflow* (test URL), then
   ```bash
   curl -sS -X POST https://n8n.home.arpa/webhook-test/appsec-ingest \
     -H "X-AppSec-Token: $TOKEN" -H 'Content-Type: application/json' \
     --data @docs/lab/n8n/samples/sample-payload.json
   ```
   Expect 2 Critical tickets, 2 Discord alerts and 2 Wazuh events. Screenshot each stage: `2-1-ingest.png` … `2-4-route.png`, `2-4-jira.png`, `2-4-discord.png`, `2-4-wazuh.png`.
4. **Publish** an imported workflow after setup. The existing lab workflow is already published.
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

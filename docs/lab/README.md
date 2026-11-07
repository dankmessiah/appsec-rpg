# AppSec pipeline lab

Brief: [`LAB-SESSION-BRIEF.md`](LAB-SESSION-BRIEF.md). The lab treats `appsec-rpg` as a product onboarded to an AppSec program, with OWASP Juice Shop as the calibration target.

| Doc | What it is |
|---|---|
| [`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md) | Manual steps: GitHub settings, Juice Shop fork, homelab runner, accounts |
| [`triage-log.md`](triage-log.md) | 30 hand-triaged Semgrep findings on Juice Shop, with precision and tuning |
| [`gating-policy.md`](gating-policy.md) | What blocks a merge, and why |
| [`runbook-exposed-secret.md`](runbook-exposed-secret.md) | SOC runbook for leaked credentials |
| [`raci.md`](raci.md) | Who does what, from scanner to closure; SLAs |
| [`plan-30-60-90.md`](plan-30-60-90.md) | Program rollout plan |
| [`tool-evaluation-matrix.md`](tool-evaluation-matrix.md) | Weighted tool comparison |
| `n8n/` | Exported n8n workflows (credentials scrubbed) |
| `screenshots/` | `<week>-<step>-<what>.png` |

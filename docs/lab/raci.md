# RACI: AppSec findings, from scanner to closure

**R** Responsible (does the work) · **A** Accountable (one per row, owns the outcome) · **C** Consulted · **I** Informed

| Activity | AppSec | Dev team (CODEOWNERS) | SecOps / SOC | Platform / DevOps | Eng. manager |
|---|---|---|---|---|---|
| Select, configure and tune scanners | **A/R** | C | I | C | I |
| Maintain pipeline (`security.yml`, runners, n8n flows) | **A** | I | C | R | I |
| Write and maintain custom rules | **A/R** | C | I | – | – |
| Triage new SAST/SCA/DAST findings (TP/FP, severity) | **A/R** | C | I | – | – |
| Fix code-level findings within SLA | C | **R** | I | – | **A** |
| Fix dependency/container findings within SLA | C | **R** | I | R (base images) | **A** |
| Accept risk / grant exception | R (recommend) | C | I | – | **A** (with CISO delegate for Critical) |
| Respond to exposed secret (rotate, check for use) | C | R (rotate app-owned secrets) | **A/R** (contain, hunt) | R (infra secrets) | I |
| Monitor Critical alerts in SIEM / Discord | C | I | **A/R** | I | – |
| Escalate to incident response | C | I | **A/R** | I | I |
| Gating policy (what blocks a merge) | **A/R** | C | I | C | C |
| Monthly metrics (MTTR, SLA breach, precision) | **A/R** | I | C | – | I |

## SLAs by severity (time from ticket creation)

| Severity | Fix / mitigate | Exception allowed? |
|---|---|---|
| Critical | 7 days (secrets: contain in 1 h, rotate in 24 h) | CISO delegate only, max 30 days |
| High | 30 days | Eng. manager + AppSec, max 90 days |
| Medium | 90 days | Eng. manager |
| Low | Best effort / backlog | – |

n8n sets the Jira due date from this table at ticket creation.

## Handoff contract (AppSec → SecOps)

SecOps receives a finding only when it's **Critical and confirmed actionable**: a high-confidence rule, or a human-triaged finding. Each event carries owner, tier, exposure, a runbook link and a dedupe key, so SOC never has to read SARIF. Everything else stays in Jira with the dev team. This mirrors detection engineering: AppSec tunes the "detections", SOC handles the "alerts".

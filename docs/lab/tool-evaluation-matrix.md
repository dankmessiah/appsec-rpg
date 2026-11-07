# Tool evaluation matrix

How the lab's tools were chosen, and how the same criteria would score commercial options in a real program. Lab scores come from running each tool on `appsec-rpg` and Juice Shop; scores for tools not run in the lab are marked *(desk)* and need a bake-off before any purchase.

## Criteria and weights

| Criterion | Weight | What "5" looks like |
|---|---|---|
| Signal (precision on our code) | 25 % | ≥ 90 % TP after light tuning on the calibration target |
| Developer experience | 20 % | Findings in the PR, clear fix guidance, easy inline suppression |
| Speed | 15 % | Fits a < 5 min PR pipeline, diff-aware scans |
| Coverage | 15 % | Our languages, frameworks, package managers, IaC |
| Integration / automation | 15 % | SARIF/JSON output, API, works with our SOAR + Jira + SIEM |
| Cost and operability | 10 % | Free, or predictable per-dev pricing; low maintenance |

## SAST

| Tool | Signal | DevEx | Speed | Coverage | Integration | Cost/ops | Weighted | Notes |
|---|---|---|---|---|---|---|---|---|
| Semgrep CE (lab) | 3 | 4 | 5 | 4 | 5 | 5 | **4.15** | 43 % precision raw on Juice Shop, 68 % after two tuning actions; custom rules in an hour; ~15 s on this repo. No cross-file data flow in CE. |
| CodeQL (lab) | 4 | 4 | 3 | 4 | 5 | 4 (free on public) | **4.00** | Data-flow analysis catches what pattern rules miss; slower; GHAS licence for private repos. |
| Semgrep AppSec Platform *(desk)* | 4 | 5 | 5 | 4 | 5 | 3 | 4.40 | Adds cross-file data flow, AI triage, dashboards. Per-dev pricing. |
| Snyk Code *(desk)* | 4 | 5 | 4 | 4 | 4 | 3 | 4.10 | Strong IDE plugin; bundles with SCA. |
| Checkmarx / Veracode *(desk)* | 3 | 2 | 2 | 5 | 4 | 2 | 3.00 | Broad language coverage and compliance reporting; heavier, slower scans. |

## SCA, containers and IaC

| Tool | Signal | DevEx | Speed | Coverage | Integration | Cost/ops | Weighted | Notes |
|---|---|---|---|---|---|---|---|---|
| Trivy (lab) | 4 | 3 | 5 | 5 | 5 | 5 | **4.35** | One binary for npm CVEs, image, IaC, SBOM. Pin by SHA: trivy-action tags were hijacked in March 2026. |
| Dependabot (lab) | 4 | 5 | 5 | 4 | 3 | 5 | **4.30** | Auto-fix PRs; alerts via API; no reachability analysis. |
| Snyk Open Source / Endor Labs *(desk)* | 5 | 4 | 4 | 4 | 4 | 2 | 4.05 | Reachability analysis cuts noise sharply; priced per dev. |

## Secrets

| Tool | Signal | DevEx | Speed | Coverage | Integration | Cost/ops | Weighted | Notes |
|---|---|---|---|---|---|---|---|---|
| GitHub push protection (lab) | 5 | 5 | 5 | 3 | 4 | 5 (public) | **4.55** | Prevents rather than detects. Only provider-partner patterns by default. |
| Gitleaks (lab) | 4 | 3 | 5 | 4 | 5 | 5 | **4.20** | Generic + custom patterns; full-history scans in seconds; SARIF. |
| TruffleHog *(desk)* | 5 | 3 | 4 | 4 | 4 | 4 | 4.05 | Verifies live credentials, a big precision win for triage. |

## DAST

| Tool | Signal | DevEx | Speed | Coverage | Integration | Cost/ops | Weighted | Notes |
|---|---|---|---|---|---|---|---|---|
| ZAP (lab) | 3 | 2 | 3 | 4 | 5 | 5 | **3.45** | Automation Framework YAML, OpenAPI import, authenticated scans with header injection; needs tuning (rules.tsv). |
| Burp Suite DAST *(desk)* | 4 | 3 | 3 | 5 | 4 | 2 | 3.60 | Best crawler and auth handling; per-site pricing. |
| StackHawk *(desk)* | 4 | 4 | 4 | 4 | 4 | 3 | 3.90 | ZAP-based, CI-first, good API scanning. |

Weighted = Σ(score × weight). Scores are 1–5.

## Recommendation (for a team starting from zero)

Start with the open-source stack proven in this lab: Semgrep CE + CodeQL + Trivy + Gitleaks + push protection + ZAP, orchestrated by the SOAR layer. It's free, fast, and the outputs are SARIF/JSON, so routing is tool-agnostic. Re-evaluate at day 90 with real precision and MTTR data. The likely first purchase is a **reachability-aware SCA** or **Semgrep's paid tier** (cross-file data flow), whichever the metrics say is the bigger noise or miss source.

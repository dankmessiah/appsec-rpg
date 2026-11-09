# Glossary content provenance

The game uses the locally supplied **AppSec Must-Know Areas & Glossary**, dated November 4, 2026. The seven glossary sections are on pages 3 through 20. Pages 1 through 3 also list the must-know areas, which are interview topics rather than glossary entries. The 25 drill prompts are on pages 20 and 21.

| Section | Source pages | Term rows |
| --- | --- | ---: |
| Testing types and tooling | 3 to 6 | 32 |
| Vulnerability classes | 6 to 9 | 29 |
| Web, auth and identity fundamentals | 9 to 11 | 24 |
| Standards and frameworks | 12 to 14 | 19 |
| Risk scoring and prioritization | 14 to 15 | 18 |
| Supply chain and CI/CD security | 16 to 17 | 22 |
| Program and process | 17 to 20 | 29 |
| Total | | 173 |

Each source table row produces one term in source order. Combined glossary labels such as IDOR / BOLA stay together. Line breaks and spacing are normalized. Vulnerability class entries retain both their descriptions and primary fixes; the NoSQL / LDAP description spells out the SQL injection comparison so it can stand alone. Aliases expand acronyms or accept familiar forms of the labels. Scenario prompts are examples based on the descriptions and are separate from the source definitions.

The 25 drill prompts retain source order and map to 44 distinct glossary rows:

| Drill prompt | Term IDs |
| --- | --- |
| SAST vs DAST | `sast`, `dast` |
| SCA and reachability | `sca`, `reachability-analysis` |
| IAST vs RASP | `iast`, `rasp` |
| False positive vs false negative | `true-false-positive`, `false-negative` |
| Taint analysis | `taint-analysis`, `source-sink-sanitizer` |
| SARIF | `sarif` |
| Authenticated DAST | `authenticated-scan` |
| OWASP Top 10:2025 | `owasp-top-10-2025` |
| BOLA / IDOR | `idor-bola` |
| SQL injection | `sql-injection` |
| XSS | `xss` |
| SSRF | `ssrf` |
| Insecure deserialization | `insecure-deserialization` |
| CVSS vs EPSS vs KEV | `cvss`, `epss`, `cisa-kev` |
| Risk tiering | `asset-criticality-risk-tier` |
| Baseline and new-code policy | `baseline`, `new-code-policy` |
| Virtual patching | `virtual-patching` |
| Remediation SLA and risk acceptance | `remediation-sla`, `risk-acceptance-exception` |
| Security champions | `security-champion` |
| SBOM and VEX | `sbom`, `vex` |
| SHA pinning and OIDC for CI | `sha-pinning`, `oidc-federation-for-ci`, `openid-connect` |
| Secrets: push protection and rotation | `push-protection`, `hardcoded-secrets` |
| Threat modeling and STRIDE | `threat-modeling`, `stride` |
| ASVS vs SAMM vs SSDF | `owasp-asvs-5-0`, `owasp-samm-v2`, `nist-ssdf` |
| Program metrics | `coverage`, `mttr`, `remediation-sla`, `fix-rate`, `escape-rate` |

The testing section's combined True / false positive row supplies the false-positive component. Taint analysis also drills its source, sink and sanitizer vocabulary. The CI federation prompt includes OpenID Connect from the identity section so that section has a source-backed boss term. The source explains rotation in its hardcoded-secrets row and SLA adherence through remediation SLAs; there are no separate glossary rows for either. Membership is reciprocal and serves as the source for the derived `is_top25` flag.

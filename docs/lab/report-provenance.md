# Security report provenance

The GitHub-hosted `security` workflow publishes one attempt-scoped ZIP per report producer and a separate index per requested attempt. The Security tab uploads and required gate keep their existing checks. This format supports private forwarding without guessing provenance from artifact timestamps or rerun job rows.

## Producer ZIP

Names use `report-v1-<role>-a<producer-attempt>`. Each ZIP includes only its present allowlisted reports and, when provenance is verified, `manifest.json`. A missing Trivy sibling is omitted from the manifest. A metadata failure leaves staged raw reports available in the archive and fails the producer step with a fixed category. Such an archive has no manifest and cannot establish provenance for forwarding. GitHub supplies the external ZIP digest separately.

| Role | Producer job | Report files |
|---|---|---|
| `sarif-semgrep` | `semgrep` | `semgrep.sarif` |
| `sarif-gitleaks` | `gitleaks` | `gitleaks.sarif` |
| `sarif-codeql` | `codeql` | `javascript.sarif` |
| `sarif-trivy` | `trivy` | `trivy-fs.sarif`, `trivy-config.sarif` |
| `sarif-trivy-image` | `container` | `trivy-image.sarif` |
| `zap-baseline` | `dast-baseline` | `report_json.json` |

Example manifest with synthetic run, job, SHA and digest values. The source SHA identifies the PR head or push commit. The checkout SHA identifies what the scanner inspected and can differ for CodeQL and ZAP on PRs. Hashes are lowercase SHA-256 without a prefix.

```json
{
  "version": 1,
  "role": "sarif-codeql",
  "source": {
    "repository_id": 1449695975,
    "head_repository_id": 1449695975,
    "workflow_id": 410637354,
    "path": ".github/workflows/security.yml",
    "run_id": 1234,
    "event": "pull_request",
    "branch": "lab/example",
    "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "producer": {
    "job_name": "codeql",
    "job_id": 5678,
    "attempt": 1,
    "checkout_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "reports": [
    {
      "path": "javascript.sarif",
      "size": 32,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  ]
}
```

## Attempt index and gate

The downstream `report-index` job publishes `report-index-v1-a<requested-attempt>` with one file, `index.json`. Its keys are `version`, `source` with the same fields as the manifest, `requested_attempt`, `index_job_id` and `reports`. The six entries use `role`, `producer_job`, `producer_result` and `artifact_id`. Example entries from an index for requested attempt 2:

```json
[
  {"role":"sarif-codeql","producer_job":"codeql","producer_result":"success","artifact_id":9012},
  {"role":"zap-baseline","producer_job":"dast-baseline","producer_result":"skipped","artifact_id":null}
]
```

The index takes IDs from GitHub job outputs even when another producer fails. In a partial rerun it can retain a prior producer's ID. The embedded manifest continues to identify the original producer attempt. Consumers should verify the requested index, archive digest, producer manifest and individual report hashes. An absent or invalid report is incomplete evidence.

The gate downloads its existing inputs by exact artifact ID into its stable local paths. Its paired Trivy comparison reports remain in separate archives. The SBOM and ZAP diagnostic archives have attempt-scoped names and are excluded from the report index.

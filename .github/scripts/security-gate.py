"""Evaluate PR-scoped security evidence without printing raw scanner messages."""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen


class EvidenceError(Exception):
    """A required scan or enrichment source could not be evaluated."""


CVE = re.compile(r"CVE-\d{4}-\d{4,}")
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
EPSS_URL = "https://api.first.org/data/v1/epss"


def reject_constant(_):
    raise ValueError("invalid JSON numeric constant")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=reject_constant)
    except (OSError, UnicodeError, ValueError) as error:
        raise EvidenceError(f"Missing or invalid report {path.name}") from error


def expect_list(value, label):
    if not isinstance(value, list):
        raise EvidenceError(f"Invalid {label} array")
    return value


def expect_object(value, label):
    if not isinstance(value, dict):
        raise EvidenceError(f"Invalid {label} object")
    return value


def required_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise EvidenceError(f"Missing or invalid {label}")
    return value


def sarif_runs(doc, tool):
    if not isinstance(doc, dict) or doc.get("version") != "2.1.0":
        raise EvidenceError(f"Invalid {tool} SARIF version")
    runs = expect_list(doc.get("runs"), f"{tool} runs")
    if not runs:
        raise EvidenceError(f"No {tool} SARIF runs")
    for run in runs:
        expect_object(run, f"{tool} run")
        component = expect_object(run.get("tool"), f"{tool} tool")
        driver = expect_object(component.get("driver"), f"{tool} driver")
        if driver.get("name") != tool:
            raise EvidenceError(f"Unexpected SARIF driver for {tool}")
        for result in expect_list(run.get("results", []), f"{tool} results"):
            expect_object(result, f"{tool} result")
            required_string(result.get("ruleId"), f"{tool} result rule ID")
    return runs


def load_rules(path):
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError) as error:
        raise EvidenceError("Cannot read gate rule allowlist") from error
    rules = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 2 or fields[1] not in {"error", "any"} or fields[0] in rules:
            raise EvidenceError("Invalid or duplicate gate rule allowlist entry")
        rules[fields[0]] = fields[1]
    if not rules:
        raise EvidenceError("Empty gate rule allowlist")
    return rules


def semgrep_findings(doc, allowlist):
    hits = []
    for run in sarif_runs(doc, "Semgrep OSS"):
        defaults = {}
        for rule in expect_list(run["tool"]["driver"].get("rules", []), "Semgrep rules"):
            expect_object(rule, "Semgrep rule")
            rule_id = required_string(rule.get("id"), "Semgrep rule ID")
            config = expect_object(rule.get("defaultConfiguration", {}), "Semgrep rule configuration")
            defaults[rule_id] = config.get("level")
        for result in run.get("results", []):
            rule_id = result["ruleId"]
            threshold = allowlist.get(rule_id)
            if threshold is None:
                continue
            level = result.get("level", defaults.get(rule_id))
            if threshold == "error" and level not in {"error", "warning", "note", "none"}:
                raise EvidenceError(f"Cannot determine Semgrep severity for {rule_id}")
            if threshold == "any" or level == "error":
                hits.append(("Semgrep", rule_id, ""))
    return hits


def secret_findings(doc):
    return [("Gitleaks", result["ruleId"], "") for run in sarif_runs(doc, "gitleaks")
            for result in run.get("results", [])]


def trivy_findings(doc, kind):
    expect_object(doc, "Trivy report")
    # Trivy classifies the primary checkout as a repository and a linked
    # worktree with a .git pointer file as a filesystem.
    artifact_types = {"filesystem": ("repository", "filesystem"), "container_image": ("container_image",)}
    if doc.get("SchemaVersion") != 2 or doc.get("ArtifactType") not in artifact_types.get(kind, ()):
        raise EvidenceError(f"Invalid Trivy {kind} report")
    required_string(doc.get("ArtifactName"), "Trivy artifact name")
    findings = []
    for entry in expect_list(doc.get("Results", []), "Trivy results"):
        expect_object(entry, "Trivy result")
        ecosystem = required_string(entry.get("Type"), "Trivy result type")
        target = required_string(entry.get("Target"), "Trivy result target")
        if kind == "container_image" and entry.get("Class") == "os-pkgs":
            target = "image OS"
        for finding in expect_list(entry.get("Vulnerabilities", []), "Trivy vulnerabilities"):
            expect_object(finding, "Trivy vulnerability")
            vuln = required_string(finding.get("VulnerabilityID"), "Trivy vulnerability ID")
            package = required_string(finding.get("PkgName"), "Trivy package name")
            severity = required_string(finding.get("Severity"), "Trivy severity")
            if severity not in {"UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"}:
                raise EvidenceError("Invalid Trivy severity")
            path = finding.get("PkgPath") or ""
            if not isinstance(path, str):
                raise EvidenceError("Invalid Trivy package path")
            fixed = finding.get("FixedVersion", "")
            if not isinstance(fixed, str):
                raise EvidenceError("Invalid Trivy fixed version")
            # Names preserve scopes, group IDs and qualifiers reported by Trivy. Keep
            # the stable package path to distinguish separate copies in one image.
            key = (vuln, ecosystem, target, path.replace("\\", "/"), package)
            findings.append((key, severity, fixed))
    return findings


def new_critical(head, base, kind):
    missing_image = kind == "container_image" and base == {"baseline": "no-dockerfile"}
    before = set() if missing_image else {key for key, _, _ in trivy_findings(base, kind)}
    source = "Trivy image" if kind == "container_image" else "Trivy fs"
    candidates = {}
    for key, severity, fixed in trivy_findings(head, kind):
        vuln, _, target, path, package = key
        if key not in before and severity == "CRITICAL" and fixed.strip() and CVE.fullmatch(vuln):
            detail = f"{package} in {path or target}"
            candidates[key] = (source, vuln, detail)
    return list(candidates.values())


def fetch_json(url, label):
    for attempt in range(2):
        try:
            with urlopen(url, timeout=10) as response:
                return json.load(response, parse_constant=reject_constant)
        except (OSError, URLError, UnicodeError, ValueError):
            if attempt == 0:
                time.sleep(1)
    raise EvidenceError(f"{label} unavailable or invalid after retry")


def get_kev():
    body = expect_object(fetch_json(KEV_URL, "CISA KEV"), "CISA KEV feed")
    entries = expect_list(body.get("vulnerabilities"), "CISA KEV vulnerabilities")
    if not entries or body.get("count") != len(entries):
        raise EvidenceError("Incomplete CISA KEV catalog")
    ids = set()
    for entry in entries:
        cve = expect_object(entry, "CISA KEV entry").get("cveID")
        if not isinstance(cve, str) or not CVE.fullmatch(cve) or cve in ids:
            raise EvidenceError("Invalid CISA KEV CVE ID")
        ids.add(cve)
    return ids


def parse_epss(body):
    scores = {}
    body = expect_object(body, "FIRST EPSS feed")
    if body.get("status", "OK") != "OK":
        raise EvidenceError("FIRST EPSS reported an error")
    entries = expect_list(body.get("data"), "FIRST EPSS scores")
    for row in entries:
        expect_object(row, "FIRST EPSS entry")
        cve, value = row.get("cve"), row.get("epss")
        if not isinstance(cve, str) or not CVE.fullmatch(cve) or cve in scores:
            raise EvidenceError("Invalid FIRST EPSS CVE ID")
        try:
            if isinstance(value, bool):
                raise ValueError
            score = float(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise EvidenceError("Invalid FIRST EPSS score") from error
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise EvidenceError("Invalid FIRST EPSS score")
        scores[cve] = score
    return scores


def get_epss(cves):
    scores = {}
    ids = sorted(cves)
    for offset in range(0, len(ids), 50):
        batch = ids[offset:offset + 50]
        url = f"{EPSS_URL}?{urlencode({'cve': ','.join(batch), 'limit': len(batch)})}"
        response = parse_epss(fetch_json(url, "FIRST EPSS"))
        if not response.keys() <= set(batch):
            raise EvidenceError("FIRST EPSS returned unexpected CVEs")
        scores.update(response)
    return scores


def enrich(candidates, kev_source=get_kev, epss_source=get_epss):
    if not candidates:
        return [], []
    cves = {candidate[1] for candidate in candidates}
    problems = []
    kev = None
    try:
        kev = kev_source()
    except EvidenceError as error:
        problems.append(str(error))
    pending = cves - (kev or set())
    epss = {}
    if pending:
        try:
            epss = epss_source(pending)
        except EvidenceError as error:
            problems.append(str(error))
    exploitable = (kev or set()) | {cve for cve, score in epss.items() if score >= 0.1}
    unresolved = (cves - exploitable) if kev is None else pending - epss.keys()
    if unresolved:
        preview = ", ".join(sorted(unresolved)[:10])
        problems.append(f"Exploitability unknown for {len(unresolved)} candidate CVE(s): {preview}")
    else:
        problems = []
    return [hit for hit in candidates if hit[1] in exploitable], problems


def check_jobs(needs):
    expect_object(needs, "job results")

    def require(job, expected):
        result = expect_object(needs.get(job), f"{job} job result").get("result")
        if result != expected:
            raise EvidenceError(f"Expected {job} to be {expected}; received {result or 'missing'}")

    require("detect", "success")
    flags = expect_object(needs["detect"].get("outputs"), "detect outputs")
    if flags.get("js") not in {"true", "false"} or flags.get("dockerfile") not in {"true", "false"}:
        raise EvidenceError("Missing or invalid scan detection flags")
    for job in ("semgrep", "gitleaks", "trivy"):
        require(job, "success")
    javascript = flags["js"] == "true"
    dockerfile = flags["dockerfile"] == "true"
    require("codeql", "success" if javascript else "skipped")
    require("container", "success" if dockerfile else "skipped")
    return javascript, dockerfile


FROM = re.compile(r"^(\s*FROM\s+)([^\s]+)(\s+AS\s+([\w.-]+))?(\s*)$", re.IGNORECASE)
IMAGE_REF = re.compile(r"[a-zA-Z0-9_./:@-]+")
EXTERNAL_COPY = re.compile(r"^\s*COPY\s+.*?--from=([^\s]+)", re.IGNORECASE)


def pin_dockerfiles(sources, resolve):
    """Pin each shared literal external FROM reference once for this build pair."""
    pinned = {}
    outputs = []
    for source in sources:
        stages = set()
        output = []
        for line in source.splitlines():
            if re.match(r"^\s*FROM\b", line, re.IGNORECASE):
                match = FROM.fullmatch(line)
                if not match or not IMAGE_REF.fullmatch(match[2]):
                    raise EvidenceError("Unsupported Dockerfile FROM in comparison build")
                ref = match[2]
                if ref.lower() not in stages and ref.lower() != "scratch" and "@sha256:" not in ref:
                    if ref not in pinned:
                        pinned[ref] = resolve(ref)
                    line = match[1] + pinned[ref] + (match[3] or "") + match[5]
                if match[4]:
                    stages.add(match[4].lower())
            copy = EXTERNAL_COPY.match(line)
            if copy and copy[1].lower() not in stages and not copy[1].isdigit():
                raise EvidenceError("Unsupported external COPY image in comparison build")
            output.append(line)
        if not any(FROM.fullmatch(line) for line in output):
            raise EvidenceError("Comparison Dockerfile contains no recognized FROM")
        outputs.append("\n".join(output) + "\n")
    return outputs


def resolve_image(ref):
    # Resolve the official registry manifest once before either Docker build.
    try:
        resolved = subprocess.run(
            ["docker", "buildx", "imagetools", "inspect", "--format", "{{ .Manifest.Digest }}", ref],
            check=True, capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise EvidenceError("Could not resolve Docker base image digest") from error
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", resolved):
        raise EvidenceError("Invalid Docker base image digest")
    return f"{ref}@{resolved}"


def safe_cell(value):
    value = " ".join(value.split())[:180]
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;").replace("`", "&#96;")


def evaluate(root, rules_path, needs):
    javascript, dockerfile = check_jobs(needs)
    hits = semgrep_findings(read_json(root / "sarif-semgrep/semgrep.sarif"), load_rules(rules_path))
    hits += secret_findings(read_json(root / "sarif-gitleaks/gitleaks.sarif"))
    if javascript:
        reports = list((root / "sarif-codeql").glob("*.sarif"))
        if not reports:
            raise EvidenceError("Missing CodeQL SARIF")
        for report in reports:
            sarif_runs(read_json(report), "CodeQL")
    candidates = []
    targets = [("gate-trivy-fs", "filesystem")]
    if dockerfile:
        targets.append(("gate-trivy-image", "container_image"))
    for artifact, kind in targets:
        head = read_json(root / artifact / "head.json")
        base = read_json(root / artifact / "base.json")
        candidates.extend(new_critical(head, base, kind))
    blockers, problems = enrich(candidates)
    return hits + blockers, problems


def emit(hits, problems):
    lines = ["### PR security gate", ""]
    if hits:
        lines.extend(["| Scanner | Rule or CVE | Package |", "|---|---|---|"])
        lines.extend("| " + " | ".join(map(safe_cell, hit)) + " |" for hit in hits)
        lines.append("")
    if problems:
        lines.append("Required scan evidence is incomplete.")
        lines.extend("- " + safe_cell(problem) for problem in problems)
    elif not hits:
        lines.append("No new blocking findings. CodeQL new alerts are evaluated by the repository ruleset.")
    output = "\n".join(lines) + "\n"
    print(output)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(output)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check-jobs")
    evaluate_cmd = commands.add_parser("evaluate")
    evaluate_cmd.add_argument("artifacts", type=Path)
    evaluate_cmd.add_argument("rules", type=Path)
    pin_cmd = commands.add_parser("pin-dockerfiles")
    pin_cmd.add_argument("paths", nargs="+", type=Path, metavar="SOURCE_OR_OUTPUT")
    args = parser.parse_args()
    try:
        if args.command == "pin-dockerfiles":
            if len(args.paths) not in {2, 4}:
                raise EvidenceError("Expected one or two Dockerfile source/output pairs")
            inputs = [path.read_text(encoding="utf-8-sig") for path in args.paths[::2]]
            for path, output in zip(args.paths[1::2], pin_dockerfiles(inputs, resolve_image)):
                path.write_text(output, encoding="utf-8")
            return 0
        try:
            needs = json.loads(os.environ.get("NEEDS_JSON", ""))
        except ValueError as error:
            raise EvidenceError("Invalid upstream job results") from error
        if args.command == "check-jobs":
            check_jobs(needs)
            return 0
        hits, problems = evaluate(args.artifacts, args.rules, needs)
        emit(hits, problems)
        return int(bool(hits or problems))
    except EvidenceError as error:
        emit([], [str(error)])
        return 1


if __name__ == "__main__":
    sys.exit(main())

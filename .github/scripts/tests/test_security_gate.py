import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

SCRIPT = Path(__file__).resolve().parents[1] / "security-gate.py"
spec = importlib.util.spec_from_file_location("security_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def sarif(tool, results=None, rules=None, extensions=None):
    return {
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {"name": tool, "rules": rules or []}, "extensions": extensions or []},
            "results": results or [],
        }],
    }


def trivy(target, package="example", cve="CVE-2026-10000", **fields):
    finding = {
        "VulnerabilityID": cve, "PkgName": package, "InstalledVersion": "1.0",
        "FixedVersion": "2.0", "Severity": "CRITICAL", **fields,
    }
    return {"Target": target, "Type": "npm", "Class": "lang-pkgs", "Vulnerabilities": [finding]}


def report(*results, kind="repository"):
    return {"SchemaVersion": 2, "ArtifactName": ".", "ArtifactType": kind, "Results": list(results)}


class GateTests(unittest.TestCase):
    def test_missing_invalid_and_valid_empty_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.sarif"
            with self.assertRaises(gate.EvidenceError):
                gate.read_json(path)
            for malformed in ("{", '{"version":NaN}'):
                path.write_text(malformed, encoding="utf-8")
                with self.assertRaises(gate.EvidenceError):
                    gate.read_json(path)
            path.write_text(json.dumps(sarif("gitleaks")), encoding="utf-8")
            self.assertEqual(gate.secret_findings(gate.read_json(path)), [])
        with self.assertRaises(gate.EvidenceError):
            gate.secret_findings({"runs": []})
        with self.assertRaises(gate.EvidenceError):
            gate.secret_findings(sarif("CodeQL"))

    def test_semgrep_exact_id_and_effective_severity(self):
        rules = [
            {"id": "trusted-rule", "defaultConfiguration": {"level": "error"}},
            {"id": "warn-rule", "defaultConfiguration": {"level": "warning"}},
        ]
        results = [
            {"ruleId": "trusted-rule"}, {"ruleId": "trusted-rule", "level": "warning"},
            {"ruleId": "warn-rule"}, {"ruleId": "warn-rule", "level": "error"},
            {"ruleId": "malicious.trusted-rule", "level": "error"},
            {"ruleId": "battle-route-missing-owner-check", "level": "error"},
            {"ruleId": "local-sql-rule"},
        ]
        hits = gate.semgrep_findings(sarif("Semgrep OSS", results, rules),
                                    {"trusted-rule": "error", "warn-rule": "error", "local-sql-rule": "any"})
        self.assertEqual([hit[1] for hit in hits], ["trusted-rule", "warn-rule", "local-sql-rule"])

    def test_gitleaks_uses_only_scoped_findings_and_discards_messages(self):
        hit = {"ruleId": "example-token", "message": {"text": "unmistakably fake secret text"}}
        result = gate.secret_findings(sarif("gitleaks", [hit]))
        self.assertEqual(result, [("Gitleaks", "example-token", "")])

    def test_codeql_extensions_are_accepted_but_never_evaluated_as_new(self):
        doc = sarif("CodeQL", [{"ruleId": "js/code-injection"}], extensions=[
            {"name": "javascript", "rules": [{"id": "js/code-injection", "properties": {"security-severity": "9.3"}}]}
        ])
        self.assertEqual(len(gate.sarif_runs(doc, "CodeQL")), 1)

    def test_trivy_identity_survives_version_and_line_changes_but_keeps_targets(self):
        old = report(trivy("one/package-lock.json", PkgIdentifier={"PURL": "pkg:npm/example@1.0"},
                           PkgLocations=[{"StartLine": 4}]))
        head = report(
            trivy("one/package-lock.json", InstalledVersion="1.1", PkgIdentifier={"PURL": "pkg:npm/example@1.1"},
                  PkgLocations=[{"StartLine": 50}]),
            trivy("two/package-lock.json", PkgIdentifier={"PURL": "pkg:npm/example@1.1"}),
            trivy("two/package-lock.json", package="another"),
        )
        self.assertEqual(len(gate.new_critical(head, old, "filesystem")), 2)

    def test_trivy_os_image_labels_and_npm_paths(self):
        old_os = trivy("base:tag (alpine 3.24.1)", package="zlib")
        head_os = trivy("head:tag (alpine 3.24.2)", package="zlib")
        for entry in (old_os, head_os):
            entry.update(Type="alpine", Class="os-pkgs")
        head = report(head_os, trivy("Node.js", PkgPath="usr/local/npm/node_modules/example/package.json"),
                      trivy("Node.js", PkgPath="app/node_modules/example/package.json"), kind="container_image")
        old = report(old_os, trivy("Node.js", PkgPath="usr/local/npm/node_modules/example/package.json"),
                     kind="container_image")
        self.assertEqual(len(gate.new_critical(head, old, "container_image")), 1)

    def test_trivy_rejects_noncritical_unfixed_and_unexpected_absence(self):
        head = report(trivy("one", FixedVersion=""), trivy("two", Severity="HIGH"))
        self.assertEqual(gate.new_critical(head, report(), "filesystem"), [])
        with self.assertRaises(gate.EvidenceError):
            gate.new_critical(head, {"baseline": "no-dockerfile"}, "filesystem")
        with self.assertRaises(gate.EvidenceError):
            gate.new_critical(head, {}, "filesystem")
        with self.assertRaises(gate.EvidenceError):
            gate.new_critical(head, report(kind="unexpected"), "filesystem")
        with self.assertRaises(gate.EvidenceError):
            gate.new_critical(head, report(kind="container_image"), "filesystem")
        with self.assertRaises(gate.EvidenceError):
            gate.new_critical(head, report(kind="filesystem"), "container_image")
        image = report(trivy("Node.js"), kind="container_image")
        self.assertEqual(len(gate.new_critical(image, {"baseline": "no-dockerfile"}, "container_image")), 1)

    def test_kev_and_epss_threshold_and_unknown(self):
        candidates = [
            ("Trivy fs", "CVE-2026-10000", "a"),
            ("Trivy fs", "CVE-2026-10001", "b"),
            ("Trivy fs", "CVE-2026-10002", "c"),
            ("Trivy fs", "CVE-2026-10003", "d"),
        ]
        kev = Mock(return_value={"CVE-2026-10000"})
        epss = Mock(return_value={"CVE-2026-10001": 0.1, "CVE-2026-10002": 0.0999})
        blocks, problems = gate.enrich(candidates, kev, epss)
        self.assertEqual(blocks, candidates[:2])
        self.assertIn("CVE-2026-10003", problems[0])
        epss.assert_called_once_with({"CVE-2026-10001", "CVE-2026-10002", "CVE-2026-10003"})
        unused = Mock(side_effect=AssertionError("EPSS should not run"))
        self.assertEqual(gate.enrich(candidates[:1], kev, unused), (candidates[:1], []))

    def test_enrichment_outage_and_malformed_scores(self):
        unavailable = Mock(side_effect=gate.EvidenceError("EPSS unavailable"))
        hit = ("Trivy fs", "CVE-2026-10000", "a")
        blocks, problems = gate.enrich([hit], lambda: set(), unavailable)
        self.assertEqual(blocks, [])
        self.assertIn("EPSS unavailable", problems[0])
        for score in ("NaN", "Infinity", -0.1, 1.1, True, ""):
            with self.subTest(score=score), self.assertRaises(gate.EvidenceError):
                gate.parse_epss({"data": [{"cve": hit[1], "epss": score}]})

    def test_upstream_expected_skip_and_failure(self):
        needs = {job: {"result": "success"} for job in
                 ("detect", "semgrep", "gitleaks", "trivy", "container", "codeql")}
        needs["detect"]["outputs"] = {"js": "true", "dockerfile": "false"}
        needs["container"]["result"] = "skipped"
        self.assertEqual(gate.check_jobs(needs), (True, False))
        needs["codeql"]["result"] = "skipped"
        with self.assertRaisesRegex(gate.EvidenceError, "codeql"):
            gate.check_jobs(needs)
        needs["codeql"]["result"] = "success"
        needs["trivy"]["result"] = "failure"
        with self.assertRaisesRegex(gate.EvidenceError, "trivy"):
            gate.check_jobs(needs)

    def test_evaluate_requires_artifacts_and_delegates_codeql_newness(self):
        needs = {job: {"result": "success"} for job in
                 ("detect", "semgrep", "gitleaks", "trivy", "codeql")}
        needs["detect"]["outputs"] = {"js": "true", "dockerfile": "false"}
        needs["container"] = {"result": "skipped"}
        documents = {
            "sarif-semgrep/semgrep.sarif": sarif("Semgrep OSS"),
            "sarif-gitleaks/gitleaks.sarif": sarif("gitleaks"),
            "sarif-codeql/javascript.sarif": sarif("CodeQL", [{"ruleId": "js/code-injection"}], extensions=[
                {"name": "javascript", "rules": [
                    {"id": "js/code-injection", "properties": {"security-severity": "9.3"}}
                ]}
            ]),
            "gate-trivy-fs/head.json": report(),
            "gate-trivy-fs/base.json": report(kind="filesystem"),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, document in documents.items():
                path = root / name
                path.parent.mkdir(exist_ok=True)
                path.write_text(json.dumps(document), encoding="utf-8")
            rules = root / "gate-rules.txt"
            rules.write_text("fixture-rule error\n", encoding="utf-8")
            self.assertEqual(gate.evaluate(root, rules, needs), ([], []))
            (root / "gate-trivy-fs/base.json").unlink()
            with self.assertRaisesRegex(gate.EvidenceError, "base.json"):
                gate.evaluate(root, rules, needs)

    def test_dockerfile_pair_resolves_shared_input_once(self):
        src = "FROM example:22 AS base\nFROM base AS build\nFROM example:22 AS runtime\nCOPY --from=build /app /app\n"
        resolve = Mock(return_value="example@sha256:" + "a" * 64)
        outputs = gate.pin_dockerfiles([src, src], resolve)
        resolve.assert_called_once_with("example:22")
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[0].count("@sha256:"), 2)
        self.assertIn("FROM base AS build", outputs[0])
        with self.assertRaises(gate.EvidenceError):
            gate.pin_dockerfiles(["FROM ${BASE}\n"], resolve)

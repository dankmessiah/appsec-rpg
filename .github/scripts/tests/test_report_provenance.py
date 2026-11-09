import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("provenance", Path(__file__).parents[1] / "report-provenance.py")
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)
SHA = "a" * 40
MERGE = "b" * 40


def env(job="codeql", head_repo=1449695975):
    return {"GITHUB_RUN_ID": "1234", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": job,
            "GITHUB_REPOSITORY_ID": "1449695975", "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_HEAD_REF": "example", "SOURCE_SHA": SHA, "SOURCE_HEAD_REPO_ID": str(head_repo)}


def api(job="codeql", head_repo=1449695975, jobs=None):
    run = {"id": 1234, "run_attempt": 2, "workflow_id": 410637354, "path": ".github/workflows/security.yml",
           "event": "pull_request", "head_sha": SHA, "head_branch": "example",
           "repository": {"id": 1449695975}, "head_repository": {"id": head_repo}}
    current = {"name": job, "id": 5678, "run_id": 1234, "run_attempt": 2,
               "status": "in_progress", "head_sha": SHA}
    jobs = [current] if jobs is None else jobs
    return Mock(side_effect=[(run, ""), ({"total_count": len(jobs), "jobs": jobs}, "")])


class ReportProvenanceTests(unittest.TestCase):
    def test_manifest_preserves_bytes_hash_and_distinct_checkout_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "codeql-results/javascript.sarif"
            report.parent.mkdir()
            report.write_bytes(b"unaltered fixture\n")
            staged = root / "out"
            proof.producer("sarif-codeql", root, staged, env(), api(), lambda: MERGE)
            manifest = json.loads((staged / "manifest.json").read_bytes())
            self.assertEqual(set(manifest), {"version", "role", "source", "producer", "reports"})
            self.assertEqual(manifest["source"]["sha"], SHA)
            self.assertEqual(manifest["producer"], {"job_name": "codeql", "job_id": 5678, "attempt": 2,
                                                    "checkout_sha": MERGE})
            self.assertEqual((staged / "javascript.sarif").read_bytes(), report.read_bytes())
            self.assertEqual(manifest["reports"], [{"path": "javascript.sarif", "size": 18,
                                                    "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}])

    def test_missing_sibling_is_absent_and_metadata_failure_leaves_raw_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "trivy-config.sarif"
            report.write_bytes(b"safe fixture")
            proof.producer("sarif-trivy", root, root / "good", env("trivy"), api("trivy"), lambda: SHA)
            manifest = json.loads((root / "good/manifest.json").read_bytes())
            self.assertEqual([item["path"] for item in manifest["reports"]], ["trivy-config.sarif"])
            fail = Mock(side_effect=OSError("sensitive detail"))
            with self.assertRaisesRegex(proof.ProvenanceError, "^metadata_unavailable$"):
                proof.producer("sarif-trivy", root, root / "bad", env("trivy"), fail, lambda: SHA)
            self.assertEqual((root / "bad/trivy-config.sarif").read_bytes(), b"safe fixture")
            self.assertFalse((root / "bad/manifest.json").exists())

    def test_paths_roles_and_size_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "semgrep.sarif").mkdir()
            with self.assertRaisesRegex(proof.ProvenanceError, "report_path_invalid"):
                proof.stage_reports("sarif-semgrep", root, root / "bad")
            (root / "semgrep.sarif").rmdir()
            with (root / "semgrep.sarif").open("wb") as report:
                report.truncate(proof.MAX_REPORT + 1)
            with self.assertRaisesRegex(proof.ProvenanceError, "report_size_invalid"):
                proof.stage_reports("sarif-semgrep", root, root / "oversize")
            with self.assertRaisesRegex(proof.ProvenanceError, "role_invalid"):
                proof.stage_reports("../outside", root, root / "unsupported")

    def test_symlink_is_rejected_without_copying_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.write_bytes(b"unrelated fixture")
            try:
                (root / "semgrep.sarif").symlink_to(target)
            except OSError:
                self.skipTest("symlink creation unavailable")
            with self.assertRaisesRegex(proof.ProvenanceError, "report_path_invalid"):
                proof.stage_reports("sarif-semgrep", root, root / "out")
            self.assertEqual(list((root / "out").iterdir()), [])

    def test_fork_identity_and_bad_metadata(self):
        fork = env(head_repo=99)
        source, job, attempt = proof.metadata(fork, api(head_repo=99), "codeql")
        self.assertEqual(source["head_repository_id"], 99)
        self.assertEqual((job, attempt), (5678, 2))
        with self.assertRaisesRegex(proof.ProvenanceError, "run_identity_invalid"):
            proof.metadata(fork, api(), "codeql")
        with self.assertRaisesRegex(proof.ProvenanceError, "producer_job_unproven"):
            proof.metadata(env(), api(jobs=[]), "codeql")
        duplicate = {"name": "codeql", "id": 789, "run_id": 1234, "run_attempt": 2,
                     "head_sha": SHA, "status": "in_progress"}
        with self.assertRaisesRegex(proof.ProvenanceError, "producer_job_unproven"):
            proof.metadata(env(), api(jobs=[duplicate, dict(duplicate, id=790)]), "codeql")
        for page, link in (({"total_count": 1, "jobs": []}, ""),
                           ({"total_count": 0, "jobs": []}, '<https://evil.invalid/?page=2>; rel="next"')):
            with self.assertRaises(proof.ProvenanceError):
                proof.job_pages(Mock(return_value=(page, link)), "/fixed")

    def test_index_preserves_failure_output_and_missing_sibling(self):
        needs = {name: {"result": "success", "outputs": {}} for name in proof.INDEX_NEEDS}
        needs["semgrep"]["outputs"]["report_artifact_id"] = "100"
        needs["gitleaks"] = {"result": "failure", "outputs": {"report_artifact_id": "101"}}
        needs["dast-baseline"] = {"result": "skipped", "outputs": {}}
        rows = proof.index_reports(needs)
        self.assertIn({"role": "sarif-gitleaks", "producer_job": "gitleaks", "producer_result": "failure",
                       "artifact_id": 101}, rows)
        self.assertIn({"role": "zap-baseline", "producer_job": "dast-baseline", "producer_result": "skipped",
                       "artifact_id": None}, rows)
        needs["trivy"]["outputs"]["report_artifact_id"] = "101"
        with self.assertRaisesRegex(proof.ProvenanceError, "artifact_id_invalid"):
            proof.index_reports(needs)
        needs.pop("test")
        with self.assertRaisesRegex(proof.ProvenanceError, "index_needs_invalid"):
            proof.index_reports(needs)

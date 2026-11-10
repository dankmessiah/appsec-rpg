import importlib.util
import ast
from itertools import product
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "classify-forward-owner.py"
spec = importlib.util.spec_from_file_location("forward_owner", SCRIPT)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def event(**changes):
    run = {
        "id": 42, "run_attempt": 1, "workflow_id": 410637354, "name": "security",
        "path": ".github/workflows/security.yml", "status": "completed", "conclusion": "success",
        "created_at": "2026-11-09T07:17:00Z", "run_started_at": "2026-11-09T07:17:01Z",
        "head_repository": {"id": 1449695975, "full_name": "dankmessiah/appsec-rpg"},
        **changes,
    }
    return {"action": "completed", "repository": {"id": 1449695975, "full_name": "dankmessiah/appsec-rpg"}, "workflow_run": run}


class ForwardOwnerTests(unittest.TestCase):
    def test_unset_cutover_preserves_legacy_security_and_dast(self):
        self.assertEqual(owner.classify(event(), "")["legacy"], True)
        nightly = event(workflow_id=44, name="dast-nightly", path=".github/workflows/dast-nightly.yml")
        self.assertEqual(owner.classify(nightly, "")["legacy"], True)

    def test_epoch_boundary_is_disjoint(self):
        created = owner.created_epoch("2026-11-09T07:17:00Z")
        for delta, expected in ((-1, False), (0, False), (1, True)):
            result = owner.classify(event(), str(created + delta))
            self.assertIs(result["legacy"], expected)

    def test_pre_cutover_reruns_keep_legacy_owner_from_original_creation(self):
        payload = event(run_attempt=25, run_started_at="2026-12-01T19:10:00Z")
        cutover = owner.created_epoch("2026-11-10T00:00:00Z")
        self.assertTrue(owner.classify(payload, str(cutover))["legacy"])

    def test_public_dast_does_not_fall_into_private_security_coverage(self):
        nightly = event(workflow_id=44, name="dast-nightly", path=".github/workflows/dast-nightly.yml")
        self.assertTrue(owner.classify(nightly, "0")["legacy"])
        self.assertTrue(owner.classify(nightly, "0", "true")["legacy"])
        nightly["workflow_run"]["conclusion"] = "skipped"
        self.assertFalse(owner.classify(nightly, "0", "true")["legacy"])
        self.assertFalse(owner.classify(nightly, "0", "TRUE")["legacy"])
        self.assertTrue(owner.classify(nightly, "0", "")["legacy"])

    def test_malformed_configured_cutover_is_an_explicit_failure(self):
        for value in ("-1", "1.0", "1e9", "NaN", " 1", "1 ", "01", "+1", "true", "9999999999999", None, True):
            with self.subTest(value=value), self.assertRaises(owner.RoutingError):
                owner.classify(event(), value)

    def test_malformed_source_or_identity_fails_closed(self):
        for changes in ({"created_at": "2026-02-30T00:00:00Z"}, {"created_at": "2026-11-09"},
                        {"created_at": None}, {"id": True}, {"run_attempt": 0}, {"status": "in_progress"},
                        {"conclusion": None}, {"path": "other"}, {"workflow_id": 44},
                        {"head_repository": {"id": 7, "full_name": "dankmessiah/appsec-rpg"}}):
            with self.subTest(changes=changes), self.assertRaises(owner.RoutingError):
                owner.classify(event(**changes), "")

    def test_cancelled_source_never_enables_legacy_forwarding(self):
        self.assertFalse(owner.classify(event(conclusion="cancelled"), "")["legacy"])

    def test_both_nightly_jobs_preserve_old_conditions_until_explicit_private_activation(self):
        workflow = SCRIPT.parents[1] / "workflows" / "dast-nightly.yml"
        conditions = [line.strip()[4:] for line in workflow.read_text().splitlines() if line.startswith("    if:")]
        self.assertEqual(len(conditions), 2)

        def evaluate(node):
            if isinstance(node, ast.Expression):
                return evaluate(node.body)
            if isinstance(node, ast.Constant):
                return node.value
            if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
                return all(evaluate(child) for child in node.values)
            if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
                return any(evaluate(child) for child in node.values)
            if isinstance(node, ast.Compare) and len(node.ops) == 1:
                left, right = evaluate(node.left), evaluate(node.comparators[0])
                if isinstance(left, str) and isinstance(right, str):
                    left, right = left.lower(), right.lower()
                if isinstance(node.ops[0], ast.Eq):
                    return left == right
                if isinstance(node.ops[0], ast.NotEq):
                    return left != right
            self.fail("Unexpected nightly condition syntax")

        for condition, active, ready, staging, trigger in product(
                conditions, ("", "false", "true", "TRUE"), ("", "true"), ("", "configured"),
                ("schedule", "workflow_dispatch")):
            expression = condition.replace("always()", "True").replace("&&", " and ").replace("||", " or ")
            for name, value in {"vars.APPSEC_PRIVATE_NIGHTLY_ACTIVE": active, "vars.HOMELAB_RUNNER_READY": ready,
                                "vars.STAGING_URL": staging, "github.event_name": trigger}.items():
                expression = expression.replace(name, repr(value))
            expected = active.lower() != "true" and ready == "true" and (staging != "" or trigger == "workflow_dispatch")
            with self.subTest(active=active, ready=ready, staging=staging, trigger=trigger, condition=condition):
                self.assertEqual(evaluate(ast.parse(expression, mode="eval")), expected)

    def test_cli_emits_only_fixed_outputs_and_invalid_epoch_fails_job(self):
        with tempfile.TemporaryDirectory() as folder:
            payload = Path(folder) / "event.json"
            output = Path(folder) / "output"
            payload.write_text(json.dumps(event()), encoding="utf-8")
            env = {**os.environ, "GITHUB_EVENT_PATH": str(payload), "GITHUB_OUTPUT": str(output),
                   "APPSEC_FORWARD_CUTOVER_EPOCH": "", "APPSEC_PRIVATE_NIGHTLY_ACTIVE": ""}
            result = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_text(), "legacy=true\nreason=legacy_security\n")
            output.unlink()
            env["APPSEC_FORWARD_CUTOVER_EPOCH"] = "bad\nlegacy=true"
            result = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("::error::invalid_cutover_epoch", result.stdout)
            self.assertNotIn("bad", result.stdout)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

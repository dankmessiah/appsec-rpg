"""Classify legacy ownership without reading artifacts or contacting the LAN.

The private security poller owns source creation times at or after the configured
epoch. Earlier runs, including their reruns, remain legacy-owned. A proposed
runner-retirement prerequisite is a full 30-day pre-cutover rerun drain plus all
older in-flight work resolved. This script selects no retirement date.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys


REPOSITORY_ID = 1449695975
SECURITY_WORKFLOW_ID = 410637354
MAX_EPOCH = 253402300799
MAX_EVENT_BYTES = 1024 * 1024
CONCLUSIONS = frozenset({"success", "failure", "neutral", "cancelled", "skipped",
                         "timed_out", "action_required", "stale", "startup_failure"})


class RoutingError(ValueError):
    pass


def require(condition, category):
    if not condition:
        raise RoutingError(category)


def positive(value):
    return type(value) is int and 0 < value <= 9007199254740991


def cutover_epoch(value):
    if value == "":
        return None
    require(isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]{0,11}", value) is not None,
            "invalid_cutover_epoch")
    parsed = int(value)
    require(parsed <= MAX_EPOCH, "invalid_cutover_epoch")
    return parsed


def created_epoch(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value),
            "invalid_source_created_at")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        seconds = int(parsed.timestamp())
    except (ValueError, OverflowError, OSError):
        raise RoutingError("invalid_source_created_at") from None
    require(0 <= seconds <= MAX_EPOCH, "invalid_source_created_at")
    return seconds


def classify(payload, cutover="", private_nightly_active=""):
    epoch = cutover_epoch(cutover)
    require(isinstance(payload, dict) and payload.get("action") == "completed", "invalid_source_event")
    repo, run = payload.get("repository"), payload.get("workflow_run")
    require(isinstance(repo, dict) and repo.get("id") == REPOSITORY_ID and isinstance(repo.get("full_name"), str)
            and isinstance(run, dict), "invalid_source_identity")
    head = run.get("head_repository")
    require(isinstance(head, dict) and head.get("id") == REPOSITORY_ID
            and head.get("full_name") == repo["full_name"] and positive(run.get("id"))
            and positive(run.get("run_attempt")) and positive(run.get("workflow_id"))
            and run.get("status") == "completed" and run.get("conclusion") in CONCLUSIONS,
            "invalid_source_identity")
    created = created_epoch(run.get("created_at"))
    if run.get("name") == "security":
        require(run["workflow_id"] == SECURITY_WORKFLOW_ID and run.get("path") == ".github/workflows/security.yml",
                "invalid_source_workflow")
        legacy = epoch is None or created < epoch
        reason = "legacy_security" if legacy else "private_security"
    else:
        require(run.get("name") == "dast-nightly" and run["workflow_id"] != SECURITY_WORKFLOW_ID
                and run.get("path") == ".github/workflows/dast-nightly.yml", "invalid_source_workflow")
        # The private source poller does not cover public DAST runs. Preserve
        # older in-flight completions while avoiding an empty disabled nightly.
        disabled = isinstance(private_nightly_active, str) and private_nightly_active.lower() == "true"
        legacy = not (disabled and run["conclusion"] == "skipped")
        reason = "legacy_public_dast" if legacy else "public_nightly_disabled"
    if run["conclusion"] == "cancelled":
        return {"legacy": False, "reason": "source_cancelled"}
    return {"legacy": legacy, "reason": reason}


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "invalid_source_json")
        result[key] = value
    return result


def invalid_constant(_):
    raise RoutingError("invalid_source_json")


def main():
    try:
        with Path(os.environ["GITHUB_EVENT_PATH"]).open("rb") as event_file:
            raw = event_file.read(MAX_EVENT_BYTES + 1)
        require(len(raw) <= MAX_EVENT_BYTES, "invalid_source_json")
        payload = json.loads(raw, object_pairs_hook=unique_keys, parse_constant=invalid_constant)
        result = classify(payload, os.environ.get("APPSEC_FORWARD_CUTOVER_EPOCH", ""),
                          os.environ.get("APPSEC_PRIVATE_NIGHTLY_ACTIVE", ""))
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            output.write("legacy=" + str(result["legacy"]).lower() + "\nreason=" + result["reason"] + "\n")
        print("Forwarding owner: " + result["reason"])
        return 0
    except RoutingError as error:
        print("::error::" + str(error))
    except (KeyError, OSError, ValueError, TypeError):
        print("::error::invalid_routing_input")
    return 1


if __name__ == "__main__":
    sys.exit(main())

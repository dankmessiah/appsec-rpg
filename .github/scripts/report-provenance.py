"""Stage bounded scanner reports and describe their workflow provenance."""

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


REPO_ID = 1449695975
WORKFLOW_ID = 410637354
WORKFLOW_PATH = ".github/workflows/security.yml"
API_ROOT = "https://api.github.com/repos/dankmessiah/appsec-rpg/actions/runs"
ROLES = {
    "sarif-semgrep": ("semgrep", ("semgrep.sarif",)),
    "sarif-gitleaks": ("gitleaks", ("gitleaks.sarif",)),
    "sarif-codeql": ("codeql", ("codeql-results/javascript.sarif",)),
    "sarif-trivy": ("trivy", ("trivy-fs.sarif", "trivy-config.sarif")),
    "sarif-trivy-image": ("container", ("trivy-image.sarif",)),
    "zap-baseline": ("dast-baseline", ("report_json.json",)),
}
INDEX_NEEDS = {job for job, _ in ROLES.values()} | {"detect", "gate", "test"}
SHA = re.compile(r"[0-9a-f]{40}")
MAX_REPORT = 12 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_API = 2 * 1024 * 1024
PAGE_SIZE = 100
MAX_PAGES = 5


class ProvenanceError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition, category):
    if not condition:
        raise ProvenanceError(category)


def id_value(value):
    return type(value) is int and 0 < value <= 2**53 - 1


def numeric(value, category):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,15}", value), category)
    number = int(value)
    require(id_value(number), category)
    return number


def sha_value(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def bad_constant(_):
    raise ValueError


def load_json(raw, category):
    try:
        return json.loads(raw, object_pairs_hook=unique_keys, parse_constant=bad_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise ProvenanceError(category) from None


def metadata_client(token):
    opener = build_opener(NoRedirect())

    def fetch(path):
        require(isinstance(token, str) and token and token.isascii()
                and all(32 < ord(char) < 127 for char in token), "metadata_token_unavailable")
        request = Request(API_ROOT + path, headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "appsec-report-provenance",
        })
        with opener.open(request, timeout=8) as response:
            require(response.status == 200, "metadata_unavailable")
            raw = response.read(MAX_API + 1)
            require(len(raw) <= MAX_API, "metadata_response_invalid")
            return load_json(raw.decode("utf-8"), "metadata_response_invalid"), response.headers.get("Link", "")

    return fetch


def get_metadata(fetch, path):
    try:
        return fetch(path)
    except (OSError, ValueError, UnicodeError):
        raise ProvenanceError("metadata_unavailable") from None


def job_pages(fetch, path):
    items = []
    total = None
    ids = set()
    for page in range(1, MAX_PAGES + 1):
        payload, link = get_metadata(fetch, f"{path}?per_page={PAGE_SIZE}&page={page}")
        require(isinstance(payload, dict) and isinstance(link, str), "jobs_page_invalid")
        count, jobs = payload.get("total_count"), payload.get("jobs")
        require(type(count) is int and 0 <= count <= MAX_PAGES * PAGE_SIZE
                and isinstance(jobs, list) and len(jobs) <= PAGE_SIZE, "jobs_page_invalid")
        if total is None:
            total = count
        require(count == total and (page == 1 or jobs), "jobs_page_incomplete")
        for job in jobs:
            require(isinstance(job, dict) and id_value(job.get("id")) and job["id"] not in ids,
                    "jobs_page_invalid")
            ids.add(job["id"])
            items.append(job)
        links = re.findall(r'<([^>]+)>;\s*rel="next"', link)
        require(len(links) <= 1 and (links or 'rel="next"' not in link), "jobs_page_invalid")
        if not links:
            require(len(items) == total, "jobs_page_incomplete")
            return items
        try:
            target = urlsplit(links[0])
            require(target.scheme == "https" and target.netloc == "api.github.com" and not target.fragment
                    and parse_qs(target.query).get("page") == [str(page + 1)] and len(jobs) == PAGE_SIZE,
                    "jobs_page_invalid")
        except ValueError:
            raise ProvenanceError("jobs_page_invalid") from None
    raise ProvenanceError("jobs_page_incomplete")


def repo_id(run, field):
    repository = run.get(field)
    value = repository.get("id") if isinstance(repository, dict) else None
    return value if id_value(value) else None


def metadata(env, fetch, expected_job):
    run_id = numeric(env.get("GITHUB_RUN_ID"), "runner_identity_invalid")
    attempt = numeric(env.get("GITHUB_RUN_ATTEMPT"), "runner_identity_invalid")
    repository = numeric(env.get("GITHUB_REPOSITORY_ID"), "runner_identity_invalid")
    head_repository = numeric(env.get("SOURCE_HEAD_REPO_ID"), "runner_identity_invalid")
    event = env.get("GITHUB_EVENT_NAME")
    source_sha = env.get("SOURCE_SHA")
    branch = env.get("GITHUB_HEAD_REF") if event == "pull_request" else env.get("GITHUB_REF_NAME")
    require(repository == REPO_ID and env.get("GITHUB_JOB") == expected_job and sha_value(source_sha)
            and event in ("pull_request", "push", "workflow_dispatch")
            and isinstance(branch, str) and 0 < len(branch) <= 255
            and all(ord(char) > 32 and ord(char) != 127 for char in branch), "runner_identity_invalid")
    path = f"/{run_id}/attempts/{attempt}"
    run, _ = get_metadata(fetch, path)
    require(isinstance(run, dict) and id_value(run.get("id")) and run["id"] == run_id
            and id_value(run.get("run_attempt")) and run["run_attempt"] == attempt
            and run.get("workflow_id") == WORKFLOW_ID and run.get("path") == WORKFLOW_PATH
            and repo_id(run, "repository") == REPO_ID and repo_id(run, "head_repository") == head_repository
            and run.get("head_sha") == source_sha and run.get("head_branch") == branch
            and run.get("event") == event, "run_identity_invalid")
    candidates = [job for job in job_pages(fetch, path + "/jobs") if job.get("name") == expected_job]
    require(len(candidates) == 1, "producer_job_unproven")
    job = candidates[0]
    job_attempt = job.get("run_attempt", attempt)
    require(job.get("status") == "in_progress" and id_value(job.get("run_id")) and job["run_id"] == run_id
            and id_value(job_attempt) and job_attempt == attempt and job.get("head_sha") == source_sha,
            "producer_job_unproven")
    source = {
        "repository_id": REPO_ID, "head_repository_id": head_repository, "workflow_id": WORKFLOW_ID,
        "path": WORKFLOW_PATH, "run_id": run_id, "event": event, "branch": branch, "sha": source_sha,
    }
    return source, job["id"], attempt


def stage_reports(role, root, output):
    require(role in ROLES, "role_invalid")
    try:
        output.mkdir(parents=True)
    except OSError:
        raise ProvenanceError("staging_directory_unavailable") from None
    staged = []
    total = 0
    problem = None
    for relative in ROLES[role][1]:
        relative = Path(relative)
        source = root / relative
        try:
            for parent in relative.parents:
                if parent != Path("."):
                    require(stat.S_ISDIR((root / parent).lstat().st_mode), "report_path_invalid")
            info = source.lstat()
            require(stat.S_ISREG(info.st_mode), "report_path_invalid")
            require(0 <= info.st_size <= MAX_REPORT, "report_size_invalid")
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            descriptor = os.open(source, flags | getattr(os, "O_BINARY", 0))
            with os.fdopen(descriptor, "rb") as handle:
                require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "report_path_invalid")
                raw = handle.read(MAX_REPORT + 1)
            total += len(raw)
            require(len(raw) == info.st_size and len(raw) <= MAX_REPORT and total <= MAX_TOTAL,
                    "report_size_invalid")
            (output / relative.name).write_bytes(raw)
            staged.append({"path": relative.name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        except FileNotFoundError:
            continue
        except (OSError, ProvenanceError) as error:
            problem = str(error) if isinstance(error, ProvenanceError) else "report_staging_failed"
    if problem:
        raise ProvenanceError(problem)
    return staged


def write_json(path, payload):
    try:
        with path.open("x", encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=True, separators=(",", ":"))
            output.write("\n")
    except OSError:
        raise ProvenanceError("provenance_write_failed") from None


def checkout_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                              timeout=5, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        raise ProvenanceError("checkout_identity_unavailable") from None


def producer(role, root, output, env, fetch, checkout=checkout_sha):
    reports = stage_reports(role, root, output)
    job_name = ROLES[role][0]
    source, job_id, attempt = metadata(env, fetch, job_name)
    sha = checkout()
    require(sha_value(sha), "checkout_identity_invalid")
    write_json(output / "manifest.json", {
        "version": 1, "role": role, "source": source,
        "producer": {"job_name": job_name, "job_id": job_id, "attempt": attempt, "checkout_sha": sha},
        "reports": reports,
    })


def index_reports(needs):
    require(isinstance(needs, dict) and needs.keys() == INDEX_NEEDS, "index_needs_invalid")
    for record in needs.values():
        require(isinstance(record, dict) and record.get("result") in ("success", "failure", "cancelled", "skipped")
                and isinstance(record.get("outputs"), dict), "index_needs_invalid")
    reports = []
    ids = set()
    for role, (job, _) in ROLES.items():
        record = needs[job]
        output = record["outputs"].get("report_artifact_id", "")
        artifact = None if output == "" else numeric(output, "artifact_id_invalid")
        if artifact is not None:
            require(artifact not in ids, "artifact_id_invalid")
            ids.add(artifact)
        reports.append({"role": role, "producer_job": job, "producer_result": record["result"],
                        "artifact_id": artifact})
    return reports


def index(output, env, fetch):
    needs = env.get("NEEDS_JSON", "")
    require(len(needs) <= 131072, "index_needs_invalid")
    reports = index_reports(load_json(needs, "index_needs_invalid"))
    source, job_id, attempt = metadata(env, fetch, "report-index")
    write_json(output, {"version": 1, "source": source, "requested_attempt": attempt,
                        "index_job_id": job_id, "reports": reports})


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("producer")
    command.add_argument("role")
    command.add_argument("output", type=Path)
    command = commands.add_parser("index")
    command.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        env = os.environ
        fetch = metadata_client(env.get("GITHUB_TOKEN"))
        if args.command == "producer":
            producer(args.role, Path.cwd(), args.output, env, fetch)
        else:
            index(args.output, env, fetch)
    except ProvenanceError as error:
        print(str(error))
        return 1
    except Exception:
        print("provenance_unexpected_error")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

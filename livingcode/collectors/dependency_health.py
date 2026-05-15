"""Dependency health collector — npm audit, outdated, Python SDK zero-dep check."""
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from livingcode.types import DependencyHealthReport


def _run_npm(args: list[str], cwd: str) -> tuple[int, str]:
    """Run an npm command. Returns (exit_code, stdout)."""
    try:
        result = subprocess.run(
            ["npm"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        return result.returncode, result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 1, ""


def _count_python_deps(repo_path: str) -> int:
    """Count Python SDK runtime dependencies from pyproject.toml."""
    pyproject_path = Path(repo_path) / "sdk-python" / "pyproject.toml"
    if not pyproject_path.exists():
        return 0
    content = pyproject_path.read_text()
    # Simple parse: find dependencies = [...] block
    m = re.search(r"dependencies\s*=\s*\[(.*?)\]", content, re.DOTALL)
    if not m:
        return 0
    deps_block = m.group(1).strip()
    if not deps_block:
        return 0
    # Count non-empty quoted strings
    return len(re.findall(r'"[^"]+"', deps_block))


def collect_dependency_health(repo_path: str) -> DependencyHealthReport:
    """Collect dependency health metrics."""
    # Count JS dependencies from package.json
    pkg_path = Path(repo_path) / "package.json"
    js_deps = 0
    if pkg_path.exists():
        with open(pkg_path, encoding="utf-8") as f:
            pkg = json.load(f)
        js_deps = len(pkg.get("dependencies", {})) + len(pkg.get("devDependencies", {}))

    # Outdated packages
    _, outdated_output = _run_npm(["outdated", "--json"], repo_path)
    try:
        outdated_data = json.loads(outdated_output) if outdated_output.strip() else {}
    except json.JSONDecodeError:
        outdated_data = {}
    js_outdated = len(outdated_data)

    # Audit vulnerabilities
    _, audit_output = _run_npm(["audit", "--json"], repo_path)
    try:
        audit_data = json.loads(audit_output) if audit_output.strip() else {}
    except json.JSONDecodeError:
        audit_data = {}
    js_vulns = len(audit_data.get("vulnerabilities", {}))

    # Python SDK dependencies
    python_deps = _count_python_deps(repo_path)

    # Lockfile age
    lockfile = Path(repo_path) / "package-lock.json"
    lockfile_age = 0
    if lockfile.exists():
        mtime = datetime.fromtimestamp(lockfile.stat().st_mtime, tz=timezone.utc)
        age = datetime.now(timezone.utc) - mtime
        lockfile_age = age.days

    return DependencyHealthReport(
        js_dependencies=js_deps,
        js_outdated=js_outdated,
        js_vulnerabilities=js_vulns,
        python_dependencies=python_deps,
        lockfile_age_days=lockfile_age,
    )

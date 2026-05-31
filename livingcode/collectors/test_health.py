"""Test health collector — JS (Vitest) and Python (pytest) test status."""
import os
import re
import subprocess
from pathlib import Path
from livingcode.types import TestHealthReport, TestSuiteResult


def _run_command(args: list[str], cwd: str) -> tuple[int, str]:
    """Run a command, return (exit_code, combined_output)."""
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        return result.returncode, result.stdout + result.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 1, ""


def _parse_vitest_output(output: str) -> TestSuiteResult:
    """Parse Vitest console output for test counts."""
    total, passed, failed = 0, 0, 0
    # Vitest summary line, e.g.:
    #   "Tests  107 passed (107)"
    #   "Tests  3 failed | 104 passed (107)"
    #   "Tests  2178 passed | 5 skipped (2183)"      <- real output
    #   "Tests  3 failed | 104 passed | 2 skipped (109)"
    # The trailing "(total)" can be preceded by a "| N skipped" (or other)
    # segment, so allow any non-greedy run between "passed" and "(total)" rather
    # than requiring them adjacent — the old adjacency assumption silently
    # returned 0/0/0 on every run that had skipped tests.
    m = re.search(r"Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\b.*?\((\d+)\)", output)
    if m:
        failed = int(m.group(1)) if m.group(1) else 0
        passed = int(m.group(2))
        total = int(m.group(3))
    return TestSuiteResult(total=total, passed=passed, failed=failed)


def _parse_pytest_output(output: str) -> TestSuiteResult:
    """Parse pytest console output for test counts."""
    # Pattern: "12 passed in 3.45s" or "3 failed, 9 passed in 5.00s"
    passed_m = re.search(r"(\d+)\s+passed", output)
    failed_m = re.search(r"(\d+)\s+failed", output)
    passed = int(passed_m.group(1)) if passed_m else 0
    failed = int(failed_m.group(1)) if failed_m else 0
    total = passed + failed
    return TestSuiteResult(total=total, passed=passed, failed=failed)


def _count_test_files(repo_path: str) -> tuple[int, int]:
    """Count test files and source files. Returns (test_count, source_count)."""
    test_count = 0
    source_count = 0
    skip_dirs = {"node_modules", ".next", "dist", ".git", "__pycache__", ".organism"}
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            if not (f.endswith(".js") or f.endswith(".ts") or f.endswith(".py")):
                continue
            if f.endswith(".d.ts"):
                continue
            rel = os.path.relpath(os.path.join(root, f), repo_path)
            is_test = (
                "test" in f.lower()
                or "__tests__" in rel
                or "tests/" in rel.replace("\\", "/")
            )
            if is_test:
                test_count += 1
            else:
                source_count += 1
    return test_count, source_count


def _find_untested_routes(repo_path: str) -> list[str]:
    """Find API routes without corresponding test files."""
    api_dir = Path(repo_path) / "app" / "api"
    test_dir = Path(repo_path) / "__tests__" / "unit"
    if not api_dir.exists():
        return []
    untested = []
    for route_dir in api_dir.rglob("route.js"):
        rel = route_dir.parent.relative_to(api_dir)
        # Skip archived routes
        if str(rel).startswith("_archive"):
            continue
        route_name = str(rel).replace(os.sep, "/")
        has_test = False
        if test_dir.exists():
            for test_file in test_dir.rglob("*.test.js"):
                if route_name.replace("/", "-") in test_file.name or route_name.split("/")[-1] in test_file.name:
                    has_test = True
                    break
        if not has_test:
            untested.append(f"api/{rel}")
    return untested


def collect_test_health(repo_path: str) -> TestHealthReport:
    """Collect test health metrics for JS and Python test suites."""
    # JS tests (Vitest)
    js_exit, js_output = _run_command(["npm", "run", "test", "--", "--run"], repo_path)
    js_tests = _parse_vitest_output(js_output)

    # Python tests — run from repo root targeting tests/
    py_exit, py_output = _run_command(["python", "-m", "pytest", "tests/", "-q"], repo_path)
    python_tests = _parse_pytest_output(py_output)

    # File ratio
    test_count, source_count = _count_test_files(repo_path)
    total_files = test_count + source_count
    test_file_ratio = test_count / total_files if total_files > 0 else 0.0

    # Untested routes
    untested_routes = _find_untested_routes(repo_path)

    return TestHealthReport(
        js_tests=js_tests,
        python_tests=python_tests,
        test_file_ratio=test_file_ratio,
        untested_routes=untested_routes,
    )

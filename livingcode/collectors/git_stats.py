"""Git statistics collector — commit velocity, branch health, bus factor."""
import subprocess
from datetime import datetime, timezone, timedelta
from livingcode.types import GitStatsReport


def _run_git(args: list[str], repo_path: str) -> str:
    """Run a git command and return stdout. Returns empty string on error."""
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=repo_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def collect_git_stats(repo_path: str) -> GitStatsReport:
    """Collect git repository statistics."""
    # Commit counts
    commits_7d_str = _run_git(["rev-list", "--count", "--since=7.days", "HEAD"], repo_path)
    commits_7d = int(commits_7d_str) if commits_7d_str.isdigit() else 0

    commits_30d_str = _run_git(["rev-list", "--count", "--since=30.days", "HEAD"], repo_path)
    commits_30d = int(commits_30d_str) if commits_30d_str.isdigit() else 0

    # Branch health
    branches_output = _run_git(["branch", "-r"], repo_path)
    branches = [b.strip() for b in branches_output.splitlines() if b.strip() and "->" not in b]

    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(days=30)
    active_count = 0
    stale_count = 0

    for branch in branches:
        last_commit = _run_git(["log", "-1", "--format=%ci", branch], repo_path)
        if last_commit:
            try:
                # `git log --format=%ci` emits "YYYY-MM-DD HH:MM:SS ±HHMM".
                # The previous string-surgery (`replace(" -", "-")`) corrupted
                # any timezone offset that wasn't UTC by also rewriting the
                # space before the date's hyphen-day. strptime is unambiguous.
                commit_date = datetime.strptime(last_commit, "%Y-%m-%d %H:%M:%S %z")
                if commit_date > stale_threshold:
                    active_count += 1
                else:
                    stale_count += 1
            except ValueError:
                active_count += 1  # assume active if parse fails
        else:
            active_count += 1

    # Top contributors (30d)
    shortlog = _run_git(["shortlog", "-sn", "--since=30.days", "HEAD"], repo_path)
    contributors = []
    total_commits_30d = 0
    for line in shortlog.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t", 1)
        if len(parts) == 2:
            count = int(parts[0].strip())
            name = parts[1].strip()
            contributors.append({"name": name, "commits": count})
            total_commits_30d += count

    # Bus factor: how many contributors cover 80% of commits
    bus_factor = 0
    if total_commits_30d > 0:
        running = 0
        threshold = total_commits_30d * 0.8
        for c in contributors:
            running += c["commits"]
            bus_factor += 1
            if running >= threshold:
                break

    # Files changed (7d)
    diff_stat = _run_git(["diff", "--shortstat", "HEAD~14..HEAD"], repo_path)
    files_changed = 0
    if diff_stat:
        parts = diff_stat.split()
        if parts and parts[0].isdigit():
            files_changed = int(parts[0])

    return GitStatsReport(
        commits_7d=commits_7d,
        commits_30d=commits_30d,
        active_branches=active_count,
        stale_branches=stale_count,
        bus_factor=bus_factor,
        top_contributors_30d=contributors,
        files_changed_7d=files_changed,
    )

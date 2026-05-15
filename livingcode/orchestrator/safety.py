"""Safety systems — kill switch, cycle lock, failure tracking, pause."""
from pathlib import Path
from livingcode.state import read_json_file, write_json_file
from datetime import datetime, timezone

ORGANISM_DIR = ".organism"


def is_kill_switch_active(repo_path: str) -> bool:
    return (Path(repo_path) / ORGANISM_DIR / "kill-switch").exists()


def activate_kill_switch(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "kill-switch"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def deactivate_kill_switch(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "kill-switch"
    if path.exists():
        path.unlink()


STALE_LOCK_AGE_SECONDS = 600  # 10 minutes — longer than any plausible cycle


def is_cycle_locked(repo_path: str) -> bool:
    path = Path(repo_path) / ORGANISM_DIR / "active-cycle.json"
    if not path.exists():
        return False
    # Recover from a stale lock left behind by a crashed/killed cycle.
    # If the lock file is older than STALE_LOCK_AGE_SECONDS or the
    # embedded timestamp is unparseable, treat it as abandoned and
    # delete it so the next run can proceed.
    data = read_json_file(path) or {}
    started = data.get("started")
    try:
        started_at = datetime.fromisoformat(started) if started else None
    except (TypeError, ValueError):
        started_at = None
    # Normalize to timezone-aware UTC. Lock files written by a process on
    # an older Python (or where the writer dropped tzinfo) parse as naive,
    # and `now - started_at` would raise TypeError mid-cycle — silently
    # aborting the lifecycle.
    if started_at is not None and started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if started_at is None or (now - started_at).total_seconds() > STALE_LOCK_AGE_SECONDS:
        try:
            path.unlink()
        except OSError:
            # Another process may have removed it concurrently — treat as
            # unlocked; the worst case is a single duplicate cycle run.
            pass
        return False
    return True


def acquire_cycle_lock(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "active-cycle.json"
    write_json_file(path, {"started": datetime.now(timezone.utc).isoformat()})


def release_cycle_lock(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "active-cycle.json"
    if path.exists():
        path.unlink()


def get_consecutive_failures(repo_path: str) -> int:
    path = Path(repo_path) / ORGANISM_DIR / "consecutive-failures.json"
    data = read_json_file(path)
    return data.get("count", 0) if data else 0


def increment_failures(repo_path: str) -> int:
    current = get_consecutive_failures(repo_path)
    new_count = current + 1
    path = Path(repo_path) / ORGANISM_DIR / "consecutive-failures.json"
    write_json_file(path, {"count": new_count})
    if new_count >= 3:
        _set_paused(repo_path)
    return new_count


def reset_failures(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "consecutive-failures.json"
    write_json_file(path, {"count": 0})
    _clear_paused(repo_path)


def is_paused(repo_path: str) -> bool:
    return (Path(repo_path) / ORGANISM_DIR / "paused").exists()


def _set_paused(repo_path: str) -> None:
    (Path(repo_path) / ORGANISM_DIR / "paused").touch()


def _clear_paused(repo_path: str) -> None:
    path = Path(repo_path) / ORGANISM_DIR / "paused"
    if path.exists():
        path.unlink()

"""Heartbeat runner — quick (post-commit) and full (scheduled) modes."""
import json
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from livingcode.collectors.git_stats import collect_git_stats
from livingcode.collectors.code_quality import collect_code_quality
from livingcode.orchestrator.cycle import run_lifecycle_cycle
from livingcode.state import ensure_organism_dir, _safe_timestamp


def run_heartbeat(repo_path: str, mode: str = "quick") -> dict:
    """Run a heartbeat. mode='quick' for post-commit, mode='full' for scheduled."""
    ensure_organism_dir(repo_path)
    start = time.time()

    if mode == "full":
        result = run_lifecycle_cycle(repo_path)
        return {
            "mode": "full",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": round(time.time() - start, 2),
            "cycle_result": asdict(result),
        }

    # Quick mode: git_stats + code_quality only
    git_stats = collect_git_stats(repo_path)
    code_quality = collect_code_quality(repo_path)

    heartbeat = {
        "mode": "quick",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "trigger": "post_commit",
        "duration_seconds": round(time.time() - start, 2),
        "git_stats": asdict(git_stats),
        "code_quality": asdict(code_quality),
    }

    # Write to heartbeats directory
    heartbeats_dir = Path(repo_path) / ".organism" / "heartbeats"
    heartbeats_dir.mkdir(parents=True, exist_ok=True)
    filepath = heartbeats_dir / f"{_safe_timestamp()}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(heartbeat, f, indent=2)

    return heartbeat

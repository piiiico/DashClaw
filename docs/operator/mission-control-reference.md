# Mission Control Reference

What every badge, counter, and status on `/mission-control` (and the global status bar) means. This is the "what am I looking at" companion to [Fleet Management](./fleet-management.md).

## System Posture

A single tri-state summary of fleet risk, shown in the global status bar and the Command Strip. It is a roll-up of the active risk signals — not an alarm.

| Posture | When | Color |
|---|---|---|
| **Nominal** | No active signals | success (green) |
| **Elevated** | ≥1 amber (warning) signal active | warning (amber) |
| **Critical** | ≥1 red (critical) signal active | error (red) |

> Elevated is a *health* read, not a panic state — it means the governance layer is doing its job and surfacing something worth a glance. The bar is intentionally calm and does not pulse.

## Status bar — "N active governance signals"

The right side of the global status bar counts the signals currently active (after operator dismissals). It is a **link** — click it to open [`/security`](/security) for the per-signal breakdown: signal type, severity, the agent involved, detail, and the related action's post-mortem. The left side shows the same counts split out:

- **N Critical** — red signals (e.g. failure loops, repeated blocks).
- **N Elevated** — amber signals (e.g. autonomy/velocity spikes, stale branches).
- **All clear** — no active signals.

## Command Strip (top of Mission Control)

| Item | Meaning |
|---|---|
| **Posture** | The tri-state roll-up described above. |
| **agents** | Count of agents in the fleet (respects the current agent filter). |
| **Database** | Instance DB health — `Healthy`, `Degraded`, or `Unknown`. |
| **interventions** | Count of items currently needing an operator (approvals, urgent signals, loops). |
| **Last activity** | Relative time since the most recent governed action. |

## Signal Quadrants

- **Intervention Required** — work waiting on you, badged by kind: `Urgent`, `Approval` (pending approvals), `Loop` (detected failure/retry loops). Acting here unblocks agents.
- **Risk Signals** — total active signals with the `critical` / `elevated` split. The **View** link opens [`/security`](/security).
- **Decisions · 24h** — governed actions in the last day, split `Completed` / `Failed` / `Cancelled` / `Approval`.
- **Fleet Status** — per-agent presence dots (`Online` / `Stale` / `Offline`); see [Fleet Management](./fleet-management.md) for the thresholds.

## Drilling in

Every signal is clickable. From `/security`, selecting a signal opens a detail panel with its type, severity, the agent, the human-readable detail, and a link to the related action's full decision post-mortem (the replay).

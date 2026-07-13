# Broadcast Runner Operations

The broadcast runner is a single-owner worker for an active broadcast run. It must be started only after the API has created a broadcast run and recovery/start operation in PostgreSQL.

## Runtime model

- PostgreSQL is the canonical source for playback state, command sequence, leases, recovery operations, commands and live events.
- Runner writes are fenced by `runnerId`, `leaseGeneration`, `broadcastRunId`, valid PostgreSQL `now()` lease time and expected playback revision.
- OBS actions are executed before command completion is persisted. A command is only completed after OBS reports the expected media state.
- If the runner loses its lease it aborts polling, stops claiming commands and performs only local OBS safety actions.

## Installation

1. Copy `deploy/broadcast-runner.env.example` to `~/.config/obs-live-studio/broadcast-runner.env`.
2. Adjust database, public API URL and OBS credentials.
3. Copy `deploy/broadcast-runner.service` to `~/.config/systemd/user/obs-live-studio-broadcast-runner.service`.
4. Run `systemctl --user daemon-reload`.
5. Run `systemctl --user enable --now obs-live-studio-broadcast-runner.service`.

## Health and readiness

The process is healthy when it can connect to PostgreSQL, claim or observe recovery operations and keep the OBS controller available. It is ready for command execution only while it owns the current run lease and the lease generation matches the command envelope.

## Shutdown

SIGTERM and SIGINT call the public runner `shutdown()` method. Shutdown aborts active waits, pauses OBS locally, releases the fenced lease if still owned and closes the database pool from the service entrypoint.

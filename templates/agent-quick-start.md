# Clier - AI Agent Instructions

## Rules

**DO NOT run services manually.** Use Clier to manage processes:
- Ad-hoc services → `clier service add <name> -c "command"`
- Regular services → **Run `clier docs pipeline` and read before editing** `clier-pipeline.json`

**Service types:**
- `"type": "service"` = long-running, auto-restarts on crash
- `"type": "task"` = runs once and exits

## Check Status

Run `clier status` to see:
- Which processes are running/stopped
- If a process is waiting for a trigger event
- Pipeline state before making changes

## View Logs

**Process logs:** `clier logs <name>` - When debugging a specific process
**Daemon logs:** `clier logs --daemon` - When events/orchestration aren't working

## Control Services

**Individual services:**
- Start: `clier run <name>` or `clier service start <name>`
- Stop: `clier stop <name>` or `clier service stop <name>`
- Restart: `clier restart <name>` or `clier service restart <name>`
- Force stop: `clier kill <name>`
- Send stdin: `clier send <process> "data"`

**Entire daemon:** **Run `clier docs commands` and read before using `clier restart` (no args) or `clier reload`**

## Configuration Location

- Config: `clier-pipeline.json` (project root)
- Daemon: `.clier/daemon.pid`, `.clier/daemon.sock`
- Logs: `.clier/logs/`

## Documentation

Documentation is available to you by running  `clier docs`, e.g.:
- `clier docs commands` - Full command reference
- `clier docs pipeline` - Pipeline configuration guide with examples

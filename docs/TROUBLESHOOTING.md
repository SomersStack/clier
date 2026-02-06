# Troubleshooting Guide

Common issues, debugging steps, and platform-specific notes for Clier.

## Common Issues

### Daemon won't start

**Symptom:** `clier start` hangs or errors with "socket already in use."

**Causes and fixes:**

1. **Stale socket file** -- A previous daemon didn't shut down cleanly.
   ```bash
   # Check if a daemon is actually running
   ps aux | grep clier

   # If no daemon process exists, remove the stale socket
   rm .clier/daemon.sock
   clier start
   ```

2. **Stale PID file** -- `.clier/daemon.pid` points to a dead process.
   ```bash
   # Check if the PID is alive
   kill -0 $(cat .clier/daemon.pid) 2>/dev/null && echo "running" || echo "stale"

   # If stale, remove it
   rm .clier/daemon.pid
   clier start
   ```

3. **Permission issues** -- The `.clier/` directory or socket file has wrong ownership.
   ```bash
   ls -la .clier/
   # Fix ownership if needed
   chown -R $(whoami) .clier/
   ```

4. **Another instance running** -- A daemon is already running for this project.
   ```bash
   clier status           # Check if daemon is already up
   clier stop             # Stop it first, then restart
   clier start
   ```

---

### Process keeps restarting

**Symptom:** A service restarts in a loop, or the circuit breaker trips.

**Causes and fixes:**

1. **Command fails immediately** -- The command itself is broken (bad path, missing dependency).
   ```bash
   clier logs <name>      # Check error output
   # Try running the command directly to see the error
   ```

2. **Circuit breaker tripped** -- The process crashed 3 times within 5 seconds.
   ```bash
   clier logs --daemon    # Look for "circuit-breaker:triggered"
   clier status           # Process will show as stopped
   ```
   Fix the underlying crash, then restart:
   ```bash
   clier run <name>
   ```

3. **Wrong restart policy** -- A task is configured as a service, or `restart: "always"` is set on a process that exits normally.
   ```bash
   # Check your clier-pipeline.json
   # Tasks should use type: "task" (never restarted by default)
   # Services that exit cleanly should use restart: "on-failure" or "never"
   ```

4. **Increase debounce** -- If restarts are too aggressive, increase the debounce delay.
   ```json
   {
     "safety": {
       "debounce_ms": 1000
     }
   }
   ```

---

### Events not triggering

**Symptom:** A process with `trigger_on` never starts, even though the upstream process is running.

**Causes and fixes:**

1. **Pattern doesn't match stdout** -- The regex doesn't match the actual output.
   ```bash
   clier logs <upstream-process>    # See actual stdout
   ```
   Compare the output against your `pattern` regex. Common mistakes:
   - Forgetting to escape special characters: use `\\[INFO\\]` to match `[INFO]`
   - Pattern is case-sensitive by default
   - The pattern matches against individual lines, not the full output

2. **Event name typo** -- The `emit` value doesn't match the `trigger_on` value.
   ```json
   // Upstream emits:
   { "emit": "backend:ready" }

   // Downstream waits for:
   { "trigger_on": ["backend:ready"] }   // Must match exactly
   ```

3. **Events block missing** -- The upstream process doesn't have an `events` configuration.
   ```json
   // This process will NOT emit events:
   { "name": "db", "command": "...", "type": "service" }

   // This one will:
   {
     "name": "db",
     "command": "...",
     "type": "service",
     "events": {
       "on_stdout": [{ "pattern": "ready", "emit": "db:ready" }]
     }
   }
   ```

4. **Manual trigger** -- If you need to unblock a waiting process, emit the event manually:
   ```bash
   clier emit backend:ready
   ```

---

### Pipeline stuck

**Symptom:** Some processes are running but others never start.

**Causes and fixes:**

1. **Missing trigger event** -- A process is waiting for an event that was never emitted (the upstream process didn't output the expected pattern).
   ```bash
   clier status               # See which processes are waiting
   clier logs <upstream>      # Check if the expected output appeared
   ```

2. **Circular dependencies** -- Process A waits for B, and B waits for A.
   ```bash
   clier validate             # Detects circular dependencies
   ```

3. **Process exited before emitting** -- The upstream process crashed or exited before printing the trigger pattern.
   ```bash
   clier logs <upstream>      # Check for early exit or crash
   clier logs --daemon        # Check orchestration events
   ```

4. **Manual trigger required** -- If a process has `manual: true`, it won't auto-start.
   ```bash
   clier service start <name>
   ```

---

### Socket connection errors

**Symptom:** CLI commands fail with "connection refused" or "ENOENT" errors.

**Causes and fixes:**

1. **Daemon not running** -- The most common cause.
   ```bash
   clier status               # Will tell you if daemon is not running
   clier start                # Start the daemon
   ```

2. **Wrong project directory** -- You're running commands from outside the project that started the daemon. Clier searches upward for `clier-pipeline.json` and `.clier/`.
   ```bash
   # Make sure you're in the right project directory (or a subdirectory of it)
   ls clier-pipeline.json     # Should exist in project root
   ls .clier/daemon.sock      # Should exist when daemon is running
   ```

3. **Stale socket file** -- The daemon exited but the socket wasn't cleaned up.
   ```bash
   rm .clier/daemon.sock
   clier start
   ```

---

### Config validation failures

**Symptom:** `clier validate` reports errors.

**Common mistakes:**

1. **Duplicate process names** -- Every `name` in the pipeline must be unique.

2. **Missing required fields** -- `project_name`, `safety`, and `pipeline` are all required at the root level. Each pipeline item needs `name`, `command`, and `type`.

3. **Invalid regex in patterns** -- Test your regex patterns. Backslashes need double-escaping in JSON:
   ```json
   // Wrong:
   { "pattern": "\[INFO\]" }

   // Correct:
   { "pattern": "\\[INFO\\]" }
   ```

4. **Invalid type values** -- `type` must be `"service"`, `"task"`, or `"stage"`. `restart` must be `"always"`, `"on-failure"`, or `"never"`.

5. **Empty pipeline array** -- The pipeline must contain at least one item.

6. **Stage without steps** -- Stages (type: `"stage"`) require a `steps` array.

---

## Debugging Steps

### Check daemon logs

The daemon logs show all orchestration events -- process starts, stops, event emissions, circuit breaker activations, and errors.

```bash
clier logs --daemon                  # All daemon activity
clier logs --daemon --level error    # Errors only
clier logs --daemon -n 200           # Last 200 entries for more context
```

### Get machine-readable status

Use `--json` output for scripting and automated diagnostics:

```bash
clier status --json                  # Full status as JSON
clier status --json | jq '.stages'   # Stage groupings
clier status --json | jq '.processes[] | select(.status != "running")'  # Non-running processes
```

### Inspect the .clier/ directory

The `.clier/` directory holds all daemon state:

```
.clier/
├── daemon.pid      # Daemon process ID
├── daemon.sock     # Unix socket for IPC
└── logs/           # Log files
    ├── combined.log  # All daemon logs
    ├── error.log     # Daemon errors only
    └── <name>.log    # Per-process logs
```

You can read these directly, but prefer using `clier logs` for formatted output.

### Force-kill a stuck daemon

If `clier stop` doesn't work:

```bash
# Find and kill the daemon process
kill $(cat .clier/daemon.pid)

# If that doesn't work, force kill
kill -9 $(cat .clier/daemon.pid)

# Clean up state files
rm .clier/daemon.pid .clier/daemon.sock

# Start fresh
clier start
```

---

## Platform-Specific Issues

### macOS

**File descriptor limits** -- macOS defaults to 256 open file descriptors, which can be too low for pipelines with many processes.

```bash
# Check current limit
ulimit -n

# Increase for current session
ulimit -n 10240

# Permanent fix: add to ~/.zshrc or ~/.bashrc
echo 'ulimit -n 10240' >> ~/.zshrc
```

**Gatekeeper warnings** -- If you installed Clier from source or a non-standard location, macOS may block execution.

```bash
# If you see "cannot be opened because the developer cannot be verified"
xattr -d com.apple.quarantine $(which clier)
```

### Linux

**systemd integration** -- To run Clier as a system service:

```ini
# /etc/systemd/system/clier-myapp.service
[Unit]
Description=Clier Pipeline - myapp
After=network.target

[Service]
Type=forking
User=deploy
WorkingDirectory=/path/to/project
ExecStart=/usr/local/bin/clier start
ExecStop=/usr/local/bin/clier stop
PIDFile=/path/to/project/.clier/daemon.pid
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable clier-myapp
sudo systemctl start clier-myapp
```

**ulimit settings** -- Similar to macOS, increase file descriptor limits for large pipelines.

```bash
# Check current limit
ulimit -n

# Temporary increase
ulimit -n 65536

# Permanent: add to /etc/security/limits.conf
# deploy soft nofile 65536
# deploy hard nofile 65536
```

**Unix socket permissions** -- If multiple users need to connect to the same daemon, ensure the `.clier/` directory has appropriate permissions.

```bash
chmod 770 .clier/
chmod 660 .clier/daemon.sock
```

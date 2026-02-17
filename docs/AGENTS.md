# Clier - AI Agent CLI Quick Reference

> **For pipeline configuration, run `clier docs pipeline`**

## Essential Commands

```bash
# Initialize agent documentation
clier init                           # Create .claude/claude.md
clier init --agents                  # Create .agents/agents.md
clier init --append                  # Append to existing file
clier init --force                   # Overwrite existing file

# View documentation
clier docs                           # Show all documentation
clier docs commands                  # Show CLI commands only
clier docs pipeline                  # Show pipeline config only
clier docs --list                    # List available subjects

# Validate configuration (always run first!)
clier validate

# Start pipeline daemon
clier start

# Check process status
clier status
clier status --json                  # JSON output for scripting
clier watch                          # Watch mode (alias for status -w)
clier watch -n 5                     # Watch with 5 second refresh

# View logs
clier logs <name>                    # All logs for process
clier logs <name> -n 50              # Last 50 lines
clier logs <name> --since 5m         # Last 5 minutes
clier logs --daemon                  # View daemon logs
clier logs --daemon --level error    # Daemon error logs only

# Stop a service, or stop all processes
clier stop <name>                    # Stop a specific service
clier stop                           # Stop entire pipeline

# Restart a service, or restart daemon completely (new PID)
clier restart <name>                 # Restart a specific service
clier restart                        # Restart daemon (new PID)
clier restart --config ./path        # Restart daemon with specific config

# Hot reload configuration (same daemon PID, restarts all processes)
clier reload                         # Reload config, restart all processes
clier reload <name>                  # Restart a specific service
clier reload --restart-manual        # Also restart running manual services
clier reload --config ./path         # Reload with specific config
clier refresh                        # Alias for reload --restart-manual

# Force stop a service
clier kill <name>                    # Immediate kill (SIGKILL)

# Update Clier
clier update                         # Update to latest
clier update --check                 # Check for updates
```

## Service Control (Runtime-Only)

**Important**: These changes are NOT persisted to `clier-pipeline.json`

```bash
# Start/stop/restart individual services
clier run <name>                         # Start a service
clier stop <name>                        # Graceful stop (SIGTERM)
clier restart <name>                     # Graceful restart
clier kill <name>                        # Immediate kill (SIGKILL)

# Long-form equivalents (with extra options)
clier service start <name>               # Same as: clier run <name>
clier service stop <name> [--force]      # --force same as: clier kill <name>
clier service restart <name> [--force]   # --force for immediate kill before restart

# Dynamic add/remove (temporary)
clier service add <name> -c "command" [options]
  # Options: --env KEY=VAL, --cwd /path, --type service|task, --restart always|on-failure|never
clier service remove <name>

# Emit custom events to trigger waiting stages
clier emit <event-name>                  # Emit event (triggers stages with matching trigger_on)
clier emit <event-name> -d '{"key":"value"}'  # Emit with JSON data payload

# Send stdin input to running processes (requires input.enabled: true in config)
clier send <process> "data"              # Send input with newline
clier send <process> "data" --no-newline # Send without newline
```

## Stage Templates

Generate pipeline stages from built-in templates:

```bash
# List available templates
clier template list                      # Show all (service, task, utility)
clier template list --category task      # Filter by category

# Show template details and variables
clier template show node-api

# Apply template (outputs JSON to stdout)
clier template apply node-api --name my-api

# Override template variables
clier template apply node-api --name backend --var entrypoint=src/index.js

# Add directly to clier-pipeline.json
clier template apply build-task --name compile --add
```

**Built-in Templates:** `node-api`, `dev-server`, `build-task`, `lint-task`

## Workflow Commands

Workflows are multi-step orchestration chains defined in your pipeline config with `type: "workflow"`. They coordinate stopping, starting, restarting processes, and waiting for events.

```bash
# Trigger a workflow (shows live step-by-step progress)
clier workflow run <name>            # Run a named workflow
clier flow <name>                    # Shorthand alias

# Machine-readable output (NDJSON, one JSON object per line)
clier workflow run <name> --json     # NDJSON progress for scripting/agents
clier flow <name> --json             # Same via alias

# Monitor workflows
clier workflow status [name]         # Status of one or all workflows
clier workflow list                  # List all defined workflows
clier status                         # Includes workflow section

# Cancel a running workflow
clier workflow cancel <name>
```

The `--json` flag outputs NDJSON (newline-delimited JSON) with event types: `started`, `step`, `completed`, `failed`, `cancelled`, `error`. Useful for extensions and AI agents that need to parse workflow progress programmatically.

For workflow configuration, run `clier docs pipeline` or see the [Workflows Guide](workflows.md).

## Typical Workflows

### First Time Setup
```bash
# 1. Initialize agent documentation
clier init                           # Creates .claude/claude.md

# 2. View documentation if needed
clier docs pipeline                  # See pipeline config guide
clier docs commands                  # See command reference

# 3. Create clier-pipeline.json (see template in .claude/claude.md)

# 4. Validate and start
clier validate
clier start
```

### Using Existing Pipeline
```bash
# 1. Validate config
clier validate

# 2. Start
clier start

# 3. Monitor
clier status
clier logs backend
```

### Debug Failing Process
```bash
clier status                         # Check which process failed
clier logs failing-process           # View error logs
# Fix issue in code or config
clier reload                         # Hot reload if config changed
clier restart failing-process         # Or restart specific service
```

### Add Process to Running Pipeline
```bash
# Option 1: Persistent (edit config file)
# 1. Edit clier-pipeline.json to add new item
# 2. Validate
clier validate
# 3. Reload
clier reload

# Option 2: Temporary (runtime-only, lost on restart)
clier service add temp-worker -c "node worker.js" --env QUEUE=urgent
clier service remove temp-worker     # When done
```

### Restart Misbehaving Service
```bash
clier logs problematic-service       # Diagnose issue
clier restart problematic-service    # Restart it
clier logs problematic-service       # Verify fix
```

## Troubleshooting

### Config doesn't validate
```bash
clier validate                       # Shows validation errors
```

### Process not starting
1. `clier status` - Is it waiting for a `trigger_on` event?
2. Check if the required event is being emitted
3. `clier logs <name>` - Check for errors

### Process crashes immediately
1. `clier logs <name>` - Check error output
2. Verify command works standalone
3. Check `cwd` working directory is correct
4. Verify environment variables are set

### Events not triggering
1. Check stdout pattern matches exactly
2. `clier logs <name>` to see actual output
3. Test regex pattern online
4. Ensure pattern is in `events.on_stdout` array

### Daemon not responding
```bash
ps aux | grep clier                  # Check daemon is running
clier logs --daemon                  # Check daemon logs
clier logs --daemon --level error    # Check daemon error logs
clier stop && clier start            # Restart daemon
```

### Debugging daemon issues
```bash
# View daemon's internal logs to debug orchestration issues
clier logs --daemon -n 100           # Last 100 daemon log entries
clier logs --daemon --level error    # Only daemon errors
clier logs --daemon -n 500           # More context for complex issues
```

## Key Points

1. **Works from any subdirectory** - Clier finds project root automatically
2. **Always validate after editing pipelines** - `clier validate`
3. **Background daemon** - Processes continue running after CLI exits
4. **Hot reload vs restart** - `clier reload` (fast, same daemon PID) vs `clier restart` (thorough, new daemon PID)
5. **Service control is temporary** - `service add/remove/stop/start/restart` changes are NOT saved to JSON
6. **Force flag** - Use `--force` for immediate kill (SIGKILL) vs graceful stop (SIGTERM)

## File Locations

```
.clier/
├── daemon.pid       # Daemon process ID
├── daemon.sock      # Unix socket for IPC
└── logs/            # Log files
    ├── combined.log # Daemon logs (all levels) - use `clier logs --daemon`
    ├── error.log    # Daemon errors only - use `clier logs --daemon --level error`
    └── *.log        # Process logs - use `clier logs <name>`
```

**Tip**: Use `clier logs --daemon` instead of reading log files directly for formatted, colorized output.

## Creating/Modifying Pipelines

**Need to create or modify a pipeline configuration?**
Run `clier docs pipeline` to see:
- Configuration schema
- Pipeline setup examples
- Event system
- Common patterns

## Further Reading

- `clier docs pipeline` - Pipeline configuration guide
- `clier docs agent-instructions` - Essential agent instructions for CLAUDE.md/AGENTS.md
- [Workflows Guide](workflows.md) - Full workflow configuration and examples

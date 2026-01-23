# Clier - AI Agent CLI Quick Reference

> **For pipeline configuration, see [AGENTS-PIPELINE.md](AGENTS-PIPELINE.md)**

## Essential Commands

```bash
# Validate configuration (always run first!)
clier validate

# Start pipeline daemon
clier start

# Check process status
clier status

# View logs
clier logs <name>                    # All logs for process
clier logs <name> -n 50              # Last 50 lines
clier logs <name> --since 5m         # Last 5 minutes
clier logs --daemon                  # View daemon logs
clier logs --daemon --level error    # Daemon error logs only

# Stop all processes
clier stop

# Hot reload configuration (no restart)
clier reload

# Update Clier
clier update                         # Update to latest
clier update --check                 # Check for updates
```

## Service Control (Runtime-Only)

**Important**: These changes are NOT persisted to `clier-pipeline.json`

```bash
# Individual process control
clier service start <name>
clier service stop <name>                # Graceful stop (SIGTERM)
clier service stop <name> --force        # Immediate kill (SIGKILL)
clier service restart <name>             # Graceful restart
clier service restart <name> --force     # Force restart (immediate kill)

# Dynamic add/remove (temporary)
clier service add <name> -c "command" [options]
  # Options: --env KEY=VAL, --cwd /path, --type service|task
clier service remove <name>
```

## Typical Workflows

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
clier service restart failing-process # Or restart specific service
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
clier service restart problematic-service
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
2. **Always validate first** - `clier validate` before `clier start`
3. **Background daemon** - Processes continue running after CLI exits
4. **Hot reload** - `clier reload` updates config without stopping processes
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
See [AGENTS-PIPELINE.md](AGENTS-PIPELINE.md) for:
- Configuration schema
- Pipeline setup examples
- Event system
- Common patterns

## Further Reading

- [AGENTS-PIPELINE.md](AGENTS-PIPELINE.md) - Pipeline configuration guide
- [GETTING-STARTED.md](GETTING-STARTED.md) - Comprehensive guide
- [configuration.md](configuration.md) - Complete schema reference
- [api-reference.md](api-reference.md) - TypeScript API

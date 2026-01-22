# Clier CLI Documentation

## Overview

The Clier CLI provides a comprehensive set of commands for managing your PM2-based process orchestration pipeline.

## Installation

```bash
npm install -g clier
# or
npm link  # for local development
```

## Commands

### `clier start`

Start the pipeline by loading configuration, starting the watcher, and launching entry points.

```bash
# Start with default config (./clier-pipeline.json)
clier start

# Start with custom config
clier start /path/to/config.json
```

**What it does:**
1. Loads and validates `clier-pipeline.json`
2. Connects to PM2
3. Starts the watcher process (monitors events and triggers)
4. Starts all entry point processes (items with no `trigger_on`)
5. Displays process status table

**Exit codes:**
- `0`: Success
- `1`: Configuration error, PM2 error, or startup failure

---

### `clier stop`

Stop all Clier-managed processes including the watcher.

```bash
clier stop
```

**What it does:**
1. Connects to PM2
2. Lists all Clier processes (watcher + pipeline items)
3. Stops and removes each process
4. Performs graceful shutdown

**Exit codes:**
- `0`: Success
- `1`: PM2 connection error or stop failure

---

### `clier status`

Show the status of all running Clier processes.

```bash
clier status
```

**Output:**
- Process name
- Status (online, stopped, errored, etc.)
- PID
- Uptime
- Restart count
- CPU usage
- Memory usage

**Exit codes:**
- `0`: Success
- `1`: PM2 connection error

---

### `clier logs <name>`

Tail logs for a specific process.

```bash
# Show last 20 lines (default)
clier logs backend

# Show last 50 lines
clier logs backend --lines 50

# Stream logs continuously
clier logs backend --follow

# Combine options
clier logs backend -n 100 -f
```

**Options:**
- `-n, --lines <number>`: Number of lines to show (default: 20)
- `-f, --follow`: Follow log output (stream continuously)

**What it does:**
- Without `--follow`: Shows last N lines from stdout/stderr log files
- With `--follow`: Streams logs in real-time via PM2 event bus

**Exit codes:**
- `0`: Success
- `1`: Process not found or PM2 error

---

### `clier reload`

Reload configuration without full restart.

```bash
# Reload with default config
clier reload

# Reload with custom config
clier reload /path/to/config.json
```

**What it does:**
1. Validates new configuration
2. Restarts the watcher with new config
3. **Does NOT restart** running pipeline processes

**Note:** For a full restart with new config, use:
```bash
clier stop && clier start
```

**Exit codes:**
- `0`: Success
- `1`: Validation error, watcher not running, or reload failure

---

### `clier validate`

Validate a configuration file without starting anything.

```bash
# Validate default config
clier validate

# Validate specific file
clier validate /path/to/config.json
```

**What it does:**
1. Loads the configuration file
2. Validates against Zod schema
3. Displays validation errors (if any)
4. Shows config summary (if valid)

**Exit codes:**
- `0`: Valid configuration
- `1`: Validation error or file not found

---

## Global Options

```bash
clier --version  # Show version
clier --help     # Show help
clier <command> --help  # Show help for specific command
```

## Environment Variables

### For the CLI:
- None required

### For the Watcher (set by CLI):
- `CLIER_CONFIG_PATH`: Path to the configuration file

### In Pipeline Configs:
- `global_env: true`: Inherits all environment variables from the shell
- Item-specific `env`: Merged over global environment
- Variable substitution: `${VAR}` or `$VAR` syntax

## Examples

### Basic Workflow

```bash
# 1. Validate your config
clier validate

# 2. Start the pipeline
clier start

# 3. Check status
clier status

# 4. View logs
clier logs backend

# 5. Stop when done
clier stop
```

### Development Workflow

```bash
# Start pipeline
clier start

# Make config changes
vim clier-pipeline.json

# Validate changes
clier validate

# Reload config (watcher only)
clier reload

# Or full restart
clier stop && clier start
```

### Debugging

```bash
# Check if processes are running
clier status

# Stream logs for debugging
clier logs watcher --follow

# Check specific process logs
clier logs backend --lines 100
```

## Log Files

Logs are stored in `.clier/logs/`:
- `watcher-error.log` / `watcher-out.log`: Watcher process logs
- `<name>-error.log` / `<name>-out.log`: Pipeline item logs

## Process Names

- **Watcher**: `clier-watcher`
- **Pipeline items**: Use the `name` field from config

## Error Messages

### Common Errors

**"Config not found"**
```bash
# Solution: Create clier-pipeline.json in current directory
# Or specify path: clier start /path/to/config.json
```

**"PM2 not installed"**
```bash
# Solution: Install PM2 globally
npm install -g pm2
```

**"Clier is already running"**
```bash
# Solution: Stop first, then start
clier stop
clier start

# Or reload config
clier reload
```

**"Process not found"**
```bash
# Solution: Check process name with status
clier status

# Then use correct name
clier logs <correct-name>
```

## Tips

1. **Always validate** before starting:
   ```bash
   clier validate && clier start
   ```

2. **Use --follow for debugging**:
   ```bash
   clier logs watcher -f
   ```

3. **Check status regularly**:
   ```bash
   watch -n 1 clier status
   ```

4. **Graceful shutdown**:
   ```bash
   clier stop  # Always use this instead of killing PM2
   ```

## Architecture

```
clier start
    ↓
Load & Validate Config
    ↓
Start Watcher (monitors PM2 events)
    ↓
Start Entry Points (items with no trigger_on)
    ↓
Watcher Listens for Events
    ↓
Triggers Dependent Processes
```

## Next Steps

- See `clier-pipeline.json` schema documentation
- Read about event-driven pipelines
- Explore safety mechanisms (rate limiting, debouncing, circuit breakers)

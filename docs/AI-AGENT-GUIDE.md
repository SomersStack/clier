# Clier - AI Agent Quick Setup Guide

> Process orchestration framework for event-driven pipelines

## What is Clier?

Clier manages multi-process pipelines with event-driven coordination. It runs processes as a background daemon, monitors their output, and triggers dependent processes based on pattern matching.

**Key Concepts:**
- **Services**: Long-running processes (web servers, APIs) - automatically restarted on crash
- **Tasks**: One-off operations (builds, tests) - exit when complete
- **Events**: Pattern-based triggers that coordinate process execution
- **Safety**: Built-in rate limiting, debouncing, and circuit breakers

## Configuration File

Create `clier-pipeline.json` in the project root:

```json
{
  "project_name": "my-project",
  "global_env": true,
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  },
  "pipeline": [
    {
      "name": "process-name",
      "command": "npm start",
      "type": "service",
      "trigger_on": ["optional:event"],
      "continue_on_failure": false,
      "env": {
        "PORT": "3000",
        "VAR": "${SYSTEM_VAR}"
      },
      "cwd": "./optional/directory",
      "events": {
        "on_stdout": [
          { "pattern": "Server listening", "emit": "server:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    }
  ]
}
```

### Configuration Schema

#### Root Level
- `project_name` (required): Unique project identifier
- `global_env` (optional, default: true): Inherit system environment variables
- `safety` (required): Safety configuration
  - `max_ops_per_minute`: Rate limit for process starts (e.g., 60)
  - `debounce_ms`: Delay before restarting crashed processes (e.g., 100)
- `pipeline` (required): Array of pipeline items

#### Pipeline Item
- `name` (required): Unique process identifier (used in logs, event names)
- `command` (required): Shell command to execute
- `type` (required): `"service"` (long-running) or `"task"` (one-off)
- `trigger_on` (optional): Array of event names that start this process
  - If omitted, process starts immediately
  - Process starts when ANY listed event is emitted
- `continue_on_failure` (optional, default: false):
  - `false`: Failure blocks pipeline (strict mode)
  - `true`: Failure emits events but continues (lenient mode)
- `env` (optional): Environment variables
  - Supports substitution: `"${VAR}"` or `"${VAR:-default}"`
- `cwd` (optional): Working directory for command execution
- `events` (required): Event emission rules

#### Events Configuration
- `on_stdout` (required): Array of pattern-event pairs
  - `pattern`: Regular expression to match stdout
  - `emit`: Event name to emit when matched
  - **Important**: ALL matching patterns emit events (not just first match)
- `on_stderr` (optional, default: true): Emit `${name}:error` on stderr output
- `on_crash` (optional, default: true): Emit `${name}:crashed` on non-zero exit

### Environment Variables

**System Environment:**
```json
{
  "global_env": true  // Inherit system env (default)
}
```

**Variable Substitution:**
```json
{
  "env": {
    "DATABASE_URL": "${DATABASE_URL}",
    "PORT": "${PORT:-3000}",
    "API_KEY": "${SECRET_KEY}"
  }
}
```

## CLI Commands

All commands accept an optional `--config` flag (default: `./clier-pipeline.json`).

### Essential Commands

```bash
# Validate configuration (always run first!)
clier validate

# Start pipeline (launches daemon in background)
clier start

# Check process status
clier status

# View logs
clier logs <name>                    # Specific process logs
clier logs <name> -n 50              # Last 50 lines
clier logs <name> --since 5m         # Logs from last 5 minutes

# Stop all processes
clier stop

# Reload configuration (hot reload without full restart)
clier reload

# Update Clier to latest version
clier update                         # Update to latest version
clier update --check                 # Check if updates available
clier update --global                # Update global installation
```

### Command Details

**`clier validate`**
- Checks JSON syntax, schema compliance, unique names, valid regex patterns
- Run this before `start` to catch configuration errors

**`clier start`**
- Spawns background daemon process
- Starts all processes without `trigger_on` immediately
- Returns control to terminal (processes run in background)

**`clier status`**
- Shows table of all processes with PID, status, uptime, restarts
- Queries the running daemon

**`clier logs <name> [options]`**
- Shows logs for a specific process
- Options:
  - `-n, --lines <number>`: Number of lines to show (default: 100)
  - `--since <duration>`: Show logs since duration (e.g., 5m, 1h, 30s)
- Examples:
  - `clier logs backend`: Last 100 lines
  - `clier logs backend -n 50`: Last 50 lines
  - `clier logs backend --since 5m`: Last 5 minutes

**`clier stop`**
- Gracefully shuts down all processes
- Stops the daemon

**`clier reload`**
- Hot reloads configuration without stopping running processes
- Useful for adding new pipeline items or changing events

**`clier update [options]`**
- Updates Clier to the latest version
- Options:
  - `--check`: Check for updates without installing
  - `--global`: Update global installation (default: true)
- Auto-detects package manager (npm, yarn, pnpm, bun)
- Shows current and latest versions

### Service Control Commands

Control individual services/processes dynamically without modifying the pipeline JSON:

**`clier service start <name>`**
- Start a specific stopped service
- Example: `clier service start backend`

**`clier service stop <name>`**
- Stop a running service
- Example: `clier service stop backend`

**`clier service restart <name>`**
- Restart a running service (gets new PID)
- Example: `clier service restart backend`

**`clier service add <name> --command "..." [options]`**
- Dynamically add a new service to the running pipeline
- **Note**: Changes are NOT persisted to `clier-pipeline.json` (runtime-only)
- Required:
  - `-c, --command <command>`: Command to execute
- Optional:
  - `--cwd <directory>`: Working directory
  - `--type <type>`: Process type - `service` or `task` (default: service)
  - `-e, --env <KEY=VALUE...>`: Environment variables (can specify multiple)
  - `--no-restart`: Disable auto-restart for services
- Examples:
  ```bash
  # Add a simple service
  clier service add my-api --command "node server.js"

  # Add with full configuration
  clier service add my-api \
    --command "node server.js" \
    --cwd /app/backend \
    --type service \
    --env PORT=3000 \
    --env NODE_ENV=production

  # Add a one-off task
  clier service add build-task \
    --command "npm run build" \
    --type task
  ```

**`clier service remove <name>`**
- Remove a service from the running pipeline
- Stops the service if running, then removes it
- Example: `clier service remove my-api`

**Important Notes:**
- Service control commands modify the running daemon only
- Changes do NOT persist to `clier-pipeline.json`
- Services added with `service add` are lost when Clier restarts
- Use these commands for temporary services, testing, or dynamic workflows
- To persist changes, manually edit `clier-pipeline.json` and run `clier reload`

## Event System

### Event Flow

1. **Pattern Matching**: Stdout/stderr checked against all patterns
2. **Event Emission**: ALL matching patterns emit their events
3. **Event Bus**: Events published to internal event bus
4. **Trigger Execution**: Processes with matching `trigger_on` start

### Built-in Events

- **Custom Events**: Defined via stdout patterns
  ```json
  { "pattern": "SUCCESS", "emit": "build:success" }
  ```

- **Error Event**: `${name}:error` (triggered by stderr if `on_stderr: true`)
- **Crash Event**: `${name}:crashed` (triggered by non-zero exit if `on_crash: true`)
- **Circuit Breaker**: `circuit-breaker:triggered` (when process crashes too many times)

### Event Naming Convention

Use `process-name:event-type` format:
- `backend:ready`
- `build:success`
- `db:connected`
- `lint:failure`

## Common Patterns

### Pattern 1: Sequential Tasks (CI/CD Pipeline)

```json
{
  "pipeline": [
    {
      "name": "lint",
      "command": "npm run lint",
      "type": "task",
      "events": {
        "on_stdout": [{ "pattern": "✓", "emit": "lint:success" }]
      }
    },
    {
      "name": "build",
      "command": "npm run build",
      "type": "task",
      "trigger_on": ["lint:success"],
      "events": {
        "on_stdout": [{ "pattern": "Build complete", "emit": "build:success" }]
      }
    },
    {
      "name": "deploy",
      "command": "npm run deploy",
      "type": "task",
      "trigger_on": ["build:success"]
    }
  ]
}
```

**Flow**: lint → build → deploy (sequential execution)

### Pattern 2: Service Dependencies

```json
{
  "pipeline": [
    {
      "name": "database",
      "command": "docker-compose up db",
      "type": "service",
      "events": {
        "on_stdout": [{ "pattern": "ready to accept connections", "emit": "db:ready" }]
      }
    },
    {
      "name": "backend",
      "command": "node server.js",
      "type": "service",
      "trigger_on": ["db:ready"],
      "events": {
        "on_stdout": [{ "pattern": "Server listening", "emit": "backend:ready" }]
      }
    },
    {
      "name": "frontend",
      "command": "npm run dev",
      "type": "service",
      "trigger_on": ["backend:ready"]
    }
  ]
}
```

**Flow**: database → backend → frontend (dependent services)

### Pattern 3: Parallel Services

```json
{
  "pipeline": [
    {
      "name": "api",
      "command": "node api.js",
      "type": "service"
    },
    {
      "name": "worker",
      "command": "node worker.js",
      "type": "service"
    },
    {
      "name": "scheduler",
      "command": "node scheduler.js",
      "type": "service"
    }
  ]
}
```

**Flow**: All start simultaneously (no dependencies)

### Pattern 4: Graceful Degradation

```json
{
  "pipeline": [
    {
      "name": "cache-warm",
      "command": "node warm-cache.js",
      "type": "task",
      "continue_on_failure": true,
      "events": {
        "on_stdout": [
          { "pattern": "SUCCESS", "emit": "cache:ready" },
          { "pattern": "FAILURE", "emit": "cache:failed" }
        ]
      }
    },
    {
      "name": "app",
      "command": "node app.js",
      "type": "service",
      "trigger_on": ["cache:ready", "cache:failed"]
    }
  ]
}
```

**Flow**: App starts regardless of cache warming success/failure

### Pattern 5: Multi-Pattern Events

```json
{
  "pipeline": [
    {
      "name": "logger",
      "command": "node logger.js",
      "type": "service",
      "events": {
        "on_stdout": [
          { "pattern": "\\[INFO\\]", "emit": "log:info" },
          { "pattern": "\\[WARN\\]", "emit": "log:warn" },
          { "pattern": "\\[ERROR\\]", "emit": "log:error" }
        ]
      }
    },
    {
      "name": "alert",
      "command": "node send-alert.js",
      "type": "task",
      "trigger_on": ["log:error"]
    }
  ]
}
```

**Behavior**: If stdout contains `[INFO] [ERROR]`, BOTH events are emitted

### Pattern 6: Circuit Breaker Handling

```json
{
  "pipeline": [
    {
      "name": "unstable-service",
      "command": "node unstable.js",
      "type": "service"
    },
    {
      "name": "alert",
      "command": "node send-alert.js 'Circuit breaker triggered'",
      "type": "task",
      "trigger_on": ["circuit-breaker:triggered"]
    }
  ]
}
```

**Behavior**: Alert runs when any service crashes 3+ times in 5 seconds

## Safety Mechanisms

### Debouncing
Prevents tight restart loops by waiting `debounce_ms` before restarting crashed services.

**Use case**: Avoid CPU thrashing from rapid restarts

### Rate Limiting
Limits process starts to `max_ops_per_minute` across entire pipeline.

**Use case**: Prevent resource exhaustion

### Circuit Breaker
Stops cascading failures by detecting repeated crashes (3 crashes in 5 seconds).

**Use case**: Automatic failure detection and alerting

## Typical AI Agent Workflows

### Workflow 1: Create New Pipeline

```bash
# 1. Create configuration file
# (AI agent writes clier-pipeline.json)

# 2. Validate configuration
clier validate

# 3. Start pipeline
clier start

# 4. Monitor status
clier status
```

### Workflow 2: Debug Failing Process

```bash
# 1. Check status
clier status

# 2. View logs
clier logs failing-process

# 3. Update configuration
# (AI agent edits clier-pipeline.json)

# 4. Reload
clier reload
```

### Workflow 3: Add New Process to Running Pipeline (Persistent)

```bash
# 1. Edit configuration
# (AI agent adds new pipeline item to clier-pipeline.json)

# 2. Validate
clier validate

# 3. Reload (doesn't stop existing processes)
clier reload
```

### Workflow 4: Add Temporary Service (Runtime-only)

```bash
# Add service dynamically without editing config
clier service add temp-worker \
  --command "node worker.js" \
  --env QUEUE_NAME=urgent-tasks

# Check it's running
clier status

# View logs
clier logs temp-worker

# Remove when done
clier service remove temp-worker
```

### Workflow 5: Restart Misbehaving Service

```bash
# Check status
clier status

# View logs to diagnose issue
clier logs problematic-service

# Restart the service
clier service restart problematic-service

# Verify it's working
clier logs problematic-service
```

## Process States

- **online**: Process running normally
- **stopped**: Process not started yet (waiting for trigger)
- **crashed**: Process exited with non-zero code
- **stopping**: Process shutting down gracefully
- **restarting**: Service being restarted after crash

## Regular Expression Tips

**Escape special characters in patterns:**
- Brackets: `\\[INFO\\]` matches `[INFO]`
- Dots: `v\\d+\\.\\d+` matches `v1.2`
- Backslash: `\\\\` matches `\`

**Common patterns:**
- Literal string: `"Server listening"`
- Contains word: `".*ready.*"`
- Start of line: `"^Starting"`
- Version numbers: `"v\\d+\\.\\d+\\.\\d+"`
- Log levels: `"\\[(INFO|WARN|ERROR)\\]"`

## Troubleshooting

### Configuration doesn't validate
```bash
clier validate
# Fix errors shown in output
```

### Process not starting
1. Check `clier status` - is it waiting for a trigger?
2. Check `trigger_on` - is the required event being emitted?
3. Check `clier logs` for errors

### Process crashes immediately
1. Check `clier logs process-name`
2. Verify command works standalone
3. Check working directory (`cwd`) is correct
4. Verify environment variables are set

### Events not triggering
1. Check stdout pattern matches exactly
2. Use `clier logs` to see actual stdout
3. Test regex pattern with online regex tester
4. Ensure `on_stdout` array includes the pattern

### Daemon not responding
```bash
# Check if daemon is running
ps aux | grep clier

# View daemon logs
cat .clier/daemon.log

# Force stop and restart
clier stop
clier start
```

## File Locations

Clier creates a `.clier/` directory in the project root:

```
.clier/
├── daemon.pid       # Daemon process ID
├── daemon.sock      # Unix socket for IPC
├── daemon.log       # Daemon logs
└── logs/            # Process logs
    ├── backend.log
    └── frontend.log
```

## Quick Reference Card

| Action | Command |
|--------|---------|
| Create config | Write `clier-pipeline.json` |
| Validate config | `clier validate` |
| Start pipeline | `clier start` |
| Check status | `clier status` |
| View process logs | `clier logs <name>` |
| Stop pipeline | `clier stop` |
| Hot reload config | `clier reload` |
| Update Clier | `clier update` |
| Check for updates | `clier update --check` |
| **Dynamic Service Control** | |
| Add service (temporary) | `clier service add <name> -c "command"` |
| Stop service | `clier service stop <name>` |
| Start service | `clier service start <name>` |
| Restart service | `clier service restart <name>` |
| Remove service | `clier service remove <name>` |
| Custom config path | Add `--config <path>` to any command |

## Key Points for AI Agents

1. **Always validate first**: Run `clier validate` before `clier start`
2. **Watch for patterns**: Make sure stdout patterns match actual output
3. **Event naming**: Use consistent `process:event` convention
4. **Multi-pattern**: Remember ALL matching patterns emit events
5. **Immediate vs triggered**: Processes without `trigger_on` start immediately
6. **Service types**: Services restart on crash, tasks exit
7. **Lenient mode**: Use `continue_on_failure: true` for optional operations
8. **Environment vars**: Use `${VAR}` for substitution, `${VAR:-default}` for defaults
9. **Background daemon**: Processes continue running after CLI exits
10. **Hot reload**: Use `clier reload` to update config without stopping processes
11. **Dynamic services**: Use `clier service add/remove` for temporary services (not persisted to JSON)
12. **Service control**: Use `clier service stop/start/restart` to control individual processes
13. **Version updates**: Clier checks for updates on start; use `clier update` to upgrade
14. **Log viewing**: Use `clier logs <name> --since 5m` for recent logs, `-n 50` for line limit

## Example: Complete Dev Environment

```json
{
  "project_name": "full-stack-app",
  "global_env": true,
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  },
  "pipeline": [
    {
      "name": "postgres",
      "command": "docker-compose up -d postgres",
      "type": "service",
      "events": {
        "on_stdout": [
          { "pattern": "ready to accept connections", "emit": "db:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "redis",
      "command": "docker-compose up -d redis",
      "type": "service",
      "events": {
        "on_stdout": [
          { "pattern": "Ready to accept connections", "emit": "redis:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "backend",
      "command": "npm run dev",
      "type": "service",
      "trigger_on": ["db:ready", "redis:ready"],
      "env": {
        "PORT": "3000",
        "NODE_ENV": "development"
      },
      "events": {
        "on_stdout": [
          { "pattern": "Server listening on port", "emit": "backend:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "frontend",
      "command": "npm run dev",
      "type": "service",
      "trigger_on": ["backend:ready"],
      "cwd": "./frontend",
      "env": {
        "VITE_API_URL": "http://localhost:3000"
      },
      "events": {
        "on_stdout": [
          { "pattern": "Local:.*http://localhost", "emit": "frontend:ready" }
        ],
        "on_stderr": false,
        "on_crash": true
      }
    }
  ]
}
```

**Usage:**
```bash
clier validate && clier start
# Opens: postgres → redis → backend → frontend
# All services start in correct order with dependencies

clier status
# Check all services are online

clier logs
# Monitor all logs in real-time

clier stop
# Graceful shutdown of entire stack
```

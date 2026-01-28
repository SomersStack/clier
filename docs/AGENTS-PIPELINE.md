# Clier - Pipeline Configuration Guide for AI Agents

> **For CLI commands, run `clier docs commands`**

## Quick Setup Template

Create `clier-pipeline.json` in project root:

```json
{
  "project_name": "project-name",
  "global_env": true,
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  },
  "pipeline": [
    {
      "name": "unique-name",
      "command": "npm start",
      "type": "service",
      "trigger_on": ["optional:event"],
      "env": {
        "PORT": "3000",
        "VAR": "${SYSTEM_VAR}"
      },
      "cwd": "./optional/dir",
      "events": {
        "on_stdout": [
          { "pattern": "Ready", "emit": "service:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    }
  ]
}
```

## Configuration Schema

### Root Fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `project_name` | Yes | string | - | Unique project ID |
| `global_env` | No | boolean | true | Inherit system env vars |
| `safety` | Yes | object | - | Safety limits |
| `pipeline` | Yes | array | - | Process definitions |

### Safety Config

| Field | Type | Description | Recommended |
|-------|------|-------------|-------------|
| `max_ops_per_minute` | number | Rate limit for process starts | 60 |
| `debounce_ms` | number | Delay before restarting crashed process | 100-1000 |

### Pipeline Item

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `name` | Yes | string | - | Unique process name |
| `command` | Yes | string | - | Shell command |
| `type` | Yes | "service" \| "task" | - | Service=long-running, Task=one-off |
| `trigger_on` | No | string[] | - | Events that start this process (omit = starts immediately) |
| `manual` | No | boolean | false | Only start via `clier service start` (not auto-started or event-triggered) |
| `continue_on_failure` | No | boolean | false | true=continue on failure, false=block pipeline |
| `env` | No | object | - | Environment variables |
| `cwd` | No | string | - | Working directory |
| `events` | No | object | - | Event config (omit = no event coordination) |
| `input` | No | object | - | Stdin input config (see Input Config below) |

### Events Config

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `on_stdout` | Yes | array | - | Pattern-event pairs (ALL matching patterns emit) |
| `on_stderr` | No | boolean | true | Emit `${name}:error` on stderr |
| `on_crash` | No | boolean | true | Emit `${name}:crashed` on crash |

**Stdout Event Pattern:**
```json
{ "pattern": "regex", "emit": "event:name" }
```

### Input Config

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `enabled` | Yes | boolean | false | Enable stdin input for this process |

**Usage:**
```json
{
  "name": "repl",
  "command": "python3 -i",
  "type": "service",
  "input": { "enabled": true }
}
```

Then send input: `clier input repl "print('hello')"`

## Event System

**Event Flow:**
1. Process outputs to stdout/stderr
2. ALL matching patterns emit events (not just first match)
3. Processes with matching `trigger_on` start

**Built-in Events:**
- `${name}:error` - stderr output (if `on_stderr: true`)
- `${name}:crashed` - non-zero exit (if `on_crash: true`)
- `circuit-breaker:triggered` - too many crashes (3 in 5 sec)

**Event Naming Convention:** `process:event-type`

## Common Patterns

### Sequential Tasks (CI/CD)

```json
{
  "pipeline": [
    {
      "name": "lint",
      "command": "npm run lint",
      "type": "task",
      "events": { "on_stdout": [{ "pattern": "✓", "emit": "lint:success" }] }
    },
    {
      "name": "build",
      "command": "npm run build",
      "type": "task",
      "trigger_on": ["lint:success"],
      "events": { "on_stdout": [{ "pattern": "complete", "emit": "build:success" }] }
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

**Flow**: lint → build → deploy (sequential)

### Service Dependencies

```json
{
  "pipeline": [
    {
      "name": "db",
      "command": "docker-compose up db",
      "type": "service",
      "events": { "on_stdout": [{ "pattern": "ready to accept", "emit": "db:ready" }] }
    },
    {
      "name": "api",
      "command": "node server.js",
      "type": "service",
      "trigger_on": ["db:ready"],
      "events": { "on_stdout": [{ "pattern": "listening", "emit": "api:ready" }] }
    },
    {
      "name": "frontend",
      "command": "npm run dev",
      "type": "service",
      "trigger_on": ["api:ready"]
    }
  ]
}
```

**Flow**: db → api → frontend (dependent services)

### Parallel Services (No Dependencies)

```json
{
  "pipeline": [
    { "name": "api", "command": "node api.js", "type": "service" },
    { "name": "worker", "command": "node worker.js", "type": "service" },
    { "name": "scheduler", "command": "node scheduler.js", "type": "service" }
  ]
}
```

**Flow**: All start simultaneously

### Graceful Degradation

```json
{
  "pipeline": [
    {
      "name": "cache-warm",
      "command": "node warm.js",
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

### Multi-Pattern Events

```json
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
}
```

**Behavior**: If stdout contains `[INFO] [ERROR]`, BOTH events are emitted

### Circuit Breaker Handling

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
      "command": "node send-alert.js",
      "type": "task",
      "trigger_on": ["circuit-breaker:triggered"]
    }
  ]
}
```

**Behavior**: Alert runs when any service crashes 3+ times in 5 seconds

### Manual Trigger Stages

For stages that should only run on demand (not automatically):

```json
{
  "pipeline": [
    {
      "name": "api",
      "command": "npm run dev",
      "type": "service",
      "events": { "on_stdout": [{ "pattern": "listening", "emit": "api:ready" }] }
    },
    {
      "name": "deploy",
      "command": "npm run deploy",
      "type": "task",
      "manual": true
    },
    {
      "name": "db-migrate",
      "command": "npm run migrate",
      "type": "task",
      "manual": true
    }
  ]
}
```

**Trigger manually:**
```bash
clier service start deploy      # Run deployment
clier service start db-migrate  # Run database migrations
```

**Reload with manual services:**
```bash
clier reload --restart-manual   # Reload config AND restart running manual services
```

**Behavior**: `manual: true` stages never auto-start or respond to events - they only run via `clier service start`

## Environment Variables

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
    "PORT": "${PORT:-3000}",           // Default value
    "API_KEY": "${SECRET_KEY}"
  }
}
```

**Syntax:**
- `${VAR}` - Use value of VAR
- `${VAR:-default}` - Use VAR or default if not set

## Regex Tips

**Escape special chars:**
- `\\[INFO\\]` → matches `[INFO]`
- `v\\d+\\.\\d+` → matches `v1.2`

**Common patterns:**
- Literal: `"Server listening"`
- Contains: `".*ready.*"`
- Start of line: `"^Starting"`
- Version: `"v\\d+\\.\\d+\\.\\d+"`
- Log levels: `"\\[(INFO|WARN|ERROR)\\]"`

## Safety Mechanisms

### Debouncing
Waits `debounce_ms` before restarting crashed services. Prevents CPU thrashing.

### Rate Limiting
Limits process starts to `max_ops_per_minute`. Prevents resource exhaustion.

### Circuit Breaker
Stops cascading failures by detecting repeated crashes (3 in 5 seconds). Emits `circuit-breaker:triggered` event.

## Complete Example

Full-featured dev environment:

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
clier status
clier logs
```

## Key Points

1. **No `trigger_on`** = starts immediately
2. **`manual: true`** = only starts via `clier service start` command
3. **Service vs Task** - Services restart on crash, tasks exit
4. **Multi-pattern** - ALL matching patterns emit (not just first)
5. **Event naming** - Use `process:event` convention
6. **Lenient mode** - `continue_on_failure: true` for optional operations
7. **Events optional** - Omit `events` field if no coordination needed

## Further Reading

- `clier docs commands` - CLI commands and workflows
- `clier docs agent-instructions` - Essential agent instructions for CLAUDE.md/AGENTS.md

# Configuration Guide

Complete reference for `clier-pipeline.json` configuration file.

## Table of Contents

- [Overview](#overview)
- [Schema Reference](#schema-reference)
- [Stage Configuration](#stage-configuration)
- [Input Configuration](#input-configuration)
- [Manual Start Mode](#manual-start-mode)
- [Event System](#event-system)
- [Safety Mechanisms](#safety-mechanisms)
- [Environment Variables](#environment-variables)
- [Examples](#examples)

## Overview

Clier uses a JSON configuration file (default: `clier-pipeline.json`) to define your pipeline. The configuration specifies:

- Project metadata
- Safety limits
- Pipeline items (services and tasks)
- Event triggers and patterns
- Environment variables

## Schema Reference

### Root Configuration

```typescript
{
  "project_name": string,        // Required: Unique project identifier
  "global_env": boolean,          // Optional: Inherit system environment (default: true)
  "safety": SafetyConfig,         // Required: Safety configuration
  "pipeline": PipelineItem[]      // Required: Array of pipeline items
}
```

#### Fields

**`project_name`** (required)
- Type: `string`
- Description: Unique identifier for your project
- Constraints: Non-empty string
- Example: `"my-app"`, `"staging-api"`

**`global_env`** (optional)
- Type: `boolean`
- Default: `true`
- Description: Whether to inherit system environment variables
- Use `false` for isolated environments

**`safety`** (required)
- Type: `SafetyConfig`
- Description: Safety limits to prevent runaway processes
- See [Safety Configuration](#safety-configuration)

**`pipeline`** (required)
- Type: `PipelineItem[]`
- Description: Array of services and tasks
- Constraints:
  - Must be non-empty array
  - All names must be unique
- See [Pipeline Item Configuration](#pipeline-item-configuration)

---

### Safety Configuration

```typescript
{
  "max_ops_per_minute": number,   // Required: Rate limit
  "debounce_ms": number           // Required: Debounce delay
}
```

#### Fields

**`max_ops_per_minute`** (required)
- Type: `number` (positive integer)
- Description: Maximum number of process starts per minute
- Purpose: Prevent CPU/memory exhaustion from rapid restarts
- Recommended: `60` (one per second average)
- Example: `60`, `120`, `30`

**`debounce_ms`** (required)
- Type: `number` (non-negative integer)
- Description: Milliseconds to wait before restarting a crashed process
- Purpose: Prevent tight restart loops
- Recommended: `100` - `1000`
- Example: `100`, `500`, `1000`

#### Example

```json
{
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  }
}
```

---

### Pipeline Item Configuration

```typescript
{
  "name": string,                 // Required: Unique process name
  "command": string,              // Required: Shell command
  "type": "service" | "task",     // Required: Process type
  "trigger_on": string[],         // Optional: Event triggers
  "continue_on_failure": boolean, // Optional: Failure handling
  "env": Record<string, string>,  // Optional: Environment variables
  "cwd": string,                  // Optional: Working directory
  "events": EventsConfig,         // Optional: Event configuration
  "manual": boolean,              // Optional: Manual start only
  "input": InputConfig,           // Optional: Stdin input support
  "restart": "always" | "on-failure" | "never"  // Optional: Restart policy
}
```

#### Fields

**`name`** (required)
- Type: `string`
- Description: Unique identifier for this process
- Constraints: Non-empty, must be unique across pipeline
- Used in: PM2 process name, log files, event names
- Example: `"backend"`, `"lint"`, `"api-server"`

**`command`** (required)
- Type: `string`
- Description: Shell command to execute
- Constraints: Non-empty
- Examples:
  - `"npm start"`
  - `"node server.js"`
  - `"python3 worker.py --threads=4"`

**`type`** (required)
- Type: `"service"` or `"task"`
- Description: Process lifetime behavior

| Type | Behavior | Use Cases |
|------|----------|-----------|
| `service` | Long-running, restarted on failure (non-zero exit) by default | Web servers, APIs, workers, databases |
| `task` | One-off, exits when complete, never restarted | Builds, tests, migrations, deployments |

See [`restart`](#restart-optional) for controlling restart behavior.

**`trigger_on`** (optional)
- Type: `string[]` (array of event names)
- Description: Events that trigger this process to start
- Default: Process starts immediately if not specified
- Behavior: Process starts when ANY listed event is emitted
- Example: `["backend:ready", "db:connected"]`

**`continue_on_failure`** (optional)
- Type: `boolean`
- Default: `false` (strict mode)
- Description: Controls failure behavior

| Value | Behavior |
|-------|----------|
| `false` | Failure blocks pipeline (strict mode) |
| `true` | Failure emits event but continues (lenient mode) |

See [Continue on Failure](#continue-on-failure) for details.

**`env`** (optional)
- Type: `Record<string, string>` (key-value pairs)
- Description: Environment variables for this process
- Supports variable substitution: `${VAR_NAME}`
- Example:
```json
{
  "env": {
    "PORT": "3000",
    "NODE_ENV": "production",
    "DATABASE_URL": "${DATABASE_URL}"
  }
}
```

**`cwd`** (optional)
- Type: `string`
- Description: Working directory for command execution
- Default: Current directory
- Example: `"/app/backend"`, `"./services/api"`

**`events`** (optional)
- Type: `EventsConfig`
- Description: Event emission rules for stdout pattern matching, stderr, and crash events
- Default: If omitted, no special event emissions occur (process runs normally without event coordination)
- See [Events Configuration](#events-configuration)

**`manual`** (optional)
- Type: `boolean`
- Default: `false`
- Description: If `true`, this stage only starts via `clier service start <name>` command
- Use for: Optional services that should not auto-start with the pipeline
- Note: Manual services can be restarted during reload with `clier reload --restart-manual`

**`input`** (optional)
- Type: `InputConfig`
- Description: Stdin input configuration for interactive processes
- Default: If omitted, stdin is not available
- See [Input Configuration](#input-configuration)

**`restart`** (optional)
- Type: `"always"` | `"on-failure"` | `"never"`
- Default: `"on-failure"` for services, `"never"` for tasks
- Description: Controls when a process is automatically restarted after exiting

| Value | Behavior |
|-------|----------|
| `"on-failure"` | Restart only on non-zero exit code (default for services) |
| `"always"` | Restart on any exit, including exit code 0 |
| `"never"` | Never restart, regardless of exit code |

When a service exits with code 0 and `restart` is `"on-failure"` or `"never"`, a `${name}:success` event is emitted, allowing downstream stages to trigger. With `"always"`, the service restarts immediately without emitting a success event.

This is useful for interactive CLI processes with menu loops: they run as services (long-lived, stdin-enabled) but should not restart when the user quits cleanly (exit 0).

Example:
```json
{
  "name": "interactive-cli",
  "command": "node cli.js",
  "type": "service",
  "restart": "on-failure",
  "input": { "enabled": true }
}
```

---

## Stage Configuration

Stages allow you to group related pipeline items together. When the pipeline is loaded, stages are "flattened" into individual items, with stage properties propagating to their steps.

### Stage Schema

```typescript
{
  "name": string,                 // Required: Unique stage name
  "type": "stage",                // Required: Must be "stage"
  "manual": boolean,              // Optional: All steps require manual start
  "trigger_on": string[],         // Optional: Event triggers for all steps
  "steps": PipelineItem[]         // Required: Array of pipeline items
}
```

### How Flattening Works

When a stage is flattened:

1. **`manual` propagation**: `effectiveManual = stage.manual OR step.manual`
2. **`trigger_on` propagation**: Non-manual steps inherit stage's `trigger_on` merged with their own
3. **Manual steps don't inherit triggers**: If a step is manual (directly or via stage), it doesn't inherit `trigger_on`

### Example: Build Stage

```json
{
  "name": "build-stage",
  "type": "stage",
  "trigger_on": ["lint:success"],
  "steps": [
    {
      "name": "build-frontend",
      "command": "npm run build:frontend",
      "type": "task",
      "events": {
        "on_stdout": [{ "pattern": "Built", "emit": "frontend:built" }]
      }
    },
    {
      "name": "build-backend",
      "command": "npm run build:backend",
      "type": "task",
      "events": {
        "on_stdout": [{ "pattern": "Built", "emit": "backend:built" }]
      }
    }
  ]
}
```

After flattening, both `build-frontend` and `build-backend` will have `trigger_on: ["lint:success"]`.

### Example: Manual Stage

```json
{
  "name": "deploy-stage",
  "type": "stage",
  "manual": true,
  "steps": [
    {
      "name": "deploy-frontend",
      "command": "npm run deploy:frontend",
      "type": "task"
    },
    {
      "name": "deploy-backend",
      "command": "npm run deploy:backend",
      "type": "task"
    }
  ]
}
```

Both steps become manual and must be started explicitly with `clier service start deploy-frontend`.

### Mixed Pipeline Example

You can mix stages with top-level items:

```json
{
  "pipeline": [
    {
      "name": "db",
      "command": "docker-compose up db",
      "type": "service",
      "events": {
        "on_stdout": [{ "pattern": "ready", "emit": "db:ready" }]
      }
    },
    {
      "name": "build-stage",
      "type": "stage",
      "trigger_on": ["db:ready"],
      "steps": [
        { "name": "build-api", "command": "npm run build:api", "type": "task" },
        { "name": "build-worker", "command": "npm run build:worker", "type": "task" }
      ]
    },
    {
      "name": "tests",
      "command": "npm test",
      "type": "task",
      "trigger_on": ["build-api:exit", "build-worker:exit"]
    }
  ]
}
```

### Viewing Stage Groupings

Use `clier status --json` to see which processes belong to which stages:

```bash
clier status --json | jq '.stages'
```

---

### Input Configuration

Enables sending data to a process's stdin at runtime.

```typescript
{
  "enabled": boolean  // Required: Enable stdin input (default: false)
}
```

#### Fields

**`enabled`** (required)
- Type: `boolean`
- Default: `false`
- Description: Whether stdin input is enabled for this process
- When `true`: Process stdin stays open and accepts input via `clier input`
- When `false`: Process stdin is closed (default behavior)

#### Usage

1. Configure the pipeline stage with input enabled:

```json
{
  "name": "interactive-app",
  "command": "node repl.js",
  "type": "service",
  "input": {
    "enabled": true
  }
}
```

2. Send input to the running process:

```bash
# Send a line of input (newline appended by default)
clier input interactive-app "hello world"

# Send input without appending newline
clier input interactive-app "data" --no-newline
```

#### Example: Interactive REPL

```json
{
  "name": "python-repl",
  "command": "python3 -i",
  "type": "service",
  "input": {
    "enabled": true
  }
}
```

Then interact with it:

```bash
clier input python-repl "print('Hello from Python!')"
clier input python-repl "x = 42"
clier input python-repl "print(x * 2)"
```

#### Use Cases

| Scenario | Description |
|----------|-------------|
| Interactive REPLs | Send commands to Python, Node, or shell processes |
| Database CLIs | Execute SQL queries via stdin |
| Testing | Send test input to interactive applications |
| Automation | Script interactions with stdin-driven tools |

---

### Events Configuration

```typescript
{
  "on_stdout": StdoutEvent[],     // Required: Stdout pattern matching
  "on_stderr": boolean,           // Optional: Stderr event emission
  "on_crash": boolean             // Optional: Crash event emission
}
```

#### Fields

**`on_stdout`** (required)
- Type: `StdoutEvent[]` (array of pattern-event pairs)
- Description: Pattern matching rules for stdout
- Behavior: ALL matching patterns emit their events
- Can be empty array if no stdout events needed

**`on_stderr`** (optional)
- Type: `boolean`
- Default: `true`
- Description: Whether to emit `${name}:error` event on stderr output
- Example: If `name: "api"`, emits `api:error` on stderr

**`on_crash`** (optional)
- Type: `boolean`
- Default: `true`
- Description: Whether to emit `${name}:crashed` event when process crashes
- Example: If `name: "api"`, emits `api:crashed` on exit code != 0

#### Stdout Event Pattern

```typescript
{
  "pattern": string,  // Required: Regular expression
  "emit": string      // Required: Event name to emit
}
```

**`pattern`** (required)
- Type: `string` (regular expression)
- Description: Regex pattern to match against stdout
- Escape special characters: `\\[`, `\\]`, `\\.`
- Examples:
  - `"Server listening"` - Literal string
  - `"\\[INFO\\]"` - Matches `[INFO]`
  - `"v\\d+\\.\\d+\\.\\d+"` - Matches version numbers
  - `".*ready.*"` - Contains "ready"

**`emit`** (required)
- Type: `string`
- Description: Event name to emit when pattern matches
- Convention: `process-name:event-type`
- Examples: `"backend:ready"`, `"build:success"`, `"db:connected"`

#### Example

```json
{
  "events": {
    "on_stdout": [
      { "pattern": "Server listening on port", "emit": "api:ready" },
      { "pattern": "Database connected", "emit": "db:ready" }
    ],
    "on_stderr": true,
    "on_crash": true
  }
}
```

---

## Event System

### How Events Work

1. **Pattern Matching**: Stdout/stderr is checked against all patterns
2. **Event Emission**: ALL matching patterns emit their events
3. **Event Bus**: Events are published to the event bus
4. **Trigger Execution**: Processes with matching `trigger_on` start

### Event Types

#### Custom Events (stdout patterns)
```json
{
  "on_stdout": [
    { "pattern": "SUCCESS", "emit": "build:success" }
  ]
}
```

#### Built-in Events

**Error Event**: `${name}:error`
- Triggered by: stderr output
- Controlled by: `on_stderr: true`
- Example: `api:error`

**Crash Event**: `${name}:crashed`
- Triggered by: non-zero exit code
- Controlled by: `on_crash: true`
- Example: `api:crashed`

**Circuit Breaker Event**: `circuit-breaker:triggered`
- Triggered by: Circuit breaker opening (too many crashes)
- Always available
- Use for: Alerting, monitoring, recovery

### Multi-Pattern Matching

All patterns are checked, and ALL matches emit events:

```json
{
  "name": "logger",
  "events": {
    "on_stdout": [
      { "pattern": "\\[INFO\\]", "emit": "log:info" },
      { "pattern": "\\[WARN\\]", "emit": "log:warn" },
      { "pattern": "\\[ERROR\\]", "emit": "log:error" }
    ]
  }
}
```

If stdout contains `[INFO] [WARN]`, BOTH events are emitted.

### Event Chaining

Create dependencies by triggering on events:

```json
{
  "pipeline": [
    {
      "name": "db",
      "events": {
        "on_stdout": [{ "pattern": "ready", "emit": "db:ready" }]
      }
    },
    {
      "name": "api",
      "trigger_on": ["db:ready"]
    },
    {
      "name": "worker",
      "trigger_on": ["db:ready"]
    }
  ]
}
```

Flow: `db` starts → emits `db:ready` → `api` and `worker` start in parallel

---

## Manual Start Mode

Services can be configured to not auto-start with the pipeline, requiring explicit manual start.

### Configuration

Set `manual: true` on a pipeline stage:

```json
{
  "name": "debug-server",
  "command": "node debug-server.js",
  "type": "service",
  "manual": true
}
```

### Starting Manual Services

```bash
# Start a specific manual service
clier service start debug-server

# Stop it when done
clier service stop debug-server
```

### Reloading with Manual Services

By default, `clier reload` does not restart manually-started services. To also restart any running manual services during reload:

```bash
clier reload --restart-manual
```

This is useful when you've changed configuration and want manual services to pick up the changes.

### Use Cases

| Scenario | Description |
|----------|-------------|
| Debug tools | Services only needed during debugging |
| One-off utilities | Tools that shouldn't run continuously |
| Resource-heavy services | Services you only start when needed |
| Development aids | Hot reloaders, profilers, etc. |

### Example: Optional Debug Server

```json
{
  "project_name": "my-app",
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  },
  "pipeline": [
    {
      "name": "api",
      "command": "node server.js",
      "type": "service"
    },
    {
      "name": "debug-inspector",
      "command": "node --inspect debug-tools.js",
      "type": "service",
      "manual": true
    }
  ]
}
```

When you run `clier start`:
- `api` starts automatically
- `debug-inspector` does NOT start

To start the debug inspector when needed:
```bash
clier service start debug-inspector
```

---

## Safety Mechanisms

### Debouncing

**Purpose**: Prevent tight restart loops when a process crashes repeatedly.

**How it works**:
1. Process crashes
2. Wait `debounce_ms` milliseconds
3. Then restart (if it's a service)

**Configuration**:
```json
{
  "safety": {
    "debounce_ms": 500  // Wait 500ms before restart
  }
}
```

**Use cases**:
- Prevent CPU thrashing from fast restart loops
- Allow transient issues to resolve
- Rate limit restart attempts

### Rate Limiting

**Purpose**: Limit total operations per minute across the entire pipeline.

**How it works**:
1. Track all process starts
2. If limit exceeded, queue operations
3. Process queue as rate allows

**Configuration**:
```json
{
  "safety": {
    "max_ops_per_minute": 60  // Max 60 starts/minute
  }
}
```

**Use cases**:
- Prevent resource exhaustion
- Protect external services
- Control system load

### Circuit Breaker

**Purpose**: Stop cascading failures by detecting repeated crashes.

**How it works**:
1. Track crash count per process
2. If threshold exceeded in time window, circuit opens
3. Emit `circuit-breaker:triggered` event
4. Stop the failing process

**Built-in behavior** (not configurable):
- Threshold: 3 crashes
- Time window: 5 seconds
- Reset timeout: 10 seconds

**Usage**:
```json
{
  "pipeline": [
    {
      "name": "crasher",
      "type": "service"
    },
    {
      "name": "alert",
      "type": "task",
      "trigger_on": ["circuit-breaker:triggered"],
      "command": "node send-alert.js"
    }
  ]
}
```

---

## Continue on Failure

Control how failures propagate through the pipeline.

### Strict Mode (default)

`continue_on_failure: false` or omitted

**Behavior**:
- Process failure blocks dependent processes
- Events ARE still emitted
- Use for critical operations

**Example**:
```json
{
  "name": "build",
  "type": "task",
  "continue_on_failure": false,  // or omit
  "events": {
    "on_stdout": [
      { "pattern": "SUCCESS", "emit": "build:success" },
      { "pattern": "FAILURE", "emit": "build:failure" }
    ]
  }
}
```

If build fails:
- `build:failure` event IS emitted
- Processes triggered by `build:success` DO NOT start
- Processes triggered by `build:failure` DO start

### Lenient Mode

`continue_on_failure: true`

**Behavior**:
- Process failure does NOT block dependents
- Events are emitted normally
- Exit code is swallowed
- Use for optional operations

**Example**:
```json
{
  "name": "cache-warm",
  "type": "task",
  "continue_on_failure": true,
  "events": {
    "on_stdout": [
      { "pattern": "SUCCESS", "emit": "cache:ready" },
      { "pattern": "FAILURE", "emit": "cache:failed" }
    ]
  }
}
```

If cache warming fails:
- `cache:failed` event IS emitted
- Pipeline continues
- Dependent processes can still start

### Use Cases

| Scenario | Mode | Rationale |
|----------|------|-----------|
| Database migration | Strict | Must succeed before app starts |
| Build/compile | Strict | Can't run broken code |
| Cache warming | Lenient | App works without cache |
| Metrics collection | Lenient | Don't block on telemetry |
| Notification sending | Lenient | Don't block on external service |

---

## Environment Variables

### System Environment

By default, processes inherit system environment:

```json
{
  "global_env": true  // default
}
```

Disable for isolated environments:

```json
{
  "global_env": false
}
```

### Process-Specific Environment

Set per-process variables:

```json
{
  "name": "api",
  "env": {
    "PORT": "3000",
    "LOG_LEVEL": "debug"
  }
}
```

### Variable Substitution

Reference existing environment variables:

```json
{
  "env": {
    "DATABASE_URL": "${DATABASE_URL}",
    "API_KEY": "${SECRET_API_KEY}",
    "PORT": "${PORT:-3000}"  // Default value if not set
  }
}
```

**Syntax**:
- `${VAR}` - Use value of VAR (error if not set)
- `${VAR:-default}` - Use VAR or default if not set
- `$$VAR` - Literal `$VAR` (escape)

---

## Examples

### Simple Service (No Events)

For simple use cases where you don't need event coordination:

```json
{
  "name": "web",
  "command": "npm start",
  "type": "service",
  "env": {
    "PORT": "8080"
  }
}
```

No `events` configuration needed - the service will run normally without special event emissions.

### Basic Service with Events

For event-driven coordination:

```json
{
  "name": "web",
  "command": "npm start",
  "type": "service",
  "env": {
    "PORT": "8080"
  },
  "events": {
    "on_stdout": [
      { "pattern": "listening", "emit": "web:ready" }
    ],
    "on_stderr": true,
    "on_crash": true
  }
}
```

### Sequential Tasks

```json
{
  "pipeline": [
    {
      "name": "install",
      "command": "npm install",
      "type": "task",
      "events": {
        "on_stdout": [
          { "pattern": "up to date", "emit": "install:done" }
        ]
      }
    },
    {
      "name": "build",
      "command": "npm run build",
      "type": "task",
      "trigger_on": ["install:done"],
      "events": {
        "on_stdout": [
          { "pattern": "Build complete", "emit": "build:done" }
        ]
      }
    },
    {
      "name": "test",
      "command": "npm test",
      "type": "task",
      "trigger_on": ["build:done"]
    }
  ]
}
```

### Parallel Services with Shared Trigger

```json
{
  "pipeline": [
    {
      "name": "db",
      "command": "docker-compose up db",
      "type": "service",
      "events": {
        "on_stdout": [
          { "pattern": "ready to accept connections", "emit": "db:ready" }
        ]
      }
    },
    {
      "name": "api",
      "command": "node api.js",
      "type": "service",
      "trigger_on": ["db:ready"]
    },
    {
      "name": "worker",
      "command": "node worker.js",
      "type": "service",
      "trigger_on": ["db:ready"]
    }
  ]
}
```

### Complete Example

```json
{
  "project_name": "my-app",
  "global_env": true,
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  },
  "pipeline": [
    {
      "name": "lint",
      "command": "npm run lint",
      "type": "task",
      "events": {
        "on_stdout": [
          { "pattern": "✓", "emit": "lint:success" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "build",
      "command": "npm run build",
      "type": "task",
      "trigger_on": ["lint:success"],
      "events": {
        "on_stdout": [
          { "pattern": "Build completed", "emit": "build:success" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "api",
      "command": "node dist/server.js",
      "type": "service",
      "trigger_on": ["build:success"],
      "env": {
        "PORT": "3000",
        "NODE_ENV": "production"
      },
      "events": {
        "on_stdout": [
          { "pattern": "Server listening", "emit": "api:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    }
  ]
}
```

---

## Validation

Use `clier validate` to check your configuration:

```bash
clier validate
```

Checks:
- JSON syntax
- Schema compliance
- Unique names
- Valid event patterns
- Circular dependencies

Common errors:
- Duplicate process names
- Empty strings
- Invalid regex patterns
- Missing required fields
- Type mismatches

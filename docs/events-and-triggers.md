# Events & Triggers

How clier processes communicate through events and coordinate startup with triggers.

## Table of Contents

- [Overview](#overview)
- [Event Types](#event-types)
- [Emitting Events](#emitting-events)
  - [Stdout Pattern Matching](#stdout-pattern-matching)
  - [Built-in Event Controls](#built-in-event-controls)
  - [Success Filter](#success-filter)
- [Triggering Processes](#triggering-processes)
  - [trigger_on](#trigger_on)
  - [Entry Points vs Triggered Processes](#entry-points-vs-triggered-processes)
  - [Event Lifecycle (Per-Process Tracking)](#event-lifecycle-per-process-tracking)
  - [Re-triggering After Exit](#re-triggering-after-exit)
  - [continue_on_failure](#continue_on_failure)
- [Event Templates](#event-templates)
  - [Configuration](#configuration)
  - [Available Variables](#available-variables)
  - [Example](#example)
- [Patterns & Examples](#patterns--examples)
  - [Sequential Pipeline](#sequential-pipeline-lint--build--deploy)
  - [Fan-out](#fan-out-one-event-triggers-multiple-processes)
  - [Fan-in](#fan-in-process-waits-for-multiple-events)
  - [Error Recovery](#error-recovery-trigger-on-crash)
  - [Circuit Breaker Response](#circuit-breaker-response)
- [Workflow Events](#workflow-events)

## Overview

Events are named signals emitted by processes during their lifecycle. Triggers are conditions that start other processes in response to those events. Together they form the coordination layer that turns a collection of independent processes into an orchestrated pipeline.

The flow works like this: a process writes to stdout or exits → clier matches the output against configured patterns (or evaluates the exit code) → a named event is emitted onto the event bus → the orchestrator checks all processes with `trigger_on` → any process whose trigger conditions are fully satisfied is started.

## Event Types

| Event | When emitted | `type` field | `data` field | Controlled by |
|---|---|---|---|---|
| `<name>:success` | Process exits with code 0 (or `success_filter` matches) | `"success"` | `{ code }` | `success_filter` |
| `<name>:error` | Process writes to stderr | `"error"` | stderr line | `events.on_stderr` |
| `<name>:crashed` | Process exits with non-zero code (and `success_filter` doesn't match) | `"crashed"` | `{ code, signal }` | `events.on_crash` |
| Custom events | Stdout line matches an `on_stdout` pattern | `"custom"` | matched line | `events.on_stdout` |
| `circuit-breaker:triggered` | A process exceeds the crash threshold | `"custom"` | `{ crashCount, threshold }` | `safety.circuit_breaker` |

Notes:
- `:success` and `:crashed` are mutually exclusive — a process exit produces one or the other, never both.
- Services with `restart: "always"` that exit with code 0 do **not** emit `:success` (they restart instead).

## Emitting Events

### Stdout Pattern Matching

The `events.on_stdout` array defines regex patterns that match against each line of process stdout. When a line matches, the corresponding event name is emitted.

```json
{
  "name": "backend",
  "type": "service",
  "command": "node server.js",
  "events": {
    "on_stdout": [
      { "pattern": "listening on port \\d+", "emit": "backend:ready" },
      { "pattern": "connected to database", "emit": "backend:db-connected" }
    ]
  }
}
```

Key details:
- Patterns are JavaScript regex strings (passed to `new RegExp()`)
- Each stdout line is tested against **all** patterns — every match fires, not just the first
- The event `type` for pattern-matched events is `"custom"`

### Built-in Event Controls

Two boolean fields control whether built-in events are emitted:

| Field | Default | Event suppressed when `false` |
|---|---|---|
| `events.on_stderr` | `true` | `<name>:error` |
| `events.on_crash` | `true` | `<name>:crashed` |

```json
{
  "name": "noisy-service",
  "type": "service",
  "command": "legacy-app",
  "events": {
    "on_stdout": [],
    "on_stderr": false,
    "on_crash": false
  }
}
```

When `on_stderr` is `false`, stderr output is still captured and displayed — it just doesn't emit an event. When `on_crash` is `false`, the process still exits and may restart, but no `:crashed` event reaches dependents.

### Success Filter

`success_filter` overrides exit-code-based success determination. Instead of checking whether the exit code is 0, clier inspects the process's captured output to decide if the run was successful.

```json
{
  "name": "flaky-script",
  "type": "task",
  "command": "python migrate.py",
  "success_filter": {
    "stdout_pattern": "migration complete",
    "stderr_pattern": "all checks passed"
  }
}
```

How it works:
- Evaluated at process exit against the complete buffered output (not streaming)
- If **any** stdout line matches `stdout_pattern` **or** any stderr line matches `stderr_pattern`, the process is treated as successful and emits `<name>:success`
- If neither pattern matches, the process is treated as crashed and emits `<name>:crashed` (if `on_crash` is not disabled)
- At least one of `stdout_pattern` or `stderr_pattern` must be provided
- Both fields are regex strings

This is useful for processes that exit with non-zero codes but log success messages, or processes where exit code alone is unreliable.

## Triggering Processes

### trigger_on

`trigger_on` is an array of event names that must **all** be received before a process starts. This is AND logic — every listed event must fire.

Single trigger:

```json
{
  "name": "tests",
  "type": "task",
  "command": "npm test",
  "trigger_on": ["build:success"]
}
```

Multiple triggers (AND):

```json
{
  "name": "integration-tests",
  "type": "task",
  "command": "npm run test:integration",
  "trigger_on": ["api:ready", "db:ready", "cache:ready"]
}
```

The integration tests process will not start until all three events — `api:ready`, `db:ready`, and `cache:ready` — have been received.

### Entry Points vs Triggered Processes

| Configuration | Behavior |
|---|---|
| No `trigger_on` | Entry point — starts immediately when the pipeline launches |
| `trigger_on: [...]` | Triggered — waits for all listed events |
| `manual: true` | Manual — only starts via `clier service start <name>` or `clier trigger <name>` |

A process with both `trigger_on` and `manual: true` will not auto-trigger from events; it must be started manually.

### Event Lifecycle (Per-Process Tracking)

Events are tracked **per dependent process**, not globally. Each process with `trigger_on` has its own independent set of received events.

When all triggers for a process are satisfied:
1. The process starts
2. Its received event set is **cleared**
3. To trigger the process again, **all** events must fire again fresh

This per-process clearing model prevents stale events from previous cycles from satisfying future trigger conditions.

**Example — why this matters:**

```json
[
  { "name": "api", "type": "service", "command": "node api.js",
    "events": { "on_stdout": [{ "pattern": "ready", "emit": "api:ready" }] } },
  { "name": "worker", "type": "service", "command": "node worker.js",
    "events": { "on_stdout": [{ "pattern": "ready", "emit": "worker:ready" }] } },
  { "name": "monitor", "type": "task", "command": "node check.js",
    "trigger_on": ["api:ready", "worker:ready"] }
]
```

Suppose `api:ready` fires, then `worker:ready` fires — `monitor` starts and its received set is cleared. Later, `api:ready` fires again (the API restarted). The monitor does **not** start because it only has `api:ready` — it's still waiting for a fresh `worker:ready`. Without per-process clearing, the stale `worker:ready` from the first cycle would incorrectly satisfy the trigger.

### Re-triggering After Exit

Once a triggered process exits (completes or crashes), it can be triggered again by the same event sequence. The orchestrator checks whether the process is **currently running**, not whether it has ever run. This means:

- A currently running process **cannot** be started again by events (prevents duplicate instances)
- A process that has exited **can** be re-triggered by fresh events

### continue_on_failure

`continue_on_failure` controls whether error and crash events from a process propagate to its dependents. It is set on the **source** process (the one that fails), not on the dependent.

| Source event type | `continue_on_failure` | Dependent behavior |
|---|---|---|
| `:success` | any | Dependent starts normally |
| `:error` or `:crashed` | `false` (default) | Dependent is **skipped** |
| `:error` or `:crashed` | `true` | Dependent starts normally |

```json
{
  "name": "lint",
  "type": "task",
  "command": "npm run lint",
  "continue_on_failure": true,
  "events": {
    "on_stdout": [],
    "on_crash": true
  }
}
```

With this config, even if `lint` crashes, any process with `trigger_on: ["lint:crashed"]` will still start. Without `continue_on_failure: true`, dependents triggered by error/crash events would be skipped.

## Event Templates

### Configuration

Enable event templates on the **triggered** process by setting `enable_event_templates: true`. Template variables in `command` and `env` values are substituted with event and process data when the process starts.

```json
{
  "name": "handler",
  "type": "task",
  "command": "node handle.js --source={{event.source}} --type={{event.type}}",
  "trigger_on": ["api:error"],
  "enable_event_templates": true
}
```

### Available Variables

| Variable | Description | Example value |
|---|---|---|
| `{{event.name}}` | Name of the triggering event | `"api:error"` |
| `{{event.source}}` | Process that emitted the event | `"api"` |
| `{{event.type}}` | Event type | `"custom"`, `"success"`, `"error"`, `"crashed"` |
| `{{event.timestamp}}` | Unix milliseconds when the event was emitted | `"1706012345678"` |
| `{{process.name}}` | Name of the process being started | `"handler"` |
| `{{process.type}}` | Process type | `"service"` or `"task"` |
| `{{clier.project}}` | Project name from config | `"my-app"` |
| `{{clier.timestamp}}` | Current timestamp at process start | `"1706012345678"` |

Notes:
- `event.*` variables are only available on triggered processes (not entry points)
- Unknown variables are left unchanged and produce a warning
- Templates are applied to both `command` and `env` value strings

### Example

A producer-consumer pipeline where the error handler receives context about which process failed:

```json
{
  "project_name": "my-app",
  "pipeline": [
    {
      "name": "api",
      "type": "service",
      "command": "node api.js",
      "continue_on_failure": true,
      "events": {
        "on_stdout": [],
        "on_crash": true
      }
    },
    {
      "name": "error-reporter",
      "type": "task",
      "command": "node report.js --process={{event.source}} --event={{event.name}}",
      "trigger_on": ["api:crashed"],
      "enable_event_templates": true,
      "env": {
        "FAILURE_TYPE": "{{event.type}}",
        "FAILED_AT": "{{event.timestamp}}"
      }
    }
  ]
}
```

When `api` crashes, `error-reporter` starts with the command expanded to:

```
node report.js --process=api --event=api:crashed
```

And environment variables `FAILURE_TYPE=crashed` and `FAILED_AT=1706012345678`.

## Patterns & Examples

### Sequential Pipeline (lint → build → deploy)

Each step triggers the next on success:

```json
{
  "pipeline": [
    {
      "name": "lint",
      "type": "task",
      "command": "npm run lint",
      "events": { "on_stdout": [] }
    },
    {
      "name": "build",
      "type": "task",
      "command": "npm run build",
      "trigger_on": ["lint:success"],
      "events": { "on_stdout": [] }
    },
    {
      "name": "deploy",
      "type": "task",
      "command": "npm run deploy",
      "trigger_on": ["build:success"]
    }
  ]
}
```

### Fan-out (one event triggers multiple processes)

Multiple processes listen for the same event:

```json
{
  "pipeline": [
    {
      "name": "build",
      "type": "task",
      "command": "npm run build",
      "events": { "on_stdout": [] }
    },
    {
      "name": "unit-tests",
      "type": "task",
      "command": "npm test",
      "trigger_on": ["build:success"]
    },
    {
      "name": "e2e-tests",
      "type": "task",
      "command": "npm run test:e2e",
      "trigger_on": ["build:success"]
    },
    {
      "name": "type-check",
      "type": "task",
      "command": "npx tsc --noEmit",
      "trigger_on": ["build:success"]
    }
  ]
}
```

All three test processes start in parallel when `build:success` fires.

### Fan-in (process waits for multiple events)

A process waits for multiple dependencies:

```json
{
  "pipeline": [
    {
      "name": "db",
      "type": "service",
      "command": "docker compose up db",
      "events": {
        "on_stdout": [{ "pattern": "ready to accept connections", "emit": "db:ready" }]
      }
    },
    {
      "name": "cache",
      "type": "service",
      "command": "docker compose up redis",
      "events": {
        "on_stdout": [{ "pattern": "Ready to accept connections", "emit": "cache:ready" }]
      }
    },
    {
      "name": "api",
      "type": "service",
      "command": "node api.js",
      "trigger_on": ["db:ready", "cache:ready"]
    }
  ]
}
```

The `api` service starts only after both `db:ready` and `cache:ready` have fired.

### Error Recovery (trigger on crash)

Respond to failures with a recovery process:

```json
{
  "pipeline": [
    {
      "name": "worker",
      "type": "service",
      "command": "node worker.js",
      "continue_on_failure": true,
      "events": {
        "on_stdout": [],
        "on_crash": true
      }
    },
    {
      "name": "cleanup",
      "type": "task",
      "command": "node cleanup.js",
      "trigger_on": ["worker:crashed"]
    }
  ]
}
```

When `worker` crashes, `cleanup` runs. Note that `continue_on_failure: true` is set on `worker` so that the crash event propagates to dependents.

### Circuit Breaker Response

React when a process exceeds its crash threshold:

```json
{
  "safety": {
    "circuit_breaker": {
      "enabled": true,
      "error_threshold": 5
    }
  },
  "pipeline": [
    {
      "name": "unstable-service",
      "type": "service",
      "command": "node unstable.js"
    },
    {
      "name": "alert",
      "type": "task",
      "command": "node alert.js --service={{event.source}}",
      "trigger_on": ["circuit-breaker:triggered"],
      "enable_event_templates": true
    }
  ]
}
```

When `unstable-service` crashes more than 5 times, the circuit breaker trips, emitting `circuit-breaker:triggered`. The `alert` task starts with `{{event.source}}` replaced by the crashing process name.

## Workflow Events

Workflows participate in the same event system as pipeline processes. They can be triggered by events and emit their own lifecycle events:

| Event | When emitted |
|---|---|
| `<name>:started` | Workflow begins executing |
| `<name>:completed` | All steps finished successfully |
| `<name>:failed` | A step failed (and `on_failure` caused abort) |
| `<name>:cancelled` | Workflow was cancelled |

Workflows use `trigger_on` with the same AND logic as pipeline processes, and clear received events per-run using the same model.

See [Workflows](workflows.md) for full workflow documentation including step actions, conditions, and failure handling.

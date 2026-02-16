# Workflows

Workflows are sequential, triggerable chains of operations that can stop, start, restart processes, evaluate conditions, and await events — all as a single coordinated unit.

## Table of Contents

- [Overview](#overview)
- [Configuration](#configuration)
- [Step Actions](#step-actions)
- [Conditions](#conditions)
- [Failure Handling](#failure-handling)
- [Events](#events)
- [CLI Commands](#cli-commands)
- [Examples](#examples)

## Overview

Add `type: "workflow"` entries to your pipeline array alongside services, tasks, and stages. Workflows execute their steps sequentially and can be triggered manually via CLI or automatically by events.

Key properties:
- **Sequential execution**: Steps run one at a time, in order
- **Concurrency control**: A workflow rejects if already running
- **References only**: Steps reference existing pipeline items by name (no inline commands)
- **Event integration**: Workflows emit events and can be triggered by events

## Configuration

```json
{
  "name": "rebuild-web",
  "type": "workflow",
  "manual": true,
  "trigger_on": ["config:changed"],
  "on_failure": "abort",
  "timeout_ms": 300000,
  "steps": [
    {
      "action": "stop",
      "process": "web",
      "if": { "process": "web", "is": "running" }
    },
    {
      "action": "run",
      "process": "build-web",
      "await": "build-web:success",
      "timeout_ms": 60000
    },
    {
      "action": "start",
      "process": "web",
      "await": "web:ready"
    }
  ]
}
```

### Workflow-Level Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Unique workflow name |
| `type` | `"workflow"` | required | Must be `"workflow"` |
| `manual` | `boolean` | `false` | Only trigger via CLI (not via events) |
| `trigger_on` | `string[]` | `[]` | Events that auto-trigger this workflow |
| `on_failure` | `string` | `"abort"` | Default failure handling for steps |
| `timeout_ms` | `number` | `600000` | Whole-workflow timeout (10 min default) |
| `steps` | `WorkflowStep[]` | required | Array of steps to execute sequentially |

### Common Step Fields

| Field | Type | Description |
|-------|------|-------------|
| `action` | `string` | Step action (see below) |
| `process` | `string` | Target pipeline process name |
| `event` | `string` | Event name (for `await`/`emit` actions) |
| `await` | `string` | Event to wait for after the action |
| `timeout_ms` | `number` | Per-step timeout (overrides workflow-level) |
| `if` | `Condition` | Skip step if condition is false |
| `on_failure` | `string` | Per-step failure handling override |
| `data` | `object` | Data payload (for `emit` action) |

## Step Actions

| Action | Description | Required Fields | Optional Fields |
|--------|-------------|-----------------|-----------------|
| `run` | Execute a pipeline task/service | `process` | `await`, `timeout_ms` |
| `stop` | Stop a running process | `process` | — |
| `start` | Start a pipeline process | `process` | `await`, `timeout_ms` |
| `restart` | Restart a process (stop + start) | `process` | `await`, `timeout_ms` |
| `await` | Wait for an event | `event` | `timeout_ms` |
| `emit` | Emit a custom event | `event` | `data` |

### Default Await Behavior

- **`run` with a task**: Automatically awaits `<process>:success` if no explicit `await` is set
- **`run` with a service**: Does not auto-await (proceeds immediately)
- **`stop`**: Internally awaits process exit (no explicit `await` needed)

## Conditions

Use the `if` field on any step to conditionally skip it.

### Process State Check

```json
{ "process": "web", "is": "running" }
{ "process": "web", "is": "stopped" }
{ "process": "web", "is": "crashed" }
```

### Logical Operators

```json
{ "not": { "process": "web", "is": "running" } }

{ "all": [
  { "process": "web", "is": "running" },
  { "process": "api", "is": "running" }
]}

{ "any": [
  { "process": "web", "is": "stopped" },
  { "process": "web", "is": "crashed" }
]}
```

## Failure Handling

The `on_failure` field controls what happens when a step fails. It can be set at the workflow level (default for all steps) or per-step (overrides workflow default).

| Value | Behavior |
|-------|----------|
| `"abort"` | Stop the workflow immediately, mark as failed (default) |
| `"continue"` | Log the failure and proceed to the next step |
| `"skip_rest"` | Skip all remaining steps and complete the workflow |

## Events

Workflows emit lifecycle events through the normal event system:

| Event | When |
|-------|------|
| `<name>:started` | Workflow begins execution |
| `<name>:completed` | All steps finished successfully |
| `<name>:failed` | Workflow failed (step failure with `abort`) |
| `<name>:cancelled` | Workflow was manually cancelled |

These events can be used as `trigger_on` for other pipeline items or workflows, enabling workflow chaining.

## CLI Commands

### Trigger a workflow

```bash
clier workflow run <name>
clier flow <name>          # shorthand alias
```

### Check status

```bash
clier workflow status [name]   # specific or all workflows
clier workflow list            # list all defined workflows
clier status                   # includes workflow section
```

### Cancel a running workflow

```bash
clier workflow cancel <name>
```

## Examples

### Rebuild and restart a service

```json
{
  "name": "rebuild-web",
  "type": "workflow",
  "manual": true,
  "steps": [
    { "action": "stop", "process": "web", "if": { "process": "web", "is": "running" } },
    { "action": "run", "process": "build-web" },
    { "action": "start", "process": "web", "await": "web:ready" }
  ]
}
```

```bash
clier flow rebuild-web
```

### Auto-triggered deployment pipeline

```json
{
  "name": "deploy",
  "type": "workflow",
  "trigger_on": ["tests:success"],
  "timeout_ms": 300000,
  "steps": [
    { "action": "run", "process": "build", "timeout_ms": 120000 },
    { "action": "run", "process": "deploy-staging" },
    { "action": "emit", "event": "deploy:complete", "data": { "env": "staging" } }
  ]
}
```

### Graceful restart with health check

```json
{
  "name": "rolling-restart",
  "type": "workflow",
  "manual": true,
  "on_failure": "abort",
  "steps": [
    { "action": "restart", "process": "api-1", "await": "api-1:ready", "timeout_ms": 30000 },
    { "action": "restart", "process": "api-2", "await": "api-2:ready", "timeout_ms": 30000 },
    { "action": "emit", "event": "restart:complete" }
  ]
}
```

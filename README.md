# Clier

> Give your AI agents shared, persistent access to running processes, logs, and orchestrated workflows.

## The Problem

When AI agents work on your codebase, they constantly need to start servers, run builds, check logs, and coordinate multiple processes. Each agent session starts blind -- no visibility into what's already running, no way to share a running process with another session, and no structured way to define "start the database, then the API, then the frontend."

Clier solves this. It runs your processes in a background daemon that any agent session (or terminal) can connect to, inspect, and control.

## What Clier Does

- **Shared process access** -- Multiple AI agent sessions and terminals connect to the same running processes. One agent starts the server, another checks its logs, a third restarts it.
- **Persistent background daemon** -- Processes keep running after your terminal or agent session closes. Come back later and pick up where you left off.
- **Declarative pipelines** -- Define your services, tasks, and their dependencies in a single JSON file. Clier handles startup order, event coordination, and restarts.
- **Live logs and status** -- Any connected session can tail logs, check process status, or watch for errors in real time.
- **Built-in safety** -- Rate limiting, debouncing, and circuit breakers prevent runaway restarts and cascading failures.

## Install

```bash
npm install -g clier-ai
```

Verify it's working:

```bash
clier --version
```

**Requirements:** Node.js >= 18.0.0, macOS or Linux.

## Quick Start

### 1. Create a pipeline config

Create `clier-pipeline.json` in your project root:

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
      "name": "backend",
      "command": "npm start",
      "type": "service",
      "events": {
        "on_stdout": [
          { "pattern": "Server listening", "emit": "backend:ready" }
        ]
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

### 2. Validate and start

```bash
clier validate
clier start
```

### 3. Check on things from any terminal or agent session

```bash
clier status            # See what's running
clier logs backend      # Tail backend output
clier logs --daemon     # See orchestration events
```

### 4. Stop when you're done

```bash
clier stop
```

## How It Works

Clier runs a background daemon that manages your processes over a Unix socket. Any terminal, script, or AI agent session can connect to it.

```
  Terminal 1       Agent Session       Terminal 2
      |                 |                  |
      '----------.------'------.-----------'
                 |             |
           Unix Socket IPC
                 |
         +-------v--------+
         | Clier Daemon   |
         | (background)   |
         +-------+--------+
                 |
     +-----------+-----------+
     |           |           |
  Process 1  Process 2  Process 3
```

## Pipeline Configuration

The `clier-pipeline.json` file is where you define what runs and how it connects together.

### Pipeline items

Each entry in the `pipeline` array is either a **service** (long-running, auto-restarted) or a **task** (runs once, exits):

```json
{
  "name": "api",
  "command": "node server.js",
  "type": "service",
  "env": { "PORT": "3000" },
  "cwd": "./backend"
}
```

Items without a `trigger_on` field start immediately. Items with `trigger_on` wait for the named event before starting.

### Events and triggers

This is the core of Clier's coordination. Processes can watch their own stdout for patterns and emit named events when they match. Other processes can wait for those events before starting.

```json
{
  "name": "database",
  "command": "docker-compose up db",
  "type": "service",
  "events": {
    "on_stdout": [
      { "pattern": "ready to accept connections", "emit": "db:ready" }
    ]
  }
}
```

The `pattern` is a regex matched against each line of stdout. When it matches, the named event is emitted on Clier's internal event bus. Any process with a matching `trigger_on` starts:

```json
{
  "name": "api",
  "command": "node server.js",
  "type": "service",
  "trigger_on": ["db:ready"]
}
```

**Built-in events** are also emitted automatically:
- `<name>:error` -- when a process writes to stderr
- `<name>:crashed` -- when a process exits with a non-zero code
- `<name>:success` -- when a task completes with exit code 0
- `circuit-breaker:triggered` -- when a process crashes repeatedly (3 times in 5 seconds)

You can trigger on any of these to build reactive workflows -- for example, sending an alert when a circuit breaker trips, or starting a fallback service when the primary crashes.

### Safety settings

The `safety` block protects against runaway restarts:

```json
{
  "safety": {
    "max_ops_per_minute": 60,
    "debounce_ms": 100
  }
}
```

- **`max_ops_per_minute`** -- Rate limit on process starts across the whole pipeline.
- **`debounce_ms`** -- Minimum wait time before restarting a crashed service.
- **Circuit breaker** -- Automatically stops a service that crashes 3 times within 5 seconds.

## CLI Reference

```bash
clier validate              # Check your pipeline config for errors
clier start                 # Launch the daemon and start the pipeline
clier status                # See all process states
clier status -w             # Live-updating status (watch mode)
clier logs <name>           # View a process's output
clier logs --daemon         # View Clier's own orchestration logs
clier stop                  # Gracefully stop everything
clier stop <name>           # Stop a single process
clier restart <name>        # Restart a single process
clier reload                # Hot-reload config without restarting the daemon
clier run <name>            # Start a stopped or manual process
clier kill <name>           # Force-stop a process (SIGKILL)
clier send <name> "input"   # Send stdin to a running process
clier emit <event>          # Manually fire an event
clier update                # Update Clier to the latest version
```

## Agent Integration

Clier is built to work with AI coding agents. Run `clier init` to generate agent-readable documentation into your project:

```bash
clier init            # Creates .claude/claude.md with Clier instructions
clier init --agents   # Creates .agents/agents.md for multi-agent setups
```

This gives agents the context they need to use `clier status`, `clier logs`, and other commands without additional prompting.

Agents can also view documentation at any time:

```bash
clier docs commands   # CLI command reference
clier docs pipeline   # Pipeline configuration guide
```

## Documentation

- **[Getting Started](docs/GETTING-STARTED.md)** -- Installation, architecture, and walkthrough examples
- **[Agent CLI Guide](docs/AGENTS.md)** -- Quick-reference command list optimized for AI agents
- **[Agent Pipeline Guide](docs/AGENTS-PIPELINE.md)** -- Pipeline configuration reference for AI agents
- **[Configuration Reference](docs/configuration.md)** -- Complete schema documentation for `clier-pipeline.json`
- **[API Reference](docs/api-reference.md)** -- TypeScript types and programmatic usage

## License

MIT

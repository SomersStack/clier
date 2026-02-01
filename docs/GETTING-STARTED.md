# Clier - Getting Started Guide

> Native Node.js process orchestration framework with event-driven pipeline management

## What is Clier?

Clier is a powerful orchestration tool that manages complex multi-process pipelines using a background daemon. It allows you to:

- Define process dependencies using events
- Chain services and tasks together
- React to stdout/stderr patterns with custom events
- Build resilient systems with circuit breakers and rate limiting
- Manage development and production workflows

## Key Features

### Event-Driven Architecture
- Pattern matching on stdout/stderr
- Custom event emission
- Trigger-based process execution
- Multi-pattern support (emit ALL matching events)

### Safety Mechanisms
- **Debouncing**: Prevent rapid restart loops
- **Rate Limiting**: Control operation frequency
- **Circuit Breaker**: Stop cascading failures automatically

### Process Types
- **Services**: Long-running processes (web servers, APIs, workers) - auto-restarted on failure (non-zero exit) by default
- **Tasks**: One-off operations (builds, tests, migrations) - exit when complete, never restarted
- **Restart Policy**: Control restart behavior per process with `restart: "always" | "on-failure" | "never"`

### Flexible Configuration
- Environment variable substitution
- Working directory control
- Continue-on-failure for graceful degradation
- JSON-based declarative config
- Type-safe with Zod validation

## Installation

```bash
npm install -g clier
```

This installs:
- `clier` CLI tool
- Native daemon process manager
- All dependencies

Verify installation:
```bash
clier --version
```

## Quick Start (5 Minutes)

### 1. Create a Configuration

Create `clier-pipeline.json`:

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
      "events": {
        "on_stdout": [
          { "pattern": "Compiled successfully", "emit": "frontend:ready" }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    }
  ]
}
```

### 2. Validate Configuration

```bash
clier validate
```

This checks:
- JSON syntax
- Schema compliance
- Circular dependencies
- Pattern validity

### 3. Start the Pipeline

```bash
clier start
```

This will:
1. Start the backend service
2. Wait for "Server listening" in stdout
3. Emit `backend:ready` event
4. Start the frontend service
5. Monitor both processes

### 4. Monitor Status

```bash
# View all processes
clier status

# View process logs
clier logs backend
clier logs frontend -n 50            # Last 50 lines
clier logs backend --since 5m        # Last 5 minutes

# View daemon logs (for debugging orchestration)
clier logs --daemon
clier logs --daemon --level error    # Errors only
```

### 5. Stop the Pipeline

```bash
clier stop
```

This gracefully shuts down all processes and their child processes.

## Common Patterns

For complete pattern examples and explanations, see the [Configuration Reference](configuration.md).

### Sequential Tasks (CI/CD)

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

### Service Dependencies

```json
{
  "pipeline": [
    {
      "name": "db",
      "command": "docker-compose up db",
      "type": "service",
      "events": {
        "on_stdout": [{ "pattern": "ready to accept connections", "emit": "db:ready" }]
      }
    },
    {
      "name": "api",
      "command": "node server.js",
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

**Flow**: Database → API and Worker start in parallel

### Parallel Services

```json
{
  "pipeline": [
    { "name": "api", "command": "node server.js", "type": "service" },
    { "name": "worker", "command": "node worker.js", "type": "service" },
    { "name": "scheduler", "command": "node scheduler.js", "type": "service" }
  ]
}
```

**Flow**: All start simultaneously (no dependencies)

### Graceful Degradation

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

## CLI Commands

All commands accept an optional `--config` flag (default: `./clier-pipeline.json`).

### Essential Commands

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

# Start pipeline (launches daemon in background)
clier start

# Check process status
clier status
clier status -w                      # Watch mode (live updates)
clier status -w -n 5                 # Watch with 5 second refresh
clier watch                          # Watch mode (alias for status -w)
clier watch -n 5                     # Watch with 5 second refresh

# View logs
clier logs <name>                    # Specific process logs
clier logs <name> -n 50              # Last 50 lines
clier logs <name> --since 5m         # Logs from last 5 minutes
clier logs --daemon                  # View daemon logs
clier logs --daemon --level error    # View daemon error logs only

# Stop a service, or stop all processes
clier stop <name>                    # Stop a specific service
clier stop                           # Stop entire pipeline
clier kill <name>                    # Force stop a service (SIGKILL)

# Restart a service, or restart daemon completely (new daemon PID)
clier restart <name>                 # Restart a specific service
clier restart                        # Restart daemon (new PID)
clier restart --config ./path        # Restart daemon with specific config

# Reload configuration (fast: same daemon PID, restarts all processes)
clier reload                         # Reload config, restart all processes
clier reload <name>                  # Restart a specific service
clier reload --restart-manual        # Also restart running manual services
clier reload --config ./path         # Reload with specific config
clier refresh                        # Alias for reload --restart-manual

# Update Clier to latest version
clier update                         # Update to latest version
clier update --check                 # Check if updates available
```

### Service Control Commands

Control individual services/processes dynamically:

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

# Dynamically add/remove services (runtime-only, not persisted to JSON)
clier service add <name> -c "command" [options]
clier service remove <name>

# Send stdin input to processes (requires input.enabled: true in config)
clier send <process> "data"              # Send input with newline
clier send <process> "data" --no-newline # Send without newline
```

**Note**: Service control commands modify the running daemon only. Changes do NOT persist to `clier-pipeline.json`. To persist changes, edit the config file and run `clier reload`.

### Stage Templates

Generate pipeline stages from built-in templates instead of writing configuration from scratch:

```bash
# List available templates
clier template list                      # Show all templates
clier template list --category service   # Filter by category

# Show template details
clier template show node-api             # View variables and config

# Generate a stage (outputs JSON to stdout)
clier template apply node-api --name my-api

# Customize with variables
clier template apply node-api --name backend --var entrypoint=src/index.js

# Add directly to clier-pipeline.json
clier template apply node-api --name my-api --add
```

**Available Templates:**

| Template | Type | Description |
|----------|------|-------------|
| `node-api` | service | Node.js API server with ready event |
| `dev-server` | service | Dev server (Vite/webpack) with HMR |
| `build-task` | task | Build step with success event |
| `lint-task` | task | Linting step for pipelines |

Templates are bundled with clier and loaded from the package's `templates/stages/` directory.

### Reload vs Restart

Understanding the difference between `reload` and `restart`:

| Command | Daemon Process | All Processes | Use Case |
|---------|---------------|---------------|----------|
| `clier reload` | **Same PID** ✓ | Restart ↻ | Config changes (fast, keeps daemon alive) |
| `clier restart` | **New PID** ↻ | Restart ↻ | Daemon issues (full cold start) |

**When to use `reload`:**
- You edited `clier-pipeline.json` (added/removed processes, changed commands, modified triggers)
- You want to apply config changes quickly
- The daemon itself is working fine

**When to use `restart`:**
- The daemon process itself is misbehaving
- You want a complete fresh start
- You're debugging daemon-level issues

For detailed command documentation, see the [Agent Guide](AGENTS.md).

## Daemon Architecture

Clier runs as a background daemon process, enabling:

- **Multi-session access**: Multiple terminal sessions can control the same pipeline
- **Persistence**: Pipeline continues running after CLI exits
- **Real-time queries**: Status and logs accessible from any session
- **Hot reload**: Configuration changes without full restart

### How it works

1. `clier start` spawns a detached daemon process
2. Daemon creates Unix socket at `.clier/daemon.sock`
3. CLI commands connect via IPC to query/control daemon
4. Daemon manages all processes via native `child_process`

```
CLI Session 1          CLI Session 2          CLI Session 3
     │                      │                      │
     └──────────────────────┼──────────────────────┘
                            │
                    Unix Socket IPC
                            │
                    ┌───────▼────────┐
                    │  Daemon Process │
                    │  (Background)   │
                    └───────┬─────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
     ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
     │Process 1│      │Process 2│      │Process 3│
     └─────────┘      └─────────┘      └─────────┘
```

### State Management

```
.clier/
├── daemon.pid      # Daemon process ID
├── daemon.sock     # Unix socket for IPC
└── logs/           # Log files
    ├── combined.log  # Daemon logs (all levels)
    ├── error.log     # Daemon errors only
    ├── backend.log   # Process logs
    └── frontend.log  # Process logs
```

#### Viewing Logs

Clier maintains two types of logs:

**Process Logs** - Output from your pipeline processes:
```bash
clier logs backend              # View backend process logs
clier logs backend -n 50        # Last 50 lines
clier logs backend --since 5m   # Last 5 minutes
```

**Daemon Logs** - Internal Clier orchestration logs:
```bash
clier logs --daemon             # View all daemon activity
clier logs --daemon --level error  # Only daemon errors
clier logs --daemon -n 200      # More context
```

Use daemon logs to debug:
- Process startup/shutdown issues
- Event triggering problems
- Circuit breaker activations
- Configuration reload errors
- Orchestration flow

### Project Root Discovery

Clier automatically finds the project root by searching upward through parent directories, similar to how Git finds `.git/` or npm finds `package.json`. This means you can run Clier commands from any subdirectory within your project.

## Component Architecture

```
┌─────────────┐
│   Config    │
│   Loader    │
└──────┬──────┘
       │
       v
┌─────────────┐      ┌─────────────┐
│  EventBus   │◄─────┤ EventHandler│
└──────┬──────┘      └─────────────┘
       │                     ▲
       v                     │
┌─────────────┐      ┌─────────────┐
│Orchestrator │◄─────┤   Pattern   │
└──────┬──────┘      │   Matcher   │
       │             └─────────────┘
       v
┌─────────────┐      ┌─────────────┐
│  Process    │◄─────┤   Native    │
│  Manager    │      │child_process│
└─────────────┘      └─────────────┘
       │
       v
┌─────────────┐
│   Safety    │
│ (Debounce,  │
│ RateLimit,  │
│ Circuit)    │
└─────────────┘
```

## Use Cases

### Development Workflows
- Start database, API, and frontend in correct order
- Hot reload on file changes
- Run tests when code changes

### CI/CD Pipelines
- Sequential build stages
- Parallel test execution
- Conditional deployments

### Microservices
- Service dependency management
- Health check monitoring
- Graceful startup/shutdown

### Data Pipelines
- ETL orchestration
- Event-driven processing
- Retry logic and error handling

## Requirements

- Node.js >= 18.0.0
- Unix-like OS (macOS, Linux) for Unix sockets
- Windows support planned

## Examples

See the `examples/` directory for complete working examples:

- **lint-build-api**: Complete CI/CD pipeline (lint → build → deploy)
- **circuit-breaker**: Circuit breaker triggering and recovery
- **continue-on-failure**: Graceful degradation patterns
- **multi-pattern**: Multiple event patterns from single process

Each example includes:
- Working configuration
- Supporting scripts
- README with explanation
- Usage instructions

## Further Documentation

- **[Agent CLI Guide](AGENTS.md)** - CLI commands quick reference for AI agents
- **[Agent Pipeline Guide](AGENTS-PIPELINE.md)** - Pipeline configuration for AI agents
- **[Configuration Reference](configuration.md)** - Complete schema documentation
- **[API Reference](api-reference.md)** - TypeScript types and programmatic usage

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## License

MIT

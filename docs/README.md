# Clier Documentation

> Native Node.js process orchestration framework with event-driven pipeline management

## What is Clier?

Clier is a powerful orchestration tool that manages complex multi-process pipelines using native Node.js child processes and a background daemon. It allows you to:

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
- **Services**: Long-running processes (web servers, APIs, workers)
- **Tasks**: One-off operations (builds, tests, migrations)

### Flexible Configuration
- Environment variable substitution
- Working directory control
- Continue-on-failure for graceful degradation
- JSON-based declarative config

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

# View logs
clier logs backend
clier logs frontend

# View all logs
clier logs
```

### 5. Stop the Pipeline

```bash
clier stop
```

This gracefully shuts down all processes.

## Common Patterns

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

### Parallel Services

```json
{
  "pipeline": [
    {
      "name": "api",
      "command": "node server.js",
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

## Documentation

- [Configuration Guide](./configuration.md) - Complete schema reference
- [API Reference](./api-reference.md) - TypeScript types and public API
- [Examples](./examples/README.md) - Real-world example pipelines

## Examples

Located in the `examples/` directory:

- **lint-build-api**: Complete CI/CD pipeline (lint → build → deploy)
- **circuit-breaker**: Circuit breaker triggering and recovery
- **continue-on-failure**: Graceful degradation patterns
- **multi-pattern**: Multiple event patterns from single process

Each example includes:
- Working configuration
- Supporting scripts
- README with explanation
- Usage instructions

## CLI Commands

```bash
# Start pipeline
clier start [--config ./path/to/config.json]

# Stop all processes
clier stop [--config ./path/to/config.json]

# View status
clier status [--config ./path/to/config.json]

# View logs
clier logs [process-name] [--config ./path/to/config.json]

# Reload configuration
clier reload [--config ./path/to/config.json]

# Validate configuration
clier validate [--config ./path/to/config.json]
```

Default config path: `./clier-pipeline.json`

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
├── daemon.log      # Daemon logs
└── logs/           # Process logs
    ├── backend.log
    └── frontend.log
```

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
- Unix-like OS (macOS, Linux) for Unix sockets (Windows support planned)

## Contributing

See the main [README.md](../README.md) for contribution guidelines.

## License

MIT

## Support

- GitHub Issues: [Report bugs](https://github.com/your-org/clier/issues)
- Documentation: [Full docs](./configuration.md)
- Examples: [See examples](./examples/README.md)

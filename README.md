# Clier

> Native Node.js process orchestration framework with event-driven pipeline management

## What is Clier?

Clier manages multi-process pipelines with event-driven coordination. Define your services and tasks in a JSON config, and Clier handles dependencies, restarts, and event-based triggers.

**Key Features:**
- Event-driven process coordination
- Pattern-based stdout/stderr monitoring
- Built-in safety (rate limiting, debouncing, circuit breakers)
- Type-safe configuration with Zod validation
- Background daemon architecture

## Quick Start

```bash
# Install globally
npm install -g clier

# Create configuration
cat > clier-pipeline.json << 'EOF'
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
    }
  ]
}
EOF

# Validate and start
clier validate
clier start

# Monitor
clier status
clier logs backend
clier logs --daemon  # View daemon orchestration logs
```

## Documentation

- **[Getting Started Guide](docs/GETTING-STARTED.md)** - Installation, architecture, and examples
- **[Agent CLI Guide](docs/AGENTS.md)** - CLI commands quick reference for AI agents
- **[Agent Pipeline Guide](docs/AGENTS-PIPELINE.md)** - Pipeline configuration for AI agents
- **[Configuration Reference](docs/configuration.md)** - Complete schema documentation
- **[API Reference](docs/api-reference.md)** - TypeScript types and programmatic usage

## CLI Commands

```bash
clier init                  # Initialize agent documentation (.claude/claude.md)
clier docs [subject]        # View documentation (commands, pipeline, all)
clier validate              # Validate configuration
clier start                 # Start pipeline daemon
clier status                # View process status
clier status -w             # Watch mode (live updates)
clier watch                 # Watch mode (alias for status -w)
clier logs <name>           # View process logs
clier logs --daemon         # View daemon logs
clier stop                  # Stop all processes
clier kill <name>           # Force stop a service (SIGKILL)
clier restart               # Restart daemon (new PID)
clier restart <name>        # Restart a specific service
clier reload                # Reload config (same PID, faster)
clier reload <name>         # Restart a specific service
clier refresh               # Reload + restart manual services
clier update                # Update to latest version

# Service control
clier run <name>            # Start a service
clier kill <name>           # Force stop a service
clier send <process> "data" # Send stdin input to a process
clier service start <name>
clier service stop <name> [--force]
clier service restart <name> [--force]
clier service add <name> -c "command" [options]
clier service remove <name>
```

## Development

### Prerequisites
- Node.js >= 18.0.0
- npm, yarn, pnpm, or bun

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

### Project Structure

```
clier/
├── src/
│   ├── cli/              # CLI commands
│   ├── config/           # Configuration schema and loader
│   ├── core/             # Process manager and orchestrator
│   ├── daemon/           # Background daemon
│   └── utils/            # Logging and utilities
├── docs/                 # Documentation
├── examples/             # Example pipelines
└── tests/                # Test suites
```

## Use Cases

- **Development workflows**: Start database, API, and frontend in correct order
- **CI/CD pipelines**: Sequential builds, tests, and deployments
- **Microservices**: Coordinate service dependencies and health checks
- **Data pipelines**: Event-driven ETL and processing workflows

## Requirements

- Node.js >= 18.0.0
- Unix-like OS (macOS, Linux) - Windows support planned

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

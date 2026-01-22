# Clier

A PM2-based process orchestration framework with event-driven pipeline management.

## Overview

Clier is a lightweight orchestration tool that manages multiple processes using PM2, with intelligent event-driven coordination between services and tasks. It provides:

- **Process Management**: Leverages PM2 for robust process lifecycle management
- **Event-Driven Pipeline**: Services and tasks communicate through events
- **Safety Controls**: Built-in rate limiting and debouncing to prevent runaway processes
- **Type Safety**: Full TypeScript support with Zod schema validation
- **Environment Substitution**: Dynamic environment variable substitution in configuration

## Project Status

This project is currently in **Phase 1: Project Setup & Configuration Schema**.

### Completed
- TypeScript project initialization with ESM modules
- Zod schema for configuration validation
- Type-safe configuration types
- Configuration loader with validation
- Basic Winston logging setup
- Comprehensive test suite

### Upcoming Phases
- Phase 2: PM2 Installer Script
- Phase 3: Core Engine & Event Bus
- Phase 4: Testing & Documentation

## Configuration

Clier uses a `clier-pipeline.json` configuration file with the following structure:

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
      "env": {
        "PORT": "${PORT}",
        "NODE_ENV": "production"
      },
      "cwd": "/app/backend",
      "events": {
        "on_stdout": [
          {
            "pattern": "Server listening",
            "emit": "backend:ready"
          }
        ],
        "on_stderr": true,
        "on_crash": true
      }
    },
    {
      "name": "migrate",
      "command": "npm run migrate",
      "type": "task",
      "trigger_on": ["backend:ready"],
      "continue_on_failure": false,
      "events": {
        "on_stdout": [
          {
            "pattern": "Migration complete",
            "emit": "migrate:done"
          }
        ]
      }
    }
  ]
}
```

## Development

### Prerequisites
- Node.js 18+
- npm or pnpm

### Installation

```bash
npm install
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test

# Run tests with UI
npm run test:ui
```

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

## Architecture

### Configuration Schema

The configuration is validated using Zod with strict type checking:

- **Global Settings**: Project name, environment inheritance, safety limits
- **Pipeline Items**: Services (long-running) and tasks (one-off)
- **Event System**: Pattern-based stdout parsing, stderr/crash events
- **Environment**: Variable substitution with `${VAR}` syntax

### Type Safety

All configuration is fully type-safe using TypeScript types inferred from the Zod schema. This ensures compile-time type checking and excellent IDE support.

## License

MIT

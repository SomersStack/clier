# API Reference

Public API documentation for Clier.

## Table of Contents

- [Types](#types)
- [Watcher Class](#watcher-class)
- [Event Types](#event-types)
- [Exported Functions](#exported-functions)

## Types

### ClierConfig

Main configuration type for the pipeline.

```typescript
interface ClierConfig {
  project_name: string;
  global_env: boolean;
  safety: Safety;
  pipeline: PipelineItem[];
}
```

**Fields**:
- `project_name`: Unique identifier for the project
- `global_env`: Whether to inherit system environment variables
- `safety`: Safety configuration (debounce, rate limit)
- `pipeline`: Array of pipeline items (services and tasks)

**Example**:
```typescript
import type { ClierConfig } from 'clier';

const config: ClierConfig = {
  project_name: 'my-app',
  global_env: true,
  safety: {
    max_ops_per_minute: 60,
    debounce_ms: 100
  },
  pipeline: [
    {
      name: 'web',
      command: 'npm start',
      type: 'service',
      events: {
        on_stdout: [{ pattern: 'listening', emit: 'web:ready' }],
        on_stderr: true,
        on_crash: true
      }
    }
  ]
};
```

---

### PipelineItem

Configuration for a single pipeline item (service or task).

```typescript
interface PipelineItem {
  name: string;
  command: string;
  type: 'service' | 'task';
  trigger_on?: string[];
  continue_on_failure?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  events?: Events;
  manual?: boolean;
  input?: { enabled: boolean };
  restart?: 'always' | 'on-failure' | 'never';
}
```

**Fields**:
- `name`: Unique process name
- `command`: Shell command to execute
- `type`: Process type (service = long-running, task = one-off)
- `trigger_on`: Optional array of event names that trigger this process
- `continue_on_failure`: Optional flag for failure handling (default: false)
- `env`: Optional environment variables
- `cwd`: Optional working directory
- `events`: Optional event configuration (omit for no event coordination)
- `manual`: Optional flag to only start via `clier service start` (default: false)
- `input`: Optional stdin input configuration (`{ enabled: true }` to allow `clier input`)
- `restart`: Optional restart policy — `"on-failure"` (default for services, restart on non-zero exit), `"always"` (restart on any exit), or `"never"` (no auto-restart)

**Example**:
```typescript
const item: PipelineItem = {
  name: 'backend',
  command: 'node server.js',
  type: 'service',
  trigger_on: ['db:ready'],
  env: {
    PORT: '3000',
    NODE_ENV: 'production'
  },
  cwd: '/app/backend',
  events: {
    on_stdout: [
      { pattern: 'Server listening', emit: 'backend:ready' }
    ],
    on_stderr: true,
    on_crash: true
  }
};
```

---

### Events

Event emission configuration for a pipeline item.

```typescript
interface Events {
  on_stdout: StdoutEvent[];
  on_stderr: boolean;
  on_crash: boolean;
}
```

**Fields**:
- `on_stdout`: Array of pattern-matching rules for stdout
- `on_stderr`: Whether to emit error events on stderr (default: true)
- `on_crash`: Whether to emit crash events (default: true)

**Example**:
```typescript
const events: Events = {
  on_stdout: [
    { pattern: 'Server ready', emit: 'server:ready' },
    { pattern: 'Database connected', emit: 'db:connected' }
  ],
  on_stderr: true,
  on_crash: true
};
```

---

### StdoutEvent

Pattern-matching rule for stdout event emission.

```typescript
interface StdoutEvent {
  pattern: string;
  emit: string;
}
```

**Fields**:
- `pattern`: Regular expression to match against stdout
- `emit`: Event name to emit when pattern matches

**Example**:
```typescript
const stdoutEvent: StdoutEvent = {
  pattern: '\\[INFO\\]',  // Matches [INFO] in stdout
  emit: 'log:info'
};
```

---

### Safety

Safety configuration for debouncing and rate limiting.

```typescript
interface Safety {
  max_ops_per_minute: number;
  debounce_ms: number;
}
```

**Fields**:
- `max_ops_per_minute`: Maximum process starts per minute
- `debounce_ms`: Milliseconds to wait before restarting crashed processes

**Example**:
```typescript
const safety: Safety = {
  max_ops_per_minute: 60,   // Max 1 start per second
  debounce_ms: 500          // Wait 500ms before restart
};
```

---

## Watcher Class

Main orchestration class that manages the pipeline.

### Constructor

```typescript
class Watcher {
  constructor();
}
```

Creates a new Watcher instance.

**Example**:
```typescript
import { Watcher } from 'clier';

const watcher = new Watcher();
```

---

### start()

Starts the watcher and initializes the pipeline.

```typescript
async start(configPath: string): Promise<void>
```

**Parameters**:
- `configPath`: Path to `clier-pipeline.json` file

**Returns**: `Promise<void>`

**Throws**: Error if configuration is invalid or startup fails

**Example**:
```typescript
const watcher = new Watcher();
await watcher.start('./clier-pipeline.json');
```

**Behavior**:
1. Loads configuration from file
2. Validates schema
3. Initializes all components (EventBus, ProcessManager, etc.)
4. Sets up signal handlers for graceful shutdown
5. Starts the pipeline (runs processes without `trigger_on`)

---

### stop()

Stops the watcher and performs graceful shutdown.

```typescript
async stop(): Promise<void>
```

**Returns**: `Promise<void>`

**Example**:
```typescript
await watcher.stop();
```

**Behavior**:
1. Stops all managed processes
2. Shuts down the daemon
3. Cleans up event listeners
4. Shuts down all components

---

### Usage Example

Complete usage example with error handling and graceful shutdown:

```typescript
import { Watcher } from 'clier';

async function main() {
  const watcher = new Watcher();

  try {
    // Start the watcher
    await watcher.start('./clier-pipeline.json');
    console.log('Pipeline started successfully');

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await watcher.stop();
      process.exit(0);
    });

    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      await watcher.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start watcher:', error);
    await watcher.stop();
    process.exit(1);
  }
}

main();
```

---

## Event Types

### ClierEvent

Internal event type used by the event bus.

```typescript
interface ClierEvent {
  name: string;
  source: string;
  timestamp: Date;
  data?: any;
}
```

**Fields**:
- `name`: Event name (e.g., `backend:ready`)
- `source`: Source of the event (process name)
- `timestamp`: When the event was emitted
- `data`: Optional event data

**Note**: This is an internal type. Events are configured via the `events` field in pipeline items.

---

## Exported Functions

### loadConfig()

Loads and validates a configuration file.

```typescript
async function loadConfig(configPath: string): Promise<ClierConfig>
```

**Parameters**:
- `configPath`: Path to configuration file

**Returns**: `Promise<ClierConfig>` - Validated configuration object

**Throws**: Error if file doesn't exist or validation fails

**Example**:
```typescript
import { loadConfig } from 'clier';

const config = await loadConfig('./clier-pipeline.json');
console.log(`Loaded config for ${config.project_name}`);
```

---

## TypeScript Usage

### Importing Types

```typescript
import type {
  ClierConfig,
  PipelineItem,
  Events,
  StdoutEvent,
  Safety
} from 'clier';
```

### Type Checking

Use TypeScript to validate your configuration at compile time:

```typescript
import type { ClierConfig } from 'clier';

const config: ClierConfig = {
  project_name: 'my-app',
  global_env: true,
  safety: {
    max_ops_per_minute: 60,
    debounce_ms: 100
  },
  pipeline: [
    // TypeScript will validate this structure
    {
      name: 'web',
      command: 'npm start',
      type: 'service',
      events: {
        on_stdout: [{ pattern: 'ready', emit: 'web:ready' }],
        on_stderr: true,
        on_crash: true
      }
    }
  ]
};
```

### Runtime Validation

Use Zod schema for runtime validation:

```typescript
import { configSchema } from 'clier/config/schema';

const rawConfig = JSON.parse(configFile);
const validatedConfig = configSchema.parse(rawConfig);
```

---

## CLI Integration

The Watcher class is used internally by the CLI. For command-line usage, see:

```bash
clier start          # Uses Watcher.start()
clier stop           # Uses Watcher.stop()
clier status         # Queries daemon for process status
clier logs [name]    # Streams logs from daemon
```

---

## Advanced Usage

### Custom Event Handlers

Listen to events programmatically (requires access to EventBus):

```typescript
import { Watcher } from 'clier';

const watcher = new Watcher();
await watcher.start('./config.json');

// Note: EventBus is internal, not directly exposed
// Events are configured via the JSON config file
```

### Programmatic Configuration

Create configuration programmatically instead of from file:

```typescript
import type { ClierConfig } from 'clier';
import { configSchema } from 'clier/config/schema';

const config: ClierConfig = {
  project_name: 'dynamic-app',
  global_env: true,
  safety: {
    max_ops_per_minute: 60,
    debounce_ms: 100
  },
  pipeline: [
    {
      name: 'api',
      command: 'node server.js',
      type: 'service',
      events: {
        on_stdout: [{ pattern: 'listening', emit: 'api:ready' }],
        on_stderr: true,
        on_crash: true
      }
    }
  ]
};

// Validate
const validated = configSchema.parse(config);

// Write to file for use with CLI
import fs from 'fs/promises';
await fs.writeFile('./config.json', JSON.stringify(validated, null, 2));
```

---

## Error Handling

### Common Errors

**Configuration Validation Error**:
```typescript
try {
  await watcher.start('./config.json');
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Configuration validation failed:', error.errors);
  }
}
```

**Daemon Connection Error**:
```typescript
try {
  await watcher.start('./config.json');
} catch (error) {
  if (error.message.includes('daemon')) {
    console.error('Failed to start daemon:', error);
    console.log('Check .clier/daemon.log for details');
  }
}
```

**Process Start Error**:
```typescript
// Errors are logged but don't throw
// Check logs: clier logs [process-name]
// Or daemon logs: cat .clier/daemon.log
```

---

## Package Structure

```
clier/
├── dist/              # Compiled JavaScript
│   ├── bin/           # CLI entry point
│   ├── config/        # Configuration types and schema
│   ├── core/          # Core orchestration logic
│   ├── safety/        # Safety mechanisms
│   └── watcher.js     # Main Watcher class
├── src/               # TypeScript source
└── package.json       # Package metadata
```

---

## Version Compatibility

- Node.js: >= 18.0.0
- TypeScript: ^5.3.3 (for development)

---

## Further Reading

- [Configuration Guide](./configuration.md) - Complete config reference
- [Examples](./examples/README.md) - Real-world examples
- [Main Documentation](./README.md) - Overview and quick start

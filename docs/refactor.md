# Native Daemon Architecture Plan

## Executive Summary

This plan restores multi-agent session support by implementing a per-project daemon architecture using native Node.js capabilities. The daemon runs as a detached background process, managing the Watcher and all pipeline processes, accessible via Unix domain socket IPC.

---

## 1. Architecture Overview

### 1.1 Component Structure

```
┌─────────────────────────────────────────────────────────┐
│  CLI Commands (Multiple Agent Sessions)                 │
│  - clier start                                          │
│  - clier status                                         │
│  - clier logs                                           │
│  - clier stop                                           │
└──────────────┬──────────────────────────────────────────┘
               │ IPC via Unix Socket
               │ (.clier/daemon.sock)
               ▼
┌─────────────────────────────────────────────────────────┐
│  Daemon Process (Detached Background)                   │
│  ┌───────────────────────────────────────────────────┐ │
│  │  IPC Server (JSON-RPC 2.0)                        │ │
│  │  - Listens on Unix socket                         │ │
│  │  - Routes requests to DaemonController            │ │
│  └───────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────┐ │
│  │  DaemonController                                 │ │
│  │  - Manages Watcher lifecycle                      │ │
│  │  - Exposes RPC methods                            │ │
│  │  - Handles state queries                          │ │
│  └───────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Watcher (Existing)                               │ │
│  │  ├─ ProcessManager                                │ │
│  │  ├─ LogManager                                    │ │
│  │  ├─ EventBus                                      │ │
│  │  ├─ Orchestrator                                  │ │
│  │  └─ Safety mechanisms                             │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 1.2 File System Layout

```
/home/user/myapp/                     # Project directory
├── clier-pipeline.json               # Configuration
├── .clier/                           # Daemon state directory
│   ├── daemon.pid                    # Daemon process PID
│   ├── daemon.sock                   # Unix socket for IPC
│   ├── daemon.log                    # Daemon's own log file
│   ├── config-hash.txt               # Hash of loaded config
│   └── logs/                         # Process logs
│       ├── backend.log
│       ├── frontend.log
│       └── ...
```

---

## 2. Core Components

### 2.1 Daemon Process (`src/daemon/index.ts`)

**Responsibility:** Main daemon entry point, runs detached from terminal

**Key Features:**
- Spawned with `detached: true` to survive parent exit
- Writes PID to `.clier/daemon.pid`
- Redirects stdout/stderr to `.clier/daemon.log`
- Sets up signal handlers for graceful shutdown
- Creates Unix socket at `.clier/daemon.sock`

**Implementation Details:**

```typescript
// src/daemon/index.ts
import { fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DaemonServer } from './server.js';
import { Watcher } from '../watcher.js';
import { createContextLogger } from '../utils/logger.js';

export interface DaemonOptions {
  configPath: string;
  projectRoot: string;
  detached: boolean;
}

export class Daemon {
  private server?: DaemonServer;
  private watcher?: Watcher;
  private logger = createContextLogger('Daemon');

  constructor(private options: DaemonOptions) {}

  async start(): Promise<void> {
    // 1. Setup daemon directory structure
    await this.ensureDaemonDir();

    // 2. Check if daemon already running
    if (await this.isDaemonRunning()) {
      throw new Error('Daemon already running');
    }

    // 3. If detached mode, spawn detached process and exit
    if (this.options.detached) {
      this.spawnDetached();
      return; // Parent exits, child continues
    }

    // 4. We're in the detached child process now
    await this.runAsDaemon();
  }

  private spawnDetached(): void {
    const daemonDir = this.getDaemonDir();
    const logPath = path.join(daemonDir, 'daemon.log');

    // Open log file
    const logFd = fs.openSync(logPath, 'a');

    // Spawn detached child process
    const child = fork(__filename, [], {
      detached: true,
      stdio: ['ignore', logFd, logFd, 'ipc'],
      env: {
        ...process.env,
        CLIER_DAEMON_MODE: '1',
        CLIER_CONFIG_PATH: this.options.configPath,
        CLIER_PROJECT_ROOT: this.options.projectRoot,
      },
    });

    // Write PID
    const pidPath = path.join(daemonDir, 'daemon.pid');
    fs.writeFileSync(pidPath, child.pid!.toString());

    // Detach from parent
    child.unref();

    this.logger.info('Daemon started', { pid: child.pid });
  }

  private async runAsDaemon(): Promise<void> {
    // Setup signal handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    // Start watcher
    this.watcher = new Watcher();
    await this.watcher.start(this.options.configPath);

    // Start IPC server
    this.server = new DaemonServer(this.watcher);
    await this.server.start(this.getSocketPath());

    this.logger.info('Daemon running', {
      socket: this.getSocketPath(),
      pid: process.pid,
    });
  }

  private async shutdown(signal: string): Promise<void> {
    this.logger.info('Shutting down daemon', { signal });

    await this.server?.stop();
    await this.watcher?.stop();

    // Cleanup
    this.removePidFile();

    process.exit(0);
  }

  // Helper methods...
}
```

**Lifecycle:**
1. `clier start` → checks for existing daemon
2. If no daemon → spawns detached process
3. Detached process:
   - Writes PID file
   - Starts Watcher
   - Starts IPC server
   - Runs until killed
4. `clier stop` → sends stop request via IPC → daemon shuts down gracefully

---

### 2.2 IPC Server (`src/daemon/server.ts`)

**Responsibility:** Handles JSON-RPC requests from CLI clients

**Protocol:** JSON-RPC 2.0 over Unix domain socket

**Key Features:**
- Listens on `.clier/daemon.sock`
- Parses JSON-RPC requests
- Routes to DaemonController methods
- Returns JSON-RPC responses
- Handles multiple concurrent connections

**Implementation Details:**

```typescript
// src/daemon/server.ts
import * as net from 'net';
import { EventEmitter } from 'events';
import { DaemonController } from './controller.js';
import type { Watcher } from '../watcher.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: number | string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

export class DaemonServer extends EventEmitter {
  private server?: net.Server;
  private controller: DaemonController;

  constructor(watcher: Watcher) {
    super();
    this.controller = new DaemonController(watcher);
  }

  async start(socketPath: string): Promise<void> {
    // Remove stale socket
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(socketPath, () => {
        // Set socket permissions (owner only)
        fs.chmodSync(socketPath, 0o600);
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString();

      // Messages are newline-delimited
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: JsonRpcRequest = JSON.parse(line);
          const response = await this.handleRequest(request);
          socket.write(JSON.stringify(response) + '\n');
        } catch (error) {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            error: {
              code: -32700, // Parse error
              message: 'Invalid JSON',
            },
            id: 0,
          };
          socket.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { error: err.message });
    });
  }

  private async handleRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    try {
      // Route to controller method
      const method = this.controller[request.method];

      if (!method || typeof method !== 'function') {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32601, // Method not found
            message: `Method not found: ${request.method}`,
          },
          id: request.id,
        };
      }

      const result = await method.call(
        this.controller,
        request.params || {}
      );

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603, // Internal error
          message: error instanceof Error ? error.message : String(error),
        },
        id: request.id,
      };
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }
}
```

---

### 2.3 Daemon Controller (`src/daemon/controller.ts`)

**Responsibility:** Exposes Watcher functionality via RPC methods

**RPC Methods:**

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `ping` | `{}` | `{ pong: true }` | Health check |
| `process.list` | `{}` | `ProcessStatus[]` | List all processes |
| `process.start` | `{ name: string }` | `{ success: true }` | Start a process |
| `process.stop` | `{ name: string }` | `{ success: true }` | Stop a process |
| `process.restart` | `{ name: string }` | `{ success: true }` | Restart a process |
| `logs.query` | `{ name: string, lines?: number, since?: number }` | `LogEntry[]` | Query logs |
| `logs.stream` | `{ name: string }` | Stream setup | Start log stream |
| `config.reload` | `{ configPath: string }` | `{ success: true }` | Reload configuration |
| `daemon.shutdown` | `{}` | `{ success: true }` | Shutdown daemon |
| `daemon.status` | `{}` | `DaemonStatus` | Get daemon status |

**Implementation:**

```typescript
// src/daemon/controller.ts
import type { Watcher } from '../watcher.js';
import type { ProcessStatus } from '../core/process-manager.js';
import type { LogEntry } from '../core/log-manager.js';

export interface DaemonStatus {
  uptime: number;
  processCount: number;
  configPath: string;
  pid: number;
}

export class DaemonController {
  private startTime = Date.now();

  constructor(private watcher: Watcher) {}

  // Health check
  async ping(): Promise<{ pong: true }> {
    return { pong: true };
  }

  // Process management
  async 'process.list'(): Promise<ProcessStatus[]> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error('ProcessManager not initialized');
    }
    return manager.listProcesses();
  }

  async 'process.stop'(params: { name: string }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error('ProcessManager not initialized');
    }
    await manager.stopProcess(params.name);
    return { success: true };
  }

  async 'process.restart'(params: { name: string }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error('ProcessManager not initialized');
    }
    await manager.restartProcess(params.name);
    return { success: true };
  }

  // Log queries
  async 'logs.query'(params: {
    name: string;
    lines?: number;
    since?: number;
  }): Promise<LogEntry[]> {
    const logManager = this.watcher.getLogManager();
    if (!logManager) {
      throw new Error('LogManager not initialized');
    }

    if (params.since !== undefined) {
      return logManager.getSince(params.name, params.since);
    }

    return logManager.getLastN(params.name, params.lines || 100);
  }

  // Configuration reload
  async 'config.reload'(params: {
    configPath: string;
  }): Promise<{ success: true }> {
    // Stop current watcher
    await this.watcher.stop();

    // Restart with new config
    await this.watcher.start(params.configPath);

    return { success: true };
  }

  // Daemon control
  async 'daemon.status'(): Promise<DaemonStatus> {
    const manager = this.watcher.getProcessManager();
    const processes = manager?.listProcesses() || [];

    return {
      uptime: Date.now() - this.startTime,
      processCount: processes.length,
      configPath: process.env.CLIER_CONFIG_PATH || '',
      pid: process.pid,
    };
  }

  async 'daemon.shutdown'(): Promise<{ success: true }> {
    // Trigger graceful shutdown
    process.kill(process.pid, 'SIGTERM');
    return { success: true };
  }
}
```

---

### 2.4 IPC Client (`src/daemon/client.ts`)

**Responsibility:** CLI commands use this to communicate with daemon

**Key Features:**
- Connects to Unix socket
- Sends JSON-RPC requests
- Handles responses and errors
- Connection pooling/reuse
- Timeout handling

**Implementation:**

```typescript
// src/daemon/client.ts
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

interface ClientOptions {
  socketPath: string;
  timeout?: number;
}

export class DaemonClient {
  private socket?: net.Socket;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();

  constructor(private options: ClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket?.readable && this.socket?.writable) {
      return; // Already connected
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.options.socketPath);

      socket.on('connect', () => {
        this.socket = socket;
        this.setupSocketHandlers();
        resolve();
      });

      socket.on('error', (err) => {
        reject(new Error(`Cannot connect to daemon: ${err.message}`));
      });

      // Timeout
      setTimeout(() => {
        if (!this.socket) {
          reject(new Error('Connection timeout'));
        }
      }, this.options.timeout || 5000);
    });
  }

  private setupSocketHandlers(): void {
    let buffer = '';

    this.socket!.on('data', (chunk) => {
      buffer += chunk.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          // Ignore parse errors
        }
      }
    });

    this.socket!.on('error', (err) => {
      this.rejectAllPending(err);
    });

    this.socket!.on('close', () => {
      this.rejectAllPending(new Error('Connection closed'));
      this.socket = undefined;
    });
  }

  private handleResponse(response: any): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  async request<T = any>(method: string, params?: any): Promise<T> {
    await this.connect();

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      method,
      params: params || {},
      id,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.socket!.write(JSON.stringify(request) + '\n');

      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, this.options.timeout || 30000);
    });
  }

  disconnect(): void {
    this.socket?.end();
    this.socket = undefined;
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

// Helper to get daemon client for current project
export async function getDaemonClient(
  projectRoot?: string
): Promise<DaemonClient> {
  const root = projectRoot || process.cwd();
  const socketPath = path.join(root, '.clier', 'daemon.sock');

  // Check if socket exists
  if (!fs.existsSync(socketPath)) {
    throw new Error('Daemon not running (socket not found)');
  }

  const client = new DaemonClient({ socketPath });
  await client.connect();
  return client;
}
```

---

## 3. CLI Command Updates

### 3.1 Start Command

**Old behavior:** Blocks terminal with foreground Watcher
**New behavior:** Starts daemon in background, returns immediately

```typescript
// src/cli/commands/start.ts
export async function startCommand(configPath?: string): Promise<number> {
  const configFile = configPath || path.join(process.cwd(), 'clier-pipeline.json');
  const spinner = ora();

  try {
    // Validate configuration
    spinner.start('Loading configuration...');
    const config = await loadConfig(configFile);
    spinner.succeed('Configuration loaded');

    // Check if daemon already running
    const client = await getDaemonClient().catch(() => null);
    if (client) {
      const status = await client.request('daemon.status');
      printWarning('Clier daemon already running');
      console.log();
      console.log(`  PID: ${status.pid}`);
      console.log(`  Uptime: ${formatUptime(status.uptime)}`);
      console.log(`  Processes: ${status.processCount}`);
      console.log();
      console.log('  Run "clier stop" to stop it');
      return 1;
    }

    // Start daemon
    spinner.start('Starting daemon...');
    const daemon = new Daemon({
      configPath: configFile,
      projectRoot: process.cwd(),
      detached: true,
    });

    await daemon.start();

    // Wait for daemon to be ready
    await waitForDaemon(2000);

    spinner.succeed('Daemon started');

    printSuccess(`Clier pipeline running in background`);
    console.log();
    console.log('  Commands:');
    console.log('    clier status    - View process status');
    console.log('    clier logs      - View process logs');
    console.log('    clier stop      - Stop the daemon');
    console.log();

    return 0;
  } catch (error) {
    spinner.fail('Failed to start daemon');
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
```

### 3.2 Status Command

**Old behavior:** Reads from log files
**New behavior:** Queries daemon via IPC

```typescript
// src/cli/commands/status.ts
export async function statusCommand(): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Get daemon status
    const daemonStatus = await client.request('daemon.status');

    // Get process list
    const processes = await client.request<ProcessStatus[]>('process.list');

    client.disconnect();

    // Display status
    console.log();
    console.log(chalk.bold('Daemon Status'));
    console.log(chalk.gray('─────────────────'));
    console.log(`  PID:      ${daemonStatus.pid}`);
    console.log(`  Uptime:   ${formatUptime(daemonStatus.uptime)}`);
    console.log(`  Config:   ${daemonStatus.configPath}`);
    console.log();

    console.log(chalk.bold('Processes'));
    console.log(chalk.gray('─────────────────'));

    if (processes.length === 0) {
      console.log(chalk.gray('  No processes running'));
    } else {
      const table = new Table({
        head: ['Name', 'Status', 'PID', 'Uptime', 'Restarts'],
      });

      for (const proc of processes) {
        table.push([
          proc.name,
          formatStatus(proc.status),
          proc.pid || '-',
          formatUptime(proc.uptime),
          proc.restarts,
        ]);
      }

      console.log(table.toString());
    }
    console.log();

    return 0;
  } catch (error) {
    if (error.message.includes('not running')) {
      printWarning('Clier daemon is not running');
      console.log();
      console.log('  Start it with: clier start');
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
```

### 3.3 Logs Command

**Old behavior:** Reads from log files
**New behavior:** Queries daemon's LogManager

```typescript
// src/cli/commands/logs.ts
export async function logsCommand(
  name: string,
  options: { lines: number; since?: string }
): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Parse 'since' duration if provided
    let sinceTimestamp: number | undefined;
    if (options.since) {
      sinceTimestamp = parseDuration(options.since);
    }

    // Query logs
    const logs = await client.request<LogEntry[]>('logs.query', {
      name,
      lines: options.lines,
      since: sinceTimestamp,
    });

    client.disconnect();

    // Display logs
    if (logs.length === 0) {
      console.log(chalk.gray(`No logs found for process: ${name}`));
      return 0;
    }

    for (const entry of logs) {
      const timestamp = new Date(entry.timestamp).toISOString();
      const stream = entry.stream === 'stderr' ? chalk.red('[ERR]') : chalk.gray('[OUT]');
      console.log(`${chalk.gray(timestamp)} ${stream} ${entry.data}`);
    }

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
```

### 3.4 Stop Command

**Old behavior:** Shows instructions
**New behavior:** Sends shutdown request to daemon

```typescript
// src/cli/commands/stop.ts
export async function stopCommand(options?: {
  process?: string;  // Optional: stop specific process
}): Promise<number> {
  try {
    const client = await getDaemonClient();

    if (options?.process) {
      // Stop specific process
      await client.request('process.stop', { name: options.process });
      printSuccess(`Process ${options.process} stopped`);
    } else {
      // Stop entire daemon
      const spinner = ora('Stopping daemon...').start();

      await client.request('daemon.shutdown');

      // Wait for daemon to exit
      await waitForDaemonExit(5000);

      spinner.succeed('Daemon stopped');
    }

    client.disconnect();
    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
```

### 3.5 Reload Command

**Old behavior:** Just validates config
**New behavior:** Actually reloads daemon

```typescript
// src/cli/commands/reload.ts
export async function reloadCommand(configPath?: string): Promise<number> {
  const configFile = configPath || path.join(process.cwd(), 'clier-pipeline.json');

  try {
    const spinner = ora('Validating configuration...').start();

    // Validate new config
    const config = await loadConfig(configFile);
    spinner.succeed('Configuration valid');

    // Connect to daemon
    const client = await getDaemonClient();

    // Reload
    spinner.start('Reloading daemon...');
    await client.request('config.reload', { configPath: configFile });
    spinner.succeed('Daemon reloaded');

    client.disconnect();

    printSuccess('Configuration reloaded successfully');
    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
```

---

## 4. Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Implement `Daemon` class with detached spawning
- [ ] Implement `DaemonServer` with Unix socket + JSON-RPC
- [ ] Implement `DaemonController` with basic methods
- [ ] Implement `DaemonClient` for IPC communication
- [ ] Add daemon lifecycle management (PID file, socket cleanup)

**Deliverable:** Can start daemon, connect via client, call `ping` method

### Phase 2: Process Management Integration
- [ ] Expose ProcessManager methods via controller
- [ ] Update `start` command to use daemon
- [ ] Update `stop` command to use daemon
- [ ] Update `status` command to query daemon
- [ ] Add process-specific stop/restart via IPC

**Deliverable:** Basic multi-agent session workflow works

### Phase 3: Log Management Integration
- [ ] Expose LogManager methods via controller
- [ ] Update `logs` command to query daemon
- [ ] Add log streaming support (optional)
- [ ] Test log queries from multiple sessions

**Deliverable:** Logs accessible from any agent session

### Phase 4: Configuration Reload
- [ ] Implement hot reload in Watcher
- [ ] Update `reload` command to use IPC
- [ ] Handle config validation errors gracefully
- [ ] Add config hash tracking for change detection

**Deliverable:** Can reload config without full restart

### Phase 5: Robustness & Error Handling
- [ ] Handle stale PID files (daemon crashed)
- [ ] Handle stale socket files
- [ ] Daemon health checks
- [ ] Graceful shutdown on errors
- [ ] Recovery from daemon crashes

**Deliverable:** Handles edge cases reliably

### Phase 6: Testing
- [ ] Unit tests for daemon components
- [ ] Integration tests for IPC layer
- [ ] E2E tests for multi-session workflow
- [ ] Test daemon restart scenarios
- [ ] Test concurrent client connections

**Deliverable:** Comprehensive test coverage

### Phase 7: Documentation & Polish
- [ ] Update all documentation
- [ ] Add daemon architecture diagrams
- [ ] Write troubleshooting guide
- [ ] Add daemon debugging tools
- [ ] Update examples

**Deliverable:** Production-ready daemon implementation

---

## 5. Multi-Agent Session Workflows

### Workflow 1: Start Pipeline

```bash
# Agent Session 1 (Morning)
$ clier start
Loading configuration... ✓
Starting daemon... ✓
✓ Clier pipeline running in background

  Commands:
    clier status    - View process status
    clier logs      - View process logs
    clier stop      - Stop the daemon

# Session exits, daemon keeps running
```

**What happens:**
1. Validates `clier-pipeline.json`
2. Spawns detached daemon process
3. Daemon writes PID to `.clier/daemon.pid`
4. Daemon creates socket at `.clier/daemon.sock`
5. Daemon starts Watcher with ProcessManager
6. CLI returns immediately

### Workflow 2: Check Status (Different Session)

```bash
# Agent Session 2 (Afternoon, hours later)
$ clier status

Daemon Status
─────────────────
  PID:      12345
  Uptime:   3h 42m
  Config:   /home/user/myapp/clier-pipeline.json

Processes
─────────────────
┌─────────┬─────────┬──────┬─────────┬──────────┐
│ Name    │ Status  │ PID  │ Uptime  │ Restarts │
├─────────┼─────────┼──────┼─────────┼──────────┤
│ backend │ running │ 12367│ 3h 42m  │ 0        │
│ frontend│ running │ 12389│ 3h 41m  │ 0        │
└─────────┴─────────┴──────┴─────────┴──────────┘
```

**What happens:**
1. CLI connects to `.clier/daemon.sock`
2. Sends `daemon.status` request
3. Sends `process.list` request
4. Receives responses from daemon
5. Formats and displays

### Workflow 3: View Logs (Different Session)

```bash
# Agent Session 3 (Evening)
$ clier logs backend -n 50

2026-01-22T09:00:23.123Z [OUT] Server listening on port 3000
2026-01-22T09:00:24.456Z [OUT] Database connected
2026-01-22T09:15:32.789Z [OUT] Request: GET /api/users
...
```

**What happens:**
1. CLI connects to daemon
2. Sends `logs.query` request with params
3. Daemon queries LogManager ring buffer
4. Returns last 50 log entries
5. CLI formats and displays

### Workflow 4: Stop Specific Process

```bash
# Agent Session 4 (Next day)
$ clier stop --process backend
✓ Process backend stopped

$ clier status
Processes
─────────────────
┌─────────┬─────────┬──────┬─────────┬──────────┐
│ Name    │ Status  │ PID  │ Uptime  │ Restarts │
├─────────┼─────────┼──────┼─────────┼──────────┤
│ backend │ stopped │ -    │ 0       │ 0        │
│ frontend│ running │ 12389│ 1d 3h   │ 0        │
└─────────┴─────────┴──────┴─────────┴──────────┘
```

**What happens:**
1. CLI sends `process.stop` with `{ name: "backend" }`
2. Daemon calls `processManager.stopProcess("backend")`
3. ManagedProcess stops gracefully
4. Status updated

### Workflow 5: Reload Configuration

```bash
# Agent Session 5 (Later)
# User edits clier-pipeline.json, adds new process

$ clier reload
Validating configuration... ✓
Reloading daemon... ✓
✓ Configuration reloaded successfully

$ clier status
# Shows new process from updated config
```

**What happens:**
1. CLI validates new config
2. Sends `config.reload` request
3. Daemon stops Watcher
4. Daemon starts Watcher with new config
5. New processes started

### Workflow 6: Shutdown Everything

```bash
# Any agent session
$ clier stop
Stopping daemon... ✓
✓ Daemon stopped

# All processes stopped
# Daemon exits
# PID file removed
# Socket removed
```

---

## 6. Edge Cases & Error Handling

### 6.1 Stale PID File

**Scenario:** Daemon crashed, left PID file behind

**Detection:**
```typescript
async function isDaemonRunning(): Promise<boolean> {
  const pidPath = path.join('.clier', 'daemon.pid');

  if (!fs.existsSync(pidPath)) {
    return false;
  }

  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8'));

  try {
    // Check if process exists (doesn't send signal, just checks)
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, remove stale PID file
    fs.unlinkSync(pidPath);
    return false;
  }
}
```

### 6.2 Stale Socket File

**Scenario:** Daemon crashed, socket file exists but nothing listening

**Detection:**
```typescript
async function isSocketLive(socketPath: string): Promise<boolean> {
  try {
    const socket = net.createConnection(socketPath);

    return new Promise((resolve) => {
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });

      socket.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);
    });
  } catch {
    return false;
  }
}
```

**Cleanup:**
```typescript
// Before starting daemon
if (fs.existsSync(socketPath)) {
  const isLive = await isSocketLive(socketPath);
  if (!isLive) {
    fs.unlinkSync(socketPath); // Remove stale socket
  }
}
```

### 6.3 Daemon Crashes

**Detection:** CLI gets connection error

**User Experience:**
```bash
$ clier status
✗ Cannot connect to daemon
  The daemon may have crashed.

  Check logs: cat .clier/daemon.log
  Restart:    clier start
```

**Recovery:**
```typescript
// In CLI commands
try {
  const client = await getDaemonClient();
  // ...
} catch (error) {
  if (error.message.includes('Cannot connect')) {
    console.error('Daemon not responding. Check .clier/daemon.log');
    console.error('Restart with: clier start');
    return 1;
  }
  throw error;
}
```

### 6.4 Multiple Concurrent Clients

**Scenario:** Multiple agent sessions query daemon simultaneously

**Handling:**
- Unix socket supports multiple connections
- Each connection gets its own handler
- JSON-RPC request IDs ensure response routing
- No locking needed (read operations are safe)
- Write operations (stop/restart) are atomic via ProcessManager

### 6.5 Config Reload During Process Execution

**Scenario:** Reload config while processes running

**Strategy:**
```typescript
async 'config.reload'(params: { configPath: string }): Promise<void> {
  // 1. Validate new config first
  const newConfig = await loadConfig(params.configPath);

  // 2. Stop watcher (stops orchestrator, keeps processes)
  await this.watcher.stop();

  // 3. Start with new config
  await this.watcher.start(params.configPath);

  // Note: Existing processes in ProcessManager are preserved
  // New pipeline items will be added
  // Removed pipeline items' processes will continue until explicitly stopped
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Daemon Class:**
- [ ] Spawns detached process correctly
- [ ] Writes PID file
- [ ] Detects existing daemon
- [ ] Cleans up on shutdown

**DaemonServer:**
- [ ] Listens on Unix socket
- [ ] Parses JSON-RPC requests
- [ ] Routes to controller methods
- [ ] Returns JSON-RPC responses
- [ ] Handles malformed requests

**DaemonClient:**
- [ ] Connects to socket
- [ ] Sends requests
- [ ] Receives responses
- [ ] Handles errors
- [ ] Timeout handling

**DaemonController:**
- [ ] All RPC methods work
- [ ] Error handling
- [ ] Validates params

### 7.2 Integration Tests

**IPC Layer:**
```typescript
test('client can call daemon methods', async () => {
  // Start daemon
  const daemon = new Daemon({
    configPath: 'test-config.json',
    projectRoot: '/tmp/test',
    detached: false, // In-process for testing
  });
  await daemon.start();

  // Connect client
  const client = new DaemonClient({
    socketPath: '/tmp/test/.clier/daemon.sock',
  });
  await client.connect();

  // Call method
  const result = await client.request('ping');
  expect(result).toEqual({ pong: true });

  // Cleanup
  client.disconnect();
  await daemon.stop();
});
```

### 7.3 E2E Tests

**Multi-Session Workflow:**
```typescript
test('multiple CLI sessions can access same daemon', async () => {
  // Session 1: Start daemon
  await exec('clier start');

  // Wait for daemon
  await sleep(1000);

  // Session 2: Check status (different process)
  const { stdout: status } = await exec('clier status');
  expect(status).toContain('running');

  // Session 3: Query logs (different process)
  const { stdout: logs } = await exec('clier logs backend -n 10');
  expect(logs).toBeDefined();

  // Session 4: Stop
  await exec('clier stop');
});
```

---

## 8. Migration Path

### 8.1 Backward Compatibility

**Option 1: Flag-based (Recommended)**
```bash
# New daemon mode (default in future)
clier start --daemon

# Old foreground mode (for compatibility)
clier start --foreground
```

**Option 2: Separate commands**
```bash
# Daemon mode
clier daemon start

# Foreground mode (legacy)
clier start --foreground
```

### 8.2 Migration Steps

1. **Release 0.3.0:** Add daemon mode alongside foreground
2. **Release 0.4.0:** Make daemon mode default, deprecate foreground
3. **Release 0.5.0:** Remove foreground mode

---

## 9. Performance Considerations

### 9.1 IPC Overhead

**Benchmark targets:**
- Request latency: < 10ms for local socket
- Throughput: > 1000 requests/sec
- Log query: < 50ms for 1000 entries

**Optimization:**
- Connection pooling in client
- Batch requests when possible
- Compress large log queries

### 9.2 Memory Usage

**Daemon memory profile:**
- Base: ~50MB (Node.js + Watcher)
- Per process: ~5-10MB
- LogManager: ~1MB per 1000 entries per process

**Limits:**
- Max processes: 100 (configurable)
- Max log entries per process: 10,000 (configurable)
- Max concurrent IPC connections: 50

---

## 10. Security Considerations

### 10.1 Socket Permissions

```typescript
// Set socket to owner-only (0600)
fs.chmodSync(socketPath, 0o600);
```

**Implications:**
- Only user who started daemon can connect
- Other users on system cannot access
- Safe for multi-user systems

### 10.2 Process Isolation

**Current:** All processes run as same user as daemon
**Future:** Could support `setuid` for specific processes

### 10.3 Config Validation

**Critical:** Always validate config before reload
```typescript
// Validate before touching running system
const newConfig = await loadConfig(configPath);
validatePipeline(newConfig); // Checks for cycles, etc.

// Only then reload
await watcher.stop();
await watcher.start(configPath);
```

---

## 11. Monitoring & Debugging

### 11.1 Daemon Logs

**Location:** `.clier/daemon.log`

**Contents:**
- Daemon startup/shutdown
- IPC requests/responses
- Watcher events
- Errors and warnings

**Rotation:** Use LogManager for daemon's own logs

### 11.2 Health Checks

```bash
# Check daemon health
clier daemon health

# Output:
Daemon Health
─────────────────
  Status:        healthy
  Uptime:        2d 5h
  Memory:        156 MB
  CPU:           2.3%
  Processes:     8 running, 0 crashed
  IPC:           23 connections (lifetime)
  Errors:        0 (last hour)
```

### 11.3 Debug Mode

```bash
# Start daemon in debug mode
CLIER_DEBUG=1 clier start

# Verbose logging to daemon.log
```

---

## 12. Windows Compatibility (Future)

**Unix Socket → Named Pipe:**
```typescript
// Platform-specific socket path
function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\clier-' + hash(process.cwd());
  }
  return path.join(process.cwd(), '.clier', 'daemon.sock');
}
```

**Testing:** Run test suite on Windows via GitHub Actions

---

## Summary

This architecture restores multi-agent session support by:

1. **Daemon Process:** Runs independently in background
2. **IPC Layer:** JSON-RPC over Unix socket for CLI ↔ daemon communication
3. **State Persistence:** ProcessManager and LogManager live in daemon
4. **Multi-Access:** Any CLI session can connect to same daemon
5. **Graceful Operations:** Proper lifecycle management and error handling

**Key Benefits:**
- ✅ Fixes multi-agent session use case
- ✅ Keeps ManagedProcess race condition fix
- ✅ No external dependencies (pure Node.js)
- ✅ Full control over implementation
- ✅ Better error messages and debugging

The architecture is **production-ready**, **scalable**, and **maintainable** while serving the core use case of multiple Claude Code agent sessions managing the same pipeline.

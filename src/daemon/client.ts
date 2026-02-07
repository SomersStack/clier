/**
 * Daemon Client
 *
 * IPC client for communicating with the daemon via Unix domain socket.
 * Used by CLI commands to send JSON-RPC requests to the daemon.
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { createContextLogger } from "../utils/logger.js";
import { findProjectRootForDaemon } from "../utils/project-root.js";

const logger = createContextLogger("DaemonClient");

/**
 * Client options
 */
export interface ClientOptions {
  socketPath: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

/**
 * Options for getDaemonClient helper
 */
export interface GetDaemonClientOptions {
  projectRoot?: string;
  retries?: number;
  retryDelay?: number;
}

/**
 * DaemonClient class
 *
 * Connects to the daemon's Unix socket and sends JSON-RPC requests.
 * Handles connection management, request/response matching, and timeouts.
 */
export class DaemonClient {
  private socket?: net.Socket;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();

  constructor(private options: ClientOptions) {}

  /**
   * Connect to the daemon socket, with optional retry logic
   */
  async connect(): Promise<void> {
    const retries = this.options.retries ?? 0;
    const retryDelay = this.options.retryDelay ?? 500;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          logger.debug("Connection attempt failed, retrying", {
            attempt: attempt + 1,
            maxRetries: retries,
            delay: retryDelay,
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Single connection attempt to the daemon socket
   */
  private async connectOnce(): Promise<void> {
    if (this.socket?.readable && this.socket?.writable) {
      return; // Already connected
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.options.socketPath);

      socket.on("connect", () => {
        this.socket = socket;
        this.setupSocketHandlers();
        logger.debug("Connected to daemon");
        resolve();
      });

      socket.on("error", (err) => {
        reject(new Error(`Cannot connect to daemon: ${err.message}`));
      });

      // Connection timeout
      const timeout = setTimeout(() => {
        if (!this.socket) {
          socket.destroy();
          reject(new Error("Connection timeout"));
        }
      }, this.options.timeout || 5000);

      socket.once("connect", () => clearTimeout(timeout));
    });
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    let buffer = "";

    this.socket!.on("data", (chunk) => {
      buffer += chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          logger.error("Failed to parse response", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    this.socket!.on("error", (err) => {
      logger.error("Socket error", { error: err.message });
      this.rejectAllPending(err);
    });

    this.socket!.on("close", () => {
      logger.debug("Connection closed");
      this.rejectAllPending(new Error("Connection closed"));
      this.socket = undefined;
    });
  }

  /**
   * Handle a JSON-RPC response
   */
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

  /**
   * Send a JSON-RPC request to the daemon.
   * If a write fails due to a connection error, attempts one reconnect and retry.
   */
  async request<T = any>(method: string, params?: any): Promise<T> {
    await this.connect();

    try {
      return await this.sendRequest<T>(method, params);
    } catch (error) {
      // Auto-reconnect on connection errors
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("Connection closed") ||
        msg.includes("Cannot connect") ||
        msg.includes("write after end")
      ) {
        logger.debug(
          "Request failed with connection error, attempting reconnect",
          { method, error: msg },
        );
        this.socket = undefined;
        await this.connectOnce();
        return this.sendRequest<T>(method, params);
      }
      throw error;
    }
  }

  /**
   * Send a single JSON-RPC request
   */
  private sendRequest<T = any>(method: string, params?: any): Promise<T> {
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      method,
      params: params || {},
      id,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.socket!.write(JSON.stringify(request) + "\n");

      // Request timeout
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, this.options.timeout || 30000);

      // Clear timeout when request completes
      const originalResolve = resolve;
      const originalReject = reject;
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          originalResolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          originalReject(error);
        },
      });
    });
  }

  /**
   * Disconnect from the daemon
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = undefined;
    }
  }

  /**
   * Reject all pending requests with an error
   */
  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

/**
 * Helper to get daemon client for current project
 *
 * Automatically searches upward from the current directory to find
 * the project root (directory containing .clier/).
 *
 * @param projectRootOrOptions - Project root string or options object
 * @returns DaemonClient instance connected to the daemon
 * @throws Error if daemon is not running or project not found
 */
export async function getDaemonClient(
  projectRootOrOptions?: string | GetDaemonClientOptions,
): Promise<DaemonClient> {
  let projectRoot: string | undefined;
  let retries: number | undefined;
  let retryDelay: number | undefined;

  if (typeof projectRootOrOptions === "string") {
    projectRoot = projectRootOrOptions;
  } else if (projectRootOrOptions) {
    projectRoot = projectRootOrOptions.projectRoot;
    retries = projectRootOrOptions.retries;
    retryDelay = projectRootOrOptions.retryDelay;
  }

  // If explicit project root provided, use it
  // Otherwise, search upward for .clier/ directory
  const root = projectRoot || findProjectRootForDaemon();
  const socketPath = path.join(root, ".clier", "daemon.sock");

  // Check if socket exists
  if (!fs.existsSync(socketPath)) {
    throw new Error(
      `Daemon not running. Socket not found at: ${socketPath}\n` +
        "  • Run 'clier start' to start the daemon",
    );
  }

  const client = new DaemonClient({ socketPath, retries, retryDelay });
  await client.connect();
  return client;
}

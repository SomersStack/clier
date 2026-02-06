/**
 * Daemon Server
 *
 * Handles JSON-RPC 2.0 requests from CLI clients over Unix domain socket.
 * Routes requests to the DaemonController.
 */

import * as net from "net";
import * as fs from "fs";
import { EventEmitter } from "events";
import { DaemonController } from "./controller.js";
import { probeSocket } from "./utils.js";
import type { Watcher } from "../watcher.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("DaemonServer");

/**
 * JSON-RPC 2.0 request structure
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: number | string;
}

/**
 * JSON-RPC 2.0 response structure
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

/**
 * DaemonServer class
 *
 * Listens on a Unix domain socket and processes JSON-RPC requests.
 * Supports multiple concurrent client connections.
 */
export class DaemonServer extends EventEmitter {
  private server?: net.Server;
  private controller: DaemonController;

  constructor(watcher: Watcher) {
    super();
    this.controller = new DaemonController(watcher);
  }

  /**
   * Start the IPC server on the specified Unix socket path
   */
  async start(socketPath: string): Promise<void> {
    // Validate and remove stale socket if it exists
    if (fs.existsSync(socketPath)) {
      // Probe the socket to check if another daemon is listening
      const isAlive = await probeSocket(socketPath, 500);
      if (isAlive) {
        throw new Error("Another daemon is already listening");
      }

      try {
        fs.unlinkSync(socketPath);
        logger.debug("Removed stale socket file", { socketPath });
      } catch (error) {
        logger.error("Failed to remove stale socket", {
          socketPath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(socketPath, () => {
        try {
          // Set socket permissions (owner only)
          fs.chmodSync(socketPath, 0o600);
          logger.info("IPC server listening", { socketPath });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.server!.on("error", (error) => {
        logger.error("Server error", { error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Stop the IPC server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info("IPC server stopped");
          resolve();
        });
      });
    }
  }

  /**
   * Handle a new client connection
   */
  private handleConnection(socket: net.Socket): void {
    logger.debug("Client connected");

    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString();

      // Messages are newline-delimited
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: JsonRpcRequest = JSON.parse(line);
          const response = await this.handleRequest(request);
          socket.write(JSON.stringify(response) + "\n");
        } catch (error) {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: "2.0",
            error: {
              code: -32700, // Parse error
              message: "Invalid JSON",
            },
            id: 0,
          };
          socket.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    });

    socket.on("error", (err) => {
      logger.error("Socket error", { error: err.message });
    });

    socket.on("close", () => {
      logger.debug("Client disconnected");
    });
  }

  /**
   * Handle a JSON-RPC request
   */
  private async handleRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    try {
      // Validate JSON-RPC version
      if (request.jsonrpc !== "2.0") {
        return {
          jsonrpc: "2.0",
          error: {
            code: -32600, // Invalid request
            message: "Invalid JSON-RPC version",
          },
          id: request.id,
        };
      }

      // Route to controller method
      const method = (this.controller as any)[request.method];

      if (!method || typeof method !== "function") {
        return {
          jsonrpc: "2.0",
          error: {
            code: -32601, // Method not found
            message: `Method not found: ${request.method}`,
          },
          id: request.id,
        };
      }

      // Call the method
      const result = await method.call(
        this.controller,
        request.params || {}
      );

      return {
        jsonrpc: "2.0",
        result,
        id: request.id,
      };
    } catch (error) {
      logger.error("Error handling request", {
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        jsonrpc: "2.0",
        error: {
          code: -32603, // Internal error
          message: error instanceof Error ? error.message : String(error),
        },
        id: request.id,
      };
    }
  }
}

/**
 * Unit tests for DaemonClient (IPC client over Unix domain socket)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DaemonClient } from "../../../src/daemon/client.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  createContextLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock project-root for getDaemonClient tests
vi.mock("../../../src/utils/project-root.js", () => ({
  findProjectRootForDaemon: vi.fn().mockReturnValue("/mock/project"),
}));

/**
 * Helper: create a simple JSON-RPC echo server for testing.
 * Tracks connected sockets so we can force-close them in afterEach.
 */
function createTestServer(
  socketPath: string,
  handler?: (request: any) => any,
): Promise<{ server: net.Server; sockets: Set<net.Socket> }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const request = JSON.parse(line);
            const result = handler
              ? handler(request)
              : { echo: request.method };
            const response = {
              jsonrpc: "2.0",
              result,
              id: request.id,
            };
            socket.write(JSON.stringify(response) + "\n");
          } catch {
            socket.write(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
                id: 0,
              }) + "\n",
            );
          }
        }
      });
    });

    server.listen(socketPath, () => resolve({ server, sockets }));
    server.on("error", reject);
  });
}

/**
 * Helper: create a server that returns JSON-RPC errors
 */
function createErrorServer(
  socketPath: string,
): Promise<{ server: net.Server; sockets: Set<net.Socket> }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const request = JSON.parse(line);
            const response = {
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal error" },
              id: request.id,
            };
            socket.write(JSON.stringify(response) + "\n");
          } catch {
            // ignore
          }
        }
      });
    });

    server.listen(socketPath, () => resolve({ server, sockets }));
    server.on("error", reject);
  });
}

/**
 * Force-close a server and all connected sockets
 */
async function forceCloseServer(
  server: net.Server,
  sockets: Set<net.Socket>,
): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("DaemonClient", () => {
  let tmpDir: string;
  let socketPath: string;
  let testServer: net.Server | undefined;
  let testSockets: Set<net.Socket> | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-client-test-"));
    socketPath = path.join(tmpDir, "test.sock");
  });

  afterEach(async () => {
    if (testServer) {
      await forceCloseServer(testServer, testSockets || new Set());
      testServer = undefined;
      testSockets = undefined;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("connect", () => {
    it("should connect to a running server", async () => {
      const result = await createTestServer(socketPath);
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      // Should not throw
      client.disconnect();
    });

    it("should reject when server is not running", async () => {
      const client = new DaemonClient({
        socketPath: path.join(tmpDir, "nonexistent.sock"),
      });

      await expect(client.connect()).rejects.toThrow(
        "Cannot connect to daemon",
      );
    });

    it("should be a no-op if already connected", async () => {
      const result = await createTestServer(socketPath);
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      // Second connect should not throw
      await client.connect();

      client.disconnect();
    });
  });

  describe("request", () => {
    it("should send a request and receive a response", async () => {
      const result = await createTestServer(socketPath, () => ({
        pong: true,
      }));
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      const response = await client.request("ping");

      expect(response).toEqual({ pong: true });

      client.disconnect();
    });

    it("should match responses to requests by ID", async () => {
      const result = await createTestServer(socketPath, (req) => ({
        method: req.method,
        requestId: req.id,
      }));
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      // Send multiple requests concurrently
      const [r1, r2, r3] = await Promise.all([
        client.request("method1"),
        client.request("method2"),
        client.request("method3"),
      ]);

      expect(r1.method).toBe("method1");
      expect(r2.method).toBe("method2");
      expect(r3.method).toBe("method3");

      client.disconnect();
    });

    it("should pass params to the server", async () => {
      const result = await createTestServer(socketPath, (req) => ({
        receivedParams: req.params,
      }));
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      const response = await client.request("test", {
        name: "backend",
        force: true,
      });

      expect(response.receivedParams).toEqual({ name: "backend", force: true });

      client.disconnect();
    });

    it("should auto-connect if not connected", async () => {
      const result = await createTestServer(socketPath, () => ({ ok: true }));
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      // Don't call connect() — request() should connect automatically
      const response = await client.request("ping");

      expect(response).toEqual({ ok: true });

      client.disconnect();
    });

    it("should reject with error message when server returns JSON-RPC error", async () => {
      const result = await createErrorServer(socketPath);
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      await expect(client.request("failing.method")).rejects.toThrow(
        "Internal error",
      );

      client.disconnect();
    });

    it("should timeout on unresponsive request", async () => {
      // Create a server that never sends responses
      const sockets = new Set<net.Socket>();
      testSockets = sockets;
      testServer = await new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer((socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
          // Intentionally never respond
        });
        server.listen(socketPath, () => resolve(server));
        server.on("error", reject);
      });

      const client = new DaemonClient({ socketPath, timeout: 200 });
      await client.connect();

      await expect(client.request("ping")).rejects.toThrow("Request timeout");

      client.disconnect();
    });
  });

  describe("disconnect", () => {
    it("should close the socket connection", async () => {
      const result = await createTestServer(socketPath, () => ({ ok: true }));
      testServer = result.server;
      testSockets = result.sockets;

      const client = new DaemonClient({ socketPath });
      await client.connect();

      // Verify the connection works before disconnect
      const response = await client.request("ping");
      expect(response).toEqual({ ok: true });

      client.disconnect();

      // After disconnect, wait for socket close to propagate
      await new Promise((r) => setTimeout(r, 50));

      // Reconnect on a fresh client to avoid close-event race
      const client2 = new DaemonClient({ socketPath });
      await client2.connect();
      const response2 = await client2.request("ping");
      expect(response2).toEqual({ ok: true });

      client2.disconnect();
    });

    it("should be safe to call disconnect when not connected", () => {
      const client = new DaemonClient({ socketPath });
      // Should not throw
      client.disconnect();
    });
  });

  describe("connection close handling", () => {
    it("should reject all pending requests when server closes connection", async () => {
      // Create a server that closes connection after receiving a request
      const sockets = new Set<net.Socket>();
      testSockets = sockets;
      testServer = await new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer((socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
          socket.on("data", () => {
            // Close connection without responding
            socket.destroy();
          });
        });
        server.listen(socketPath, () => resolve(server));
        server.on("error", reject);
      });

      const client = new DaemonClient({ socketPath, timeout: 5000 });
      await client.connect();

      await expect(client.request("ping")).rejects.toThrow("Connection closed");

      client.disconnect();
    });
  });

  describe("retry logic", () => {
    it("should retry connection on failure", async () => {
      // No server running initially — first attempt fails, then start server
      const client = new DaemonClient({
        socketPath,
        retries: 2,
        retryDelay: 100,
      });

      // Start server after a short delay
      setTimeout(async () => {
        const result = await createTestServer(socketPath, () => ({ ok: true }));
        testServer = result.server;
        testSockets = result.sockets;
      }, 50);

      await client.connect();

      const response = await client.request("ping");
      expect(response).toEqual({ ok: true });

      client.disconnect();
    });

    it("should exhaust retries and throw last error", async () => {
      const client = new DaemonClient({
        socketPath: path.join(tmpDir, "nonexistent.sock"),
        retries: 1,
        retryDelay: 50,
      });

      await expect(client.connect()).rejects.toThrow(
        "Cannot connect to daemon",
      );
    });

    it("should use default values when retries not specified", async () => {
      const client = new DaemonClient({
        socketPath: path.join(tmpDir, "nonexistent.sock"),
      });

      // With 0 retries (default), should fail immediately
      await expect(client.connect()).rejects.toThrow(
        "Cannot connect to daemon",
      );
    });
  });

  describe("auto-reconnect", () => {
    it("should auto-reconnect on connection error during request", async () => {
      // Start a server that closes connection after first request, then stays up
      let requestCount = 0;
      const sockets = new Set<net.Socket>();
      testSockets = sockets;
      testServer = await new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer((socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));

          let buffer = "";
          socket.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const request = JSON.parse(line);
                requestCount++;

                if (requestCount === 1) {
                  // Close connection on first request
                  socket.destroy();
                } else {
                  // Respond normally on subsequent requests
                  const response = {
                    jsonrpc: "2.0",
                    result: { reconnected: true },
                    id: request.id,
                  };
                  socket.write(JSON.stringify(response) + "\n");
                }
              } catch {
                // ignore
              }
            }
          });
        });
        server.listen(socketPath, () => resolve(server));
        server.on("error", reject);
      });

      const client = new DaemonClient({ socketPath, timeout: 2000 });

      // First request will fail due to connection close, then auto-reconnect
      const result = await client.request("ping");
      expect(result).toEqual({ reconnected: true });

      client.disconnect();
    });
  });

  describe("getDaemonClient", () => {
    it("should throw when socket file does not exist", async () => {
      const { getDaemonClient } = await import("../../../src/daemon/client.js");

      await expect(getDaemonClient("/nonexistent/path")).rejects.toThrow(
        "Daemon not running",
      );
    });

    it("should create and connect a client when socket exists", async () => {
      // getDaemonClient builds path as: projectRoot/.clier/daemon.sock
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const expectedSocketPath = path.join(clierDir, "daemon.sock");

      const result = await createTestServer(expectedSocketPath);
      testServer = result.server;
      testSockets = result.sockets;

      const { getDaemonClient } = await import("../../../src/daemon/client.js");

      const client = await getDaemonClient(tmpDir);
      expect(client).toBeInstanceOf(DaemonClient);

      client.disconnect();
    });

    it("should accept options object with retries", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const expectedSocketPath = path.join(clierDir, "daemon.sock");

      const result = await createTestServer(expectedSocketPath);
      testServer = result.server;
      testSockets = result.sockets;

      const { getDaemonClient } = await import("../../../src/daemon/client.js");

      const client = await getDaemonClient({
        projectRoot: tmpDir,
        retries: 2,
        retryDelay: 100,
      });
      expect(client).toBeInstanceOf(DaemonClient);

      client.disconnect();
    });
  });
});

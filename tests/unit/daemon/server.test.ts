/**
 * Unit tests for DaemonServer (IPC over Unix domain socket)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DaemonServer } from "../../../src/daemon/server.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  createContextLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock DaemonController to isolate server logic
vi.mock("../../../src/daemon/controller.js", () => ({
  DaemonController: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue({ pong: true }),
    "process.list": vi
      .fn()
      .mockResolvedValue([{ name: "backend", status: "running" }]),
    "daemon.status": vi.fn().mockResolvedValue({ uptime: 100 }),
  })),
}));

// Mock probeSocket (default: socket is not alive / stale)
vi.mock("../../../src/daemon/utils.js", () => ({
  probeSocket: vi.fn().mockResolvedValue(false),
}));

/**
 * Helper: send a JSON-RPC request over a Unix socket and receive the response
 */
function sendRequest(
  socketPath: string,
  request: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(request) + "\n");
    });

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Request timeout"));
    }, 5000);

    let buffer = "";
    client.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          clearTimeout(timeout);
          client.end();
          resolve(response);
        } catch {
          // incomplete, wait for more
        }
      }
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Helper: create a raw socket connection that stays open for multi-message testing.
 * Callers must pass the openConnections array so sockets are tracked for cleanup.
 */
function createRawConnection(
  socketPath: string,
  track?: net.Socket[],
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      track?.push(socket);
      resolve(socket);
    });
    socket.on("error", reject);
  });
}

/**
 * Helper: collect responses from a raw socket
 */
function collectResponses(socket: net.Socket): any[] {
  const responses: any[] = [];
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        responses.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  });

  return responses;
}

describe("DaemonServer", () => {
  let server: DaemonServer;
  let socketPath: string;
  let tmpDir: string;
  const openConnections: net.Socket[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-server-test-"));
    socketPath = path.join(tmpDir, "test.sock");

    // DaemonServer takes a Watcher, but our mock DaemonController ignores it
    server = new DaemonServer({} as any);
  });

  afterEach(async () => {
    for (const conn of openConnections) {
      conn.destroy();
    }
    openConnections.length = 0;
    await server.stop();
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("start", () => {
    it("should listen on the specified socket path", async () => {
      await server.start(socketPath);
      expect(fs.existsSync(socketPath)).toBe(true);
    });

    it("should set socket permissions to 0o600", async () => {
      await server.start(socketPath);
      const stats = fs.statSync(socketPath);
      // On Unix, mode includes file type bits; mask to permission bits
      const permissions = stats.mode & 0o777;
      expect(permissions).toBe(0o600);
    });

    it("should remove stale socket file before binding", async () => {
      // Create a stale socket file
      fs.writeFileSync(socketPath, "stale");
      expect(fs.existsSync(socketPath)).toBe(true);

      await server.start(socketPath);

      // Server should have replaced it
      expect(fs.existsSync(socketPath)).toBe(true);

      // Should be able to connect
      const response = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "ping",
        id: 1,
      });
      expect(response.result).toEqual({ pong: true });
    });

    it("should throw if socket is probed as alive (another daemon listening)", async () => {
      // Create a socket file
      fs.writeFileSync(socketPath, "active");

      const { probeSocket } = await import("../../../src/daemon/utils.js");
      vi.mocked(probeSocket).mockResolvedValueOnce(true);

      await expect(server.start(socketPath)).rejects.toThrow(
        "Another daemon is already listening",
      );
    });
  });

  describe("stop", () => {
    it("should stop accepting new connections", async () => {
      await server.start(socketPath);
      await server.stop();

      await expect(
        sendRequest(socketPath, {
          jsonrpc: "2.0",
          method: "ping",
          id: 1,
        }),
      ).rejects.toThrow();
    });

    it("should be safe to call stop when server is not started", async () => {
      // Should not throw
      await server.stop();
    });
  });

  describe("JSON-RPC request handling", () => {
    beforeEach(async () => {
      await server.start(socketPath);
    });

    it("should handle a valid JSON-RPC ping request", async () => {
      const response = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "ping",
        id: 1,
      });

      expect(response).toEqual({
        jsonrpc: "2.0",
        result: { pong: true },
        id: 1,
      });
    });

    it("should handle a valid process.list request", async () => {
      const response = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "process.list",
        params: {},
        id: 42,
      });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(42);
      expect(response.result).toEqual([{ name: "backend", status: "running" }]);
    });

    it("should return parse error for invalid JSON", async () => {
      const response = await new Promise<any>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          client.write("not valid json\n");
        });

        const timeout = setTimeout(() => {
          client.destroy();
          reject(new Error("timeout"));
        }, 5000);

        let buffer = "";
        client.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const resp = JSON.parse(line);
              clearTimeout(timeout);
              client.end();
              resolve(resp);
            } catch {
              // wait
            }
          }
        });

        client.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32700);
      expect(response.error.message).toBe("Invalid JSON");
    });

    it("should return error for invalid JSON-RPC version", async () => {
      const response = await sendRequest(socketPath, {
        jsonrpc: "1.0",
        method: "ping",
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe("Invalid JSON-RPC version");
      expect(response.id).toBe(1);
    });

    it("should return method not found for unknown methods", async () => {
      const response = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "nonexistent.method",
        id: 5,
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toBe(
        "Method not found: nonexistent.method",
      );
      expect(response.id).toBe(5);
    });

    it("should return internal error when controller method throws", async () => {
      // Get the mock controller and make a method throw
      const { DaemonController } =
        await import("../../../src/daemon/controller.js");
      const MockController = vi.mocked(DaemonController);
      const controllerInstance =
        MockController.mock.results[MockController.mock.results.length - 1]
          ?.value;

      if (controllerInstance) {
        controllerInstance["daemon.status"].mockRejectedValueOnce(
          new Error("Something broke"),
        );

        const response = await sendRequest(socketPath, {
          jsonrpc: "2.0",
          method: "daemon.status",
          id: 10,
        });

        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32603);
        expect(response.error.message).toBe("Something broke");
        expect(response.id).toBe(10);
      }
    });

    it("should preserve request IDs in responses", async () => {
      const response1 = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "ping",
        id: 999,
      });

      expect(response1.id).toBe(999);
    });
  });

  describe("message buffering", () => {
    beforeEach(async () => {
      await server.start(socketPath);
    });

    it("should handle multiple messages sent in a single chunk", async () => {
      const conn = await createRawConnection(socketPath, openConnections);
      const responses = collectResponses(conn);

      // Send two requests in one write
      const req1 = JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 });
      const req2 = JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 2 });
      conn.write(req1 + "\n" + req2 + "\n");

      // Wait for responses
      await new Promise((r) => setTimeout(r, 200));

      expect(responses.length).toBe(2);
      expect(responses.find((r) => r.id === 1)?.result).toEqual({ pong: true });
      expect(responses.find((r) => r.id === 2)?.result).toEqual({ pong: true });

      conn.end();
    });

    it("should handle a message split across multiple chunks", async () => {
      const conn = await createRawConnection(socketPath, openConnections);
      const responses = collectResponses(conn);

      const fullMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "ping",
        id: 3,
      });
      const mid = Math.floor(fullMessage.length / 2);

      // Send first half
      conn.write(fullMessage.substring(0, mid));

      // Wait a tick, then send second half + newline
      await new Promise((r) => setTimeout(r, 50));
      conn.write(fullMessage.substring(mid) + "\n");

      await new Promise((r) => setTimeout(r, 200));

      expect(responses.length).toBe(1);
      expect(responses[0].id).toBe(3);
      expect(responses[0].result).toEqual({ pong: true });

      conn.end();
    });

    it("should skip empty lines", async () => {
      const conn = await createRawConnection(socketPath, openConnections);
      const responses = collectResponses(conn);

      conn.write(
        "\n\n" +
          JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }) +
          "\n\n",
      );

      await new Promise((r) => setTimeout(r, 200));

      // Should only get one response (for the actual request)
      expect(responses.length).toBe(1);
      expect(responses[0].id).toBe(1);

      conn.end();
    });
  });

  describe("concurrent clients", () => {
    beforeEach(async () => {
      await server.start(socketPath);
    });

    it("should handle multiple simultaneous client connections", async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        sendRequest(socketPath, {
          jsonrpc: "2.0",
          method: "ping",
          id: i + 1,
        }),
      );

      const responses = await Promise.all(requests);

      expect(responses.length).toBe(5);
      for (const response of responses) {
        expect(response.result).toEqual({ pong: true });
      }
    });
  });

  describe("client disconnect", () => {
    beforeEach(async () => {
      await server.start(socketPath);
    });

    it("should handle client disconnect gracefully", async () => {
      const conn = await createRawConnection(socketPath, openConnections);

      // Immediately close the client
      conn.destroy();

      // Server should still work for new connections
      await new Promise((r) => setTimeout(r, 100));

      const response = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "ping",
        id: 1,
      });

      expect(response.result).toEqual({ pong: true });
    });
  });
});

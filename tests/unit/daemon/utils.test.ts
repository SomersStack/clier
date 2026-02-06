/**
 * Unit tests for daemon utilities (probeSocket)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { probeSocket } from "../../../src/daemon/utils.js";

describe("probeSocket", () => {
  let tmpDir: string;
  let socketPath: string;
  let server: net.Server | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-utils-test-"));
    socketPath = path.join(tmpDir, "test.sock");
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should return true when a server is listening on the socket", async () => {
    server = await new Promise<net.Server>((resolve, reject) => {
      const s = net.createServer();
      s.listen(socketPath, () => resolve(s));
      s.on("error", reject);
    });

    const result = await probeSocket(socketPath, 500);
    expect(result).toBe(true);
  });

  it("should return false when no server is listening", async () => {
    const result = await probeSocket(socketPath, 500);
    expect(result).toBe(false);
  });

  it("should return false when socket file exists but is stale", async () => {
    // Create a regular file (not a real socket)
    fs.writeFileSync(socketPath, "stale");

    const result = await probeSocket(socketPath, 500);
    expect(result).toBe(false);
  });

  it("should return false within the timeout period when socket is not responding", async () => {
    const start = Date.now();
    const result = await probeSocket(socketPath, 200);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    // Should not take much longer than the timeout
    expect(elapsed).toBeLessThan(1000);
  });

  it("should use default timeout of 500ms", async () => {
    const start = Date.now();
    const result = await probeSocket(socketPath);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(2000);
  });
});

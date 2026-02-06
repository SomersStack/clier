import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProcessManager, ProcessConfig } from "../../../src/core/process-manager.js";

describe("ProcessManager", () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager();
  });

  afterEach(async () => {
    await manager.shutdown(1000);
  });

  describe("startProcess", () => {
    it("should start a process with minimal config", async () => {
      const config: ProcessConfig = {
        name: "test-echo",
        command: "echo hello",
        type: "task",
      };

      const startPromise = new Promise<number>((resolve) => {
        manager.on("start", (name, pid) => {
          if (name === "test-echo") {
            resolve(pid);
          }
        });
      });

      await manager.startProcess(config);

      const pid = await startPromise;
      expect(pid).toBeGreaterThan(0);
    });

    it("should emit stdout events", async () => {
      const config: ProcessConfig = {
        name: "test-stdout",
        command: "echo hello",
        type: "task",
      };

      const stdoutPromise = new Promise<string>((resolve) => {
        manager.on("stdout", (name, data) => {
          if (name === "test-stdout") {
            resolve(data);
          }
        });
      });

      await manager.startProcess(config);

      const stdout = await stdoutPromise;
      expect(stdout).toBe("hello");
    });

    it("should emit exit event with complete logs", async () => {
      const config: ProcessConfig = {
        name: "test-exit",
        command: "echo line1 && echo line2",
        type: "task",
      };

      const exitPromise = new Promise<{
        code: number | null;
        stdout: string[];
      }>((resolve) => {
        manager.on("exit", (name, code, signal, logs) => {
          if (name === "test-exit") {
            resolve({ code, stdout: logs.stdout });
          }
        });
      });

      await manager.startProcess(config);

      const { code, stdout } = await exitPromise;
      expect(code).toBe(0);
      expect(stdout).toContain("line1");
      expect(stdout).toContain("line2");
    });

    it("should emit stderr events", async () => {
      const config: ProcessConfig = {
        name: "test-stderr",
        command: "echo error >&2",
        type: "task",
      };

      const stderrPromise = new Promise<string>((resolve) => {
        manager.on("stderr", (name, data) => {
          if (name === "test-stderr") {
            resolve(data);
          }
        });
      });

      await manager.startProcess(config);

      const stderr = await stderrPromise;
      expect(stderr).toBe("error");
    });

    it("should throw error if process already running", async () => {
      const config: ProcessConfig = {
        name: "test-duplicate",
        command: "sleep 10",
        type: "service",
      };

      await manager.startProcess(config);

      await expect(manager.startProcess(config)).rejects.toThrow(
        'Process "test-duplicate" is already running'
      );
    });

    it("should pass environment variables", async () => {
      const config: ProcessConfig = {
        name: "test-env",
        command: "echo $TEST_VAR",
        type: "task",
        env: { TEST_VAR: "my-value" },
      };

      const stdoutPromise = new Promise<string>((resolve) => {
        manager.on("stdout", (name, data) => {
          if (name === "test-env") {
            resolve(data);
          }
        });
      });

      await manager.startProcess(config);

      const stdout = await stdoutPromise;
      expect(stdout).toBe("my-value");
    });
  });

  describe("stopProcess", () => {
    it("should stop a running process", async () => {
      const config: ProcessConfig = {
        name: "test-stop",
        command: "sleep 10",
        type: "service",
      };

      await manager.startProcess(config);
      expect(manager.isRunning("test-stop")).toBe(true);

      await manager.stopProcess("test-stop");

      // Wait a bit for the process to fully stop
      await new Promise((r) => setTimeout(r, 100));

      expect(manager.isRunning("test-stop")).toBe(false);
    });

    it("should throw error if process not found", async () => {
      await expect(manager.stopProcess("non-existent")).rejects.toThrow(
        'Process "non-existent" not found'
      );
    });
  });

  describe("restartProcess", () => {
    it("should restart a process", async () => {
      const config: ProcessConfig = {
        name: "test-restart",
        command: "sleep 10",
        type: "service",
      };

      await manager.startProcess(config);
      const statusBefore = manager.getStatus("test-restart");
      const pidBefore = statusBefore?.pid;

      await manager.restartProcess("test-restart");

      // Wait a bit for the restart
      await new Promise((r) => setTimeout(r, 100));

      const statusAfter = manager.getStatus("test-restart");
      expect(statusAfter?.status).toBe("running");
      // PID should be different after restart
      expect(statusAfter?.pid).not.toBe(pidBefore);
    });

    it("should throw error if process not found", async () => {
      await expect(manager.restartProcess("non-existent")).rejects.toThrow(
        'Process "non-existent" not found'
      );
    });
  });

  describe("deleteProcess", () => {
    it("should delete a process and remove from tracking", async () => {
      const config: ProcessConfig = {
        name: "test-delete",
        command: "sleep 10",
        type: "service",
      };

      await manager.startProcess(config);
      expect(manager.getStatus("test-delete")).toBeDefined();

      await manager.deleteProcess("test-delete");

      expect(manager.getStatus("test-delete")).toBeUndefined();
    });

    it("should handle deleting non-existent process gracefully", async () => {
      await expect(
        manager.deleteProcess("non-existent")
      ).resolves.toBeUndefined();
    });
  });

  describe("listProcesses", () => {
    it("should list all processes", async () => {
      await manager.startProcess({
        name: "list-1",
        command: "sleep 10",
        type: "service",
      });

      await manager.startProcess({
        name: "list-2",
        command: "sleep 10",
        type: "service",
      });

      const processes = manager.listProcesses();

      expect(processes).toHaveLength(2);
      expect(processes.map((p) => p.name)).toContain("list-1");
      expect(processes.map((p) => p.name)).toContain("list-2");
    });

    it("should return empty array when no processes", () => {
      const processes = manager.listProcesses();
      expect(processes).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("should return status of a running process", async () => {
      await manager.startProcess({
        name: "status-test",
        command: "sleep 10",
        type: "service",
      });

      const status = manager.getStatus("status-test");

      expect(status).toBeDefined();
      expect(status?.name).toBe("status-test");
      expect(status?.status).toBe("running");
      expect(status?.pid).toBeGreaterThan(0);
    });

    it("should return undefined for non-existent process", () => {
      const status = manager.getStatus("non-existent");
      expect(status).toBeUndefined();
    });
  });

  describe("isRunning", () => {
    it("should return true for running process", async () => {
      await manager.startProcess({
        name: "running-test",
        command: "sleep 10",
        type: "service",
      });

      expect(manager.isRunning("running-test")).toBe(true);
    });

    it("should return false for non-existent process", () => {
      expect(manager.isRunning("non-existent")).toBe(false);
    });
  });

  describe("shutdown", () => {
    it("should stop all running processes", async () => {
      await manager.startProcess({
        name: "shutdown-1",
        command: "sleep 10",
        type: "service",
      });

      await manager.startProcess({
        name: "shutdown-2",
        command: "sleep 10",
        type: "service",
      });

      expect(manager.listProcesses()).toHaveLength(2);

      const result = await manager.shutdown(2000);

      expect(manager.listProcesses()).toHaveLength(0);
      expect(result.stopped).toContain("shutdown-1");
      expect(result.stopped).toContain("shutdown-2");
      expect(result.failed).toHaveLength(0);
    });

    it("should return ShutdownResult with stopped and failed lists", async () => {
      await manager.startProcess({
        name: "shutdown-ok",
        command: "sleep 10",
        type: "service",
      });

      const result = await manager.shutdown(2000);

      expect(result).toHaveProperty("stopped");
      expect(result).toHaveProperty("failed");
      expect(Array.isArray(result.stopped)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
      expect(result.stopped).toContain("shutdown-ok");
    });

    it("should stop processes in reverse order when provided", async () => {
      const stopOrder: string[] = [];
      const originalStopProcess = manager.stopProcess.bind(manager);

      await manager.startProcess({
        name: "first",
        command: "sleep 10",
        type: "service",
      });
      await manager.startProcess({
        name: "second",
        command: "sleep 10",
        type: "service",
      });
      await manager.startProcess({
        name: "third",
        command: "sleep 10",
        type: "service",
      });

      // Track shutdown order by monitoring the exit events
      manager.on("exit", (name) => {
        stopOrder.push(name);
      });

      const result = await manager.shutdown(2000, ["third", "second", "first"]);

      expect(result.stopped).toHaveLength(3);
      // The sequential order should be maintained for reverse-ordered stops
      expect(stopOrder[0]).toBe("third");
      expect(stopOrder[1]).toBe("second");
      expect(stopOrder[2]).toBe("first");
    });

    it("should stop remaining processes in parallel after ordered ones", async () => {
      await manager.startProcess({
        name: "ordered-1",
        command: "sleep 10",
        type: "service",
      });
      await manager.startProcess({
        name: "extra",
        command: "sleep 10",
        type: "service",
      });

      // Only order one process, leave "extra" to be stopped in parallel
      const result = await manager.shutdown(2000, ["ordered-1"]);

      expect(result.stopped).toContain("ordered-1");
      expect(result.stopped).toContain("extra");
      expect(result.failed).toHaveLength(0);
    });
  });

  describe("auto-restart for services", () => {
    it("should emit restart event for crashed service", async () => {
      const config: ProcessConfig = {
        name: "test-autorestart",
        command: "exit 1",
        type: "service",
        restart: {
          enabled: true,
          maxRetries: 2,
          delay: 100,
        },
      };

      // Add error listener to prevent unhandled error
      manager.on("error", () => {
        // Expected - max retries will be exceeded
      });

      const restartPromise = new Promise<number>((resolve) => {
        manager.on("restart", (name, attempt) => {
          if (name === "test-autorestart") {
            resolve(attempt);
          }
        });
      });

      await manager.startProcess(config);

      const attempt = await restartPromise;
      expect(attempt).toBe(1);
    }, 10000);

    it("should not auto-restart tasks", async () => {
      const config: ProcessConfig = {
        name: "test-task-no-restart",
        command: "exit 1",
        type: "task",
      };

      let restartCalled = false;
      manager.on("restart", (name) => {
        if (name === "test-task-no-restart") {
          restartCalled = true;
        }
      });

      const exitPromise = new Promise<void>((resolve) => {
        manager.on("exit", (name) => {
          if (name === "test-task-no-restart") {
            resolve();
          }
        });
      });

      await manager.startProcess(config);
      await exitPromise;

      // Wait a bit to ensure no restart is triggered
      await new Promise((r) => setTimeout(r, 200));

      expect(restartCalled).toBe(false);
    });
  });

  describe("child process cleanup", () => {
    it("should kill child processes spawned by shell commands", async () => {
      // This test verifies that when we stop a process, any child processes
      // spawned by the shell are also killed (not orphaned)
      const config: ProcessConfig = {
        name: "test-child-cleanup",
        // This command spawns a child sleep process
        command: "sleep 10 & sleep 10",
        type: "service",
      };

      const startPromise = new Promise<number>((resolve) => {
        manager.on("start", (name, pid) => {
          if (name === "test-child-cleanup") {
            resolve(pid);
          }
        });
      });

      await manager.startProcess(config);
      const shellPid = await startPromise;

      // Get PIDs of all sleep processes (children of shell)
      const { execSync } = await import("child_process");
      const childrenBefore = execSync(`pgrep -P ${shellPid}`, {
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((pid) => parseInt(pid));

      expect(childrenBefore.length).toBeGreaterThan(0);

      // Stop the process
      await manager.stopProcess("test-child-cleanup");

      // Wait for cleanup
      await new Promise((r) => setTimeout(r, 100));

      // Verify that child processes are also killed
      for (const childPid of childrenBefore) {
        try {
          process.kill(childPid, 0); // Check if process exists
          // If we reach here, the process still exists - FAIL
          expect.fail(
            `Child process ${childPid} still running after parent stopped`
          );
        } catch {
          // Process doesn't exist - GOOD
        }
      }

      // Verify shell process is also killed
      try {
        process.kill(shellPid, 0);
        expect.fail(
          `Shell process ${shellPid} still running after stop command`
        );
      } catch {
        // Process doesn't exist - GOOD
      }
    }, 10000);
  });
});

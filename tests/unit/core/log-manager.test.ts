import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LogManager } from "../../../src/core/log-manager.js";

describe("LogManager", () => {
  let logManager: LogManager | undefined;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for log files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-log-test-"));
  });

  afterEach(async () => {
    // Cleanup
    if (logManager) {
      await logManager.flush();
      logManager = undefined;
    }
    // Remove temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("basic functionality", () => {
    it("should add and retrieve log entries", () => {
      logManager = new LogManager({ persistLogs: false });

      logManager.add("test-process", "stdout", "Hello world");
      logManager.add("test-process", "stderr", "Error message");

      const logs = logManager.getAll("test-process");
      expect(logs).toHaveLength(2);
      expect(logs[0].data).toBe("Hello world");
      expect(logs[0].stream).toBe("stdout");
      expect(logs[1].data).toBe("Error message");
      expect(logs[1].stream).toBe("stderr");
    });

    it("should return empty array for non-existent process", () => {
      logManager = new LogManager({ persistLogs: false });

      const logs = logManager.getAll("non-existent");
      expect(logs).toEqual([]);
    });

    it("should get last N entries", () => {
      logManager = new LogManager({ persistLogs: false });

      for (let i = 0; i < 10; i++) {
        logManager.add("test-process", "stdout", `Line ${i}`);
      }

      const logs = logManager.getLastN("test-process", 5);
      expect(logs).toHaveLength(5);
      expect(logs[0].data).toBe("Line 5");
      expect(logs[4].data).toBe("Line 9");
    });

    it("should get entries since timestamp", async () => {
      logManager = new LogManager({ persistLogs: false });

      logManager.add("test-process", "stdout", "Old entry");

      // Wait a bit to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const cutoff = Date.now();
      await new Promise((r) => setTimeout(r, 10));

      logManager.add("test-process", "stdout", "New entry");

      const logs = logManager.getSince("test-process", cutoff);
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toBe("New entry");
    });

    it("should clear logs for a process", () => {
      logManager = new LogManager({ persistLogs: false });

      logManager.add("test-process", "stdout", "Line 1");
      logManager.add("test-process", "stdout", "Line 2");

      logManager.clear("test-process");

      const logs = logManager.getAll("test-process");
      expect(logs).toEqual([]);
    });

    it("should clear all logs", () => {
      logManager = new LogManager({ persistLogs: false });

      logManager.add("process-1", "stdout", "Line 1");
      logManager.add("process-2", "stdout", "Line 2");

      logManager.clearAll();

      expect(logManager.getAll("process-1")).toEqual([]);
      expect(logManager.getAll("process-2")).toEqual([]);
    });
  });

  describe("ring buffer behavior", () => {
    it("should limit entries in memory to maxMemoryEntries", () => {
      const maxEntries = 5;
      logManager = new LogManager({
        persistLogs: false,
        maxMemoryEntries: maxEntries,
      });

      // Add more entries than the buffer can hold
      for (let i = 0; i < 10; i++) {
        logManager.add("test-process", "stdout", `Line ${i}`);
      }

      const logs = logManager.getAll("test-process");
      expect(logs).toHaveLength(maxEntries);
      // Should have the most recent entries (5-9)
      expect(logs[0].data).toBe("Line 5");
      expect(logs[4].data).toBe("Line 9");
    });

    it("should preserve order when buffer wraps around", () => {
      logManager = new LogManager({
        persistLogs: false,
        maxMemoryEntries: 3,
      });

      // Add entries beyond capacity
      logManager.add("test-process", "stdout", "A");
      logManager.add("test-process", "stdout", "B");
      logManager.add("test-process", "stdout", "C");
      logManager.add("test-process", "stdout", "D");
      logManager.add("test-process", "stdout", "E");

      const logs = logManager.getAll("test-process");
      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.data)).toEqual(["C", "D", "E"]);
    });
  });

  describe("log file persistence", () => {
    it("should create log files in specified directory", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("my-process", "stdout", "Test log line");

      // Flush to ensure write completes
      await logManager.flush();

      const logPath = path.join(tempDir, "my-process.log");
      expect(fs.existsSync(logPath)).toBe(true);
    });

    it("should write formatted log lines to file", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("my-process", "stdout", "Test output");
      logManager.add("my-process", "stderr", "Test error");

      await logManager.flush();

      const logPath = path.join(tempDir, "my-process.log");
      const content = fs.readFileSync(logPath, "utf-8");

      expect(content).toContain("[OUT] Test output");
      expect(content).toContain("[ERR] Test error");
    });

    it("should sanitize process names for file paths", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("process/with:special!chars", "stdout", "Test");

      await logManager.flush();

      // Special characters should be replaced with underscores
      const logPath = path.join(tempDir, "process_with_special_chars.log");
      expect(fs.existsSync(logPath)).toBe(true);
    });

    it("should persist logs across multiple runs", async () => {
      // First run - write some logs
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("persistent-process", "stdout", "First run log");
      await logManager.flush();
      logManager = undefined;

      // Create new manager instance (simulating new run)
      const logManager2 = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager2.add("persistent-process", "stdout", "Second run log");
      await logManager2.flush();

      // Read the file and verify both logs are present
      const logPath = path.join(tempDir, "persistent-process.log");
      const content = fs.readFileSync(logPath, "utf-8");

      expect(content).toContain("First run log");
      expect(content).toContain("Second run log");
    });

    it("should handle write errors gracefully", () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: path.join(tempDir, "nonexistent", "deep", "path"),
      });

      // Should not throw, just log the error internally
      expect(() => {
        logManager!.add("test-process", "stdout", "Test log");
      }).not.toThrow();
    });
  });

  describe("log rotation", () => {
    it("should track file size and respect maxFileSize config", async () => {
      // This tests the internal file size tracking behavior
      const smallMaxSize = 500;
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFileSize: smallMaxSize,
        maxFiles: 3,
      });

      // Write data that will be below the threshold
      logManager.add("track-size", "stdout", "Small message");
      await logManager.flush();

      const logPath = path.join(tempDir, "track-size.log");
      expect(fs.existsSync(logPath)).toBe(true);

      const stats = fs.statSync(logPath);
      expect(stats.size).toBeLessThan(smallMaxSize);
    });

    it("should accept rotation configuration options", () => {
      // Test that LogManager accepts all rotation options
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFileSize: 1024 * 1024, // 1MB
        maxFiles: 5,
      });

      // LogManager should be created successfully with rotation config
      expect(logManager).toBeDefined();
    });

    it("should preserve content when writing to log files", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFileSize: 10 * 1024 * 1024, // Large enough to not rotate
        maxFiles: 5,
      });

      // Write unique marker that we can search for
      const marker = "UNIQUE_MARKER_12345";
      logManager.add("preserve", "stdout", marker);

      // Write more data
      for (let i = 0; i < 10; i++) {
        logManager.add("preserve", "stdout", `Filler content ${i}`);
      }

      await logManager.flush();

      // Read all log files and check if marker is preserved
      const files = fs
        .readdirSync(tempDir)
        .filter((f) => f.startsWith("preserve"));
      let foundMarker = false;

      for (const file of files) {
        const content = fs.readFileSync(path.join(tempDir, file), "utf-8");
        if (content.includes(marker)) {
          foundMarker = true;
          break;
        }
      }

      expect(foundMarker).toBe(true);
    });

    it("should continue writing after hitting size threshold", async () => {
      // Test that LogManager continues to function after rotation is triggered
      const smallMaxSize = 100;
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFileSize: smallMaxSize,
        maxFiles: 5,
      });

      // Write enough data to potentially trigger rotation
      for (let i = 0; i < 5; i++) {
        logManager.add("rotation-test", "stdout", `Message ${i}`);
      }

      // Should still be able to add more entries after potential rotation
      logManager.add("rotation-test", "stdout", "Final message");

      // Memory entries should be tracked regardless of file rotation
      const logs = logManager.getAll("rotation-test");
      expect(logs).toHaveLength(6);
      expect(logs[5].data).toBe("Final message");
    });

    it("should handle file rotation gracefully without losing memory entries", async () => {
      const smallMaxSize = 100;
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFileSize: smallMaxSize,
        maxFiles: 3,
        maxMemoryEntries: 100, // Keep all entries in memory
      });

      // Write multiple entries
      const entries = [];
      for (let i = 0; i < 20; i++) {
        const msg = `Entry ${i}: Some log content here`;
        logManager.add("graceful-rotation", "stdout", msg);
        entries.push(msg);
      }

      // All entries should be in memory regardless of file operations
      const logs = logManager.getAll("graceful-rotation");
      expect(logs).toHaveLength(20);

      // Verify the content is correct
      for (let i = 0; i < 20; i++) {
        expect(logs[i].data).toBe(entries[i]);
      }
    });
  });

  describe("flush", () => {
    it("should close all file streams on flush", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("process-1", "stdout", "Log 1");
      logManager.add("process-2", "stdout", "Log 2");

      await logManager.flush();

      // Files should exist and be readable
      expect(fs.existsSync(path.join(tempDir, "process-1.log"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "process-2.log"))).toBe(true);
    });

    it("should handle flush when no logs written", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      // Should not throw
      await expect(logManager.flush()).resolves.toBeUndefined();
    });
  });

  describe("concurrent access", () => {
    it("should handle rapid sequential writes", () => {
      logManager = new LogManager({
        persistLogs: false,
        maxMemoryEntries: 100,
      });

      // Simulate rapid writes
      for (let i = 0; i < 100; i++) {
        logManager.add("rapid-write", "stdout", `Message ${i}`);
      }

      const logs = logManager.getAll("rapid-write");
      expect(logs).toHaveLength(100);
    });

    it("should handle multiple processes simultaneously", () => {
      logManager = new LogManager({
        persistLogs: false,
        maxMemoryEntries: 50,
      });

      // Write to multiple processes
      for (let i = 0; i < 20; i++) {
        logManager.add("process-a", "stdout", `A-${i}`);
        logManager.add("process-b", "stdout", `B-${i}`);
        logManager.add("process-c", "stderr", `C-${i}`);
      }

      expect(logManager.getAll("process-a")).toHaveLength(20);
      expect(logManager.getAll("process-b")).toHaveLength(20);
      expect(logManager.getAll("process-c")).toHaveLength(20);
    });
  });

  describe("deleteLogFiles", () => {
    it("should delete log file for a process", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("delete-test", "stdout", "Test log");
      await logManager.flush();

      const logPath = path.join(tempDir, "delete-test.log");
      expect(fs.existsSync(logPath)).toBe(true);

      logManager.deleteLogFiles("delete-test");

      expect(fs.existsSync(logPath)).toBe(false);
      expect(logManager.getAll("delete-test")).toEqual([]);
    });

    it("should delete rotated log files", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
        maxFiles: 3,
      });

      logManager.add("rotate-delete", "stdout", "Test log");
      await logManager.flush();

      // Manually create rotated files to simulate rotation
      const basePath = path.join(tempDir, "rotate-delete.log");
      fs.writeFileSync(`${basePath}.1`, "rotated 1");
      fs.writeFileSync(`${basePath}.2`, "rotated 2");

      expect(fs.existsSync(basePath)).toBe(true);
      expect(fs.existsSync(`${basePath}.1`)).toBe(true);
      expect(fs.existsSync(`${basePath}.2`)).toBe(true);

      logManager.deleteLogFiles("rotate-delete");

      expect(fs.existsSync(basePath)).toBe(false);
      expect(fs.existsSync(`${basePath}.1`)).toBe(false);
      expect(fs.existsSync(`${basePath}.2`)).toBe(false);
    });

    it("should handle non-existent log files gracefully", () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      // Should not throw when deleting non-existent files
      expect(() => {
        logManager.deleteLogFiles("non-existent-process");
      }).not.toThrow();
    });
  });

  describe("deleteAllLogFiles", () => {
    it("should delete all log files", async () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      logManager.add("process-1", "stdout", "Log 1");
      logManager.add("process-2", "stdout", "Log 2");
      logManager.add("process-3", "stdout", "Log 3");
      await logManager.flush();

      expect(fs.existsSync(path.join(tempDir, "process-1.log"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "process-2.log"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "process-3.log"))).toBe(true);

      logManager.deleteAllLogFiles();

      expect(fs.existsSync(path.join(tempDir, "process-1.log"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "process-2.log"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "process-3.log"))).toBe(false);
      expect(logManager.getAll("process-1")).toEqual([]);
      expect(logManager.getAll("process-2")).toEqual([]);
      expect(logManager.getAll("process-3")).toEqual([]);
    });

    it("should handle empty state gracefully", () => {
      logManager = new LogManager({
        persistLogs: true,
        logDir: tempDir,
      });

      // Should not throw when no logs exist
      expect(() => {
        logManager.deleteAllLogFiles();
      }).not.toThrow();
    });
  });

  describe("getProcessNames", () => {
    it("should return list of process names with logs", () => {
      logManager = new LogManager({ persistLogs: false });

      logManager.add("alpha", "stdout", "Log 1");
      logManager.add("beta", "stdout", "Log 2");
      logManager.add("gamma", "stdout", "Log 3");

      const names = logManager.getProcessNames();

      expect(names).toHaveLength(3);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).toContain("gamma");
    });

    it("should return empty array when no logs exist", () => {
      logManager = new LogManager({ persistLogs: false });

      const names = logManager.getProcessNames();

      expect(names).toEqual([]);
    });
  });
});

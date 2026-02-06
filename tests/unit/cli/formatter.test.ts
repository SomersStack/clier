import { describe, it, expect, vi, beforeEach } from "vitest";
import chalk from "chalk";
import { ZodError } from "zod";
import {
  formatMemory,
  formatUptime,
  formatStatus,
  formatCPU,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  formatValidationErrors,
  printHeader,
} from "../../../src/cli/utils/formatter.js";

describe("Formatter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatMemory", () => {
    it("should return N/A for undefined", () => {
      expect(formatMemory(undefined)).toBe("N/A");
    });

    it("should return N/A for 0", () => {
      expect(formatMemory(0)).toBe("N/A");
    });

    it("should format bytes", () => {
      expect(formatMemory(500)).toBe("500.0 B");
    });

    it("should format kilobytes", () => {
      expect(formatMemory(1024)).toBe("1.0 KB");
      expect(formatMemory(1536)).toBe("1.5 KB");
    });

    it("should format megabytes", () => {
      expect(formatMemory(1024 * 1024)).toBe("1.0 MB");
    });

    it("should format gigabytes", () => {
      expect(formatMemory(1024 * 1024 * 1024)).toBe("1.0 GB");
      expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
    });

    it("should format terabytes", () => {
      expect(formatMemory(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
    });

    it("should not exceed TB unit", () => {
      expect(formatMemory(5 * 1024 * 1024 * 1024 * 1024)).toBe("5.0 TB");
    });
  });

  describe("formatUptime", () => {
    it("should return N/A for undefined", () => {
      expect(formatUptime(undefined)).toBe("N/A");
    });

    it("should return N/A for 0", () => {
      expect(formatUptime(0)).toBe("N/A");
    });

    it("should format seconds", () => {
      expect(formatUptime(5000)).toBe("5s");
      expect(formatUptime(30000)).toBe("30s");
    });

    it("should format minutes and seconds", () => {
      expect(formatUptime(90_000)).toBe("1m 30s");
      expect(formatUptime(5 * 60_000 + 10_000)).toBe("5m 10s");
    });

    it("should format hours and minutes", () => {
      expect(formatUptime(2 * 3_600_000 + 30 * 60_000)).toBe("2h 30m");
    });

    it("should format days and hours", () => {
      expect(formatUptime(3 * 86_400_000 + 5 * 3_600_000)).toBe("3d 5h");
    });
  });

  describe("formatStatus", () => {
    it("should return gray 'unknown' for undefined", () => {
      expect(formatStatus(undefined)).toBe(chalk.gray("unknown"));
    });

    it("should return green for running", () => {
      expect(formatStatus("running")).toBe(chalk.green("running"));
    });

    it("should return yellow for restarting", () => {
      expect(formatStatus("restarting")).toBe(chalk.yellow("restarting"));
    });

    it("should return red for stopped", () => {
      expect(formatStatus("stopped")).toBe(chalk.red("stopped"));
    });

    it("should return red for crashed", () => {
      expect(formatStatus("crashed")).toBe(chalk.red("crashed"));
    });

    it("should return gray for unknown statuses", () => {
      expect(formatStatus("starting")).toBe(chalk.gray("starting"));
    });
  });

  describe("formatCPU", () => {
    it("should return N/A for undefined", () => {
      expect(formatCPU(undefined)).toBe("N/A");
    });

    it("should format zero", () => {
      expect(formatCPU(0)).toBe("0.0%");
    });

    it("should format a normal value", () => {
      expect(formatCPU(45.678)).toBe("45.7%");
    });

    it("should format 100%", () => {
      expect(formatCPU(100)).toBe("100.0%");
    });
  });

  describe("printSuccess", () => {
    it("should print a green checkmark with message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printSuccess("done");
      expect(spy).toHaveBeenCalledWith(chalk.green("✓"), "done");
    });
  });

  describe("printError", () => {
    it("should print a red X with message", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError("failed");
      expect(spy).toHaveBeenCalledWith(chalk.red("✗"), "failed");
    });
  });

  describe("printWarning", () => {
    it("should print a yellow warning with message", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      printWarning("careful");
      expect(spy).toHaveBeenCalledWith(chalk.yellow("⚠"), "careful");
    });
  });

  describe("printInfo", () => {
    it("should print a blue info with message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printInfo("note");
      expect(spy).toHaveBeenCalledWith(chalk.blue("ℹ"), "note");
    });
  });

  describe("printHeader", () => {
    it("should print project name header", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printHeader("my-project");
      expect(spy).toHaveBeenCalledTimes(4); // empty line, title, separator, empty line
      expect(spy).toHaveBeenCalledWith(chalk.bold.cyan("Clier - my-project"));
      expect(spy).toHaveBeenCalledWith(chalk.gray("─".repeat(50)));
    });
  });

  describe("formatValidationErrors", () => {
    it("should format global errors", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["name"],
          message: "Required",
        },
      ]);
      const result = formatValidationErrors(error);
      expect(result).toContain("Configuration validation failed:");
      expect(result).toContain("Global Configuration:");
      expect(result).toContain("name");
      expect(result).toContain("Missing required field");
    });

    it("should format pipeline item errors", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);
      const result = formatValidationErrors(error);
      expect(result).toContain("Pipeline Item");
      expect(result).toContain("command");
      expect(result).toContain("Missing required field");
    });

    it("should use pipeline item name from rawConfig", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);
      const rawConfig = {
        pipeline: [{ name: "my-service" }],
      };
      const result = formatValidationErrors(error, rawConfig);
      expect(result).toContain('"my-service"');
    });

    it("should truncate long command names for pipeline items", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "type"],
          message: "Required",
        },
      ]);
      const rawConfig = {
        pipeline: [{ command: "a-very-long-command-name-that-exceeds-thirty-characters" }],
      };
      const result = formatValidationErrors(error, rawConfig);
      expect(result).toContain("...");
    });

    it("should handle invalid_enum_value errors", () => {
      const error = new ZodError([
        {
          code: "invalid_enum_value",
          options: ["service", "task"],
          received: "invalid",
          path: ["pipeline", 0, "type"],
          message: "Invalid enum value. Expected 'service' | 'task', received 'invalid'",
        },
      ]);
      const rawConfig = {
        pipeline: [{ name: "svc", type: "invalid" }],
      };
      const result = formatValidationErrors(error, rawConfig);
      expect(result).toContain("Invalid value");
      expect(result).toContain('"invalid"');
    });

    it("should handle empty string errors", () => {
      const error = new ZodError([
        {
          code: "custom",
          path: ["pipeline", 0, "name"],
          message: "must not be empty",
        },
      ]);
      const rawConfig = {
        pipeline: [{ name: "" }],
      };
      const result = formatValidationErrors(error, rawConfig);
      expect(result).toContain("Cannot be empty");
      expect(result).toContain("empty string provided");
    });

    it("should handle duplicate name errors", () => {
      const error = new ZodError([
        {
          code: "custom",
          path: ["pipeline"],
          message: "duplicate name found",
        },
      ]);
      const result = formatValidationErrors(error);
      expect(result).toContain("Duplicate pipeline names found");
    });

    it("should provide suggestions for known missing fields", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "type"],
          message: "Required",
        },
      ]);
      const result = formatValidationErrors(error);
      expect(result).toContain('"service" or "task"');
    });

    it("should handle pipeline items with no name or command", () => {
      const error = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);
      const rawConfig = { pipeline: [{}] };
      const result = formatValidationErrors(error, rawConfig);
      // Falls back to "#1" when no name or command
      expect(result).toContain("#1");
    });
  });
});

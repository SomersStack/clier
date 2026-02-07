/**
 * Unit tests for CLI formatter utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("Formatter Utilities", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatMemory", () => {
    it("should return 'N/A' for undefined", () => {
      expect(formatMemory(undefined)).toBe("N/A");
    });

    it("should return 'N/A' for 0 (falsy check)", () => {
      expect(formatMemory(0)).toBe("N/A");
    });

    it("should format small byte values", () => {
      expect(formatMemory(500)).toBe("500.0 B");
    });

    it("should format 1 byte", () => {
      expect(formatMemory(1)).toBe("1.0 B");
    });

    it("should format values below 1 KB", () => {
      expect(formatMemory(1023)).toBe("1023.0 B");
    });

    it("should format exactly 1 KB (1024 bytes)", () => {
      expect(formatMemory(1024)).toBe("1.0 KB");
    });

    it("should format KB values", () => {
      expect(formatMemory(1536)).toBe("1.5 KB");
    });

    it("should format MB values", () => {
      expect(formatMemory(1048576)).toBe("1.0 MB"); // 1024 * 1024
    });

    it("should format fractional MB values", () => {
      expect(formatMemory(1572864)).toBe("1.5 MB"); // 1.5 * 1024 * 1024
    });

    it("should format GB values", () => {
      expect(formatMemory(1073741824)).toBe("1.0 GB"); // 1024^3
    });

    it("should format TB values", () => {
      expect(formatMemory(1099511627776)).toBe("1.0 TB"); // 1024^4
    });

    it("should cap at TB for very large values", () => {
      // 5 TB
      expect(formatMemory(5 * 1099511627776)).toBe("5.0 TB");
    });
  });

  describe("formatUptime", () => {
    it("should return 'N/A' for undefined", () => {
      expect(formatUptime(undefined)).toBe("N/A");
    });

    it("should return 'N/A' for 0 (falsy check)", () => {
      expect(formatUptime(0)).toBe("N/A");
    });

    it("should format seconds only", () => {
      expect(formatUptime(5000)).toBe("5s"); // 5 seconds
    });

    it("should format sub-second as 0s", () => {
      expect(formatUptime(500)).toBe("0s");
    });

    it("should format minutes and seconds", () => {
      expect(formatUptime(90000)).toBe("1m 30s"); // 1 min 30 sec
    });

    it("should format exact minutes", () => {
      expect(formatUptime(120000)).toBe("2m 0s"); // 2 min 0 sec
    });

    it("should format hours and minutes", () => {
      expect(formatUptime(5400000)).toBe("1h 30m"); // 1 hour 30 min
    });

    it("should format exact hours", () => {
      expect(formatUptime(3600000)).toBe("1h 0m"); // 1 hour 0 min
    });

    it("should format days and hours", () => {
      expect(formatUptime(90000000)).toBe("1d 1h"); // 1 day 1 hour
    });

    it("should format exact days", () => {
      expect(formatUptime(86400000)).toBe("1d 0h"); // 1 day 0 hours
    });

    it("should format multiple days", () => {
      expect(formatUptime(259200000)).toBe("3d 0h"); // 3 days
    });
  });

  describe("formatStatus", () => {
    it("should return gray 'unknown' for undefined", () => {
      expect(formatStatus(undefined)).toBe(chalk.gray("unknown"));
    });

    it("should return gray 'unknown' for empty string (falsy)", () => {
      expect(formatStatus("")).toBe(chalk.gray("unknown"));
    });

    it("should format 'running' in green", () => {
      expect(formatStatus("running")).toBe(chalk.green("running"));
    });

    it("should format 'restarting' in yellow", () => {
      expect(formatStatus("restarting")).toBe(chalk.yellow("restarting"));
    });

    it("should format 'stopped' in red", () => {
      expect(formatStatus("stopped")).toBe(chalk.red("stopped"));
    });

    it("should format 'crashed' in red", () => {
      expect(formatStatus("crashed")).toBe(chalk.red("crashed"));
    });

    it("should format unknown status in gray", () => {
      expect(formatStatus("initializing")).toBe(chalk.gray("initializing"));
    });

    it("should format another unknown status in gray", () => {
      expect(formatStatus("pending")).toBe(chalk.gray("pending"));
    });
  });

  describe("formatCPU", () => {
    it("should return 'N/A' for undefined", () => {
      expect(formatCPU(undefined)).toBe("N/A");
    });

    it("should format 0 as '0.0%'", () => {
      expect(formatCPU(0)).toBe("0.0%");
    });

    it("should format decimal CPU values", () => {
      expect(formatCPU(99.5)).toBe("99.5%");
    });

    it("should format whole number CPU values with one decimal", () => {
      expect(formatCPU(50)).toBe("50.0%");
    });

    it("should format 100% CPU", () => {
      expect(formatCPU(100)).toBe("100.0%");
    });

    it("should format small CPU values", () => {
      expect(formatCPU(0.1)).toBe("0.1%");
    });
  });

  describe("printSuccess", () => {
    it("should call console.log with green checkmark and message", () => {
      printSuccess("Operation completed");

      expect(console.log).toHaveBeenCalledWith(
        chalk.green("\u2713"),
        "Operation completed",
      );
    });

    it("should call console.log exactly once", () => {
      printSuccess("test");

      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  describe("printError", () => {
    it("should call console.error with red X and message", () => {
      printError("Something failed");

      expect(console.error).toHaveBeenCalledWith(
        chalk.red("\u2717"),
        "Something failed",
      );
    });

    it("should call console.error exactly once", () => {
      printError("test");

      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("printWarning", () => {
    it("should call console.warn with yellow warning symbol and message", () => {
      printWarning("Be careful");

      expect(console.warn).toHaveBeenCalledWith(
        chalk.yellow("\u26A0"),
        "Be careful",
      );
    });

    it("should call console.warn exactly once", () => {
      printWarning("test");

      expect(console.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("printInfo", () => {
    it("should call console.log with blue info symbol and message", () => {
      printInfo("Some information");

      expect(console.log).toHaveBeenCalledWith(
        chalk.blue("\u2139"),
        "Some information",
      );
    });

    it("should call console.log exactly once", () => {
      printInfo("test");

      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  describe("formatValidationErrors", () => {
    it("should format global errors (non-pipeline paths)", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["name"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Configuration validation failed:");
      expect(result).toContain("Global Configuration:");
      expect(result).toContain("name");
      expect(result).toContain("Missing required field");
    });

    it("should format pipeline item errors", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Configuration validation failed:");
      expect(result).toContain("Pipeline Item");
      expect(result).toContain("command");
      expect(result).toContain("Missing required field");
    });

    it("should extract pipeline item name from rawConfig", () => {
      const zodError = new ZodError([
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

      const result = formatValidationErrors(zodError, rawConfig);

      expect(result).toContain('"my-service"');
    });

    it("should use command as fallback pipeline item name when no name is present", () => {
      const zodError = new ZodError([
        {
          code: "invalid_enum_value",
          options: ["service", "task"],
          received: "invalid",
          path: ["pipeline", 0, "type"],
          message:
            "Invalid enum value. Expected 'service' | 'task', received 'invalid'",
        },
      ]);

      const rawConfig = {
        pipeline: [{ command: "npm start" }],
      };

      const result = formatValidationErrors(zodError, rawConfig);

      expect(result).toContain("#1 (npm start)");
    });

    it("should truncate long command names in pipeline item labels", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "type"],
          message: "Required",
        },
      ]);

      const rawConfig = {
        pipeline: [
          {
            command:
              "this-is-a-very-long-command-that-exceeds-the-thirty-character-limit",
          },
        ],
      };

      const result = formatValidationErrors(zodError, rawConfig);

      expect(result).toContain("#1 (this-is-a-very-long-command...");
    });

    it("should use default numbering when rawConfig is not provided", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Pipeline Item #1:");
    });

    it("should format missing required field with suggestion for 'command'", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Missing required field");
      expect(result).toContain("command to execute");
    });

    it("should format missing required field with suggestion for 'type'", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "type"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Missing required field");
      expect(result).toContain('"service" or "task"');
    });

    it("should format invalid enum value errors", () => {
      const zodError = new ZodError([
        {
          code: "invalid_enum_value",
          options: ["service", "task"],
          received: "worker",
          path: ["pipeline", 0, "type"],
          message:
            "Invalid enum value. Expected 'service' | 'task', received 'worker'",
        },
      ]);

      const rawConfig = {
        pipeline: [
          { name: "my-service", type: "worker", command: "npm start" },
        ],
      };

      const result = formatValidationErrors(zodError, rawConfig);

      expect(result).toContain("Invalid value");
      expect(result).toContain("worker");
      expect(result).toContain("Expected");
    });

    it("should handle both global and pipeline errors together", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["name"],
          message: "Required",
        },
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Global Configuration:");
      expect(result).toContain("Pipeline Item");
    });

    it("should group multiple errors for the same pipeline item", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "type"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      // Should have one Pipeline Item section, not two
      const pipelineItemMatches = result.match(/Pipeline Item/g);
      expect(pipelineItemMatches).toHaveLength(1);

      // Both field names should appear
      expect(result).toContain("command");
      expect(result).toContain("type");
    });

    it("should handle errors for multiple pipeline items", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 0, "command"],
          message: "Required",
        },
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["pipeline", 1, "command"],
          message: "Required",
        },
      ]);

      const result = formatValidationErrors(zodError);

      const pipelineItemMatches = result.match(/Pipeline Item/g);
      expect(pipelineItemMatches).toHaveLength(2);
    });

    it("should handle invalid enum value without rawConfig", () => {
      const zodError = new ZodError([
        {
          code: "invalid_enum_value",
          options: ["service", "task"],
          received: "worker",
          path: ["pipeline", 0, "type"],
          message:
            "Invalid enum value. Expected 'service' | 'task', received 'worker'",
        },
      ]);

      const result = formatValidationErrors(zodError);

      expect(result).toContain("Invalid value");
      expect(result).toContain("Expected");
    });
  });

  describe("printHeader", () => {
    it("should print the project name in bold cyan", () => {
      printHeader("my-project");

      expect(console.log).toHaveBeenCalledWith(
        chalk.bold.cyan("Clier - my-project"),
      );
    });

    it("should print a separator line", () => {
      printHeader("test");

      expect(console.log).toHaveBeenCalledWith(chalk.gray("\u2500".repeat(50)));
    });

    it("should call console.log 4 times (empty, header, separator, empty)", () => {
      printHeader("test");

      expect(console.log).toHaveBeenCalledTimes(4);
    });
  });
});

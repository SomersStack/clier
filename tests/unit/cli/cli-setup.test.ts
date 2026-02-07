/**
 * Tests for CLI command setup and argument parsing.
 *
 * These tests exercise createCLI() and parse arguments through Commander
 * to catch configuration errors (e.g. missing enablePositionalOptions).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCLI } from "../../../src/cli/index.js";

// Mock all command handlers so parsing doesn't trigger real side effects
vi.mock("../../../src/cli/commands/start.js", () => ({
  startCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/stop.js", () => ({
  stopCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/restart.js", () => ({
  restartCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/status.js", () => ({
  statusCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/logs.js", () => ({
  logsCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/logs-clear.js", () => ({
  logsClearCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/reload.js", () => ({
  reloadCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/validate.js", () => ({
  validateCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/update.js", () => ({
  updateCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/docs.js", () => ({
  docsCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/init.js", () => ({
  initCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/service.js", () => ({
  serviceStartCommand: vi.fn().mockResolvedValue(0),
  serviceStopCommand: vi.fn().mockResolvedValue(0),
  serviceRestartCommand: vi.fn().mockResolvedValue(0),
  serviceAddCommand: vi.fn().mockResolvedValue(0),
  serviceRemoveCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/emit.js", () => ({
  emitCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/input.js", () => ({
  inputCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/events.js", () => ({
  eventsCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock("../../../src/cli/commands/template.js", () => ({
  templateListCommand: vi.fn().mockResolvedValue(0),
  templateApplyCommand: vi.fn().mockResolvedValue(0),
  templateShowCommand: vi.fn().mockResolvedValue(0),
}));

// Prevent process.exit from killing the test runner
vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

describe("CLI Setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create CLI without errors", () => {
    expect(() => createCLI()).not.toThrow();
  });

  it("should parse 'run <name>' without errors", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync(["node", "clier", "run", "my-service"]),
    ).resolves.not.toThrow();
  });

  it("should parse 'run <name>' with pass-through args", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync([
        "node",
        "clier",
        "run",
        "my-service",
        "--",
        "arg1",
        "arg2",
      ]),
    ).resolves.not.toThrow();
  });

  it("should parse 'service start <name>' without errors", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync(["node", "clier", "service", "start", "my-service"]),
    ).resolves.not.toThrow();
  });

  it("should parse 'service start <name>' with pass-through args", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync([
        "node",
        "clier",
        "service",
        "start",
        "my-service",
        "--",
        "arg1",
        "arg2",
      ]),
    ).resolves.not.toThrow();
  });

  it("should parse 'service stop <name>'", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync(["node", "clier", "service", "stop", "my-service"]),
    ).resolves.not.toThrow();
  });

  it("should parse 'service restart <name>'", async () => {
    const program = createCLI();
    await expect(
      program.parseAsync(["node", "clier", "service", "restart", "my-service"]),
    ).resolves.not.toThrow();
  });

  it("should pass arguments through to the run command handler", async () => {
    const { serviceStartCommand } =
      await import("../../../src/cli/commands/service.js");
    const program = createCLI();
    await program.parseAsync([
      "node",
      "clier",
      "run",
      "my-service",
      "--",
      "hello",
      "world",
    ]);

    expect(serviceStartCommand).toHaveBeenCalledWith("my-service", [
      "--",
      "hello",
      "world",
    ]);
  });

  it("should pass arguments through to the service start handler", async () => {
    const { serviceStartCommand } =
      await import("../../../src/cli/commands/service.js");
    const program = createCLI();
    await program.parseAsync([
      "node",
      "clier",
      "service",
      "start",
      "my-service",
      "--",
      "foo",
      "bar",
    ]);

    expect(serviceStartCommand).toHaveBeenCalledWith("my-service", [
      "--",
      "foo",
      "bar",
    ]);
  });
});
